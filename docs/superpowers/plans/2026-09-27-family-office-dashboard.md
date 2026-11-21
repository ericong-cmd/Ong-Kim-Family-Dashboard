# Family Office Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the portfolio ledger as a persistent Cowork artifact with a left nav (Rules, Portfolio Ledger, Cash on Hand, Property, Insurance), redesigned cards, live IBKR prices on open, Fibonacci rules, bank-statement dividend capture, and property/insurance registers.

**Architecture:** Source modules in `app/src/` are assembled by `app/build.js` into one self-contained HTML (`app/dist/family-office.html`), published with `create_artifact`. Pure logic lives in `engine.js` (existing) and `calc.js` (new) and is unit-tested in Node; storage is a localStorage adapter exposing the same promise API the ledger already uses; the IBKR bridge calls the connector through `window.cowork.callMcpTool`. A jsdom smoke test exercises the built file end to end.

**Tech Stack:** Vanilla JS/HTML/CSS (no framework), Chart.js 4.5.0 (only allow-listed CDN), Node 22 for tests, jsdom 24 for the smoke test.

**Spec:** `docs/superpowers/specs/2026-09-27-family-office-dashboard-design.md`

---

## Conventions

- **Source of truth:** `app/src/*`. Never edit `app/dist/` — rebuild with `node app/build.js`.
- **Code blocks** that create a file start with a `// @file <path>` line. `node app/tools/extract.js <path>` copies that block from this plan into the file (so plan code and repo code cannot drift at creation time).
- **No git repo** in this folder (sandbox mount blocks `.git` object cleanup). "Checkpoint" steps = run all suites green. Backups of data live in `data/backups/`.
- **Declared deviation:** infrastructure (calc, store, bridge, build, smoke test) has full code below, written test-first. The five tab UIs are specified as exact DOM/function **contracts** (Task 9) enforced by the smoke test, and authored directly in their module files.
- Run every command from the project root `Ong Kim Investment/`.

## File structure

| Path | Responsibility |
|---|---|
| `app/src/engine.js` | Existing calculation engine (positions, FIFO, periods, XIRR, Dietz). Unchanged. |
| `app/src/calc.js` | New pure functions: SGX ticks, Fibonacci, CSV/XLSX statement parsing, categorisation, dividend matching, cash positions, property yields, premium due dates, market-state/auto-refresh. |
| `app/src/store.js` | localStorage persistence + seed bootstrap; `sAll/sGet/sPut/sAdd/sDel/sClear/sBulkAdd`. |
| `app/src/bridge.js` | IBKR connector: contract lookup, quote (snapshot → daily close), history, batch refresh. |
| `app/src/ledger.js` | Existing ledger UI (extracted), minus IndexedDB and init; re-laid out into cards. |
| `app/src/shell.js` | Left nav, page routing, drawer, form builder/validation. |
| `app/src/rules.js`, `cash.js`, `property.js`, `insurance.js` | One module per tab. |
| `app/src/boot.js` | Start-up sequence and auto price refresh. |
| `app/src/styles.css` | Design tokens, shell, cards, tables, drawer, responsive rules. |
| `app/src/index.html` | Page template with `/*{{CSS}}*/`, `{{SEED}}`, `<!--{{SCRIPTS}}-->` slots. |
| `app/src/seed.extra.json` | Seed people + the four policies named in `CLAUDE.md`. |
| `app/build.js` | Assembles dist HTML and embeds the latest `data/backups` ledger as seed. |
| `app/tools/extract.js` | Copies a `// @file` block from this plan into place. |
| `app/test/engine*.test.js` | Existing engine suites (moved). |
| `app/test/calc.test.js` | New calc suite (real bank CSV + real ledger as fixtures). |
| `app/test/smoke.test.js` | jsdom end-to-end test of the built artifact. |
| `app/test/fixtures/statement.xlsx` | Generated DBS-layout workbook for the XLSX reader test. |

---

### Task 1: Extraction tool

**Files:** Create `app/tools/extract.js`

- [ ] **Step 1: Create the tool** (bootstrap: this block is written by hand, every later block is extracted)

```js
// @file app/tools/extract.js
// Copy the fenced code block whose first line is `// @file <path>` from the plan into <path>.
const fs = require('fs'), path = require('path');
const PLAN = 'docs/superpowers/plans/2026-09-27-family-office-dashboard.md';
const want = process.argv[2];
if (!want) { console.error('usage: node app/tools/extract.js <path>'); process.exit(2); }
const md = fs.readFileSync(PLAN, 'utf8');
// The fence is built at runtime: a literal triple backtick here would end this very code block.
const F = '`'.repeat(3);
const re = new RegExp(F + '[a-z]*\\n// @file (\\S+)\\n([\\s\\S]*?)' + F, 'g');
let m, found = null;
while ((m = re.exec(md))) if (m[1] === want) found = m[2];
if (found == null) { console.error('no block for ' + want); process.exit(1); }
fs.mkdirSync(path.dirname(want), { recursive: true });
fs.writeFileSync(want, found);
console.log('wrote ' + want + ' (' + found.split('\n').length + ' lines)');
```

- [ ] **Step 2: Verify** — `node app/tools/extract.js app/tools/extract.js` → `wrote app/tools/extract.js`.

---

### Task 2: calc — failing tests first

**Files:** Create `app/test/calc.test.js`, `app/test/fixtures/statement.xlsx`

- [ ] **Step 1: Generate the XLSX fixture** (DBS layout, real dates, numeric amounts)

Run:
```bash
python3 - <<'PY'
from openpyxl import Workbook
from datetime import date
wb=Workbook(); ws=wb.active
ws.append(['H1','Account Number','Type','Account Currency','Account Name','Date From','Date To'])
ws.append(['H2','3473038453','Current Account','SGD','3473038453 ONG & KIM FAMILY TRUST PTE LTD','01/07/2026','31/07/2026'])
ws.append(['D1','Account Number','Value Date','Date','Time','Description','Your Reference','Our Reference','Cheque Number','Reference5','Remarks','Reference7','Reference8','Reference9','Reference10','Reference11','Reference12','Deposit','Withdrawal','Ledger Balance'])
ws.append(['D2','3473038453',date(2026,7,2),date(2026,7,2),'04:30:11 PM','CDP DIVIDEND','A-1Z','','','','CDP-KIMLY','','','','','','',12000,0,112000.5])
ws.append(['D2','3473038453',date(2026,7,9),date(2026,7,9),'12:00:18 PM','Inward Debit-SES','','12200','','','','','','','','','',0,2000.25,110000.25])
wb.save('app/test/fixtures/statement.xlsx'); print('fixture written')
PY
```
Expected: `fixture written`

- [ ] **Step 2: Write the test suite**

```js
// @file app/test/calc.test.js
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

console.log(failed ? '\n' + failed + ' TEST(S) FAILED' : '\nALL TESTS PASSED');
process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Run to verify it fails** — `node app/test/calc.test.js` → FAIL: `Cannot find module '../src/calc.js'`.

---
### Task 3: calc — implementation

**Files:** Create `app/src/calc.js`

- [ ] **Step 1: Implement**

