---
description: Genera casi di test per il codice indicato
---

# Test

Scrivi casi di test per il codice indicato. Prima individua il framework di test
già usato dal progetto (package.json, config esistente) e seguine le convenzioni;
se non è determinabile, chiedi all'utente.

Copri in ordine: casi felici, edge case (limiti, input vuoti/null, valori limite),
e casi d'errore (input invalidi, eccezioni). Per ogni test indica cosa verifica
("behaviour"), non come è implementato. Non aggiungere test puramente decorativi.

Dopo aver scritto i test: esegui la suite relativa, correggi gli errori introdotti
e riporta il comando usato e il risultato.