const fs = require('fs'), path = require('path');
const c = require('../src/calc.js');
const e = require('../src/engine.js');
const ROOT = path.join(__dirname, '..', '..');
let failed = 0;
const ok = (cond, name) => { console.log((cond ? '  PASS' : '  FAIL') + '  ' + name); if (!cond) failed++; };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

(async () => {
// ---- SGX ticks ----
ok(c.sgxTick(0.015) === 0.001 && c.sgxTick(0.2) === 0.005 && c.sgxTick(0.995) === 0.005 && c.sgxTick(1) === 0.01, 'tick bands <0.20 / 0.20-<1 / >=1');
ok(c.roundToTick(0.3972) === 0.395 && c.roundToTick(1.618) === 1.62 && c.roundToTick(0.1234) === 0.123, 'round to nearest tick');
ok(c.onTick(0.455) && !c.onTick(0.457) && c.onTick(11.53) && !c.onTick(11.534), 'on-tick check');
ok(c.snapToTick(1.1300000000000001) === 1.13, 'float noise snaps to tick');

// ---- Fibonacci ----
const f = c.fibLevels(2, 1);
ok(near(f.r382, 1.618) && near(f.r500, 1.5) && near(f.r618, 1.382) && near(f.r786, 1.214), 'retracements from H=2 L=1');
ok(near(f.e1000, 2) && near(f.e1272, 2.272) && near(f.e1618, 2.618), 'extensions 100 / 127.2 / 161.8');
ok(c.fibLevels(1, 2) === null && c.fibLevels(1, 1) === null, 'H must exceed L');
const rec = c.fibRecommend(2, 1);
ok(rec.buy1 === 1.62 && rec.buy2 === 1.5 && rec.buy3 === 1.38 && rec.cut === 1.21, 'buys 38.2/50/61.8, cut 78.6, tick-rounded');
ok(rec.sell1 === 2 && rec.sell2 === 2.27 && rec.sell3 === 2.62, 'sells: prior high, 127.2, 161.8');
const bars = { time: ['2026-01-02T01:00:00Z', '2026-02-02T01:00:00Z', '2026-03-02T01:00:00Z'], high: [1.1, 1.5, 1.3], low: [0.9, 1.2, 1.0], close: [1, 1.4, 1.2] };
const sw = c.swingFromBars(bars);
ok(sw.high === 1.5 && sw.low === 0.9 && sw.highDate === '2026-02-02' && sw.lowDate === '2026-01-02' && sw.trend === 'up', 'swing high/low from bars');
const rule = { buy1: 1.62, buy2: 1.5, buy3: 1.38, cut: 1.21, sell1: 2, sell2: 2.27, sell3: 2.62 };
ok(c.ruleStatus(1.2, rule) === 'cut' && c.ruleStatus(2.05, rule) === 'profit' && c.ruleStatus(1.55, rule) === 'buy' && c.ruleStatus(1.8, rule) === 'hold', 'rule status vs last price');
ok(c.buyTier(1.6, rule) === 1 && c.buyTier(1.45, rule) === 2 && c.buyTier(1.3, rule) === 3 && c.buyTier(1.8, rule) === 0, 'buy tier');
ok(c.ruleStatus(null, rule) === 'unknown', 'no price → unknown');

// ---- parsing primitives ----
ok(JSON.stringify(c.parseCSV('a,"b,c",d\n"x ""q""",2\n')) === JSON.stringify([['a', 'b,c', 'd'], ['x "q"', '2']]), 'CSV quotes and escaped quotes');
ok(c.toISODate('05/02/2026') === '2026-02-05' && c.toISODate('2026-02-05') === '2026-02-05' && c.toISODate('5 Feb 2026') === '2026-02-05', 'date formats');
ok(c.toISODate('46058') === '2026-02-05', 'Excel serial date');
ok(c.toNum(' 39,082.25 ') === 39082.25 && c.toNum('(12.50)') === -12.5 && c.toNum('') === 0, 'amounts');
ok(c.to24h('04:30:11 PM') === '16:30:11' && c.to24h('12:00:18 PM') === '12:00:18' && c.to24h('12:05:00 AM') === '00:05:00', '12h → 24h');

// ---- real DBS statement ----
const csv = fs.readFileSync(path.join(ROOT, 'Statements/Bank/20260630 Bank Statement 1 Feb to 30 Jun 2026.csv'), 'utf8');
const st = c.parseBankStatement(c.parseCSV(csv));
const d2 = csv.split('\n').filter(l => /^"\s*D2\s*",/.test(l)).length;   // real rows are quoted; the footer legend is not
ok(st.format === 'dbs' && st.account === '3473038453' && st.from === '2026-02-01' && st.to === '2026-06-30', 'DBS header: account and period');
ok(st.lines.length === d2 && d2 > 50, 'every D2 row parsed (' + d2 + ')');
ok(st.lines.every(l => l.date && l.balance != null), 'footer legend rows skipped');
const first = st.lines[0];
ok(first.date === '2026-02-05' && first.withdrawal === 39082.25 && first.balance === 83970.82 && first.category === 'settlement', 'first line: SES settlement');
const kim = st.lines.find(l => l.remarks === 'CDP-KIMLY');
ok(kim && kim.deposit === 12000 && kim.category === 'dividend' && c.payerOf(kim) === 'KIMLY', 'Kimly dividend line');
const payout = st.lines.find(l => /Div 2025/.test(l.ref + l.remarks));
ok(payout && payout.withdrawal === 60000 && payout.category === 'payout', 'shareholder payout is not dividend income');
ok(st.lines.some(l => l.category === 'fee' && l.withdrawal === 0.5), 'service charge → fee');
const keys = new Set(st.lines.map(l => l.key));
ok(keys.size === st.lines.length, 'line keys unique (dedupe-safe)');
const pos = c.cashPositions(st.lines);
const last = st.lines[st.lines.length - 1];
ok(pos.accounts.length === 1 && pos.total === last.balance && pos.accounts[0].asOf === last.date, 'cash on hand = latest ledger balance');

// ---- XLSX reader ----
const x = await c.xlsxToRows(fs.readFileSync(path.join(__dirname, 'fixtures/statement.xlsx')));
const xs = c.parseBankStatement(x);
ok(xs.format === 'dbs' && xs.lines.length === 2 && xs.lines[0].date === '2026-07-02' && xs.lines[0].category === 'dividend', 'XLSX: DBS layout, serial dates, categories');
ok(xs.lines[1].withdrawal === 2000.25 && xs.lines[1].balance === 110000.25, 'XLSX: numeric amounts');

// ---- dividend matching against the real ledger ----
const led = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/backups/portfolio-ledger_backup_2026-09-02.json'), 'utf8'));
const txns = led.transactions;
const nm = c.buildNameMap(txns);
const exp = { 'KIMLY': '1D0', 'CAPLAND ASCOTT T': 'HMN', 'CENT ACCOM REIT': '8C8U', 'KEPPEL': 'BN4', 'CHOO CHIANG': '42E', 'SEATRIUM LTD': '5E2', 'VENTURE': 'V03', 'FRASERS CPT TR': 'J69U', 'FAR EAST ORCHARD': 'O10' };
Object.entries(exp).forEach(([payer, tk]) => ok(c.matchTicker(payer, nm, {}) === tk, 'payer ' + payer + ' → ' + tk));
ok(c.matchTicker('KEPPEL REIT', nm, {}) === 'K71U', 'Keppel REIT stays distinct from Keppel');
ok(c.matchTicker('UNKNOWN CO', nm, {}) === null, 'unknown payer is not guessed');
ok(c.matchTicker('UNKNOWN CO', nm, { 'UNKNOWN CO': 'Z74' }) === 'Z74', 'learned mapping wins');
const cands = c.dividendCandidates(st.lines, txns, {});
ok(cands.length === st.lines.filter(l => l.category === 'dividend').length, 'one candidate per dividend line');
ok(cands.every(k => k.status === 'dup'), 'all Feb–Jun dividends already in ledger (' + cands.length + ')');
const ids = cands.map(k => k.matchId);
ok(new Set(ids).size === ids.length, 'each ledger dividend matched at most once');
// aggregation: three bank lines booked as one ledger entry
const agg = [{ id: 1, type: 'DIVIDEND', ticker: 'HMN', date: '2026-02-27', dividend: 8224.8 }];
const hmnLines = st.lines.filter(l => l.remarks === 'CDP-CAPLAND ASCOTT T');
const ca = c.dividendCandidates(hmnLines, txns.filter(t => t.type !== 'DIVIDEND').concat(agg), {});
ok(ca.length === 3 && ca.every(k => k.status === 'dup' && k.matchId === 1), 'several same-day lines = one ledger entry');
// split: one bank line booked as two ledger entries
const split = [{ id: 7, type: 'DIVIDEND', ticker: 'J69U', date: '2026-05-29', dividend: 11654.6 }, { id: 8, type: 'DIVIDEND', ticker: 'J69U', date: '2026-05-29', dividend: 3.8 }];
const oneLine = [{ key: 'k', date: '2026-05-29', deposit: 11658.4, withdrawal: 0, remarks: 'CDP-FRASERS CPT TR', description: 'CDP DIVIDEND', category: 'dividend' }];
const cs = c.dividendCandidates(oneLine, txns.filter(t => t.type !== 'DIVIDEND').concat(split), {});
ok(cs[0].status === 'dup', 'one bank line = two ledger entries');
const fresh = c.dividendCandidates(oneLine, txns.filter(t => t.type !== 'DIVIDEND'), {});
ok(fresh[0].status === 'new' && fresh[0].ticker === 'J69U', 'unmatched dividend is new');

// ---- property yields ----
const y = c.propertyYields({ purchasePrice: 1200000, rent: 4000, mcst: 900, mcstFreq: 'quarterly', propertyTax: 3000, loan: 600000 });
ok(near(y.gross, 0.04) && near(y.net, (48000 - 3600 - 3000) / 1200000) && near(y.ltv, 0.5), 'gross / net yield / LTV');
ok(c.propertyYields({ purchasePrice: 0, rent: 1000 }).gross === null, 'no price → no yield');
const py = c.portfolioYields([{ purchasePrice: 1000000, rent: 3000 }, { purchasePrice: 500000, rent: 2000, mcst: 100, mcstFreq: 'monthly' }]);
ok(near(py.gross, 60000 / 1500000) && near(py.net, (60000 - 1200) / 1500000), 'portfolio yields weight by price');

// ---- premium due dates ----
ok(c.nextDue('2026-01-31', 'monthly', '2026-03-15') === '2026-03-31', 'monthly roll, month-end kept');
ok(c.nextDue('2025-10-01', 'annual', '2026-09-27') === '2026-10-01', 'annual roll');
ok(c.nextDue('2026-10-05', 'quarterly', '2026-09-27') === '2026-10-05', 'future date unchanged');
ok(c.nextDue('2024-05-01', 'single', '2026-09-27') === '2024-05-01', 'single premium does not roll');
ok(near(c.instalment(1200, 'monthly'), 100) && c.instalment(1200, 'single') === 1200, 'instalment per payment');

// ---- market state / auto refresh (fixed clocks, SGT = UTC+8) ----
const at = s => Date.parse(s);
const sun = at('2026-09-27T10:00:00+08:00'), wedOpen = at('2026-09-30T11:00:00+08:00'), wedLate = at('2026-09-30T18:00:00+08:00'), monEarly = at('2026-09-28T08:00:00+08:00');
ok(c.marketState(sun).lastTradingDay === '2026-09-25' && !c.marketState(sun).open, 'Sunday → last trading day Friday');
ok(c.marketState(wedOpen).open && c.marketState(wedOpen).lastTradingDay === '2026-09-30', 'Wednesday 11:00 → open');
ok(c.marketState(monEarly).lastTradingDay === '2026-09-25', 'Monday pre-open → Friday');
const tks = ['A', 'B'];
const pr = d => ({ A: { price: 1, asOf: d }, B: { price: 2, asOf: d } });
ok(c.shouldAutoRefresh({ tickers: tks, prices: pr('2026-09-02'), lastRefreshMs: null, nowMs: sun }).refresh, 'stale prices on a Sunday → refresh');
ok(!c.shouldAutoRefresh({ tickers: tks, prices: pr('2026-09-25'), lastRefreshMs: at('2026-09-26T09:00:00+08:00'), nowMs: sun }).refresh, 'already refreshed after Friday close → no refresh');
ok(!c.shouldAutoRefresh({ tickers: tks, prices: pr('2026-09-22'), lastRefreshMs: at('2026-09-26T09:00:00+08:00'), nowMs: sun }).refresh, 'illiquid stale ticker does not force endless refresh');
ok(c.shouldAutoRefresh({ tickers: tks, prices: pr('2026-09-30'), lastRefreshMs: wedOpen - 20 * 60e3, nowMs: wedOpen }).refresh, 'market open, 20 min old → refresh');
ok(!c.shouldAutoRefresh({ tickers: tks, prices: pr('2026-09-30'), lastRefreshMs: wedOpen - 5 * 60e3, nowMs: wedOpen }).refresh, 'market open, 5 min old → no refresh');
ok(c.shouldAutoRefresh({ tickers: tks, prices: pr('2026-09-30'), lastRefreshMs: wedOpen, nowMs: wedLate }).refresh, 'after close, closing prices not captured → refresh');
ok(c.shouldAutoRefresh({ tickers: tks, prices: { A: { price: 1, asOf: '2026-09-30' } }, lastRefreshMs: wedOpen, nowMs: wedOpen + 60e3 }).refresh, 'missing price → refresh');

// ---- XLSX writer (no external library): real workbook, several sheets, number formats ----
{
  const bytes = c.xlsxWrite([
    { name: 'Holdings', cols: [{ w: 20 }, { w: 12, fmt: 'money' }, { w: 10, fmt: 'pct' }],
      rows: [['Equity', 'Realised P/L', 'Weight'], ['Keppel & Co <A>', 1234.5, 0.25], ['DBS', -10, null], ['Total', 1224.5, 0.25]] },
    { name: 'Period Summary', rows: [['Item', 'Value'], ['Dividends', 79836.2]] }
  ]);
  ok(bytes instanceof Uint8Array && bytes[0] === 0x50 && bytes[1] === 0x4b, 'xlsxWrite returns a zip (PK…)');
  const back = await c.xlsxToRows(bytes);
  ok(back[1][0] === 'Keppel & Co <A>' && back[1][1] === '1234.5' && back[2][1] === '-10' && back[3][0] === 'Total', 'round-trips through our own reader (text escaped, numbers kept)');
  const tmp = path.join(require('os').tmpdir(), 'okfo_xlsx_test.xlsx'); fs.writeFileSync(tmp, bytes);
  let py = '';
  try {
    py = require('child_process').execFileSync('python3', ['-c', `
import openpyxl,sys
wb=openpyxl.load_workbook(sys.argv[1]); h=wb['Holdings']
print(wb.sheetnames==['Holdings','Period Summary'], h['B2'].value==1234.5, h['B2'].number_format, h['C2'].number_format, h['A1'].font.b, wb['Period Summary']['B2'].value)
`, tmp]).toString().trim();
  } catch (e) { py = 'ERR ' + e.message; }
  ok(/^True True .*0\.00.* 0\.00% True 79836\.2$/.test(py), 'opens in openpyxl: 2 sheets, numbers, money/% formats, bold header (' + py + ')');
}

// ---- in-specie double count: an EARNED opening whose value is already booked as a same-day dividend ----
const ds = c.doubleCountedInSpecie(led.transactions);
ok(ds.length === 1 && ds[0].openingId === 396 && ds[0].dividendId === 395, 'finds the KREIT units (8 May 2026) already booked as a S$9,777.68 dividend');
ok(c.doubleCountedInSpecie([
  { id: 1, type: 'OPENING', ticker: 'X', date: '2026-01-02', quantity: 100, price: 2, acquired: 'EARNED' },
  { id: 2, type: 'DIVIDEND', ticker: 'Y', date: '2026-01-02', dividend: 150 }]).length === 0, 'no match when no same-day dividend equals the opening value');
ok(c.doubleCountedInSpecie([
  { id: 1, type: 'OPENING', ticker: 'X', date: '2026-01-02', quantity: 100, price: 2 },
  { id: 2, type: 'DIVIDEND', ticker: 'Y', date: '2026-01-02', dividend: 200 }]).length === 0, 'an opening without the EARNED flag is not a double count');

console.log(failed ? '\n' + failed + ' TEST(S) FAILED' : '\nALL TESTS PASSED');
process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
