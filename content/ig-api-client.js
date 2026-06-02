/**
 * IgApiClient — Driver A: extraction via Instagram's internal web APIs, from the
 * user's logged-in session (content-script, isolated world → same-origin,
 * first-party cookies). Validated by the spike (see docs/apify-parity/spike).
 *
 * Endpoints used (confirmed):
 *   GET /api/v1/users/web_profile_info/?username=X   (profile + userId)
 *   GET /api/v1/feed/user/{userId}/?count=N&max_id=… (paginated posts)
 *   GET /api/v1/media/{mediaId}/comments/            (comments)
 *
 * Reuses RateLimiter (libs/rate-limiter.js) for anti-detection cadence: the
 * ban risk is on the ACCOUNT making the requests (the logged-in one).
 */
class IgApiClient {
  constructor(opts = {}) {
    this.appId = '936619743392459';
    this.onProgress = opts.onProgress || (() => {});
    this.rateLimiter = opts.rateLimiter ||
      (typeof RateLimiter !== 'undefined' ? new RateLimiter(opts.mode || 'hybrid') : null);
  }

  _cookie(name) {
    return document.cookie.split('; ').find(c => c.startsWith(name + '='))?.split('=')[1] || null;
  }

  _headers() {
    return {
      'x-ig-app-id': this.appId,
      'x-csrftoken': this._cookie('csrftoken') || '',
      'x-requested-with': 'XMLHttpRequest',
    };
  }

  async _get(url) {
    if (this.rateLimiter) await this.rateLimiter.waitForSlot();
    let res;
    try {
      res = await fetch(url, { headers: this._headers(), credentials: 'include' });
    } catch (e) {
      throw new Error('network: ' + e.message);
    }
    if (!res.ok) {
      if (this.rateLimiter) this.rateLimiter.recordError(res.status);
      const err = new Error('HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    if (this.rateLimiter) this.rateLimiter.recordSuccess();
    return res.json();
  }

  // --- atomic calls ---

  async getProfileRaw(handle) {
    const j = await this._get(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`);
    const u = j?.data?.user;
    if (!u) { const e = new Error('profile not accessible'); e.code = 'no_user'; throw e; }
    return u;
  }

  getPostsPage(userId, cursor) {
    const url = `/api/v1/feed/user/${userId}/?count=12` + (cursor ? `&max_id=${encodeURIComponent(cursor)}` : '');
    return this._get(url);
  }

  getCommentsRaw(mediaId) {
    return this._get(`/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false`);
  }

  // --- high level: handle + N → normalized dataset ---

  /**
   * @param {string} handle  username (with or without @, URL also accepted)
   * @param {{limit?:number, withComments?:boolean, signal?:{aborted:boolean}}} opts
   * @returns {Promise<{profile, scrapedAt, requested, count, posts}>}
   */
  async scrapeProfile(handle, opts = {}) {
    const limit = Math.max(1, opts.limit || 60);
    const withComments = opts.withComments !== false;
    const signal = opts.signal || { aborted: false };
    handle = String(handle).trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?].*$/, '');

    const rawUser = await this.getProfileRaw(handle);
    const profile = IgNormalizer.profile(handle, rawUser);
    this.onProgress({ phase: 'profile', profile });

    if (rawUser.is_private) {
      return { profile, scrapedAt: new Date().toISOString(), requested: limit, count: 0, posts: [], note: 'private account' };
    }

    // collect posts (newest first; IG puts pinned ones on top, the renderer re-sorts by date)
    const raw = [];
    let cursor = null;
    while (raw.length < limit && !signal.aborted) {
      const page = await this.getPostsPage(rawUser.id, cursor);
      const items = page.items || [];
      if (!items.length) break;
      for (const it of items) { if (raw.length >= limit) break; raw.push(it); }
      this.onProgress({ phase: 'posts', collected: raw.length, limit });
      cursor = page.next_max_id;
      if (!cursor) break;
    }

    const posts = raw.map(IgNormalizer.post);

    if (withComments && !signal.aborted) {
      for (let i = 0; i < posts.length && !signal.aborted; i++) {
        try {
          const cj = await this.getCommentsRaw(posts[i].id);
          posts[i].topComments = (cj.comments || []).slice(0, 5).map(IgNormalizer.comment);
        } catch (_) { posts[i].topComments = []; }
        this.onProgress({ phase: 'comments', done: i + 1, total: posts.length });
      }
    }

    return { profile, scrapedAt: new Date().toISOString(), requested: limit, count: posts.length, posts };
  }
}

if (typeof window !== 'undefined') window.IgApiClient = IgApiClient;
