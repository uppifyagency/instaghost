/**
 * ig-driver.js — Driver A orchestrator inside the content-script.
 * Receives commands from the side panel (via chrome.tabs.sendMessage), runs
 * IgApiClient.scrapeProfile, sends progress to the side panel and routes the
 * result (Markdown + JSON) to the service worker for download.
 */
(() => {
  let running = false;
  let abort = { aborted: false };

  /** detect whether we're on a profile page and derive its handle */
  function detectProfile() {
    const segs = location.pathname.split('/').filter(Boolean);
    const reserved = ['p', 'reel', 'reels', 'explore', 'direct', 'stories', 'accounts', 'about', 'legal', 'developer'];
    const isProfile = segs.length === 1 && !reserved.includes(segs[0].toLowerCase());
    return { isProfile, handle: isProfile ? segs[0] : null, url: location.href };
  }

  function send(msg) { try { chrome.runtime.sendMessage(msg); } catch (_) {} }

  const _safe = s => String(s == null ? '' : s).replace(/[^\w.-]+/g, '_');
  const _ext = (url, type) => {
    const m = String(url).split('?')[0].match(/\.(jpg|jpeg|png|webp|heic|mp4|mov)$/i);
    if (m) { const e = m[1].toLowerCase(); return e === 'jpeg' ? 'jpg' : e; }
    return type === 'video' ? 'mp4' : 'jpg';
  };
  /** list of {url, filename} media items; numbering = chronological render order (#n in the guide) */
  function buildMediaManifest(data) {
    const handle = _safe(data.profile.handle);
    const posts = IgRender.sortRecentFirst(data.posts);
    const pad = n => String(n).padStart(3, '0');
    const items = [];
    posts.forEach((p, i) => {
      const media = p.media || [];
      media.forEach((m, k) => {
        if (!m || !m.url) return;
        const slide = media.length > 1 ? `-${k + 1}` : '';
        items.push({ url: m.url, filename: `${handle}/${pad(i + 1)}-${_safe(p.shortcode || p.id)}${slide}.${_ext(m.url, m.type)}` });
      });
    });
    return items;
  }

  async function extract({ handle, limit, withComments, withMedia }) {
    if (running) return { success: false, error: 'already_running' };
    running = true; abort = { aborted: false };
    const t0 = Date.now();
    try {
      const client = new IgApiClient({
        mode: 'hybrid',
        onProgress: (p) => send({ action: 'ig_progress', ...p }),
      });
      const data = await client.scrapeProfile(handle, { limit, withComments, signal: abort });

      const markdown = IgRender.toMarkdown(data);
      const json = JSON.stringify(data, null, 2);
      const base = `${data.profile.handle}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

      // auto-save (files stay safe in the Downloads folder)
      send({ action: 'ig_download', filenameBase: base, markdown, json });

      // optional: download photos/videos (one entry per carousel slide)
      let mediaCount = 0;
      if (withMedia && !abort.aborted) {
        const items = buildMediaManifest(data);
        mediaCount = items.length;
        if (items.length) send({ action: 'ig_download_media', handle: data.profile.handle, items });
      }

      // RESULT as a broadcast (robust: the request channel's sendResponse does
      // not survive a scrape that takes minutes; broadcasts do, like the progress ones)
      send({
        action: 'ig_result',
        success: true,
        handle: data.profile.handle,
        count: data.count,
        mediaCount,
        commentsCount: data.posts.reduce((s, p) => s + (p.topComments ? p.topComments.length : 0), 0),
        placesCount: new Set(data.posts.filter(p => p.location && p.location.name).map(p => p.location.name)).size,
        followers: data.profile.followers ?? null,
        note: data.note || null,
        filenameBase: base,
        markdown,
        json,
        elapsedMs: Date.now() - t0,
      });
    } catch (e) {
      send({ action: 'ig_result', success: false, error: e.message, status: e.status || null });
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message?.action) {
      case 'ig_detect':
        sendResponse(detectProfile());
        return false;
      case 'ig_extract':
        // async start; the outcome arrives via the 'ig_result' broadcast
        extract({
          handle: message.handle,
          limit: Math.max(1, parseInt(message.limit, 10) || 60),
          withComments: message.withComments !== false,
          withMedia: !!message.withMedia,
        });
        sendResponse({ accepted: true });
        return false;
      case 'ig_abort':
        abort.aborted = true;
        sendResponse({ success: true });
        return false;
      default:
        return false;
    }
  });

  console.log('🟢 InstaGhost Driver A ready on', location.hostname);
})();
