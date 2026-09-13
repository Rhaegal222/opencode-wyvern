import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { keyPaths, sshConfigPath, run } from "./shell.js"
import { readTemplate, ensureDir } from "./config.js"
import { c } from "./prompts.js"

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
    defModels: [
      "auto/best-coding", "auto/best-reasoning", "auto/best-fast",
      "auto/cheap", "auto/best-free", "felo/felo-search", "felo/felo-scholar",
    ],
  },
}

export const PROVIDER_ORDER = ["copilot", "gemini", "zen", "anthropic", "openai", "omniroute"]

const MODEL_LABELS = {
  "gpt-4o": "GPT-4o", "gpt-4o-mini": "GPT-4o mini",
  "gemini-2.5-pro": "Gemini 2.5 Pro", "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.0-flash": "Gemini 2.0 Flash", "gemini-2.0-flash-lite": "Gemini 2.0 Flash Lite",
  "claude-opus-4-5": "Claude Opus 4.5", "claude-sonnet-4-5": "Claude Sonnet 4.5", "claude-haiku-4-5": "Claude Haiku 4.5",
  "gpt-5.1-codex": "GPT-5.1 Codex", "gpt-5.1": "GPT-5.1", "gpt-5-mini": "GPT-5 mini",
  "auto/best-coding": "Auto: best coding", "auto/best-reasoning": "Auto: best reasoning",
  "auto/best-fast": "Auto: best fast", "auto/cheap": "Auto: cheap", "auto/best-free": "Auto: best free",
  "felo/felo-search": "Felo: web search", "felo/felo-scholar": "Felo: academic search",
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

function providerBlock(id, models, omnirouteUrl) {
  const meta = PROVIDER_META[id]
  const block = { npm: meta.npm, name: meta.name }
  if (meta.key) block.env = [meta.key]
  if (meta.baseURL) block.options = { baseURL: meta.baseURL }
  if (meta.baseURLVar) block.options = { baseURL: omnirouteProviderUrl(omnirouteUrl) }
  block.models = meta.fixedModels
    || Object.fromEntries(models.map((m) => [m, { name: MODEL_LABELS[m] || m }]))
  return block
}

/**
 * Costruisce opencode.json dal server in modo programmatico (solo sezioni attive).
 * Nessun segreto nel JSON: le chiavi restano in .env (dichiarate con "env": [...]).
 */
export function buildServerConfig({ providers = new Set(), models = {}, omnirouteUrl = "", defaultModel, smallModel, tuning = false, plugins = [], claudeMem = false } = {}) {
  const provider = {}
  for (const id of PROVIDER_ORDER) {
    if (providers.has(id)) {
      const list = (models[id] || PROVIDER_META[id].defModels.join(", ")).split(",").map((s) => s.trim()).filter(Boolean)
      provider[providerJsonKey(id)] = providerBlock(id, list, omnirouteUrl)
    }
  }

  const plugin = [...(plugins || [])].map((p) => merchantEntry(p, omnirouteUrl))
  if (claudeMem) plugin.push("./plugins/claude-mem-plugin.js")

  const out = {
    $schema: "https://opencode.ai/config.json",
    provider,
    plugin,
  }
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
  console.log(c.cyan("[..] Genero la SSH key ed25519 (senza passphrase)..."))
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
  const target = sshTargetArgs(cfg)
  const remoteCmd =
    "umask 077; mkdir -p ~/.ssh && grep -qF '" +
    pubContent.split(" ")[0] +
    "' ~/.ssh/authorized_keys 2>/dev/null || (cat >> ~/.ssh/authorized_keys); " +
    "chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys; echo OK"

  console.log(c.cyan(`[..] Installo la chiave su ${c.bold(target.join(" "))} (password una volta)...`))
  const res = spawnSync("ssh", [...target, remoteCmd], {
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
    input: pubContent + "\n",
    timeout: 60000,
  })
  if (res.status !== 0) {
    throw new Error(`installazione chiave fallita (exit ${res.status})`)
  }
  console.log(c.green("  chiave installata."))
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
  if (fs.existsSync(p)) {
    content = fs.readFileSync(p, "utf8")
    if (content.includes(target)) return false
    if (content && !content.endsWith("\n")) content += "\n"
  }
  ensureDir(path.dirname(p))
  fs.writeFileSync(p, content + hostAliasBlock(cfg) + "\n", "utf8")
  return true
}

/** Verifica la connessione SSH senza password (BatchMode). */
export function verifyConnection(cfg) {
  const res = run("ssh", [...sshTargetArgs(cfg), "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "echo CONN_OK"], {
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
export function buildRemoteScript({ sections = new Set(), providers = new Set(), models = {}, omnirouteUrl = "", defaultModel, smallModel, tuning = false, plugins = [], claudeMem = false, envKeys = {} } = {}) {
  const esc = (s) => Buffer.from(s, "utf8").toString("base64")
  const act = (id) => sections.has(id)

  const lines = [
    "set -e",
    "log(){ echo \"[oc] $*\"; }",
    "command -v node >/dev/null || { log 'ERRORE: node non trovato sul server'; exit 2; }",
    "command -v npm  >/dev/null || { log 'ERRORE: npm non trovato sul server'; exit 2; }",
    "log \"node: $(node -v)\"",
  ]

  if (act("server")) {
    lines.push(
      "OPENCODE_BIN=\"$(command -v opencode 2>/dev/null || ls -t $HOME/.nvm/versions/node/*/bin/opencode 2>/dev/null | head -n1)\"",
      "if [ -z \"$OPENCODE_BIN\" ]; then",
      "  log 'opencode mancante: lo installo (npm i -g opencode-ai)'",
      "  npm install -g opencode-ai >/dev/null 2>&1 || true",
      "  OPENCODE_BIN=\"$(command -v opencode 2>/dev/null)\"",
      "fi",
      'CFG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"',
      'mkdir -p "$CFG_DIR/plugins" "$CFG_DIR/command"',
      'cd "$CFG_DIR"',
      '[ -f package.json ] || printf \'{\\n  "private": true,\\n  "dependencies": {}\\n}\\n\' > package.json',
      "[ -f .gitignore ] || printf 'node_modules\\n.env\\n' > .gitignore",
      `echo '${esc(readTemplate("AGENTS.md"))}' | base64 -d > "$CFG_DIR/AGENTS.md"`,
    )
  }

  if (act("commands")) {
    lines.push(`echo '${esc(readTemplate("command-baseline-ui.md"))}' | base64 -d > "$CFG_DIR/command/baseline-ui.md"`)
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

  const hasServer = act("server") || act("commands") || act("plugins") || claudeMem || providers.size > 0
  if (hasServer) {
    const json = buildServerConfig({ providers, models, omnirouteUrl, defaultModel, smallModel, tuning, plugins, claudeMem })
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

/** Esegue lo script remoto via `ssh target "echo <b64> | base64 -d | bash"`. */
export function runRemote(cfg, script) {
  const b64 = Buffer.from(script, "utf8").toString("base64")
  const remoteCmd = `printf '%s' ${b64} | base64 -d | bash`
  console.log(c.cyan("[..] Eseguo bootstrap sul server (può richiedere qualche minuto)..."))
  const res = spawnSync("ssh", [...sshTargetArgs(cfg), remoteCmd], {
    encoding: "utf8",
    stdio: ["inherit", "inherit", "inherit"],
    timeout: 600000,
  })
  return { ok: res.status === 0, status: res.status }
}

export function isPortValid(v) {
  return v === "" || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535)
}