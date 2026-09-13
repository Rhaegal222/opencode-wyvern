---
description: Riavvia il container Docker omniroute e verifica che torni healthy
---

# Riavvio OmniRoute

Usa questo comando quando il server OmniRoute va in blocco, risponde con errori
di rete/gateway oppure risulta in stato non healthy. Rimuovi ogni stato bloccato
e attendi che il gateway sia di nuovo pronto fino a conferma.

Esegui esattamente (senza modifiche al container, un solo comando):

```bash
docker restart omniroute && until [ "$(docker inspect --format='{{.State.Health.Status}}' omniroute 2>/dev/null)" = "healthy" ]; do sleep 2; done && docker inspect --format='{{.State.Status}} / {{.State.Health.Status}}' omniroute
```

Riporta il risultato finale rispecchiando l'output (es. `running / healthy`).
Se dopo un numero elevato di tentativi il container resta `starting` o
`unhealthy`, segnalalo all'utente senza nascondere lo stato.