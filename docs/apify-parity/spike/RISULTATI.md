# Spike Driver A — RISULTATI (2026-06-02) · VERDETTO: GO ✅

Validato **empiricamente** dalla sessione Chrome loggata (CDP su :9333, account `ds_user_id 59122999327`) contro l'account di riferimento **`ingiroconalice`** (Bologna, nicchia verticale) e `natgeo`.

## Cosa è confermato funzionante

| Capacità | Endpoint | Esito |
|---|---|---|
| Profilo (metadati) | `GET /api/v1/users/web_profile_info/?username=X` (header `x-ig-app-id: 936619743392459`) | ✅ 200 JSON: id, full_name, biography, edge_followed_by.count, edge_follow.count, edge_owner_to_timeline_media.count, is_verified, is_private, external_url, profile_pic_url_hd |
| **Post/reel/caroselli paginati** | `GET /api/v1/feed/user/{userId}/?count=N&max_id={cursor}` | ✅ 200 JSON, 12/pag, `next_max_id` **avanza** tra pagine |
| Commenti | `GET /api/v1/media/{pk}/comments/?can_support_threading=true&permalink_enabled=false` | ✅ 200: user, text, comment_like_count, created_at, child_comment_count |

> ⚠️ `web_profile_info` **non restituisce più i post** in `edge_owner_to_timeline_media.edges` (0 elementi, no cursor). I post si prendono **solo** da `feed/user`. Quindi il flusso è: `web_profile_info` → `userId` → `feed/user/{userId}` (paginato).

## Mappatura campi CONFERMATA (raw `feed/user` item → schema `03`)

| Schema 03 | Path raw confermato | Note |
|---|---|---|
| id | `pk` | string |
| shortcode | `code` | |
| takenAt | `taken_at` | unix ✅ |
| mediaType | `media_type` | 1=image, 2=video/reel, 8=carousel ✅ |
| productType | `product_type` | es. `clips`, `carousel_container` |
| caption | `caption.text` | testo completo ✅ |
| likeCount | `like_count` | ⚠️ può essere fuorviante su reel adv (visto `3`); mappare a `null/-1` quando incoerente |
| commentCount | `comment_count` | ✅ |
| playCount | `play_count`/`ig_play_count` | ✅ (reel: 26413) |
| thumbnailUrl | `image_versions2.candidates[0].url` | ✅ CDN reale |
| videoUrl | `video_versions[0].url` | ✅ .mp4 scaricabile |
| dimensions | `original_width`/`original_height` | ✅ |
| durationSeconds | `video_duration` | ✅ |
| carouselMedia | `carousel_media[]` (ognuno con `image_versions2`/`video_versions`, `media_type`) | ✅ 18 figli |
| carouselCount | `carousel_media_count` | ✅ |
| location | `location` → `name, lat, lng, city` | ✅ Bologna 44.5075,11.3514 |
| audio | `clips_metadata.music_info.music_asset_info` (licensed) / `clips_metadata.original_sound_info` (original) → title, display_artist/ig_artist, audio_id | ✅ original |
| coauthors | `coauthor_producers[].username` | ✅ |
| taggedUsers | `usertags.in[].user.username` | ✅ |
| isPaidPartnership | `is_paid_partnership` | ✅ |
| author | `user` → pk, username, is_verified, (follower_count spesso null nel feed) | follower esatto: prenderlo da `web_profile_info` |

## Harness usato (riproducibile)

- Chrome controllato: profilo dedicato `~/.instaghost-cdp-profile`, `--remote-debugging-port=9333 --remote-allow-origins=*` (Chrome 148 sul profilo di default **disabilita** gli endpoint → serve profilo dedicato).
- Runner: `docs/apify-parity/spike/cdp-run.js` (browser endpoint + Target API; `ws` via `NODE_PATH=/tmp/instaghost-cdp/node_modules`; ricostruire WS URL su `127.0.0.1:PORT`).
- Esecuzione: `CDP_PORT=9333 NODE_PATH=… node cdp-run.js <fileEspressione.js>`.

## Implicazioni per il build
1. **Schema 03 congelabile** su questi path (evidenza reale).
2. Driver A di produzione = stesse 3 chiamate, dal content-script (same-origin, `credentials:'include'`, header `x-ig-app-id`+`x-csrftoken`).
3. Gestire `like_count` incoerente (reel adv) → normalizzare a `null`/`-1`.
4. `account_type` non sempre presente in `web_profile_info`: derivarlo (`is_business_account`/`is_professional`) o lasciarlo `null`.
