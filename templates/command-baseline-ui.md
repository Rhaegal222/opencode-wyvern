---
description: Baseline di interfaccia/struttura per una nuova feature o schermata
---

# Baseline UI

Prima di scrivere codice per un'interfaccia nuova o modificata, produci una baseline concisa che guidi l'implementazione. Non leggere file se non strettamente necessario: rispondi solo con la baseline.

## Struttura richiesta

1. **Obiettivo** - in una frase, cosa fa la UI.
2. **Componenti** - elenco dei componenti/schermate coinvolte (albero ASCII opzionale).
3. **Stati** - loading, empty, error, success; quali gestire e come (spinner, messaggi, retry).
4. **Accessibilità** - focus visibile, contrasto, alternative testuali, scorciatoie da tastiera.
5. **Dati/API** - chiamate necessarie, dove finiscono i dati, comportamento offline/fallback.
6. **Vincoli di sicurezza** - non incollare mai chiavi, token o segreti; usa variabili d'ambiente.
7. **Checklist di primo passo** - 3-6 voci concrete da seguire.

## Vincoli

- Non scrivere codice: solo la baseline in Markdown.
- Massimo ~80 righe; se serve più spazio, usa elenchi puntati, non testo piatto.
- Se mancano informazioni (framework, linguaggio, stile), dichiaralo e proponi un default ragionevole invece di assumere.