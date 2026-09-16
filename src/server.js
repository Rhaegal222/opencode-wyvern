import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { keyPaths, sshConfigPath, run, which } from "./shell.js"
import { readTemplate, ensureDir, templatePath } from "./config.js"
import { c } from "./prompts.js"
import { ui } from "./i18n.js"

/**
 * Catalogo dei provider opencode supportati dal wizard.
 * Nuova struttura basata sulla config "golden" (nessun dato specifico:
 * le chiavi e gli endpoint sono richiesti all'utente al setup).
 */
export const PROVIDER_META = {
  copilot: {
    npm: "@ai-sdk/openai-compatible",
    name: "GitHub Copilot",
    key: null,
    defModels: ["gpt-4o", "gpt-4o-mini"],
  },
  gemini: {
    npm: "@ai-sdk/google",
    name: "Google Gemini",
    key: "GOOGLE_GENERATIVE_AI_API_KEY",
    defModels: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"],
  },
  zen: {
    npm: "@ai-sdk/openai-compatible",
    name: "OpenCode Zen",
    key: null,
    baseURL: "https://opencode.ai/zen/v1",
    defModels: ["big-pickle"],
    fixedModels: { "big-pickle": { name: "Big Pickle", reasoning: true } },
  },
  anthropic: {
    npm: "@ai-sdk/anthropic",
    name: "Anthropic Claude",
    key: "ANTHROPIC_API_KEY",
    defModels: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
  },
  openai: {
    npm: "@ai-sdk/openai",
    name: "OpenAI / Codex",
    key: "OPENAI_API_KEY",
    defModels: ["gpt-5.1-codex", "gpt-5.1", "gpt-5-mini"],
  },
  omniroute: {
    npm: "@ai-sdk/openai-compatible",
    name: "OmniRoute (aggregator)",
    key: null,
    baseURLVar: true,
    defBase: "http://127.0.0.1:20128/v1",
    defModels: [
      "auto/best-coding", "auto/best-reasoning", "auto/best-fast",
      "auto/cheap", "auto/best-free", "felo/felo-search", "felo/felo-scholar",
    ],
  },
  ollama: {
    npm: "@ai-sdk/openai-compatible",
    name: "Ollama / vLLM (locale)",
    key: null,
    baseURLVar: true,
    defBase: "http://127.0.0.1:11434/v1",
    defModels: ["qwen2.5-coder:32b", "qwen2.5-coder:7b", "llama3.1:8b", "llama3.3:70b"],
  },
}

export const PROVIDER_ORDER = ["copilot", "gemini", "zen", "anthropic", "openai", "omniroute", "ollama"]

const MODEL_LABELS = {
  "gpt-4o": "GPT-4o", "gpt-4o-mini": "GPT-4o mini",
  "gemini-2.5-pro": "Gemini 2.5 Pro", "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.0-flash": "Gemini 2.0 Flash", "gemini-2.0-flash-lite": "Gemini 2.0 Flash Lite",
  "claude-opus-4-5": "Claude Opus 4.5", "claude-sonnet-4-5": "Claude Sonnet 4.5", "claude-haiku-4-5": "Claude Haiku 4.5",
  "gpt-5.1-codex": "GPT-5.1 Codex", "gpt-5.1": "GPT-5.1", "gpt-5-mini": "GPT-5 mini",
  "auto/best-coding": "Auto: best coding", "auto/best-reasoning": "Auto: best reasoning",
  "auto/best-fast": "Auto: best fast", "auto/cheap": "Auto: cheap", "auto/best-free": "Auto: best free",
  "felo/felo-search": "Felo: web search", "felo/felo-scholar": "Felo: academic search",
  "qwen2.5-coder:32b": "Qwen2.5 Coder 32B", "qwen2.5-coder:7b": "Qwen2.5 Coder 7B",
  "llama3.1:8b": "Llama 3.1 8B", "llama3.3:70b": "Llama 3.3 70B",
}

/** Nome del provider nel JSON opencode (la chiave "opencode" è per OpenCode Zen). */
export function providerJsonKey(id) {
  return id === "zen" ? "opencode" : id
}

export function defaultOmniRouteBase() {
  return "http://127.0.0.1:20128"
}

/** Base baseURL del gateway per il blocco provider (append /v1 se manca). */
export function omnirouteProviderUrl(u) {
  const base = (u && u.trim()) || defaultOmniRouteBase()
  return base.endsWith("/v1") ? base : `${base}/v1`
}

