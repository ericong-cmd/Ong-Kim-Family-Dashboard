// claude.ai artifact build: boots dist/family-office.claude.html in jsdom against a fake platform
// (db, user, mcp, downloads). Checks it starts empty with no data in the page, restores a backup through
// the in-page confirmation, saves it in size-capped documents under the viewer's private path,
// reopens from them, refreshes prices through the mcp capability and saves files via downloads.
// Uses synthetic data only.
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || 'jsdom');
const APP = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(APP, 'build.js'), '--claude'], { stdio: 'ignore' });
const HTML = fs.readFileSync(path.join(APP, 'dist', 'family-office.claude.html'), 'utf8');
let failed = 0; const ok = (c, n) => { console.log((c ? '  PASS' : '  FAIL') + '  ' + n); if (!c) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UID = 'viewer-1';
// YYYYMMDD n days from today (SGT), as IBKR writes corporate-action dates
const ymd = n => new Date(Date.now() + 8 * 3600e3 + n * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
const iso = n => ymd(n).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');

function fakeDb(store){
  const ref = p => ({
    path: p,
    get: async () => { const v = store.get(p); return { id: p.split('/').pop(), exists: v !== undefined, data: () => (v === undefined ? undefined : JSON.parse(v)), metadata: {} }; },
    set: async body => {
      const s = JSON.stringify(body);
      if (s.length > 256 * 1024) throw Object.assign(new Error('document over 256 KiB'), { code: 'invalid_argument' });
      if (!p.startsWith('data/users/' + UID + '/')) throw Object.assign(new Error('not your subtree'), { code: 'invalid_argument' });
      store.set(p, s);
    },
    delete: async () => { store.delete(p); }
  });
  return { doc: ref, collection: c => ({ path: c, doc: id => ref(c + '/' + id) }) };
}
function syntheticBackup(n){
  const tx = [];
  for (let i = 0; i < n; i++) tx.push({ id: i + 1, type: 'BUY', owner: 'Ong & Kim Family Trust', date: '2025-0' + (1 + i % 9) + '-1' + (i % 9), ticker: 'T' + (i % 40), equity: 'Test Co ' + (i % 40) + ' with a reasonably long equity name', quantity: 100 + i, price: 1.23, fees: 4.5, currency: 'SGD', note: 'synthetic test row ' + i + ' — padding padding padding padding padding' });
  return { format: 'portfolio-ledger', version: 3, exportedAt: '2026-10-02T00:00:00Z', transactions: tx,
    prices: [{ ticker: 'T1', price: 1.5, asOf: '2026-09-30', source: 'test' }], boundaries: [], histPrices: [],
    rules: [], cash: [], properties: [{ id: 1, name: 'Test House', address: '1 Test Road' }], policies: [{ id: 1, insured: 'Test Person', insurer: 'Test Insurer', type: 'Term life' }], people: [{ id: 1, name: 'Test Person' }], maps: [{ key: 'cid:T1', value: 111 }], metaFlags: [] };
}
async function open(store, extra = {}){
  const errors = [], calls = { mcp: [], saves: [] };
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdom: ' + (e && (e.message || e))));
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
  const caps = {
    db: fakeDb(store),
    user: { id: async () => UID },
    downloads: { save: async req => { calls.saves.push(req); } },
    mcp: { callTool: async (server, tool, input) => {
      calls.mcp.push({ server, tool, input });
      if (tool === 'get_price_snapshot') return { payload: { last: { price: 1.57, ts: 1790900000 } } };
      if (tool === 'search_contracts') return { payload: { results: [{ exchange: 'SGX', symbol: input.query, underlying_contract_id: input.query === 'T1' ? 111 : 999 }] } };
      if (tool === 'get_price_history' && input.include_corporate_actions)
        return { payload: { time: [], close: [], corp_actions: input.contract_id === 111 ? [{ type: 'CashDividends', date: ymd(-10), announce_date: ymd(-20), payment_date: ymd(5), value: '0.05', currency: 'SGD' }, { type: 'CashDividends', date: ymd(20), payment_date: ymd(35), value: '0.04', currency: 'SGD' }] : [] } };
      return { payload: { time: ['2026-10-01T00:00:00'], close: [1.5] } };
    } }
  };
  const dom = new JSDOM(HTML, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w){
      w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function(){};
      w.confirm = () => { errors.push('native confirm() used'); return false; };
      w.prompt = () => { errors.push('native prompt() used'); return null; };
      w.claude = { use: async name => (extra.signedOut && (name === 'user' || name === 'db') ? null : caps[name] || null) };
    } });
  const w = dom.window;
  await w.__bootDone; await w.__refreshDone;
  return { w, d: w.document, ev: s => w.eval(s), errors, calls };
}
const answer = async (d, typed) => {   // wait for the in-page dialog, then confirm it
  for (let i = 0; i < 50 && !d.getElementById('askOk'); i++) await sleep(10);
  if (typed){ const inp = d.getElementById('askTyped'); inp.value = typed; inp.dispatchEvent(new d.defaultView.Event('input')); }
  d.getElementById('askOk').click();
};

