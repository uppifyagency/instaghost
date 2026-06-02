/* Rendering condiviso (v2): trasforma il JSON normalizzato in un KNOWLEDGE BASE
 * Markdown ottimizzato per LLM, pensato per comporre guide di nicchia (Bologna):
 *  - indice luoghi taggati (geo), luoghi nominati nelle caption (📌), venue (@),
 *    hashtag ricorrenti, post raggruppati per tema
 *  - dettaglio per post arricchito (temi + luoghi citati)
 * Tutto derivato dal JSON: nessuna richiesta di rete.
 */

const num = n => (n == null ? '' : Number(n).toLocaleString('it-IT'));

function sortRecentFirst(posts) {
  return [...posts].sort((a, b) => new Date(b.date) - new Date(a.date));
}

// --- estrazione entità (euristiche, no rete) ---------------------------------

// luoghi nominati dopo un pin emoji nelle caption: "📌Piazza Grande, ..." -> "Piazza Grande"
function extractPinPlaces(caption) {
  if (!caption) return [];
  const re = /[📌📍🔖🗺]\s*([^\n,.;:!?()]{2,70})/gu;
  const out = [];
  let m;
  while ((m = re.exec(caption))) {
    const s = m[1].trim();
    if (s.length >= 2 && !/^https?:/i.test(s)) out.push(s);
  }
  return [...new Set(out)];
}

// classificazione tematica per parole chiave (caption + hashtag)
const THEMES = {
  '🍽️ Mangiare & bere': ['ristorant', 'trattoria', 'osteria', 'tavola', 'aperitivo', 'apericena', 'mangiare', 'cucina', 'pizz', 'gelat', 'gelateria', 'forno', 'panin', 'piadin', 'brunch', 'colazione', 'menu', 'menù', 'piatto', 'vino', 'enotec', 'birr', 'cocktail', 'caffè', 'caffe', 'bistrot', 'street food', 'tigell', 'crescentin', 'tortellin', 'pasta', 'dolc'],
  '🎭 Eventi': ['evento', 'eventi', 'festival', 'mostra', 'concerto', 'rassegna', 'sagra', 'mercatino', 'fiera', 'spettacolo', 'live', 'dj set', 'presentazione', 'inaugurazione', 'in scena', 'al teatro'],
  '🚶 Cose da fare / itinerari': ['gita', 'itinerario', 'tappa', 'da visitare', 'visitare', 'passeggiata', 'tour', 'cosa fare', 'weekend', 'borgo', 'museo', 'parco', 'escursion', 'giro', 'scopr', 'angolo', 'piazza', 'palazzo', 'basilica', 'portic'],
  '📚 Libri & cultura': ['libr', 'libreria', 'lettura', 'romanzo', 'cinema', 'film', 'book club', 'autore', 'autrice', 'poesia', 'mostra', 'biblioteca', 'scrittore', 'scrittrice'],
};
function classifyThemes(post) {
  const hay = ((post.caption || '') + ' ' + (post.hashtags || []).join(' ')).toLowerCase();
  return Object.entries(THEMES).filter(([, kws]) => kws.some(k => hay.includes(k))).map(([t]) => t);
}

// aggregatore generico: map chiave -> { count, posts:Set(numeri) }
function tally(posts, getKeys) {
  const map = new Map();
  for (const post of posts) {
    for (const key of getKeys(post)) {
      if (!key) continue;
      if (!map.has(key)) map.set(key, { count: 0, posts: [] });
      const e = map.get(key); e.count++; e.posts.push(post._n);
    }
  }
  return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
}

// --- markdown ----------------------------------------------------------------