/**
 * Calcola i modelli default: se omniroute è attivo usa i suoi alias "auto/*",
 * altrimenti il primo modello del primo provider attivo (ordine PROVIDER_ORDER).
 */
export function chooseDefaultModels(providers = new Set(), models = {}, omnirouteUrl = "") {
  if (providers.has("omniroute")) {
    return {
      defaultModel: "omniroute/auto/best-coding",
      smallModel: "omniroute/auto/best-fast",
      omnirouteUrl: omnirouteUrl || defaultOmniRouteBase(),
    }
  }
  const firstId = PROVIDER_ORDER.find((id) => providers.has(id))
  if (!firstId) return {}
  const list = ((models[firstId] || PROVIDER_META[firstId].defModels.join(", ")).split(",").map((s) => s.trim()).filter(Boolean))
  const key = providerJsonKey(firstId)
  return {
    defaultModel: `${key}/${list[0]}`,
    smallModel: list.length > 1 ? `${key}/${list[1]}` : `${key}/${list[0]}`,
  }
}

/** Mappa plugin wyvern -> nome pacchetto npm (claude-mem è gestito a parte). */
export const PLUGIN_PKG = {
  "claude-auth": "opencode-claude-auth@latest",
  "kimi": "opencode-kimi-subscription",
  "copilot-auth": "opencode-copilot-auth@latest",
  "omniroute": "@omniroute/opencode-plugin@latest",
}

function merchantEntry(p, omnirouteUrl) {
  if (p === "omniroute") {
    return [PLUGIN_PKG[p], {
      providerId: "omniroute",
      baseURL: (omnirouteUrl && omnirouteUrl.trim()) || defaultOmniRouteBase(),
      features: { combos: false, autoCombos: false, compressionMetadata: true, debugLog: false, logLevel: "error" },
      autoSyncIntervalMs: 0,
    }]
  }
  return PLUGIN_PKG[p]
}

function providerBlock(id, models, baseUrls = {}, omnirouteUrl = "") {
  const meta = PROVIDER_META[id]
  const block = { npm: meta.npm, name: meta.name }
  if (meta.key) block.env = [meta.key]
  if (meta.baseURL) block.options = { baseURL: meta.baseURL }
  if (meta.baseURLVar) {
    const url = id === "omniroute"
      ? baseUrls[id] || omnirouteProviderUrl(omnirouteUrl)
      : baseUrls[id] || meta.defBase
    block.options = { baseURL: url }
  }
  block.models = meta.fixedModels
    || Object.fromEntries(models.map((m) => [m, { name: MODEL_LABELS[m] || m }]))
  return block
}

/**
 * Preset MCP pronti da abilitare nel config server.
 *
 * Figma: Desktop MCP ufficiale (endpoint locale del Figma desktop app, Dev Mode).
 * Nessun token: l'autenticazione non serve perché il server gira su 127.0.0.1
 * dove si trova il Figma desktop aperto. L'MCP remoto ufficiale (mcp.figma.com)
 * oggi risponde 403 con opencode (allowlist client Figma non ancora aggiornata).
 */
export const MCP_PRESETS = {
  figma: {
    label: "Figma Desktop MCP — endpoint locale (Dev Mode)",
    type: "remote",
    url: "http://127.0.0.1:3845/mcp",
    oauth: false,
    enabled: true,
  },
}

/** Raggruppa i preset MCP scelti nel blocco `mcp` di opencode.json. */
export function buildMcpBlock(mcpList = []) {
  const servers = {}
  for (const id of mcpList) {
    const p = MCP_PRESETS[id]
    if (!p) continue
    const { label, ...serv } = p
    servers[id] = serv
  }
  return servers
}

/**
 * Costruisce opencode.json dal server in modo programmatico (solo sezioni attive).
 * Nessun segreto nel JSON: le chiavi restano in .env (dichiarate con "env": [...]).
 */
