# 02 · Architettura target — "Apify power" in locale

> Documento tecnico. Obiettivo: portare InstaGhost dalla scraping del *presentation layer* (DOM/meta) all'accesso al *data layer* di Instagram, mantenendo riusabile l'80% del codice esistente.
> ⚠️ Da leggere **insieme** a `04-review-first-principles.md`, che argomenta CONTRO diverse scelte qui sotto. Questo file è la proposta; quello è il red-team.

## 0. Principio guida

Non esiste UNA fonte giusta: esistono **tre fonti**, con trade-off opposti su *ricchezza dati / rischio-account / scalabilità / legalità*. L'architettura corretta non sceglie una fonte: **astrae la fonte** dietro un'interfaccia, e normalizza l'output in un unico schema (`03-schema.md`).

```
            ┌─────────────────────────────────────────────┐
            │              SourceDriver (interface)         │
            │   getProfile(username) → RawProfile           │
            │   getPosts(userId, {cursor, limit}) → RawPage │
            │   getPostDetail(shortcode) → RawPost          │
            │   getComments(mediaId, {cursor}) → RawPage    │
            └───────────────┬───────────────┬───────────────┘
                  ┌─────────┘     ┌─────────┘      └─────────┐
        ┌─────────▼──────┐ ┌──────▼────────┐ ┌──────────────▼─────────┐
        │ A. PrivateWeb  │ │ B. Dom (legacy)│ │ C. GraphApi (official) │
        │ (cookie sess.) │ │  fallback      │ │  business_discovery    │
        └────────────────┘ └───────────────┘ └────────────────────────┘
                  └───────────────┴────────────────┘
                                  ▼
                       Normalizer → InstaGhostPost (schema unico)
                                  ▼
            RateLimiter (riuso) → IndexedDB (riuso) → Export/UI (riuso)
```

---

## 1. I tre driver

### Driver A — Private Web API (massima parità con Apify)

**Cos'è:** chiamare gli stessi endpoint JSON interni che usa `instagram.com` quando lo navighi loggato. È letteralmente ciò che fa Apify, ma noi siamo già *first-party + loggati + same-origin*, quindi senza proxy.

**Dove gira:** **content script su una tab `instagram.com` aperta** (origin corretto ⇒ cookie e token allegati automaticamente, nessun CORS). **NON** dal service worker (contesto diverso, header/CORS differenti, più fragile). → vincolo: serve una tab IG aperta.

**Endpoint candidati (⚠️ DA VERIFICARE empiricamente — vedi `04`, knowledge ≤ gen 2026 e IG li ruota):**

| Scopo | Endpoint candidato | Note |
|---|---|---|
| Profilo + 1ª pagina | `GET /api/v1/users/web_profile_info/?username=X` | header `x-ig-app-id: 936619743392459` |
| Post profilo (paginati) | `GET /api/v1/feed/user/{user_id}/?count=12&max_id={cursor}` | `max_id` = cursor → equivale al "resume cursor" Apify |
| Reels | `GET /api/v1/clips/user/` (POST form) | audio + clip |
| Dettaglio post | GraphQL `doc_id` by shortcode | i `doc_id` cambiano spesso |
| Commenti | `GET /api/v1/media/{media_id}/comments/` | testo + autore + timestamp |

**Token/header richiesti (da acquisire a runtime):** `x-csrftoken` (dal cookie `csrftoken`), `x-ig-app-id`, `x-asbd-id`, possibile `x-ig-www-claim`; per GraphQL `fb_dtsg`/`lsd`/`doc_id` estratti dai blob `<script type="application/json">` di bootstrap (`window._sharedData` non esiste più).

**Pro:** parità dati quasi totale (media_id, taken_at, carousel children, commenti, play_count, coauthors, audio, location lat/lng), paginazione reale, **gratis**.
**Contro:** è la mossa **più rilevabile** (cadenza richieste senza eventi UI = firma anti-bot) → **rischio-ban sull'account loggato**; endpoint instabili; non scala server-side per una SaaS.

