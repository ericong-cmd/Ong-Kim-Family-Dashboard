/* rules.js — equity rules: buy tiers, cut loss and take-profit levels, proposed from Fibonacci
   retracements/extensions of the recent swing and rounded to the market's ticks. The stock is any
   listing on SGX, Bursa Malaysia, HKEX or a US exchange (IBKR search) — not limited to the portfolio. */
const RULE_LEVELS = ['buy1', 'buy2', 'buy3', 'cut', 'sell1', 'sell2', 'sell3'];
const RULE_LABEL = { buy1: 'Buy 1', buy2: 'Buy 2', buy3: 'Buy 3', cut: 'Cut loss', sell1: 'Sell 1', sell2: 'Sell 2', sell3: 'Sell 3' };
const LOOKBACKS = [{ value: 'THREE_MONTHS', label: '3 months' }, { value: 'SIX_MONTHS', label: '6 months' }, { value: 'ONE_YEAR', label: '1 year' }];
let _ruleChart = null, _ruleBars = null, _ruleSel = null;   // _ruleSel: the listing picked in the search
const MARKET_OPTS = Object.entries(MARKETS).map(([k, m]) => ({ value: k, label: m.label }));

function rulesList(){ return Object.values(DOC.stores.rules || {}).sort((a, b) => String(a.ticker).localeCompare(String(b.ticker))); }
function lastPrice(tk){ const p = G.prices[String(tk || '').toUpperCase()]; return p && p.price != null && p.price !== '' ? Number(p.price) : null; }
function knownTickers(){
  const s = new Set(Object.keys(IBKR_CONTRACTS));
  G.txns.forEach(t => { if (t.ticker) s.add(String(t.ticker).toUpperCase()); });
  return [...s].sort();
}
function heldTickers(){ return new Set(computePositions(G.txns).filter(p => p.qtyHeld > 1e-6).map(p => String(p.ticker).toUpperCase())); }
// Company name under the ticker box, so the choice is confirmed as it is typed or picked.
function tickerChoices(){ const held = heldTickers(); return knownTickers().map(tk => ({ value: tk, label: (tickerName(tk) || tk) + (held.has(tk) ? ' · held' : '') })); }
function showTickerName(){
  const el = document.getElementById('r_ticker'), h = document.getElementById('r_ticker_hint'); if (!el || !h) return;
  const tk = ruleKey(), n = tk ? ((_ruleSel && _ruleSel.key === tk && _ruleSel.name) || tickerName(tk)) : '';
  const m = MARKETS[marketOfKey(tk || 'X')];
  h.textContent = !tk ? '' : (n ? n + ' · ' : '') + m.short + ' · prices in ' + m.currency + (heldTickers().has(tk) ? ' · held' : '') + (n ? '' : ' — search above, or load price history to check the listing');
}
function tickerName(tk){
  tk = String(tk || '').toUpperCase();
  const t = [...G.txns].reverse().find(x => String(x.ticker || '').toUpperCase() === tk && x.equity); if (t) return t.equity;
  const r = Object.values(DOC.stores.rules || {}).find(x => String(x.ticker || '').toUpperCase() === tk && x.name);
  return r ? r.name : '';
}
// Key for what is in the ticker box: a bare symbol picks up the chosen market's suffix.
function ruleKey(){
  const raw = String((document.getElementById('r_ticker') || {}).value || '').trim().toUpperCase(), mkt = (document.getElementById('r_market') || {}).value || 'SG';
  if (!raw) return '';
  return /\.(MY|HK|US)$/.test(raw) || mkt === 'SG' ? raw : raw + '.' + mkt;
}
function ruleMarket(){ return marketOfKey(ruleKey() || 'X'); }
function ruleStatusInfo(r){
  const last = lastPrice(r.ticker), s = ruleStatus(last, r);
  if (s === 'cut') return { key: s, label: 'Cut loss hit', cls: 'cut' };
  if (s === 'profit') return { key: s, label: 'Take profit', cls: 'profit' };
  if (s === 'buy') return { key: s, label: 'Buy zone (tier ' + buyTier(last, r) + ')', cls: 'buy' };
  if (s === 'hold') return { key: s, label: 'Hold', cls: '' };
  return { key: s, label: 'No price', cls: 'attn' };
}
function _px(v){ return v == null || v === '' ? '—' : fmtNum(Number(v), Number(v) < 1 ? 3 : 2); }

