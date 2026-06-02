# 03 · Schema unico normalizzato (parità Apify)

> Il **contratto dati** condiviso tra estensione e futura SaaS. Ogni driver (`02`) produce raw diverso → il Normalizer lo mappa qui. La colonna "Fonte" mostra quale driver può popolare il campo → rende visibile il *fidelity gap*.
> Legenda fonte: **A**=Private Web · **B**=DOM · **C**=Graph API (`business_discovery`). ⚠️ = la disponibilità del campo via API privata va confermata nello spike.

## Versionamento

`schemaVersion: "1.0"`. Ogni record porta `_meta.source` (A/B/C) e `_meta.fidelity` (`full|partial|grid`) così l'analytics sa quanto fidarsi. Niente campi "indovinati": se un driver non ha un dato, → `null` (mai un valore euristico silenzioso, a differenza dell'attuale `calculateEngagement` o dei regex su `og:`).

---

## `InstaGhostProfile`

| Campo | Tipo | Apify | IG raw (A) | Graph API (C) | Fonti |
|---|---|---|---|---|---|
| `userId` | string | author.id | `data.user.id` | `id` | A,C |
| `username` | string | author.username | `user.username` | `username` | A,B,C |
| `fullName` | string\|null | author.full_name | `user.full_name` | `name` | A,C |
| `biography` | string\|null | — | `user.biography` | `biography` | A,C |
| `website` | string\|null | — | `user.external_url` | `website` | A,C |
| `followerCount` | int\|null | author.follower_count | `user.edge_followed_by.count` | `followers_count` | A,C |
| `followingCount` | int\|null | — | `user.edge_follow.count` | — | A |
| `postCount` | int\|null | — | `user.edge_owner_to_timeline_media.count` | `media_count` | A,C |
| `isVerified` | bool | author.is_verified | `user.is_verified` | `is_verified` | A,C |
| `isPrivate` | bool | author.is_private | `user.is_private` | (n/a: solo pubblici) | A |
| `accountType` | enum | author.account_type | derivato | derivato | A,C |
| `profilePicUrl` | string\|null | — | `user.profile_pic_url_hd` | `profile_picture_url` | A,C |

---

## `InstaGhostPost`

| Campo | Tipo | Apify | IG raw (A) | Graph API (C) | Fonti |
|---|---|---|---|---|---|
| `id` | string | id | `pk` / `id` | `id` | A,C |
| `shortcode` | string | shortcode | `code` | da `permalink` | A,B,C |
| `url` | string | url | da `code` | `permalink` | A,B,C |
| `takenAt` | int (unix) | taken_at | `taken_at` | da `timestamp` | A,C |
| `mediaType` | enum `image\|video\|carousel` | media_type | `media_type`+`product_type` | `media_type` | A,B,C |
| `productType` | string\|null | product_type | `product_type` | — | A |
| `caption` | string\|null | caption | `caption.text` | `caption` | A,B⚠️,C |
| `hashtags` | string[] | hashtags | parse(caption) | parse(caption) | A,B,C |
| `mentions` | string[] | mentions | parse(caption) | parse(caption) | A,B,C |
| `likeCount` | int\|null | like_count | `like_count` | `like_count` | A,C,B⚠️ |
| `commentCount` | int\|null | comment_count | `comment_count` | `comments_count` | A,C,B⚠️ |
| `playCount` | int\|null | play_count | `play_count`/`ig_play_count` | — | A |
| `reshareCount` | int\|null | reshare_count | `reshare_count` | — | A⚠️ |
| `thumbnailUrl` | string\|null | thumbnail_url | `image_versions2.candidates[0].url` | `media_url`/`thumbnail_url` | A,B,C |
| `videoUrl` | string\|null | video_url | `video_versions[0].url` | `media_url` (se video) | A,C |
| `dimensions` | `{w,h}`\|null | original_width/height | `original_width/height` | — | A |
| `durationSeconds` | float\|null | duration_seconds | `video_duration` | — | A |
| `isCarousel` | bool | — | `media_type==8` | `==CAROUSEL_ALBUM` | A,B,C |
| `carouselMedia` | Media[]\|null | carousel_media | `carousel_media[]` | `children.data[]` | A,C |
| `author` | InstaGhostProfile (subset) | author | `user` | (dal parent) | A,C |
| `coauthors` | Profile[]\|[] | coauthorProducers | `coauthor_producers[]` | — | A |
| `taggedUsers` | Profile[]\|[] | taggedUsers/usertags | `usertags.in[]` | — | A |
| `location` | `{name,lat,lng,...}`\|null | location | `location` | — | A |
| `audio` | `{title,artist,audioId,isOriginal,...}`\|null | audio/musicInfo | `clips_metadata`/`music_metadata` | — | A |
| `isPaidPartnership` | bool\|null | is_paid_partnership | `is_paid_partnership` | — | A |
| `latestComments` | Comment[]\|[] | latestComments | `/media/{id}/comments/` | ❌ (solo count) | A |
| `_meta` | object | — | — | — | tutti |

### Sub-oggetti

```jsonc
// Comment
{ "id": "string", "text": "string", "username": "string",
  "timestamp": 0, "likeCount": 0, "repliesCount": 0 }

// _meta (sempre presente)
{ "source": "A|B|C", "fidelity": "full|partial|grid",
  "scrapedAt": "ISO-8601", "cursor": "string|null", "schemaVersion": "1.0" }
```

### Esempio (Driver A, fidelity full)

```json
{
  "id": "3857585607866680160",
  "shortcode": "DWI5awHjYNg",
  "url": "https://www.instagram.com/reel/DWI5awHjYNg/",
  "takenAt": 1774080143,
  "mediaType": "video",
  "productType": "clips",
  "caption": "Language barrier is super funny 😹",
  "hashtags": [], "mentions": [],
  "likeCount": 265642, "commentCount": 1037, "playCount": 9279118,
  "thumbnailUrl": "https://...", "videoUrl": "https://...",
  "dimensions": { "w": 720, "h": 1280 }, "durationSeconds": 15.23,
  "isCarousel": false, "carouselMedia": null,
  "author": { "userId": "56114511320", "username": "qoqsik1", "isVerified": true, "followerCount": 2759534 },
  "audio": { "title": null, "isOriginal": true },
  "location": { "name": "Warsaw, Poland", "lat": 52.25, "lng": 21 },
  "latestComments": [],
  "_meta": { "source": "A", "fidelity": "full", "scrapedAt": "2026-06-02T...", "cursor": "QVFC...", "schemaVersion": "1.0" }
}
```

> ⚠️ Vedi `04` sez. C: definire 40 campi *adesso* è in parte speculativo — alcuni (play_count, reshare_count, follower_count allo scrape) potrebbero richiedere chiamate extra ⇒ più richieste ⇒ più rischio. Lo schema va **congelato dopo lo spike**, non prima.