```js
// @file app/src/calc.js
/* calc.js — pure functions for the family-office dashboard. No DOM. Node-testable.
   Loaded in the browser as a plain script (globals) and in Node via module.exports. */

// ---------- SGX prices ----------
// SGX minimum bid sizes: < S$0.20 → 0.001 · S$0.20 to < S$1.00 → 0.005 · ≥ S$1.00 → 0.01
function sgxTick(p){ p = Math.abs(Number(p) || 0); return p < 0.2 ? 0.001 : p < 1 ? 0.005 : 0.01; }
function roundToTick(p){
  if (p == null || !isFinite(p)) return null;
  const t = sgxTick(p);
  return Number((Math.round(p / t) * t).toFixed(3));
}
function onTick(p){
  if (p == null || !isFinite(p)) return false;
  const t = sgxTick(p);
  return Math.abs(p / t - Math.round(p / t)) < 1e-6;
}
// Quotes carry float noise (1.1300000000000001). Snap to the tick when within noise; else keep 6dp.
function snapToTick(p){
  if (p == null || !isFinite(p)) return null;
  return onTick(p) ? roundToTick(p) : Number(Number(p).toFixed(6));
}

// ---------- Fibonacci ----------
function fibLevels(H, L){
  H = Number(H); L = Number(L);
  if (!(isFinite(H) && isFinite(L) && H > L)) return null;
  const R = H - L;
  return { high: H, low: L, range: R,
    r236: H - 0.236 * R, r382: H - 0.382 * R, r500: H - 0.5 * R, r618: H - 0.618 * R, r786: H - 0.786 * R,
    e1000: H, e1272: L + 1.272 * R, e1618: L + 1.618 * R };
}
// Buy 1-3 at the 38.2 / 50 / 61.8 retracements, cut loss at 78.6, sells at the prior high and the
// 127.2 / 161.8 extensions — all rounded to a tradeable SGX tick.
function fibRecommend(H, L){
  const f = fibLevels(H, L); if (!f) return null;
  return { buy1: roundToTick(f.r382), buy2: roundToTick(f.r500), buy3: roundToTick(f.r618), cut: roundToTick(f.r786),
    sell1: roundToTick(f.e1000), sell2: roundToTick(f.e1272), sell3: roundToTick(f.e1618) };
}
function isoDay(t){ return String(t || '').slice(0, 10); }
function swingFromBars(b){
  if (!b || !b.time || !b.time.length) return null;
  let hi = -Infinity, hiI = -1, lo = Infinity, loI = -1;
  for (let i = 0; i < b.time.length; i++){
    const h = Number(b.high[i]), l = Number(b.low[i]);
    if (h > hi){ hi = h; hiI = i; }
    if (l < lo){ lo = l; loI = i; }
  }
  if (hiI < 0 || loI < 0) return null;
  return { high: hi, highDate: isoDay(b.time[hiI]), low: lo, lowDate: isoDay(b.time[loI]), trend: loI < hiI ? 'up' : 'down' };
}
function ruleStatus(last, r){
  if (last == null || !isFinite(last) || !r) return 'unknown';
  if (r.cut != null && last <= r.cut) return 'cut';
  if (r.sell1 != null && last >= r.sell1) return 'profit';
  if (r.buy1 != null && last <= r.buy1) return 'buy';
  return 'hold';
}
function buyTier(last, r){
  if (last == null || !r) return 0;
  if (r.buy3 != null && last <= r.buy3) return 3;
  if (r.buy2 != null && last <= r.buy2) return 2;
  if (r.buy1 != null && last <= r.buy1) return 1;
  return 0;
}

// ---------- parsing primitives ----------
function parseCSV(text){
  text = String(text || '').replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (q){ if (ch === '"'){ if (text[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ','){ row.push(cur); cur = ''; }
    else if (ch === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length){ row.push(cur); rows.push(row); }
  return rows.map(r => r.map(x => x.replace(/^﻿/, '').trim())).filter(r => r.some(x => x !== ''));
}
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function toISODate(s){
  s = String(s == null ? '' : s).trim(); let m;
  if ((m = s.match(/^(\d{5})(\.\d+)?$/))){                       // Excel serial (days since 1899-12-30)
    return new Date(Date.UTC(1899, 11, 30) + Number(m[1]) * 86400000).toISOString().slice(0, 10);
  }
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/))) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  if ((m = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3})[a-z]*[\s\-]+(\d{4})$/))){
    const mi = MONTHS.indexOf(m[2].toLowerCase()); if (mi >= 0) return m[3] + '-' + String(mi + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }
  return null;
}
function toNum(s){
  if (s == null) return 0;
  if (typeof s === 'number') return isFinite(s) ? s : 0;
  const t = String(s).replace(/[,\s$]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = Number(t); return isFinite(n) ? n : 0;
}
function to24h(t){
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return '';
  let h = Number(m[1]); const ap = (m[4] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + m[2] + ':' + (m[3] || '00');
}
function round2(x){ return Math.round(Number(x) * 100) / 100; }
function dayDiff(a, b){ return Math.round((Date.parse(a) - Date.parse(b)) / 86400000); }

// ---------- bank statements ----------
function makeIndex(hdr){
  const l = hdr.map(x => String(x).toLowerCase());
  const f = (...res) => { for (const re of res){ const i = l.findIndex(x => re.test(x)); if (i >= 0) return i; } return -1; };
  return { account: f(/^account number$/), date: f(/^date$/, /transaction date/, /^date/), valueDate: f(/value date/),
    time: f(/^time$/), desc: f(/^description$/, /description|particulars|details/), ref1: f(/your reference/, /^reference$/),
    ref2: f(/our reference/), remarks: f(/^remarks?$/, /remark/), dep: f(/^deposit$/, /deposit|credit|money in/),
    wd: f(/^withdrawal$/, /withdraw|debit|money out/), bal: f(/ledger balance/, /balance/) };
}
function categorise(l){
  const d = String(l.description || '').toUpperCase();
  const x = (String(l.ref || '') + ' ' + String(l.remarks || '')).toUpperCase();
  if (l.deposit > 0 && (/DIVIDEND|DISTRIBUTION/.test(d) || /\bCDP-/.test(x))) return 'dividend';
  if (l.withdrawal > 0 && /\bDIV\b|DIVIDEND/.test(x + ' ' + d)) return 'payout';
  if (/SVC\s*CHG|SERVICE CHARGE|\bFEE\b|\bCHARGES?\b/.test(d)) return 'fee';
  if (/\bSES\b|-SES\b/.test(d)) return 'settlement';
  if (/INTEREST/.test(d)) return 'interest';
  if (/TRANSFER|PAYNOW|FAST|GIRO|\bIBG\b|MEPS|FUNDS/.test(d)) return 'transfer';
  return 'other';
}
function lineKey(l){
  return [l.account, l.date, l.time, l.ref, l.description, l.deposit.toFixed(2), l.withdrawal.toFixed(2), l.balance == null ? '' : l.balance.toFixed(2)].join('|');
}
function lineFrom(r, col, acct, i){
  const g = k => col[k] >= 0 ? String(r[col[k]] == null ? '' : r[col[k]]).trim() : '';
  const line = { account: g('account') || acct || '', date: toISODate(g('date')) || toISODate(g('valueDate')),
    valueDate: toISODate(g('valueDate')), time: to24h(g('time')), description: g('desc'),
    ref: [g('ref1'), g('ref2')].filter(Boolean).join(' / '), remarks: g('remarks'),
    deposit: Math.abs(toNum(g('dep'))), withdrawal: Math.abs(toNum(g('wd'))),
    balance: col.bal >= 0 && g('bal') !== '' ? toNum(g('bal')) : null, seq: i };
  line.category = categorise(line);
  line.key = lineKey(line);
  return line;
}
function parseBankStatement(rows){
  const out = { account: '', accountName: '', from: null, to: null, lines: [], format: null };
  const tag = r => String(r[0] || '').trim().toUpperCase();
  const d1 = rows.find(r => tag(r) === 'D1');
  if (d1){
    out.format = 'dbs';
    const h1 = rows.find(r => tag(r) === 'H1'), h2 = rows.find(r => tag(r) === 'H2');
    if (h1 && h2){
      const ix = n => h1.findIndex(x => String(x).toLowerCase() === n);
      out.account = String(h2[ix('account number')] || '').trim();
      out.accountName = String(h2[ix('account name')] || '').trim();
      out.from = toISODate(h2[ix('date from')]); out.to = toISODate(h2[ix('date to')]);
    }
    const col = makeIndex(d1);
    // DBS exports end with an unquoted legend ("D1 , Detail Desc" / "D2 , Detail" / "T , Trailer")
    // that reuses the row tags — keep only D2 rows that carry a real date.
    rows.filter(r => tag(r) === 'D2').forEach((r, i) => { const ln = lineFrom(r, col, out.account, i); if (ln.date) out.lines.push(ln); });
    return out;
  }
  const hi = rows.findIndex(r => { const l = r.map(x => String(x).toLowerCase());
    return l.some(x => /date/.test(x)) && l.some(x => /deposit|credit|money in/.test(x)) && l.some(x => /withdraw|debit|money out/.test(x)); });
  if (hi < 0) return out;
  out.format = 'generic';
  const col = makeIndex(rows[hi]);
  rows.slice(hi + 1).forEach((r, i) => { const ln = lineFrom(r, col, out.account, i); if (ln.date) out.lines.push(ln); });
  const ds = out.lines.map(l => l.date).sort();
  out.from = ds[0] || null; out.to = ds[ds.length - 1] || null;
  return out;
}
function cashPositions(lines){
  const by = {};
  const ord = l => (l.date || '') + 'T' + (l.time || '00:00:00') + '#' + (l.importedAt || '') + '#' + String(l.seq == null ? 0 : l.seq).padStart(6, '0');
  (lines || []).forEach(l => {
    if (l.balance == null) return;
    const k = l.account || '(account)';
    if (!by[k] || ord(l) > ord(by[k])) by[k] = l;
  });
  const accounts = Object.entries(by).map(([account, l]) => ({ account, balance: l.balance, asOf: l.date }));
  return { accounts, total: round2(accounts.reduce((s, a) => s + a.balance, 0)),
    asOf: accounts.map(a => a.asOf).sort().slice(-1)[0] || null };
}

// ---------- XLSX (inline reader: zip central directory + deflate-raw + regex XML) ----------
async function inflateRaw(u8){
  const ds = new DecompressionStream('deflate-raw');
  const out = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}
async function unzip(buf, want){
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--){ if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; } }
  if (eocd < 0) throw new Error('Not an XLSX file');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const files = {};
  const td = new TextDecoder();
  for (let n = 0; n < count; n++){
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged XLSX file');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true),
      elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    if (!want || want(name)){
      const ln = dv.getUint16(off + 26, true), le = dv.getUint16(off + 28, true);
      const data = u8.subarray(off + 30 + ln + le, off + 30 + ln + le + csize);
      files[name] = method === 0 ? data : method === 8 ? await inflateRaw(data) : null;
    }
    p += 46 + nlen + elen + clen;
  }
  return files;
}
function xmlDecode(s){
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}
function colIndex(ref){ const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
async function xlsxToRows(buf){
  const files = await unzip(buf, n => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const dec = u => u ? new TextDecoder().decode(u) : '';
  const ss = [];
  (dec(files['xl/sharedStrings.xml']).match(/<si>[\s\S]*?<\/si>/g) || []).forEach(si => {
    ss.push(xmlDecode((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(t => t.replace(/<t[^>]*>|<\/t>/g, '')).join('')));
  });
  const sheet = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/(\d+)\.xml$/)[1]) - parseInt(b.match(/(\d+)\.xml$/)[1]))[0];
  if (!sheet) throw new Error('No worksheet in this XLSX');
  const rows = [];
  (dec(files[sheet]).match(/<row[^>]*\/>|<row[\s\S]*?<\/row>/g) || []).forEach(rx => {
    const row = [];
    (rx.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) || []).forEach(cx => {
      const ref = (cx.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const t = (cx.match(/\bt="(\w+)"/) || [])[1];
      const v = (cx.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (t === 's') val = ss[+v] || '';
      else if (t === 'inlineStr') val = xmlDecode(((cx.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1]) || '');
      else if (v != null) val = xmlDecode(v);
      row[ref ? colIndex(ref) : row.length] = String(val).trim();
    });
    for (let i = 0; i < row.length; i++) if (row[i] == null) row[i] = '';
    rows.push(row);
  });
  return rows.filter(r => r.some(x => x !== ''));
}

// ---------- dividends: payer → ticker, dedupe against the ledger ----------
const NAME_NOISE = /\b(LTD|LIMITED|PTE|HLDGS?|HOLDINGS|CORP|CORPORATION|GROUP|INC|PLC)\b/g;
function normName(s){
  return String(s || '').toUpperCase().replace(/^CDP[-\s]*/, '').replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(NAME_NOISE, ' ').replace(/\s+/g, ' ').trim();
}
function buildNameMap(txns){
  const m = {};
  [...(txns || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach(t => {
    const tk = String(t.ticker || '').toUpperCase(); if (!tk) return;
    if (t.equity) m[normName(t.equity)] = tk;
    m[normName(tk)] = tk;
  });
  return m;
}
function matchTicker(payer, nameMap, learned){
  const n = normName(payer); if (!n) return null;
  if (learned && learned[n]) return learned[n];
  if (nameMap[n]) return nameMap[n];
  const hits = Object.keys(nameMap).filter(k => k.length >= 4 && (k.startsWith(n + ' ') || n.startsWith(k + ' ')));
  const tks = [...new Set(hits.map(k => nameMap[k]))];
  return tks.length === 1 ? tks[0] : null;
}
function payerOf(l){
  const r = String(l.remarks || ''); const m = r.match(/CDP[-\s]+(.+)/i);
  if (m) return m[1].trim();
  if (r) return r.trim();
  return String(l.description || '').replace(/CDP\s*DIVIDEND/i, '').trim();
}
// Match bank dividend lines to ledger DIVIDEND entries (same ticker, amount to the cent, within ±tol days):
// 1) one line ↔ one entry, closest date first; 2) several same-day lines ↔ one entry (booked as a total);
// 3) one line ↔ two or three entries (booked split). Each ledger entry is used at most once.
function dividendCandidates(lines, txns, learned, opts){
  const tol = (opts && opts.tolDays) || 7;
  const nm = buildNameMap(txns);
  const cands = (lines || []).filter(l => l.category === 'dividend').map(l => {
    const payer = payerOf(l), tk = matchTicker(payer, nm, learned);
    return { key: l.key, date: l.date, amount: round2(l.deposit), payer, ticker: tk, status: tk ? 'new' : 'unmapped', matchId: null, matchIds: [] };
  });
  const ledger = (txns || []).filter(t => t.type === 'DIVIDEND')
    .map(t => ({ id: t.id, ticker: String(t.ticker || '').toUpperCase(), date: t.date, amount: round2(t.dividend), used: false }));
  const near = (t, c) => t.ticker === c.ticker && Math.abs(dayDiff(t.date, c.date)) <= tol;
  cands.filter(c => c.ticker).forEach(c => {
    let best = null;
    ledger.forEach(t => { if (t.used || !near(t, c) || Math.abs(t.amount - c.amount) > 0.011) return;
      const dd = Math.abs(dayDiff(t.date, c.date)); if (!best || dd < best.dd) best = { t, dd }; });
    if (best){ best.t.used = true; c.status = 'dup'; c.matchId = best.t.id; c.matchIds = [best.t.id]; }
  });
  const groups = {};
  cands.filter(c => c.status === 'new').forEach(c => { const g = c.ticker + '|' + c.date; (groups[g] = groups[g] || []).push(c); });
  Object.values(groups).forEach(g => {
    if (g.length < 2) return;
    const sum = round2(g.reduce((s, c) => s + c.amount, 0));
    const t = ledger.find(t => !t.used && near(t, g[0]) && Math.abs(t.amount - sum) <= 0.011);
    if (t){ t.used = true; g.forEach(c => { c.status = 'dup'; c.matchId = t.id; c.matchIds = [t.id]; }); }
  });
  cands.filter(c => c.status === 'new').forEach(c => {
    const pool = ledger.filter(t => !t.used && near(t, c)).slice(0, 8);
    for (let mask = 1; mask < (1 << pool.length); mask++){
      const pick = pool.filter((_, i) => mask & (1 << i));
      if (pick.length < 2 || pick.length > 3) continue;
      if (Math.abs(round2(pick.reduce((s, t) => s + t.amount, 0)) - c.amount) <= 0.011){
        pick.forEach(t => { t.used = true; }); c.status = 'dup'; c.matchId = pick[0].id; c.matchIds = pick.map(t => t.id); break;
      }
    }
  });
  return cands;
}

// ---------- property ----------
const FREQ_PER_YEAR = { monthly: 12, quarterly: 4, 'half-yearly': 2, annual: 1, single: 1 };
function propertyYields(p){
  const price = toNum(p.purchasePrice), rent = toNum(p.rent) * 12;
  const mcst = toNum(p.mcst) * (FREQ_PER_YEAR[p.mcstFreq] || 4), tax = toNum(p.propertyTax);
  return { annualRent: rent, annualMcst: mcst, annualTax: tax, noi: rent - mcst - tax,
    gross: price > 0 ? rent / price : null, net: price > 0 ? (rent - mcst - tax) / price : null,
    ltv: price > 0 ? toNum(p.loan) / price : null };
}
function portfolioYields(list){
  let price = 0, rent = 0, noi = 0;
  (list || []).forEach(p => { const y = propertyYields(p); if (toNum(p.purchasePrice) > 0){ price += toNum(p.purchasePrice); rent += y.annualRent; noi += y.noi; } });
  return { price, annualRent: rent, noi, gross: price > 0 ? rent / price : null, net: price > 0 ? noi / price : null };
}

// ---------- insurance ----------
const FREQ_MONTHS = { monthly: 1, quarterly: 3, 'half-yearly': 6, annual: 12, single: 0 };
function addMonths(iso, n){
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}
// Roll the payment due date forward by the premium frequency until it is today or later.
// Always counted from the original date so month-end dates don't drift (31 Jan → 28 Feb → 31 Mar).
function nextDue(due, freq, today){
  if (!due) return null;
  const step = FREQ_MONTHS[freq];
  if (!step || due >= today) return due;
  let k = 0, d = due;
  while (d < today && k < 1200){ k++; d = addMonths(due, step * k); }
  return d;
}
function instalment(annual, freq){ const n = FREQ_PER_YEAR[freq] || 1; return freq === 'single' ? toNum(annual) : toNum(annual) / n; }

// ---------- market state / auto refresh (SGX, Singapore time UTC+8) ----------
function sgtParts(ms){ const d = new Date(ms + 8 * 3600e3); return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
function prevWeekday(iso){ const d = new Date(iso + 'T00:00:00Z'); do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10); }
function marketState(ms){
  const p = sgtParts(ms), wk = p.dow >= 1 && p.dow <= 5;
  return { today: p.date, mins: p.mins, weekday: wk, open: wk && p.mins >= 540 && p.mins < 1020,
    lastTradingDay: (wk && p.mins >= 540) ? p.date : prevWeekday(p.date) };
}
function shouldAutoRefresh(o){
  const tickers = o.tickers || [], prices = o.prices || {}, last = o.lastRefreshMs, now = o.nowMs;
  if (!tickers.length) return { refresh: false, reason: 'no holdings' };
  const missing = tickers.filter(t => !prices[t] || prices[t].price == null);
  if (missing.length) return { refresh: true, reason: 'missing prices: ' + missing.join(', ') };
  const m = marketState(now);
  if (m.open) return (!last || now - last > 15 * 60e3) ? { refresh: true, reason: 'market open; last refresh over 15 minutes ago' } : { refresh: false, reason: 'refreshed recently' };
  const closeOf = d => Date.parse(d + 'T17:00:00+08:00');
  if (last && last >= closeOf(m.lastTradingDay)) return { refresh: false, reason: 'closing prices already captured' };
  const stale = tickers.filter(t => String(prices[t].asOf || '') < m.lastTradingDay);
  if (stale.length) return { refresh: true, reason: 'prices older than ' + m.lastTradingDay };
  if (m.weekday && m.mins >= 1020 && (!last || last < closeOf(m.today))) return { refresh: true, reason: 'closing prices not yet captured' };
  return { refresh: false, reason: 'prices current' };
}

if (typeof module !== 'undefined' && module.exports){
  module.exports = { sgxTick, roundToTick, onTick, snapToTick, fibLevels, fibRecommend, swingFromBars, ruleStatus, buyTier,
    parseCSV, toISODate, toNum, to24h, round2, dayDiff, parseBankStatement, categorise, lineKey, cashPositions,
    xlsxToRows, normName, buildNameMap, matchTicker, payerOf, dividendCandidates,
    propertyYields, portfolioYields, nextDue, addMonths, instalment, sgtParts, marketState, shouldAutoRefresh,
    FREQ_PER_YEAR, FREQ_MONTHS };
}
```