function renderRules(){
  const list = rulesList(), info = list.map(ruleStatusInfo);
  const n = k => info.filter(i => i.key === k).length;
  document.getElementById('rulesKpis').innerHTML = kpiHtml([
    { label: 'Rules', value: String(list.length), sub: list.length ? 'stocks with levels set' : 'create your first rule' },
    { label: 'In buy zone', value: String(n('buy')), sub: 'at or below Buy 1', cls: n('buy') ? 'pos' : '' },
    { label: 'Cut loss hit', value: String(n('cut')), sub: 'at or below cut loss', cls: n('cut') ? 'neg' : '' },
    { label: 'Take profit', value: String(n('profit')), sub: 'at or above Sell 1' }
  ]);
  const body = document.getElementById('rulesBody');
  if (!list.length){ body.innerHTML = '<tr><td colspan="11" class="empty">No rules yet — <a href="#" id="rulesEmptyNew">create one</a> to set buy, cut-loss and sell levels.</td></tr>';
    body.querySelector('#rulesEmptyNew').addEventListener('click', e => { e.preventDefault(); openRuleDrawer(); }); return; }
  body.innerHTML = list.map((r, i) => {
    const last = lastPrice(r.ticker), p = G.prices[String(r.ticker).toUpperCase()] || {};
    const mk = MARKETS[marketOfKey(r.ticker)];
    return `<tr data-rule-id="${esc(r.id)}"><td><b class="mono">${esc(symbolOfKey(r.ticker))}</b> <span class="hint">${esc(mk.short)}${mk.currency !== 'SGD' ? ' · ' + mk.currency : ''}</span>${r.name ? `<div class="hint">${esc(r.name)}</div>` : ''}</td>
      <td class="num">${_px(last)}${p.asOf ? `<div class="hint">${esc(p.asOf)}</div>` : ''}</td>
      ${RULE_LEVELS.map(k => `<td class="num${k === 'cut' ? ' neg' : ''}">${_px(r[k])}</td>`).join('')}
      <td><span class="status ${info[i].cls}">${esc(info[i].label)}</span></td>
      <td class="row-actions"><button type="button" class="ghost" data-edit>Edit</button> <button type="button" class="danger" data-del>Delete</button></td></tr>`;
  }).join('');
  body.querySelectorAll('tr[data-rule-id]').forEach(tr => {
    const r = DOC.stores.rules[tr.dataset.ruleId];
    tr.querySelector('[data-edit]').addEventListener('click', () => openRuleDrawer(r));
    tr.querySelector('[data-del]').addEventListener('click', e => deleteRule(r, e.currentTarget));
  });
}
async function deleteRule(r, anchor){
  if (!r || !(await askConfirm(anchor, 'Delete the rule for ' + r.ticker + '?'))) return false;
  await sDel('rules', r.id); markDirty(); renderRules(); toast('Rule deleted');
}