export function buildServerConfig({ providers = new Set(), models = {}, baseUrls = {}, omnirouteUrl = "", defaultModel, smallModel, tuning = false, plugins = [], claudeMem = false, mcpList = [] } = {}) {
  const provider = {}
  for (const id of PROVIDER_ORDER) {
    if (providers.has(id)) {
      const list = (models[id] || PROVIDER_META[id].defModels.join(", ")).split(",").map((s) => s.trim()).filter(Boolean)
      provider[providerJsonKey(id)] = providerBlock(id, list, baseUrls, omnirouteUrl)
    }
  }

  const plugin = [...(plugins || [])].map((p) => merchantEntry(p, omnirouteUrl))
  if (claudeMem) plugin.push("./plugins/claude-mem-plugin.js")

  const out = {
    $schema: "https://opencode.ai/config.json",
    provider,
    plugin,
  }
  const mcp = buildMcpBlock(mcpList || [])
  if (Object.keys(mcp).length) out.mcp = mcp
  if (defaultModel) out.model = defaultModel
  if (smallModel) out.small_model = smallModel
  if (tuning) {
    out.tool_output = { max_lines: 200, max_bytes: 8192 }
    out.compaction = { auto: true, prune: true, tail_turns: 5, preserve_recent_tokens: 12000, reserved: 525000 }
  }
  return out
}

