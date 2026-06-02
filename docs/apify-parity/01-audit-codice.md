# 01 · Audit del codice attuale (InstaGhost v1.1.0)

> Valutazione ingegneristica onesta dell'engine di estrazione esistente, in funzione dell'obiettivo: **parità con gli scraper Apify, in locale, a costo zero**.
> Riferimenti a `file:linea` verificati alla data di questo audit.

## Verdetto in una fraseh

> **Lo scaffolding, l'anti-detection e l'igiene di sicurezza sono buoni e riutilizzabili. Il *core di estrazione* è costruito sulla sabbia: legge il _presentation layer_ (DOM/meta tag), non il _data layer_. Per questo non potrà mai raggiungere la parità con Apify aggiungendo selettori — serve cambiare la *fonte del dato*.**

---

## ✅ Cosa è solido (da tenere)

| Area | File | Giudizio |
|---|---|---|
| Struttura MV3 | `manifest.json` | Pulita: separazione content/background/ui/libs. `host_permissions` ristretto a `instagram.com` (`manifest.json:14-16`). |
| Anti-detection | `libs/rate-limiter.js` | **Sopra la media.** Gaussian via Box-Muller (`:201-208`), PRNG crypto-secure anti-fingerprint (`:175-189`), fatigue simulation (`:298-320`), backoff esponenziale + safe mode (`:389-447`). Questo è il pezzo migliore del progetto. |
| Sicurezza | `background/service-worker.js`, `background/db.js` | `validateInstagramUrl` previene cookie-leak (`service-worker.js:224-235`), `escapeHtml`/`escapeCSV` anti-injection (`:18-56`), guard anti prototype-pollution (`db.js:80-104`), cap anti-ReDoS (`extractor.js:867-869`), CSP nell'export HTML (`:769`). Qualcuno ha fatto un security pass serio (tag CRIT/HIGH/BUG). |
| Persistenza | `background/db.js` | IndexedDB con index unico su `postUrl` → dedup atomico via `ConstraintError` (`db.js:35`, `service-worker.js:469`). |

**Conclusione parziale:** ~60% del codice (limiter, storage, export, UI, sicurezza) sopravvive a qualsiasi riscrittura dell'engine. Non si butta.

---

## ❌ Il problema strutturale: si estrae dal layer sbagliato

Tutte e 3 le modalità leggono **HTML renderizzato** o **meta tag `og:`**, mai il JSON che Instagram usa internamente.

### Fast mode (`profile-scraper.js:340-388`)
- Legge la griglia DOM + `mouseover` per rivelare stat. **Nessuna caption**, like/commenti "best-effort" da regex su testo localizzato (IT/EN).
- Pro reale: zero richieste HTTP → passivo, difficile da rilevare lato network.

### Hybrid mode (`profile-scraper.js:455-494` + `service-worker.js:242-419`)
- `fetch(postUrl, {credentials:'include'})` della **pagina HTML intera**, poi **5 strategie di regex** su `og:description` per indovinare caption/like/commenti (`service-worker.js:294-362`).
- Fragilità massima: `og:description` è una stringa-riassunto di 1 riga che IG può cambiare/rimuovere; IG serve sempre più HTML login-walled a richieste server-like.

### Full mode (`profile-scraper.js:396-447`)
- **Clicca il post** (`link.click()`), apre il modal, estrae dal DOM, poi lo chiude con **4 strategie di fallback** (`closeModal` → `history.back()` → `Escape` → click X → `window.location.href`, `:558-661`).
- ~15 post/min, **visibile all'utente**, e muta la navigazione globale della tab dentro un loop (rischio di portare via la tab dell'utente). Le 4 strategie di chiusura sono un *code smell*: l'approccio combatte la piattaforma.

### I selettori sono già un cimitero di congetture
`extractor.js` ha 6 selettori per la caption (`:150-161`), 5 per i like (`:412-418`), euristiche come `isLikelyComment` / `isLikelyTaggedUsers` / `isLikelyAudioName` (`:262-405`) che **classificano a indovinare** e sbaglieranno. Dipende da classi CSS offuscate (`x1lliihq`, `_aabd`) e dall'ordine di `span[dir="auto"]`: ogni restyle del front-end IG rompe tutto.

---

## ❌ Problemi secondari (debito tecnico)

1. **Schema drift su 3 livelli.** `extractor.extract()` emette un oggetto, `extractor.extractComplete()` (`:996-1059`) ne emette **un altro** (più ricco, mai usato da profile-scraper), e il DB indicizza un terzo set. I nomi divergono: il DB filtra/ordina su `capturedAt` (`db.js:283, 406`) ma l'engine emette `scrapedAt`/`timestamp`/`postedAt` → **`capturedAt` è spesso `undefined`** ⇒ `getStats().todayPosts` e `deleteOlderThan` leggono campi inesistenti.
2. **`calculateEngagement()` divide per 1000 hardcoded** (`extractor.js:856`) → metrica priva di significato (non conosce i follower reali).
3. **DB store incoerente:** `keyPath:'id', autoIncrement:true` (`db.js:29-32`) ma `add()` sovrascrive con `crypto.randomUUID()` string (`:189-192`). L'autoIncrement non viene mai usato; la chiave vera è l'index unico `postUrl`. `DB_VERSION=1` **senza path di migrazione** → cambiare schema domani = rischio dati.
4. **Campi Apify totalmente assenti:** `media_id`, `taken_at` (unix), `follower_count` allo scrape, URL dei figli del carousel, commenti strutturati con timestamp, `play_count`/`reshare_count`, coauthors, tagged users, `audio_id`, location `lat/lng`, e soprattutto il **cursor di paginazione**.

---

## Implicazione per l'obiettivo

La distanza da Apify **non si chiude con più selettori o una sesta strategia di regex.** Apify non "scrapa l'HTML": chiama le **API web interne di Instagram** e impacchetta il JSON. La mossa corretta è cambiare la *fonte* (→ doc `02-architettura.md`), non raffinare il parser del DOM.

Ciò che si **conserva**: `rate-limiter.js`, `lru-cache`, IndexedDB, export, UI side panel, utilità di sicurezza. Ciò che si **sostituisce**: l'engine di estrazione (`extractor.js` DOM-based + le 3 modalità di `profile-scraper.js` + `fetchPostData` og-based).

> ⚠️ Nota critica (sviluppata in `04-review-first-principles.md`): "cambiare fonte" **non è gratis né a rischio zero** — sposta il problema da *fragilità dei selettori* a *rischio-ban dell'account*. Va deciso consapevolmente.
