/* Opening-value basis tests — market value vs cost basis.
   Run:  node engine.basis.test.js
   Regenerate engine.js from the HTML first if you've edited the ledger app. */
const e = require('../src/engine.js');

let failed = 0;
const ok = (cond, name) => { console.log((cond ? '  PASS' : '  FAIL') + '  ' + name); if (!cond) failed++; };

// The opening point is the last day of the previous month, on either basis.
ok(e.prevDay('2026-04-01') === '2026-03-31', '1 Apr opens on 31 Mar');
ok(e.prevDay('2026-01-01') === '2025-12-31', '1 Jan opens on 31 Dec');
ok(e.prevDay('2026-03-01') === '2026-02-28', 'non-leap February');
ok(e.prevDay('2024-03-01') === '2024-02-29', 'leap February');

// 1000 @ $2 bought before the period; 1000 @ $5 bought inside it; worth $6 now.
const txns = [
  { id: 1, date: '2024-05-10', owner: 'A', ticker: 'X', type: 'BUY', quantity: 1000, price: 2, fees: 0, currency: 'SGD' },
  { id: 2, date: '2026-06-01', owner: 'A', ticker: 'X', type: 'BUY', quantity: 1000, price: 5, fees: 0, currency: 'SGD' },
];
const prices = { X: 6 };

ok(Math.abs(e.costBasisAt(txns, 'ALL', '2026-03-31') - 2000) < 1e-6,
   'cost basis at 31 Mar 26 counts only the pre-period lot');

const cost = e.computePeriod(txns, 'ALL', 2027, 'FY', { openingBasis: 'COST' }, prices);
ok(cost.openingValue === 2000 && cost.openingDate === '2026-03-31',
   'cost mode derives its own opening — no user input needed');
ok(cost.xirr === null,
   'cost mode suppresses XIRR: the opening cash was committed years ago, not at period start');
ok(Math.abs(cost.dollarReturn - 5000) < 1e-6,
   'gain = 12000 market − 2000 opening cost − 5000 buys');
ok(Math.abs(cost.gainPct - 5000 / 7000) < 1e-9,
   'ratio divides by total cost put in (7000), not the opening alone (2000)');

// Market basis: holdings existed at the opening date, so a blank opening is a gap, not a zero.
const missing = e.computePeriod(txns, 'ALL', 2027, 'FY', {}, prices);
ok(missing.openingMissing === true && missing.xirr === null,
   'market mode flags a missing opening rather than treating it as zero');

const supplied = e.computePeriod(txns, 'ALL', 2027, 'FY', { openingValue: 3000 }, prices);
ok(supplied.openingMissing === false && supplied.xirr !== null,
   'market mode computes XIRR once the opening value is supplied');
// Period % is Modified Dietz: mid-period flows enter the base weighted by time invested.
{
  const t0 = Date.parse('2026-04-01'), span = Date.parse(supplied.closeDate) - t0;
  const w = Math.min(1, Math.max(0, 1 - (Date.parse('2026-06-01') - t0) / span));
  const base = 3000 + 5000 * w;
  ok(Math.abs(supplied.dietzBase - base) < 1e-6, 'Dietz base = opening + time-weighted buy');
  ok(Math.abs(supplied.periodPct - supplied.dollarReturn / base) < 1e-9,
     'period % divides the dollar return by the Dietz base');
}

// A genuinely new portfolio has nothing at the opening date, so zero really is correct.
ok(e.computePeriod([txns[1]], 'ALL', 2027, 'FY', {}, prices).openingMissing === false,
   'no holdings at the opening date — zero opening is not flagged');

// --- Stock introduced mid-period must not read as profit -------------------------------------
// An OPENING record dated inside the period is stock brought in after the opening valuation was
// struck. It shows up in the closing value, so it needs a matching inflow or it inflates the return.
const withIntro = [
  { id: 1, date: '2024-05-10', owner: 'A', ticker: 'X', type: 'BUY', quantity: 1000, price: 2, fees: 0, currency: 'SGD' },
  { id: 2, date: '2026-06-01', owner: 'B', ticker: 'Y', type: 'OPENING', quantity: 1000, price: 4, fees: 0, currency: 'SGD' },
];
const introPrices = { X: 6, Y: 6 };   // both worth 6000 now, closing 12000
const intro = e.computePeriod(withIntro, 'ALL', 2027, 'FY', { openingValue: 2000 }, introPrices);
ok(Math.abs(intro.introduced - 4000) < 1e-6, "B's stock is counted as introduced capital, at cost");
ok(Math.abs(intro.dollarReturn - 6000) < 1e-6,
   'return = 12000 − 2000 opening − 4000 introduced (not 10000, which would book the capital as profit)');