- [ ] **Step 2: Run to verify it passes** — `node app/test/calc.test.js` → `ALL TESTS PASSED`.
- [ ] **Step 3: Checkpoint** — `node app/test/engine.test.js && node app/test/engine.basis.test.js && node app/test/calc.test.js` all green.

---
### Task 4: store — localStorage persistence with seed

**Files:** Create `app/test/store.test.js`, `app/src/store.js`

- [ ] **Step 1: Write the failing test**

```js
// @file app/test/store.test.js
// Runs store.js in a sandbox with a fake localStorage and a fake seed element.
const fs = require('fs'), path = require('path'), vm = require('vm');
let failed = 0; const ok = (c, n) => { console.log((c ? '  PASS' : '  FAIL') + '  ' + n); if (!c) failed++; };
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'store.js'), 'utf8');
function world(saved, seed, lsBroken){
  const mem = Object.assign({}, saved || {});
  const localStorage = lsBroken ? { getItem(){ throw new Error('blocked'); }, setItem(){ throw new Error('blocked'); }, removeItem(){} }
    : { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const document = { getElementById: id => (id === 'seed' && seed ? { textContent: JSON.stringify(seed) } : null) };
  const ctx = { localStorage, document, console: { warn(){}, error(){}, log(){} }, JSON, Object, Number, String, Promise, Date };
  vm.createContext(ctx); vm.runInContext(SRC + '\n;this.api={storeInit,storeReset,sAll,sGet,sPut,sAdd,sDel,sClear,sBulkAdd,getSource:()=>STORE_SOURCE};', ctx);
  return { api: ctx.api, mem };
}
(async () => {
  const seed = { exportedAt: '2026-09-02', transactions: [{ id: 99, type: 'BUY', ticker: 'X', date: '2026-01-01' }, { id: 100, type: 'SELL', ticker: 'X', date: '2026-02-01' }],
    prices: [{ ticker: 'X', price: 1, asOf: '2026-09-02' }], boundaries: [{ key: 'ALL|FY|2027', openingBasis: 'MARKET' }],
    histPrices: [{ date: '2026-03-31', ticker: 'X', price: 0.9 }], people: [{ id: 1, name: 'A' }], policies: [{ id: 1, insured: 'A' }] };
  // first open: no saved data → seed
  let w = world(null, seed);
  ok(w.api.storeInit() === 'seed', 'first open loads the embedded seed');
  let tx = await w.api.sAll('transactions');
  ok(tx.length === 2 && tx[0].id === 1 && tx[1].id === 2 && tx[0].type === 'BUY', 'seed transactions renumbered in order');
  ok((await w.api.sAll('histprices'))[0].key === '2026-03-31|X', 'hist prices keyed date|ticker');
  ok((await w.api.sAll('policies')).length === 1 && (await w.api.sAll('people')).length === 1, 'seed people and policies');
  ok(typeof w.mem['okfo:v1'] === 'string', 'seed persisted immediately');
  // edits persist; reopening prefers saved data over the seed
  const id = await w.api.sAdd('transactions', { id: 555, type: 'DIVIDEND', ticker: 'X', date: '2026-03-01' });
  ok(id === 3, 'sAdd ignores a supplied id on auto stores and continues the sequence');
  await w.api.sPut('properties', { name: 'Flat' });
  await w.api.sPut('prices', { ticker: 'X', price: 2, asOf: '2026-09-03' });
  const w2 = world(w.mem, seed);
  ok(w2.api.storeInit() === 'saved', 'reopen uses saved data, not the seed');
  ok((await w2.api.sAll('transactions')).length === 3 && (await w2.api.sAll('properties'))[0].id === 1, 'saved edits survive a reopen');
  ok((await w2.api.sGet('prices', 'X')).price === 2, 'price update survived');
  await w2.api.sDel('transactions', 2); ok((await w2.api.sAll('transactions')).length === 2, 'delete');
  await w2.api.sBulkAdd('cash', [{ key: 'a', v: 1 }, { key: 'b', v: 2 }]); ok((await w2.api.sAll('cash')).length === 2, 'bulk add');
  await w2.api.sClear('cash'); ok((await w2.api.sAll('cash')).length === 0, 'clear');
  const got = await w2.api.sGet('prices', 'X'); got.price = 999;
  ok((await w2.api.sGet('prices', 'X')).price === 2, 'reads are copies — callers cannot mutate storage');
  ok(w2.api.storeReset() === 'seed' && (await w2.api.sAll('properties')).length === 0, 'reset returns to bundled data');
  // storage blocked → in-memory mode, still usable
  const w3 = world(null, seed, true);
  ok(w3.api.storeInit() === 'memory' && (await w3.api.sAll('transactions')).length === 2, 'blocked storage → memory mode with seed');
  console.log(failed ? '\n' + failed + ' TEST(S) FAILED' : '\nALL TESTS PASSED'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run to verify it fails** — `node app/test/store.test.js` → FAIL (`ENOENT … store.js`).
- [ ] **Step 3: Implement**

```js
// @file app/src/store.js
/* store.js — every record lives in one localStorage document, which Cowork artifacts keep across
   reloads and app restarts. Same promise API the ledger used with IndexedDB, so ledger code is
   unchanged. The embedded seed is used only when nothing has been saved yet. */
