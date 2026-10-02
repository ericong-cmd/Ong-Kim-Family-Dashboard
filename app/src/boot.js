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
// One-time correction (28 Sep 2026) for data already saved on the device: an in-specie opening
// flagged EARNED whose value is also booked as a same-day dividend is counted twice in the return.
// Drop the flag so the dividend alone carries the income. Runs once; later edits are left alone.
function applyInSpecieFix(){
  if ((DOC.stores.meta['fix:inspecie-v1'] || {}).value) return 0;
  const hits = doubleCountedInSpecie(Object.values(DOC.stores.transactions));
  hits.forEach(h => {
    const t = Object.assign({}, DOC.stores.transactions[h.openingId]);
    delete t.acquired;
    t.note = (t.note ? t.note + ' | ' : '') + 'EARNED flag removed 2026-09-28: the ' + fmtSGD(h.value) + ' value is already booked as the ' + h.date + ' dividend, so the units count as capital in - income recognised once.';
    sPut('transactions', t);
  });
  sPut('meta', { key: 'fix:inspecie-v1', value: new Date().toISOString(), fixed: hits.map(h => h.ticker + ' ' + h.date) });
  return hits.length;
}
// One-time fill of the family registers (policies, properties, people) read from the Insurance and
// Property folders. Records already on the device are matched — policies by insured + policy
// number, properties by address — and only their blank fields are filled, so nothing typed in the
// dashboard is overwritten; anything missing is added. Runs once per registry version.
function applyRegistryFill(){
  let s; try { s = JSON.parse(document.getElementById('seed').textContent); } catch (e) { return null; }
  const ver = s.registryVersion; if (!ver || (DOC.stores.meta['fill:' + ver] || {}).value) return null;
  s = s.registry || s;
  const blank = v => v == null || v === '';
  const fill = (cur, inc) => { let n = 0; Object.keys(inc).forEach(k => { if (k !== 'id' && blank(cur[k]) && !blank(inc[k])){ cur[k] = inc[k]; n++; } }); return n; };
  const pno = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
  const low = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const res = { people: 0, policies: 0, properties: 0, updated: 0 };
  const names = new Set(Object.values(DOC.stores.people).map(p => low(p.name)));
  (s.people || []).forEach(p => { if (!names.has(low(p.name))){ const v = Object.assign({}, p); delete v.id; sAdd('people', v); names.add(low(p.name)); res.people++; } });
  const pols = Object.values(DOC.stores.policies);
  (s.policies || []).forEach(p => {
    const hit = pols.find(x => low(x.insured) === low(p.insured) && (pno(p.policyNo) ? pno(x.policyNo) === pno(p.policyNo)
      : (!pno(x.policyNo) && low(x.insurer) === low(p.insurer) && low(x.type) === low(p.type))));
    if (hit){
      const cur = Object.assign({}, hit), n = fill(cur, p);
      if (hit.needsDetails && p.needsDetails === false){ cur.needsDetails = false; }
      if (n || cur.needsDetails !== hit.needsDetails){ sPut('policies', cur); res.updated++; }
    } else { const v = Object.assign({}, p); delete v.id; sAdd('policies', v); res.policies++; }
  });
  const props = Object.values(DOC.stores.properties);
  (s.properties || []).forEach(p => {
    const hit = props.find(x => low(x.address) === low(p.address) || low(x.name) === low(p.name));
    if (hit){ const cur = Object.assign({}, hit); if (fill(cur, p)){ sPut('properties', cur); res.updated++; } }
    else { const v = Object.assign({}, p); delete v.id; sAdd('properties', v); res.properties++; }
  });
  sPut('meta', { key: 'fill:' + ver, value: new Date().toISOString(), result: res });
  return res;
}
async function boot(){
  const src = storeInit();
  const fixed = applyInSpecieFix();
  const filled = applyRegistryFill();
  const fromFolder = importInbox();
  Object.values(DOC.stores.maps || {}).forEach(m => { if (String(m.key).startsWith('cid:')) IBKR_CONTRACTS[m.key.slice(4)] = m.value; });
  await loadAll();
  populateOwner(); wire(); shellInit(); renderAll();
  const last = (DOC.stores.meta.lastPage || {}).value;
  showPage(['rules', 'ledger', 'cash', 'property', 'insurance'].includes(last) ? last : 'ledger');
  if (fromFolder) toast(fromFolder + ' new bank statement line' + (fromFolder === 1 ? '' : 's') + ' loaded from Statements/Bank');
  if (filled && (filled.policies || filled.properties || filled.updated)) toast('Family registers filled from the Insurance and Property folders: ' + filled.policies + ' policies and ' + filled.properties + ' properties added, ' + filled.updated + ' completed');
  if (fixed) toast('Corrected ' + fixed + ' in-specie distribution counted twice (Keppel REIT units, 8 May 2026)');
  if (src === 'memory') toast('This view can’t save on the device — back up JSON before closing.');
  window.__refreshDone = autoRefreshPrices(false).catch(e => { console.warn('price refresh failed', e); toast('Price refresh failed: ' + e.message); });
}
window.__refreshDone = Promise.resolve();
window.__bootDone = boot().catch(e => { console.error(e); toast('Start-up error: ' + e.message); });
