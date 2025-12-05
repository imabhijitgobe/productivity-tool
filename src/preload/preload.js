const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, safe API to the renderer
contextBridge.exposeInMainWorld('api', {
  ping: () => 'pong from preload',
  
  // File operations
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  saveFiles: (options) => ipcRenderer.invoke('save-files', options),
  getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),
  
  // PDF operations
  mergePdfs: (options) => ipcRenderer.invoke('merge-pdfs', options),
  splitPdf: (options) => ipcRenderer.invoke('split-pdf', options),
  getPdfInfo: (options) => ipcRenderer.invoke('get-pdf-info', options),
  pdfToImages: (options) => ipcRenderer.invoke('pdf-to-images', options),
  imagesToPdf: (options) => ipcRenderer.invoke('images-to-pdf', options),
  organizePdf: (options) => ipcRenderer.invoke('organize-pdf', options),
  compressPdf: (options) => ipcRenderer.invoke('compress-pdf', options),
  protectPdf: (options) => ipcRenderer.invoke('protect-pdf', options),
  unlockPdf: (options) => ipcRenderer.invoke('unlock-pdf', options),
});
