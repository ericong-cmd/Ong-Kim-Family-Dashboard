/* bridge.js — live SGX prices through the IBKR connector (window.cowork.callMcpTool in Cowork; the
   mcp capability in a claude.ai artifact).
   The artifact sandbox blocks direct web requests; the connector is the live source. */
const IBKR_PREFIX = 'mcp__11074d8e-bdc3-4cc0-a0b4-0174219e8270__';
// claude.ai artifact: the same connector through the page's mcp capability (viewer's own credentials).
const IBKR_SERVER = 'Interactive Brokers';
let _mcp = null;
async function bridgeReady(){
  if (_mcp || typeof window === 'undefined' || !window.claude || typeof window.claude.use !== 'function') return !!_mcp;
  try { _mcp = await window.claude.use('mcp'); } catch (e) { _mcp = null; }
  return !!_mcp;
}
const MCP_HELP = { server_not_connected: 'Add Interactive Brokers in claude.ai Settings → Connectors',
  needs_reauth: 'Reconnect Interactive Brokers in claude.ai Settings → Connectors',
  selection_required: 'Choose which Interactive Brokers connector to use when Claude asks',
  not_in_manifest: 'Interactive Brokers is turned off for this dashboard — allow it in the artifact’s connector settings',
  blocked_by_policy: 'Your organization blocks this Interactive Brokers tool' };
function hasBridge(){ return !!_mcp || !!(typeof window !== 'undefined' && window.cowork && typeof window.cowork.callMcpTool === 'function'); }
async function ibkr(tool, args){
  if (_mcp){
    try { const res = await _mcp.callTool(IBKR_SERVER, tool, args); return res.payload == null ? {} : res.payload; }
    catch (e) { const err = new Error(MCP_HELP[e.code] || e.message || 'IBKR connector error'); err.code = e.code; throw err; }
  }
  const r = await window.cowork.callMcpTool(IBKR_PREFIX + tool, args);
  if (!r) throw new Error('No response from the IBKR connector');
  if (r.isError){ const msg = (r.content && r.content[0] && r.content[0].text) || 'IBKR connector error'; throw new Error(msg); }
  if (r.structuredContent != null) return r.structuredContent;
  const txt = r.content && r.content[0] && r.content[0].text;
  return txt ? JSON.parse(txt) : {};
}
// Keys: bare SGX tickers ('D05') or 'SYMBOL.MY' / '.HK' / '.US' for rules on other markets (calc.js).
async function contractFor(tk){
  tk = String(tk || '').toUpperCase(); if (!tk) return null;
  if (IBKR_CONTRACTS[tk]) return IBKR_CONTRACTS[tk];
  const mkt = marketOfKey(tk), sym = symbolOfKey(tk);
  const d = await ibkr('search_contracts', { query: sym });
  const hit = listingChoices(d.results, mkt).find(x => x.symbol === sym);
  if (!hit) return null;
  IBKR_CONTRACTS[tk] = hit.conid;
  await sPut('maps', { key: 'cid:' + tk, value: hit.conid });
  return hit.conid;
}
// Stock search across SGX, Bursa, HKEX and US listings (market: 'SG' | 'MY' | 'HK' | 'US' | '' for all).
async function searchListings(query, market){
  const d = await ibkr('search_contracts', { query: String(query || '').trim() });
  return listingChoices(d.results, market || null);
}
const _TZ = { SG: 8, MY: 8, HK: 8, US: -5 };
function epochToSgtDate(sec){ return new Date(sec * 1000 + 8 * 3600e3).toISOString().slice(0, 10); }
function epochToMarketDate(sec, mkt){ return new Date(sec * 1000 + (_TZ[mkt] == null ? 8 : _TZ[mkt]) * 3600e3).toISOString().slice(0, 10); }
// Real-time last during market hours; otherwise the latest daily close, dated with that bar's date.
async function quoteTicker(tk){
  const mkt = marketOfKey(tk), ex = MARKETS[mkt].exchange;
  const cid = await contractFor(tk); if (!cid) throw new Error('No ' + MARKETS[mkt].short + ' listing found for ' + tk);
  let snap = {};
  try { snap = await ibkr('get_price_snapshot', { contract_id: cid, exchange: ex, market_data_names: ['last', 'bid_ask'] }); } catch (e) { snap = {}; }
  const last = snap && snap.last;
  if (last && last.price != null && isFinite(last.price) && !last.halted){
    return { ticker: tk, price: snapToTick(Number(last.price), mkt), asOf: last.ts ? epochToMarketDate(last.ts, mkt) : sgtParts(Date.now()).date, live: true, currency: MARKETS[mkt].currency };
  }
  const h = await ibkr('get_price_history', { contract_id: cid, security_type: 'STK', exchange: ex, step: 'ONE_DAY', period: 'ONE_WEEK', outside_rth: false });
  const n = (h.close || []).length; if (!n) throw new Error('No recent close for ' + tk);
  return { ticker: tk, price: snapToTick(Number(h.close[n - 1]), mkt), asOf: String(h.time[n - 1]).slice(0, 10), live: false, currency: MARKETS[mkt].currency };
}
async function priceHistory(tk, period){
  const mkt = marketOfKey(tk);
  const cid = await contractFor(tk); if (!cid) throw new Error('No ' + MARKETS[mkt].short + ' listing found for ' + tk);
  const h = await ibkr('get_price_history', { contract_id: cid, security_type: 'STK', exchange: MARKETS[mkt].exchange, step: 'ONE_DAY', period: period || 'SIX_MONTHS', outside_rth: false });
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
      try { const q = await quoteTicker(tk); const rec = { ticker: tk, price: q.price, asOf: q.asOf, source: 'IBKR' }; if (q.currency !== 'SGD') rec.currency = q.currency; await sPut('prices', rec); ok.push(q); }
      catch (e) { fail.push({ ticker: tk, error: e.message }); }
      done++; if (onProgress) onProgress(done, tickers.length);
    }
  };
  try { await Promise.all([worker(), worker(), worker(), worker()]); await sPut('meta', { key: 'lastPriceRefresh', value: Date.now() }); }
  finally { _refreshing = false; }
  return { ok, fail };
}
