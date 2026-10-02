/* store.js — every record lives in one document (DOC). Two backends, same promise API the ledger
   always used (sAll / sGet / sPut / sAdd / sDel / sClear / sBulkAdd):

   • file    — when the page is served by app/server.js (Claude Code / local use). The server embeds
               the saved document in the page (<script id="server-state">) and every change is
               POSTed back to data/state/okfo-state.json, guarded by a revision number so edits made
               outside the page (Claude Code, tools/state.js) are never silently overwritten — the page
               reloads instead.
   • browser — localStorage (the Cowork artifact keeps it across reloads and app restarts).
   • claude  — when built as a claude.ai artifact (npm run build:claude): the page carries no data;
               each store is saved in the artifact's database under the viewer's private
               data/users/<id>/ subtree, split into ≤180 KB documents (the platform caps one at 256 KiB).

   The embedded seed (newest data/backups file) is used only when nothing has been saved yet. */
const STORE_KEY = 'okfo:v1';
const KEYPATH = { transactions: 'id', prices: 'ticker', boundaries: 'key', histprices: 'key', meta: 'key', rules: 'id',
  cash: 'key', properties: 'id', policies: 'id', people: 'id', maps: 'key' };
const AUTO = { transactions: 1, rules: 1, properties: 1, policies: 1, people: 1 };
const BACKUP_STORES = ['rules', 'cash', 'properties', 'policies', 'people', 'maps'];
let DOC = null, STORE_SOURCE = 'empty', STORE_OK = true, STORE_BACKEND = 'browser';
let _server = null;   // file backend: { rev, pending, timer, inflight }
const _clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
function _blankDoc(){ const stores = {}; Object.keys(KEYPATH).forEach(k => { stores[k] = {}; }); return { version: 1, savedAt: null, seq: {}, stores }; }

/* ---------- backup ⇄ document (pure; also used by app/tools/state.js in Node) ---------- */
// A Backup JSON (format portfolio-ledger, v1 or v2) → a full document. Transactions keep their ids
// when present so cross-references (e.g. dividend matches) survive; meta flags carried by v2+
// backups (one-time fixes already applied) come back too.
function docFromBackup(s){
  const doc = _blankDoc(), put = (store, v) => { const kp = KEYPATH[store]; if (v && v[kp] != null && v[kp] !== '') doc.stores[store][v[kp]] = _clone(v); };
  let next = 1;
  (s.transactions || []).forEach(t => { const v = _clone(t); if (v.id == null || doc.stores.transactions[v.id]) v.id = next; next = Math.max(next, Number(v.id) || 0) + 1; put('transactions', v); });
  (s.prices || []).forEach(p => put('prices', p));
  (s.boundaries || []).forEach(b => put('boundaries', b));
  (s.histPrices || []).forEach(h => put('histprices', Object.assign({ key: h.date + '|' + h.ticker }, h)));
  BACKUP_STORES.forEach(k => (s[k] || []).forEach(r => put(k, r)));
  (s.metaFlags || []).forEach(m => put('meta', m));
  // Backups made before flags were exported: if the folder registry is clearly already in them, don't
  // let the one-time registry fill re-add records the user deleted on purpose.
  if (!(s.metaFlags || []).some(m => /^fill:/.test(m.key)) && (s.policies || []).length > 4 && (s.properties || []).length)
    doc.stores.meta['fill:registry-2026-09-28'] = { key: 'fill:registry-2026-09-28', value: s.exportedAt || 'from backup', note: 'implied by backup contents' };
  if (s.seedSource || s.exportedAt) doc.stores.meta.seededFrom = { key: 'seededFrom', value: s.seedSource || s.exportedAt };
  return doc;
}
// A document → Backup JSON v3 (everything, incl. the one-time fix/fill flags).
function backupFromDoc(doc){
  const v = o => Object.values(o || {}).map(_clone);
  const data = { format: 'portfolio-ledger', version: 3, exportedAt: new Date().toISOString(),
    transactions: v(doc.stores.transactions), prices: v(doc.stores.prices), boundaries: v(doc.stores.boundaries),
    histPrices: v(doc.stores.histprices) };
  BACKUP_STORES.forEach(k => { data[k] = v(doc.stores[k]); });
  data.metaFlags = v(doc.stores.meta).filter(m => /^(fix|fill):/.test(m.key));
  return data;
}

