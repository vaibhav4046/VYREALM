const parameters = new Set(['client_id','redirect_uri','response_type','scope','state','code_challenge','code_challenge_method','access_type','prompt']);
const scopes = new Set(['https://www.googleapis.com/auth/youtube.upload','https://www.googleapis.com/auth/youtube.readonly','https://www.googleapis.com/auth/yt-analytics.readonly']);

export function validateGoogleOAuthUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 4096) return null;
    const url = new URL(value), p = url.searchParams;
    if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password || url.hash) return null;
    if ([...p.keys()].some(key => !parameters.has(key)) || [...parameters].some(key => p.getAll(key).length !== 1)) return null;
    if (p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256' || p.get('access_type') !== 'offline' || p.get('prompt') !== 'consent') return null;
    if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(p.get('client_id')) || !/^[A-Za-z0-9_-]{43}$/.test(p.get('state')) || !/^[A-Za-z0-9_-]{43}$/.test(p.get('code_challenge'))) return null;
    const requested = p.get('scope').split(' ');
    if (!requested.length || requested.some(scope => !scopes.has(scope)) || new Set(requested).size !== requested.length || !requested.includes('https://www.googleapis.com/auth/youtube.readonly')) return null;
    const redirect = new URL(p.get('redirect_uri'));
    if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || !redirect.port || redirect.pathname !== '/oauth/youtube/callback' || redirect.username || redirect.password || redirect.search || redirect.hash) return null;
    return url.href;
  } catch { return null; }
}

export function createOAuthOpener({ getWindow, getPort, openExternal }) {
  return async (event, value) => {
    try {
      const window = getWindow(), url = validateGoogleOAuthUrl(value);
      if (!url || !window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
      const senderUrl = new URL(event.senderFrame.url);
      if (senderUrl.origin !== `http://127.0.0.1:${getPort()}` || senderUrl.username || senderUrl.password) return false;
      // Recheck activation in the owned main frame, not a renderer-supplied flag.
      if (await window.webContents.executeJavaScript('navigator.userActivation.isActive') !== true) return false;
      if (event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== senderUrl.href) return false;
      await openExternal(url);
      return true;
    } catch { return false; }
  };
}
