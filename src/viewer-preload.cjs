const { contextBridge, ipcRenderer } = require("electron");

// The viewer page's whole reach: the item main shows, and the few things it may ask of it.
contextBridge.exposeInMainWorld("viewer", {
  getItem: () => ipcRenderer.invoke("viewer:get-item"),
  onItem: (listener) => ipcRenderer.on("viewer:item", (_event, item) => listener(item)),
  openExternally: () => ipcRenderer.invoke("viewer:open-externally"),
  reveal: () => ipcRenderer.invoke("viewer:reveal"),
  copy: () => ipcRenderer.invoke("viewer:copy"),
  openLink: (href) => ipcRenderer.invoke("viewer:open-link", String(href || "")),
  close: () => ipcRenderer.invoke("viewer:close"),
});
