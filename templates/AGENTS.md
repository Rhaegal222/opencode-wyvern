# OpenCode Wyvern - istruzioni di lavoro

Questo repository è raggiunto in remoto via opencode (SSH).

## Regole di base

- `opencode` viene eseguito sul server; le sessioni sono avviate/riprese da terminali client.
- Mai committare o incollare chiavi, token o password: usa le variabili d'ambiente (`.env`) e i segreti forniti dal sistema.
- I plugin e i modelli configurati sono definiti in `~/.config/opencode/opencode.json` sul server.
- Per modifiche di configurazione, rileggere il file e riavviare la sessione; per i messaggi di memoria claude-mem la history è in `.claude-mem/`.

## Flusso tipico

1. Avvia/riprende una sessione con `oc-go` o `oc-resume`.
2. Chiedi prima di modificare l'architettura: proponi la baseline (`/baseline-ui`).
3. Usa git sul server (branch per feature, commit chiari).
4. Quando la sessione termina, verifica con `oc-recap` quali sessioni sono ancora aperte.