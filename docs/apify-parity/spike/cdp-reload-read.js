/* Ricarica la tab IG (così i content-script dell'estensione installata rigirano)
 * e legge i data-attribute scritti dalla slice (isolated + main world). */
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); });

(async () => {
  const ver = await getJSON('/json/version');
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}${new URL(ver.webSocketDebuggerUrl).pathname}`, { perMessageDeflate: false });
  let id = 0; const pending = new Map();
  const cmd = (method, params = {}, sessionId) => new Promise((res, rej) => { const m = ++id; pending.set(m, { res, rej }); ws.send(JSON.stringify(sessionId ? { id: m, method, params, sessionId } : { id: m, method, params })); });
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { const x = pending.get(m.id); pending.delete(m.id); m.error ? x.rej(new Error(JSON.stringify(m.error))) : x.res(m.result); } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', e => rej(new Error('ws: ' + e.message))); });

  const { targetInfos } = await cmd('Target.getTargets');
  const page = targetInfos.find(t => t.type === 'page' && (t.url || '').includes('instagram.com'));
  if (!page) { console.error('nessuna tab instagram.com'); process.exit(2); }
  const { sessionId } = await cmd('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await cmd('Page.enable', {}, sessionId);
  await cmd('Runtime.enable', {}, sessionId);
  await cmd('Page.reload', { ignoreCache: false }, sessionId);

  const readExpr = `JSON.stringify({iso:document.documentElement.getAttribute('data-slice-iso'),main:document.documentElement.getAttribute('data-slice-main'),url:location.href})`;
  let parsed = { iso: null, main: null };
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const r = await cmd('Runtime.evaluate', { expression: readExpr, returnByValue: true }, sessionId);
      const v = JSON.parse(r.result.value);
      parsed = { iso: v.iso ? JSON.parse(v.iso) : null, main: v.main ? JSON.parse(v.main) : null, url: v.url };
      if (parsed.iso && parsed.main) break;
    } catch (_) { /* context perso durante reload → riprova */ }
  }
  console.log(JSON.stringify({ source: 'estensione installata (reload)', ...parsed }, null, 2));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