/* ---------- persistence ---------- */
function _persist(){
  DOC.savedAt = new Date().toISOString();
  if (STORE_SOURCE === 'memory') return;
  if (STORE_BACKEND === 'file'){ _queueServerSave(); return; }
  if (STORE_BACKEND === 'claude'){ _queueClaudeSave(); return; }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(DOC)); STORE_OK = true; }
  catch (e) {
    STORE_OK = false; console.error('save failed', e);
    if (typeof toast === 'function') toast('Couldn’t save on this device (' + e.message + '). Back up JSON now.');
  }
  _notifySaved();
}
function _notifySaved(){ if (typeof onStoreSaved === 'function') { try { onStoreSaved(DOC.savedAt, STORE_OK); } catch (e) {} } }
function _queueServerSave(){
  _server.pending = true;
  clearTimeout(_server.timer);
  _server.timer = setTimeout(_flushServerSave, 250);
}
async function _flushServerSave(){
  if (!_server.pending || _server.inflight) return;
  _server.pending = false; _server.inflight = true;
  try {
    const r = await fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev: _server.rev, doc: DOC }) });
    if (r.status === 409){
      STORE_OK = false; _notifySaved();
      if (typeof toast === 'function') toast('The data was changed outside this page (e.g. by Claude Code) — reloading so nothing is overwritten');
      setTimeout(() => location.reload(), 1500); return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    _server.rev = (await r.json()).rev; STORE_OK = true;
  } catch (e) {
    STORE_OK = false; _server.pending = true; console.error('save to file failed', e);
    if (typeof toast === 'function') toast('Couldn’t save to data/state (' + e.message + '). Is the server still running?');
  } finally {
    _server.inflight = false; _notifySaved();
    if (_server.pending) _server.timer = setTimeout(_flushServerSave, 2000);
  }
}
// Edits made outside the page (Claude Code, tools/state.js) bump the revision: reload to show them.
function _watchServerRev(){
  setInterval(async () => {
    if (_server.pending || _server.inflight) return;
    try {
      const r = await fetch('/api/rev', { cache: 'no-store' }); if (!r.ok) return;
      const { rev } = await r.json();
      if (rev > _server.rev){ if (typeof toast === 'function') toast('Data updated outside the dashboard — reloading'); setTimeout(() => location.reload(), 800); }
    } catch (e) {}
  }, 5000);
}
/* ---------- claude.ai artifact backend (db capability) ---------- */
const CLAUDE_CHUNK = 180000;
let _claude = null;   // { db, uid, dirty:Set, chunks:{store:n}, timer, inflight, pending }
function _claudeMode(){ return typeof document !== 'undefined' && !!document.getElementById('claude-backend'); }
function _claudeRef(name){ return _claude.db.collection('data/users/' + _claude.uid).doc(name); }
function _markDirty(store){ if (_claude) _claude.dirty.add(store); }
// Split a store's records into documents under the size cap (records are never split).
function _chunkStore(items){
  const parts = []; let cur = {}, size = 2;
  Object.entries(items || {}).forEach(([k, v]) => {
    const n = JSON.stringify(k).length + JSON.stringify(v).length + 2;
    if (size + n > CLAUDE_CHUNK && Object.keys(cur).length){ parts.push(cur); cur = {}; size = 2; }
    cur[k] = v; size += n;
  });
  parts.push(cur);
  return parts;
}
async function _claudeConnect(){
  const nothing = () => { _seedDoc(); STORE_SOURCE = 'memory'; return STORE_SOURCE; };
  if (!window.claude || typeof window.claude.use !== 'function') return nothing();
  const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
  const uid = user && await user.id();
  if (!db || !uid) return nothing();
  _claude = { db, uid, dirty: new Set(), chunks: {}, timer: null, inflight: false, pending: false };
  const idx = await _claudeRef('okfo-index').get();
  DOC = _blankDoc();
  if (!idx.exists){ STORE_SOURCE = 'empty'; return STORE_SOURCE; }
  const meta = idx.data();
  DOC.seq = Object.assign({}, meta.seq || {}); DOC.savedAt = meta.savedAt || null;
  for (const [store, n] of Object.entries(meta.chunks || {})){
    if (!KEYPATH[store]) continue;
    _claude.chunks[store] = n;
    for (let i = 0; i < n; i++){
      const snap = await _claudeRef('okfo-' + store + '-' + i).get();
      if (snap.exists) Object.assign(DOC.stores[store], _clone(snap.data().items || {}));
    }
  }
  _normaliseDoc(DOC);
  STORE_SOURCE = 'saved';
  return STORE_SOURCE;
}
function _queueClaudeSave(){
  if (!_claude) return;
  _claude.pending = true;
  clearTimeout(_claude.timer);
  _claude.timer = setTimeout(_flushClaudeSave, 600);
}
async function _flushClaudeSave(){
  if (!_claude.pending || _claude.inflight) return;
  _claude.pending = false; _claude.inflight = true;
  const stores = [..._claude.dirty]; _claude.dirty.clear();
  try {
    for (const store of stores){
      const parts = _chunkStore(DOC.stores[store]);
      for (let i = 0; i < parts.length; i++) await _claudeRef('okfo-' + store + '-' + i).set({ items: parts[i] });
      for (let i = parts.length; i < (_claude.chunks[store] || 0); i++) await _claudeRef('okfo-' + store + '-' + i).delete();
      _claude.chunks[store] = parts.length;
    }
    await _claudeRef('okfo-index').set({ version: 1, savedAt: DOC.savedAt, seq: DOC.seq, chunks: _claude.chunks });
    STORE_OK = true;
  } catch (e) {
    stores.forEach(s => _claude.dirty.add(s)); _claude.pending = true; STORE_OK = false;
    console.error('save to the artifact database failed', e);
    if (typeof toast === 'function') toast('Couldn’t save (' + (e.code || e.message) + '). Back up JSON before closing.');
  } finally {
    _claude.inflight = false; _notifySaved();
    if (_claude.pending) _claude.timer = setTimeout(_flushClaudeSave, STORE_OK ? 600 : 5000);
  }
}
// Every backend is ready once this resolves; only the claude backend has anything to wait for.
async function storeReady(){
  if (STORE_BACKEND !== 'claude') return STORE_SOURCE;
  try { return await _claudeConnect(); }
  catch (e) { console.error('artifact database unavailable', e); _seedDoc(); STORE_SOURCE = 'memory'; return STORE_SOURCE; }
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
  DOC.stores[store][v[kp]] = v; _markDirty(store);
  return v[kp];
}
function sAll(store){ return Promise.resolve(Object.values(DOC.stores[store] || {}).map(_clone)); }
function sGet(store, key){ const v = (DOC.stores[store] || {})[key]; return Promise.resolve(v == null ? null : _clone(v)); }
function sPut(store, val){ const k = _put(store, val); _persist(); return Promise.resolve(k); }
function sAdd(store, val){ const v = _clone(val); if (AUTO[store]) delete v[KEYPATH[store]]; return sPut(store, v); }
function sDel(store, key){ delete DOC.stores[store][key]; _markDirty(store); _persist(); return Promise.resolve(); }
function sClear(store){ DOC.stores[store] = {}; _markDirty(store); _persist(); return Promise.resolve(); }
function sBulkAdd(store, items){
  (items || []).forEach(it => { const v = _clone(it); if (AUTO[store]) delete v[KEYPATH[store]]; _put(store, v); });
  _persist(); return Promise.resolve();
}
function _seedDoc(){
  DOC = _blankDoc();
  const el = document.getElementById('seed'); if (!el) return DOC;
  let s; try { s = JSON.parse(el.textContent); } catch (e) { console.error('seed unreadable', e); return DOC; }
  DOC = docFromBackup(s);
  DOC.stores.meta.seededFrom = { key: 'seededFrom', value: s.seedSource || s.exportedAt || null };
  return DOC;
}
function _normaliseDoc(d){ d.seq = d.seq || {}; Object.keys(KEYPATH).forEach(k => { if (!d.stores[k]) d.stores[k] = {}; }); return d; }
function _lsUsable(){ try { const k = '__okfo_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; } }
function _serverState(){
  const el = typeof document !== 'undefined' && document.getElementById('server-state'); if (!el) return null;
  try { return JSON.parse(el.textContent); } catch (e) { return null; }
}
function storeInit(){
  if (_claudeMode()){ STORE_BACKEND = 'claude'; DOC = _blankDoc(); STORE_SOURCE = 'loading'; return STORE_SOURCE; }   // storeReady() loads
  const ss = _serverState();
  if (ss){                                    // served by app/server.js → data lives in data/state/
    STORE_BACKEND = 'file'; _server = { rev: ss.rev || 0, pending: false, timer: null, inflight: false };
    if (ss.doc && ss.doc.stores){ DOC = _normaliseDoc(ss.doc); STORE_SOURCE = 'saved'; }
    else { _seedDoc(); STORE_SOURCE = Object.keys(DOC.stores.transactions).length ? 'seed' : 'empty'; _persist(); }
    if (!ss.noWatch) _watchServerRev();
    return STORE_SOURCE;
  }
  if (!_lsUsable()){ _seedDoc(); STORE_SOURCE = 'memory'; return STORE_SOURCE; }
  let saved = null;
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) saved = JSON.parse(raw); } catch (e) { console.warn('saved data unreadable', e); }
  if (saved && saved.stores){ DOC = _normaliseDoc(saved); STORE_SOURCE = 'saved'; }
  else {
    _seedDoc();
    STORE_SOURCE = Object.keys(DOC.stores.transactions).length ? 'seed' : 'empty';
    _persist();
  }
  return STORE_SOURCE;
}
function storeReset(){
  if (STORE_BACKEND === 'file'){ _seedDoc(); STORE_SOURCE = 'seed'; _persist(); return STORE_SOURCE; }
  try { localStorage.removeItem(STORE_KEY); } catch (e) {} DOC = null; return storeInit();
}
function storeSavedAt(){ return DOC ? DOC.savedAt : null; }

if (typeof module !== 'undefined' && module.exports) module.exports = { KEYPATH, AUTO, BACKUP_STORES, docFromBackup, backupFromDoc, _blankDoc };