const STORE_KEY = 'okfo:v1';
const KEYPATH = { transactions: 'id', prices: 'ticker', boundaries: 'key', histprices: 'key', meta: 'key', rules: 'id',
  cash: 'key', properties: 'id', policies: 'id', people: 'id', maps: 'key' };
const AUTO = { transactions: 1, rules: 1, properties: 1, policies: 1, people: 1 };
let DOC = null, STORE_SOURCE = 'empty', STORE_OK = true;
const _clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
function _blankDoc(){ const stores = {}; Object.keys(KEYPATH).forEach(k => { stores[k] = {}; }); return { version: 1, savedAt: null, seq: {}, stores }; }
function _persist(){
  DOC.savedAt = new Date().toISOString();
  if (STORE_SOURCE === 'memory') return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(DOC)); STORE_OK = true; }
  catch (e) {
    STORE_OK = false; console.error('save failed', e);
    if (typeof toast === 'function') toast('Couldn’t save on this device (' + e.message + '). Back up JSON now.');
  }
  if (typeof onStoreSaved === 'function') { try { onStoreSaved(DOC.savedAt, STORE_OK); } catch (e) {} }
}
function _nextId(store){
  const cur = Object.keys(DOC.stores[store]).reduce((m, k) => Math.max(m, Number(k) || 0), 0);
  DOC.seq[store] = Math.max(DOC.seq[store] || 0, cur) + 1;
  return DOC.seq[store];
}
function _put(store, val){
  const kp = KEYPATH[store]; if (!kp) throw new Error('Unknown store ' + store);
  const v = _clone(val);
  if (AUTO[store] && (v[kp] == null || v[kp] === '')) v[kp] = _nextId(store);
  if (v[kp] == null || v[kp] === '') throw new Error(store + ' record is missing ' + kp);
  DOC.stores[store][v[kp]] = v;
  return v[kp];
}
function sAll(store){ return Promise.resolve(Object.values(DOC.stores[store] || {}).map(_clone)); }
function sGet(store, key){ const v = (DOC.stores[store] || {})[key]; return Promise.resolve(v == null ? null : _clone(v)); }
function sPut(store, val){ const k = _put(store, val); _persist(); return Promise.resolve(k); }
function sAdd(store, val){ const v = _clone(val); if (AUTO[store]) delete v[KEYPATH[store]]; return sPut(store, v); }
function sDel(store, key){ delete DOC.stores[store][key]; _persist(); return Promise.resolve(); }
function sClear(store){ DOC.stores[store] = {}; _persist(); return Promise.resolve(); }
function sBulkAdd(store, items){
  (items || []).forEach(it => { const v = _clone(it); if (AUTO[store]) delete v[KEYPATH[store]]; _put(store, v); });
  _persist(); return Promise.resolve();
}
function _seedDoc(){
  DOC = _blankDoc();
  const el = document.getElementById('seed'); if (!el) return DOC;
  let s; try { s = JSON.parse(el.textContent); } catch (e) { console.error('seed unreadable', e); return DOC; }
  (s.transactions || []).forEach(t => { const v = _clone(t); delete v.id; _put('transactions', v); });
  (s.prices || []).forEach(p => _put('prices', p));
  (s.boundaries || []).forEach(b => _put('boundaries', b));
  (s.histPrices || []).forEach(h => _put('histprices', Object.assign({ key: h.date + '|' + h.ticker }, h)));
  ['people', 'policies', 'properties', 'rules'].forEach(k => (s[k] || []).forEach(r => _put(k, r)));
  _put('meta', { key: 'seededFrom', value: s.seedSource || s.exportedAt || null });
  return DOC;
}
function _lsUsable(){ try { const k = '__okfo_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; } }
function storeInit(){
  if (!_lsUsable()){ _seedDoc(); STORE_SOURCE = 'memory'; return STORE_SOURCE; }
  let saved = null;
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) saved = JSON.parse(raw); } catch (e) { console.warn('saved data unreadable', e); }
  if (saved && saved.stores){
    DOC = saved; DOC.seq = DOC.seq || {};
    Object.keys(KEYPATH).forEach(k => { if (!DOC.stores[k]) DOC.stores[k] = {}; });
    STORE_SOURCE = 'saved';
  } else {
    _seedDoc();
    STORE_SOURCE = Object.keys(DOC.stores.transactions).length ? 'seed' : 'empty';
    _persist();
  }
  return STORE_SOURCE;
}
function storeReset(){ try { localStorage.removeItem(STORE_KEY); } catch (e) {} DOC = null; return storeInit(); }
function storeSavedAt(){ return DOC ? DOC.savedAt : null; }
```

- [ ] **Step 4: Run to verify it passes** — `node app/test/store.test.js` → `ALL TESTS PASSED`.

---

### Task 5: bridge — IBKR connector

**Files:** Create `app/src/bridge.js`. (Exercised end to end by the smoke test in Task 7 with a fake connector; response shapes below were verified live in this session.)

Verified shapes: `get_price_snapshot` → `{last:{price,ts,halted,is_close}, "bid-ask":{…}}` during SGX hours, `{}` when closed; `get_price_history` → `{time:[ISO…], open:[], high:[], low:[], close:[], volume:[], corp_actions?}`; `search_contracts` → `{results:[{underlying_contract_id, exchange, symbol, description}]}`. Inside the artifact, `callMcpTool` returns `{content, structuredContent, isError}`.

- [ ] **Step 1: Implement**

```js
// @file app/src/bridge.js
/* bridge.js — live SGX prices through the IBKR connector (window.cowork.callMcpTool).
   The artifact sandbox blocks direct web requests; the connector is the live source. */
