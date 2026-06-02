/* ============================================================================
 * InstaGhost · extract-profile.js  (Driver A, via Chrome controllata su CDP)
 * Prende: handle + N post (dal più recente a ritroso). Produce output PULITO
 * per LLM (Markdown) + JSON normalizzato (schema-03).
 *
 * Uso:
 *   CDP_PORT=9333 NODE_PATH=/tmp/instaghost-cdp/node_modules \
 *     node extract-profile.js <handle> <N> [comments|nocomments]
 * ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { toMarkdown } = require('./lib-render');

const PORT = process.env.CDP_PORT || 9333;
const HANDLE = (process.argv[2] || 'ingiroconalice').replace(/^@/, '').replace(/\/+$/, '');
const N = parseInt(process.argv[3] || '60', 10);
const WITH_COMMENTS = (process.argv[4] || 'comments') !== 'nocomments';
const OUT_DIR = path.resolve(__dirname, '../output');

const getJSON = (p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0, 200))); } });
  }).on('error', reject);
});

// ---- funzione che gira DENTRO la pagina instagram.com (sessione loggata) ----
function buildExpression(handle, n, withComments) {
  return `(async () => {
    const APP_ID='936619743392459';
    const HANDLE=${JSON.stringify(handle)}, N=${n}, WITH_COMMENTS=${withComments};
    const MIN=1500, MAX=3500;
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const jit=()=>Math.floor(MIN+Math.random()*(MAX-MIN));
    const ck=n=>document.cookie.split('; ').find(c=>c.startsWith(n+'='))?.split('=')[1]||null;
    const H={'x-ig-app-id':APP_ID,'x-csrftoken':ck('csrftoken')||'','x-requested-with':'XMLHttpRequest'};
    const get=async u=>{const r=await fetch(u,{headers:H,credentials:'include'});return{status:r.status,ok:r.ok,json:r.ok?await r.json():null};};
    const p=await get('/api/v1/users/web_profile_info/?username='+encodeURIComponent(HANDLE));
    const u=p.json?.data?.user;
    if(!u) return {error:'profilo non accessibile', status:p.status};
    const profile={handle:HANDLE,userId:u.id,fullName:u.full_name,biography:u.biography,
      followers:u.edge_followed_by?.count,following:u.edge_follow?.count,postsTotal:u.edge_owner_to_timeline_media?.count,
      isVerified:u.is_verified,isPrivate:u.is_private,externalUrl:u.external_url||null,category:u.category_name||u.category||null};
    if(u.is_private) return {profile, posts:[], note:'account privato'};
    const TY={1:'image',2:'video',8:'carousel'};
    const audio=it=>{const cm=it.clips_metadata;if(!cm)return null;const mi=cm.music_info?.music_asset_info,os=cm.original_sound_info;
      return {title:mi?.title||os?.original_audio_title||null,artist:mi?.display_artist||os?.ig_artist?.username||null,isOriginal:!!os};};
    const norm=it=>({
      id:it.pk, shortcode:it.code, permalink:'https://www.instagram.com/p/'+it.code+'/',
      date:new Date((it.taken_at||0)*1000).toISOString(), type:TY[it.media_type]||String(it.media_type), productType:it.product_type||null,
      isPinned:(it.timeline_pinned_user_ids||[]).length>0,
      caption:it.caption?.text||'',
      hashtags:(it.caption?.text?.match(/#[\\wÀ-ſ]+/gu)||[]).map(h=>h.slice(1)),
      mentions:(it.caption?.text?.match(/@[\\w._]+/g)||[]).map(m=>m.slice(1)),
      likeCount: it.like_and_view_counts_disabled? null : (it.like_count??null),
      commentCount:it.comment_count??null, playCount:it.play_count??it.ig_play_count??null,
      carouselCount:it.carousel_media_count??null,
      location:it.location?{name:it.location.name,lat:it.location.lat,lng:it.location.lng,city:it.location.city||null}:null,
      audio:audio(it),
      coauthors:(it.coauthor_producers||[]).map(c=>c.username),
      taggedUsers:(it.usertags?.in||[]).map(t=>t.user?.username).filter(Boolean),
      isPaidPartnership:!!it.is_paid_partnership,
      topComments:[]
    });
    const posts=[]; let cursor=null;
    while(posts.length<N){
      const f=await get('/api/v1/feed/user/'+u.id+'/?count=12'+(cursor?'&max_id='+encodeURIComponent(cursor):''));
      if(!f.ok||!f.json?.items?.length) break;
      for(const it of f.json.items){ if(posts.length>=N) break; posts.push(norm(it)); }
      cursor=f.json.next_max_id; if(!cursor) break;
      await sleep(jit());
    }
    if(WITH_COMMENTS){
      for(const post of posts){
        try{
          const cr=await get('/api/v1/media/'+post.id+'/comments/?can_support_threading=true&permalink_enabled=false');
          post.topComments=(cr.json?.comments||[]).slice(0,5).map(c=>({user:c.user?.username,text:c.text,likes:c.comment_like_count,at:new Date((c.created_at||0)*1000).toISOString()}));
        }catch(e){}
        await sleep(jit());
      }
    }
    return {profile, scrapedAt:new Date().toISOString(), requested:N, count:posts.length, posts};
  })()`;
}

(async () => {
  const ver = await getJSON('/json/version');
  const wsUrl = `ws://127.0.0.1:${PORT}${new URL(ver.webSocketDebuggerUrl).pathname}`;
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  let id = 0; const pending = new Map();
  const cmd = (method, params = {}, sessionId) => new Promise((res, rej) => { const m = ++id; pending.set(m, { res, rej }); ws.send(JSON.stringify(sessionId ? { id: m, method, params, sessionId } : { id: m, method, params })); });
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { const x = pending.get(m.id); pending.delete(m.id); m.error ? x.rej(new Error(JSON.stringify(m.error))) : x.res(m.result); } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', e => rej(new Error('ws: ' + e.message))); });

  let { targetInfos } = await cmd('Target.getTargets');
  let page = targetInfos.find(t => t.type === 'page' && (t.url || '').includes('instagram.com'));
  if (!page) { const { targetId } = await cmd('Target.createTarget', { url: 'https://www.instagram.com/' }); page = { targetId }; }
  const { sessionId } = await cmd('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await cmd('Runtime.enable', {}, sessionId);

  console.error(`→ estraggo @${HANDLE}, N=${N}, commenti=${WITH_COMMENTS} … (pacing 1.5-3.5s/req, può richiedere qualche minuto)`);
  const r = await cmd('Runtime.evaluate', { expression: buildExpression(HANDLE, N, WITH_COMMENTS), awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true, timeout: 600000 }, sessionId);
  if (r.exceptionDetails) { console.error('EXCEPTION:', JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails)); process.exit(3); }
  const data = r.result.value;
  if (data.error) { console.error('ERRORE:', data.error, data.status || ''); process.exit(4); }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = path.join(OUT_DIR, `${HANDLE}-${ts}`);
  fs.writeFileSync(base + '.json', JSON.stringify(data, null, 2));
  fs.writeFileSync(base + '.md', toMarkdown(data));
  console.error(`✅ ${data.count} post estratti.`);
  console.error('JSON: ' + base + '.json');
  console.error('MD  : ' + base + '.md');
  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
