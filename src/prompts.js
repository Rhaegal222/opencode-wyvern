import { stdin as input, stdout as output, stderr as stderrStream } from "node:process"

const color = (code, s) => `\x1b[${code}m${s}\x1b[0m`
export const c = {
  dim: (s) => color(90, s),
  cyan: (s) => color(36, s),
  green: (s) => color(32, s),
  yellow: (s) => color(33, s),
  red: (s) => color(31, s),
  bold: (s) => color(1, s),
}

// --------------------------------------------------------------------------
// Backend TUI nativo Node (@clack/prompts) — cross-platform.
// Quando stdin/stdout/stderr sono un terminale reale, i prompt diventano
// dialoghi interattivi identici su Windows/pwsh, WSL, Linux e macOS
// (frecce, Spazio, invio, Esc/Ctrl+C per annullare, exit code 1).
// Negli altri casi (pipe, CI, non-interattivo) si usa il fallback a righe.
// `secret` mantiene l'input mascherato (via clack password o raw mode).
//
// Il modulo @clack/prompts è importato dinamicamente: se manca (repo senza
// `npm install`) si cade automaticamente sul fallback a righe.
// --------------------------------------------------------------------------

let cpModule = null
let cpTried = false

async function clack() {
  if (!cpTried) {
    cpTried = true
    try {
      cpModule = await import("@clack/prompts")
    } catch {
      cpModule = null // dipendenza non installata: fallback a righe
    }
  }
  return cpModule
}

const realTty = () => !!input.isTTY && !!output.isTTY && !!stderrStream.isTTY

async function tuiOn() {
  const cp = await clack()
  return !!(cp && realTty())
}

function abortSetup() {
  closePrompts()
  console.log(c.yellow("\n  annullato (exit 1)."))
  process.exit(1)
}

function enableRaw() {
  try {
    input.setRawMode(true)
    input.resume()
    input.setEncoding("utf8")
    return true
  } catch {
    return false // stdin non interattivo
  }
}

/**
 * Fallback senza TTY: legge lo stdin a righe e le mette in coda, così
 * più domande successive consumano le risposte in ordine (utile per
 * piping/test e ambiente completamente non interattivo).
 */
const fallbackQueue = []

function readLineFallback(done) {
  const next = () => {
    if (fallbackQueue.length) {
      const v = fallbackQueue.shift()
      return done(v)
    }
    const onData = (chunk) => {
      const text = chunk.toString()
      const parts = text.split(/\r\n|\r|\n/)
      fallbackQueue.push(...parts)
      input.removeListener("data", onData)
      next()
    }
    input.on("data", onData)
    input.resume()
  }
  next()
}

/** Legge una riga da tastiera. `masked` oscura la digitazione (per segreti); */
/** gestisce backspace e Ctrl+C. */
export function readLine({ masked = false, allowEmpty = false } = {}, done) {
  if (!enableRaw()) {
    readLineFallback(done)
    return
  }

  let buf = ""
  const onData = (chunk) => {
    for (const ch of chunk) {
      if (ch === "\r" || ch === "\n") {
        if (!allowEmpty && buf === "") continue
        input.removeListener("data", onData)
        input.setRawMode(false)
        input.pause()
        output.write("\n")
        return done(buf)
      }
      if (ch === "\u0003") {
        input.setRawMode(false)
        input.pause()
        process.exit(130)
      }
      if (ch === "\u007f" || ch === "\b") {
        if (buf.length) {
          buf = buf.slice(0, -1)
          output.write("\b \b")
        }
      } else {
        buf += ch
        output.write(masked ? "*" : ch)
      }
    }
  }
  input.on("data", onData)
}

// --------------------------------------------------------------------------
// Implementazioni classiche (fallback a righe, stesse API precedenti).
// --------------------------------------------------------------------------

async function askClassic(question, { defaultValue = "", hint = "", validate } = {}) {
  const suffix = hint ? ` ${c.dim(`(${hint})`)}` : ""
  const def = defaultValue ? c.dim(`[${defaultValue}]`) : ""
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    output.write(`${c.cyan("?")} ${question}${suffix} ${def}\n> `)
    const raw = await new Promise((resolve) => readLine({}, resolve))
    const value = raw.trim() === "" ? defaultValue : raw.trim()
    if (validate && !validate(value)) {
      console.log(c.yellow("  risposta non valida, riprova."))
      continue
    }
    return value
  }
}

async function confirmClassic(question, defaultValue = false) {
  const hint = defaultValue ? "S/n" : "s/N"
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    output.write(`${c.cyan("?")} ${question} ${c.dim(`(${hint})`)}\n> `)
    const a = (await new Promise((resolve) => readLine({}, resolve))).trim().toLowerCase()
    if (a === "") return defaultValue
    if (/^(s|si|sì|y|yes)$/.test(a)) return true
    if (/^(n|no)$/.test(a)) return false
    console.log(c.yellow("  rispondi s o n."))
  }
}