const IBKR_PREFIX = 'mcp__11074d8e-bdc3-4cc0-a0b4-0174219e8270__';
function hasBridge(){ return !!(typeof window !== 'undefined' && window.cowork && typeof window.cowork.callMcpTool === 'function'); }
async function ibkr(tool, args){
  const r = await window.cowork.callMcpTool(IBKR_PREFIX + tool, args);
  if (!r) throw new Error('No response from the IBKR connector');
  if (r.isError){ const msg = (r.content && r.content[0] && r.content[0].text) || 'IBKR connector error'; throw new Error(msg); }
  if (r.structuredContent != null) return r.structuredContent;
  const txt = r.content && r.content[0] && r.content[0].text;
  return txt ? JSON.parse(txt) : {};
}
async function contractFor(tk){
  tk = String(tk || '').toUpperCase(); if (!tk) return null;
  if (IBKR_CONTRACTS[tk]) return IBKR_CONTRACTS[tk];
  const d = await ibkr('search_contracts', { query: tk });
  const hit = (d.results || []).find(x => x.exchange === 'SGX' && String(x.symbol).toUpperCase() === tk);
  if (!hit) return null;
  IBKR_CONTRACTS[tk] = hit.underlying_contract_id;
  await sPut('maps', { key: 'cid:' + tk, value: hit.underlying_contract_id });
  return hit.underlying_contract_id;
}
function epochToSgtDate(sec){ return new Date(sec * 1000 + 8 * 3600e3).toISOString().slice(0, 10); }
// Real-time last during SGX hours; otherwise the latest daily close, dated with that bar's date.
async function quoteTicker(tk){
  const cid = await contractFor(tk); if (!cid) throw new Error('No SGX listing found for ' + tk);
  let snap = {};
  try { snap = await ibkr('get_price_snapshot', { contract_id: cid, exchange: 'SGX', market_data_names: ['last', 'bid_ask'] }); } catch (e) { snap = {}; }
  const last = snap && snap.last;
  if (last && last.price != null && isFinite(last.price) && !last.halted){
    return { ticker: tk, price: snapToTick(Number(last.price)), asOf: last.ts ? epochToSgtDate(last.ts) : sgtParts(Date.now()).date, live: true };
  }
  const h = await ibkr('get_price_history', { contract_id: cid, security_type: 'STK', exchange: 'SGX', step: 'ONE_DAY', period: 'ONE_WEEK', outside_rth: false });
  const n = (h.close || []).length; if (!n) throw new Error('No recent close for ' + tk);
  return { ticker: tk, price: snapToTick(Number(h.close[n - 1])), asOf: String(h.time[n - 1]).slice(0, 10), live: false };
}
async function priceHistory(tk, period){
  const cid = await contractFor(tk); if (!cid) throw new Error('No SGX listing found for ' + tk);
  const h = await ibkr('get_price_history', { contract_id: cid, security_type: 'STK', exchange: 'SGX', step: 'ONE_DAY', period: period || 'SIX_MONTHS', outside_rth: false });
  return { time: h.time || [], open: h.open || [], high: h.high || [], low: h.low || [], close: h.close || [] };
}
let _refreshing = false;
async function refreshPrices(tickers, opts){
  if (_refreshing) return { skipped: true, ok: [], fail: [] };
  _refreshing = true;
  const ok = [], fail = [], queue = [...tickers]; let done = 0;
  const onProgress = opts && opts.onProgress;
  const worker = async () => {
    while (queue.length){
      const tk = queue.shift();
      try { const q = await quoteTicker(tk); await sPut('prices', { ticker: tk, price: q.price, asOf: q.asOf, source: 'IBKR' }); ok.push(q); }
      catch (e) { fail.push({ ticker: tk, error: e.message }); }
      done++; if (onProgress) onProgress(done, tickers.length);
    }
  };
  try { await Promise.all([worker(), worker(), worker(), worker()]); await sPut('meta', { key: 'lastPriceRefresh', value: Date.now() }); }
  finally { _refreshing = false; }
  return { ok, fail };
}
```

---

### Task 6: seed extras and build

**Files:** Create `app/src/seed.extra.json`, `app/build.js`

- [ ] **Step 1: Seed people and the four policies named in `CLAUDE.md`** (known facts only; everything else left for Eric, flagged `needsDetails`)

```json
// @file app/src/seed.extra.json
{
  "people": [ { "id": 1, "name": "Ong Ah Whatt" }, { "id": 2, "name": "Ngiow Lee Kim" } ],
  "policies": [
    { "id": 1, "insured": "Ong Ah Whatt", "insurer": "Great Eastern", "policyNo": "0011254391", "type": "", "owner": "Ong & Kim Family Trust Pte Ltd", "paidBy": "Ong & Kim Family Trust Pte Ltd", "freq": "annual", "status": "In force", "needsDetails": true, "notes": "Company-owned policy on the life of Ong Ah Whatt. Carried at surrender value in the FS; premiums expensed." },
    { "id": 2, "insured": "Ong Ah Whatt", "insurer": "Great Eastern", "policyNo": "0011761817", "type": "", "owner": "Ong & Kim Family Trust Pte Ltd", "paidBy": "Ong & Kim Family Trust Pte Ltd", "freq": "annual", "status": "In force", "needsDetails": true, "notes": "Company-owned policy on the life of Ong Ah Whatt. Carried at surrender value in the FS; premiums expensed." },
    { "id": 3, "insured": "Ong Ah Whatt", "insurer": "Great Eastern", "policyNo": "0026371681", "type": "", "owner": "Ong & Kim Family Trust Pte Ltd", "paidBy": "Ong & Kim Family Trust Pte Ltd", "freq": "annual", "status": "In force", "needsDetails": true, "notes": "Company-owned policy on the life of Ong Ah Whatt. Carried at surrender value in the FS; premiums expensed." },
    { "id": 4, "insured": "Ngiow Lee Kim", "insurer": "", "policyNo": "0244004327", "type": "", "owner": "", "paidBy": "Ong & Kim Family Trust Pte Ltd", "freq": "annual", "status": "In force", "needsDetails": true, "notes": "Not company-owned; premium paid by the company under the family mandate and expensed." }
  ]
}
```
(The extractor writes the block body after the `// @file` line, so the JSON file itself contains no comment.)

