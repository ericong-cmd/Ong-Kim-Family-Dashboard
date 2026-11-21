// Shared view-only snapshot (npm run build:shared): the backup is in the page only encrypted; a wrong
// passphrase opens nothing; the right one shows the dashboard read-only, held in memory (nothing
// written to the browser); edit, import and refresh controls are hidden; exports stay. Synthetic data.
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { webcrypto } = require('crypto');
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || 'jsdom');
const APP = path.join(__dirname, '..');
let failed = 0; const ok = (c, n) => { console.log((c ? '  PASS' : '  FAIL') + '  ' + n); if (!c) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const tx = []; for (let i = 0; i < 40; i++) tx.push({ id: i + 1, type: 'BUY', owner: i % 2 ? 'Ong Ah Whatt' : 'Ong & Kim Family Trust', date: '2025-04-1' + (i % 9), ticker: 'ZQX' + (i % 4), equity: 'Zebraquill Holdings ' + (i % 4), quantity: 100, price: 1.5, fees: 0, currency: 'SGD' });
const backup = { format: 'portfolio-ledger', version: 3, exportedAt: '2026-11-21T13:45:43.888Z', transactions: tx, prices: [{ ticker: 'ZQX1', price: 1.6, asOf: '2026-11-20', source: 'test' }], boundaries: [], histPrices: [], rules: [], cash: [],
  properties: [{ id: 1, name: 'Quillstone Villa', address: '9 Test Road' }], policies: [{ id: 1, insured: 'Test Person', insurer: 'Test Insurer', type: 'Term life', policyNo: 'PN-55501' }], people: [{ id: 1, name: 'Test Person' }], maps: [], metaFlags: [] };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okfo-shared-')), file = path.join(dir, 'b.json');
fs.writeFileSync(file, JSON.stringify(backup));
execFileSync(process.execPath, [path.join(APP, 'build.js'), '--shared', file], { stdio: 'ignore', env: Object.assign({}, process.env, { OKFO_SHARE_PASS: 'correct horse battery staple' }) });
const HTML = fs.readFileSync(path.join(APP, 'dist', 'shared', 'index.html'), 'utf8');

async function open(){
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdom: ' + (e && (e.message || e))));
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
  const dom = new JSDOM(HTML, { url: 'https://ong-kim-shared.vercel.app/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w){ w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function(){}; Object.defineProperty(w, 'crypto', { value: webcrypto }); w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; } });
  return { w: dom.window, d: dom.window.document, ev: s => dom.window.eval(s), errors };
}
const submit = async (a, pass) => {
  a.d.getElementById('unlockPass').value = pass;
  a.d.getElementById('unlockForm').dispatchEvent(new a.w.Event('submit', { cancelable: true }));
  for (let i = 0; i < 200 && a.d.getElementById('unlockBtn') && a.d.getElementById('unlockBtn').disabled; i++) await sleep(25);
  await sleep(50);
};

(async () => {
  ok(!/Zebraquill|Quillstone|PN-55501/.test(HTML) && /<script type="application\/json" id="locked-seed">/.test(HTML), 'no names, tickers or policy numbers in the page — only the encrypted block');
  ok(fs.existsSync(path.join(APP, 'dist', 'shared', 'vercel.json')) && /no-store/.test(fs.readFileSync(path.join(APP, 'dist', 'shared', 'vercel.json'), 'utf8')), 'vercel.json written beside it (noindex, no-referrer, no-store)');
  const a = await open();
  await sleep(100);
  ok(!!a.d.getElementById('unlockOverlay') && a.ev('STORE_SOURCE') === 'locked', 'opens on the passphrase screen');
  await submit(a, 'wrong guess');
  ok(!a.d.getElementById('unlockErr').hidden && !!a.d.getElementById('unlockOverlay') && a.ev('G.txns.length') === 0, 'wrong passphrase: error shown, nothing loaded');
  await submit(a, 'correct horse battery staple');
  await a.w.__bootDone; await sleep(50);
  ok(!a.d.getElementById('unlockOverlay') && a.ev('STORE_SOURCE') === 'snapshot' && a.ev('G.txns.length') === 40, 'right passphrase: dashboard opens with all 40 transactions');
  ok(a.d.body.classList.contains('view-only') && a.d.getElementById('txForm').closest('section.card').hidden && a.d.getElementById('newPolicyBtn').hidden && a.d.getElementById('jsonBtn').hidden && a.d.getElementById('restoreInput').closest('label').hidden, 'view-only: add / import / backup / restore hidden');
  ok(!a.d.getElementById('holdingsPdfBtn').hidden && !a.d.getElementById('xlsxBtn').hidden, 'exports (PDF, xlsx) still available');
  ok(/View-only snapshot · data as at/.test(a.d.getElementById('sideStatus').textContent), 'sidebar shows it is a snapshot and its date');
  ok(a.w.localStorage.length === 0, 'nothing written to the browser (held in memory only)');
  ok(a.errors.length === 0, 'no errors' + (a.errors.length ? ': ' + a.errors.join(' | ') : ''));
  console.log(failed ? '\n' + failed + ' TEST(S) FAILED' : '\nALL TESTS PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
