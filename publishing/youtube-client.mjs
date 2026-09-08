import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { youtubeError, YouTubeError } from './youtube-errors.mjs';

export { YouTubeError } from './youtube-errors.mjs';
export const YOUTUBE_SCOPES = Object.freeze({ upload: 'https://www.googleapis.com/auth/youtube.upload', readonly: 'https://www.googleapis.com/auth/youtube.readonly', analytics: 'https://www.googleapis.com/auth/yt-analytics.readonly' });
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const CALLBACK_PATH = '/oauth/youtube/callback';
const MAX_JSON = 1024 * 1024;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const transient = error => ['YOUTUBE_NETWORK_FAILED', 'YOUTUBE_REQUEST_TIMEOUT', 'YOUTUBE_RETRYABLE'].includes(error?.code);
const checkCancelled = signal => { if (signal?.aborted) throw youtubeError('YOUTUBE_CANCELLED', 'Operation cancelled; any upload session is retained for an explicit resume.'); };

export function validateUploadSessionUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 4096) throw new Error();
    const url = new URL(value);
    if (url.origin !== 'https://www.googleapis.com' || url.username || url.password || url.hash || url.pathname !== '/upload/youtube/v3/videos' || url.searchParams.getAll('uploadType').length !== 1 || url.searchParams.get('uploadType') !== 'resumable' || url.searchParams.getAll('upload_id').length !== 1 || !url.searchParams.get('upload_id')) throw new Error();
    return url.href;
  } catch { throw youtubeError('YOUTUBE_UNSAFE_SESSION_URL', 'Google returned an unsupported resumable upload URL. No credentials were sent to it.'); }
}

