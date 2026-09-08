const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const MAX_CREDENTIAL_BYTES = 64 * 1024;
const AUTH_PHASES = new Set(['idle', 'pending', 'connected', 'failed', 'cancelled']);

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
    connected: source.connected === true,
    channel: channel && typeof channel.id === 'string' ? { id: channel.id.slice(0, 200), title: String(channel.title || channel.id).slice(0, 500) } : null,
    analytics: source.analytics,
    auth: { phase: AUTH_PHASES.has(source.auth?.phase) ? source.auth.phase : 'idle', code: typeof source.auth?.code === 'string' ? source.auth.code : '' },
    code: typeof source.code === 'string' ? source.code : '',
  };
}

function authorizationUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid authorization URL'); }
  if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password || url.hash) throw new Error('Invalid authorization URL');
  return url.href;
}

/** One local-user account connection. api uses the app's fetch-style options. */
export function createYouTubeSettings({ api, render = () => {}, openExternal, getProject } = {}) {
  if (typeof api !== 'function') throw new TypeError('YouTube settings require the local API function.');
  let status = null, busy = '', error = '', notice = '', report = null;
  let timer = null, request = null, disposed = false, generation = 0, bound = [];
  let developerOpen = false;
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
        if (!next.connected || status?.channel?.id !== next.channel?.id) report = null;
        status = next;
        if (error === 'Could not read YouTube connection status. Try refreshing the connection.') error = '';
        if (!pending() && notice === 'Finish authorization in your system browser, then return here.') notice = '';
        if (changed || error !== previousError || notice !== previousNotice) paint();
      } catch {
        if (disposed || current !== generation) return;
        error = 'Could not read YouTube connection status. Try refreshing the connection.';
        paint();
      } finally {
        if (current === generation) { request = null; poll(); }
      }
    })();
    return request;
  }

  function connectionText() {
    if (!status) return 'Reading local connection status…';
    if (pending()) return 'Waiting for authorization in your system browser.';
    if (status.connected && status.channel) return `Authorized channel: ${status.channel.title}`;
    if (status.connected) return 'Authorization is stored. Channel identity has not been confirmed.';
    if (status.auth.phase === 'failed') return 'Authorization did not complete. Try connecting again.';
    if (status.auth.phase === 'cancelled') return 'Authorization was cancelled.';
    if (status.code === 'YOUTUBE_PROTECTED_STORE_REQUIRED' || status.code === 'YOUTUBE_VAULT_INVALID') return 'Protected credential storage is unavailable. Repair this installation before connecting YouTube.';
    if (!status.configured) return 'YouTube connection needs first-install configuration.';
    return 'No YouTube account is connected.';
  }

  function html() {
    const connected = status?.connected === true;
    const disabled = busy ? 'disabled' : '';
    const analyticsAllowed = connected && status.analytics !== 'consent-required' && status.analytics !== 'unavailable';
    return `<section id="youtubeSettings" class="panel" aria-labelledby="youtubeSettingsTitle">
      <div class="panel-title"><div><span class="eyebrow">Optional online connection</span><h3 id="youtubeSettingsTitle">YouTube</h3></div><span class="meta">${pending() ? 'Authorization pending' : connected ? 'Authorization stored' : 'Not connected'}</span></div>
      <p class="meta">One YouTube connection is shared by projects in this local user profile.</p>
      <p role="status">${escape(connectionText())}</p>
      ${connected && status.channel ? `<p class="meta">Channel ID: <span>${escape(status.channel.id)}</span></p>` : ''}
      <p class="meta">Signing in to Google in a browser does not connect VYREALM. Authorize this app to grant private-upload and read-only analytics access.</p>
      ${error ? `<p class="meta" role="alert">${escape(error)}</p>` : ''}${notice ? `<p class="meta" role="status">${escape(notice)}</p>` : ''}
      <div class="panel-actions"><button class="btn primary" type="button" id="youtubeConnect" ${disabled || !status?.configured || pending() ? 'disabled' : ''}>${busy === 'authorize' ? 'Opening browser…' : connected ? 'Reconnect YouTube' : 'Connect YouTube'}</button><button class="btn ghost" type="button" id="youtubeRefresh" ${disabled}>Refresh connection</button>${connected || pending() ? `<button class="btn ghost" type="button" id="youtubeDisconnect" ${disabled}>${pending() ? 'Cancel connection' : 'Disconnect'}</button>` : ''}</div>
      <p class="meta">Connection status reflects saved authorization. Google checks access when you request an online action. Disconnect removes the saved account authorization from this profile.</p>
      <details id="youtubeDeveloper" ${developerOpen ? 'open' : ''} style="margin-top:20px"><summary class="meta">Developer setup · first-install configuration</summary><p class="meta">If this installation has no OAuth configuration, import the credential JSON for a Google Desktop app with the YouTube Data and Analytics APIs enabled. This is developer configuration, separate from connecting your channel.</p><div class="field"><label for="youtubeCredentials">Desktop app credential JSON</label><input id="youtubeCredentials" type="file" accept=".json,application/json" ${disabled || pending() ? 'disabled' : ''}></div><p class="meta">The file is sent to the local protected credential store. Credential values are never displayed or saved in browser storage.</p></details>
      <div style="margin-top:28px"><h3>Channel analytics</h3><p class="meta">Read available daily metrics for the authorized channel. Choose up to 366 days.</p><form id="youtubeAnalyticsForm"><div class="row profile-row"><div class="field"><label for="youtubeStartDate">Start date</label><input type="date" id="youtubeStartDate" name="startDate" value="${escape(query.startDate)}" required></div><div class="field"><label for="youtubeEndDate">End date</label><input type="date" id="youtubeEndDate" name="endDate" value="${escape(query.endDate)}" required></div><div class="field"><label for="youtubeVideoId">Video ID (optional)</label><input id="youtubeVideoId" name="videoId" value="${escape(query.videoId)}" maxlength="11" pattern="[A-Za-z0-9_-]{11}" placeholder="YouTube video ID" autocomplete="off"></div></div><div class="panel-actions"><button class="btn" type="submit" ${disabled || !analyticsAllowed || pending() ? 'disabled' : ''}>${busy === 'analytics' ? 'Reading analytics…' : 'Read analytics'}</button></div></form>${!analyticsAllowed ? '<p class="meta">Connect YouTube with analytics access to read this report.</p>' : ''}${renderYouTubeAnalytics(report)}</div>
    </section>`;
  }

  async function perform(action, fallback, work) {
    if (busy || disposed) return;
    busy = action; error = ''; notice = ''; stopPolling();
    const current = generation;
    const active = () => !disposed && current === generation;
    paint();
    try { if (request) await request; if (active()) await work(active); }
    catch { if (!disposed && current === generation) error = fallback; }
    finally { if (active()) { busy = ''; poll(); paint(); } }
  }

  async function connect() {
    return perform('authorize', 'Could not start YouTube authorization or open the system browser. Refresh the connection and try again.', async active => {
      const result = await post('/youtube/authorize', { features: ['upload', 'analytics'] });
      if (!active()) return;
      try {
        const url = authorizationUrl(result?.authorizationUrl);
        const opener = openExternal || globalThis.window?.vyrelumDesktop?.openOAuth;
        if (typeof opener !== 'function') throw new Error('System-browser opener unavailable');
        const opened = await opener(url);
        if (opened === false) throw new Error('System browser did not open');
        if (active()) notice = 'Finish authorization in your system browser, then return here.';
      } finally { if (active()) await update(); }
    });
  }

  async function disconnect() {
    return perform('disconnect', 'Could not disconnect YouTube. Refresh the connection and try again.', async active => {
      await post('/youtube/disconnect');
      if (!active()) return;
      report = null; stopPolling();
      notice = 'Saved account authorization was removed from this local user profile.';
      await update();
    });
  }

  async function importCredentials(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
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
    on('#youtubeRefresh', 'onclick', () => update());
    on('#youtubeDisconnect', 'onclick', () => disconnect());
    on('#youtubeCredentials', 'onchange', event => importCredentials(event.target));
    on('#youtubeDeveloper', 'ontoggle', event => { developerOpen = event.target.open; });
    for (const [selector, field] of [['#youtubeStartDate', 'startDate'], ['#youtubeEndDate', 'endDate'], ['#youtubeVideoId', 'videoId']]) {
      on(selector, 'oninput', event => { query[field] = event.target.value.trim(); });
    }
    on('#youtubeAnalyticsForm', 'onsubmit', event => { event.preventDefault(); return analytics(); });
    if (!status) void update(); else poll();
  }

  function dispose() { disposed = true; generation++; stopPolling(); unbind(); request = null; busy = ''; }
  return { html, bind, update, dispose };
}
