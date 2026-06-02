/* Apre un URL nella Chrome controllata e cattura screenshot dei 3 stati del
 * mockup (idle/running/done). Uso: node cdp-screenshot.js <fileUrl> <outDir> */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9333;
const URL_ARG = process.argv[2];
const OUT = process.argv[3] || '/tmp';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); });

(async () => {
  const ver = await getJSON('/json/version');
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}${new URL(ver.webSocketDebuggerUrl).pathname}`, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  let id = 0; const pending = new Map();
  const cmd = (method, params = {}, s) => new Promise((res, rej) => { const m = ++id; pending.set(m, { res, rej }); ws.send(JSON.stringify(s ? { id: m, method, params, sessionId: s } : { id: m, method, params })); });
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { const x = pending.get(m.id); pending.delete(m.id); m.error ? x.rej(new Error(JSON.stringify(m.error))) : x.res(m.result); } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', e => rej(new Error('ws: ' + e.message))); });

  const { targetId } = await cmd('Target.createTarget', { url: URL_ARG });
  const { sessionId } = await cmd('Target.attachToTarget', { targetId, flatten: true });
  await cmd('Page.enable', {}, sessionId);
  await cmd('Runtime.enable', {}, sessionId);
  await cmd('Emulation.setDeviceMetricsOverride', { width: 432, height: 800, deviceScaleFactor: 2, mobile: false }, sessionId);

  for (let i = 0; i < 30; i++) { const r = await cmd('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sessionId); if (r.result.value === 'complete') break; await sleep(300); }
  await sleep(700); // fonts

  for (const state of ['idle', 'running', 'done']) {
    const setup = `(()=>{const p=document.getElementById('panel');if(!p)return'nopanel';p.dataset.state='${state}';
      const set=(id,prop,v)=>{const e=document.getElementById(id);if(e){if(prop==='text')e.textContent=v;else e.style[prop]=v;}};
      if('${state}'==='running'){set('igPhase','text','Commenti…');set('igNum','text','42/60');set('igFill','width','75%');}
      if('${state}'==='done'){set('igResWho','text','@ingiroconalice');set('igResSub','text','60 post · 286 commenti');}
      return p.dataset.state;})()`;
    await cmd('Runtime.evaluate', { expression: setup, returnByValue: true }, sessionId);
    await sleep(350);
    const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
    const file = path.join(OUT, `mockup-${state}.png`);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('saved', file);
  }
  await cmd('Target.closeTarget', { targetId });
  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
