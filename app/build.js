// Build the Cowork artifact: app/dist/family-office.html (data kept in the artifact's browser storage).
// --claude builds the claude.ai artifact instead: app/dist/family-office.claude.html — no data inside;
// records live in the artifact's private per-user database (see store.js).
// --web builds the website (Vercel): app/dist/web/index.html — no data inside; each browser keeps its
// own records in localStorage, loaded once from a Backup JSON.
// For Claude Code / local use, run the server instead (npm start) — same page, data in data/state/.
const fs = require('fs'), path = require('path');
const { assemble, ROOT } = require('./lib/assemble');
const claude = process.argv.includes('--claude'), web = process.argv.includes('--web');
// --shared <backup.json>: view-only snapshot with that backup encrypted inside → app/dist/shared/index.html.
// The passphrase comes from OKFO_SHARE_PASS (never from the command line or the repo).
const si = process.argv.indexOf('--shared');
let shared = null;
if (si > 0){
  const file = process.argv[si + 1]; if (!file) throw new Error('usage: node app/build.js --shared <backup.json>  (passphrase in OKFO_SHARE_PASS)');
  shared = { backup: JSON.parse(fs.readFileSync(file, 'utf8')), passphrase: process.env.OKFO_SHARE_PASS };
}
const { html, seed, inbox } = assemble({ claude, web, shared });
const out = path.join(__dirname, 'dist', claude ? 'family-office.claude.html' : web ? 'web/index.html' : shared ? 'shared/index.html' : 'family-office.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
if (shared) fs.writeFileSync(path.join(path.dirname(out), 'vercel.json'), JSON.stringify({ headers: [{ source: '/(.*)', headers: [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Cache-Control', value: 'no-store' }] }] }, null, 2));
console.log('built ' + path.relative(ROOT, out) + ' (' + Math.round(html.length / 1024) + ' KB) · '
  + (claude ? 'claude.ai artifact, no data embedded' : web ? 'website (Vercel), no data embedded' : shared ? 'shared view-only snapshot, ' + shared.backup.transactions.length + ' txns encrypted'
    : 'seed ' + seed.seedSource + ' · ' + seed.transactions.length + ' txns · ' + seed.prices.length + ' prices · ' + inbox.files.length + ' bank statement file(s)'));
