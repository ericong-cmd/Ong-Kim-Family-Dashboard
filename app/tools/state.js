#!/usr/bin/env node
// Read and edit the dashboard's data (data/state/okfo-state.json) from the command line — the way
// Claude Code works with it. Every write bumps the revision; an open dashboard reloads by itself.
//
//   node app/tools/state.js summary                      what's in the data (counts, cash, prices age)
//   node app/tools/state.js import <backup.json>         replace the data with a Backup JSON (dashboard export)
//   node app/tools/state.js export [file]                write a Backup JSON (default data/backups/portfolio-ledger_backup_<today>.json)
//   node app/tools/state.js tickers                      held + rule tickers with IBKR contract ids and stored prices
//   node app/tools/state.js set-prices BN4=11.30@2026-10-02 D05=40.1 [--source IBKR]
//   node app/tools/state.js get <store> [key]            print a store or one record as JSON
//   node app/tools/state.js put <store> '<json>'         add/replace one record (auto id for rules, properties, policies, people, transactions)
//   node app/tools/state.js del <store> <key>            delete one record
//
// Stores: transactions prices boundaries histprices meta rules cash properties policies people maps
const fs = require('fs'), path = require('path');
const { ROOT } = require('../lib/assemble');
const { stateFile, readState, writeState, updateDoc } = require('../lib/statefile');
const S = require('../src/store.js'), E = require('../src/engine.js'), C = require('../src/calc.js');

const today = () => C.sgtParts(Date.now()).date;
const die = m => { console.error(m); process.exit(1); };
function contracts(doc){
  const src = fs.readFileSync(path.join(ROOT, 'app', 'src', 'ledger.js'), 'utf8');
  const block = (src.match(/const IBKR_CONTRACTS = \{([\s\S]*?)\};/) || [])[1] || '';
  const m = {}; for (const x of block.matchAll(/'?([A-Z0-9]+)'?\s*:\s*(\d+)/g)) m[x[1]] = Number(x[2]);
  Object.values((doc && doc.stores.maps) || {}).forEach(r => { if (String(r.key).startsWith('cid:')) m[r.key.slice(4)] = r.value; });
  return m;
}
function heldTickers(doc){
  const tx = Object.values(doc.stores.transactions);
  const held = E.computePositions(tx).filter(p => p.qtyHeld > 1e-6 && (p.currency || 'SGD') === 'SGD').map(p => String(p.ticker).toUpperCase());
  const ruled = Object.values(doc.stores.rules).map(r => String(r.ticker || '').toUpperCase()).filter(Boolean);
  return [...new Set(held.concat(ruled))].sort();
}
const [cmd, ...args] = process.argv.slice(2);
const file = stateFile();