- [ ] **Step 2: Build script**

```js
// @file app/build.js
// Assemble app/src/* into one self-contained HTML with the latest ledger backup embedded as seed.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), SRC = path.join(__dirname, 'src');
const ORDER = ['engine', 'calc', 'store', 'bridge', 'ledger', 'shell', 'rules', 'cash', 'property', 'insurance', 'boot'];
const newest = (dir, re) => { if (!fs.existsSync(dir)) return null; const f = fs.readdirSync(dir).filter(n => re.test(n)).sort().pop(); return f ? path.join(dir, f) : null; };
const backupPath = newest(path.join(ROOT, 'data', 'backups'), /^portfolio-ledger_backup_.*\.json$/);
if (!backupPath) throw new Error('No ledger backup in data/backups');
const seed = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const pricesPath = newest(path.join(ROOT, 'data', 'prices'), /^prices_.*\.json$/);
if (pricesPath){   // a newer price file wins ticker by ticker
  const by = {}; (seed.prices || []).forEach(p => { by[p.ticker] = p; });
  JSON.parse(fs.readFileSync(pricesPath, 'utf8')).prices.forEach(p => { const cur = by[p.ticker]; if (!cur || String(p.asOf) > String(cur.asOf)) by[p.ticker] = p; });
  seed.prices = Object.values(by);
}
const extra = JSON.parse(fs.readFileSync(path.join(SRC, 'seed.extra.json'), 'utf8'));
seed.people = extra.people; seed.policies = extra.policies;
seed.seedSource = path.basename(backupPath); seed.seedBuiltAt = new Date().toISOString();
const modules = ORDER.map(n => {
  const code = fs.readFileSync(path.join(SRC, n + '.js'), 'utf8');
  if (/<\/script/i.test(code)) throw new Error(n + '.js contains a literal </script> — split the string');
  return '<script id="' + n + '">\n' + code + '\n</script>';
}).join('\n');
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
for (const slot of ['/*{{CSS}}*/', '{{SEED}}', '<!--{{SCRIPTS}}-->']) if (!html.includes(slot)) throw new Error('index.html is missing ' + slot);
html = html.replace('/*{{CSS}}*/', () => fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8'))
  .replace('{{SEED}}', () => JSON.stringify(seed).replace(/</g, '\\u003c'))
  .replace('<!--{{SCRIPTS}}-->', () => modules);
const out = path.join(__dirname, 'dist', 'family-office.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('built ' + path.relative(ROOT, out) + ' (' + Math.round(html.length / 1024) + ' KB) · seed ' + seed.seedSource + ' · ' + seed.transactions.length + ' txns · ' + seed.prices.length + ' prices');
```

- [ ] **Step 3: Verify** — after Task 8 exists: `node app/build.js` prints `built app/dist/family-office.html (… KB) · seed portfolio-ledger_backup_2026-09-02.json · 410 txns · 17 prices`.

---
### Task 7: smoke test (written before the UI — it is the UI contract)

**Files:** Create `app/test/smoke.test.js`. Run with `JSDOM_PATH=/tmp/jsd/node_modules/jsdom node app/test/smoke.test.js` (jsdom installed with `npm i jsdom@24` in `/tmp/jsd`).

- [ ] **Step 1: Write the test**

```js
// @file app/test/smoke.test.js
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
      w.DecompressionStream = DecompressionStream; w.Response = Response; w.TextDecoder = TextDecoder;
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
  ok(a.ev('G.txns.length') === 410, 'seed ledger has 410 transactions');
  ok(a.d.getElementById('page-ledger').classList.contains('is-active'), 'opens on Portfolio Ledger');
  ok(a.d.querySelectorAll('#holdingsBody tr[data-k]').length >= 15, 'holdings rendered');
  ok(/6,558,32\d/.test(txt(a.d, '#kpiMV')), 'portfolio value KPI = S$6,558,32x');
  ok(txt(a.d, '#hlXirr').trim() !== '', 'period return KPI filled');
  ok(a.d.querySelectorAll('#allocBody .alloc-row').length >= 5, 'allocation card rendered');
  ok(a.d.querySelectorAll('#yearStrip .ycard').length >= 8, 'year strip rendered');
  for (const p of ['rules', 'cash', 'property', 'insurance', 'ledger']){
    click(a.d, '.nav-item[data-page="' + p + '"]');
    ok(a.d.getElementById('page-' + p).classList.contains('is-active') && a.d.querySelectorAll('.page.is-active').length === 1, 'nav → ' + p);
  }
  ok((a.w.localStorage.getItem('okfo:v1') || '').length > 100000, 'ledger persisted to localStorage');

  // ---------- 2. property: validation, save, yields ----------
  click(a.d, '.nav-item[data-page="property"]'); click(a.d, '#newPropBtn');
  ok(!a.d.getElementById('drawerWrap').hidden, 'property drawer opens');
  click(a.d, '#drawerSave');
  ok(a.d.querySelectorAll('#drawerBody .field-error').length > 0 && a.ev('DOC.stores.properties') && Object.keys(a.ev('DOC.stores.properties')).length === 0, 'empty form blocked with inline errors');
  setv(a.d, 'p_name', 'Test Condo'); setv(a.d, 'p_address', '1 Test Road'); setv(a.d, 'p_owner', 'Ong Ah Whatt');
  setv(a.d, 'p_price', '1200000'); setv(a.d, 'p_rent', '4000'); setv(a.d, 'p_mcst', '900'); setv(a.d, 'p_mcstFreq', 'quarterly'); setv(a.d, 'p_tax', '3000'); setv(a.d, 'p_loan', '600000');
  click(a.d, '#drawerSave');
  ok(a.d.getElementById('drawerWrap').hidden && a.d.querySelectorAll('#propGrid .prop-card').length === 1, 'property saved and listed');
  ok(/4\.00%/.test(txt(a.d, '#propGrid')) && /3\.45%/.test(txt(a.d, '#propGrid')), 'gross 4.00% / net 3.45% yield shown');

  // ---------- 3. insurance: seeded policies, add policy, summaries ----------
  click(a.d, '.nav-item[data-page="insurance"]');
  ok(a.d.querySelectorAll('#insBody tr[data-id]').length === 4, 'four seeded policies from the FS playbook');
  ok(/Ong Ah Whatt/.test(txt(a.d, '#insPeople')) && /Ngiow Lee Kim/.test(txt(a.d, '#insPeople')), 'per-person summary cards');
  ok(a.d.querySelectorAll('#i_type option').length === 0, 'drawer not open yet');
  click(a.d, '#newPolicyBtn');
  ok(a.d.querySelectorAll('#i_type option').length >= 20 && a.d.querySelectorAll('#i_type optgroup').length >= 4, 'policy type dropdown grouped');
  ok([...a.d.querySelectorAll('#i_paidBy option')].some(o => o.value === 'Ong & Kim Family Trust Pte Ltd'), 'payment-by includes the company');
  setv(a.d, 'i_insured', 'Ong Ah Whatt'); setv(a.d, 'i_insurer', 'AIA'); setv(a.d, 'i_type', 'Term life'); setv(a.d, 'i_sum', '500000');
  setv(a.d, 'i_premium', '1200'); setv(a.d, 'i_freq', 'monthly'); setv(a.d, 'i_due', '2026-10-15'); setv(a.d, 'i_paidBy', 'Ong Ah Whatt');
  click(a.d, '#drawerSave');
  ok(a.d.querySelectorAll('#insBody tr[data-id]').length === 5, 'policy added');
  ok(/500,000/.test(txt(a.d, '#insPeople')), 'sum assured rolls into the person card');
  click(a.d, '#newPersonBtn'); setv(a.d, 'person_name', 'Ong Junior'); click(a.d, '#drawerSave');
  ok(/Ong Junior/.test(txt(a.d, '#insPeople')), 'family member added');

  // ---------- 4. rules: manual swing, Fibonacci proposal, status ----------
  click(a.d, '.nav-item[data-page="rules"]'); click(a.d, '#newRuleBtn');
  setv(a.d, 'r_ticker', 'BN4'); setv(a.d, 'r_high', '12.5'); setv(a.d, 'r_low', '10'); click(a.d, '#ruleApplyFib');
  const rec = a.ev('fibRecommend(12.5,10)');
  ok(Number(a.d.getElementById('r_buy1').value) === rec.buy1 && Number(a.d.getElementById('r_sell3').value) === rec.sell3 && Number(a.d.getElementById('r_cut').value) === rec.cut, 'Fibonacci proposal fills buy/cut/sell');
  ok(a.d.querySelectorAll('#ruleFibTable tr').length >= 8, 'Fibonacci level table shown');
  click(a.d, '#drawerSave');
  const row = a.d.querySelector('#rulesBody tr[data-rule-id]');
  ok(row && /BN4/.test(row.textContent) && /Buy zone/.test(row.textContent), 'rule listed; last 11.53 ≤ Buy 1 → Buy zone');

  // ---------- 5. cash on hand: real CSV, dedupe, dividends, PDF handoff ----------
  click(a.d, '.nav-item[data-page="cash"]');
  const r1 = await a.ev('importStatementText')(CSV, 'feb-jun.csv');
  ok(r1.added === D2 && Object.keys(a.ev('DOC.stores.cash')).length === D2, 'all ' + D2 + ' statement lines stored');
  const r2 = await a.ev('importStatementText')(CSV, 'feb-jun.csv');
  ok(r2.added === 0 && Object.keys(a.ev('DOC.stores.cash')).length === D2, 're-import adds nothing (dedupe)');
  const lastBal = a.ev('Object.values(DOC.stores.cash)').sort((x, y) => (x.date + x.time > y.date + y.time ? 1 : -1)).slice(-1)[0].balance;
  ok(txt(a.d, '#cashKpis').includes(a.ev('fmtSGD')(lastBal)), 'cash on hand KPI = closing balance');
  const rows = [...a.d.querySelectorAll('#divReviewBody tr[data-key]')];
  ok(rows.length === 15 && rows.every(r => /Already in ledger/.test(r.textContent)), '15 dividends found, all already in ledger');
  ok(!/Div 2025/.test(txt(a.d, '#divReviewBody')), 'shareholder payout not treated as dividend income');
  ok(a.ev('G.txns.length') === 410, 'no dividends double-booked (ledger still 410 entries)');
  click(a.d, '.nav-item[data-page="ledger"]');
  ok(txt(a.d, '#kpiCash').includes(a.ev('fmtSGD')(lastBal)), 'cash KPI appears on the ledger page');
  const pdf = new a.w.File(['%PDF-1.3'], 'January 2026.pdf', { type: 'application/pdf' });
  click(a.d, '.nav-item[data-page="cash"]'); await a.ev('importStatementFile')(pdf);
  ok(!a.d.getElementById('pdfHandoff').hidden && /January 2026\.pdf/.test(txt(a.d, '#pdfHandoff')), 'PDF routes to the Claude handoff');
  ok(a.errors.length === 0, 'no console errors (first session)' + (a.errors.length ? ' → ' + a.errors.join(' | ') : ''));

  // ---------- 6. reopen: everything came back ----------
  const saved = { 'okfo:v1': a.w.localStorage.getItem('okfo:v1') };
  const b = await open({ storage: saved });
  ok(b.ev('STORE_SOURCE') === 'saved', 'reopen uses saved data (no re-upload)');
  ok(Object.keys(b.ev('DOC.stores.properties')).length === 1 && Object.keys(b.ev('DOC.stores.rules')).length === 1 &&
     Object.keys(b.ev('DOC.stores.policies')).length === 5 && Object.keys(b.ev('DOC.stores.cash')).length === D2 && b.ev('G.txns.length') === 410, 'properties, rules, policies, cash and ledger all persisted');
  ok(b.errors.length === 0, 'no console errors (reopen)' + (b.errors.length ? ' → ' + b.errors.join(' | ') : ''));

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
```

