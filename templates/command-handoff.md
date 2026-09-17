---
description: Riepilogo e handoff di una sessione OpenCode
---

# Session handoff

Componi un **handoff conciso e completo** della sessione corrente, pensato per
la sessione successiva (o per chi la riprende con `oc-resume`).

Procedi:

1. **Contesto**: cosa si sta facendo, in quale progetto, su quale ramo.
2. **Stato attuale**: cosa è stato completato e cosa è rimasto in sospeso.
3. **Decisioni**: scelte architetturali/tecniche prese (e perché).
4. **Prossimi passi**: elenco concreto e ordinato delle prossime azioni.
5. **File toccati**: elenco dei file principali modificati/salvati in questa sessione.

Formato markdown, senza preambolo né commenti superflui. Se ci sono comandi
utili per riprendere (avvio dev server, test da eseguire), includili in un
blocco di codice. Tieni tutto in 20-40 righe.