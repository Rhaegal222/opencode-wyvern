# opencode-wyvern

Setup **modulare** per OpenCode: installi tutto, attivi quello che vuoi.

Il pacchetto non contiene alcun dato privato: host, utente, chiavi SSH e
API key vengono **richiesti/creati durante il setup**, mai salvati in locale
(le API key finiscono solo in `~/.config/opencode/.env` sul server, `chmod 600`).

## Installazione

```bash
npm install -g opencode-wyvern
oc-setup
```

La procedura guidata:

1. **Moduli** — scegli quali sezioni attivare (default: tutte).
2. **Connessione** — solo i dati necessari ai moduli scelti
   (host obbligatorio solo se usi SSH/sezioni remote; coi soli client basta l'alias).
3. **Provider / plugin / claude-mem** — solo se le sezioni corrispondenti sono attive;
   endpoint e chiavi sono richieste al volo.
4. **Applicazione** — chiave SSH, alias, profili client e bootstrap remoto.

Le sezioni restano salvate in `~/.config/opencode-wyvern/config.json`
(solo dati non sensibili) e puoi attivarle/disattivarle in seguito.

## Comandi

```
oc-setup                              avvia la procedura guidata
oc-setup generate                     riapplica le sezioni attive dalla config
oc-setup status                       mostra moduli, entry e provider configurati
oc-setup activate <sezione>           attiva un modulo
oc-setup deactivate <sezione>         disattiva un modulo
oc-setup print <sezione>              stampa l'artefatto di una sezione
```

## Moduli

| Sezione       | Dove  | Cosa fa |
|---------------|-------|---------|
| `ssh`         | locale | genera/riusa la chiave ed25519, alias in `~/.ssh/config`, install chiave sul server |
| `client-pwsh` | locale | comandi `oc-*` nel profilo PowerShell (`oc-sessions`, `oc-go`, `oc-resume`, `oc-recap`, ...) |
| `client-bash` | locale | stesso blocco in `~/.bashrc` |
| `server`      | remoto | controlla node/npm, installa opencode se manca, crea `~/.config/opencode` + `AGENTS.md` |
| `commands`    | remoto | comando `/baseline-ui` (`command/baseline-ui.md`) |
| `providers`   | remoto | provider opencode in `opencode.json`; chiavi in `.env` |
| `plugins`     | remoto | plugin npm installati nella dir config e listati in `opencode.json` |
| `claude-mem`  | remoto | memoria: wrapper `plugins/claude-mem-plugin.js` |

## Provider presets

La sezione `providers` propone (checkbox): **GitHub Copilot**, **Google Gemini**,
**OpenCode Zen**, **Anthropic Claude**, **OpenAI / Codex** e **OmniRoute**
(gateway multi-modello con supporto `auto/*`). Le chiavi vengono chieste al setup
solo per i provider che le richiedono (`GOOGLE_GENERATIVE_AI_API_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) e finiscono solo nel `.env` remoto.
Per OmniRoute viene chiesto l'URL del gateway (default `http://127.0.0.1:20128`).

Il modello default è scelto automaticamente (con OmniRoute: `omniroute/auto/best-coding`,
altrimenti il primo modello del primo provider attivo), insieme a `small_model`.
Un'opzione del setup aggiunge i tuning collaudati `tool_output` e `compaction`.

## Client

I client espongono i comandi `oc-*` e mostrano le **sessioni delle ultime 24 ore**
(finestra scorrevole). In particolare `oc-sessions` elenca le sessioni recenti,
`oc-go` apre una sessione, `oc-resume` ne riapre più di una, `oc-recap` riepiloga
a fine connessione. Richiedono `oc-setup ssh` o una `~/.ssh/config` già pronta.

## Sviluppo

```bash
node scripts/sync-client.mjs   # applica le modifiche condivise e rigenera il template pwsh (sanitizzato)
node bin/oc-setup.js --help
```

## Sicurezza

- Nessuna chiave/token/password nel pacchetto o in `config.json` locale.
- Le API key sono scritte dal bootstrap remoto in `~/.config/opencode/.env` (`chmod 600`).
- I file remoti viaggiano come base64 dentro lo script; con server non raggiungibile
  lo script non viene stampato a video (evita leak delle chiavi).