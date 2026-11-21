#!/usr/bin/env node
// Declared dividends → the ledger (local dashboard, data/state/okfo-state.json). Claude fetches each
// ticker's IBKR corporate actions (skill: check-dividends) into one JSON file, then:
//
//   node app/tools/dividends.js tickers                 tickers to check (held now, or within the look-back), with IBKR contract ids
//   node app/tools/dividends.js plan  <actions.json>    what would be booked / is upcoming / is already in the ledger
//   node app/tools/dividends.js apply <actions.json>    book every XD-passed entitlement not yet in the ledger
//
// actions.json = { "<TICKER>": [ <corp_actions rows exactly as get_price_history returns them> ], … }
// Options: --since <days> (look-back for XD dates, default 60) · --today YYYY-MM-DD
// Entitlement is the holding at the close of the day before XD, per owner; booked on the XD date
// with the payment date kept (see dividendEntitlements in src/engine.js). The upcoming list is saved
// in meta.dividendWatch so the dashboard can show it.
const fs = require('fs');
const { readState, updateDoc } = require('../lib/statefile');
const E = require('../src/engine.js'), C = require('../src/calc.js');

const [cmd, file] = process.argv.slice(2);
const opt = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
const today = opt('today') || C.sgtParts(Date.now()).date;
const since = opt('since') != null ? Number(opt('since')) : 60;
const die = m => { console.error(m); process.exit(1); };
const money = n => (n < 0 ? '-' : '') + 'S$' + Math.abs(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function load(){
  const st = readState(); if (!st.doc) die('No dashboard data yet — import a backup first (node app/tools/state.js import <file>).');
  return st;
}
function contractIds(doc){
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'ledger.js'), 'utf8');
  const block = (src.match(/const IBKR_CONTRACTS = \{([\s\S]*?)\};/) || [])[1] || '';
  const m = {}; for (const x of block.matchAll(/'?([A-Z0-9]+)'?\s*:\s*(\d+)/g)) m[x[1]] = Number(x[2]);
  Object.values(doc.stores.maps || {}).forEach(r => { if (String(r.key).startsWith('cid:')) m[r.key.slice(4)] = r.value; });
  return m;
}
// Held now, or held at any point in the look-back (a sale after XD still collects the dividend).
function tickersToCheck(txns){
  const from = E.prevDay(new Date(Date.parse(today) - since * 86400000).toISOString().slice(0, 10));
  const set = new Set();
  [from, today].forEach(d => E.computePositions(txns, { asOf: d }).forEach(p => { if (p.qtyHeld > 1e-6 && (p.currency || 'SGD') === 'SGD') set.add(String(p.ticker).toUpperCase()); }));
  txns.filter(t => t.date > from && (t.type === 'SELL' || t.type === 'BUY')).forEach(t => set.add(String(t.ticker).toUpperCase()));
  return [...set].sort();
}
function report(ents){
  const line = e => '  ' + e.ticker.padEnd(5) + ' ' + String(e.owner || '').padEnd(24) + ' XD ' + e.xd + '  pay ' + (e.pay || '—') + '  '
    + String(e.dps).padStart(8) + '/sh × ' + String(e.qty == null ? '' : e.qty.toLocaleString('en-SG')).padStart(10) + ' = ' + money(e.amount || 0).padStart(13);
  const grp = (st, title) => { const g = ents.filter(e => e.status === st); if (g.length){ console.log(title + ' (' + g.length + ')'); g.forEach(e => console.log(line(e) + (st === 'booked' && Math.abs((e.bookedAmount || 0) - e.amount) > 0.011 ? '   ledger has ' + money(e.bookedAmount) : ''))); } };
  grp('book', 'To book (XD passed, not in the ledger)');
  grp('upcoming', 'Upcoming (XD ahead — estimate on today\'s holding)');
  grp('booked', 'Already in the ledger');
  ents.filter(e => e.status === 'other').forEach(e => console.log('Other corporate action: ' + e.ticker + ' ' + e.type + ' ' + e.xd + ' (' + e.dps + ') — not booked; check it by hand'));
  if (!ents.length) console.log('No dividends with an XD date in the last ' + since + ' days or ahead.');
}

if (cmd === 'tickers'){
  const st = load(), ids = contractIds(st.doc);
  tickersToCheck(Object.values(st.doc.stores.transactions)).forEach(t => console.log(t + '\t' + (ids[t] || '(resolve with search_contracts, exchange SGX)')));
} else if (cmd === 'plan' || cmd === 'apply'){
  if (!file) die('usage: node app/tools/dividends.js ' + cmd + ' <actions.json>');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const st = load(), txns = Object.values(st.doc.stores.transactions);
  const ents = E.dividendEntitlements(txns, E.normaliseCorpActions(raw), { today, sinceDays: since });
  report(ents);
  if (cmd === 'apply'){
    const recs = E.dividendRecords(ents);
    const watch = ents.filter(e => e.status === 'upcoming');
    const res = updateDoc(doc => {
      const S = doc.stores.transactions;
      let next = Math.max(doc.seq.transactions || 0, ...Object.keys(S).map(Number).filter(n => isFinite(n)), 0);
      recs.forEach(r => { next += 1; S[next] = Object.assign({ id: next }, r); });
      doc.seq.transactions = next;
      doc.stores.meta.dividendWatch = { key: 'dividendWatch', value: watch, checkedAt: new Date().toISOString(), booked: recs.map(r => ({ ticker: r.ticker, owner: r.owner, xd: r.date, amount: r.dividend })) };
    });
    console.log('\nBooked ' + recs.length + ' dividend(s), ' + money(recs.reduce((s, r) => s + r.dividend, 0)) + ' → rev ' + res.rev);
  }
} else {
  die('usage: node app/tools/dividends.js tickers | plan <actions.json> | apply <actions.json> [--since 60] [--today YYYY-MM-DD]');
}