function scopesFor(features = ['upload']) {
  if (!Array.isArray(features) || !features.length || features.length > 2 || features.some(item => !['upload', 'analytics'].includes(item))) throw youtubeError('YOUTUBE_INVALID_FEATURE', 'Choose upload and/or analytics authorization.');
  return [...new Set(features.flatMap(feature => feature === 'upload' ? [YOUTUBE_SCOPES.upload, YOUTUBE_SCOPES.readonly] : [YOUTUBE_SCOPES.analytics, YOUTUBE_SCOPES.readonly]))];
}
function equalSecret(a, b) { const aa = Buffer.from(a || ''), bb = Buffer.from(b || ''); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }
function tokenRecord(json, previous, scopes, now) {
  if (!json || typeof json.access_token !== 'string' || !json.access_token || json.access_token.length > 16000 || /\s/.test(json.access_token) || String(json.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(Number(json.expires_in)) || Number(json.expires_in) <= 0 || Number(json.expires_in) > 86400) throw youtubeError('YOUTUBE_INVALID_TOKEN_RESPONSE', 'Google returned an invalid access-token response.');
  const refreshToken = json.refresh_token ?? previous?.refreshToken;
  if (refreshToken !== undefined && (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > 16000 || /\s/.test(refreshToken))) throw youtubeError('YOUTUBE_INVALID_TOKEN_RESPONSE', 'Google returned an invalid refresh-token response.');
  const granted = typeof json.scope === 'string' ? json.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? scopes;
  return { accessToken: json.access_token, ...(refreshToken ? { refreshToken } : {}), expiresAt: now + Number(json.expires_in) * 1000, scopes: granted.filter(scope => Object.values(YOUTUBE_SCOPES).includes(scope)) };
}
function receipt(upload) {
  if (!upload) return null;
  return { id: upload.id, state: upload.state, videoId: upload.videoId ?? null, channelId: upload.channelId, fileName: path.basename(upload.filePath), sha256: upload.sha256, bytesTotal: upload.size, bytesUploaded: upload.offset, createdAt: upload.createdAt, updatedAt: upload.updatedAt, privacyStatus: 'private', ...(upload.videoId ? { watchUrl: `https://www.youtube.com/watch?v=${upload.videoId}` } : {}) };
}
function normalizeMetadata(input) {
  const metadata = input.metadata;
  if (!metadata || typeof metadata.title !== 'string' || !metadata.title.trim() || [...metadata.title].length > 100 || /[<>\u0000-\u001f]/.test(metadata.title) || (metadata.description !== undefined && (typeof metadata.description !== 'string' || Buffer.byteLength(metadata.description) > 5000 || /[<>\u0000]/.test(metadata.description))) || (metadata.tags !== undefined && (!Array.isArray(metadata.tags) || metadata.tags.some(tag => typeof tag !== 'string' || !tag || /[<>\u0000-\u001f]/.test(tag)) || metadata.tags.join(',').length > 450)) || typeof input.containsSyntheticMedia !== 'boolean') throw youtubeError('YOUTUBE_INVALID_METADATA', 'A title, valid description/tags and an explicit synthetic-media disclosure are required.');
  if (metadata.publishAt || (metadata.privacyStatus && metadata.privacyStatus !== 'private')) throw youtubeError('YOUTUBE_PRIVATE_ONLY', 'This adapter uploads private videos only. Scheduling and public publication are separate actions.');
  return { snippet: { title: metadata.title.trim(), description: metadata.description ?? '', tags: metadata.tags ?? [], categoryId: '22' }, status: { privacyStatus: 'private', containsSyntheticMedia: input.containsSyntheticMedia, ...(typeof metadata.selfDeclaredMadeForKids === 'boolean' ? { selfDeclaredMadeForKids: metadata.selfDeclaredMadeForKids } : {}) } };
}
async function inspectFile(filePath, expectedHash, previous) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !/^[a-f0-9]{64}$/i.test(expectedHash || '')) throw youtubeError('YOUTUBE_INVALID_FILE', 'Upload requires an absolute local file path and its approved SHA-256.');
  let handle;
  try {
    const link = await fs.lstat(filePath); if (!link.isFile() || link.isSymbolicLink()) throw new Error();
    handle = await fs.open(filePath, 'r'); const stat = await handle.stat();
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size <= 0 || stat.size > 256 * 1024 ** 3) throw new Error();
    if (previous && (stat.size !== previous.size || stat.mtimeMs !== previous.mtimeMs)) throw youtubeError('YOUTUBE_FILE_CHANGED', 'The approved upload file has changed. Create a new approved upload.');
    const hash = crypto.createHash('sha256'); const buffer = Buffer.allocUnsafe(1024 * 1024); let position = 0;
    while (position < stat.size) { const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - position), position); if (!bytesRead) throw new Error(); hash.update(buffer.subarray(0, bytesRead)); position += bytesRead; }
    if (hash.digest('hex') !== expectedHash.toLowerCase()) throw youtubeError('YOUTUBE_FILE_CHANGED', 'The approved file hash no longer matches. No video data was uploaded.');
    const after = await handle.stat(); if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw youtubeError('YOUTUBE_FILE_CHANGED', 'The file changed during upload verification.');
    return { handle, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch (error) { await handle?.close().catch(() => {}); if (error instanceof YouTubeError) throw error; throw youtubeError('YOUTUBE_INVALID_FILE', 'The selected video file could not be read or is outside supported size limits.'); }
}
function dateValue(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN; const timestamp = Date.parse(`${value}T00:00:00Z`); return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : NaN; }

