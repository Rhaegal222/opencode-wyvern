import fs from "node:fs"
import path from "node:path"
import dns from "node:dns/promises"
import crypto from "node:crypto"
import os from "node:os"
import http from "node:http"
import https from "node:https"
import { spawnSync } from "node:child_process"
import { ensureDir } from "./config.js"
import { isWindows, opencodeConfigDir, opencodeConfigFilePath, which } from "./shell.js"
import { buildOpenCodeConfig, defaultClientOmniRouteBase } from "./server.js"
import { c } from "./prompts.js"
import { ui } from "./i18n.js"

export let CA_FINGERPRINT

export function setCaFingerprint(fingerprint) {
  CA_FINGERPRINT = fingerprint
}

export function verifyCa(pem) {
  try {
    const cert = new crypto.X509Certificate(pem)
    if (!CA_FINGERPRINT) return cert.ca
    return cert.fingerprint256 === CA_FINGERPRINT && cert.ca
  } catch {
    return false
  }
}

export function localCaPath() {
  return path.join(ensureDir(path.join(os.homedir(), ".config", "opencode-wyvern")), "custom-ca.crt")
}

export function addCustomCa({ certificatePem, filePath, platform = process.platform, home = os.homedir(), exec = spawnSync } = {}) {
  if (!verifyCa(certificatePem)) return { ok: false, code: "invalid-ca", message: ui("CA non valida.", "Invalid CA.") }
  try {
    const caPath = filePath || localCaPath()
    ensureDir(path.dirname(caPath))
    fs.writeFileSync(caPath, certificatePem, { encoding: "utf8", mode: 0o600 })
    if (platform === "win32") {
      const result = exec("setx.exe", ["NODE_EXTRA_CA_CERTS", caPath], { encoding: "utf8", stdio: "inherit", timeout: 120000, shell: false })
      if (result.status !== 0) throw new Error("setx failed")
    } else {
      const profile = path.join(home, ".profile")
      const marker = "# OpenCode Wyvern CA"
      const line = `export NODE_EXTRA_CA_CERTS=${JSON.stringify(caPath)}`
      const current = fs.existsSync(profile) ? fs.readFileSync(profile, "utf8") : ""
      const pattern = new RegExp(`(?:^|\\n)${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\nexport NODE_EXTRA_CA_CERTS=[^\\n]*(?:\\n|$)`)
      const block = `${marker}\n${line}\n`
      const next = pattern.test(current) ? current.replace(pattern, (match) => match.startsWith("\n") ? `\n${block}` : block) : `${current}${current && !current.endsWith("\n") ? "\n" : ""}${block}`
      fs.writeFileSync(profile, next, "utf8")
    }
    process.env.NODE_EXTRA_CA_CERTS = caPath
    return { ok: true, code: "installed", path: caPath, message: ui("CA installata per OpenCode; apri un nuovo terminale.", "Custom CA installed for OpenCode; open a new terminal.") }
  } catch (error) {
    return { ok: false, code: "install-failed", message: ui(`Installazione CA non riuscita: ${error.message}`, `CA installation failed: ${error.message}`) }
  }
}

function requestHealth(url, certificate, timeoutMs) {
  const client = url.protocol === "https:" ? https : http
  return new Promise((resolve, reject) => {
    const request = client.get(url, { ca: url.protocol === "https:" ? certificate : undefined, timeout: timeoutMs }, (response) => {
      response.resume()
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode })
    })
    request.once("timeout", () => request.destroy(new Error("request timeout")))
    request.once("error", reject)
  })
}

export function buildClientConfig({ omnirouteUrl = defaultClientOmniRouteBase() } = {}) {
  return buildOpenCodeConfig({
    providers: new Set(["omniroute"]),
    omnirouteUrl,
    defaultModel: "omniroute/auto/best-coding",
    smallModel: "omniroute/auto/cheap",
    plugins: ["omniroute"],
  })
}

function pluginPackage(entry) {
  return Array.isArray(entry) ? entry[0] : entry
}

