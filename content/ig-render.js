/**
 * IgRender — turns the normalized dataset (IgApiClient.scrapeProfile) into an
 * LLM-optimized Markdown KNOWLEDGE BASE (niche guides): indexes of
 * places/venues/themes + per-post detail. Port of docs/apify-parity/spike/lib-render.js.
 *
 * Theme classification is bilingual (EN + IT): the keyword dictionaries below
 * include both English and Italian terms, so profiles in either language are
 * classified correctly. Add more languages by extending each keyword list.
 */
const IgRender = (() => {
  const num = n => (n == null ? '' : Number(n).toLocaleString('en-US'));
  const sortRecentFirst = posts => [...posts].sort((a, b) => new Date(b.date) - new Date(a.date));

  const THEMES = {
    '🍽️ Food & drink': ['restaurant', 'eatery', 'diner', 'brunch', 'breakfast', 'lunch', 'dinner', 'food', 'foodie', 'cuisine', 'pizza', 'burger', 'gelato', 'ice cream', 'bakery', 'sandwich', 'menu', 'dish', 'wine', 'winery', 'beer', 'brewery', 'cocktail', 'coffee', 'cafe', 'bistro', 'street food', 'pasta', 'dessert', 'ristorant', 'trattoria', 'osteria', 'tavola', 'aperitivo', 'apericena', 'mangiare', 'cucina', 'pizz', 'gelat', 'forno', 'panin', 'piadin', 'colazione', 'menù', 'piatto', 'vino', 'enotec', 'birr', 'caffè', 'caffe', 'bistrot', 'tigell', 'crescentin', 'tortellin', 'dolc'],
    '🎭 Events': ['event', 'events', 'festival', 'exhibition', 'exhibit', 'concert', 'gig', 'fair', 'market', 'show', 'live', 'dj set', 'launch', 'opening', 'on stage', 'theatre', 'theater', 'evento', 'eventi', 'mostra', 'concerto', 'rassegna', 'sagra', 'mercatino', 'fiera', 'spettacolo', 'presentazione', 'inaugurazione', 'in scena', 'al teatro'],
    '🚶 Things to do / itineraries': ['trip', 'itinerary', 'stop', 'to visit', 'visit', 'walk', 'tour', 'things to do', 'weekend', 'village', 'museum', 'park', 'hike', 'hiking', 'stroll', 'discover', 'square', 'palace', 'cathedral', 'landmark', 'gita', 'itinerario', 'tappa', 'da visitare', 'visitare', 'passeggiata', 'cosa fare', 'borgo', 'museo', 'parco', 'escursion', 'giro', 'scopr', 'angolo', 'piazza', 'palazzo', 'basilica', 'portic'],
    '📚 Books & culture': ['book', 'books', 'bookshop', 'bookstore', 'reading', 'novel', 'cinema', 'film', 'movie', 'book club', 'author', 'poetry', 'library', 'writer', 'libr', 'libreria', 'lettura', 'romanzo', 'autore', 'autrice', 'poesia', 'biblioteca', 'scrittore', 'scrittrice'],
  };

  const extractPinPlaces = (caption) => {
    if (!caption) return [];
    const re = /[📌📍🔖🗺]\s*([^\n,.;:!?()]{2,70})/gu;
    const out = []; let m;
    while ((m = re.exec(caption))) { const s = m[1].trim(); if (s.length >= 2 && !/^https?:/i.test(s)) out.push(s); }
    return [...new Set(out)];
  };
  const classifyThemes = (post) => {
    const hay = ((post.caption || '') + ' ' + (post.hashtags || []).join(' ')).toLowerCase();
    return Object.entries(THEMES).filter(([, kws]) => kws.some(k => hay.includes(k))).map(([t]) => t);
  };
  const tally = (posts, getKeys) => {
    const map = new Map();
    for (const post of posts) for (const key of getKeys(post)) {
      if (!key) continue;
      if (!map.has(key)) map.set(key, { count: 0, posts: [] });
      const e = map.get(key); e.count++; e.posts.push(post._n);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  };

  function toMarkdown(data) {
    const p = data.profile;
    const posts = sortRecentFirst(data.posts).map((post, i) => ({ ...post, _n: i + 1 }));
    posts.forEach(post => { post._pins = extractPinPlaces(post.caption); post._themes = classifyThemes(post); });
    const refs = ns => ns.map(n => `#${n}`).join(', ');
    const L = [];

    L.push(`# Instagram knowledge base — @${p.handle}${p.fullName ? ' (' + p.fullName + ')' : ''}`);
    L.push('');
    L.push(`> ${num(p.followers)} followers · ${num(p.postsTotal)} total posts · ${data.count} extracted (chronological, newest first)${p.category ? ' · ' + p.category : ''}`);
    if (p.biography) L.push(`> Bio: ${p.biography.replace(/\n/g, ' ')}`);
    if (p.externalUrl) L.push(`> Link: ${p.externalUrl}`);
    L.push(`> Extracted: ${data.scrapedAt} · Source: Instagram (public data)`);
    L.push('');
    L.push('> **Usage:** source dataset for composing a guide. PART 1 = indexes (places/venues/themes with `#n` references). PART 2 = full numbered posts.');
    L.push('\n---\n');

    L.push('# PART 1 — Indexes\n');
    const geo = tally(posts, x => x.location ? [x.location.name] : []);
    if (geo.length) {
      L.push('## 🗺️ Tagged places (geolocated)');
      for (const [name, e] of geo) { const loc = posts.find(x => x.location && x.location.name === name).location; L.push(`- **${name}**${loc.lat ? ` (${loc.lat}, ${loc.lng})` : ''} — ${e.count} posts: ${refs(e.posts)}`); }
      L.push('');
    }
    const pins = tally(posts, x => x._pins);
    if (pins.length) { L.push('## 📌 Places named in captions'); for (const [name, e] of pins) L.push(`- ${name} — ${refs(e.posts)}`); L.push(''); }
    const mentions = tally(posts, x => [...(x.mentions || []), ...((x.topComments || []).flatMap(c => (c.text || '').match(/@[\w.]+/g) || []).map(s => s.slice(1)))]);
    if (mentions.length) { L.push('## 🏷️ Accounts / venues mentioned (@)'); for (const [u, e] of mentions.slice(0, 60)) L.push(`- @${u} (${e.count}) — ${refs(e.posts.slice(0, 12))}`); L.push(''); }
    const tags = tally(posts, x => (x.hashtags || []).map(h => h.toLowerCase()));
    if (tags.length) { L.push('## #️⃣ Recurring hashtags'); L.push(tags.slice(0, 40).map(([h, e]) => `#${h} (${e.count})`).join(' · ')); L.push(''); }
    L.push('## 🧭 Posts by theme');
    const byTheme = tally(posts, x => x._themes.length ? x._themes : ['❓ Other / unclassified']);
    for (const [theme, e] of byTheme) L.push(`- **${theme}** (${e.count}): ${refs(e.posts)}`);
    L.push('\n---\n');

    L.push('# PART 2 — Posts (chronological)\n');
    posts.forEach(post => {
      const eng = [post.likeCount != null ? num(post.likeCount) + ' likes' : null, post.commentCount != null ? post.commentCount + ' comments' : null, post.playCount ? num(post.playCount) + ' plays' : null].filter(Boolean).join(' · ');
      L.push(`## #${post._n} · ${post.date.slice(0, 10)} · ${post.type}${post.productType === 'clips' ? ' (reel)' : ''}${post.isPinned ? ' 📌 pinned' : ''}`);
      if (post._themes.length) L.push(`🧭 ${post._themes.join(' · ')}`);
      if (post.location) L.push(`📍 **${post.location.name}**${post.location.lat ? ` (${post.location.lat}, ${post.location.lng})` : ''}`);
      if (post._pins.length) L.push(`📌 Places mentioned: ${post._pins.join(' · ')}`);
      if (eng) L.push(`📊 ${eng}`);
      if (post.audio && (post.audio.title || post.audio.artist)) L.push(`🎵 ${[post.audio.title, post.audio.artist].filter(Boolean).join(' — ')}${post.audio.isOriginal ? ' (original)' : ''}`);
      if (post.coauthors && post.coauthors.length) L.push(`🤝 with: ${post.coauthors.map(c => '@' + c).join(', ')}`);
      if (post.isPaidPartnership) L.push(`💼 sponsored`);
      if (post.permalink) L.push(`🔗 ${post.permalink}`);
      if (post.caption) { L.push(''); L.push('**Caption:**'); L.push(post.caption); }
      if (post.hashtags && post.hashtags.length) L.push(`\n*Hashtags:* ${post.hashtags.map(h => '#' + h).join(' ')}`);
      if (post.topComments && post.topComments.length) { L.push('\n**Top comments:**'); post.topComments.forEach(c => L.push(`- @${c.user} (${c.likes}❤): ${(c.text || '').replace(/\n/g, ' ')}`)); }
      L.push('\n---\n');
    });
    return L.join('\n');
  }

  return { toMarkdown, sortRecentFirst };
})();

if (typeof window !== 'undefined') window.IgRender = IgRender;
if (typeof module !== 'undefined') module.exports = IgRender;
