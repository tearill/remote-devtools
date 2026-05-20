const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openDevtools: (url, title) => ipcRenderer.send('open-devtools', { url, title }),
  openSettings: () => ipcRenderer.send('open-settings'),
  copyToClipboard: (text) => ipcRenderer.send('copy-to-clipboard', text),
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getWhistleInfo: () => ipcRenderer.invoke('whistle-get-info'),
  isElectron: true
});