ok(Math.abs(intro.netInvested - 4000) < 1e-6, 'net invested includes introduced stock');

// Stock received on an existing holding (in-specie distribution) IS return, so it takes no inflow.
const earned = e.computePeriod(
  [withIntro[0], Object.assign({}, withIntro[1], { acquired: 'EARNED' })],
  'ALL', 2027, 'FY', { openingValue: 2000 }, introPrices);
ok(earned.introduced === 0, "acquired:'EARNED' is not treated as introduced capital");
ok(Math.abs(earned.dollarReturn - 10000) < 1e-6, 'earned stock flows through to the return in full');

// An OPENING dated at or before the opening date is already inside the opening valuation.
const priorIntro = e.computePeriod(
  [withIntro[0], Object.assign({}, withIntro[1], { date: '2026-03-31' })],
  'ALL', 2027, 'FY', { openingValue: 6000 }, introPrices);
ok(priorIntro.introduced === 0, 'stock introduced before the opening date is not double-counted');

// --- Deriving the opening from dated closes --------------------------------------------------
const closes = { '2026-03-31': { X: 5 } };
const derived = e.computePeriod([withIntro[0]], 'ALL', 2027, 'FY', {}, { X: 6 }, closes);
ok(derived.openingSource === 'DERIVED' && Math.abs(derived.openingValue - 5000) < 1e-6,
   'opening derived as 1000 held × 5.00 close at 31 Mar');
ok(derived.openingMissing === false, 'a derived opening is not flagged as missing');

// A partial price set must not produce a partial total. Two holdings at 31 Mar, one close known.
const twoHeld = [
  withIntro[0],
  { id: 3, date: '2025-02-01', owner: 'A', ticker: 'Z', type: 'BUY', quantity: 500, price: 3, fees: 0, currency: 'SGD' },
];
const partial = e.computePeriod(twoHeld, 'ALL', 2027, 'FY', {}, { X: 6, Z: 6 }, closes);
ok(partial.openingMissing === true && partial.openingValue === 0,
   'incomplete closes for the opening date -> flagged, not partly valued');
ok(partial.openingUnpriced.join() === 'Z', 'the unpriced holding is named so it can be filled in');

// --- Holdings scoped to the period: held at any instant during it -----------------------------
// H bought 2024, sold out May 2026 (inside FY2027). J first bought Jun 2026 (inside FY2027).
// K bought and fully sold within FY2026, untouched after.
const life = [
  { id: 1, date: '2024-05-10', owner: 'A', ticker: 'H', type: 'BUY',  quantity: 1000, price: 2, fees: 0, currency: 'SGD' },
  { id: 2, date: '2026-05-20', owner: 'A', ticker: 'H', type: 'SELL', quantity: 1000, price: 3, fees: 0, currency: 'SGD' },
  { id: 3, date: '2026-06-01', owner: 'A', ticker: 'J', type: 'BUY',  quantity: 500,  price: 4, fees: 0, currency: 'SGD' },
  { id: 4, date: '2025-08-01', owner: 'A', ticker: 'K', type: 'BUY',  quantity: 200,  price: 1, fees: 0, currency: 'SGD' },
  { id: 5, date: '2025-09-01', owner: 'A', ticker: 'K', type: 'SELL', quantity: 200,  price: 1, fees: 0, currency: 'SGD' },
];
const fy27 = e.heldDuringPeriod(life, 'ALL', 2027, 'FY');   // 1 Apr 2026 – 31 Mar 2027
ok(fy27.has('A|H'), 'H (held into FY2027, sold May 2026) is shown in FY2027');
ok(fy27.has('A|J'), 'J (first bought Jun 2026) is shown in FY2027');
ok(!fy27.has('A|K'), 'K (bought and sold in FY2026) is hidden in FY2027');

const fy26 = e.heldDuringPeriod(life, 'ALL', 2026, 'FY');   // 1 Apr 2025 – 31 Mar 2026
ok(fy26.has('A|H'), 'H (held throughout) is shown in FY2026');
ok(fy26.has('A|K'), 'K (bought and sold within FY2026) is shown in FY2026');
ok(!fy26.has('A|J'), 'J (not yet bought) is hidden in FY2026');

const fy25 = e.heldDuringPeriod(life, 'ALL', 2025, 'FY');   // 1 Apr 2024 – 31 Mar 2025
ok(fy25.has('A|H'), 'H (bought May 2024) is shown in FY2025');
ok(!fy25.has('A|K') && !fy25.has('A|J'), 'K and J (both later) are hidden in FY2025');

