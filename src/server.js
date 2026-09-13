import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { keyPaths, sshConfigPath, run } from "./shell.js"
import { readTemplate, ensureDir } from "./config.js"
import { c } from "./prompts.js"

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
  parts.push("    StrictHostKeyChecking accept-new")
  return parts.join("\n")
}

export function ensureSshConfigAlias(cfg) {
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

/** Costruisce opencode.json dal server in modo programmatico (solo sezioni attive). */
export function buildServerConfig({ providers = new Set(), geminiModels, zenModels, plugins = [], claudeMem = false, defaultModelId } = {}) {
  const provider = {}

  if (providers.has("gemini")) {
    const ids = (geminiModels || "gemini-2.5-pro, gemini-2.5-flash").split(",").map((s) => s.trim()).filter(Boolean)
    const modelsG = Object.fromEntries(ids.map((m) => [m, { name: m }]))
    provider.google = {
      npm: "@ai-sdk/google",
      options: {
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        apiKey: "{env:GOOGLE_API_KEY}",
      },
      models: modelsG,
    }
  }
  if (providers.has("zen")) {
    const ids = (zenModels || "opencode-zen-2.5-pro").split(",").map((s) => s.trim()).filter(Boolean)
    const modelsZ = Object.fromEntries(ids.map((m) => [m, { name: m }]))
    provider.zen = {
      npm: "@openai/openai-provider",
      options: {
        baseURL: "https://opencode.ai/api/v1",
        apiKey: "{env:ZEN_API_KEY}",
      },
      models: modelsZ,
    }
  }

  const plugin = [...(plugins || [])]
  if (claudeMem) plugin.push("./plugins/claude-mem-plugin.js")

  const out = {
    $schema: "https://opencode.ai/config.json",
    provider,
    plugin,
  }
  if (defaultModelId) out.model = defaultModelId
  return out
}

/**
 * Costruisce lo script bash remoto, componendo SOLO le sezioni attive.
 * I file vengono trasferiti come base64 (niente escaping/quoting, nessuna injection).
 */
export function buildRemoteScript({ sections = new Set(), providers = new Set(), geminiModels, zenModels, plugins = [], claudeMem = false, envKeys = {}, defaultModelId } = {}) {
  const esc = (s) => Buffer.from(s, "utf8").toString("base64")
  const act = (id) => sections.has(id)

  const lines = [
    "set -e",
    'log(){ echo "[oc] $*"; }',
    "command -v node >/dev/null || { log 'ERRORE: node non trovato sul server'; exit 2; }",
    "command -v npm  >/dev/null || { log 'ERRORE: npm non trovato sul server'; exit 2; }",
    `log "node: $(node -v)"`,
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
      `echo '${esc(readTemplate("AGENTS.md"))}' | base64 -d > "$CFG_DIR/AGENTS.md"`
    )
  }

  if (act("commands")) {
    lines.push(`echo '${esc(readTemplate("command-baseline-ui.md"))}' | base64 -d > "$CFG_DIR/command/baseline-ui.md"`)
  }

  if (claudeMem) {
    lines.push(
      "log 'claude-mem: installo opcode-mem'",
      "npm install opcode-mem@latest >/dev/null 2>&1 || true",
      `echo '${esc(readTemplate("claude-mem-plugin.js"))}' | base64 -d > "$CFG_DIR/plugins/claude-mem-plugin.js"`
    )
  }

  if (providers.has("gemini")) lines.push("npm install @ai-sdk/google >/dev/null 2>&1 || true")
  if (providers.has("zen")) lines.push("npm install @openai/openai-provider >/dev/null 2>&1 || true")

  const hasServer = act("server") || act("commands") || act("plugins") || claudeMem || providers.size > 0
  if (hasServer) {
    const json = buildServerConfig({ providers, geminiModels, zenModels, plugins, claudeMem, defaultModelId })
    lines.push(`echo '${esc(JSON.stringify(json, null, 2))}' | base64 -d > "$CFG_DIR/opencode.json"`)
  }

  const keyEntries = Object.entries(envKeys).filter(([, v]) => v)
  if (act("providers") && (providers.has("gemini") || providers.has("zen")) && keyEntries.length) {
    lines.push("umask 077")
    lines.push(`printf '' > "$CFG_DIR/.env"`)
    for (const [k, v] of keyEntries) {
      lines.push(`echo '${esc(`${k}="${v}"`)}' | base64 -d >> "$CFG_DIR/.env"`)
    }
    lines.push(`chmod 600 "$CFG_DIR/.env"`)
  } else if (act("server")) {
    lines.push(`umask 077; [ -f "$CFG_DIR/.env" ] || : > "$CFG_DIR/.env"`)
  }

  lines.push('log "config opencode scritta in: $CFG_DIR"')
  lines.push("command -v opencode && opencode --version && echo REMOTE_OK || echo REMOTE_NO_OPENCODE")
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