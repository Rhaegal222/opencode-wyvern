import { app, BrowserWindow, ipcMain } from "electron"
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(currentDir, "..")
const cliRoot = app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : projectRoot
const rendererPath = path.join(currentDir, "renderer", "index.html")
const rendererUrl = pathToFileURL(rendererPath).href
const allowedCommands = new Set(["status", "generate"])
let mainWindow
let activeProcess

function isTrustedSender(event) {
  return event.senderFrame?.url === rendererUrl
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: "OpenCode Wyvern",
    backgroundColor: "#f4f3ee",
    webPreferences: {
      preload: path.join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.loadFile(rendererPath)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault())
  mainWindow.on("closed", () => {
    mainWindow = undefined
  })
}

function sendLog(stream, message) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send("cli:log", { stream, message })
}

function runCli(command) {
  if (!allowedCommands.has(command)) throw new Error("Comando non consentito")
  if (activeProcess) throw new Error("Un'operazione è già in corso")

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(cliRoot, "bin", "oc-setup.js"), command], {
      cwd: app.getPath("userData"),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })

    activeProcess = child
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => sendLog("stdout", chunk))
    child.stderr.on("data", (chunk) => sendLog("stderr", chunk))
    child.once("error", (error) => {
      activeProcess = undefined
      reject(error)
    })
    child.once("close", (code) => {
      activeProcess = undefined
      if (code === 0) resolve({ code })
      else reject(new Error(`Il comando è terminato con codice ${code ?? "sconosciuto"}`))
    })
  })
}

app.whenReady().then(() => {
  ipcMain.handle("cli:run", (event, command) => {
    if (!isTrustedSender(event)) throw new Error("Origine IPC non consentita")
    return runCli(command)
  })
  ipcMain.handle("app:info", (event) => {
    if (!isTrustedSender(event)) throw new Error("Origine IPC non consentita")
    return { version: app.getVersion(), platform: process.platform }
  })
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  if (activeProcess) activeProcess.kill()
})
