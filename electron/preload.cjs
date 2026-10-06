const { contextBridge, ipcRenderer } = require("electron")

const allowedCommands = new Set(["status", "generate"])

contextBridge.exposeInMainWorld("wyvern", {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  runCommand: (command) => {
    if (!allowedCommands.has(command)) return Promise.reject(new Error("Comando non consentito"))
    return ipcRenderer.invoke("cli:run", command)
  },
  onLog: (listener) => {
    if (typeof listener !== "function") throw new TypeError("Il listener deve essere una funzione")
    const handler = (_event, entry) => listener(entry)
    ipcRenderer.on("cli:log", handler)
    return () => ipcRenderer.removeListener("cli:log", handler)
  },
})