### Driver B — DOM (legacy, fallback)

Il codice attuale (`extractor.js` + Fast/Hybrid/Full). **Si tiene come graceful degradation**: se A fallisce (token scaduti, endpoint cambiato, checkpoint), si ripiega su B. Passivo, basso rischio, bassa fedeltà.

### Driver C — Instagram Graph API ufficiale (compliant, per la SaaS)

**Cos'è:** API Meta ufficiale. Endpoint chiave: **`business_discovery`** — un account *business/creator* (con app Meta + FB Login) interroga **qualunque account business/creator pubblico per username**.

**Restituisce:** `id, username, name, profile_picture_url, followers_count, media_count, biography, website, is_verified` + **media recenti** (`id, caption, media_type, media_url, permalink, timestamp, like_count, comments_count`).
**NON restituisce:** account *personali*, lista follower, testo dei commenti, audio/coauthors/location dettagliata, storico completo (solo media recenti).
**Limiti:** rate-limit ~200 req/h per token; richiede app review Meta per produzione; `graph.facebook.com` v22.0 (2026).

**Pro:** **ToS-compliant, server-side, scalabile, zero rischio-ban, gratis entro i limiti.** È l'unico percorso davvero sostenibile per una SaaS.
**Contro:** copertura ridotta (no personali, no commenti-testo, no parità Apify), onboarding (ogni utente collega un account professional), app review.

---

## 2. Tabella trade-off (la decisione)

| Dimensione | A · Private Web | B · DOM | C · Graph API |
|---|---|---|---|
| Ricchezza dati (vs Apify) | ~90% | ~30% | ~40% (solo business/creator) |
| Account personali | ✅ | ✅ | ❌ |
| Testo commenti | ✅ | ⚠️ parziale | ❌ |
| Rischio-ban account | 🔴 Alto | 🟢 Basso | 🟢 Nullo |
| Stabilità nel tempo | 🔴 Bassa | 🔴 Bassa | 🟢 Alta |
| Costo | Gratis | Gratis | Gratis (entro limiti) |
| Scala server-side (SaaS) | ❌ | ❌ | ✅ |
| Compliant ToS | ❌ | ⚠️ grigio | ✅ |

**Lettura strategica:** **A** è la risposta a *"uso personale, massima potenza"*. **C** è la risposta a *"SaaS sostenibile"*. **Sono prodotti diversi**, non due fasi dello stesso. Questo è il bivio centrale (→ `04`, sez. B/E).

---

## 3. Cosa si riusa / cosa si sostituisce

| Componente | Azione |
|---|---|
| `libs/rate-limiter.js`, `libs/lru-cache.js` | **Riuso** (il limiter diventa *più* importante con A) |
| `background/db.js` (IndexedDB) | **Riuso**, ma migrare schema → `03-schema.md` + `DB_VERSION++` con migrazione |
| Export JSON/CSV/HTML/MD, UI side panel | **Riuso** |
| Utility sicurezza (`validateInstagramUrl`, escape*, anti-pollution) | **Riuso** |
| `content/extractor.js` (DOM) | **Demoto a Driver B** (fallback), non più primario |
| 3 modalità Fast/Hybrid/Full | **Sostituite** dall'astrazione SourceDriver (Fast/Hybrid/Full diventano *strategie del Driver B*) |
| `service-worker.js` `fetchPostData` (og-based) | **Deprecato** a favore del Driver A/C |

---

## 4. Sequenza di build raccomandata (≠ ordine richiesto — vedi `04` sez. D)

0. **Spike di validazione (1–2h):** aprire IG loggato, chiamare 1 endpoint del Driver A dalla console/content script, vedere il JSON reale. **Gate go/no-go.** Se A è bloccato/troppo rischioso, il piano cambia.
1. Definire `SourceDriver` + Normalizer + schema unico.
2. Implementare Driver A (profilo + post paginati) con riuso del RateLimiter.
3. Migrazione DB allo schema unico.
4. Driver C (se la SaaS è confermata).
5. Driver B ridotto a fallback.
