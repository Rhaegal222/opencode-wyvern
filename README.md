# opencode-wyvern

Setup **modulare** per OpenCode: installi tutto, attivi quello che vuoi.

Il pacchetto non contiene alcun dato privato: host, utente, chiavi SSH e
API key vengono **richiesti/creati durante il setup**, mai salvati in locale
(le API key finiscono solo in `~/.config/opencode/.env` sul server, `chmod 600`).

## Installazione

Prerequisiti: **Node.js 18+** e **npm** (su Ubuntu/WSL si consiglia `nvm`).

```bash
npm install -g opencode-wyvern
```

> Attenzione: `npm rm -g opencode-wyvern` **disinstalla**. Per installare
> si usa solo `npm install -g opencode-wyvern`.

Il comando si chiama **`oc-setup`** (non `oc-help`, non `oc`). Verifica:

```bash
oc-setup --version    # → 0.5.0
```

Dopo la prima installazione, aggiorna il pacchetto e riapplica i comandi
client senza ripetere il wizard con `oc-update`.

Se compare `oc-setup: command not found` subito dopo l'installazione, il
binario è appena fuori dal PATH della shell corrente. Ricaricalo:

```bash
hash -r            # svuota la cache dei comandi (immediato) e riprova
source ~/.bashrc   # oppure ricarica il profilo
# oppure: chiudi e riapri il terminale WSL
```

Con **nvm** (Linux/WSL) il binario finisce in
`~/.nvm/versions/node/<versione>/bin`; quell'alias deve essere attivo
(`nvm use default`). Controlla che il file ci sia:

```bash
nvm use default
ls -l ~/.nvm/versions/node/$(nvm current)/bin/oc-setup
```

Poi avvia la procedura guidata:

```bash
oc-setup
```

La procedura guidata:

1. **Scenario** — scegli subito il contesto: **Client + Server** (legacy SSH),
   **Solo client** (legacy SSH), **Client locale** (OpenCode sul client), **Solo server**
   o **Personalizzato** (sezioni singole).
2. Con **Solo server** viene chiesto come applicare lo script: **via SSH da questo
   client** o **in locale su questa macchina (localhost)** — in quest'ultimo caso
   non serve host/porta né la chiave SSH.
3. **Moduli** — con uno scenario preimpostato le sezioni sono già selezionate;
   con "Personalizzato" le scegli una a una.
4. **Connessione** — solo i dati necessari ai moduli scelti
   (host obbligatorio solo se usi SSH/sezioni remote; coi soli client basta l'alias).
5. **Provider / plugin / claude-mem / comandi / MCP** — solo se le sezioni
   corrispondenti sono attive; endpoint e chiavi vengono richieste al volo.
6. **Applicazione** — chiave SSH, alias, profili client e bootstrap (remoto o locale).

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

Nella procedura guidata: frecce/Spazio per navigare, `Invio` conferma,
`Esc`/`Ctrl+C` annullano, `q` esce. **CTRL+SHIFT+C** in un terminale vero copia
la selezione (gestito dal terminale, mai visto dal wizard) e **CTRL+SHIFT+V**
incolla: un token con la lettera `q` o con un `a-capo` finale viene accettato
senza chiudere il setup e senza caratteri spuri.

La **cartella remota di default** (del menu Connessione) parte già dalla home
dell'utente sul server: lasciala **vuota** per `~`, scrivi un percorso relativo
(es. `projects/foo` → `~/projects/foo`) o assoluto (`/srv/data`). Non viene mai
accodata al valore precedente.

## Moduli

| Sezione       | Dove  | Cosa fa |
|---------------|-------|---------|
| `ssh`         | locale | genera/riusa la chiave ed25519, alias in `~/.ssh/config`, install chiave sul server |
| `client-pwsh` | locale | comandi `oc-*` nel profilo PowerShell (`oc-sessions`, `oc-go`, `oc-resume`, `oc-recap`, ...) |
| `client-bash` | locale | stesso blocco in `~/.bashrc` |
| `client-local` | locale | genera `~/.config/opencode/opencode.json`, verifica/installazione opzionale del binario e diagnostica OmniRoute VPN |
| `server`      | remoto | controlla node/npm, installa opencode se manca, crea `~/.config/opencode` + `AGENTS.md` |
| `commands`    | remoto | comandi custom in `command/*.md` (`/baseline-ui`, `/omniroute-restart`, `/review`, ...) |
| `providers`   | remoto | provider opencode in `opencode.json`; chiavi in `.env` |
| `plugins`     | remoto | plugin npm installati nella dir config e listati in `opencode.json` |
| `claude-mem`  | remoto | memoria: wrapper `plugins/claude-mem-plugin.js` |

## Provider presets

La sezione `providers` propone (checkbox): **GitHub Copilot**, **Google Gemini**,
**OpenCode Zen**, **Anthropic Claude**, **OpenAI / Codex**, **OmniRoute**
(gateway multi-modello con supporto `auto/*`) e **Ollama / vLLM** (modelli locali
OpenAI-compatible: viene chiesto il base URL, default `http://127.0.0.1:11434/v1`).
Le chiavi vengono chieste al setup solo per i provider che le richiedono
(`GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) e
finiscono solo nel `.env` remoto. Per OmniRoute viene chiesto l'URL del gateway
(default `http://127.0.0.1:20128`).

Con OmniRoute la config generata usa `model: omniroute/auto/best-coding`,
`small_model: omniroute/auto/cheap`, `plan` su `auto/best-reasoning`, `build` su
`auto/best-coding` ed `explore`/`general` come subagent su `auto/cheap`. Il routing
non dipende da `autoCombos`. Un'opzione aggiunge `tool_output` e `compaction`.

## Comandi custom

La sezione `commands` installa agent in `~/.config/opencode/command/*.md`:
`/baseline-ui` (baseline interfacce), `/omniroute-restart` (riavvia il container
Docker OmniRoute e attende che sia `healthy`), `/review`, `/refactor`, `/tests`,
`/commit`, `/explain`.

## Client

I client legacy espongono i comandi `oc-*` e mostrano le **sessioni delle ultime
24 ore**. OpenCode continua a girare sul server via SSH; `oc-sessions`, `oc-go`,
`oc-resume` e `oc-recap` restano compatibili e richiedono l'alias SSH configurato.

Il modulo `client-local` genera invece la config OpenCode sul client per bash/Linux,
macOS e PowerShell/Windows. Usa per default `https://omniroute.example.com`,
configurabile nel wizard, e verifica DNS e `/healthz`; l'offline non blocca il setup.
Il DNS dovrebbe risolvere sulla subnet privata/VPN documentata. Se `opencode` manca,
il setup può installarlo tramite npm oppure lascia la config pronta con un errore di
prerequisito chiaro. Il server conserva il default distinto `http://127.0.0.1:20128`.

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
