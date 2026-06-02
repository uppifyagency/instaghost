# `legacy/` — Codice archiviato (cleanup 2026-06-02)

> Rinominata da `_legacy/` a `legacy/` il 2026-06-02: Chrome rifiuta di caricare
> estensioni che contengono file/cartelle con prefisso `_` (riservato).

Questa cartella **non viene caricata dall'estensione**. Contiene codice rimosso dal
runtime durante il cleanup del 2026-06-02. È un archivio reversibile: nessun file è
stato cancellato, solo spostato qui. L'estensione viva usa esclusivamente
l'architettura **Era 3 / Driver A** (API web interne di Instagram).

> Il progetto è ora sotto controllo di versione (git, branch `main`): il codice
> rimosso è recuperabile sia da questa cartella sia dalla storia git.

---

## Cosa è stato archiviato e perché

### `content/` — motore DOM legacy (Era 1/2), mai più caricato dal manifest
| File | Era | Cosa faceva | Perché archiviato |
|------|-----|-------------|-------------------|
| `extractor.js` | 1 | `InstagramExtractor`: estrazione dati da un singolo post via selettori DOM + regex | Non in `manifest.json`, nessun riferimento nel codice vivo |
| `profile-scraper.js` | 2 | `ProfileScraper`: scraping profilo in 3 modalità (griglia / click-modale / fetch HTML) | idem |
| `instagram-monitor.js` | 1 | `InstagramMonitor`: monitoraggio passivo del feed (MutationObserver + IntersectionObserver) | idem |
| `styles.css` | 1 | classi `.insta-monitor-*` per le notifiche iniettate nella pagina | Caricato dal manifest, ma le classi non sono usate dal codice Era 3 (che non inietta UI). Rimosso dai `content_scripts.css` del manifest |

### `libs/`
| File | Cosa faceva | Perché archiviato |
|------|-------------|-------------------|
| `lru-cache.js` | `LRUCache`: dedup in-memory | Usato solo da `instagram-monitor.js` (anch'esso archiviato) |

### `ui/`
| File | Cosa faceva | Perché archiviato |
|------|-------------|-------------------|
| `sidepanel.css` (2.399 righe) | design system Era 1/2 | **Non referenziato da `ui/sidepanel.html`**: l'HTML usa solo lo `<style>` inline. Era già morto |

### `background/` — strato di persistenza + handler legacy
| File | Cosa faceva | Perché archiviato |
|------|-------------|-------------------|
| `db.js` | wrapper IndexedDB (`InstagramMonitorDB`, store `posts`/`sessions`) | In Era 3 nessuno scrive sul DB: il Driver A salva i file direttamente. Era importato dal service worker ma inutilizzato |
| `service-worker.original.js` | versione completa pre-cleanup del service worker | Backup di riferimento. Il `service-worker.js` vivo è stato ridotto alla sola logica Era 3 (apertura side panel + download `ig_download`) |

### `unrelated-router-tool/` — file estranei al progetto InstaGhost
| File | Cosa è |
|------|--------|
| `nsa-pro-router.js` | bookmarklet per router Huawei B535 (bande LTE/5G, signal, SMS). Nessun legame con Instagram |
| `hack router` | versione legacy/offuscata dello stesso bookmarklet router |

---

## Come ripristinare (se mai servisse)

1. Rimetti i file `content/*`, `libs/*`, `ui/*` nelle rispettive cartelle.
2. Riaggiungi al `manifest.json`:
   - i content script DOM in `content_scripts[0].js` (se vuoi riattivare il monitor),
   - il blocco `"css": ["content/styles.css"]` se riattivi le notifiche iniettate.
3. Per ripristinare la persistenza IndexedDB: riporta `background/db.js` in `background/`
   e sostituisci `background/service-worker.js` con `service-worker.original.js`
   (oppure reintroduci `importScripts('./db.js')` + gli handler necessari).

## Nota architetturale

L'estensione viva (Era 3) è composta solo da:
`manifest.json` · `background/service-worker.js` · `content/ig-{driver,api-client,normalizer,render}.js` ·
`libs/rate-limiter.js` · `ui/sidepanel.{html,js}` · `icons/`.
I file `libs/test-backoff.js` e `libs/test-fatigue.js` sono test del rate-limiter vivo:
NON archiviati di proposito (validano codice in uso).
