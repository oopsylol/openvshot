const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openvshot", {
  runCli: (payload) => ipcRenderer.invoke("cli:exec", payload),
  pickDirectory: () => ipcRenderer.invoke("dialog:pick-directory"),
  pickImageFile: () => ipcRenderer.invoke("dialog:pick-image-file"),
  openDevtools: () => ipcRenderer.invoke("app:open-devtools"),
  readFileAsDataUrl: (filePath) => ipcRenderer.invoke("file:read-data-url", { filePath }),
});