// --- Year-aware closing: a completed year values at its own year-end, not today -----------------
const ya = [
  { id:1, date:'2019-05-01', owner:'A', ticker:'X', type:'BUY', quantity:1000, price:2, fees:0, currency:'SGD' },
];
const yaHist = { '2019-03-31':{X:1.5}, '2020-03-31':{X:3}, '2021-03-31':{X:5} };
const yaLive = { X:9 };
// FY2020 = 1 Apr 2019 – 31 Mar 2020, completed: close must come from the 2020-03-31 history (3.00), not live (9).
const fy2020 = e.computePeriod(ya, 'ALL', 2020, 'FY', {}, yaLive, yaHist);
ok(fy2020.closingSource === 'HIST', 'completed year takes its closing value from stored year-end history');
ok(Math.abs(fy2020.closingValue - 3000) < 1e-6, 'FY2020 close = 1000 × 3.00 (year-end), not × 9 (today)');
ok(fy2020.periodDone === true, 'a past year is flagged done');
// A manually entered closing still wins over history.
const fyManual = e.computePeriod(ya, 'ALL', 2020, 'FY', { closingValue: 2500 }, yaLive, yaHist);
ok(fyManual.closingSource === 'ENTERED' && fyManual.closingValue === 2500, 'entered closing overrides history');
// The current, still-running year uses live prices.
const curY = e.fyEndYear(e.todayISO());
const cur = e.computePeriod(ya, 'ALL', curY, 'FY', {}, yaLive, yaHist);
ok(cur.closingSource === 'LIVE' && cur.periodDone === false, 'the running year is valued live, not from history');

// --- Realised P/L is attributed to the year of the sale, not repeated cumulatively ---------------
// Buy once, sell in two different calendar years. Each year's realised must reflect only that year.
const rl = [
  { id:1, date:'2024-02-01', owner:'A', ticker:'X', type:'BUY',  quantity:300, price:1, fees:0, currency:'SGD' },
  { id:2, date:'2025-06-01', owner:'A', ticker:'X', type:'SELL', quantity:100, price:2, fees:0, currency:'SGD' }, // +100 in 2025
  { id:3, date:'2026-06-01', owner:'A', ticker:'X', type:'SELL', quantity:100, price:3, fees:0, currency:'SGD' }, // +200 in 2026
];
const rp = e.computePositions(rl, { asOf:'2026-12-31' }).find(p=>p.ticker==='X');
ok(Math.abs((rp.realisedByCY['2025']||0) - 100) < 1e-6, 'CY2025 realised = 100 (that year only)');
ok(Math.abs((rp.realisedByCY['2026']||0) - 200) < 1e-6, 'CY2026 realised = 200 (that year only), not 300 cumulative');
ok(Math.abs(rp.realised - 300) < 1e-6, 'cumulative realised across all years = 300');
ok((rp.realisedByCY['2024']||0) === 0, 'no realised in 2024 (no sale that year)');

// --- Modified Dietz endpoints -------------------------------------------------------------------
// No flows inside a completed period → period % is simply return / opening.
const dz1 = [{ id:1, date:'2018-01-05', owner:'A', ticker:'X', type:'BUY', quantity:1000, price:1, fees:0, currency:'SGD' }];
const dzHist = { '2019-03-31':{X:1.0}, '2020-03-31':{X:1.2} };
const dzr = e.computePeriod(dz1, 'ALL', 2020, 'FY', {}, {X:9}, dzHist);   // FY2020: opens 1000, closes 1200
ok(Math.abs(dzr.periodPct - 200/1000) < 1e-9, 'no mid-period flows → period % = return / opening (20%)');
// A buy on the last day carries ~zero weight: base ≈ opening alone.
const dz2 = dz1.concat([{ id:2, date:'2020-03-31', owner:'A', ticker:'Y', type:'BUY', quantity:100, price:10, fees:0, currency:'SGD' }]);
const dzHist2 = { '2019-03-31':{X:1.0}, '2020-03-31':{X:1.2, Y:10} };
const dzr2 = e.computePeriod(dz2, 'ALL', 2020, 'FY', {}, {X:9,Y:9}, dzHist2);
ok(Math.abs(dzr2.dietzBase - 1000) < 5, 'a last-day buy adds ~nothing to the Dietz base');
ok(dzr2.periodPct !== null && Math.abs(dzr2.periodPct - dzr2.dollarReturn/dzr2.dietzBase) < 1e-9,
   'period % consistent with its own base');
// Cost basis never produces a period % (it is a since-purchase measure, not a period return).
const dzc = e.computePeriod(dz1, 'ALL', 2020, 'FY', { openingBasis:'COST' }, {X:9}, dzHist);
ok(dzc.periodPct === null, 'cost basis: periodPct suppressed');

console.log(failed ? `\n${failed} TEST(S) FAILED` : '\nALL TESTS PASSED');
process.exit(failed ? 1 : 0);
