---
description: Checklist di code review sul codice selezionato
---

# Code Review

Esegui una review del codice indicato (selezione o file). Procedi per priorità
e riporta solo problemi concreti, non preferenze stilistiche.

1. **Correttezza**: bug, race condition, errori di off-by-one, gestione edge case.
2. **Sicurezza**: injection (SQL, shell, XSS), segreti hardcoded, autenticazione/autorizzazione.
3. **Robustezza**: errori non gestiti, risorse non rilasciate, timeout.
4. **Manutenibilità**: duplicazione, funzioni troppo lunghe, naming ambiguo.
5. **Performance evidenti**: loop N+1, query senza indice, uso eccessivo di memoria.

Formato: per ogni problema un blocco `[GRAVITÀ] file:riga — problema` seguita da
una proposta di fix. Chiudi con un riepilogo numerato per gravità (critico/alto/medio/basso).