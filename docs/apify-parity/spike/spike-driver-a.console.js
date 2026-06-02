/* ============================================================================
 * INSTAGHOST · SPIKE DRIVER A — validazione API web privata di Instagram
 * ----------------------------------------------------------------------------
 * SCOPO: provare empiricamente se, dalla sessione loggata, gli endpoint JSON
 *        interni di IG rispondono e QUALI campi dello schema (03-schema.md)
 *        restituiscono. È il gate go/no-go prima di costruire il Driver A.
 *
 * COME ESEGUIRLO (1 minuto):
 *   1. Apri Chrome, fai login su instagram.com con l'ACCOUNT SACRIFICABILE.
 *   2. Resta su una qualsiasi pagina www.instagram.com (NON una tab vuota).
 *   3. Apri DevTools: F12 (o Cmd+Opt+I) → tab "Console".
 *   4. Se Chrome chiede di scrivere "allow pasting" / "consenti incolla", fallo.
 *   5. Cambia TARGET qui sotto con lo username pubblico da testare.
 *   6. Incolla TUTTO questo file e premi Invio.
 *   7. Copia l'oggetto JSON stampato e incollalo in RISULTATI-template.md.
 *
 * SICUREZZA: fa solo 2 richieste con pausa. NON loopare, NON rilanciarlo in
 * raffica: anche se l'account è sacrificabile, vogliamo segnale, non un ban
 * istantaneo che falsa il test.
 * ========================================================================== */

(async () => {
  const TARGET = 'natgeo';                 // <<< CAMBIA: username pubblico da testare
  const APP_ID = '936619743392459';        // web app id standard di instagram.com
  const sleep  = ms => new Promise(r => setTimeout(r, ms));
  const cookie = n => document.cookie.split('; ').find(c => c.startsWith(n + '='))?.split('=')[1] || null;

  const csrf = cookie('csrftoken');
  const headers = {
    'x-ig-app-id': APP_ID,
    'x-csrftoken': csrf || '',
    'x-requested-with': 'XMLHttpRequest',
  };

  const report = {
    _spike: 'driver-A',
    when: new Date().toISOString(),
    origin: location.origin,
    sessione: {
      csrftoken: !!csrf,
      sessionid: !!cookie('sessionid'),     // true = sei loggato
      ds_user_id: cookie('ds_user_id'),
    },
    target: TARGET,
    steps: {},
  };

  // ---- STEP 1: web_profile_info (auth + profilo + 1ª pagina post + cursor) ----
  try {
    const r = await fetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(TARGET)}`,
      { headers, credentials: 'include' });
    const ct = r.headers.get('content-type') || '';
    const step = { status: r.status, contentType: ct };
    if (r.ok && ct.includes('json')) {
      const u = (await r.json())?.data?.user;
      if (u) {
        const tl = u.edge_owner_to_timeline_media;
        step.profilo = {
          userId: u.id,
          fullName: u.full_name ?? null,
          biography: !!u.biography,
          followerCount: u.edge_followed_by?.count ?? null,
          followingCount: u.edge_follow?.count ?? null,
          postCount: tl?.count ?? null,
          isPrivate: u.is_private,
          isVerified: u.is_verified,
          profilePicHd: !!u.profile_pic_url_hd,
        };
        const node = tl?.edges?.[0]?.node;
        step.primaPagina = {
          postRestituiti: tl?.edges?.length || 0,
          cursor: tl?.page_info?.end_cursor ? 'PRESENTE ✅' : 'ASSENTE ❌',
          hasNextPage: tl?.page_info?.has_next_page,
        };
        if (node) step.campiPostCampione = {
          id: node.id, shortcode: node.shortcode,
          takenAt: node.taken_at_timestamp ?? null,
          tipo: node.__typename,                                   // GraphImage|GraphVideo|GraphSidecar
          likeCount: node.edge_liked_by?.count ?? node.edge_media_preview_like?.count ?? null,
          commentCount: node.edge_media_to_comment?.count ?? null,
          caption: !!node.edge_media_to_caption?.edges?.[0]?.node?.text,
          displayUrl: !!node.display_url,
          dimensions: node.dimensions ?? null,
          isVideo: node.is_video, videoUrl: !!node.video_url, playCount: node.video_view_count ?? null,
        };
        window.__IG_USERID = u.id;
      }
    } else {
      step.bodyPreview = (await r.text()).slice(0, 220);            // login-wall / HTML / errore
    }
    report.steps.web_profile_info = step;
  } catch (e) { report.steps.web_profile_info = { error: e.message }; }

  await sleep(2500);

  // ---- STEP 2: feed/user/{id} (paginazione REST v1 con next_max_id) ----
  try {
    const uid = window.__IG_USERID;
    if (!uid) { report.steps.feed_user = { skipped: 'no userId dallo step 1' }; }
    else {
      const r = await fetch(`/api/v1/feed/user/${uid}/?count=12`, { headers, credentials: 'include' });
      const ct = r.headers.get('content-type') || '';
      const step = { status: r.status, contentType: ct };
      if (r.ok && ct.includes('json')) {
        const j = await r.json();
        step.items = j.items?.length || 0;
        step.moreAvailable = j.more_available;
        step.nextMaxId = j.next_max_id ? 'PRESENTE ✅' : 'ASSENTE ❌';
        if (j.items?.[0]) step.chiaviPostV1 = Object.keys(j.items[0]).slice(0, 45);
      } else {
        step.bodyPreview = (await r.text()).slice(0, 220);
      }
      report.steps.feed_user = step;
    }
  } catch (e) { report.steps.feed_user = { error: e.message }; }

  // ---- VERDETTO sintetico ----
  const w = report.steps.web_profile_info;
  report.VERDETTO =
    (w?.profilo?.userId ? 'GO ✅ — web_profile_info risponde con JSON ricco.' :
     w?.status === 401 || w?.status === 403 ? 'NO-GO ❌ — auth/permessi (401/403).' :
     w?.bodyPreview ? 'NO-GO ❌ — risposta non-JSON (login-wall?).' :
     'INCERTO — leggi steps.') +
    (report.steps.feed_user?.nextMaxId?.includes('PRESENTE') ? ' Paginazione REST OK ✅.' :
     ' Paginazione REST da verificare ⚠️.');

  console.log('%c=== INSTAGHOST · SPIKE DRIVER A ===', 'font-size:14px;font-weight:bold;color:#E4405F');
  console.log(report.VERDETTO);
  console.log(JSON.stringify(report, null, 2));
  window.__SPIKE_REPORT = report;
  console.log('%c→ Copia il JSON sopra in docs/apify-parity/spike/RISULTATI-template.md', 'color:#0095f6;font-weight:bold');
  return report;
})();
