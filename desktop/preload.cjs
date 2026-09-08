const { contextBridge, ipcRenderer } = require('electron');

// Restore before the renderer's first refresh. Only these two non-secret UI
// preferences cross origins when another local application occupies our port.
try {
  const saved = ipcRenderer.sendSync('desktop-preferences:read');
  const validId = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
  if (validId(saved?.selectedProject)) window.localStorage.setItem('vyrelum:selectedProject', saved.selectedProject);
  else if (saved?.selectionRecorded === true && saved.selectedProject === null) window.localStorage.removeItem('vyrelum:selectedProject');
  if (['creator', 'film'].includes(saved?.workspace)) window.localStorage.setItem('vyrealm:workspace', saved.workspace);
  let previous;
  const remember = () => {
    try {
      const selectedProject = window.localStorage.getItem('vyrelum:selectedProject');
      const workspace = window.localStorage.getItem('vyrealm:workspace');
      const preferences = {};
      if (selectedProject === null || validId(selectedProject)) preferences.selectedProject = selectedProject;
      if (['creator', 'film'].includes(workspace)) preferences.workspace = workspace;
      const next = JSON.stringify(preferences);
      if (next !== previous && Object.keys(preferences).length) {
        previous = next;
        ipcRenderer.send('desktop-preferences:save', preferences);
      }
    } catch { /* denied storage must not prevent opening the studio */ }
  };
  remember();
  setInterval(remember, 500);
  window.addEventListener('pagehide', remember);
} catch { /* tests and browsers without the desktop preference channel */ }

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