- [ ] **Step 2: Run to verify it fails** — `node app/build.js` fails (`index.html is missing`) until Task 8; smoke test cannot pass yet.

---

### Task 8: shell — template, styles, navigation, drawer

**Files:** Create `app/src/index.html`, `app/src/styles.css`, `app/src/shell.js`

**Contract** (enforced by the smoke test):
- `index.html` contains `/*{{CSS}}*/` inside `<style>`, the exact allow-listed Chart.js tag in `<head>`, `<script type="application/json" id="seed">{{SEED}}</script>` and `<!--{{SCRIPTS}}-->` before `</body>`; `:root{color-scheme:light}`.
- Layout: `<aside class="side">` (brand, five `button.nav-item[data-page]` in the order Rules, Portfolio Ledger, Cash on Hand, Property, Insurance, footer `#sideStatus` + `#sidePrices`) and `<main class="main">` holding `section.page#page-{rules|ledger|cash|property|insurance}`. Exactly one page has `.is-active`.
- Drawer: `#drawerWrap[hidden]` › `#drawerTitle`, `#drawerBody`, `#drawerDelete`, `#drawerCancel`, `#drawerSave`; `Esc` and backdrop close it.
- `shell.js` exports (globals): `shellInit()`, `showPage(name)` (remembers last page in `meta.lastPage`), `currentPage()`, `openDrawer({title, html, wide, saveLabel, onMount, onSave, onDelete})` — `onSave` returns `false` to keep the drawer open —, `closeDrawer()`, `fieldsHtml(defs, values)`, `readFields(defs)` → `{values, errors}` (renders `.field-error` under each invalid field; `required`, `number ≥ min`, date order via `after`), `kpiHtml(list)`, `onStoreSaved(savedAt, ok)` (updates `#sideStatus`), `updateSidePrices()`.
- Field def: `{id, label, type:'text'|'number'|'date'|'tel'|'select'|'textarea', options, required, min, step, placeholder, hint, span, list, after}`; `options` may be strings or `{group, options}` for `<optgroup>`.
- Visual rules from the spec §4: dark sidebar `#16201c`, light canvas, cards `12px` radius hairline border, KPI anatomy label / value / context, tabular numerals, green gain / red loss / amber attention, sidebar collapses to a top bar under 760px.

- [ ] Steps: write the three files → `node app/build.js` succeeds → open the dist file in the smoke test's first section (nav assertions pass).

### Task 9: ledger — re-layout into cards

**Files:** Modify `app/src/ledger.js` (extracted), move markup from `app/src/body.legacy.html` into `#page-ledger` of `index.html`.

**Contract:**
- Remove the IndexedDB layer (`DB_NAME`, `idb`, `sAll…sBulkAdd`) and the `init` IIFE — `store.js` and `boot.js` replace them. Keep every existing element id.
- Page order: header (title, scope line `#hlScope`, owner/basis/period selects, `#refreshPricesBtn`) → primary KPI row: `#kpiMV`/`#kpiMVsub`, period-return card (`#hlXirr`, `#hlDollar`, `#hlHint`), `#kpiCash`/`#kpiCashSub` → secondary KPI row: `#kpiUnreal`, `#kpiReal` (+`#kpiRealLbl`), `#kpiDiv` (+`#kpiDivLbl`) → `#yearStrip` → allocation card `#allocBody` (rows `.alloc-row`, top holdings by weight + "N more") beside return bridge (`#fyComponents` rendered as opening → capital in → dividends → closing → return, `#reconLine`, `#staleNote`, `#liveNote`) → period-settings card (opening basis, opening/closing inputs, collapsible) → holdings card → add/edit transaction beside recent → prices + export & data → import.
- `renderSummary` writes the KPI ids (value, unrealised with % of cost, realised and dividends labelled with the period) instead of `#summary`; `renderHoldings` also calls `renderAllocation(rows)`.
- `#kpiCash` shows `cashTotalForLedger()` from `cash.js` (latest balance) or "Add a statement" linking to Cash on Hand.
- `pullLive()`: with the bridge → `autoRefreshPrices(true)`; without → existing paste-to-Claude prompt.
- `backupJson()` / `restoreJson()` include `rules, cash, properties, policies, people, maps`; price-only restore still merges. Danger zone adds "Reset to bundled data" (`storeReset()` after typing RESET).
- `exportXlsx()` falls back to CSV with a toast when SheetJS cannot load (artifact sandbox).

### Task 10: rules tab