function ruleFields(){
  return [
    { heading: 'Stock' },
    { id: 'r_market', key: 'market', label: 'Market', type: 'select', value: 'SG', options: MARKET_OPTS },
    { id: 'r_ticker', key: 'ticker', label: 'Ticker', required: true, placeholder: 'e.g. D05 · MAYBANK · 700 · AAPL', hint: '' },
    { id: 'r_lookback', key: 'lookback', label: 'Swing look-back', type: 'select', value: 'SIX_MONTHS', options: LOOKBACKS },
    { id: 'r_high', key: 'high', label: 'Swing high (H)', type: 'number', gt: 0 },
    { id: 'r_low', key: 'low', label: 'Swing low (L)', type: 'number', gt: 0 },
    { heading: 'Levels' },
    { id: 'r_buy1', key: 'buy1', label: 'Buy 1', type: 'number', required: true, gt: 0 },
    { id: 'r_sell1', key: 'sell1', label: 'Sell 1', type: 'number', required: true, gt: 0 },
    { id: 'r_buy2', key: 'buy2', label: 'Buy 2', type: 'number', gt: 0 },
    { id: 'r_sell2', key: 'sell2', label: 'Sell 2', type: 'number', gt: 0 },
    { id: 'r_buy3', key: 'buy3', label: 'Buy 3', type: 'number', gt: 0 },
    { id: 'r_sell3', key: 'sell3', label: 'Sell 3', type: 'number', gt: 0 },
    { id: 'r_cut', key: 'cut', label: 'Cut loss', type: 'number', required: true, gt: 0 },
    { id: 'r_notes', key: 'notes', label: 'Notes', type: 'textarea', span: true }
  ];
}
function _ruleDrawerHtml(defs, r){
  const top = defs.slice(0, 6), rest = defs.slice(6);
  const search = `<div class="rule-search"><label class="fld" style="flex:1">Find a stock — Singapore, Malaysia, Hong Kong or US
      <input type="text" id="r_search" placeholder="Company name or ticker, e.g. Maybank, Tencent, Apple" autocomplete="off"></label>
      <button type="button" class="ghost" id="ruleSearchBtn">Search (IBKR)</button></div>
    <div id="ruleSearchResults" class="rule-results"></div>`;
  return search + fieldsHtml(top, r)
    + `<div class="actions"><button type="button" class="ghost" id="ruleLoadBtn">Load price history (IBKR)</button>
       <button type="button" class="primary" id="ruleApplyFib">Propose Fibonacci levels</button><span class="hint" id="ruleSwingInfo"></span></div>
       <div class="chart-box" id="ruleChartBox" hidden><canvas id="ruleChart"></canvas></div>
       <div class="scroll"><table class="fib-table" id="ruleFibTable"></table></div>`
    + fieldsHtml(rest, r)
    + '<div class="hint" style="margin-top:10px">Proposal: Buy 1–3 at the 38.2 / 50 / 61.8% retracements, cut loss at 78.6%, Sell 1 at the prior high and Sell 2–3 at the 127.2 / 161.8% extensions — all rounded to the market’s ticks and editable. Fibonacci levels are a charting convention, not a forecast or investment advice.</div>';
}
function _v(id){ const el = document.getElementById(id); return el && el.value !== '' ? Number(el.value) : null; }
function renderFibTable(){
  const t = document.getElementById('ruleFibTable'); if (!t) return;
  const f = fibLevels(_v('r_high'), _v('r_low'));
  if (!f){ t.innerHTML = ''; return; }
  const rows = [['23.6% retracement', f.r236, 'reference', '#9aa5a0'], ['38.2% retracement', f.r382, 'Buy 1', '#0b7a45'], ['50.0% retracement', f.r500, 'Buy 2', '#0b7a45'],
    ['61.8% retracement', f.r618, 'Buy 3', '#0b7a45'], ['78.6% retracement', f.r786, 'Cut loss', '#b3261e'], ['100% (prior high)', f.e1000, 'Sell 1', '#1f5aa6'],
    ['127.2% extension', f.e1272, 'Sell 2', '#1f5aa6'], ['161.8% extension', f.e1618, 'Sell 3', '#1f5aa6']];
  t.innerHTML = '<tr><th>Level</th><th class="num">Price</th><th class="num">On tick</th><th>Use</th></tr>'
    + rows.map(r => `<tr><td><span class="swatch" style="background:${r[3]}"></span>${r[0]}</td><td class="num">${fmtNum(r[1], 4)}</td><td class="num">${_px(roundToTick(r[1], ruleMarket()))}</td><td>${r[2]}</td></tr>`).join('');
}
function drawRuleChart(){
  const box = document.getElementById('ruleChartBox'), cv = document.getElementById('ruleChart');
  if (_ruleChart){ try { _ruleChart.destroy(); } catch (e) {} _ruleChart = null; }
  if (!box || !cv || typeof window.Chart !== 'function' || !_ruleBars || !_ruleBars.time.length){ if (box) box.hidden = true; return; }
  box.hidden = false;
  const labels = _ruleBars.time.map(t => String(t).slice(0, 10));
  const lvl = (k, color, dash) => { const v = _v('r_' + k); return v == null ? null : { label: RULE_LABEL[k], data: labels.map(() => v), borderColor: color, borderWidth: 1.2, borderDash: dash || [], pointRadius: 0, fill: false }; };
  const ds = [{ label: 'Close', data: _ruleBars.close.map(Number), borderColor: '#191d1a', borderWidth: 1.6, pointRadius: 0, tension: 0.1, fill: false }]
    .concat([lvl('buy1', '#0b7a45'), lvl('buy2', '#0b7a45', [5, 3]), lvl('buy3', '#0b7a45', [2, 3]), lvl('cut', '#b3261e'),
      lvl('sell1', '#1f5aa6'), lvl('sell2', '#1f5aa6', [5, 3]), lvl('sell3', '#1f5aa6', [2, 3])].filter(Boolean));
  _ruleChart = new window.Chart(cv.getContext('2d'), { type: 'line', data: { labels, datasets: ds },
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { x: { ticks: { maxTicksLimit: 8, font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } } } });
}
async function loadRuleHistory(){
  const tk = ruleKey();
  if (!tk){ markFieldError('r_ticker', 'Search for a stock or enter a ticker first'); return; }
  if (!hasBridge()){ toast('IBKR connector not available here — enter the swing high and low yourself'); return; }
  const btn = document.getElementById('ruleLoadBtn'); btn.disabled = true; btn.textContent = 'Loading…';
  try {
    _ruleBars = await priceHistory(tk, document.getElementById('r_lookback').value);
    const sw = swingFromBars(_ruleBars);
    if (!sw) throw new Error('No price history returned for ' + tk);
    document.getElementById('r_high').value = sw.high; document.getElementById('r_low').value = sw.low;
    document.getElementById('ruleSwingInfo').textContent = 'High ' + _px(sw.high) + ' on ' + sw.highDate + ' · low ' + _px(sw.low) + ' on ' + sw.lowDate + ' · ' + (sw.trend === 'up' ? 'up-swing' : 'down-swing');
    if (lastPrice(tk) == null){
      const q = await quoteTicker(tk); const pr = { ticker: tk, price: q.price, asOf: q.asOf, source: 'IBKR' }; if (q.currency !== 'SGD') pr.currency = q.currency; sPut('prices', pr); await loadAll();
    }
    applyRuleFib();
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Load price history (IBKR)'; }
}
function applyRuleFib(){
  const rec = fibRecommend(_v('r_high'), _v('r_low'), ruleMarket());
  if (!rec){ markFieldError('r_high', 'Swing high must be above swing low'); return; }
  RULE_LEVELS.forEach(k => { document.getElementById('r_' + k).value = rec[k]; });
  renderFibTable(); drawRuleChart();
}
function openRuleDrawer(r){
  const defs = ruleFields(); _ruleBars = null; _ruleSel = null;
  openDrawer({
    title: r ? 'Edit rule · ' + r.ticker : 'New rule', wide: true, html: _ruleDrawerHtml(defs, r ? Object.assign({}, r, { market: marketOfKey(r.ticker), ticker: symbolOfKey(r.ticker) }) : {}),
    saveLabel: r ? 'Save changes' : 'Create rule',
    onDelete: r ? btn => deleteRule(r, btn) : null,
    onClose: () => { if (_ruleChart){ try { _ruleChart.destroy(); } catch (e) {} _ruleChart = null; } _ruleBars = null; },
    onMount: () => {
      ['r_ticker', 'r_market'].forEach(id => ['input', 'change'].forEach(ev => document.getElementById(id).addEventListener(ev, () => { _ruleSel = null; showTickerName(); renderFibTable(); }))); showTickerName();
      document.getElementById('ruleSearchBtn').addEventListener('click', runRuleSearch);
      document.getElementById('r_search').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); runRuleSearch(); } });
      document.getElementById('ruleLoadBtn').addEventListener('click', loadRuleHistory);
      document.getElementById('ruleApplyFib').addEventListener('click', applyRuleFib);
      ['r_high', 'r_low'].forEach(id => document.getElementById(id).addEventListener('change', renderFibTable));
      RULE_LEVELS.forEach(k => document.getElementById('r_' + k).addEventListener('change', drawRuleChart));
      renderFibTable();
    },
    onSave: () => {
      const { values, errors } = readFields(defs);
      if (Object.keys(errors).length) return false;
      values.ticker = ruleKey(); const mkt = marketOfKey(values.ticker); delete values.market;
      // order: cut < buy3 ≤ buy2 ≤ buy1 < sell1 ≤ sell2 ≤ sell3 (optional tiers skipped when blank)
      const seq = ['cut', 'buy3', 'buy2', 'buy1', 'sell1', 'sell2', 'sell3'].filter(k => values[k] != null);
      for (let i = 1; i < seq.length; i++){
        const a = seq[i - 1], b = seq[i], strict = a === 'cut' || (a.startsWith('buy') && b.startsWith('sell'));
        if (strict ? !(values[b] > values[a]) : !(values[b] >= values[a])){
          markFieldError('r_' + b, RULE_LABEL[b] + ' must be ' + (strict ? 'above ' : 'at or above ') + RULE_LABEL[a]); return false;
        }
      }
      RULE_LEVELS.forEach(k => { if (values[k] != null && !onTick(values[k], mkt)) values[k] = roundToTick(values[k], mkt); });
      const name = (_ruleSel && _ruleSel.key === values.ticker && _ruleSel.name) || tickerName(values.ticker) || (r && r.ticker === values.ticker && r.name) || '';
      const rec = Object.assign({}, r || {}, values, { name, currency: MARKETS[mkt].currency, updatedAt: new Date().toISOString() });
      if (!r) rec.createdAt = rec.updatedAt;
      sPut('rules', rec); markDirty(); renderRules();
      toast(r ? 'Rule updated' : 'Rule created for ' + rec.ticker);
    }
  });
}
// Search IBKR listings and let the user pick one: fills market + ticker and remembers the contract.
async function runRuleSearch(){
  const q = String(document.getElementById('r_search').value || '').trim(), box = document.getElementById('ruleSearchResults');
  if (!q){ markFieldError('r_search', 'Type a company name or ticker'); return; }
  await bridgeReady();
  if (!hasBridge()){ box.innerHTML = '<div class="hint">Search needs the Interactive Brokers connector (claude.ai artifact or Cowork). Here, choose the market and type the ticker below.</div>'; return; }
  const btn = document.getElementById('ruleSearchBtn'); btn.disabled = true; btn.textContent = 'Searching…';
  try {
    const list = await searchListings(q, '');
    box.innerHTML = list.length ? list.slice(0, 12).map((x, i) => `<button type="button" class="rule-hit" data-i="${i}"><b class="mono">${esc(x.symbol)}</b> ${esc(x.name)} <span class="hint">${esc(MARKETS[x.market].short)} · ${esc(x.exchange)} · ${esc(x.currency)}</span></button>`).join('')
      : '<div class="hint">No stock listed in Singapore, Malaysia, Hong Kong or the US matches “' + esc(q) + '”.</div>';
    box.querySelectorAll('.rule-hit').forEach(b => b.addEventListener('click', () => pickListing(list[Number(b.dataset.i)])));
  } catch (e) { box.innerHTML = '<div class="hint warn">' + esc(e.message) + '</div>'; }
  finally { btn.disabled = false; btn.textContent = 'Search (IBKR)'; }
}
function pickListing(x){
  document.getElementById('r_market').value = x.market;
  document.getElementById('r_ticker').value = x.symbol;
  IBKR_CONTRACTS[x.key] = x.conid; sPut('maps', { key: 'cid:' + x.key, value: x.conid });
  _ruleSel = x; _ruleBars = null;
  document.getElementById('ruleSearchResults').innerHTML = '';
  showTickerName(); renderFibTable();
}
document.getElementById('newRuleBtn').addEventListener('click', () => openRuleDrawer());
