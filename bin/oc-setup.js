#!/usr/bin/env node
import { run, cmdStatus, cmdActivate, cmdDeactivate, cmdGenerate, cmdPrint, runPrintClient } from "../src/setup.js"

const argv = process.argv.slice(2)

const HELP = `oc-setup — OpenCode Wyvern

Setup modulare per OpenCode: installi tutto, attivi quello che vuoi.
Nessun dato privato è incluso nel pacchetto: host, utente, chiavi e
API key vengono richiesti/creati in locale durante l'esecuzione.

Uso:
  oc-setup                              avvia la procedura guidata interattiva
  oc-setup generate                     riapplica le sezioni attive dalla config
  oc-setup status                       mostra i moduli e lo stato
  oc-setup activate <sezione>           attiva un modulo
  oc-setup deactivate <sezione>         disattiva un modulo
  oc-setup print <sezione>              stampa l'artefatto di una sezione
  oc-setup --version | -v               mostra la versione
  oc-setup --help | -h                  questo aiuto

Sezioni:
  ssh, client-pwsh, client-bash, server, commands, providers, plugins, claude-mem
`

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP)
  process.exit(0)
}
if (argv.includes("--version") || argv.includes("-v")) {
  const meta = await import("../package.json", { with: { type: "json" } })
  console.log(meta.default.version)
  process.exit(0)
}

const printIdx = argv.indexOf("--print-client")
if (printIdx !== -1) {
  const kind = argv[printIdx + 1]
  if (kind !== "pwsh" && kind !== "bash") {
    console.error("uso: oc-setup --print-client <pwsh|bash>")
    process.exit(2)
  }
  await runPrintClient(kind)
  process.exit(0)
}

const [sub, arg1] = argv
try {
  switch (sub) {
    case "status":
      await cmdStatus()
      break
    case "activate":
      if (!arg1) fail("uso: oc-setup activate <sezione>")
      await cmdActivate(arg1)
      break
    case "deactivate":
      if (!arg1) fail("uso: oc-setup deactivate <sezione>")
      await cmdDeactivate(arg1)
      break
    case "generate":
      await cmdGenerate()
      break
    case "print":
      if (!arg1) fail("uso: oc-setup print <sezione>")
      await cmdPrint(arg1)
      break
    case undefined:
      await run(argv)
      break
    default:
      fail(`comando sconosciuto: ${sub}`)
  }
} catch (err) {
  console.error(`\n[error] ${err && err.message ? err.message : err}`)
  process.exit(1)
}

function fail(msg) {
  console.error(`[error] ${msg}`)
  process.exit(2)
}