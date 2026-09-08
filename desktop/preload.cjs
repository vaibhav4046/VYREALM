const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vyrelumDesktop', Object.freeze({
  platform: process.platform,
  version: process.versions.electron,
  runtime: 'bundled-local',
  async openOAuth(url) {
    if (!navigator.userActivation?.isActive || typeof url !== 'string' || url.length > 4096) return false;
    try {
      const target = new URL(url);
      if (target.origin !== 'https://accounts.google.com' || target.pathname !== '/o/oauth2/v2/auth' || target.username || target.password || target.hash) return false;
      return await ipcRenderer.invoke('open-google-oauth', url) === true;
    } catch { return false; }
  },
  openExternal(url) {
    if (typeof url !== 'string' || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) return false;
    void ipcRenderer.invoke('open-local-url', url);
    return true;
  }
}));