/** Genera la chiave SSH ed25519 locale se non esiste (mai passphrase). */
export function ensureLocalKey() {
  const { key, pub } = keyPaths()
  ensureDir(path.dirname(key)) // ~/.ssh
  if (fs.existsSync(key) && fs.existsSync(pub)) {
    return { key, pub, created: false }
  }
  console.log(c.cyan(ui("[..] Genero la SSH key ed25519 (senza passphrase)...", "[..] Generating the ed25519 SSH key (no passphrase)...")))
  const gen = spawnSync("ssh-keygen", ["-t", "ed25519", "-C", "", "-f", key, "-N", ""], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  if (gen.status !== 0) {
    throw new Error(`ssh-keygen fallito: ${(gen.stderr || "").toString().trim()}`)
  }
  return { key, pub, created: true }
}

/**
 * Installa la chiave pubblica sul server. Chiede la password via TTY
 * (stdio ereditato); il contenuto della chiave passa dallo stdin del child.
 */
export function installKeyOnServer(cfg) {
  const { pub } = keyPaths()
  const pubContent = fs.readFileSync(pub, "utf8").trim()
  const pubB64 = Buffer.from(pubContent, "utf8").toString("base64")
  const target = sshTargetArgs(cfg)
  const remoteCmd =
    `umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; ` +
    `PUB="$(printf '%s' '${pubB64}' | base64 -d)"; ` +
    `grep -qxF "$PUB" ~/.ssh/authorized_keys 2>/dev/null || printf '%s\\n' "$PUB" >> ~/.ssh/authorized_keys; ` +
    "chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys; echo OK"

  console.log(c.cyan(ui(
    `[..] Installo la chiave su ${c.bold(target.join(" "))} (password una volta)...`,
    `[..] Installing the key on ${c.bold(target.join(" "))} (one-time password)...`,
  )))
  const res = spawnSync("ssh", [...target, remoteCmd], {
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
    input: pubContent + "\n",
    timeout: 60000,
  })
  if (res.status !== 0) {
    throw new Error(`installazione chiave fallita (exit ${res.status})`)
  }
  console.log(c.green(ui("  chiave installata.", "  key installed.")))
}

export function sshTargetArgs({ user, host, port }) {
  const target = user ? `${user}@${host}` : host
  return port && port !== "" && String(port) !== "22" ? ["-p", String(port), target] : [target]
}

/** Riga Host alias per ~/.ssh/config. */
export function hostAliasBlock(cfg) {
  const parts = [`Host ${cfg.server}`]
  if (cfg.host) parts.push(`    HostName ${cfg.host}`)
  if (cfg.user) parts.push(`    User ${cfg.user}`)
  if (cfg.port && String(cfg.port) !== "22") parts.push(`    Port ${cfg.port}`)
  parts.push("    IdentityFile ~/.ssh/id_ed25519")
  parts.push("    IdentitiesOnly yes")
  parts.push("    ServerAliveInterval 30")
  parts.push("    ServerAliveCountMax 5")
  parts.push("    StrictHostKeyChecking accept-new")
  return parts.join("\n")
}

export function ensureSshConfigAlias(cfg) {
  if (!cfg.host) return false // nessun host: l'utente usa la propria ~/.ssh/config
  const p = sshConfigPath()
  const target = `Host ${cfg.server}`
  let content = ""
  const nextBlock = hostAliasBlock(cfg)
  if (fs.existsSync(p)) {
    content = fs.readFileSync(p, "utf8")
    const re = new RegExp(`(^|\\n)Host\\s+${cfg.server.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n(?:[ \\t].*(?:\\n|$))*`, "m")
    if (re.test(content)) {
      const updated = content.replace(re, (m, lead = "") => `${lead}${nextBlock}\n`)
      if (updated === content) return false
      fs.writeFileSync(p, updated, "utf8")
      return true
    }
    if (content && !content.endsWith("\n")) content += "\n"
  }
  ensureDir(path.dirname(p))
  fs.writeFileSync(p, content + nextBlock + "\n", "utf8")
  return true
}

/** Verifica la connessione SSH senza password (BatchMode). */
export function verifyConnection(cfg) {
  const { key } = keyPaths()
  const target = cfg.server || sshTargetArgs(cfg).at(-1)
  const targetArgs = cfg.server ? [] : sshTargetArgs(cfg).slice(0, -1)
  const keyArgs = fs.existsSync(key) ? ["-i", key, "-o", "IdentitiesOnly=yes"] : []
  const res = run("ssh", [
    ...targetArgs,
    ...keyArgs,
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=8",
    target,
    "echo CONN_OK",
  ], {
    silent: true,
    timeout: 20000,
  })
  return res.ok && res.stdout.includes("CONN_OK")
}

/**
 * Costruisce lo script bash remoto, componendo SOLO le sezioni attive.
 * I file vengono trasferiti come base64 (niente escaping/quoting, nessuna injection).
 * I segreti (API key) finiscono solo in .env (chmod 600) quando la sezione providers
 * è attiva e l'utente ne ha fornite.
 */
export function buildRemoteScript({ sections = new Set(), providers = new Set(), models = {}, baseUrls = {}, omnirouteUrl = "", defaultModel, smallModel, tuning = false, plugins = [], claudeMem = false, envKeys = {}, customCommands = [], mcpList = [] } = {}) {
  const esc = (s) => Buffer.from(s, "utf8").toString("base64")
  const act = (id) => sections.has(id)

  const lines = [
    "set -e",
    "log(){ echo \"[oc] $*\"; }",
    "command -v node >/dev/null || { log 'ERRORE: node non trovato sul server'; exit 2; }",
    "command -v npm  >/dev/null || { log 'ERRORE: npm non trovato sul server'; exit 2; }",
    "log \"node: $(node -v)\"",
    'CFG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"',
    'mkdir -p "$CFG_DIR/plugins" "$CFG_DIR/command"',
    'cd "$CFG_DIR"',
  ]

  if (act("server")) {
    lines.push(
      "OPENCODE_BIN=\"$(command -v opencode 2>/dev/null || ls -t $HOME/.nvm/versions/node/*/bin/opencode 2>/dev/null | head -n1)\"",
      "if [ -z \"$OPENCODE_BIN\" ]; then",
      "  log 'opencode mancante: lo installo (npm i -g opencode-ai)'",
      "  npm install -g opencode-ai >/dev/null 2>&1 || true",
      "  OPENCODE_BIN=\"$(command -v opencode 2>/dev/null || ls -t $HOME/.nvm/versions/node/*/bin/opencode 2>/dev/null | head -n1)\"",
      "fi",
      '[ -f package.json ] || printf \'{\\n  "private": true,\\n  "dependencies": {}\\n}\\n\' > package.json',
      "[ -f .gitignore ] || printf 'node_modules\\n.env\\n' > .gitignore",
      `echo '${esc(readTemplate("AGENTS.md"))}' | base64 -d > "$CFG_DIR/AGENTS.md"`,
    )
  }

  if (act("commands")) {
    const cmds = (customCommands && customCommands.length ? customCommands : ["baseline-ui"])
    for (const id of cmds) {
      const tpl = `command-${id}.md`
      if (fs.existsSync(templatePath(tpl))) {
        lines.push(`echo '${esc(readTemplate(tpl))}' | base64 -d > "$CFG_DIR/command/${id}.md"`)
      }
    }
  }

  if (act("mcp")) {
    const mcpIds = (mcpList || []).filter((id) => MCP_PRESETS[id])
    if (mcpIds.length) {
      lines.push(`log "MCP: ${mcpIds.join(", ")}"`)
      lines.push(
        "grep -vE '^((FIGMA_API_KEY|PATH)=)' \"$CFG_DIR/.env\" > \"$CFG_DIR/.env.tmp\" 2>/dev/null || true",
        'mv "$CFG_DIR/.env.tmp" "$CFG_DIR/.env" 2>/dev/null || true',
        'chmod 600 "$CFG_DIR/.env" 2>/dev/null || true',
      )
    }
  }

  if (claudeMem) {
    lines.push(
      "log 'claude-mem: installo opcode-mem + wrapper plugins/claude-mem-plugin.js'",
      "npm install opcode-mem@latest >/dev/null 2>&1 || true",
      `echo '${esc(readTemplate("claude-mem-plugin.js"))}' | base64 -d > "$CFG_DIR/plugins/claude-mem-plugin.js"`,
    )
  }

  const providerNpm = [...new Set([...providers].map((id) => PROVIDER_META[id]?.npm).filter(Boolean))]
  if (providerNpm.length) lines.push(`npm install ${providerNpm.join(" ")} >/dev/null 2>&1 || true`)

  const pluginPkgs = [...new Set((plugins || []).map((p) => PLUGIN_PKG[p]).filter(Boolean))]
  if (pluginPkgs.length) lines.push(`npm install ${pluginPkgs.join(" ")} >/dev/null 2>&1 || true`)

  const hasServer = act("server") || act("commands") || act("plugins") || claudeMem || providers.size > 0 || (mcpList && mcpList.filter((id) => MCP_PRESETS[id]).length > 0)
  if (hasServer) {
    const json = buildServerConfig({ providers, models, baseUrls, omnirouteUrl, defaultModel, smallModel, tuning, plugins, claudeMem, mcpList })
    lines.push(`echo '${esc(JSON.stringify(json, null, 2))}' | base64 -d > "$CFG_DIR/opencode.json"`)
  }

  const keyEntries = Object.entries(envKeys || {}).filter(([, v]) => v)
  if (act("providers") && keyEntries.length) {
    lines.push("umask 077")
    lines.push("printf '' > \"$CFG_DIR/.env\"")
    for (const [k, v] of keyEntries) {
      lines.push(`echo '${esc(`${k}="${v}"`)}' | base64 -d >> "$CFG_DIR/.env"`)
    }
    lines.push("chmod 600 \"$CFG_DIR/.env\"")
  } else if (act("server")) {
    lines.push("umask 077; [ -f \"$CFG_DIR/.env\" ] || : > \"$CFG_DIR/.env\"")
  }

  lines.push('log "config opencode scritta in: $CFG_DIR"')
  lines.push("[ -n \"$OPENCODE_BIN\" ] && \"$OPENCODE_BIN\" --version && echo REMOTE_OK || echo REMOTE_NO_OPENCODE")
  return lines.join("\n")
}

/**
 * Ripara chirurgicamente l'opencode.json remoto: rimuove il vecchio MCP
 * `figma-developer` (npx + token) e porta `figma` al Figma Desktop MCP
 * (remote, 127.0.0.1:3845). Non tocca gli altri server MCP (cloudflare,
 * ecc.) e non riscrive l'intero file. Eseguito via SSH da `oc-setup repair`
 * / `generate`, oppure in locale con `applyMode local`.
 */
export function buildMcpRepairScript() {
  const esc = (s) => Buffer.from(s, "utf8").toString("base64")
  const js = `
const fs = require("fs");
const path = require("path");
const cfgDir = process.env.OPENCODE_CONFIG_DIR || path.join(process.env.HOME || ".", ".config", "opencode");
const file = path.join(cfgDir, "opencode.json");
if (!fs.existsSync(file)) { console.log("REPAIR_SKIP: opencode.json assente"); process.exit(0); }
let data;
try { data = JSON.parse(fs.readFileSync(file, "utf8")); }
catch (e) { console.log("REPAIR_SKIP: opencode.json non valido (" + e.message + ")"); process.exit(0); }
const mcp = data.mcp || (data.mcp = {});
const DESKTOP = { type: "remote", url: "http://127.0.0.1:3845/mcp", oauth: false, enabled: true };
const nested = (mcp.servers && typeof mcp.servers === "object" && !Array.isArray(mcp.servers)) ? mcp.servers : null;
const removeKey = (obj, k) => { if (obj && Object.prototype.hasOwnProperty.call(obj, k)) { delete obj[k]; return true; } return false; };
let changed = false;
if (removeKey(mcp, "figma-developer")) { console.log("REPAIR: rimosso mcp.figma-developer"); changed = true; }
// Figma va messo direttamente sotto mcp, nello stesso formato dei server esistenti
// (es. cloudflare). Se c'era la forma annidata "mcp.servers", la si appiattisce.
if (nested) {
  for (const k of Object.keys(nested)) {
    if (k !== "figma-developer" && !Object.prototype.hasOwnProperty.call(mcp, k)) { mcp[k] = nested[k]; changed = true; }
  }
  delete mcp.servers;
  console.log("REPAIR: appiattito mcp.servers in mcp");
  changed = true;
}
if (!mcp.figma || JSON.stringify(mcp.figma) !== JSON.stringify(DESKTOP)) {
  mcp.figma = DESKTOP; console.log("REPAIR: figma allineato al Desktop MCP"); changed = true;
}
const cleanEnv = (envFile) => {
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, "utf8").split(/\\r?\\n/).filter((l) => l && !l.startsWith("FIGMA_API_KEY=") && !l.startsWith("PATH="));
  fs.writeFileSync(envFile, lines.length ? lines.join("\\n") + "\\n" : "");
};
cleanEnv(path.join(cfgDir, ".env"));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\\n");
console.log("REPAIR_OK");
`
  const lines = [
    "set -e",
    'CFG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"',
    "mkdir -p \"$CFG_DIR\"",
    `printf '%s' ${esc(js)} | base64 -d > "$CFG_DIR/.oc-repair.cjs"`,
    "node \"$CFG_DIR/.oc-repair.cjs\"",
    "rm -f \"$CFG_DIR/.oc-repair.cjs\"",
    "echo REPAIR_DONE",
  ]
  return lines.join("\n")
}

/** Esegue lo script remoto via `ssh target "echo <b64> | base64 -d | bash"`. */
export function runRemote(cfg, script, { label } = {}) {
  const b64 = Buffer.from(script, "utf8").toString("base64")
  const remoteCmd = `printf '%s' ${b64} | base64 -d | bash`
  console.log(c.cyan(ui(
    label || "[..] Eseguo bootstrap sul server (può richiedere qualche minuto)...",
    label || "[..] Running bootstrap on the server (may take a few minutes)...",
  )))
  const res = spawnSync("ssh", [...sshTargetArgs(cfg), remoteCmd], {
    encoding: "utf8",
    stdio: ["inherit", "inherit", "inherit"],
    timeout: 600000,
  })
  return { ok: res.status === 0, status: res.status }
}

/**
 * Esegue lo script di setup in locale, direttamente sulla macchina server
 * ("server-only in localhost"): niente SSH, i file finiscono in ~/.config/opencode.
 * Richiede bash sulla macchina (Linux/macOS, oppure Git Bash/WSL su Windows).
 */
export function runScriptLocal(script, { label } = {}) {
  const bash = which("bash")
  if (!bash) {
    throw new Error(ui(
      "server-only locale richiede bash su questa macchina (esegui il wizard direttamente dentro il server, Linux/macOS o Git Bash/WSL).",
      "server-only local requires bash on this machine (run the wizard directly on the server, Linux/macOS or Git Bash/WSL).",
    ))
  }
  console.log(c.cyan(ui(
    label || "[..] Eseguo bootstrap in locale su questa macchina (può richiedere qualche minuto)...",
    label || "[..] Running bootstrap locally on this machine (may take a few minutes)...",
  )))
  const env = { ...process.env }
  // Conversione HOME in path POSIX (Git Bash/MSYS2 su Windows); su Linux resta com'è.
  const rawHome = env.HOME || env.USERPROFILE
  if (rawHome && /^[A-Za-z]:[\\/]/.test(rawHome)) {
    const drive = rawHome[0].toLowerCase()
    env.HOME = `/${drive}/${rawHome.slice(2).replace(/\\/g, "/")}`
  }
  const res = spawnSync(bash, ["-c", script], {
    encoding: "utf8",
    stdio: ["inherit", "inherit", "inherit"],
    timeout: 600000,
    env,
  })
  return { ok: res.status === 0, status: res.status }
}

export function isPortValid(v) {
  return v === "" || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535)
}
