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
oc-setup --version    # → 0.2.5
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

1. **Scenario** — scegli subito il contesto: **Client + Server** (tutto),
   **Solo client**, **Solo server** o **Personalizzato** (sezioni singole).
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

Il modello default è scelto automaticamente (con OmniRoute: `omniroute/auto/best-coding`,
altrimenti il primo modello del primo provider attivo), insieme a `small_model`.
Un'opzione del setup aggiunge i tuning collaudati `tool_output` e `compaction`.

## Comandi custom

La sezione `commands` installa agent in `~/.config/opencode/command/*.md`:
`/baseline-ui` (baseline interfacce), `/omniroute-restart` (riavvia il container
Docker OmniRoute e attende che sia `healthy`), `/review`, `/refactor`, `/tests`,
`/commit`, `/explain`.

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
