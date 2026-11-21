// Backup → shared link: POST /api/backup saves into data/backups (never overwriting) and triggers the
// publisher; GET /api/publish reports it; the folder watcher publishes a file dropped in by hand;
// publishShared skips a backup it already published and needs a passphrase. No real deploys.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { createServer } = require('../server.js');
const { publishShared } = require('../tools/publish-shared.js');
let failed = 0; const ok = (c, n) => { console.log((c ? '  PASS' : '  FAIL') + '  ' + n); if (!c) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function req(port, method, p, body){
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: Object.assign({ Host: '127.0.0.1:' + port }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) }, res => {
      let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(t || '{}') }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const backup = { format: 'portfolio-ledger', version: 3, transactions: [{ id: 1, type: 'BUY', owner: 'X', date: '2026-01-02', ticker: 'T', quantity: 1, price: 1 }], prices: [], boundaries: [], histPrices: [], rules: [], cash: [], properties: [], policies: [], people: [], maps: [] };

(async () => {
  // 1. Backup JSON from the page
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okfo-pub-'));
  const calls = [];
  const { server } = createServer({ root, dataDir: path.join(root, 'data', 'state'), noWatch: true, watch: false,
    publisher: async () => { calls.push(Date.now()); await sleep(30); return { file: 'x.json', url: 'https://ong-kim-shared.vercel.app' }; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
  const a = await req(port, 'POST', '/api/backup', backup);
  const dir = path.join(root, 'data', 'backups'), files1 = fs.readdirSync(dir);
  ok(a.status === 200 && a.json.publishing === true && /^data\/backups\/portfolio-ledger_backup_\d{4}-\d{2}-\d{2}\.json$/.test(a.json.file) && files1.length === 1, 'backup saved into data/backups (' + a.json.file + ')');
  const b = await req(port, 'POST', '/api/backup', backup);
  ok(fs.readdirSync(dir).length === 2 && /_\d{4}\.json$/.test(b.json.file), 'a second backup the same day gets a time suffix — nothing overwritten');
  await sleep(150);
  const p = await req(port, 'GET', '/api/publish');
  ok(calls.length >= 1 && p.json.state === 'done' && p.json.url === 'https://ong-kim-shared.vercel.app', 'publisher ran; /api/publish reports done with the link');
  ok((await req(port, 'POST', '/api/backup', { nope: 1 })).status === 400, 'non-backup JSON refused');
  server.close();

  // 2. A file dropped into data/backups (e.g. downloaded from the artifact) is published by the watcher
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'okfo-pub2-'));
  let watched = 0;
  const s2 = createServer({ root: root2, dataDir: path.join(root2, 'data', 'state'), noWatch: true, publisher: async () => { watched++; return { file: 'y', url: 'u' }; } });
  await new Promise(r => s2.server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(path.join(root2, 'data', 'backups', 'portfolio-ledger_backup_2026-11-22.json'), JSON.stringify(backup));
  await sleep(3800);
  ok(watched === 1, 'new backup file in data/backups → published once (after it settles)');
  s2.server.close();

  // 3. publishShared: skips what is already published; needs a passphrase
  const root3 = fs.mkdtempSync(path.join(os.tmpdir(), 'okfo-pub3-')), bdir = path.join(root3, 'data', 'backups'); fs.mkdirSync(bdir, { recursive: true });
  const f = path.join(bdir, 'portfolio-ledger_backup_2026-11-21.json'); fs.writeFileSync(f, JSON.stringify(backup));
  const st = fs.statSync(f);
  fs.writeFileSync(path.join(bdir, '.published.json'), JSON.stringify({ stamp: path.basename(f) + '|' + st.size + '|' + Math.round(st.mtimeMs), url: 'https://ong-kim-shared.vercel.app' }));
  const r3 = await publishShared({ root: root3, log: () => {} });
  ok(r3.skipped === true, 'same backup already published → skipped, no rebuild');
  const saved = process.env.OKFO_SHARE_PASS; delete process.env.OKFO_SHARE_PASS;
  let err = null; try { await publishShared({ root: root3, force: true, log: () => {} }); } catch (e) { err = e.message; }
  if (saved != null) process.env.OKFO_SHARE_PASS = saved;
  ok(process.platform === 'darwin' || /No passphrase/.test(String(err)), 'no passphrase → clear message, nothing deployed');

  console.log(failed ? '\n' + failed + ' TEST(S) FAILED' : '\nALL TESTS PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
