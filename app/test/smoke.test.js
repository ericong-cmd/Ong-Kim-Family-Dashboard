// End-to-end: boots the built artifact in jsdom, walks every tab, saves records, reopens from
// localStorage, imports the real bank CSV, and exercises the IBKR bridge with a fake connector.
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || 'jsdom');
const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'dist', 'family-office.html'), 'utf8');
const CSV = fs.readFileSync(path.join(ROOT, 'Statements/Bank/20260630 Bank Statement 1 Feb to 30 Jun 2026.csv'), 'utf8');
const D2 = CSV.split('\n').filter(l => /^"\s*D2\s*",/.test(l)).length;   // quoted data rows only (footer legend excluded)
let failed = 0; const ok = (c, n) => { console.log((c ? '  PASS' : '  FAIL') + '  ' + n); if (!c) failed++; };

async function open(opts = {}){
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdom: ' + (e && (e.message || e))));
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
  const dom = new JSDOM(HTML, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w){
      if (opts.storage) for (const [k, v] of Object.entries(opts.storage)) w.localStorage.setItem(k, v);
      w.DecompressionStream = DecompressionStream; w.Response = Response; w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;
      w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function(){}; w.print = () => {};
      if (opts.bridge) w.cowork = { callMcpTool: opts.bridge };
    } });
  const w = dom.window;
  await w.__bootDone; await w.__refreshDone;
  return { w, d: w.document, ev: s => w.eval(s), errors };
}
const click = (d, sel) => { const el = d.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.click(); return el; };
const setv = (d, id, v) => { const el = d.getElementById(id); if (!el) throw new Error('missing #' + id); el.value = v; el.dispatchEvent(new d.defaultView.Event('input', { bubbles: true })); el.dispatchEvent(new d.defaultView.Event('change', { bubbles: true })); };
const txt = (d, sel) => (d.querySelector(sel) || { textContent: '' }).textContent;

