const statusButton = document.querySelector("#status-button")
const generateButton = document.querySelector("#generate-button")
const clearButton = document.querySelector("#clear-button")
const logElement = document.querySelector("#log")
const errorElement = document.querySelector("#action-error")
const versionElement = document.querySelector("#app-version")
const actionButtons = [statusButton, generateButton]

function setBusy(busy) {
  actionButtons.forEach((button) => {
    button.disabled = busy
  })
}

function appendLog(message) {
  if (logElement.textContent === "Pronto.") logElement.textContent = ""
  logElement.textContent += message
  logElement.scrollTop = logElement.scrollHeight
}

async function runCommand(command) {
  errorElement.hidden = true
  errorElement.textContent = ""
  setBusy(true)
  appendLog(`\n$ oc-setup ${command}\n`)

  try {
    await window.wyvern.runCommand(command)
    appendLog("\nOperazione completata.\n")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errorElement.textContent = message
    errorElement.hidden = false
    appendLog(`\nErrore: ${message}\n`)
  } finally {
    setBusy(false)
  }
}

statusButton.addEventListener("click", () => runCommand("status"))
generateButton.addEventListener("click", () => runCommand("generate"))
clearButton.addEventListener("click", () => {
  logElement.textContent = "Pronto."
  errorElement.hidden = true
})

window.wyvern.onLog(({ message }) => appendLog(message))
window.wyvern.getAppInfo().then(({ version, platform }) => {
  versionElement.textContent = `v${version} · ${platform}`
}).catch(() => {
  versionElement.textContent = "Versione non disponibile"
})
