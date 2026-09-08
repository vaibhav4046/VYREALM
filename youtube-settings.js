const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const MAX_CREDENTIAL_BYTES = 64 * 1024;
const AUTH_PHASES = new Set(['idle', 'pending', 'connected', 'failed', 'cancelled']);
const STATUS_READ_ERROR = 'Could not read YouTube connection status. Try refreshing the connection.';
const guidance = Object.freeze({
  YOUTUBE_AUTH_DENIED: 'Google permission was declined. Choose your account again and allow the features you want to use.',
  YOUTUBE_AUTH_CANCELLED: 'Sign-in was cancelled. Your local projects are unchanged. Connect when you are ready.',
  YOUTUBE_AUTH_EXPIRED: 'This sign-in attempt expired. Start a new connection; an old browser tab cannot finish it.',
  YOUTUBE_AUTH_INVALID: 'This sign-in response is no longer valid. Close the old sign-in tab and connect again.',
  YOUTUBE_AUTH_EXCHANGE_FAILED: 'Google could not finish sign-in. Check the setup file and start a new connection.',
  YOUTUBE_AUTH_FAILED: 'Google sign-in did not finish. Connect again when you are ready.',
  YOUTUBE_TOKEN_REFRESH_FAILED: 'Google could not renew access. Reconnect to choose your account and grant permission again.',
  YOUTUBE_NOT_CONNECTED: 'No YouTube account is connected. Choose your own account to continue.',
  YOUTUBE_SCOPE_REQUIRED: 'This feature needs permission. Reconnect and include the feature you want to use.',
  YOUTUBE_CHANNEL_SELECTION_REQUIRED: 'Choose the Google or Brand Account for one YouTube channel, then confirm the channel shown here.',
  YOUTUBE_CHANNEL_LOOKUP_FAILED: 'Your account is signed in, but its YouTube channel could not be confirmed. Check that YouTube Data API v3 is enabled, then verify the channel.',
  YOUTUBE_CHANNEL_MISMATCH: 'The connected channel changed. Refresh its identity before continuing.',
  YOUTUBE_DISCONNECT_REQUIRED: 'An account or sign-in attempt is already saved. Refresh, then explicitly disconnect it before choosing another.',
  YOUTUBE_UPLOAD_BUSY: 'An upload is active. Finish or pause it before changing the connected account.',
  YOUTUBE_BUSY: 'A YouTube action is still running. Finish or pause it before changing the connected account.',
  YOUTUBE_API_REJECTED: 'YouTube could not complete this request. Check the selected account, enabled APIs, permissions and available API quota.',
  YOUTUBE_PROTECTED_STORE_REQUIRED: 'Protected credential storage is unavailable. Repair this installation before connecting YouTube.',
  YOUTUBE_VAULT_INVALID: 'The saved connection cannot be read securely. Repair its protected storage before reconnecting.',
  YOUTUBE_CONFIGURATION_INVALID: 'The setup file could not be read. Import a valid Desktop app JSON file for this installation.',
});

export function parseYouTubeDesktopCredentials(text) {
  const invalid = () => new Error('Choose a valid Google Desktop app credential JSON file.');
  if (typeof text !== 'string' || text.length > MAX_CREDENTIAL_BYTES) throw invalid();
  let source;
  try { source = JSON.parse(text); } catch { throw invalid(); }
  const installed = source?.installed;
  if (!installed || source.web || typeof installed !== 'object' || Array.isArray(installed)
    || typeof installed.client_id !== 'string' || !/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(installed.client_id)
    || installed.client_id.length > 512) throw invalid();
  if (installed.client_secret !== undefined && (typeof installed.client_secret !== 'string'
    || !installed.client_secret || installed.client_secret.length > 4096 || /[\s\u0000-\u001f]/.test(installed.client_secret))) throw invalid();
  return { installed: { client_id: installed.client_id, ...(installed.client_secret === undefined ? {} : { client_secret: installed.client_secret }) } };
}