export function mergeClientConfig(current, generated) {
  const managedPackages = new Set(generated.plugin.map(pluginPackage))
  const plugin = [
    ...(current.plugin || []).filter((entry) => !managedPackages.has(pluginPackage(entry))),
    ...generated.plugin,
  ]
  const provider = { ...(current.provider || {}) }
  for (const [id, value] of Object.entries(generated.provider || {})) {
    provider[id] = {
      ...(provider[id] || {}),
      ...value,
      options: { ...(provider[id]?.options || {}), ...(value.options || {}) },
      models: { ...(provider[id]?.models || {}), ...(value.models || {}) },
    }
  }
  const agent = { ...(current.agent || {}) }
  for (const [id, value] of Object.entries(generated.agent || {})) {
    agent[id] = { ...(agent[id] || {}), ...value }
  }
  return { ...current, ...generated, provider, agent, plugin }
}

export function writeClientConfig(options = {}) {
  const file = options.filePath || opencodeConfigFilePath()
  ensureDir(path.dirname(file))
  let current = {}
  if (fs.existsSync(file)) {
    try {
      current = JSON.parse(fs.readFileSync(file, "utf8"))
    } catch {
      throw new Error(ui(`config OpenCode locale non valido: ${file}`, `invalid local OpenCode config: ${file}`))
    }
  }
  const next = mergeClientConfig(current, buildClientConfig(options))
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8")
  try {
    fs.chmodSync(file, 0o600)
  } catch {}
  return file
}

export function npmInstallCommand(npmPath = which("npm")) {
  if (!npmPath) return null
  if (!isWindows()) return { command: npmPath, args: ["install", "-g", "opencode-ai"] }
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(npmPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(path.dirname(npmPath)), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean)
  const cli = candidates.find((candidate) => fs.existsSync(candidate))
  return cli ? { command: process.execPath, args: [cli, "install", "-g", "opencode-ai"] } : null
}

export function ensureLocalOpenCode({ installBinary = false } = {}) {
  const existing = which("opencode")
  if (existing) return { ok: true, installed: false, path: existing }
  const install = npmInstallCommand()
  if (!install) return { ok: false, installed: false, reason: ui("npm non trovato o non avviabile senza shell; installa Node.js/npm e poi esegui `npm install -g opencode-ai`.", "npm was not found or cannot be launched without a shell; install Node.js/npm, then run `npm install -g opencode-ai`.") }
  if (!installBinary) return { ok: false, installed: false, reason: ui("opencode non trovato; esegui `npm install -g opencode-ai` oppure riavvia il setup e abilita l'installazione.", "opencode not found; run `npm install -g opencode-ai` or rerun setup and enable installation.") }
  const result = spawnSync(install.command, install.args, { encoding: "utf8", stdio: "inherit", timeout: 600000, shell: false })
  const installed = which("opencode")
  if (result.status !== 0 || !installed) return { ok: false, installed: false, reason: ui("installazione opencode fallita; controlla permessi npm e PATH.", "opencode installation failed; check npm permissions and PATH.") }
  return { ok: true, installed: true, path: installed }
}

export function isPrivateAddress(address) {
  const normalized = address.toLowerCase()
  if (normalized.includes(":")) return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:") || normalized === "::1"
  const parts = normalized.split(".").map(Number)
  return parts.length === 4 && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] === 127)
}

export function validateClientEndpoint(baseUrl, addresses = []) {
  let url
  try {
    url = new URL(baseUrl)
  } catch {
    return { ok: false, code: "invalid-url" }
  }
  const loopbackHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]"
  if (url.protocol !== "https:" && !(loopbackHost && url.protocol === "http:")) return { ok: false, code: "https-required", url }
  if (!loopbackHost && addresses.length && !addresses.every((address) => isPrivateAddress(address))) return { ok: false, code: "vpn-private-required", url }
  return { ok: true, code: "ok", url, loopbackHost }
}

function endpointMessage(code, hostname = "") {
  if (code === "https-required") return ui("HTTPS è obbligatorio salvo endpoint loopback.", "HTTPS is required except for loopback endpoints.")
  if (code === "vpn-private-required") return ui(`Il DNS di ${hostname} non risolve esclusivamente su IP privati/VPN.`, `DNS for ${hostname} does not resolve exclusively to private/VPN addresses.`)
  return ui("URL OmniRoute locale non valido.", "Invalid local OmniRoute URL.")
}

