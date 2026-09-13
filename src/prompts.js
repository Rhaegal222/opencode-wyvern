import { stdin as input, stdout as output } from "node:process"

const color = (code, s) => `\x1b[${code}m${s}\x1b[0m`
export const c = {
  dim: (s) => color(90, s),
  cyan: (s) => color(36, s),
  green: (s) => color(32, s),
  yellow: (s) => color(33, s),
  red: (s) => color(31, s),
  bold: (s) => color(1, s),
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

/** Domanda a testo semplice con default opzionale. */
export async function ask(question, { defaultValue = "", hint = "", validate } = {}) {
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

/** Domanda sì/no con default indicato in maiuscolo. */
export async function confirm(question, defaultValue = false) {
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

/** Selezione singola (indice numerico). */
export async function select(question, choices, { defaultValue = 0 } = {}) {
  console.log(`\n${c.cyan("?")} ${question}`)
  choices.forEach((choice, i) => {
    console.log(`  ${i + 1}. ${choice.label}`)
  })
  return choices[Number(await ask("Scelta (numero)", {
    defaultValue: String(defaultValue + 1),
    validate: (v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= choices.length,
  })) - 1]
}

/** Selezione multipla: numeri separati da virgola/spazio (es. "1,3,5"). */
export async function checkbox(question, choices, { defaultIndices = [] } = {}) {
  console.log(`\n${c.cyan("?")} ${question} ${c.dim("(numeri separati da virgola/spazio)")}`)
  choices.forEach((choice, i) => {
    const sel = defaultIndices.includes(i) ? "•" : " "
    console.log(`  ${sel} ${i + 1}. ${choice.label}`)
  })
  const answer = await ask("Seleziona (es. 1,3,5)", {
    defaultValue: defaultIndices.length ? defaultIndices.map((n) => n + 1).join(",") : "",
    validate: (v) =>
      v.split(/[\s,]+/).filter(Boolean).every((n) => /^\d+$/.test(n) && Number(n) >= 1 && Number(n) <= choices.length),
  })
  return [...new Set(answer.split(/[\s,]+/).filter(Boolean).map((n) => Number(n) - 1))].map((i) => choices[i])
}

/** Input mascherato per segreti (API key ecc.). */
export async function secret(question, { allowEmpty = false } = {}) {
  output.write(`${c.cyan("?")} ${question}\n> `)
  return new Promise((resolve) => readLine({ masked: true, allowEmpty }, (v) => resolve(v)))
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