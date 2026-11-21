// Assemble app/src/* into one self-contained HTML page. Used by
//   • app/build.js  → app/dist/family-office.html (the Cowork artifact; data in browser storage)
//   • app/server.js → served at http://127.0.0.1:8787 (Claude Code / local; data in data/state/)
// The page embeds: the seed (newest data/backups file + newest data/prices file + the folder-derived
// registry), the statement inbox (every statement in Statements/Bank), and — when served — the saved
// state from data/state/okfo-state.json.
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..'), ROOT = path.join(APP, '..'), SRC = path.join(APP, 'src');
const ORDER = ['engine', 'calc', 'store', 'bridge', 'ledger', 'shell', 'rules', 'cash', 'property', 'insurance', 'dividends', 'boot'];
const REGISTRY_VERSION = 'registry-2026-09-28';

const newest = (dir, re) => { if (!fs.existsSync(dir)) return null; const f = fs.readdirSync(dir).filter(n => re.test(n)).sort().pop(); return f ? path.join(dir, f) : null; };
const jsonForHtml = v => JSON.stringify(v).replace(/</g, '\\u003c');

function buildSeed(root){
  root = root || ROOT;
  const backupPath = newest(path.join(root, 'data', 'backups'), /^portfolio-ledger_backup_.*\.json$/);
  if (!backupPath) throw new Error('No ledger backup in data/backups');
  const seed = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const pricesPath = newest(path.join(root, 'data', 'prices'), /^prices_.*\.json$/);
  if (pricesPath){   // a newer price file wins ticker by ticker
    const by = {}; (seed.prices || []).forEach(p => { by[p.ticker] = p; });
    JSON.parse(fs.readFileSync(pricesPath, 'utf8')).prices.forEach(p => { const cur = by[p.ticker]; if (!cur || String(p.asOf) > String(cur.asOf)) by[p.ticker] = p; });
    seed.prices = Object.values(by);
  }
  // seed.extra.json holds family data and is kept out of git; without it the registry is empty.
  const extraPath = path.join(SRC, 'seed.extra.json');
  const extra = fs.existsSync(extraPath) ? JSON.parse(fs.readFileSync(extraPath, 'utf8')) : {};
  // Registers (people, policies, properties): a dashboard backup carries the user's own versions —
  // keep those. The folder-derived registry rides along separately and only fills blanks on boot.
  seed.registry = { people: extra.people || [], policies: extra.policies || [], properties: extra.properties || [] };
  ['people', 'policies', 'properties'].forEach(k => { if (!Array.isArray(seed[k]) || !seed[k].length) seed[k] = seed.registry[k]; });
  seed.registryVersion = REGISTRY_VERSION;
  seed.seedSource = path.basename(backupPath); seed.seedBuiltAt = new Date().toISOString();
  return seed;
}

// Statement inbox: native CSVs in Statements/Bank, plus PDFs converted by tools/bank_pdf_to_csv.py
// that reconciled to their balances. Statements that failed the balance check are listed (so the tab
// can say so) but carry no lines.
function buildInbox(root){
  root = root || ROOT;
  const bankDir = path.join(root, 'Statements', 'Bank'), parsedDir = path.join(bankDir, 'Parsed');
  const inbox = { builtAt: new Date().toISOString(), files: [] };
  if (fs.existsSync(bankDir)) fs.readdirSync(bankDir).filter(n => /\.csv$/i.test(n)).sort().forEach(n => {
    inbox.files.push({ source: n, kind: 'csv', status: 'ok', text: fs.readFileSync(path.join(bankDir, n), 'utf8') });
  });
  const manPath = path.join(parsedDir, 'manifest.json');
  if (fs.existsSync(manPath)) Object.entries(JSON.parse(fs.readFileSync(manPath, 'utf8')).files || {}).sort().forEach(([n, e]) => {
    if (e.status === 'not_statement') return;
    const f = { source: n, kind: 'pdf', status: e.status, method: e.method, lines: e.lines, from: e.from, to: e.to, closing: e.closing, account: e.account, processedAt: e.processedAt, issues: e.issues || [] };
    if (e.status === 'ok' && e.csv && fs.existsSync(path.join(parsedDir, e.csv))) f.text = fs.readFileSync(path.join(parsedDir, e.csv), 'utf8');
    inbox.files.push(f);
  });
  return inbox;
}

