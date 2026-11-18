// Exposes the few desktop-only abilities the web app needs, without giving it Node access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rubiesDesktop', {
  /** Renders the given HTML page to a PDF, asking where to save it. Resolves 'saved' or 'canceled'. */
  savePdf: (html, fileName) => ipcRenderer.invoke('rubies:save-pdf', { html, fileName }),
  /** Opens a mailto: link in the default email app. */
  openEmail: (mailto) => ipcRenderer.invoke('rubies:open-email', mailto),
});
