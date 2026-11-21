// Declared dividends (IBKR corporate actions) → ledger DIVIDEND records: entitlement at the close of
// the day before XD, per owner, booked on the XD date with the payment date kept; already-booked
// dividends are not added twice; the bank-statement match uses the payment date.
const E = require('../src/engine.js'), C = require('../src/calc.js');
let failed = 0; const ok = (c, n) => { console.log((c ? '  PASS' : '  FAIL') + '  ' + n); if (!c) failed++; };
const T = 'Ong & Kim Family Trust', O = 'Ong Ah Whatt';

const txns = [
  { id: 1, type: 'BUY', owner: T, ticker: 'J69U', equity: 'Frasers Cpt Tr', date: '2026-01-10', quantity: 190000, price: 2.3, fees: 0, currency: 'SGD' },
  { id: 2, type: 'BUY', owner: O, ticker: 'J69U', equity: 'Frasers Cpt Tr', date: '2026-10-28', quantity: 10000, price: 2.1, fees: 0, currency: 'SGD' },   // day before XD: qualifies
  { id: 3, type: 'BUY', owner: T, ticker: 'J69U', equity: 'Frasers Cpt Tr', date: '2026-10-29', quantity: 5000, price: 2.1, fees: 0, currency: 'SGD' },     // on XD: does not
  { id: 4, type: 'BUY', owner: T, ticker: 'V03', equity: 'Venture', date: '2025-06-01', quantity: 40000, price: 12, fees: 0, currency: 'SGD' },
  { id: 5, type: 'DIVIDEND', owner: T, ticker: 'V03', equity: 'Venture', date: '2026-09-11', dividend: 12000, currency: 'SGD' },                             // already booked from the bank (paid 11 Sep)
  { id: 6, type: 'BUY', owner: T, ticker: 'C09', equity: 'City Development', date: '2026-09-28', quantity: 15000, price: 7.6, fees: 0, currency: 'SGD' },
  { id: 7, type: 'SELL', owner: T, ticker: 'C09', equity: 'City Development', date: '2026-11-02', quantity: 15000, price: 7.0, fees: 0, currency: 'SGD' }   // sold after XD: still entitled
];
const raw = {
  J69U: [{ type: 'CashDividends', date: '20261029', announce_date: '20261022', payment_date: '20261127', value: '0.06214', currency: 'SGD' },
         { type: 'CashDividends', date: '20260504', announce_date: '20260424', payment_date: '20260529', value: '0.06136', currency: 'SGD' }],
  V03:  [{ type: 'CashDividends', date: '20260831', announce_date: '20260806', payment_date: '20260911', value: '0.3', currency: 'SGD' },
         { type: 'CashDividends', date: '20261125', announce_date: '20261110', payment_date: '20261210', value: '0.25', currency: 'SGD' }],
  C09:  [{ type: 'CashDividends', date: '20261030', payment_date: '20261112', value: '0.08', currency: 'SGD' },
         { type: 'Splits', date: '20261020', value: '2' }]
};
const actions = E.normaliseCorpActions(raw);
ok(actions.length === 6 && actions[0].xd === '2026-10-29' && actions[0].pay === '2026-11-27' && actions[0].dps === 0.06214, 'IBKR corporate actions normalised (dates, amount per share)');

const res = E.dividendEntitlements(txns, actions, { today: '2026-11-15', sinceDays: 90 });
const get = (tk, owner, xd) => res.find(r => r.ticker === tk && r.owner === owner && r.xd === xd);

const jt = get('J69U', T, '2026-10-29');
ok(jt && jt.status === 'book' && jt.qty === 190000 && jt.amount === 11806.6, 'J69U trust: 190,000 sh held before XD × 0.06214 = S$11,806.60 to book (buy on XD excluded)');
const jo = get('J69U', O, '2026-10-29');
ok(jo && jo.status === 'book' && jo.qty === 10000 && jo.amount === 621.4, 'J69U Ong Ah Whatt: bought the day before XD → 10,000 sh, S$621.40');
ok(!get('J69U', T, '2026-05-04'), 'XD older than the look-back window is left alone');
const vb = get('V03', T, '2026-08-31');
ok(vb && vb.status === 'booked' && vb.matchId === 5, 'V03 Aug dividend already in the ledger (booked at payment date) → not added again');
const vu = get('V03', T, '2026-11-25');
ok(vu && vu.status === 'upcoming' && vu.amount === 10000 && vu.pay === '2026-12-10', 'V03 Nov dividend with XD still ahead → upcoming, estimate S$10,000 on current holding');
const cd = get('C09', T, '2026-10-30');
ok(cd && cd.status === 'book' && cd.qty === 15000 && cd.amount === 1200, 'C09 sold after XD → still entitled, S$1,200');
ok(res.some(r => r.type === 'Splits' && r.status === 'other'), 'non-cash corporate action reported, never booked');

const recs = E.dividendRecords(res.filter(r => r.status === 'book'), txns);
const r0 = recs.find(r => r.ticker === 'J69U' && r.owner === T);
ok(recs.length === 3 && r0.type === 'DIVIDEND' && r0.date === '2026-10-29' && r0.paymentDate === '2026-11-27' && r0.dividend === 11806.6 && r0.equity === 'Frasers Cpt Tr' && r0.caKey === 'J69U|2026-10-29|0.06214', 'ledger records: booked on XD, payment date and source key kept');

// a second run after booking finds them booked (by source key), so nothing is added twice
const again = E.dividendEntitlements(txns.concat(recs.map((r, i) => Object.assign({ id: 100 + i }, r))), actions, { today: '2026-11-15', sinceDays: 90 });
ok(again.filter(r => r.status === 'book').length === 0, 're-running after booking adds nothing');

// the bank line arrives on the payment date: it matches the XD-dated ledger entry (no double count)
const ledger = [{ id: 100, type: 'DIVIDEND', ticker: 'J69U', date: '2026-10-29', paymentDate: '2026-11-27', dividend: 11806.6 }, { id: 1, type: 'BUY', ticker: 'J69U', equity: 'FRASERS CPT TR', date: '2026-01-10' }];
const line = { key: 'k1', category: 'dividend', date: '2026-11-27', deposit: 11806.6, description: 'CDP DIVIDEND', remarks: 'CDP-FRASERS CPT TR' };
const cand = C.dividendCandidates([line], ledger, { 'FRASERS CPT TR': 'J69U' });
ok(cand[0].status === 'dup' && cand[0].matchId === 100, 'bank credit on the payment date matches the XD-dated dividend');

console.log(failed ? '\n' + failed + ' TEST(S) FAILED' : '\nALL TESTS PASSED');
process.exit(failed ? 1 : 0);
