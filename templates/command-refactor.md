---
description: Piano di refactoring per il codice indicato
---

# Refactoring

Analizza il codice indicato e proponi un piano di refactoring incrementale,
con piccoli passi compilabili e verificabili in modo indipendente.

Prima di scrivere codice:
1. Identifica le **code smell** concrete (duplicazione, accoppiamento, lunghezza,
   responsabilità confuse, abuso di selector/flag).
2. Proponi la **struttura target** (moduli, funzioni, nomi) motivando ogni scelta.
3. Elenca i **passi** ordinati: dal più sicuro (meccanico) al più rischioso
   (cambio di comportamento), ciascuno con quali test/correttezza lo verificano.

Esegui poi i passi uno alla volta, fermandoti per conferma prima di cambiamenti
di comportamento o modifiche di API pubbliche. Mantieni invariata la semantica.