// All modules share one global scope: a second top-level declaration of the same name would either
// throw (const/let) or silently replace the first (function). Refuse to build either way.
function checkGlobals(){
  const owner = {};
  ORDER.forEach(n => {
    const code = fs.readFileSync(path.join(SRC, n + '.js'), 'utf8');
    for (const m of code.matchAll(/^(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/gm)){
      if (owner[m[1]] && owner[m[1]] !== n) throw new Error('Global name collision: ' + m[1] + ' is declared in both ' + owner[m[1]] + '.js and ' + n + '.js');
      owner[m[1]] = n;
    }
  });
}

// serverState: { rev, doc|null } when served by app/server.js; omitted for the Cowork artifact.
// claude: true → the claude.ai artifact — no data at all in the page (no seed, no statements); the
// viewer loads a backup once and it is kept in the artifact's private per-user database.
function assemble(opts){
  opts = opts || {};
  const root = opts.root || ROOT;
  checkGlobals();
  const blank = opts.claude || opts.web || opts.shared;
  const seed = blank ? { format: 'portfolio-ledger', version: 3, transactions: [], prices: [], boundaries: [], histPrices: [], seedSource: null }
    : buildSeed(root);
  const inbox = blank ? { builtAt: new Date().toISOString(), files: [] } : buildInbox(root);
  const modules = ORDER.map(n => {
    const code = fs.readFileSync(path.join(SRC, n + '.js'), 'utf8');
    if (/<\/script/i.test(code)) throw new Error(n + '.js contains a literal </script> — split the string');
    return '<script id="' + n + '">\n' + code + '\n</script>';
  }).join('\n');
  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  for (const slot of ['/*{{CSS}}*/', '{{SEED}}', '{{INBOX}}', '<!--{{SCRIPTS}}-->', '<!--{{SERVER_STATE}}-->'])
    if (!html.includes(slot)) throw new Error('index.html is missing ' + slot);
  const serverTag = opts.serverState ? '<script type="application/json" id="server-state">' + jsonForHtml(opts.serverState) + '</script>'
    : opts.claude ? '<script type="application/json" id="claude-backend">{}</script>'
    : opts.web ? '<script type="application/json" id="web-build">{}</script>'
    : opts.shared ? '<script type="application/json" id="locked-seed">' + jsonForHtml(lockBackup(opts.shared.backup, opts.shared.passphrase)) + '</script>' : '';
  html = html.replace('/*{{CSS}}*/', () => fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8'))
    .replace('<!--{{SERVER_STATE}}-->', () => serverTag)
    .replace('{{SEED}}', () => jsonForHtml(seed))
    .replace('{{INBOX}}', () => jsonForHtml(inbox))
    .replace('<!--{{SCRIPTS}}-->', () => modules);
  if (opts.claude) html = artifactFragment(html).replace(/<title>[^<]*<\/title>/, '<title>Ong &amp; Kim Investment Artifact</title>');   // the name Eric gave the published artifact
  return { html, seed, inbox };
}

// Shared snapshot: the backup encrypted with AES-256-GCM under a key derived from the passphrase
// (PBKDF2-SHA256, 600,000 rounds, random salt and IV). The page decrypts it with WebCrypto.
function lockBackup(backup, passphrase){
  if (!passphrase) throw new Error('A passphrase is required for a shared snapshot');
  const c = require('crypto'), salt = c.randomBytes(16), iv = c.randomBytes(12), iter = 600000;
  const key = c.pbkdf2Sync(String(passphrase), salt, iter, 32, 'sha256');
  const ci = c.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([ci.update(JSON.stringify(backup), 'utf8'), ci.final(), ci.getAuthTag()]);   // WebCrypto expects the tag appended
  return { v: 1, alg: 'AES-256-GCM/PBKDF2-SHA256', iter, salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') };
}

// claude.ai wraps a published page in its own <!doctype>/<html>/<head>/<body>: hand it the head's
// title, scripts and styles followed by the body's content (charset and viewport come from the wrapper).
function artifactFragment(html){
  const head = (html.match(/<head>([\s\S]*?)<\/head>/i) || [, ''])[1].replace(/<meta [^>]*>\s*/gi, '');
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  return head.trim() + '\n' + body.trim() + '\n';
}

module.exports = { lockBackup, assemble, buildSeed, buildInbox, newest, ROOT, APP, SRC, ORDER, REGISTRY_VERSION };
