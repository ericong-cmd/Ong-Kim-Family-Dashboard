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
  ok(tx.length === 2 && tx[0].id === 99 && tx[1].id === 100 && tx[0].type === 'BUY', 'seed transaction ids kept exactly as in the backup');
  ok((await w.api.sAll('histprices'))[0].key === '2026-03-31|X', 'hist prices keyed date|ticker');
  ok((await w.api.sAll('policies')).length === 1 && (await w.api.sAll('people')).length === 1, 'seed people and policies');
  ok(typeof w.mem['okfo:v1'] === 'string', 'seed persisted immediately');
  // edits persist; reopening prefers saved data over the seed
  const id = await w.api.sAdd('transactions', { id: 555, type: 'DIVIDEND', ticker: 'X', date: '2026-03-01' });
  ok(id === 101, 'sAdd ignores a supplied id on auto stores and continues the sequence');
  await w.api.sPut('properties', { name: 'Flat' });
  await w.api.sPut('prices', { ticker: 'X', price: 2, asOf: '2026-09-03' });
  const w2 = world(w.mem, seed);
  ok(w2.api.storeInit() === 'saved', 'reopen uses saved data, not the seed');
  ok((await w2.api.sAll('transactions')).length === 3 && (await w2.api.sAll('properties'))[0].id === 1, 'saved edits survive a reopen');
  ok((await w2.api.sGet('prices', 'X')).price === 2, 'price update survived');
  await w2.api.sDel('transactions', 100); ok((await w2.api.sAll('transactions')).length === 2, 'delete');
  await w2.api.sBulkAdd('cash', [{ key: 'a', v: 1 }, { key: 'b', v: 2 }]); ok((await w2.api.sAll('cash')).length === 2, 'bulk add');
  await w2.api.sClear('cash'); ok((await w2.api.sAll('cash')).length === 0, 'clear');
  const got = await w2.api.sGet('prices', 'X'); got.price = 999;
  ok((await w2.api.sGet('prices', 'X')).price === 2, 'reads are copies — callers cannot mutate storage');
  ok(w2.api.storeReset() === 'seed' && (await w2.api.sAll('properties')).length === 0, 'reset returns to bundled data');
  // storage blocked → in-memory mode, still usable
  const w3 = world(null, seed, true);
  ok(w3.api.storeInit() === 'memory' && (await w3.api.sAll('transactions')).length === 2, 'blocked storage → memory mode with seed');

  // backup ⇄ document round trip on the newest real backup — nothing may be lost in the port
  const S = require('../src/store.js');
  const bdir = path.join(__dirname, '..', '..', 'data', 'backups');
  const bfile = fs.readdirSync(bdir).filter(n => /^portfolio-ledger_backup_.*\.json$/.test(n)).sort().pop();
  const real = JSON.parse(fs.readFileSync(path.join(bdir, bfile), 'utf8'));
  const doc = S.docFromBackup(real);
  const back = S.backupFromDoc(doc);
  const counts = o => ['transactions', 'prices', 'boundaries', 'histPrices', 'rules', 'cash', 'properties', 'policies', 'people', 'maps'].map(k => (o[k] || []).length).join(',');
  ok(counts(back) === counts(real), 'round trip of ' + bfile + ' keeps every record (' + counts(real) + ')');
  const byId = a => JSON.stringify([...a].sort((x, y) => (x.id > y.id ? 1 : -1)));
  ok(byId(back.transactions) === byId(real.transactions) && byId(back.policies) === byId(real.policies) && byId(back.properties) === byId(real.properties), 'transactions, policies and properties identical field by field');
  ok(doc.stores.meta['fill:registry-2026-09-28'] && back.metaFlags.some(m => m.key === 'fill:registry-2026-09-28'), 'registry already in the backup → fill flag set, so deleted records are not re-added');
  doc.stores.meta['fix:inspecie-v1'] = { key: 'fix:inspecie-v1', value: 'x' };
  ok(S.docFromBackup(S.backupFromDoc(doc)).stores.meta['fix:inspecie-v1'].value === 'x', 'one-time fix flags travel with the backup');
  console.log(failed ? '\n' + failed + ' TEST(S) FAILED' : '\nALL TESTS PASSED'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