function networkErrorMessage(error) {
  const cause = error?.cause
  const detail = [cause?.code, cause?.message, error?.message].filter(Boolean).join(": ")
  return detail || String(error)
}

export function isCertificateTrustError(error) {
  const detail = networkErrorMessage(error).toUpperCase()
  return ["SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_UNTRUSTED"].some((code) => detail.includes(code))
}

export async function diagnoseClientOmniRoute(baseUrl = defaultClientOmniRouteBase(), { timeoutMs = 5000, caPath = localCaPath() } = {}) {
  const initial = validateClientEndpoint(baseUrl)
  if (!initial.ok) return { ok: false, dns: false, health: false, code: initial.code, message: endpointMessage(initial.code) }
  let addresses
  try {
    addresses = await dns.lookup(initial.url.hostname, { all: true })
  } catch (error) {
    return { ok: false, dns: false, health: false, code: "dns-failed", addresses: [], message: ui(`DNS non disponibile per ${initial.url.hostname}: ${error.code || error.message}`, `DNS unavailable for ${initial.url.hostname}: ${error.code || error.message}`) }
  }
  const resolved = addresses.map(({ address }) => address)
  const validation = validateClientEndpoint(baseUrl, resolved)
  if (!validation.ok) return { ok: false, dns: true, health: false, code: validation.code, addresses: resolved, message: endpointMessage(validation.code, initial.url.hostname) }
  try {
    const certificate = fs.existsSync(caPath) ? fs.readFileSync(caPath, "utf8") : undefined
    let caValid = false
    if (certificate) {
      caValid = verifyCa(certificate)
    }
    // Se non c'è certificato locale o la fingerprint non combacia,
    // proponi all'utente di aggiungere una CA personalizzata
    if (!certificate || !caValid) {
      // Tentativo veloce: prova a usare la CA remota/oAuth se disponibile
      // Altrimenti lasciare caValid=false per mostrare il messaggio di errore
    }
    if (certificate && !caValid) return { ok: false, dns: true, health: false, code: "invalid-ca", addresses: resolved, message: ui("La CA locale non supera la verifica della fingerprint.", "The local CA failed fingerprint verification.") }
    const response = await requestHealth(new URL("/healthz", initial.url), certificate, timeoutMs)
    return {
      ok: response.ok,
      dns: true,
      health: response.ok,
      privateNetwork: resolved.every(isPrivateAddress),
      addresses: resolved,
      status: response.status,
      message: response.ok ? ui("DNS VPN e /healthz raggiungibili.", "VPN DNS and /healthz are reachable.") : ui(`/healthz risponde HTTP ${response.status}.`, `/healthz returned HTTP ${response.status}.`),
    }
  } catch (error) {
    const detail = networkErrorMessage(error)
    const certificateTrust = isCertificateTrustError(error)
    return { ok: false, dns: true, health: false, code: certificateTrust ? "ca-untrusted" : "health-failed", certificateTrust, addresses: resolved, message: ui(`DNS VPN risolto, ma HTTPS /healthz non è raggiungibile: ${detail}`, `VPN DNS resolved, but HTTPS /healthz is unreachable: ${detail}`) }
  }
}

export async function installLocalClient(options = {}) {
  const file = writeClientConfig(options)
  // La CA va fornita dall'utente via addCustomCa({ certificatePem }).
  const ca = { ok: false, code: "pending", message: ui("Per installare la CA, fornisci un certificato PEM valido.", "To install a CA, provide a valid PEM certificate.") }
  const binary = ensureLocalOpenCode(options)
  console.log(c.green(ui(`  config OpenCode client: ${file}`, `  client OpenCode config: ${file}`)))
  console.log((ca.ok ? c.green : c.yellow)(`  ${ca.message}`))
  if (binary.ok) console.log(c.green(ui(`  opencode locale: ${binary.path}`, `  local opencode: ${binary.path}`)))
  else console.log(c.yellow(`  ${binary.reason}`))
  return { file, ca, binary }
}