**Files:** Create `app/src/rules.js` — **Contract:** `renderRules()`; `#newRuleBtn`; KPIs `#rulesKpis` (rules, in buy zone, cut-loss hit, take profit); table `#rulesBody` rows `tr[data-rule-id]` with Stock, Last, Buy 1–3, Cut loss, Sell 1–3, Status (*Cut loss hit* / *Buy zone (tier n)* / *Take profit* / *Hold* / *No price*), edit/delete. Drawer (wide): `#r_ticker` (datalist of held + known tickers), `#r_lookback` (THREE_MONTHS / SIX_MONTHS / ONE_YEAR), `#ruleLoadBtn` (bridge → `priceHistory` → `swingFromBars` fills `#r_high/#r_low`, draws `#ruleChart` if `Chart` loaded, fetches last price if the ticker isn't held), `#ruleApplyFib` (fills `#r_buy1..3/#r_cut/#r_sell1..3` from `fibRecommend`, renders `#ruleFibTable`), `#r_notes`. Validation: cut < buy3 ≤ buy2 ≤ buy1 < sell1 ≤ sell2 ≤ sell3. Footnote: Fibonacci levels are a charting convention, not a forecast or advice.

### Task 11: cash on hand tab

**Files:** Create `app/src/cash.js` — **Contract:** `renderCash()`, `importStatementText(text, filename)` → `{added, skipped, lines, account}`, `importStatementFile(file)` (CSV → text, XLSX → `xlsxToRows`, PDF → shows `#pdfHandoff` with a copyable request naming the file), `cashTotalForLedger()` → `{total, asOf}|null`, `commitDividends(keys)`. KPIs `#cashKpis` (cash on hand, as at, dividends received in the ledger's selected period, pending review). Upload `#cashDrop` + `#cashFile`. Review `#divReviewBody` rows `tr[data-key]` — *Already in ledger* / *New* (checkbox, owner select defaulting to the holder on that date) / *Choose ticker* (select; choice remembered in `maps` as `div:<normName>`); `#divCommitBtn` creates `DIVIDEND` transactions (note `Bank <date> <payer>`). Lines table `#cashLinesBody` with `#cashCatFilter`.

### Task 12: property tab

**Files:** Create `app/src/property.js` — **Contract:** `renderProperties()`; `#newPropBtn`; KPIs `#propKpis` (properties, purchase value, loans outstanding, rent roll / month, portfolio gross and net yield); `#propGrid` of `.prop-card[data-id]` showing name, address, owner, purchase price, loan + LTV, rent, gross/net yield (2dp %), MCST, property tax, tenant + contact, agent + contact, lease end, edit/delete; empty state invites the first property. Drawer fields `#p_name*`, `#p_address*`, `#p_owner*` (company / Ong Ah Whatt / Ngiow Lee Kim / Joint / Other), `#p_price*` (>0), `#p_date`, `#p_loan`, `#p_instalment`, `#p_mcst`, `#p_mcstFreq` (monthly / quarterly / annual, default quarterly), `#p_tax`, `#p_tenant`, `#p_tenantContact`, `#p_rent`, `#p_leaseEnd`, `#p_agent`, `#p_agentContact`, `#p_notes`. Net-yield note: loan interest excluded.

### Task 13: insurance tab

**Files:** Create `app/src/insurance.js` — **Contract:** `renderInsurance()`; `#newPolicyBtn`, `#newPersonBtn` (drawer `#person_name`); KPIs `#insKpis` (policies in force, total sum assured, annual premiums, company-paid premiums / year, next premium due); `#insPeople` `.person-card` per family member (policies, sum assured, annual premium, next due); `#insUpcoming` (next 60 days); `#insBody` rows `tr[data-id]` (person, type, insurer, policy no, sum assured, annual premium, frequency, next due, paid by, agent, status, *Complete details* badge when `needsDetails`). Drawer fields `#i_insured*` (people), `#i_insurer*` (datalist: AIA, Great Eastern, Prudential, Income Insurance, Manulife, Singlife, HSBC Life, FWD, Tokio Marine, China Taiping, Etiqa, Raffles Health Insurance), `#i_policyNo`, `#i_type*` (grouped per spec §9), `#i_owner` (people + company), `#i_sum`, `#i_premium*`, `#i_freq` (monthly / quarterly / half-yearly / annual / single), `#i_due*`, `#i_paidBy*` (people + company), `#i_method` (GIRO / Credit card / Bank transfer / Cheque / CPF MediSave / Cash), `#i_start`, `#i_maturity` (after start), `#i_cashValue`, `#i_beneficiary`, `#i_riders`, `#i_status` (In force / Lapsed / Matured / Surrendered / Claimed), `#i_agent`, `#i_agentContact`, `#i_notes`. Saving clears `needsDetails` once type, sum assured and premium are filled.

### Task 14: boot

**Files:** Create `app/src/boot.js`

```js
// @file app/src/boot.js
/* boot.js — start-up: load saved data (or the seed), render, then refresh prices if they're stale. */
function pricedTickers(){
  const held = computePositions(G.txns).filter(p => p.qtyHeld > 1e-6 && (p.currency || 'SGD') === 'SGD').map(p => p.ticker);
  const ruled = Object.values(DOC.stores.rules || {}).map(r => String(r.ticker || '').toUpperCase()).filter(Boolean);
  return [...new Set(held.concat(ruled))].sort();
}
function setRefreshing(on, done, total){
  const b = document.getElementById('refreshPricesBtn');
  if (b){ b.disabled = !!on; b.textContent = on ? ('Refreshing ' + (done || 0) + '/' + (total || 0) + '…') : 'Refresh prices'; }
  const s = document.getElementById('sidePrices'); if (s && on) s.textContent = 'Refreshing prices…';
}
async function autoRefreshPrices(force){
  if (!hasBridge()){ updateSidePrices(); return { skipped: 'no connector' }; }
  const tickers = pricedTickers();
  const meta = await sGet('meta', 'lastPriceRefresh');
  const d = force ? { refresh: true, reason: 'manual' } : shouldAutoRefresh({ tickers, prices: G.prices, lastRefreshMs: meta ? meta.value : null, nowMs: Date.now() });
  if (!d.refresh){ updateSidePrices(); return { skipped: d.reason }; }
  setRefreshing(true, 0, tickers.length);
  let res;
  try { res = await refreshPrices(tickers, { onProgress: (n, t) => setRefreshing(true, n, t) }); }
  finally { setRefreshing(false); }
  await loadAll(); renderAll();
  if (typeof renderCurrentPage === 'function') renderCurrentPage();
  updateSidePrices();
  if (res.fail.length) toast('Prices refreshed for ' + res.ok.length + '; failed: ' + res.fail.map(f => f.ticker).join(', '));
  else if (force) toast('Prices refreshed for ' + res.ok.length + ' holdings');
  return res;
}
async function boot(){
  const src = storeInit();
  Object.values(DOC.stores.maps || {}).forEach(m => { if (String(m.key).startsWith('cid:')) IBKR_CONTRACTS[m.key.slice(4)] = m.value; });
  await loadAll();
  populateOwner(); wire(); shellInit(); renderAll();
  const last = (DOC.stores.meta.lastPage || {}).value;
  showPage(['rules', 'ledger', 'cash', 'property', 'insurance'].includes(last) ? last : 'ledger');
  if (src === 'memory') toast('This view can’t save on the device — back up JSON before closing.');
  window.__refreshDone = autoRefreshPrices(false).catch(e => { console.warn('price refresh failed', e); toast('Price refresh failed: ' + e.message); });
}
window.__refreshDone = Promise.resolve();
window.__bootDone = boot().catch(e => { console.error(e); toast('Start-up error: ' + e.message); });
```

### Task 15: build, verify, publish

- [ ] `node app/build.js`
- [ ] `node app/test/engine.test.js && node app/test/engine.basis.test.js && node app/test/calc.test.js && node app/test/store.test.js && JSDOM_PATH=/tmp/jsd/node_modules/jsdom node app/test/smoke.test.js` — all `ALL TESTS PASSED`.
- [ ] Publish: `create_artifact` id `ong-kim-family-office`, `html_path` = `app/dist/family-office.html`, `mcp_tools` = the three `mcp__11074d8e-bdc3-4cc0-a0b4-0174219e8270__{get_price_snapshot,get_price_history,search_contracts}`.
- [ ] `verify_artifact` — no console errors; bridge calls visible for the auto-refresh.

### Task 16: docs

- [ ] `app/README.md` — how to build, test, publish, and where data lives.

---

## Self-review

1. **Spec coverage:** persistence (T4, T14, smoke §6) · auto live prices on open (T5, T14, smoke §7) · nav + cards (T8, T9, smoke §1) · Rules/Fibonacci (T3, T10, smoke §4) · Cash CSV/XLSX/PDF + dividend capture + payout exclusion (T3, T11, smoke §5) · Property fields + yields (T3, T12, smoke §2) · Insurance fields, types, payment-by incl. company, seeded policies (T6, T13, smoke §3) · error handling (T4 quota/memory, T5 per-ticker failures, T11 unknown formats) · tests (T2, T4, T7). No gaps.
2. **Placeholders:** none; UI tabs are contracts by declared deviation, each id and behaviour named.
3. **Consistency:** `fibRecommend`, `swingFromBars`, `ruleStatus`, `buyTier`, `dividendCandidates`, `cashPositions`, `propertyYields`, `portfolioYields`, `nextDue`, `instalment`, `shouldAutoRefresh`, `sgtParts`, `snapToTick`, `xlsxToRows` are defined in T3 and used under the same names in T5, T7, T10–T14; store API names match T4 and the ledger; `STORE_SOURCE`, `DOC`, `IBKR_CONTRACTS`, `G` are the shared globals.
