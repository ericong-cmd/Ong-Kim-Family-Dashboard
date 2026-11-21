// Website build (Vercel): boots dist/web/index.html in jsdom. Checks no data is embedded, the page starts
// empty with the first-run panel, a Backup JSON restore loads into this browser's localStorage, and a
// reopen in the same browser comes back with it. Synthetic data only.
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || 'jsdom');
const APP = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(APP, 'build.js'), '--web'], { stdio: 'ignore' });
const HTML = fs.readFileSync(path.join(APP, 'dist', 'web', 'index.html'), 'utf8');
let failed = 0; const ok = (c, n) => { console.log((c ? '  PASS' : '  FAIL') + '  ' + n); if (!c) failed++; };

async function open(storage){
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdom: ' + (e && (e.message || e))));
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
  const dom = new JSDOM(HTML, { url: 'https://example.vercel.app/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w){
      for (const [k, v] of Object.entries(storage || {})) w.localStorage.setItem(k, v);
      w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function(){};
      w.confirm = () => true;
    } });
  const w = dom.window;
  await w.__bootDone; await w.__refreshDone;
  return { w, d: w.document, ev: s => w.eval(s), errors };
}

(async () => {
  ok(/"transactions":\[\]/.test(HTML) && !/<script type="application\/json" id="(server-state|claude-backend)"/.test(HTML) && /<script[^>]*id="web-build"/.test(HTML), 'page carries no ledger data; web build marker only');
  const a = await open();
  ok(a.ev('STORE_BACKEND') === 'browser' && a.ev('STORE_SOURCE') === 'empty', 'starts empty, browser storage');
  ok(!!a.d.getElementById('firstRun') && /this browser only/.test(a.d.getElementById('firstRun').textContent), 'first-run panel asks for a backup and says data stays in this browser');
  ok(a.d.getElementById('resetBtn').hidden && !a.d.getElementById('pdfBtn').hidden, 'reset-to-bundled hidden; PDF export kept');
  const tx = []; for (let i = 0; i < 50; i++) tx.push({ id: i + 1, type: 'BUY', owner: 'Ong & Kim Family Trust', date: '2025-03-1' + (i % 9), ticker: 'T' + (i % 5), equity: 'Test ' + (i % 5), quantity: 100, price: 1.1, fees: 0, currency: 'SGD' });
  const backup = { format: 'portfolio-ledger', version: 3, transactions: tx, prices: [{ ticker: 'T1', price: 1.2, asOf: '2026-11-13', source: 'test' }], boundaries: [], histPrices: [], rules: [], cash: [], properties: [], policies: [], people: [], maps: [], metaFlags: [] };
  await a.ev('restoreJson')(new a.w.File([JSON.stringify(backup)], 'b.json', { type: 'application/json' }));
  ok(a.ev('G.txns.length') === 50, 'restore loaded 50 transactions');
  const saved = a.w.localStorage.getItem('okfo:v1');
  ok(saved && JSON.parse(saved).stores && Object.keys(JSON.parse(saved).stores.transactions).length === 50, 'saved to this browser');
  a.ev("window.__dl = []; downloadBlob = (content, name, type) => window.__dl.push({ content, name, type });");
  a.d.getElementById('holdingsPdfBtn').click();
  const pdf = a.ev('window.__dl[0]');
  ok(pdf && /\.pdf$/.test(pdf.name) && pdf.type === 'application/pdf' && Buffer.from(pdf.content).toString('latin1', 0, 8) === '%PDF-1.4', 'Export PDF on the holdings card produces a PDF file (' + (pdf && pdf.name) + ')');
  ok(a.errors.length === 0, 'no errors' + (a.errors.length ? ': ' + a.errors.join(' | ') : ''));
  const b = await open({ 'okfo:v1': saved });
  ok(b.ev('STORE_SOURCE') === 'saved' && b.ev('G.txns.length') === 50 && !b.d.getElementById('firstRun'), 'reopen in the same browser: data back, no first-run panel');
  console.log(failed ? '\n' + failed + ' TEST(S) FAILED' : '\nALL TESTS PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
