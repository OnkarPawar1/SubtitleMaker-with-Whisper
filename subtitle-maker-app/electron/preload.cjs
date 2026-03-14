const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('subtitleStudio', {
  isDesktop: true,
  getExportSupport: () => ipcRenderer.invoke('subtitle-studio:get-export-support'),
  saveRecording: (payload) => ipcRenderer.invoke('subtitle-studio:save-recording', payload),
  revealFile: (filePath) => ipcRenderer.invoke('subtitle-studio:reveal-file', filePath),
});