function toMarkdown(data) {
  const p = data.profile;
  const posts = sortRecentFirst(data.posts).map((post, i) => ({ ...post, _n: i + 1 }));
  posts.forEach(post => { post._pins = extractPinPlaces(post.caption); post._themes = classifyThemes(post); });

  const refs = ns => ns.map(n => `#${n}`).join(', ');
  const L = [];

  // intestazione
  L.push(`# Knowledge base Instagram — @${p.handle}${p.fullName ? ' (' + p.fullName + ')' : ''}`);
  L.push('');
  L.push(`> ${num(p.followers)} follower · ${num(p.postsTotal)} post totali · ${data.count} estratti (cronologico, dal più recente)${p.category ? ' · ' + p.category : ''}`);
  if (p.biography) L.push(`> Bio: ${p.biography.replace(/\n/g, ' ')}`);
  if (p.externalUrl) L.push(`> Link: ${p.externalUrl}`);
  L.push(`> Estratto: ${data.scrapedAt} · Fonte: Instagram (dati pubblici)`);
  L.push('');
  L.push('> **Come usare questo file:** è una base dati per comporre una guida. La PARTE 1 indicizza luoghi, venue e temi (con riferimenti `#n` ai post). La PARTE 2 contiene i post completi numerati.');
  L.push('\n---\n');

  // PARTE 1 — indici
  L.push('# PARTE 1 — Indici\n');

  const geo = tally(posts, x => x.location ? [x.location.name] : []);
  if (geo.length) {
    L.push('## 🗺️ Luoghi taggati (geolocalizzati)');
    for (const [name, e] of geo) {
      const loc = posts.find(x => x.location && x.location.name === name).location;
      L.push(`- **${name}**${loc.lat ? ` (${loc.lat}, ${loc.lng})` : ''} — ${e.count} post: ${refs(e.posts)}`);
    }
    L.push('');
  }

  const pins = tally(posts, x => x._pins);
  if (pins.length) {
    L.push('## 📌 Luoghi nominati nelle caption');
    for (const [name, e] of pins) L.push(`- ${name} — ${refs(e.posts)}`);
    L.push('');
  }

  const mentions = tally(posts, x => [
    ...(x.mentions || []),
    ...((x.topComments || []).flatMap(c => (c.text || '').match(/@[\w.]+/g) || []).map(s => s.slice(1))),
  ]);
  if (mentions.length) {
    L.push('## 🏷️ Account / venue citati (@)');
    for (const [u, e] of mentions.slice(0, 60)) L.push(`- @${u} (${e.count}) — ${refs(e.posts.slice(0, 12))}`);
    L.push('');
  }

  const tags = tally(posts, x => (x.hashtags || []).map(h => h.toLowerCase()));
  if (tags.length) {
    L.push('## #️⃣ Hashtag ricorrenti');
    L.push(tags.slice(0, 40).map(([h, e]) => `#${h} (${e.count})`).join(' · '));
    L.push('');
  }

  L.push('## 🧭 Post per tema');
  const byTheme = tally(posts, x => x._themes.length ? x._themes : ['❓ Altro / non classificato']);
  for (const [theme, e] of byTheme) L.push(`- **${theme}** (${e.count}): ${refs(e.posts)}`);
  L.push('\n---\n');

  // PARTE 2 — post
  L.push('# PARTE 2 — Post (cronologico)\n');
  posts.forEach(post => {
    const eng = [
      post.likeCount != null ? num(post.likeCount) + ' like' : null,
      post.commentCount != null ? post.commentCount + ' commenti' : null,
      post.playCount ? num(post.playCount) + ' play' : null,
    ].filter(Boolean).join(' · ');
    L.push(`## #${post._n} · ${post.date.slice(0, 10)} · ${post.type}${post.productType === 'clips' ? ' (reel)' : ''}${post.isPinned ? ' 📌 fissato' : ''}`);
    if (post._themes.length) L.push(`🧭 ${post._themes.join(' · ')}`);
    if (post.location) L.push(`📍 **${post.location.name}**${post.location.lat ? ` (${post.location.lat}, ${post.location.lng})` : ''}`);
    if (post._pins.length) L.push(`📌 Luoghi citati: ${post._pins.join(' · ')}`);
    if (eng) L.push(`📊 ${eng}`);
    if (post.audio && (post.audio.title || post.audio.artist)) L.push(`🎵 ${[post.audio.title, post.audio.artist].filter(Boolean).join(' — ')}${post.audio.isOriginal ? ' (originale)' : ''}`);
    if (post.coauthors && post.coauthors.length) L.push(`🤝 con: ${post.coauthors.map(c => '@' + c).join(', ')}`);
    if (post.isPaidPartnership) L.push(`💼 sponsorizzato`);
    L.push(`🔗 ${post.permalink}`);
    if (post.caption) { L.push(''); L.push('**Caption:**'); L.push(post.caption); }
    if (post.hashtags && post.hashtags.length) L.push(`\n*Hashtag:* ${post.hashtags.map(h => '#' + h).join(' ')}`);
    if (post.topComments && post.topComments.length) {
      L.push('\n**Primi commenti:**');
      post.topComments.forEach(c => L.push(`- @${c.user} (${c.likes}❤): ${(c.text || '').replace(/\n/g, ' ')}`));
    }
    L.push('\n---\n');
  });

  return L.join('\n');
}

module.exports = { toMarkdown, sortRecentFirst };
