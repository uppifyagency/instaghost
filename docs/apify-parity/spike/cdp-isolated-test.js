/* Test decisivo: la fetch /api/v1 funziona da un MONDO ISOLATO (equivalente al
 * content-script di un'estensione) oltre che dal main world? Usa
 * Page.createIsolatedWorld per creare un contesto isolato nella pagina IG e vi
 * esegue la web_profile_info; confronta con il main world. */
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9333;
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); });

const FETCH = `(async () => {
  const TARGET = location.pathname.split('/').filter(Boolean)[0] || 'instagram';
  const csrf = document.cookie.split('; ').find(c=>c.startsWith('csrftoken='))?.split('=')[1]||'';
  const r = await fetch('/api/v1/users/web_profile_info/?username='+encodeURIComponent(TARGET),{headers:{'x-ig-app-id':'936619743392459','x-csrftoken':csrf,'x-requested-with':'XMLHttpRequest'},credentials:'include'});
  const ct=r.headers.get('content-type')||''; let userId=null,followers=null;
  if(ct.includes('json')){const j=await r.json();userId=j?.data?.user?.id||null;followers=j?.data?.user?.edge_followed_by?.count??null;}
  return {target:TARGET,status:r.status,contentType:ct,hasCsrf:!!csrf,userId,followers,ok:!!userId};
})()`;

(async () => {
  const ver = await getJSON('/json/version');
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}${new URL(ver.webSocketDebuggerUrl).pathname}`, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  let id = 0; const pending = new Map();
  const cmd = (method, params = {}, sessionId) => new Promise((res, rej) => { const m = ++id; pending.set(m, { res, rej }); ws.send(JSON.stringify(sessionId ? { id: m, method, params, sessionId } : { id: m, method, params })); });
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { const x = pending.get(m.id); pending.delete(m.id); m.error ? x.rej(new Error(JSON.stringify(m.error))) : x.res(m.result); } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', e => rej(new Error('ws: ' + e.message))); });

  const { targetInfos } = await cmd('Target.getTargets');
  const page = targetInfos.find(t => t.type === 'page' && (t.url || '').includes('instagram.com'));
  if (!page) { console.error('nessuna tab instagram.com'); process.exit(2); }
  const { sessionId } = await cmd('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await cmd('Runtime.enable', {}, sessionId);
  await cmd('Page.enable', {}, sessionId);

  // main world (riferimento)
  const main = await cmd('Runtime.evaluate', { expression: FETCH, awaitPromise: true, returnByValue: true }, sessionId);

  // mondo isolato (≈ content-script)
  const { frameTree } = await cmd('Page.getFrameTree', {}, sessionId);
  const frameId = frameTree.frame.id;
  const { executionContextId } = await cmd('Page.createIsolatedWorld', { frameId, worldName: 'instaghost_iso', grantUniveralAccess: false }, sessionId);
  const iso = await cmd('Runtime.evaluate', { expression: FETCH, awaitPromise: true, returnByValue: true, contextId: executionContextId }, sessionId);

  console.log(JSON.stringify({
    pageUrl: page.url,
    main_world: main.result.value || main.exceptionDetails,
    isolated_world: iso.result.value || iso.exceptionDetails
  }, null, 2));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
