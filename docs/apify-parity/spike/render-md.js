/* Ri-genera il Markdown LLM-friendly da un JSON già estratto (nessuna richiesta
 * di rete). Uso: node render-md.js <file.json> */
const fs = require('fs');
const { toMarkdown } = require('./lib-render');
const f = process.argv[2];
if (!f) { console.error('uso: node render-md.js <file.json>'); process.exit(64); }
const data = JSON.parse(fs.readFileSync(f, 'utf8'));
const out = f.replace(/\.json$/, '') + '-sorted.md';
fs.writeFileSync(out, toMarkdown(data));
console.error('MD ordinato:', out);