switch (cmd){
  case 'summary': {
    const st = readState(file);
    if (!st.doc){ console.log('No data yet at ' + path.relative(process.cwd(), file) + ' — run `npm start` and open the page once (seeds from the newest data/backups file), or import a backup.'); break; }
    const d = st.doc, n = k => Object.keys(d.stores[k] || {}).length;
    const cash = C.cashPositions(Object.values(d.stores.cash));
    const tks = heldTickers(d), ages = tks.map(t => (d.stores.prices[t] || {}).asOf || 'none').sort();
    console.log(JSON.stringify({ file: path.relative(process.cwd(), file), rev: st.rev, savedAt: st.savedAt, seededFrom: (d.stores.meta.seededFrom || {}).value,
      counts: Object.fromEntries(Object.keys(S.KEYPATH).map(k => [k, n(k)])),
      cashOnHand: cash.total, cashAsOf: cash.asOf, heldTickers: tks.length, oldestPrice: ages[0] || null,
      policiesNeedingDetails: Object.values(d.stores.policies).filter(p => p.needsDetails).length,
      flags: Object.keys(d.stores.meta).filter(k => /^(fix|fill):/.test(k)) }, null, 2));
    break;
  }
  case 'import': {
    const src = args[0]; if (!src) die('usage: import <backup.json>');
    const b = JSON.parse(fs.readFileSync(src, 'utf8'));
    if (!Array.isArray(b.transactions)) die('Not a dashboard Backup JSON (no transactions array)');
    const doc = S.docFromBackup(b); doc.stores.meta.seededFrom = { key: 'seededFrom', value: path.basename(src) };
    doc.savedAt = new Date().toISOString();
    const cur = readState(file);
    writeState({ rev: (cur.rev || 0) + 1, savedAt: doc.savedAt, doc }, file);
    const bdir = path.join(ROOT, 'data', 'backups'), dest = path.join(bdir, path.basename(src));
    if (/^portfolio-ledger_backup_.*\.json$/.test(path.basename(src)) && path.resolve(src) !== path.resolve(dest) && !fs.existsSync(dest)) fs.copyFileSync(src, dest);
    console.log('Imported ' + path.basename(src) + ': ' + Object.keys(S.KEYPATH).map(k => k + ' ' + Object.keys(doc.stores[k]).length).join(', ') + ' → rev ' + ((cur.rev || 0) + 1));
    break;
  }
  case 'export': {
    const st = readState(file); if (!st.doc) die('No data to export yet.');
    const out = args[0] || path.join(ROOT, 'data', 'backups', 'portfolio-ledger_backup_' + today() + '.json');
    const b = S.backupFromDoc(st.doc);
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(b, null, 2));
    console.log('Wrote ' + path.relative(process.cwd(), out) + ' (' + b.transactions.length + ' txns, ' + b.policies.length + ' policies, ' + b.properties.length + ' properties, ' + b.rules.length + ' rules, ' + b.cash.length + ' bank lines)');
    break;
  }
  case 'tickers': {
    const st = readState(file); if (!st.doc) die('No data yet.');
    const cid = contracts(st.doc);
    heldTickers(st.doc).forEach(t => { const p = st.doc.stores.prices[t] || {}; console.log([t, cid[t] || '(search_contracts on SGX)', p.price == null ? '—' : p.price, p.asOf || '—'].join('\t')); });
    break;
  }
  case 'set-prices': {
    const src = (args.find((a, i) => args[i - 1] === '--source')) || 'IBKR';
    const pairs = args.filter((a, i) => /=/.test(a) && args[i - 1] !== '--source');
    if (!pairs.length) die('usage: set-prices TICKER=PRICE[@YYYY-MM-DD] …');
    const rows = pairs.map(p => { const m = p.match(/^([A-Za-z0-9]+)=([\d.]+)(?:@(\d{4}-\d{2}-\d{2}))?$/); if (!m) die('bad price: ' + p); return { ticker: m[1].toUpperCase(), price: C.snapToTick(Number(m[2])), asOf: m[3] || today(), source: src }; });
    const st = updateDoc(doc => { rows.forEach(r => { doc.stores.prices[r.ticker] = r; }); doc.stores.meta.lastPriceRefresh = { key: 'lastPriceRefresh', value: Date.now() }; }, file);
    console.log('Saved ' + rows.length + ' price(s) → rev ' + st.rev + ': ' + rows.map(r => r.ticker + ' ' + r.price + '@' + r.asOf).join(', '));
    break;
  }
  case 'get': {
    const [store, key] = args; const st = readState(file); if (!st.doc) die('No data yet.');
    if (!S.KEYPATH[store]) die('unknown store ' + store);
    console.log(JSON.stringify(key != null ? st.doc.stores[store][key] || null : Object.values(st.doc.stores[store]), null, 2));
    break;
  }
  case 'put': {
    const [store, json] = args; if (!S.KEYPATH[store] || !json) die('usage: put <store> \'<json>\'');
    const rec = JSON.parse(json), kp = S.KEYPATH[store];
    let key;
    const st = updateDoc(doc => {
      if (S.AUTO[store] && (rec[kp] == null || rec[kp] === '')) rec[kp] = Object.keys(doc.stores[store]).reduce((m, k) => Math.max(m, Number(k) || 0), 0) + 1;
      if (rec[kp] == null || rec[kp] === '') die(store + ' record needs ' + kp);
      key = rec[kp]; doc.stores[store][key] = rec;
    }, file);
    console.log('Saved ' + store + ' ' + key + ' → rev ' + st.rev);
    break;
  }
  case 'del': {
    const [store, key] = args; if (!S.KEYPATH[store] || key == null) die('usage: del <store> <key>');
    const st = updateDoc(doc => { if (!doc.stores[store][key]) die('No ' + store + ' record ' + key); delete doc.stores[store][key]; }, file);
    console.log('Deleted ' + store + ' ' + key + ' → rev ' + st.rev);
    break;
  }
  default:
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'));
}