export function renderYouTubeAnalytics(report) {
  if (!report) return '<p class="meta">Choose a date range to read the connected channel’s YouTube Analytics data.</p>';
  const headers = Array.isArray(report.columnHeaders) ? report.columnHeaders.slice(0, 32) : [];
  const rows = Array.isArray(report.rows) ? report.rows.slice(0, 500) : [];
  const caption = `${report.startDate || ''} to ${report.endDate || ''}${report.videoId ? ` · Video ${report.videoId}` : ' · Channel report'}`;
  return `<div class="meta"><p>YouTube Analytics · ${escape(caption)}</p>${headers.length && rows.length ? `<div style="max-width:100%;overflow-x:auto"><table style="width:100%;border-collapse:collapse;text-align:left"><caption class="sr-only">YouTube Analytics report</caption><thead><tr>${headers.map(header => `<th scope="col" style="padding:8px;border-bottom:1px solid var(--line)">${escape(header?.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, index) => `<td style="padding:8px;border-bottom:1px solid var(--line)">${escape(Array.isArray(row) ? row[index] : '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p>No rows are available for this date range.</p>'}<p>Recent data can be delayed. Metrics describe reported activity and do not predict future reach.</p></div>`;
}

function publicStatus(value) {
  const source = value?.status && typeof value.status === 'object' ? value.status : value || {};
  const channel = source.connectedChannel;
  return {
    configured: source.configured === true,
    registrationSource: source.registrationSource === 'bundled' ? 'bundled' : 'developer',
    connected: source.connected === true,
    channel: channel && typeof channel.id === 'string' ? { id: channel.id.slice(0, 200), title: String(channel.title || channel.id).slice(0, 500) } : null,
    analytics: source.analytics,
    upload: source.upload,
    verification: source.channelVerification?.status === 'verified' ? { status: 'verified', checkedAt: typeof source.channelVerification.checkedAt === 'string' ? source.channelVerification.checkedAt : '' } : { status: source.channelVerification?.status === 'failed' ? 'failed' : 'not-checked', code: source.channelVerification?.code },
    auth: { phase: AUTH_PHASES.has(source.auth?.phase) ? source.auth.phase : 'idle', code: typeof source.auth?.code === 'string' ? source.auth.code : '' },
    code: typeof source.code === 'string' ? source.code : '',
  };
}

function authorizationUrl(value) {
  let url;
  try { if(typeof value !== 'string' || value.length > 4096) throw Error(); url = new URL(value); } catch { throw new Error('Invalid authorization URL'); }
  if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password || url.hash) throw new Error('Invalid authorization URL');
  const fields = ['client_id','redirect_uri','response_type','scope','state','code_challenge','code_challenge_method','access_type','prompt'], p = url.searchParams;
  const scopes = new Set(['https://www.googleapis.com/auth/youtube.readonly','https://www.googleapis.com/auth/youtube.upload','https://www.googleapis.com/auth/yt-analytics.readonly']);
  if([...p.keys()].some(key=>!fields.includes(key)) || fields.some(key=>p.getAll(key).length!==1)
    || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(p.get('client_id'))
    || !/^[A-Za-z0-9_-]{43}$/.test(p.get('state')) || !/^[A-Za-z0-9_-]{43}$/.test(p.get('code_challenge'))
    || p.get('response_type')!=='code' || p.get('code_challenge_method')!=='S256' || p.get('access_type')!=='offline'
    || !['consent','consent select_account'].includes(p.get('prompt'))
    || p.get('scope').split(' ').some(scope=>!scopes.has(scope)) || !p.get('scope').split(' ').includes('https://www.googleapis.com/auth/youtube.readonly')) throw new Error('Invalid authorization URL');
  let redirect;try{redirect=new URL(p.get('redirect_uri'));}catch{throw new Error('Invalid authorization URL');}
  if(redirect.protocol!=='http:' || redirect.hostname!=='127.0.0.1' || !redirect.port || redirect.pathname!=='/oauth/youtube/callback' || redirect.username || redirect.password || redirect.search || redirect.hash)throw new Error('Invalid authorization URL');
  return url.href;
}

/** One local-user account connection. api uses the app's fetch-style options. */
export function createYouTubeSettings({ api, render = () => {}, openExternal, getProject } = {}) {
  if (typeof api !== 'function') throw new TypeError('YouTube settings require the local API function.');
  let status = null, busy = '', error = '', notice = '', report = null;
  let timer = null, request = null, disposed = false, generation = 0, bound = [];
  let developerOpen = false, confirmation = null, authUrl = '', statusReadable = false;
  const features = { upload: true, analytics: false };
  const today = new Date(), start = new Date(today.getTime() - 27 * 86400000);
  const query = { startDate: start.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10), videoId: '' };
  const pending = () => status?.auth.phase === 'pending';
  const paint = () => { if (!disposed) render(); };
  const stopPolling = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const post = (path, body = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });

  function poll() {
    stopPolling();
    if (!disposed && !busy && pending()) {
      timer = setTimeout(() => { timer = null; void update(); }, 2500);
      timer.unref?.();
    }
  }

  async function update() {
    if (disposed) return;
    if (request) return request;
    const current = generation;
    request = (async () => {
      try {
        const next = publicStatus(await api('/youtube/status'));
        if (disposed || current !== generation) return;
        const changed = JSON.stringify(status) !== JSON.stringify(next);
        const previousError = error, previousNotice = notice;
        if(!status && next.connected){features.upload=next.upload==='authorized-not-verified';features.analytics=next.analytics==='authorized-not-verified';if(!features.upload&&!features.analytics)features.upload=true;}
        if (!next.connected || status?.channel?.id !== next.channel?.id) report = null;
        status = next; statusReadable = true;
        if (!pending()) authUrl = '';
        if (error === STATUS_READ_ERROR) error = '';
        if (!pending() && notice === 'Finish authorization in your system browser, then return here.') notice = '';
        if (changed || error !== previousError || notice !== previousNotice) paint();
      } catch {
        if (disposed || current !== generation) return;
        statusReadable = false; error = STATUS_READ_ERROR;
        paint();
      } finally {
        if (current === generation) { request = null; poll(); }
      }
    })();
    return request;
  }

  function connectionText() {
    if (!status) return 'Reading local connection status…';
    if (!statusReadable) return 'Showing the last saved connection. Refresh before making changes.';
    if (status.auth.code === 'YOUTUBE_VERIFYING_CHANNEL') return 'Google sign-in received. Confirming your YouTube channel…';
    if (pending()) return 'Waiting for authorization in your system browser.';
    if (status.verification.status === 'failed') return guidance[status.verification.code] || 'Your saved channel could not be verified with YouTube. Check the connection or reconnect.';
    if (guidance[status.auth.code]) return guidance[status.auth.code];
    if (status.connected && status.channel) return 'Account authorization is saved. Check the channel below before choosing a video to upload.';
    if (status.connected) return 'Authorization is stored. Channel identity has not been confirmed.';
    if (status.auth.phase === 'failed') return 'Authorization did not complete. Try connecting again.';
    if (status.auth.phase === 'cancelled') return guidance.YOUTUBE_AUTH_CANCELLED;
    if (guidance[status.code] && status.code !== 'YOUTUBE_NOT_CONNECTED') return guidance[status.code];
    if (!status.configured) return 'Add the setup file below to connect your own channel.';
    return 'No YouTube account is connected.';
  }

  function html() {
    const connected = status?.connected === true;
    const disabled = busy ? 'disabled' : '';
    const analyticsAllowed = connected && status.analytics === 'authorized-not-verified';
    const canConnect = statusReadable && status?.configured && !pending() && (features.upload || features.analytics);
    const setupOpen = developerOpen || (status && !status.configured);
    return `<section id="youtubeSettings" class="panel" aria-labelledby="youtubeSettingsTitle">
      <style>#youtubeSettings{min-width:0;overflow-wrap:anywhere}#youtubeSettings .yt-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:0;list-style:none;margin:22px 0}#youtubeSettings .yt-steps li{padding:16px;border:1px solid var(--line,#3c2e50);border-radius:12px;background:#15101e}#youtubeSettings .yt-steps b{display:block;color:#e7d8ff;font-size:13px;margin:6px 0}#youtubeSettings .yt-steps span{font-size:11px;color:#b9afc9}#youtubeSettings .yt-channel{padding:18px;border:1px solid #63507d;background:#1d1529;border-radius:12px;margin:18px 0}#youtubeSettings .yt-channel strong{display:block;font-size:18px;line-height:1.5;color:#f6edff}#youtubeSettings .yt-channel small{display:block;font-size:11px;color:#bcb1cf;margin-top:7px}#youtubeSettings .panel-actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}#youtubeSettings .yt-permissions{border:0;padding:0;margin:18px 0}#youtubeSettings .yt-permissions legend{font-size:13px;color:#e2d3f5;margin-bottom:10px}#youtubeSettings .yt-permissions label{display:flex;align-items:flex-start;gap:10px;padding:8px 0;font-size:12px;line-height:1.6}#youtubeSettings input[type=checkbox]{accent-color:#bf9ef4;flex:0 0 auto;margin-top:4px}#youtubeSettings .yt-confirm{border:1px solid #866ab1;background:#22172f;border-radius:12px;padding:18px;margin:16px 0}#youtubeSettings .yt-confirm h4{font-size:16px;margin:0 0 10px}#youtubeSettings .yt-setup{border-top:1px solid var(--line,#3c2e50);margin-top:22px;padding-top:16px}#youtubeSettings summary{cursor:pointer;padding:8px 0;color:#ded0f1;font-size:13px}#youtubeSettings .yt-setup ol{padding-left:22px;line-height:1.85;font-size:12px;color:#bcb2ca}#youtubeSettings a{color:#d7b9ff}#youtubeSettings :is(button,input,a,summary):focus-visible{outline:2px solid #dac3ff;outline-offset:3px}#youtubeSettings input[type=file]{max-width:100%;min-width:0}#youtubeSettings .yt-report{margin-top:28px;border-top:1px solid var(--line,#3c2e50);padding-top:20px}#youtubeSettings [role=alert]{color:#f0bcbb}#youtubeSettings .profile-row{grid-template-columns:repeat(3,minmax(0,1fr))}@media(max-width:650px){#youtubeSettings .yt-steps,#youtubeSettings .profile-row{grid-template-columns:1fr}#youtubeSettings .panel-actions .btn{flex:1 1 auto;white-space:normal;min-height:44px}#youtubeSettings .yt-steps{gap:8px}#youtubeSettings .yt-steps li{padding:12px 16px}}</style>
      <div class="panel-title"><div><span class="eyebrow">Optional online connection</span><h3 id="youtubeSettingsTitle" class="integration-heading"><svg class="integration-brand" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>YouTube</h3></div><span class="meta">${pending() ? 'Authorization pending' : connected ? 'Authorization stored' : 'Not connected'}</span></div>
      <h3>Connect your own channel</h3><p class="meta">Create and edit offline. Connect YouTube when you want to upload a reviewed video privately or read your channel’s analytics. One connection is shared by projects in this local user profile.</p>
      <ol class="yt-steps" aria-label="YouTube connection steps"><li><span>01 · This computer</span><b>${status?.registrationSource === 'bundled' ? 'Ready to connect' : status?.configured ? 'Setup file saved' : 'Add your setup file'}</b><span>${status?.registrationSource === 'bundled' ? 'VYREALM includes its app registration. No API keys or Cloud project needed.' : status?.configured ? 'Your local installation is configured.' : 'This developer build needs an app registration below.'}</span></li><li><span>02 · Your account</span><b>${pending() ? 'Finish Google sign-in' : connected ? 'Account authorization saved' : 'Choose your Google account'}</b><span>Select the account or Brand Account that owns your channel.</span></li><li><span>03 · Your channel</span><b>${connected && status.channel ? 'Check the channel below' : 'Confirm the channel'}</b><span>Verify its identity before choosing a video to upload.</span></li></ol>
      <p role="status">${escape(connectionText())}</p>
      ${connected && status.channel ? `<div class="yt-channel"><span class="eyebrow">${status.verification.status === 'verified' ? 'Confirmed with YouTube' : 'Saved channel identity'}</span><strong>${escape(status.channel.title)}</strong><small>Channel ID: ${escape(status.channel.id)}</small>${status.verification.status === 'verified' ? `<small>Last checked: ${escape(status.verification.checkedAt || 'this connection')} · Access is checked again for each online action.</small>` : '<small>Verify channel to check current access with YouTube.</small>'}</div>` : ''}
      ${!connected || confirmation?.kind === 'reconnect' ? `<fieldset class="yt-permissions" ${disabled || pending() ? 'disabled' : ''}><legend>Choose what VYREALM can do</legend><label><input id="youtubeUploadPermission" type="checkbox" ${features.upload ? 'checked' : ''}><span><b>Upload reviewed videos</b><br>Request upload access. VYREALM sends only the exact film you confirm, as a private video.</span></label><label><input id="youtubeAnalyticsPermission" type="checkbox" ${features.analytics ? 'checked' : ''}><span><b>Read channel analytics</b> · optional<br>Read views and watch time. This permission does not change your videos.</span></label><p class="meta">Both options include read-only channel access to identify the channel. Google sign-in alone does not connect VYREALM.</p>${!features.upload && !features.analytics ? '<p class="meta">Choose at least one feature to connect.</p>' : ''}</fieldset>` : `<p class="meta">Upload access: ${status.upload === 'authorized-not-verified' ? 'saved' : 'permission needed'} · Analytics access: ${status.analytics === 'authorized-not-verified' ? 'saved' : 'permission needed'}. Reconnect to change permissions.</p>`}
      ${error ? `<p class="meta" role="alert">${escape(error)}</p>` : ''}${notice ? `<p class="meta" role="status">${escape(notice)}</p>` : ''}
      ${confirmation ? `<section class="yt-confirm" role="region" aria-labelledby="youtubeConfirmTitle"><h4 id="youtubeConfirmTitle">${confirmation.kind === 'reconnect' ? 'Reconnect or choose another account?' : 'Disconnect this channel?'}</h4><p class="meta">This removes saved access for <b>${escape(confirmation.title)}</b> from this local profile.${confirmation.kind === 'reconnect' ? ' Then Google opens so you can choose the same account or a different one.' : ''} Your local projects and videos stay saved.</p><div class="panel-actions"><button class="btn ghost" id="youtubeKeepChannel" type="button" ${disabled}>Keep current channel</button><button class="btn primary" id="youtubeConfirmDisconnect" type="button" ${disabled || (confirmation.kind === 'reconnect' && !features.upload && !features.analytics) ? 'disabled' : ''}>${confirmation.kind === 'reconnect' ? 'Disconnect and continue' : 'Disconnect channel'}</button></div></section>` : `<div class="panel-actions"><button class="btn primary" type="button" id="youtubeConnect" ${disabled || !canConnect ? 'disabled' : ''}>${busy === 'authorize' ? 'Preparing Google sign-in…' : connected ? 'Reconnect / change account' : 'Choose my Google account'}</button><button class="btn ghost" type="button" id="youtubeRefresh" ${disabled}>${busy === 'verify' ? 'Verifying channel…' : connected ? 'Verify channel' : 'Refresh connection'}</button>${connected || pending() ? `<button class="btn ghost" type="button" id="youtubeDisconnect" ${disabled}>${pending() ? 'Cancel sign-in' : 'Disconnect'}</button>` : ''}${pending() && authUrl ? `<button class="btn primary" type="button" id="youtubeOpenBrowser" ${disabled}>Open Google sign-in</button>` : ''}</div>`}
      ${pending() ? '<p class="meta">Choose your own account in Google, allow your selected features, then return here. If you reloaded this page, finish the open sign-in tab or cancel and start again.</p>' : ''}
      <p class="meta">Disconnect removes this profile’s saved authorization. Google Account permissions remain under your control. Creating a film never requires this connection.</p>
      <details class="yt-setup" id="youtubeDeveloper" ${setupOpen ? 'open' : ''}><summary>${status?.registrationSource === 'bundled' ? 'Advanced developer configuration' : status?.configured ? 'YouTube setup on this computer' : 'Set up YouTube on this computer'}</summary><p class="meta">${status?.registrationSource === 'bundled' ? 'You can connect above using VYREALM’s included app registration. Replacing it is optional and intended for developers.' : 'This developer installation needs a Google Desktop app setup file. It identifies the app; you choose your channel separately in Google.'}</p><ol><li>In your Google API project, enable <b>YouTube Data API v3</b>. Enable <b>YouTube Analytics API</b> if you want analytics.</li><li>Configure the app’s consent screen. If it is in testing, add your Google account as a test user.</li><li>Create an <b>OAuth client</b> with application type <b>Desktop app</b>, download its JSON file, and select it below.</li></ol><p class="meta"><a href="https://developers.google.com/youtube/registering_an_application" target="_blank" rel="noopener noreferrer">Google’s setup guide</a> · <a href="https://developers.google.com/identity/protocols/oauth2/native-app" target="_blank" rel="noopener noreferrer">Desktop app instructions</a></p><div class="field"><label for="youtubeCredentials">Choose Desktop app JSON file</label><input id="youtubeCredentials" type="file" accept=".json,application/json" ${disabled || pending() || connected || !statusReadable ? 'disabled' : ''}></div><p class="meta">${connected ? 'Disconnect the current channel before replacing the setup file. ' : ''}The file goes to this computer’s protected credential store. Credential values are never displayed or saved in browser storage.</p></details>
      <div class="yt-report"><h3>Channel analytics</h3><p class="meta">Read available daily metrics for the authorized channel. Choose up to 366 days.</p><form id="youtubeAnalyticsForm"><div class="row profile-row"><div class="field"><label for="youtubeStartDate">Start date</label><input type="date" id="youtubeStartDate" name="startDate" value="${escape(query.startDate)}" required></div><div class="field"><label for="youtubeEndDate">End date</label><input type="date" id="youtubeEndDate" name="endDate" value="${escape(query.endDate)}" required></div><div class="field"><label for="youtubeVideoId">Video ID (optional)</label><input id="youtubeVideoId" name="videoId" value="${escape(query.videoId)}" maxlength="11" pattern="[A-Za-z0-9_-]{11}" placeholder="YouTube video ID" autocomplete="off"></div></div><div class="panel-actions"><button class="btn" type="submit" ${disabled || !analyticsAllowed || pending() || !statusReadable ? 'disabled' : ''}>${busy === 'analytics' ? 'Reading analytics…' : 'Read analytics'}</button></div></form>${!analyticsAllowed ? '<p class="meta">Reconnect and select Read channel analytics to allow this report.</p>' : ''}${renderYouTubeAnalytics(report)}</div>
    </section>`;
  }

  async function perform(action, fallback, work) {
    if (busy || disposed) return;
    busy = action; error = ''; notice = ''; stopPolling();
    const current = generation;
    const active = () => !disposed && current === generation;
    paint();
    try { if (request) await request; if (active()) await work(active); }
    catch (failure) { if (!disposed && current === generation) error = guidance[failure?.code] || fallback; }
    finally { if (active()) { busy = ''; poll(); paint(); } }
  }

  function askToDisconnect(kind) {
    if(busy || !statusReadable || !status?.connected)return;
    confirmation={kind,channelId:status.channel?.id || null,title:status.channel?.title || 'the account whose channel is not yet confirmed'};
    paint();queueMicrotask(()=>globalThis.document?.getElementById('youtubeKeepChannel')?.focus());
  }

  async function openSignIn(active = () => !disposed) {
    if(!authUrl)return;
    const url=authorizationUrl(authUrl),opener=openExternal || globalThis.window?.vyrelumDesktop?.openOAuth;
    let opened=false;try{if(typeof opener==='function')opened=(await opener(url))!==false;}catch{}
    if(active())notice=opened?'Finish authorization in your system browser, then return here.':'Google sign-in is ready. Select Open Google sign-in to open it from a fresh click.';
  }

  async function beginConnection(active) {
    const selected=Object.keys(features).filter(key=>features[key]);
    if(!selected.length)throw new Error('No feature selected');
    const result=await post('/youtube/authorize',{features:selected});
    if(!active())return;
    try{authUrl=authorizationUrl(result?.authorizationUrl);await openSignIn(active);}
    finally{if(active())await update();}
  }

  async function connect() {
    if(!statusReadable || !status?.configured || pending())return;
    if(status.connected){askToDisconnect('reconnect');return;}
    return perform('authorize', 'Could not start YouTube authorization. Refresh the connection and try again.', beginConnection);
  }

  async function confirmDisconnect() {
    const chosen=confirmation;if(!chosen)return;
    return perform('disconnect','Could not disconnect YouTube. Refresh the connection and try again.',async active=>{
      const latest=publicStatus(await api('/youtube/status'));if(!active())return;
      if(!latest.connected || (latest.channel?.id || null)!==chosen.channelId){confirmation=null;await update();throw Object.assign(new Error(),{code:'YOUTUBE_CHANNEL_MISMATCH'});}
      await post('/youtube/disconnect',chosen.channelId?{expectedChannelId:chosen.channelId}:{});if(!active())return;
      report=null;authUrl='';confirmation=null;await update();
      if(!active())return;
      if(chosen.kind==='reconnect')await beginConnection(active);
      else notice='Saved account authorization was removed from this local user profile.';
    });
  }

  async function disconnect() {
    if(status?.connected){askToDisconnect('disconnect');return;}
    return perform('disconnect', 'Could not disconnect YouTube. Refresh the connection and try again.', async active => {
      await post('/youtube/disconnect');
      if (!active()) return;
      report = null; authUrl = ''; stopPolling();
      notice = 'Saved account authorization was removed from this local user profile.';
      await update();
    });
  }

  async function importCredentials(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if(status?.connected || pending() || !statusReadable)return;
    return perform('config', 'Could not import the credential file. Choose a Google Desktop app JSON file and check this installation’s protected credential store.', async active => {
      if (!/\.json$/i.test(file.name) || file.size > MAX_CREDENTIAL_BYTES) throw new Error('Invalid credential file');
      // Keep credential values only for the duration of this local request.
      let credentials;
      try {
        credentials = parseYouTubeDesktopCredentials(await file.text());
        if (!active()) return;
        await post('/youtube/config', credentials);
      } finally { credentials = null; }
      if (!active()) return;
      notice = 'Desktop app configuration was imported. You can now connect your channel.';
      await update();
    });
  }

  async function analytics() {
    if(!statusReadable || !status?.connected || status.analytics!=='authorized-not-verified' || pending())return;
    return perform('analytics', 'Could not read analytics. Check the date range and your channel’s analytics authorization, then try again.', async active => {
      const startTime = Date.parse(`${query.startDate}T00:00:00Z`), endTime = Date.parse(`${query.endDate}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(query.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(query.endDate)
        || !Number.isFinite(startTime) || !Number.isFinite(endTime) || new Date(startTime).toISOString().slice(0, 10) !== query.startDate || new Date(endTime).toISOString().slice(0, 10) !== query.endDate
        || endTime < startTime || endTime - startTime > 366 * 86400000
        || (query.videoId && !/^[A-Za-z0-9_-]{11}$/.test(query.videoId))) throw new Error('Invalid report query');
      const parameters = new URLSearchParams({ startDate: query.startDate, endDate: query.endDate });
      if (query.videoId) parameters.set('videoId', query.videoId);
      const next = await api(`/youtube/analytics?${parameters}`);
      if (active()) report = next;
    });
  }

  function unbind() { bound.forEach(([element, name]) => { element[name] = null; }); bound = []; }
  function bind(root = globalThis.document) {
    unbind();
    const panel = root?.querySelector?.('#youtubeSettings');
    if (!panel) return;
    disposed = false;
    const on = (selector, name, callback) => { const element = panel.querySelector(selector); if (element) { element[name] = callback; bound.push([element, name]); } };
    on('#youtubeConnect', 'onclick', () => connect());
    on('#youtubeRefresh', 'onclick', () => status?.connected ? perform('verify','Could not verify the channel with YouTube. Check your connection and try again.',async active=>{const result=publicStatus(await post('/youtube/verify'));if(active()){if(status?.channel?.id!==result.channel?.id || !result.connected || result.verification.status==='failed')report=null;status=result;statusReadable=true;}}) : update());
    on('#youtubeDisconnect', 'onclick', () => disconnect());
    on('#youtubeKeepChannel','onclick',()=>{confirmation=null;paint();queueMicrotask(()=>globalThis.document?.getElementById('youtubeConnect')?.focus());});
    on('#youtubeConfirmDisconnect','onclick',()=>confirmDisconnect());
    on('#youtubeOpenBrowser','onclick',()=>perform('open','Could not open Google sign-in. Cancel this attempt and try again.',openSignIn));
    for(const [selector,key] of [['#youtubeUploadPermission','upload'],['#youtubeAnalyticsPermission','analytics']])on(selector,'onchange',event=>{features[key]=event.target.checked;paint();queueMicrotask(()=>globalThis.document?.querySelector(selector)?.focus());});
    on('#youtubeCredentials', 'onchange', event => importCredentials(event.target));
    on('#youtubeDeveloper', 'ontoggle', event => { developerOpen = event.target.open; });
    for (const [selector, field] of [['#youtubeStartDate', 'startDate'], ['#youtubeEndDate', 'endDate'], ['#youtubeVideoId', 'videoId']]) {
      on(selector, 'oninput', event => { query[field] = event.target.value.trim(); });
    }
    on('#youtubeAnalyticsForm', 'onsubmit', event => { event.preventDefault(); return analytics(); });
    if (!status) void update(); else poll();
  }

  function dispose() { disposed = true; generation++; stopPolling(); unbind(); request = null; busy = ''; confirmation=null;authUrl=''; }
  return { html, bind, update, dispose };
}
