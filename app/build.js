// Build the Cowork artifact: app/dist/family-office.html (data kept in the artifact's browser storage).
// --claude builds the claude.ai artifact instead: app/dist/family-office.claude.html — no data inside;
// records live in the artifact's private per-user database (see store.js).
// --web builds the website (Vercel): app/dist/web/index.html — no data inside; each browser keeps its
// own records in localStorage, loaded once from a Backup JSON.
// For Claude Code / local use, run the server instead (npm start) — same page, data in data/state/.
const fs = require('fs'), path = require('path');
const { assemble, ROOT } = require('./lib/assemble');
const claude = process.argv.includes('--claude'), web = process.argv.includes('--web');
const { html, seed, inbox } = assemble({ claude, web });
const out = path.join(__dirname, 'dist', claude ? 'family-office.claude.html' : web ? 'web/index.html' : 'family-office.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('built ' + path.relative(ROOT, out) + ' (' + Math.round(html.length / 1024) + ' KB) · '
  + (claude ? 'claude.ai artifact, no data embedded' : web ? 'website (Vercel), no data embedded'
    : 'seed ' + seed.seedSource + ' · ' + seed.transactions.length + ' txns · ' + seed.prices.length + ' prices · ' + inbox.files.length + ' bank statement file(s)'));
