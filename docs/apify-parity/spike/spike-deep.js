/* Spike profondo Driver A: valori reali + paginazione + commenti.
 * Eseguito via cdp-run.js nella sessione loggata. TARGET sostituibile con sed. */
(async () => {
  const APP_ID = '936619743392459';
  const TARGET = '__TARGET__';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const cookie = n => document.cookie.split('; ').find(c => c.startsWith(n + '=')) ?.split('=')[1] || null;
  const H = { 'x-ig-app-id': APP_ID, 'x-csrftoken': cookie('csrftoken') || '', 'x-requested-with': 'XMLHttpRequest' };
  const out = { target: TARGET, steps: {} };

  // 1) profilo
  const pr = await fetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(TARGET)}`, { headers: H, credentials: 'include' });
  let u = null; try { u = (await pr.json()) ?.data ?.user; } catch (e) {}
  out.profile = { status: pr.status, userId: u ?.id, isPrivate: u ?.is_private, accountType: u ?.account_type ?? null, followers: u ?.edge_followed_by ?.count, posts: u ?.edge_owner_to_timeline_media ?.count, isVerified: u ?.is_verified };
  const uid = u ?.id;
  if (!uid) { out.error = 'no userId'; return out; }

  const norm = it => ({
    id: it.pk || it.id, code: it.code, takenAt: it.taken_at,
    mediaType: it.media_type, productType: it.product_type ?? null,
    captionPresent: !!it.caption ?.text, captionPreview: it.caption ?.text ? it.caption.text.slice(0, 60) : null,
    likeCount: it.like_count ?? null, commentCount: it.comment_count ?? null,
    playCount: it.play_count ?? it.ig_play_count ?? null, reshareCount: it.reshare_count ?? null,
    isCarousel: it.media_type === 8, carouselCount: it.carousel_media_count ?? null,
    imageUrl: !!it.image_versions2 ?.candidates ?.[0] ?.url, videoUrl: !!it.video_versions ?.[0] ?.url,
    dims: it.original_width ? `${it.original_width}x${it.original_height}` : null, duration: it.video_duration ?? null,
    hasTaggedUsers: it.has_tagged_users ?? null, usertags: it.usertags ?.in ?.length ?? 0,
    coauthors: it.coauthor_producers ?.length ?? 0,
    location: it.location ? { name: it.location.name, lat: it.location.lat, lng: it.location.lng } : null,
    music: it.music_metadata ? 'present' : (it.clips_metadata ? 'clips' : null),
    isPaidPartnership: it.is_paid_partnership ?? null,
    owner: it.user ? { pk: it.user.pk, username: it.user.username, followers: it.user.follower_count ?? null, isVerified: it.user.is_verified } : null
  });

  // 2) pagina 1
  const f1 = await fetch(`/api/v1/feed/user/${uid}/?count=6`, { headers: H, credentials: 'include' });
  const j1 = await f1.json();
  out.page1 = { status: f1.status, items: j1.items ?.length, nextMaxId: j1.next_max_id ? 'PRESENTE' : null, sample: (j1.items || []).slice(0, 2).map(norm) };

  await sleep(2500);

  // 3) pagina 2 (cursor) → conferma avanzamento
  if (j1.next_max_id) {
    const f2 = await fetch(`/api/v1/feed/user/${uid}/?count=6&max_id=${encodeURIComponent(j1.next_max_id)}`, { headers: H, credentials: 'include' });
    const j2 = await f2.json();
    out.page2 = { status: f2.status, items: j2.items ?.length, nextMaxId: j2.next_max_id ? 'PRESENTE' : null, advances: j2.items ?.[0] ?.pk !== j1.items ?.[0] ?.pk };
  }

  // 4) commenti del primo post
  await sleep(1500);
  try {
    const mid = j1.items ?.[0] ?.pk;
    const cr = await fetch(`/api/v1/media/${mid}/comments/?can_support_threading=true&permalink_enabled=false`, { headers: H, credentials: 'include' });
    out.comments = { status: cr.status };
    if (cr.ok) { const cj = await cr.json(); out.comments.count = cj.comments ?.length ?? 0; out.comments.sample = cj.comments ?.[0] ? { text: cj.comments[0].text ?.slice(0, 40), user: cj.comments[0].user ?.username, likes: cj.comments[0].comment_like_count } : null; }
  } catch (e) { out.comments = { error: e.message }; }

  return out;
})()
