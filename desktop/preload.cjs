const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vyrelumDesktop', Object.freeze({
  platform: process.platform,
  version: process.versions.electron,
  runtime: 'bundled-local',
  openExternal(url) {
    if (typeof url !== 'string' || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) return false;
    void ipcRenderer.invoke('open-local-url', url);
    return true;
  }
}));
