/* Vertical slice — ISOLATED world (mondo di default dei content-script MV3).
 * Verifica: una fetch same-origin /api/v1 dal content-script di un'estensione
 * installata porta i cookie e risponde JSON? Scrive l'esito su un data-attribute
 * del documento (DOM condiviso) così è leggibile via CDP. */
(async () => {
  const tag = (obj) => document.documentElement.setAttribute('data-slice-iso', JSON.stringify(obj));
  try {
    const TARGET = location.pathname.split('/').filter(Boolean)[0] || 'instagram';
    const csrf = document.cookie.split('; ').find(c => c.startsWith('csrftoken=')) ?.split('=')[1] || '';
    const r = await fetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(TARGET)}`, {
      headers: { 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrf, 'x-requested-with': 'XMLHttpRequest' },
      credentials: 'include'
    });
    const ct = r.headers.get('content-type') || '';
    let userId = null, followers = null;
    if (ct.includes('json')) { const j = await r.json(); userId = j ?.data ?.user ?.id || null; followers = j ?.data ?.user ?.edge_followed_by ?.count ?? null; }
    tag({ world: 'isolated', target: TARGET, status: r.status, contentType: ct, hasCsrf: !!csrf, userId, followers, ok: !!userId });
    console.log('[SLICE-ISO]', r.status, 'userId=', userId);
  } catch (e) {
    tag({ world: 'isolated', error: String(e && e.message || e) });
    console.log('[SLICE-ISO] ERROR', e);
  }
})();
