---
description: Genera un messaggio di commit convenzionale (Conventional Commits)
---

# Commit message

Analizza le modifiche staged (`git diff --cached`) o le modifiche non committate
se non è ancora nulla staged (`git diff`).

Procedi:
1. Scegli il **tipo** corretto: `feat`/`fix`/`refactor`/`chore`/`docs`/`test`/`perf`/`ci`.
2. Scrivi un **oggetto** (imperativo, ≤72 caratteri, senza punto finale).
3. Aggiungi un **corpo** solo se serve per giustificare il *perché* (non ripetere
   cosa fa il diff). Massimo 72 caratteri per riga.
4. Se pertinente, aggiungi **breaking change** trailer: `BREAKING CHANGE: <descrizione>`.

Output finale: solo il messaggio di commit, senza backtick né output aggiuntivo,
così che possa essere usato direttamente con `git commit -m "<messaggio>"`.