async function selectClassic(question, choices, { defaultValue = 0 } = {}) {
  console.log(`\n${c.cyan("?")} ${question}`)
  choices.forEach((choice, i) => {
    console.log(`  ${i + 1}. ${choice.label}`)
  })
  return choices[Number(await askClassic("Scelta (numero)", {
    defaultValue: String(defaultValue + 1),
    validate: (v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= choices.length,
  })) - 1]
}

async function checkboxClassic(question, choices, { defaultIndices = [] } = {}) {
  console.log(`\n${c.cyan("?")} ${question} ${c.dim("(invio = nessuno; es. 1,3,5)")}`)
  choices.forEach((choice, i) => {
    const sel = defaultIndices.includes(i) ? "•" : " "
    console.log(`  ${sel} ${i + 1}. ${choice.label}`)
  })
  const answer = await askClassic("Seleziona (es. 1,3,5)", {
    validate: (v) => {
      const nums = v.split(/[\s,]+/).filter(Boolean)
      if (!nums.length) return true // invio = nessuno (salta)
      return nums.every((n) => /^\d+$/.test(n) && Number(n) >= 1 && Number(n) <= choices.length)
    },
  })
  const nums = answer.split(/[\s,]+/).filter(Boolean)
  if (!nums.length) return []
  return [...new Set(nums.map((n) => Number(n) - 1))].map((i) => choices[i])
}

async function secretClassic(question, { allowEmpty = false } = {}) {
  output.write(`${c.cyan("?")} ${question}\n> `)
  return new Promise((resolve) => readLine({ masked: true, allowEmpty }, (v) => resolve(v)))
}

// --------------------------------------------------------------------------
// API pubbliche: TUI @clack/prompts (TTY) con fallback classico.
// --------------------------------------------------------------------------

/** Domanda a testo semplice con default opzionale (clack text). */
export async function ask(question, { defaultValue = "", hint = "", validate } = {}) {
  if (!(await tuiOn())) return askClassic(question, { defaultValue, hint, validate })
  const cp = await clack()
  const message = hint ? `${question} (${hint})` : question
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    const raw = await cp.text({
      message,
      initialValue: defaultValue || undefined,
      validate: (val) => {
        const value = String(val ?? "").trim() === "" ? defaultValue : String(val).trim()
        return validate && !validate(value) ? "risposta non valida, riprova." : undefined
      },
    })
    if (cp.isCancel(raw)) abortSetup()
    const value = String(raw ?? "").trim() === "" ? defaultValue : String(raw).trim()
    if (validate && !validate(value)) {
      cp.log.error("risposta non valida, riprova.")
      continue
    }
    return value
  }
}

/** Domanda sì/no (clack confirm). */
export async function confirm(question, defaultValue = false) {
  if (!(await tuiOn())) return confirmClassic(question, defaultValue)
  const cp = await clack()
  const v = await cp.confirm({ message: question, initialValue: !!defaultValue })
  if (cp.isCancel(v)) abortSetup()
  return v === true
}

/** Selezione singola (clack select, frecce). */
export async function select(question, choices, { defaultValue = 0 } = {}) {
  if (!(await tuiOn())) return selectClassic(question, choices, { defaultValue })
  const cp = await clack()
  const idx = await cp.select({
    message: question,
    options: choices.map((ch, i) => ({ value: i, label: ch.label })),
    initialValue: defaultValue ?? 0,
  })
  if (cp.isCancel(idx)) abortSetup()
  return choices[idx]
}

/** Selezione multipla (clack multiselect, frecce + Spazio). */
export async function checkbox(question, choices, { defaultIndices = [] } = {}) {
  if (!(await tuiOn())) return checkboxClassic(question, choices, { defaultIndices })
  const cp = await clack()
  const options = choices.map((ch) => ({ value: ch.value, label: ch.label }))
  const initialValues = defaultIndices.map((i) => choices[i]?.value).filter((v) => v !== undefined)
  const vals = await cp.multiselect({ message: question, options, initialValues, required: false })
  if (cp.isCancel(vals)) abortSetup()
  const sel = new Set(vals)
  return choices.filter((ch) => sel.has(ch.value))
}

/** Input mascherato per segreti (API key ecc.). */
export async function secret(question, { allowEmpty = false } = {}) {
  if (!(await tuiOn())) return secretClassic(question, { allowEmpty })
  const cp = await clack()
  const v = await cp.password({
    message: question,
    validate: allowEmpty ? () => undefined : undefined,
  })
  if (cp.isCancel(v)) abortSetup()
  return String(v ?? "")
}

export function closePrompts() {
  input.removeAllListeners("data")
  try {
    input.setRawMode(false)
  } catch {
    /* ok */
  }
  input.pause()
}