/** Optional online adapter. Construction/status make no network requests; transport and protected vault are injectable. */
export function createYouTubeClient({ clientId = '', vault, transport = globalThis.fetch, clock = () => Date.now(), sleep = (ms, signal) => delay(ms, undefined, { signal }), chunkBytes = 8 * 1024 * 1024, maxRetries = 3, requestTimeoutMs = 45000 } = {}) {
  if (!Number.isInteger(chunkBytes) || chunkBytes < 262144 || chunkBytes > 16 * 1024 * 1024 || chunkBytes % 262144) throw youtubeError('YOUTUBE_INVALID_CHUNK_SIZE', 'Upload chunks must be 256 KiB multiples, between 256 KiB and 16 MiB.');
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5 || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 120000) throw youtubeError('YOUTUBE_INVALID_LIMIT', 'Retry and request timeout limits are invalid.');
  let pendingAuthorization = null; let busy = false; let vaultWrites = Promise.resolve(); let refreshing = null;
  function configIssue() {
    if (!/^[A-Za-z0-9_-]{3,200}\.apps\.googleusercontent\.com$/.test(clientId)) return { code: 'YOUTUBE_CLIENT_NOT_CONFIGURED', diagnostic: 'Register a Google Desktop OAuth client and configure its public client ID. Offline creation needs no Google credentials.' };
    const protection = vault?.protection?.();
    if (!protection?.protected || !protection.qualified || !vault?.read || !vault?.write) return { code: 'YOUTUBE_PROTECTED_STORE_REQUIRED', diagnostic: protection?.diagnostic || 'A qualified OS-protected credential vault is required.' };
    return null;
  }
  function configured() { const issue = configIssue(); if (issue) throw youtubeError(issue.code, issue.diagnostic); }
  async function state() { configured(); const data = await vault.read(); return { ...data, uploads: data.uploads || {} }; }
  async function update(mutator) {
    const run = vaultWrites.then(async () => { const current = await state(); const result = await mutator(current); await vault.write(current); return result; });
    vaultWrites = run.catch(() => {}); return run;
  }
  async function clientFields() {
    const configuration = (await state()).oauthClient;
    return { client_id: clientId, ...(configuration?.clientId === clientId && configuration?.clientSecret ? { client_secret: configuration.clientSecret } : {}) };
  }
  async function json(response) {
    try {
      const declared = Number(response.headers.get('content-length') || 0); if (declared > MAX_JSON) throw new Error();
      const reader = response.body?.getReader(); if (!reader) return {};
      const parts = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_JSON) { await reader.cancel(); throw new Error(); } parts.push(Buffer.from(value)); } } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch { throw youtubeError('YOUTUBE_INVALID_RESPONSE', 'Google returned an invalid or oversized response.'); }
  }
  async function request(url, init, signal) {
    configured(); checkCancelled(signal);
    const parsed = new URL(url);
    const permitted = url === TOKEN_URL || (parsed.origin === 'https://www.googleapis.com' && parsed.pathname === '/youtube/v3/channels') || (parsed.origin === 'https://youtubeanalytics.googleapis.com' && parsed.pathname === '/v2/reports') || (parsed.origin === 'https://www.googleapis.com' && parsed.pathname === '/upload/youtube/v3/videos');
    if (!permitted || parsed.username || parsed.password || parsed.hash) throw youtubeError('YOUTUBE_UNSAFE_URL', 'The request destination is not an approved Google API endpoint.');
    const timeout = AbortSignal.timeout(requestTimeoutMs); const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const result = await transport(url, { ...init, redirect: 'error', signal: combined }); checkCancelled(signal);
      if (!result || !Number.isInteger(result.status) || result.redirected || (result.status >= 300 && result.status < 400 && result.status !== 308)) throw youtubeError('YOUTUBE_UNSAFE_REDIRECT', 'Google API redirects are not permitted.');
      return result;
    } catch (error) {
      if (error instanceof YouTubeError) throw error;
      checkCancelled(signal);
      if (timeout.aborted) throw youtubeError('YOUTUBE_REQUEST_TIMEOUT', 'Google request timed out. An interrupted upload can be resumed.');
      throw youtubeError('YOUTUBE_NETWORK_FAILED', 'Google could not be reached. No remote error details or credentials were logged.');
    }
  }
  async function requireToken(scopes, signal, forceRefresh = false) {
    const current = await state(); const token = current.tokens;
    if (!token) throw youtubeError('YOUTUBE_NOT_CONNECTED', 'Connect a YouTube account before using this optional online action.');
    if (scopes.some(scope => !token.scopes?.includes(scope))) throw youtubeError('YOUTUBE_SCOPE_REQUIRED', 'Reconnect with authorization for this feature.', { requiredScopes: scopes });
    if (!forceRefresh && token.expiresAt > clock() + 60000) return token.accessToken;
    if (!token.refreshToken) throw youtubeError('YOUTUBE_REAUTH_REQUIRED', 'This authorization has expired. Reconnect the YouTube account.');
    if (!refreshing) refreshing = (async () => {
      const result = await request(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...await clientFields(), grant_type: 'refresh_token', refresh_token: token.refreshToken }).toString() }, signal);
      if (result.status === 400 || result.status === 401) { await update(data => { delete data.tokens; }); throw youtubeError('YOUTUBE_REAUTH_REQUIRED', 'Google authorization was revoked or expired. Reconnect the account.'); }
      if (result.status !== 200) throw youtubeError('YOUTUBE_TOKEN_REFRESH_FAILED', 'Google could not refresh this authorization.', { httpStatus: result.status });
      const next = tokenRecord(await json(result), token, token.scopes, clock()); await update(data => { data.tokens = next; }); return next.accessToken;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function authorized(url, init, scopes, signal) {
    const token = await requireToken(scopes, signal);
    let result = await request(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } }, signal);
    if (result.status === 401) { const refreshed = await requireToken(scopes, signal, true); result = await request(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${refreshed}` } }, signal); }
    return result;
  }
  async function verifyChannel(channelId, signal) {
    const result = await authorized('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=50', { method: 'GET' }, [YOUTUBE_SCOPES.upload, YOUTUBE_SCOPES.readonly], signal);
    if (result.status !== 200) checkHttp(result);
    const list = await json(result); if (!list.items?.some(item => item.id === channelId)) throw youtubeError('YOUTUBE_CHANNEL_MISMATCH', 'The authorized account does not own the selected YouTube channel.');
  }
  function checkHttp(result) {
    if ([429, 500, 502, 503, 504].includes(result.status)) {
      const retryAfter = result.headers.get('retry-after'); const seconds = /^\d+$/.test(retryAfter || '') ? Number(retryAfter) : (Date.parse(retryAfter) - clock()) / 1000;
      throw youtubeError('YOUTUBE_RETRYABLE', 'Google asked the client to retry later.', { httpStatus: result.status, retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(60000, seconds * 1000) : 0 });
    }
    if (result.status === 404 || result.status === 410) throw youtubeError('YOUTUBE_SESSION_EXPIRED', 'The upload session expired. Explicitly start a new private upload.');
    if (result.status === 401) throw youtubeError('YOUTUBE_REAUTH_REQUIRED', 'Reconnect the YouTube account.');
    throw youtubeError('YOUTUBE_API_REJECTED', 'Google rejected the request. Check account permissions, API enablement and quota.', { httpStatus: result.status });
  }
  async function backoff(error, attempt, signal) { checkCancelled(signal); try { await sleep(Math.max(Math.min(8000, 1000 * 2 ** attempt), error.details?.retryAfterMs || 0), signal); } catch { checkCancelled(signal); throw youtubeError('YOUTUBE_CANCELLED', 'Upload retry was interrupted.'); } checkCancelled(signal); }
  async function saveUpload(upload) { upload.updatedAt = new Date(clock()).toISOString(); await update(data => { data.uploads[upload.id] = upload; }); return receipt(upload); }
  async function consumeUploadResponse(result, upload, maximumOffset = upload.size) {
    if (result.status === 200 || result.status === 201) {
      const resource = await json(result);
      if (!VIDEO_ID.test(resource.id || '') || resource.status?.privacyStatus !== 'private' || resource.snippet?.channelId !== upload.channelId) throw youtubeError('YOUTUBE_INVALID_UPLOAD_RECEIPT', 'Google did not return the expected private video and channel. Completion was not recorded.');
      upload.videoId = resource.id; upload.offset = upload.size; upload.state = 'uploaded_private'; await saveUpload(upload); return upload;
    }
    if (result.status !== 308) checkHttp(result);
    const range = result.headers.get('range'); const match = range?.match(/^bytes=0-(\d+)$/); const offset = range ? (match ? Number(match[1]) + 1 : NaN) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > maximumOffset || offset >= upload.size) throw youtubeError('YOUTUBE_INVALID_UPLOAD_RANGE', 'Google returned an invalid acknowledged byte range. Upload stopped for reconciliation.');
    upload.offset = offset; await saveUpload(upload); return upload;
  }
  async function queryUpload(upload, signal) {
    validateUploadSessionUrl(upload.sessionUri);
    for (let attempt = 0; ; attempt++) {
      try { return await consumeUploadResponse(await authorized(upload.sessionUri, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${upload.size}` }, body: Buffer.alloc(0) }, [YOUTUBE_SCOPES.upload], signal), upload); }
      catch (error) { if (!transient(error) || attempt >= maxRetries) throw error; await backoff(error, attempt, signal); }
    }
  }

  const api = {
    async configureDesktopCredentials(credentials) {
      configured(); if (busy || pendingAuthorization || refreshing) throw youtubeError('YOUTUBE_BUSY', 'Finish the active YouTube operation before changing client configuration.');
      if (!credentials?.installed || credentials.web || typeof credentials.installed !== 'object') throw youtubeError('YOUTUBE_DESKTOP_CREDENTIALS_REQUIRED', 'Import credentials registered as a Google Desktop app, not a Web application.');
      const installed = credentials.installed;
      if (installed.client_id !== clientId) throw youtubeError('YOUTUBE_CLIENT_MISMATCH', 'The Desktop credential client ID does not match the configured public client ID.');
      if (installed.client_secret !== undefined && (typeof installed.client_secret !== 'string' || !installed.client_secret || installed.client_secret.length > 4096 || /[\s\u0000-\u001f]/.test(installed.client_secret))) throw youtubeError('YOUTUBE_DESKTOP_CREDENTIALS_REQUIRED', 'The Desktop credential contains an invalid optional client secret.');
      await update(data => { data.oauthClient = { clientId, ...(installed.client_secret ? { clientSecret: installed.client_secret } : {}) }; });
      return { configured: true, clientId, secretStored: Boolean(installed.client_secret), protection: vault.protection().mechanism };
    },
    async status() {
      const issue = configIssue(); if (issue) return { connected: false, configured: false, ...issue, upload: 'unavailable', analytics: 'unavailable', online: true, store: vault?.protection?.() ?? { protected: false } };
      try { const { tokens } = await state(); const scopes = tokens?.scopes ?? []; return { configured: true, connected: Boolean(tokens), code: tokens ? 'YOUTUBE_AUTH_STORED' : 'YOUTUBE_NOT_CONNECTED', verifiedLive: false, diagnostic: tokens ? 'Authorization is stored; server-side validity is checked during an explicit online action.' : 'Connect an account to enable optional private uploads and analytics.', scopes, expiresAt: tokens?.expiresAt ?? null, refreshAvailable: Boolean(tokens?.refreshToken), upload: [YOUTUBE_SCOPES.upload, YOUTUBE_SCOPES.readonly].every(scope => scopes.includes(scope)) ? 'authorized-not-verified' : 'consent-required', analytics: [YOUTUBE_SCOPES.analytics, YOUTUBE_SCOPES.readonly].every(scope => scopes.includes(scope)) ? 'authorized-not-verified' : 'consent-required', store: vault.protection(), online: true }; }
      catch (error) { return { configured: true, connected: false, code: error.code || 'YOUTUBE_VAULT_INVALID', diagnostic: 'The protected credential store requires repair or reconnection.', upload: 'unavailable', analytics: 'unavailable', online: true }; }
    },
    async beginAuthorization({ features = ['upload'] } = {}) {
      configured(); if (pendingAuthorization || busy || refreshing) throw youtubeError('YOUTUBE_AUTH_BUSY', 'Another YouTube authorization or upload operation is active.');
      const requestedScopes = scopesFor(features); const verifier = crypto.randomBytes(48).toString('base64url'); const nonce = crypto.randomBytes(32).toString('base64url');
      const expiresAt = clock() + 10 * 60000; let consumed = false; let finished = false; let redirectUri; let timer; let settle; const controller = new AbortController();
      const completion = new Promise(resolve => { settle = resolve; });
      const server = http.createServer(); server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxConnections = 4; server.keepAliveTimeout = 1000;
      const finish = result => { if (finished) return; finished = true; clearTimeout(timer); consumed = true; if (pendingAuthorization?.server === server) pendingAuthorization = null; server.close(); settle(result); };
      const cancel = () => { if (!finished) { controller.abort(); finish({ connected: false, code: 'YOUTUBE_AUTH_CANCELLED' }); } };
      pendingAuthorization = { server, cancel };
      server.on('request', async (req, res) => {
        const reply = (status, message) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" }); res.end(message); };
        try {
          if (req.method !== 'GET' || req.headers.host !== new URL(redirectUri).host || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || (req.url?.length ?? 0) > 12000) return reply(400, 'Invalid OAuth callback.');
          const callback = new URL(req.url, redirectUri);
          if (callback.origin !== new URL(redirectUri).origin || callback.pathname !== CALLBACK_PATH || callback.searchParams.getAll('state').length !== 1 || callback.searchParams.getAll('code').length > 1 || callback.searchParams.getAll('error').length > 1 || !equalSecret(callback.searchParams.get('state'), nonce) || consumed) return reply(400, 'Invalid or already used authorization state.');
          if (clock() >= expiresAt) { reply(400, 'Authorization expired. Return to VYREALM to reconnect.'); finish({ connected: false, code: 'YOUTUBE_AUTH_EXPIRED' }); return; }
          consumed = true; clearTimeout(timer);
          if (callback.searchParams.has('error')) { reply(400, 'Authorization was not granted. Return to VYREALM.'); finish({ connected: false, code: 'YOUTUBE_AUTH_DENIED' }); return; }
          const code = callback.searchParams.get('code'); if (!code || code.length > 8192) { reply(400, 'Invalid authorization code.'); finish({ connected: false, code: 'YOUTUBE_AUTH_INVALID' }); return; }
          const result = await request(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...await clientFields(), grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }).toString() }, controller.signal);
          if (result.status !== 200) throw youtubeError('YOUTUBE_AUTH_EXCHANGE_FAILED', 'Google authorization could not be exchanged. Reconnect to try again.');
          // A newly selected account must never inherit another account's refresh token.
          const token = tokenRecord(await json(result), null, requestedScopes, clock());
          await update(data => { checkCancelled(controller.signal); if (finished) throw youtubeError('YOUTUBE_AUTH_CANCELLED', 'Authorization was cancelled.'); data.tokens = token; }); reply(200, 'YouTube authorization saved securely. Return to VYREALM.'); finish({ connected: true, code: 'YOUTUBE_AUTH_STORED', scopes: token.scopes, refreshAvailable: Boolean(token.refreshToken) });
        } catch (error) { if (!res.headersSent) reply(400, 'YouTube connection failed. Return to VYREALM for the diagnostic.'); finish({ connected: false, code: error instanceof YouTubeError ? error.code : 'YOUTUBE_AUTH_FAILED' }); }
      });
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
      catch { pendingAuthorization = null; server.close(); throw youtubeError('YOUTUBE_LOOPBACK_UNAVAILABLE', 'The local OAuth callback port could not be opened.'); }
      redirectUri = `http://127.0.0.1:${server.address().port}${CALLBACK_PATH}`;
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: requestedScopes.join(' '), state: nonce, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' }).forEach(([key, value]) => url.searchParams.set(key, value));
      timer = setTimeout(() => finish({ connected: false, code: 'YOUTUBE_AUTH_EXPIRED' }), 10 * 60000); timer.unref?.();
      return { authorizationUrl: url.href, redirectUri, expiresAt, scopes: requestedScopes, completion, cancel };
    },
    async disconnect() { configured(); if (busy || refreshing) throw youtubeError('YOUTUBE_BUSY', 'Finish or cancel the active YouTube operation before disconnecting.'); pendingAuthorization?.cancel(); await update(data => { delete data.tokens; }); return { connected: false, code: 'YOUTUBE_DISCONNECTED', diagnostic: 'Local credentials removed. Account-level revocation remains available in Google Account permissions.' }; },
    async beginPrivateUpload(input = {}) {
      configured(); if (busy || pendingAuthorization) throw youtubeError('YOUTUBE_UPLOAD_BUSY', 'Only one upload operation runs at a time; finish account authorization first.');
      if (input.confirmed !== true) throw youtubeError('YOUTUBE_UPLOAD_NOT_CONFIRMED', 'An explicit confirmation for this file and channel is required.');
      if (!CHANNEL_ID.test(input.expectedChannelId || '')) throw youtubeError('YOUTUBE_INVALID_CHANNEL', 'Select the intended YouTube channel before upload.');
      const body = normalizeMetadata(input); busy = true; let file;
      try {
        const current = await state(); if (Object.keys(current.uploads).length >= 100) throw youtubeError('YOUTUBE_UPLOAD_LIMIT', 'This vault has reached its retained-upload limit. Archive finished upload receipts before starting more.');
        file = await inspectFile(input.filePath, input.sha256); checkCancelled(input.signal);
        await verifyChannel(input.expectedChannelId, input.signal);
        const metadata = JSON.stringify(body);
        const result = await authorized(UPLOAD_URL, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Content-Length': String(Buffer.byteLength(metadata)), 'X-Upload-Content-Length': String(file.size), 'X-Upload-Content-Type': 'video/mp4' }, body: metadata }, [YOUTUBE_SCOPES.upload], input.signal);
        if (result.status !== 200 && result.status !== 201) checkHttp(result);
        const sessionUri = validateUploadSessionUrl(result.headers.get('location'));
        const now = new Date(clock()).toISOString();
        const upload = { id: crypto.randomUUID(), state: 'uploading', sessionUri, filePath: input.filePath, sha256: input.sha256.toLowerCase(), size: file.size, mtimeMs: file.mtimeMs, channelId: input.expectedChannelId, offset: 0, chunkBytes, createdAt: now, updatedAt: now };
        return await saveUpload(upload);
      } finally { await file?.handle.close(); busy = false; }
    },
    async resumeUpload(uploadId, { signal, onProgress, maxChunks = 32 } = {}) {
      configured(); checkCancelled(signal); if (busy || pendingAuthorization) throw youtubeError('YOUTUBE_UPLOAD_BUSY', 'Only one upload operation runs at a time; finish account authorization first.');
      if (!Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > 128) throw youtubeError('YOUTUBE_INVALID_LIMIT', 'Each resume call may send 1–128 bounded chunks.');
      busy = true; let file;
      try {
        const upload = (await state()).uploads[uploadId]; if (!upload) throw youtubeError('YOUTUBE_UPLOAD_NOT_FOUND', 'No retained upload session exists for this ID.');
        if (upload.state === 'uploaded_private') return receipt(upload);
        validateUploadSessionUrl(upload.sessionUri); file = await inspectFile(upload.filePath, upload.sha256, upload); checkCancelled(signal);
        await verifyChannel(upload.channelId, signal); await queryUpload(upload, signal); let chunks = 0; let failures = 0;
        while (upload.state !== 'uploaded_private' && chunks < maxChunks) {
          checkCancelled(signal); const stat = await file.handle.stat(); if (stat.size !== upload.size || stat.mtimeMs !== upload.mtimeMs) throw youtubeError('YOUTUBE_FILE_CHANGED', 'The approved file changed during upload.');
          const start = upload.offset; const length = Math.min(upload.chunkBytes, upload.size - start); const buffer = Buffer.allocUnsafe(length); const { bytesRead } = await file.handle.read(buffer, 0, length, start);
          if (bytesRead !== length) throw youtubeError('YOUTUBE_FILE_CHANGED', 'The approved file was truncated during upload.');
          try {
            const result = await authorized(upload.sessionUri, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(length), 'Content-Range': `bytes ${start}-${start + length - 1}/${upload.size}` }, body: buffer }, [YOUTUBE_SCOPES.upload], signal);
            await consumeUploadResponse(result, upload, start + length); chunks++;
            if (upload.state !== 'uploaded_private' && upload.offset <= start) throw youtubeError('YOUTUBE_RETRYABLE', 'Google acknowledged no new bytes. Rechecking upload progress.');
            failures = 0; if (onProgress) await onProgress(receipt(upload));
          } catch (error) {
            if (!transient(error) || failures >= maxRetries) throw error;
            await backoff(error, failures++, signal); await queryUpload(upload, signal);
          }
        }
        return receipt(upload);
      } finally { await file?.handle.close(); busy = false; }
    },
    async getUploadStatus(uploadId) { return receipt((await state()).uploads[uploadId]); },
    async listUploads() { return Object.values((await state()).uploads).map(receipt); },
    async channels() {
      const result = await authorized('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=50', { method: 'GET' }, [YOUTUBE_SCOPES.readonly]);
      if (result.status !== 200) checkHttp(result);
      const resource = await json(result);
      if (!Array.isArray(resource.items)) throw youtubeError('YOUTUBE_INVALID_RESPONSE', 'Google returned an invalid channel list.');
      return resource.items.filter(item => CHANNEL_ID.test(item.id || '')).map(item => ({ id: item.id, title: String(item.snippet?.title || 'YouTube channel').slice(0, 200) }));
    },
    async analytics({ startDate, endDate, videoId } = {}) {
      const start = dateValue(startDate); const end = dateValue(endDate);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 366 * 86400000 || (videoId !== undefined && !VIDEO_ID.test(videoId))) throw youtubeError('YOUTUBE_INVALID_ANALYTICS_QUERY', 'Use valid YYYY-MM-DD dates covering at most 366 days and an optional YouTube video ID.');
      const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
      Object.entries({ ids: 'channel==MINE', startDate, endDate, metrics: 'views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares', dimensions: 'day', sort: 'day', ...(videoId ? { filters: `video==${videoId}` } : {}) }).forEach(([key, value]) => url.searchParams.set(key, value));
      const result = await authorized(url.href, { method: 'GET' }, [YOUTUBE_SCOPES.analytics, YOUTUBE_SCOPES.readonly]);
      if (result.status !== 200) checkHttp(result);
      const report = await json(result); if (!Array.isArray(report.columnHeaders) || (report.rows !== undefined && !Array.isArray(report.rows))) throw youtubeError('YOUTUBE_INVALID_RESPONSE', 'Google returned an invalid analytics report.');
      return { status: 'available', source: 'youtube-analytics-api', fetchedAt: new Date(clock()).toISOString(), startDate, endDate, videoId: videoId ?? null, columnHeaders: report.columnHeaders, rows: report.rows ?? [], diagnostic: 'Results reflect data currently available from YouTube; recent days can be delayed.' };
    }
  };
  return api;
}
