# 05 · Integrazione del Driver A nell'estensione — readiness assessment

> ✅ **STATO: IMPLEMENTATO.** Il Driver A è ora integrato e funzionante nell'estensione
> (content/ig-{driver,api-client,normalizer,render}.js + ui/sidepanel + service-worker),
> con download opzionale dei media. Il motore DOM legacy è stato archiviato in `legacy/`,
> non degradato a fallback. Questo documento resta come analisi di readiness originale.

> Valutazione ingegneristica: quanto siamo lontani dal portare la capacità validata (handle + N → knowledge base LLM) **dentro** l'estensione Chrome, standalone, che si attiva su Instagram.

## TL;DR

> **Chassis pronto ~70%.** L'estensione ha già MV3, content-script su instagram.com, side panel, service worker, IndexedDB, `downloads`, e soprattutto il **rate-limiter** (che il Driver A richiede). Il lavoro vero è **2 moduli nuovi** (client API in main-world + bridge) + **porting di codice già scritto** (Normalizer + render) + **UI**. **Nessun nuovo permesso** per il core. **Un solo rischio non ancora ritirato:** la fetch deve funzionare dal content-script di un'estensione *installata* (finora provata via CDP main-world). Alta confidenza, ma va verificata in vivo con una *vertical slice*.

## Inventario componenti

| Componente | Stato | Azione |
|---|---|---|
| MV3: manifest, content-script su `instagram.com/*`, side panel, SW, IndexedDB | ✅ esiste | **riuso** |
| `host_permissions` instagram.com | ✅ esiste | **riuso** — il core non richiede nuovi permessi |
| `libs/rate-limiter.js` (Gaussian, backoff, fatigue) | ✅ ottimo | **riuso** — il Driver A ne ha bisogno davvero |
| Riconoscimento pagina/profilo (`isProfilePage`, `profile-scraper.js`) | 🟡 parziale | **riuso/estendi** |
| Export & download MD/JSON (`service-worker.js`, `downloads`) | ✅ esiste | **riuso** |
| **IgApiClient** (3 chiamate validate + paginazione) | ❌ da costruire | **NEW** (logica già provata nello spike) |
| **Normalizer** (raw IG → schema-03) | 🟡 scritto nello spike (`extract-profile.js` `norm`) | **porta come modulo** |
| **Render knowledge-base** (`lib-render.js` v2) | ✅ scritto | **porta quasi tal quale** |
| UI side panel: input handle + N + "Estrai" + progress + download | 🟡 ci sono controlli scrape/export | **estendi** |
| Engine DOM (`extractor.js` + Fast/Hybrid/Full) | ⚠️ approccio sbagliato | **demoto a fallback** |

## Architettura target (dove gira cosa)

```
┌─ Side Panel (UI) ──────────────────────────────┐
│ input @handle (auto da URL profilo) + N + ▶ Estrai│
│ progress live · ⬇ Scarica MD / JSON              │
└───────────────┬─────────────────────────────────┘
                │ chrome.runtime / port
┌───────────────▼──────────────── content-script (ISOLATED) ─────────┐
│ Orchestrator: rileva profilo, gestisce RateLimiter, Normalizer,    │
│ render (lib-render), invia progress alla UI                        │
│   │  window.postMessage / CustomEvent (bridge)                     │
│   ▼                                                                │
│ ig-api-client (MAIN world, iniettato)  ← replica ESATTA dello spike │
│   fetch /api/v1/users/web_profile_info  (x-ig-app-id, x-csrftoken) │
│   fetch /api/v1/feed/user/{id} (paginazione max_id)                │
│   fetch /api/v1/media/{id}/comments                                │
└────────────────────────────────────────────────────────────────────┘
                │ post_found / download
┌───────────────▼─────────── service worker ─────────┐
│ download MD/JSON · (opzionale) IndexedDB            │
└─────────────────────────────────────────────────────┘
```

**Decisioni chiave:**
1. **Le fetch girano nel content-script, NON nel service worker.** Il SW MV3 viene ucciso dopo ~30s di inattività: un loop di paginazione lì morirebbe. Il content-script vive quanto la tab. Inoltre la fetch same-origin dal contesto pagina porta i cookie (incl. `sessionid` HttpOnly) e sembra first-party.
2. **Main-world per de-rischiare.** La via *garantita* è iniettare `ig-api-client.js` nel **MAIN world** (Chrome ≥111: `world:"MAIN"` o `chrome.scripting.executeScript({world:'MAIN'})`, permesso `scripting` già presente): è letteralmente il codice dello spike che sappiamo funzionare. Il content-script isolato fa da orchestratore e bridge via `postMessage`. (In alternativa si prova prima la fetch dall'isolated world — molto probabilmente funziona — e si tiene il main-world come fallback.)
3. **Riuso del rate-limiter** sul cadenzamento delle richieste (il rischio-ban è invariato: stesse chiamate).
4. **Niente DB obbligatorio** per il caso d'uso handle→MD: si genera e si scarica. IndexedDB resta per storicizzare, opzionale.

## L'unico rischio non ritirato (da fare per primo)

Lo spike ha provato che **l'API IG risponde dalla pagina** (via CDP main-world). NON ha ancora provato che la fetch funziona dal content-script di un'estensione **installata** (cookie di prima parte + header custom + eventuali restrizioni MV3). Confidenza alta, ma è *l'unica* incognita d'integrazione.

> **Vertical slice da costruire per prima:** un content-script minimale che, su una pagina profilo IG, inietta il client main-world, fa **una sola** `web_profile_info` e logga il JSON. Se torna 200 con i dati → rischio ritirato, si procede al full build. Costo: ~30 min.

## Nuovi permessi manifest?
- Core: **nessuno** (`scripting`, `downloads`, `storage`, `sidePanel`, host instagram.com già presenti).
- Eventuale `web_accessible_resources` per il file main-world se iniettato come `<script src>` (evitabile usando `chrome.scripting` con `func`/`files` + `world:'MAIN'`).

## Stima
- Vertical slice (ritiro rischio): ~0.5h.
- IgApiClient + bridge + Normalizer + render porting: ~mezza giornata.
- UI side panel (handle+N+progress+download): ~mezza giornata.
- Demozione engine DOM a fallback + cleanup: ~2h.
→ **~1.5–2 giornate** per una v1 dell'estensione standalone che fa handle+N → knowledge base, riusando ~70% dell'esistente.
