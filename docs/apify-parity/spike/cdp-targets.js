/* Read-only: elenca i target (tab) della Chrome controllata. Non crea nulla, non
 * esegue codice nella pagina. Serve solo a confermare la connessione CDP. */
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9333;
const getJSON = (path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path, headers: { Host: 'localhost' } }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0, 200))); } });
  }).on('error', reject);
});
(async () => {
  const ver = await getJSON('/json/version');
  const ws = new WebSocket(ver.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pending = new Map();
  const cmd = (method, params = {}) => new Promise((res, rej) => { const m = ++id; pending.set(m, { res, rej }); ws.send(JSON.stringify({ id: m, method, params })); });
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', e => rej(new Error('ws: ' + (e && e.message)))); });
  const { targetInfos } = await cmd('Target.getTargets');
  console.log(JSON.stringify(targetInfos.filter(t => t.type === 'page').map(t => ({ url: t.url, title: t.title })), null, 2));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