(async () => {
  const store = new Map();
  // ---------- 1. first open: empty, nothing embedded ----------
  const a = await open(store);
  ok(a.ev('STORE_BACKEND') === 'claude' && a.ev('STORE_SOURCE') === 'empty', 'claude backend, starts empty');
  ok(a.ev('JSON.parse(document.getElementById("seed").textContent).transactions.length') === 0, 'no ledger data embedded in the page');
  ok(!!a.d.getElementById('firstRun'), 'first-run panel asks for a backup');
  ok(a.d.getElementById('pdfBtn').hidden && a.d.getElementById('resetBtn').hidden, 'print-to-PDF and reset-to-bundled hidden');
  ok(store.size === 0, 'nothing written before the viewer acts');

  // ---------- 2. restore through the in-page confirmation, chunked save ----------
  const backup = syntheticBackup(1400);
  const file = new a.w.File([JSON.stringify(backup)], 'portfolio-ledger_backup_test.json', { type: 'application/json' });
  const p = a.ev('restoreJson')(file);
  await answer(a.d); await p;
  ok(a.ev('G.txns.length') === 1400, 'restore loaded 1,400 transactions');
  await sleep(900);
  const keys = [...store.keys()];
  const idx = JSON.parse(store.get('data/users/' + UID + '/okfo-index') || '{}');
  ok(idx.chunks && idx.chunks.transactions >= 2, 'transactions split across ' + (idx.chunks && idx.chunks.transactions) + ' documents');
  ok(keys.every(k => k.startsWith('data/users/' + UID + '/')), 'every document is under the viewer\'s private path');
  ok([...store.values()].every(v => v.length <= 256 * 1024), 'every document under 256 KiB');
  ok(a.ev('STORE_OK') === true && /Saved to your Claude account/.test(a.d.getElementById('sideStatus').textContent), 'sidebar says saved to the Claude account');

  // ---------- 3. downloads and prices ----------
  a.ev('downloadBlob("a,b\\n1,2", "test.csv", "text/csv")'); await sleep(20);
  a.d.getElementById('holdingsPdfBtn').click(); await sleep(50);
  const pdfSave = a.calls.saves.find(x => /\.pdf$/.test(x.filename));
  const pdfHead = pdfSave && Buffer.from(pdfSave.data).toString('latin1', 0, 8);
  ok(pdfSave && /^portfolio-holdings_all-owners_FY\d{4}_\d{4}-\d{2}-\d{2}\.pdf$/.test(pdfSave.filename) && pdfHead === '%PDF-1.4', 'Export PDF on the holdings card saves a real PDF through the downloads capability (' + (pdfSave && pdfSave.filename) + ')');
  ok(!a.d.getElementById('holdingsPdfBtn').hidden && !a.d.getElementById('pdfFileBtn').hidden && a.d.getElementById('pdfBtn').hidden, 'PDF export buttons shown; print-only button hidden (no print dialog here)');
  ok(a.calls.saves.some(x => x.filename === 'test.csv'), 'file saves go through the downloads capability');
  await a.ev('autoRefreshPrices(true)');
  ok(a.calls.mcp.some(c => c.server === 'Interactive Brokers' && c.tool === 'get_price_snapshot'), 'prices fetched through the Interactive Brokers connector');
  ok(a.ev('G.prices.T1 && G.prices.T1.price') === 1.57 && a.ev('G.prices.T1.source') === 'IBKR', 'refreshed price stored exactly as quoted (1.57, source IBKR)');
  // declared dividends: T1 (35 synthetic buys, 27,335 sh) went XD 10 days ago at 0.05 → S$1,366.75 booked on XD
  const before = a.ev('G.txns.length');
  await a.ev('autoCheckDividends(true)');
  const dv = a.ev('JSON.stringify(G.txns.filter(t => t.type === "DIVIDEND" && t.ticker === "T1"))');
  const d1 = JSON.parse(dv);
  ok(a.calls.mcp.some(c => c.tool === 'get_price_history' && c.input.include_corporate_actions === true), 'dividend check reads IBKR corporate actions');
  ok(d1.length === 1 && d1[0].dividend === 1366.75 && d1[0].date === iso(-10) && d1[0].paymentDate === iso(5) && a.ev('G.txns.length') === before + 1, 'declared dividend booked on XD: 27,335 sh × 0.05 = S$1,366.75, payment date kept');
  ok(/Upcoming/.test(a.d.getElementById('divList').textContent) && /1,093\.40/.test(a.d.getElementById('divList').textContent), 'upcoming dividend listed with its estimate (27,335 × 0.04 = S$1,093.40)');
  await a.ev('autoCheckDividends(true)');
  ok(a.ev('G.txns.filter(t => t.type === "DIVIDEND" && t.ticker === "T1").length') === 1, 'checking again books nothing twice');
  await sleep(900);
  ok(a.errors.length === 0, 'no errors in the first session' + (a.errors.length ? ': ' + a.errors.join(' | ') : ''));

  // ---------- 4. reopen from the database ----------
  const b = await open(store);
  ok(b.ev('STORE_SOURCE') === 'saved' && b.ev('G.txns.length') === 1401 && b.ev('G.txns.some(t => t.type === "DIVIDEND" && t.ticker === "T1" && t.paymentDate)'), 'reopened from the database: 1,400 transactions + the booked dividend (payment date kept)');
  ok(b.ev('Object.keys(DOC.stores.policies).length') === 1 && b.ev('Object.keys(DOC.stores.properties).length') === 1, 'registers restored');
  ok(b.ev('G.prices.T1.source') === 'IBKR', 'refreshed price kept');
  ok(!b.d.getElementById('firstRun'), 'no first-run panel once data exists');

  // ---------- 5. clear all: typed confirmation, chunks shrink ----------
  const c = b.ev('clearAll')();
  await answer(b.d, 'DELETE'); await c;
  await sleep(900);
  const idx2 = JSON.parse(store.get('data/users/' + UID + '/okfo-index'));
  ok(b.ev('G.txns.length') === 0 && idx2.chunks.transactions === 1 && !store.has('data/users/' + UID + '/okfo-transactions-1'), 'clear-all empties the data and removes extra documents');
  ok(b.errors.length === 0, 'no errors in the second session' + (b.errors.length ? ': ' + b.errors.join(' | ') : ''));

  // ---------- 6. signed out: works in memory, says so ----------
  const s = await open(new Map(), { signedOut: true });
  ok(s.ev('STORE_SOURCE') === 'memory' && /Not saving/.test(s.d.getElementById('sideStatus').textContent), 'signed out: runs without saving and says so');

  console.log(failed ? '\n' + failed + ' TEST(S) FAILED' : '\nALL TESTS PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
