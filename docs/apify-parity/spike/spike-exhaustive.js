/* Estrazione ESAUSTIVA Driver A su un profilo: profilo + post (2 pagine) +
 * esempio per tipo (immagine / reel+audio / carosello con figli) + commenti.
 * Eseguito via cdp-run.js nella sessione loggata. */
(async () => {
  const APP_ID = '936619743392459';
  const TARGET = '__TARGET__';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const cookie = n => document.cookie.split('; ').find(c => c.startsWith(n + '=')) ?.split('=')[1] || null;
  const H = { 'x-ig-app-id': APP_ID, 'x-csrftoken': cookie('csrftoken') || '', 'x-requested-with': 'XMLHttpRequest' };
  const get = async (url) => { const r = await fetch(url, { headers: H, credentials: 'include' }); return { status: r.status, json: r.ok ? await r.json() : null }; };
  const out = { target: TARGET };

  const p = await get(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(TARGET)}`);
  const u = p.json ?.data ?.user; const uid = u ?.id;
  out.profile = { userId: uid, fullName: u ?.full_name, biography: u ?.biography ?.slice(0, 120), followers: u ?.edge_followed_by ?.count, following: u ?.edge_follow ?.count, posts: u ?.edge_owner_to_timeline_media ?.count, isVerified: u ?.is_verified, isPrivate: u ?.is_private, isBusiness: u ?.is_business_account ?? null, category: u ?.category_name ?? u ?.category ?? null, externalUrl: u ?.external_url || null, profilePicHd: u ?.profile_pic_url_hd || null };
  if (!uid) { out.error = 'no userId'; return out; }

  let items = [], cursor = null;
  for (let pg = 0; pg < 2; pg++) {
    const f = await get(`/api/v1/feed/user/${uid}/?count=12` + (cursor ? `&max_id=${encodeURIComponent(cursor)}` : ''));
    items = items.concat(f.json ?.items || []); cursor = f.json ?.next_max_id || null;
    if (!cursor) break; await sleep(2500);
  }
  out.collected = items.length;
  out.typeBreakdown = { image: items.filter(i => i.media_type === 1).length, reelOrVideo: items.filter(i => i.media_type === 2).length, carousel: items.filter(i => i.media_type === 8).length };

  const audio = it => {
    const cm = it.clips_metadata; if (!cm) return null;
    const mi = cm.music_info ?.music_asset_info; const os = cm.original_sound_info;
    return { kind: os ? 'original' : (mi ? 'licensed' : null), title: mi ?.title || os ?.original_audio_title || null, artist: mi ?.display_artist || os ?.ig_artist ?.username || null, audioId: mi ?.audio_id || os ?.audio_asset_id || null, isOriginal: !!os };
  };
  const full = it => ({
    id: it.pk, code: it.code, url: `https://www.instagram.com/p/${it.code}/`, takenAt: it.taken_at,
    mediaType: ({ 1: 'image', 2: 'video', 8: 'carousel' })[it.media_type] || it.media_type, productType: it.product_type ?? null,
    caption: (it.caption ?.text || '').slice(0, 400),
    hashtags: (it.caption ?.text ?.match(/#[\wÀ-ſ]+/gu) || []).map(h => h.slice(1)),
    mentions: (it.caption ?.text ?.match(/@[\w._]+/g) || []).map(m => m.slice(1)),
    likeCount: it.like_count ?? null, commentCount: it.comment_count ?? null, playCount: it.play_count ?? it.ig_play_count ?? null, reshareCount: it.reshare_count ?? null,
    imageUrl: it.image_versions2 ?.candidates ?.[0] ?.url || null,
    videoUrl: it.video_versions ?.[0] ?.url || null,
    dims: it.original_width ? `${it.original_width}x${it.original_height}` : null, durationSec: it.video_duration ?? null,
    carouselCount: it.carousel_media_count ?? null,
    carousel: (it.carousel_media || []).map(c => ({ type: ({ 1: 'image', 2: 'video' })[c.media_type], img: !!c.image_versions2 ?.candidates ?.[0] ?.url, vid: !!c.video_versions ?.[0] ?.url })),
    location: it.location ? { name: it.location.name, lat: it.location.lat, lng: it.location.lng, city: it.location.city || null } : null,
    audio: audio(it),
    coauthors: (it.coauthor_producers || []).map(c => c.username),
    taggedUsers: (it.usertags ?.in || []).map(t => t.user ?.username),
    isPaidPartnership: it.is_paid_partnership ?? null
  });

  const firstOf = t => items.find(i => i.media_type === t);
  out.example_image = firstOf(1) ? full(firstOf(1)) : 'nessuna immagine singola nei post raccolti';
  out.example_reel = firstOf(2) ? full(firstOf(2)) : 'nessun reel nei post raccolti';
  out.example_carousel = firstOf(8) ? full(firstOf(8)) : 'nessun carosello nei post raccolti';

  await sleep(2000);
  const cmt = firstOf(2) || firstOf(8) || items[0];
  const cr = await get(`/api/v1/media/${cmt.pk}/comments/?can_support_threading=true&permalink_enabled=false`);
  out.comments_for = cmt.code;
  out.comments = (cr.json ?.comments || []).slice(0, 5).map(c => ({ user: c.user ?.username, text: c.text, likes: c.comment_like_count, createdAt: c.created_at, replies: c.child_comment_count ?? 0 }));
  return out;
})()
