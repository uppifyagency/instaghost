# Spike Driver A — risultati

> Incolla qui sotto l'output JSON stampato dalla console e rispondi alle 3 domande in fondo.
> Da questo decido: quali endpoint usare, di quali campi posso fare la parità, e se serve token plumbing extra (www-claim, doc_id).

## Account usato per il test
- [ ] Sacrificabile (consigliato)
- [ ] Principale

## Output JSON (incolla qui)

```json
PASTE_QUI_L_OGGETTO_REPORT
```

## Cosa guardo io nell'output (riferimento)
- `sessione.sessionid: true` → eri loggato (necessario).
- `VERDETTO` → GO / NO-GO.
- `steps.web_profile_info.profilo.userId` valorizzato → l'endpoint primario funziona.
- `steps.web_profile_info.primaPagina.cursor: PRESENTE` → paginazione GraphQL possibile.
- `steps.feed_user.nextMaxId: PRESENTE` → paginazione REST possibile (preferibile).
- `campiPostCampione` / `chiaviPostV1` → quali campi dello schema 03 sono ottenibili in 1 chiamata, e quali richiederanno chiamate extra (= più rischio).

## 3 domande veloci dopo il run
1. Che `status` ha dato `web_profile_info`? (200 / 401 / 403 / altro) →
2. Hai visto il banner "Self-XSS / allow pasting"? L'hai aggirato? →
3. Dopo il test, l'account ha ricevuto challenge/checkpoint/logout? →