(async () => {
  // ---------- 1. first open: seed, ledger page, every tab ----------
  const a = await open();
  ok(a.ev('STORE_SOURCE') === 'seed', 'first open loads the embedded seed');
  const TXN = a.ev('JSON.parse(document.getElementById("seed").textContent).transactions.length');
  ok(TXN >= 410 && a.ev('G.txns.length') === TXN, 'seed ledger loaded (' + TXN + ' transactions)');
  ok(a.d.getElementById('page-ledger').classList.contains('is-active'), 'opens on Portfolio Ledger');
  ok(a.d.querySelectorAll('#holdingsBody tr[data-k]').length >= 15, 'holdings rendered');
  ok(/^S\$[\d,]+\.\d\d/.test(txt(a.d, '#kpiMV').trim()) && a.ev('Number(String(document.getElementById("kpiMV").textContent).replace(/[^\\d.]/g, ""))') > 1e6, 'portfolio value KPI filled (' + txt(a.d, '#kpiMV').trim() + ')');
  ok(txt(a.d, '#hlXirr').trim() !== '', 'period return KPI filled');
  ok(a.d.querySelectorAll('#allocBody .alloc-row').length >= 5, 'allocation card rendered');
  ok(a.d.querySelectorAll('#yearStrip .ycard').length >= 8, 'year strip rendered');
  for (const p of ['rules', 'cash', 'property', 'insurance', 'ledger']){
    click(a.d, '.nav-item[data-page="' + p + '"]');
    ok(a.d.getElementById('page-' + p).classList.contains('is-active') && a.d.querySelectorAll('.page.is-active').length === 1, 'nav → ' + p);
  }
  ok((a.w.localStorage.getItem('okfo:v1') || '').length > 100000, 'ledger persisted to localStorage');

  // ---------- 1b. Excel export: realised P/L and dividends filled, totals match the dashboard ----------
  a.ev("window.__dl = []; downloadBlob = (content, name, type) => window.__dl.push({ content, name, type });");
  setv(a.d, 'fyFilter', '2026');
  const kReal = txt(a.d, '#kpiReal'), kDiv = txt(a.d, '#kpiDiv');
  a.ev('exportXlsx()');
  const dl = a.ev('window.__dl[0]');
  ok(dl && /\.xlsx$/.test(dl.name) && dl.content instanceof a.w.Uint8Array, 'Export .xlsx produces a real .xlsx (no CSV fallback): ' + (dl && dl.name));
  const xrows = await a.ev('xlsxToRows')(dl.content);
  const hdr = xrows[0], iR = hdr.findIndex(h => /^Realised P\/L/.test(h)), iD = hdr.findIndex(h => /^Dividends/.test(h)), tot = xrows[xrows.length - 1];
  const sgd = n => (Number(n) < 0 ? '−S$' : 'S$') + Math.abs(Number(n)).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  ok(iR > 0 && iD > 0 && /FY2026/.test(hdr[iR]) && xrows.slice(1, -1).some(r => Number(r[iR]) !== 0) && xrows.slice(1, -1).some(r => Number(r[iD]) > 0), 'Realised P/L and Dividends columns are filled for FY2026');
  ok(tot[0] === 'Total (SGD)' && kReal.replace('+', '') === sgd(tot[iR]) && kDiv === sgd(tot[iD]), 'xlsx totals equal the dashboard KPIs (' + sgd(tot[iR]) + ' realised, ' + sgd(tot[iD]) + ' dividends)');
  const fyTot = a.ev("(() => { const b = currentBoundary(); const f = computePeriod(G.txns, state.owner, state.fy, state.basis, { openingValue: b.openingValue, closingValue: b.closingValue, openingBasis: b.openingBasis }, pricesMap(), G.histPrices); return { d: f.dividends, r: f.realisedFY }; })()");
  ok(Math.abs(Number(tot[iD]) - fyTot.d) < 0.005 && Math.abs(Number(tot[iR]) - fyTot.r) < 0.005, 'holdings totals tie to the period return (dividends ' + fyTot.d.toFixed(2) + ', incl. income after a sale)');
  require('fs').writeFileSync(require('os').tmpdir() + '/okfo_export.xlsx', Buffer.from(dl.content));
  let pyx = '';
  try { pyx = require('child_process').execFileSync('python3', ['-c', "import openpyxl,sys;wb=openpyxl.load_workbook(sys.argv[1]);print('|'.join(wb.sheetnames), wb['Holdings'].max_row)", require('os').tmpdir() + '/okfo_export.xlsx'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { pyx = 'ERR'; }
  ok(/^Holdings\|Period Summary\|Dividends FY2026\|Transactions \d+$/.test(pyx), 'workbook opens in openpyxl with 4 sheets (' + pyx + ')');
  a.ev('exportCsv(true)');
  const csv = a.ev('window.__dl[1].content'), cl = csv.split('\n'), ch = cl[0].split(',');
  ok(/Realised P\/L FY2026/.test(cl[0]) && cl.slice(1).some(l => { const v = l.split(','); return Number(v[ch.findIndex(h => /^Dividends/.test(h))]) > 0; }), 'CSV export also carries realised P/L and dividends');
  setv(a.d, 'fyFilter', String(a.ev('fyEndYear(todayISO())')));

  // ---------- 2. property: seeded register, validation, save, yields, delete ----------
  click(a.d, '.nav-item[data-page="property"]');
  const REG = a.ev('JSON.parse(document.getElementById("seed").textContent).registry');
  const PROPS = Object.keys(a.ev('DOC.stores.properties')).length;
  ok(PROPS >= REG.properties.length && REG.properties.length >= 5 && a.d.querySelectorAll('#propGrid .prop-card').length === PROPS, PROPS + ' properties listed (registry ' + REG.properties.length + ')');
  ok(/Kum Hing Court #14-34/.test(txt(a.d, '#propGrid')) && /Grace Scarlett Yang/.test(txt(a.d, '#propGrid')) && /2\.07%/.test(txt(a.d, '#propGrid')), '14-34: tenant shown, gross yield 7,000×12 ÷ 4.06m = 2.07%');
  click(a.d, '#newPropBtn');
  ok(!a.d.getElementById('drawerWrap').hidden, 'property drawer opens');
  click(a.d, '#drawerSave');
  ok(a.d.querySelectorAll('#drawerBody .field-error').length > 0 && Object.keys(a.ev('DOC.stores.properties')).length === PROPS, 'empty form blocked with inline errors');
  setv(a.d, 'p_name', 'Test Condo'); setv(a.d, 'p_address', '1 Test Road'); setv(a.d, 'p_owner', 'Ong Ah Whatt');
  setv(a.d, 'p_price', '1200000'); setv(a.d, 'p_rent', '4000'); setv(a.d, 'p_mcst', '900'); setv(a.d, 'p_mcstFreq', 'quarterly'); setv(a.d, 'p_tax', '3000'); setv(a.d, 'p_loan', '600000');
  click(a.d, '#drawerSave');
  ok(a.d.getElementById('drawerWrap').hidden && a.d.querySelectorAll('#propGrid .prop-card').length === PROPS + 1, 'property saved and listed');
  const testCard = [...a.d.querySelectorAll('#propGrid .prop-card')].find(c => /Test Condo/.test(c.textContent));
  ok(testCard && /4\.00%/.test(testCard.textContent) && /3\.45%/.test(testCard.textContent), 'gross 4.00% / net 3.45% yield shown');
  testCard.querySelector('[data-del]').click();
  ok(testCard.querySelector('.confirm-inline') && a.d.querySelectorAll('#propGrid .prop-card').length === PROPS + 1, 'delete asks inline first (no browser pop-up)');
  testCard.querySelector('.confirm-inline [data-no]').click();
  ok(!testCard.querySelector('.confirm-inline') && Object.keys(a.ev('DOC.stores.properties')).length === PROPS + 1, 'cancel keeps the property');
  testCard.querySelector('[data-del]').click(); testCard.querySelector('.confirm-inline [data-yes]').click(); await new Promise(r => setTimeout(r, 0));
  ok(a.d.querySelectorAll('#propGrid .prop-card').length === PROPS && !/Test Condo/.test(txt(a.d, '#propGrid')), 'property deleted');

  // ---------- 3. insurance: seeded policies, add policy, summaries ----------
  click(a.d, '.nav-item[data-page="insurance"]');
  const POLS = Object.keys(a.ev('DOC.stores.policies')).length;
  ok(POLS >= REG.policies.length && REG.policies.length >= 30 && a.d.querySelectorAll('#insBody tr[data-id]').length === POLS, POLS + ' policies listed (registry ' + REG.policies.length + ')');
  ok(a.d.querySelectorAll('#insBody tr[data-id] [data-del]').length === POLS, 'every policy row has a Delete button');
  const oawLife = a.ev("Object.values(DOC.stores.policies).find(p => p.policyNo === '0011254391')");
  ok(oawLife && oawLife.premium === 3300 && oawLife.sumAssured === 150000 && !oawLife.needsDetails, 'company-owned GE policy 0011254391 filled in (S$150k, S$3,300 a year)');
  ok(/Eunice Chua/.test(txt(a.d, '#insPeople')) && /Aden Guam/.test(txt(a.d, '#insPeople')), 'cards for every family member, incl. grandchildren');
  ok(/Ong Ah Whatt/.test(txt(a.d, '#insPeople')) && /Ngiow Lee Kim/.test(txt(a.d, '#insPeople')), 'per-person summary cards');
  ok(a.d.querySelectorAll('#i_type option').length === 0, 'drawer not open yet');
  click(a.d, '#newPolicyBtn');
  ok(a.d.querySelectorAll('#i_type option').length >= 20 && a.d.querySelectorAll('#i_type optgroup').length >= 4, 'policy type dropdown grouped');
  ok([...a.d.querySelectorAll('#i_paidBy option')].some(o => o.value === 'Ong & Kim Family Trust Pte Ltd'), 'payment-by includes the company');
  setv(a.d, 'i_insured', 'Ong Ah Whatt'); setv(a.d, 'i_insurer', 'AIA'); setv(a.d, 'i_type', 'Term life'); setv(a.d, 'i_sum', '500000');
  setv(a.d, 'i_premium', '1200'); setv(a.d, 'i_freq', 'monthly'); setv(a.d, 'i_due', '2026-10-15'); setv(a.d, 'i_paidBy', 'Ong Ah Whatt');
  click(a.d, '#drawerSave');
  ok(a.d.querySelectorAll('#insBody tr[data-id]').length === POLS + 1, 'policy added');
  const newRow = [...a.d.querySelectorAll('#insBody tr[data-id]')].find(r => /AIA/.test(r.textContent) && /500,000/.test(r.textContent));
  ok(!!newRow, 'new policy listed with its sum assured');
  newRow.querySelector('[data-del]').click(); newRow.querySelector('.confirm-inline [data-yes]').click(); await new Promise(r => setTimeout(r, 0));
  ok(a.d.querySelectorAll('#insBody tr[data-id]').length === POLS, 'policy deleted from its row');
  click(a.d, '#newPersonBtn'); setv(a.d, 'person_name', 'Ong Junior'); click(a.d, '#drawerSave');
  ok(/Ong Junior/.test(txt(a.d, '#insPeople')), 'family member added');

  // ---------- 4. rules: manual swing, Fibonacci proposal, status ----------
  click(a.d, '.nav-item[data-page="rules"]'); click(a.d, '#newRuleBtn');
  const opt = a.d.querySelector('#r_ticker_list option[value="BN4"]');
  ok(opt && /Keppel/.test(opt.getAttribute('label')) && /held/.test(opt.getAttribute('label')), 'ticker dropdown shows the company name beside the ticker');
  setv(a.d, 'r_ticker', 'BN4');
  ok(/Keppel/.test(txt(a.d, '#r_ticker_hint')), 'chosen company named under the ticker box');
  setv(a.d, 'r_high', '12.5'); setv(a.d, 'r_low', '10'); click(a.d, '#ruleApplyFib');
  const rec = a.ev('fibRecommend(12.5,10)');
  ok(Number(a.d.getElementById('r_buy1').value) === rec.buy1 && Number(a.d.getElementById('r_sell3').value) === rec.sell3 && Number(a.d.getElementById('r_cut').value) === rec.cut, 'Fibonacci proposal fills buy/cut/sell');
  ok(a.d.querySelectorAll('#ruleFibTable tr').length >= 8, 'Fibonacci level table shown');
  click(a.d, '#drawerSave');
  const row = a.d.querySelector('#rulesBody tr[data-rule-id]');
  ok(row && /BN4/.test(row.textContent) && /Buy zone/.test(row.textContent), 'rule listed; last 11.53 ≤ Buy 1 → Buy zone');

  // ---------- 5. cash on hand: real CSV, dedupe, dividends, PDF handoff ----------
  click(a.d, '.nav-item[data-page="cash"]');
  const TOTAL = a.ev("inboxEntries().filter(f => f.status === 'ok' && f.text).reduce((s, f) => s + parseBankStatement(parseCSV(f.text)).lines.length, 0)");
  const cashN = () => Object.keys(a.ev('DOC.stores.cash')).length;
  const INBOX_KEYS = a.ev("inboxEntries().filter(f => f.status === 'ok' && f.text).flatMap(f => parseBankStatement(parseCSV(f.text)).lines.map(l => l.key))");
  const SEED_CASH = a.ev('(JSON.parse(document.getElementById("seed").textContent).cash || []).length');
  const CASHN = cashN();
  ok(TOTAL >= D2 + 18 && INBOX_KEYS.every(k => a.ev('DOC.stores.cash')[k]) && CASHN >= Math.max(TOTAL, SEED_CASH), 'statements in Statements/Bank (' + TOTAL + ' lines, incl. the January PDF) plus the ' + SEED_CASH + ' lines in the backup all loaded (' + CASHN + ')');
  ok(a.ev("Object.values(DOC.stores.cash).filter(l => l.source === '20260101 Bank Statement January 2026.pdf').length") === 18, 'January 2026 scan: 18 lines loaded');
  ok(/January 2026\.pdf/.test(txt(a.d, '#stmtFiles')) && /Reconciled/.test(txt(a.d, '#stmtFiles')), 'statement files card lists the reconciled PDF');
  const r1 = await a.ev('importStatementText')(CSV, 'feb-jun.csv');
  ok(r1.added === 0 && r1.skipped === D2 && cashN() === CASHN, 'uploading the Feb–Jun CSV again adds nothing (dedupe)');
  const lastBal = a.ev('Object.values(DOC.stores.cash)').sort((x, y) => (x.date + x.time > y.date + y.time ? 1 : -1)).slice(-1)[0].balance;
  ok(txt(a.d, '#cashKpis').includes(a.ev('fmtSGD')(lastBal)), 'cash on hand KPI = closing balance');
  const rows = [...a.d.querySelectorAll('#divReviewBody tr[data-key]')];
  const DIVN = a.ev("Object.values(DOC.stores.cash).filter(l => l.category === 'dividend').length");
  ok(rows.length === DIVN && rows.filter(r => /Already in ledger/.test(r.textContent)).length >= 15, DIVN + ' bank dividends listed; ' + rows.filter(r => /Already in ledger/.test(r.textContent)).length + ' already in the ledger');
  ok(!/Div 2025/.test(txt(a.d, '#divReviewBody')), 'shareholder payout not treated as dividend income');
  ok(a.ev('G.txns.length') === TXN, 'no dividends double-booked (ledger unchanged)');
  click(a.d, '.nav-item[data-page="ledger"]');
  ok(txt(a.d, '#kpiCash').includes(a.ev('fmtSGD')(lastBal)), 'cash KPI appears on the ledger page');
  const pdf = new a.w.File(['%PDF-1.3'], '20260101 Bank Statement January 2026.pdf', { type: 'application/pdf' });
  click(a.d, '.nav-item[data-page="cash"]'); await a.ev('importStatementFile')(pdf);
  ok(!a.d.getElementById('pdfHandoff').hidden && /January 2026\.pdf/.test(txt(a.d, '#pdfHandoff')) && /already been read/.test(txt(a.d, '#pdfHandoff')), 'dropping a PDF that was already read says so');
  await a.ev('importStatementFile')(new a.w.File(['%PDF-1.3'], 'July 2026.pdf', { type: 'application/pdf' }));
  ok(/Statements\/Bank/.test(txt(a.d, '#pdfHandoff')), 'a new PDF: told to save it into Statements/Bank for background processing');
  ok(a.errors.length === 0, 'no console errors (first session)' + (a.errors.length ? ' → ' + a.errors.join(' | ') : ''));

  // ---------- 6. reopen: everything came back ----------
  const saved = { 'okfo:v1': a.w.localStorage.getItem('okfo:v1') };
  const b = await open({ storage: saved });
  ok(b.ev('STORE_SOURCE') === 'saved', 'reopen uses saved data (no re-upload)');
  ok(Object.keys(b.ev('DOC.stores.properties')).length === PROPS && Object.keys(b.ev('DOC.stores.rules')).length === 1 &&
     Object.keys(b.ev('DOC.stores.policies')).length === POLS && Object.keys(b.ev('DOC.stores.cash')).length === CASHN && b.ev('G.txns.length') === TXN, 'properties, rules, policies, cash and ledger all persisted');
  ok(b.errors.length === 0, 'no console errors (reopen)' + (b.errors.length ? ' → ' + b.errors.join(' | ') : ''));

  // ---------- 6a. registers filled into data saved before 28 Sep (blanks only, user edits kept) ----------
  const old = JSON.parse(saved['okfo:v1']);
  Object.keys(old.stores.policies).forEach(k => { if (Number(k) > 4) delete old.stores.policies[k]; });
  Object.values(old.stores.policies).forEach(p => { ['premium', 'sumAssured', 'agent', 'start'].forEach(f => delete p[f]); p.needsDetails = true; });
  old.stores.policies[1].notes = 'my own note';
  old.stores.properties = {}; Object.keys(old.stores.meta).filter(k => k.startsWith('fill:')).forEach(k => delete old.stores.meta[k]);
  const g = await open({ storage: { 'okfo:v1': JSON.stringify(old) } });
  const gp = g.ev('Object.values(DOC.stores.policies)');
  ok(gp.length === REG.policies.length && Object.keys(g.ev('DOC.stores.properties')).length === REG.properties.length, 'missing policies and properties added to saved data');
  const p1 = gp.find(p => p.policyNo === '0011254391');
  ok(p1 && p1.premium === 3300 && p1.notes === 'my own note' && !p1.needsDetails, 'existing policy: blanks filled, own note kept, badge cleared');
  ok(g.errors.length === 0, 'no console errors (register fill)' + (g.errors.length ? ' → ' + g.errors.join(' | ') : ''));

  // ---------- 6b. one-time fix of the in-specie double count in data saved before 28 Sep ----------
  const oldDoc = JSON.parse(saved['okfo:v1']);
  const kr = Object.values(oldDoc.stores.transactions).find(t => t.type === 'OPENING' && t.ticker === 'K71U' && t.date === '2026-05-08');
  ok(kr && !kr.acquired, 'bundled seed already carries the corrected K71U opening');
  kr.acquired = 'EARNED'; delete oldDoc.stores.meta['fix:inspecie-v1'];
  const f = await open({ storage: { 'okfo:v1': JSON.stringify(oldDoc) } });
  const kr2 = f.ev('G.txns').find(t => t.type === 'OPENING' && t.ticker === 'K71U' && t.date === '2026-05-08');
  ok(kr2 && !kr2.acquired && /EARNED flag removed/.test(kr2.note) && f.ev('G.txns.length') === TXN, 'saved data: EARNED flag removed once, nothing else changed');
  ok(f.errors.length === 0, 'no console errors (fix)' + (f.errors.length ? ' → ' + f.errors.join(' | ') : ''));

  // ---------- 7. live prices on open through the connector ----------
  const calls = [];
  const bridge = async (name, args) => {
    const tool = name.split('__').pop(); calls.push(tool);
    if (tool === 'get_price_snapshot') return { structuredContent: { last: { price: args.contract_id === 92216592 ? 11.6 : 1.01, ts: Math.floor(Date.now() / 1000), halted: false } } };
    if (tool === 'get_price_history') return { structuredContent: { time: ['2026-09-25T01:00:00Z'], open: [1], high: [1], low: [1], close: [1] } };
    if (tool === 'search_contracts') return { structuredContent: { results: [] } };
    return { isError: true, content: [{ text: 'unexpected ' + tool }] };
  };
  const c = await open({ bridge });
  ok(calls.filter(t => t === 'get_price_snapshot').length >= 17, 'auto-refresh on open quoted every holding');
  ok(c.ev('G.prices.BN4.price') === 11.6 && c.ev('G.prices.BN4.asOf') === c.ev('sgtParts(Date.now()).date'), 'BN4 now 11.60 dated today (SGT)');
  ok((c.d.querySelector('#priceList input[data-tk="BN4"]') || {}).value === '11.6', 'price list shows the refreshed quote');
  ok(c.errors.length === 0, 'no console errors (bridge)' + (c.errors.length ? ' → ' + c.errors.join(' | ') : ''));

  console.log(failed ? '\n' + failed + ' TEST(S) FAILED' : '\nALL TESTS PASSED'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
