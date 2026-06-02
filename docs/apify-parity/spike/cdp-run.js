/* Runner CDP robusto via BROWSER endpoint + Target API (Chrome 148-safe).
 * Esegue un'espressione JS in una tab Instagram della Chrome controllata su :9333.
 *
 * Uso:
 *   CDP_PORT=9333 [CDP_OPEN=https://www.instagram.com/] node cdp-run.js <file-espressione.js>
 * Env:
 *   CDP_MATCH  substring per trovare la tab (default "instagram.com")
 *   CDP_OPEN   se nessuna tab matcha, ne crea una a questo URL
 */
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

const PORT = process.env.CDP_PORT || 9333;
const MATCH = process.env.CDP_MATCH || 'instagram.com';
const OPEN_URL = process.env.CDP_OPEN || '';
const exprFile = process.argv[2];
const expression = exprFile ? fs.readFileSync(exprFile, 'utf8') : (process.env.CDP_EXPR || 'location.href');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const getJSON = (path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path }, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('json non valido: ' + d.slice(0, 200))); } });
  }).on('error', reject);
});

(async () => {
  const ver = await getJSON('/json/version');
  // Chrome può restituire un host senza porta a seconda dell'Host header → forziamo 127.0.0.1:PORT
  const wsUrl = `ws://127.0.0.1:${PORT}${new URL(ver.webSocketDebuggerUrl).pathname}`;
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  let id = 0; const pending = new Map();
  const cmd = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const m = ++id; pending.set(m, { res, rej });
    ws.send(JSON.stringify(sessionId ? { id: m, method, params, sessionId } : { id: m, method, params }));
  });
  ws.on('message', data => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); }
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', e => rej(new Error('ws: ' + e.message))); });

  // 1) trova o crea la tab
  let { targetInfos } = await cmd('Target.getTargets');
  let page = targetInfos.find(t => t.type === 'page' && (t.url || '').includes(MATCH));
  if (!page) {
    const openTo = OPEN_URL || 'https://www.instagram.com/';
    const { targetId } = await cmd('Target.createTarget', { url: openTo });
    page = { targetId, url: openTo };
    console.error('→ creata tab:', openTo);
  } else {
    console.error('→ tab esistente:', page.url);
  }

  // 2) attach (flatten → sessionId)
  const { sessionId } = await cmd('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await cmd('Runtime.enable', {}, sessionId);

  // 3) attendi che la pagina REALE (instagram.com, non about:blank) sia pronta
  for (let i = 0; i < 40; i++) {
    try {
      const rs = await cmd('Runtime.evaluate', { expression: 'document.readyState+"|"+location.href', returnByValue: true }, sessionId);
      const v = rs.result.value || '';
      if ((v.startsWith('complete') || v.startsWith('interactive')) && v.includes(MATCH)) { console.error('→ stato:', v); break; }
    } catch (_) {}
    await sleep(500);
  }

  // 4) esegui l'espressione vera (retry sul context perso durante la navigazione)
  let r;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true }, sessionId);
      break;
    } catch (e) {
      if (/-32000|execution context/i.test(e.message) && attempt < 4) { await sleep(800); continue; }
      throw e;
    }
  }
  if (r.exceptionDetails) {
    console.error('EXCEPTION:', JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails, null, 2));
    process.exit(3);
  }
  console.log(JSON.stringify(r.result.value, null, 2));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
