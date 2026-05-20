const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  loadConfig: () => ipcRenderer.invoke('settings-load-config'),
  savePartialConfig: (partial) => ipcRenderer.invoke('settings-save-partial-config', partial),
  saveAndStart: (config) => ipcRenderer.send('settings-save-and-start', config),
  browseFile: (title) => ipcRenderer.invoke('settings-browse-file', title),
  checkPort: (port) => ipcRenderer.invoke('settings-check-port', port),
  checkMkcert: () => ipcRenderer.invoke('mkcert-check'),
  getMkcertCARoot: () => ipcRenderer.invoke('mkcert-get-caroot'),
  generateCert: (domains) => ipcRenderer.invoke('mkcert-generate-cert', domains),
  installCA: () => ipcRenderer.invoke('mkcert-install-ca'),
  revealFile: (filePath) => ipcRenderer.invoke('mkcert-reveal-file', filePath),
  getWhistleInfo: () => ipcRenderer.invoke('whistle-get-info'),
  setMkcertCertRule: (rootCAPath) => ipcRenderer.invoke('mkcert-set-cert-rule', rootCAPath),
  generateQRCode: (text) => ipcRenderer.invoke('generate-qrcode', text),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openInSystemBrowser: (url) => ipcRenderer.invoke('open-in-system-browser', url),
  getAppVersion: () => ipcRenderer.invoke('get-app-version')
});
