#!/usr/bin/env node
import { run, cmdStatus, cmdActivate, cmdDeactivate, cmdGenerate, cmdPrint, runPrintClient } from "../src/setup.js"
import { runUninstall } from "../src/uninstall.js"
import { ui } from "../src/i18n.js"

const argv = process.argv.slice(2)

const HELP = ui(`oc-setup — OpenCode Wyvern

Setup modulare per OpenCode: installi tutto, attivi quello che vuoi.
Nessun dato privato è incluso nel pacchetto: host, utente, chiavi e
API key vengono richiesti/creati in locale durante l'esecuzione.

Uso:
  oc-setup                              avvia la procedura guidata interattiva
  oc-setup generate                     riapplica le sezioni attive dalla config
  oc-setup uninstall                    disinstallazione completa (client, config, cache, alias SSH)
  oc-setup status                       mostra i moduli e lo stato
  oc-setup activate <sezione>           attiva un modulo
  oc-setup deactivate <sezione>         disattiva un modulo
  oc-setup print <sezione>              stampa l'artefatto di una sezione
  oc-setup --version | -v               mostra la versione
  oc-setup --help | -h                  questo aiuto

Sezioni:
  ssh, client-pwsh, client-bash, server, commands, providers, plugins, claude-mem, mcp, tools

Uscita dal wizard:
  TUI:  Esc / Ctrl+C                  Fallback (NON terminale): rispondi 'q'
  Lingua: rilevata dalla locale di sistema; override con OC_LANG=it o OC_LANG=en
`, `oc-setup — OpenCode Wyvern

Modular setup for OpenCode: install everything, activate what you want.
No private data is included in the package: host, user, keys and API
keys are requested/created locally during execution.

Usage:
  oc-setup                              starts the interactive wizard
  oc-setup generate                     re-applies active sections from config
  oc-setup uninstall                    complete uninstall (client, config, cache, SSH alias)
  oc-setup status                       shows modules and status
  oc-setup activate <section>           activates a module
  oc-setup deactivate <section>         deactivates a module
  oc-setup print <section>              prints the artifact of a section
  oc-setup --version | -v               shows the version
  oc-setup --help | -h                  this help

Sections:
  ssh, client-pwsh, client-bash, server, commands, providers, plugins, claude-mem, mcp, tools

Leaving the wizard:
  TUI:  Esc / Ctrl+C                  Fallback (NON terminal): answer 'q'
  Language: detected from system locale; override with OC_LANG=it or OC_LANG=en
`)

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
    console.error(ui("uso: oc-setup --print-client <pwsh|bash>", "usage: oc-setup --print-client <pwsh|bash>"))
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
      if (!arg1) fail(ui("uso: oc-setup activate <sezione>", "usage: oc-setup activate <section>"))
      await cmdActivate(arg1)
      break
    case "deactivate":
      if (!arg1) fail(ui("uso: oc-setup deactivate <sezione>", "usage: oc-setup deactivate <section>"))
      await cmdDeactivate(arg1)
      break
    case "generate":
      await cmdGenerate()
      break
    case "uninstall":
      await runUninstall()
      break
    case "print":
      if (!arg1) fail(ui("uso: oc-setup print <sezione>", "usage: oc-setup print <section>"))
      await cmdPrint(arg1)
      break
    case undefined:
      await run(argv)
      break
    default:
      fail(ui("comando sconosciuto:", "unknown command:") + ` ${sub}`)
  }
} catch (err) {
  console.error(`\n[error] ${err && err.message ? err.message : err}`)
  process.exit(1)
}

function fail(msg) {
  console.error(`[error] ${msg}`)
  process.exit(2)
}