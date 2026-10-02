// Build the Cowork artifact: app/dist/family-office.html (data kept in the artifact's browser storage).
// For Claude Code / local use, run the server instead (npm start) — same page, data in data/state/.
const fs = require('fs'), path = require('path');
const { assemble, ROOT } = require('./lib/assemble');
const { html, seed, inbox } = assemble();
const out = path.join(__dirname, 'dist', 'family-office.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('built ' + path.relative(ROOT, out) + ' (' + Math.round(html.length / 1024) + ' KB) · seed ' + seed.seedSource + ' · '
  + seed.transactions.length + ' txns · ' + seed.prices.length + ' prices · ' + inbox.files.length + ' bank statement file(s)');
