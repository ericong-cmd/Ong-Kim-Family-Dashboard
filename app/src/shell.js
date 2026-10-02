/* shell.js — left navigation, page routing, the right-hand drawer used by every create/edit form,
   form helpers (fieldsHtml / readFields), KPI card markup and the sidebar status lines. */
const PAGES = ['rules', 'ledger', 'cash', 'property', 'insurance'];
let _page = null, _drawer = null;

function shellInit(){
  document.querySelectorAll('.nav-item[data-page]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-goto]'); if (!a) return;
    e.preventDefault(); showPage(a.dataset.goto);
  });
  document.getElementById('drawerBack').addEventListener('click', closeDrawer);
  document.getElementById('drawerX').addEventListener('click', closeDrawer);
  document.getElementById('drawerCancel').addEventListener('click', closeDrawer);
  document.getElementById('drawerSave').addEventListener('click', _drawerSave);
  document.getElementById('drawerDelete').addEventListener('click', _drawerDelete);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _drawer) closeDrawer(); });
  onStoreSaved(storeSavedAt(), STORE_OK);
  updateSidePrices();
}

function showPage(name){
  if (!PAGES.includes(name)) name = 'ledger';
  _page = name;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('is-active', p.id === 'page-' + name));
  document.querySelectorAll('.nav-item[data-page]').forEach(b => {
    const on = b.dataset.page === name; b.classList.toggle('is-active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const last = (DOC && DOC.stores.meta.lastPage) || {};
  if (last.value !== name) sPut('meta', { key: 'lastPage', value: name });
  renderCurrentPage();
  if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
}
function currentPage(){ return _page; }
function renderCurrentPage(){
  const fn = { rules: 'renderRules', cash: 'renderCash', property: 'renderProperties', insurance: 'renderInsurance', ledger: 'renderCashKpi' }[_page];
  if (fn && typeof window[fn] === 'function') window[fn]();
}

/* ---------- drawer ---------- */
function openDrawer(o){
  _drawer = o || {};
  const wrap = document.getElementById('drawerWrap');
  document.getElementById('drawerTitle').textContent = _drawer.title || '';
  document.getElementById('drawerBody').innerHTML = _drawer.html || '';
  document.querySelector('#drawerWrap .drawer').classList.toggle('wide', !!_drawer.wide);
  document.getElementById('drawerSave').textContent = _drawer.saveLabel || 'Save';
  document.getElementById('drawerDelete').hidden = typeof _drawer.onDelete !== 'function';
  wrap.hidden = false;
  if (typeof _drawer.onMount === 'function') _drawer.onMount(document.getElementById('drawerBody'));
  const first = document.querySelector('#drawerBody input, #drawerBody select, #drawerBody textarea');
  if (first) try { first.focus(); } catch (e) {}
}
function closeDrawer(){
  const d = _drawer; _drawer = null;
  if (d && typeof d.onClose === 'function') try { d.onClose(); } catch (e) { console.warn(e); }
  document.getElementById('drawerWrap').hidden = true;
  document.getElementById('drawerBody').innerHTML = '';
}
// onSave may be synchronous (the store writes synchronously) or return a promise; a result of
// false keeps the drawer open. Synchronous saves close the drawer in the same tick.
function _drawerSave(){
  if (!_drawer || typeof _drawer.onSave !== 'function'){ closeDrawer(); return; }
  const btn = document.getElementById('drawerSave');
  const done = r => { btn.disabled = false; if (r !== false) closeDrawer(); };
  const fail = e => { btn.disabled = false; console.warn(e); toast('Couldn’t save: ' + e.message); };
  let r;
  try { r = _drawer.onSave(); } catch (e) { fail(e); return; }
  if (r && typeof r.then === 'function'){ btn.disabled = true; return r.then(done, fail); }
  done(r);
}
async function _drawerDelete(){
  if (!_drawer || typeof _drawer.onDelete !== 'function') return;
  try { const r = await _drawer.onDelete(document.getElementById('drawerDelete')); if (r !== false) closeDrawer(); }
  catch (e) { console.warn(e); toast('Couldn’t delete: ' + e.message); }
}

/* ---------- forms ---------- */
// Field def: {id, label, type, options, required, min, step, placeholder, hint, span, list, after}
// list: datalist suggestions — strings, or {value, label} to show a label (e.g. company name) beside the value.
// or {heading:'Section title'}. options: strings, {value,label}, or {group, options:[…]}.
function _optHtml(opts, cur){
  return (opts || []).map(o => {
    if (o && o.group) return `<optgroup label="${esc(o.group)}">${_optHtml(o.options, cur)}</optgroup>`;
    const v = (o && typeof o === 'object') ? o.value : o, l = (o && typeof o === 'object') ? (o.label != null ? o.label : o.value) : o;
    return `<option value="${esc(v)}"${String(v) === String(cur == null ? '' : cur) ? ' selected' : ''}>${esc(l)}</option>`;
  }).join('');
}
function fieldsHtml(defs, values){
  values = values || {};
  return '<div class="fgrid">' + defs.map(d => {
    if (d.heading) return `<div class="fgroup">${esc(d.heading)}</div>`;
    const v = values[d.key || d.id.replace(/^[a-z]+_/, '')] != null ? values[d.key || d.id.replace(/^[a-z]+_/, '')] : (d.value != null ? d.value : '');
    const req = d.required ? ' <span aria-hidden="true" style="color:var(--red)">*</span>' : '';
    const ph = d.placeholder ? ` placeholder="${esc(d.placeholder)}"` : '';
    let ctl;
    if (d.type === 'select'){
      // A saved value that isn't among today's options (e.g. an owner typed before the list changed)
      // is kept as its own option, so opening and saving the form never silently blanks it.
      const flat = []; (d.options || []).forEach(o => (o && o.group) ? o.options.forEach(x => flat.push(x && typeof x === 'object' ? x.value : x)) : flat.push(o && typeof o === 'object' ? o.value : o));
      const extra = v !== '' && !flat.map(String).includes(String(v)) ? `<option value="${esc(v)}" selected>${esc(v)}</option>` : '';
      ctl = `<select id="${d.id}">${d.required && v === '' ? '<option value="">Choose…</option>' : (!d.required ? '<option value=""></option>' : '')}${_optHtml(d.options, v)}${extra}</select>`;
    }
    else if (d.type === 'textarea') ctl = `<textarea id="${d.id}" rows="3"${ph}>${esc(v)}</textarea>`;
    else {
      const t = d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : d.type === 'tel' ? 'tel' : 'text';
      const extra = (t === 'number' ? ` step="${d.step || 'any'}" class="num-in"` : '') + (d.min != null ? ` min="${d.min}"` : '') + (d.list ? ` list="${d.id}_list" autocomplete="off"` : '');
      ctl = `<input type="${t}" id="${d.id}" value="${esc(v)}"${ph}${extra}>` + (d.list ? `<datalist id="${d.id}_list">${d.list.map(x => (x && typeof x === 'object')
        ? `<option value="${esc(x.value)}" label="${esc(x.label || '')}">${esc(x.label || '')}</option>` : `<option value="${esc(x)}">`).join('')}</datalist>` : '');
    }
    return `<label class="fld${d.span ? ' span2' : ''}" data-for="${d.id}">${esc(d.label)}${req}${ctl}${d.hint != null ? `<span class="fhint" id="${d.id}_hint">${esc(d.hint)}</span>` : ''}</label>`;
  }).join('') + '</div>';
}
function readFields(defs){
  const values = {}, errors = {};
  document.querySelectorAll('#drawerBody .field-error').forEach(e => e.remove());
  document.querySelectorAll('#drawerBody label.fld.invalid').forEach(e => e.classList.remove('invalid'));
  defs.forEach(d => {
    if (d.heading) return;
    const el = document.getElementById(d.id); if (!el) return;
    const key = d.key || d.id.replace(/^[a-z]+_/, '');
    const raw = String(el.value == null ? '' : el.value).trim();
    let v = raw;
    if (d.type === 'number'){
      v = raw === '' ? null : Number(raw);
      if (raw !== '' && !isFinite(v)) errors[d.id] = 'Enter a number';
      else if (v != null && d.min != null && v < d.min) errors[d.id] = d.min === 0 ? 'Must not be negative' : 'Must be at least ' + d.min;
      else if (v != null && d.gt != null && !(v > d.gt)) errors[d.id] = 'Must be more than ' + d.gt;
    }
    if (d.required && (v == null || v === '')) errors[d.id] = 'Required';
    values[key] = v;
  });
  defs.forEach(d => {   // date order: this field must not be before the field named in `after`
    if (!d.after || errors[d.id]) return;
    const a = document.getElementById(d.after), b = document.getElementById(d.id);
    if (a && b && a.value && b.value && b.value < a.value){
      const lbl = (defs.find(x => x.id === d.after) || {}).label || 'the earlier date';
      errors[d.id] = 'Must be on or after ' + lbl.toLowerCase();
    }
  });
  Object.entries(errors).forEach(([id, msg]) => markFieldError(id, msg));
  return { values, errors };
}
function markFieldError(id, msg){
  const lab = document.querySelector('#drawerBody label.fld[data-for="' + id + '"]'); if (!lab) return;
  lab.classList.add('invalid');
  const s = document.createElement('span'); s.className = 'field-error'; s.textContent = msg; lab.appendChild(s);
}

/* ---------- inline confirmation ---------- */
// The artifact sandbox may block window.confirm, so destructive actions ask in the page itself:
// the button is swapped for "message  [Delete] [Cancel]" and the promise resolves with the choice.
function askConfirm(anchor, message, yesLabel){
  return new Promise(resolve => {
    if (!anchor || !anchor.parentNode){ resolve(false); return; }
    const box = document.createElement('span'); box.className = 'confirm-inline';
    box.innerHTML = `<span>${esc(message)}</span><button type="button" class="danger-solid" data-yes>${esc(yesLabel || 'Delete')}</button><button type="button" class="ghost" data-no>Cancel</button>`;
    anchor.hidden = true; anchor.insertAdjacentElement('afterend', box);
    const done = v => { box.remove(); anchor.hidden = false; resolve(v); };
    box.querySelector('[data-yes]').addEventListener('click', e => { e.stopPropagation(); done(true); });
    box.querySelector('[data-no]').addEventListener('click', e => { e.stopPropagation(); done(false); });
    box.querySelector('[data-no]').focus();
  });
}

/* ---------- KPI cards ---------- */
function kpiHtml(list){
  return (list || []).map(k => `<div class="kpi"><div class="kpi-l">${esc(k.label)}</div><div class="kpi-v${k.cls ? ' ' + k.cls : ''}">${esc(k.value)}</div><div class="kpi-s">${esc(k.sub || '')}</div></div>`).join('');
}

/* ---------- sidebar status ---------- */
function _hm(iso){ if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function onStoreSaved(savedAt, ok){
  const el = document.getElementById('sideStatus'); if (!el) return;
  if (STORE_SOURCE === 'memory'){ el.innerHTML = '<span class="warn">Not saving on this device — back up JSON</span>'; return; }
  const where = STORE_BACKEND === 'file' ? 'Saved to data/state' : STORE_BACKEND === 'claude' ? 'Saved to your Claude account' : 'Saved on this device';
  el.innerHTML = ok === false ? '<span class="warn">Last save failed — back up JSON</span>' : (where + (savedAt ? ' · ' + esc(_hm(savedAt)) : ''));
}
function updateSidePrices(){
  const el = document.getElementById('sidePrices'); if (!el) return;
  const oldest = typeof priceFreshness === 'function' ? priceFreshness() : null;
  if (!oldest){ el.textContent = ''; return; }
  const m = marketState(Date.now());
  const last = ((DOC && DOC.stores.meta.lastPriceRefresh) || {}).value;
  const stale = oldest < m.lastTradingDay;
  el.innerHTML = `<span class="${stale ? 'warn' : ''}">Prices as at ${esc(oldest)}</span>` + (last ? `<br>IBKR refresh ${esc(_hm(new Date(last).toISOString()))}` : '') + (m.open ? '<br>SGX open' : '<br>SGX closed');
}

/* ---------- in-page confirmations ----------
   A claude.ai artifact never shows confirm()/prompt() (they return false/null at once), so there the
   question is asked in a dialog on the page. Elsewhere the native dialog is kept as it always was. */
function _askDialog(message, okLabel, typed){
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'ask-overlay';
    wrap.innerHTML = '<div class="ask" role="dialog" aria-modal="true"><p class="ask-msg"></p>'
      + (typed ? '<label class="fld">Type ' + esc(typed) + ' to confirm<input type="text" id="askTyped" autocomplete="off"></label>' : '')
      + '<div class="ask-actions"><button type="button" class="ghost" id="askCancel">Cancel</button><button type="button" class="primary" id="askOk"></button></div></div>';
    wrap.querySelector('.ask-msg').textContent = message;
    const ok = wrap.querySelector('#askOk'); ok.textContent = okLabel || 'OK';
    const input = wrap.querySelector('#askTyped');
    if (input){ ok.disabled = true; input.addEventListener('input', () => { ok.disabled = input.value.trim() !== typed; }); }
    const done = v => { document.removeEventListener('keydown', onKey); wrap.remove(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    wrap.querySelector('#askCancel').addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    document.body.appendChild(wrap);
    (input || ok).focus();
  });
}
function confirmDialog(message, okLabel){
  if (STORE_BACKEND !== 'claude') return Promise.resolve(confirm(message));
  return _askDialog(message, okLabel, null);
}
function typedConfirm(message, word){
  if (STORE_BACKEND !== 'claude') return Promise.resolve(prompt(message + '\nType ' + word + ' to confirm.') === word);
  return _askDialog(message, word === 'DELETE' ? 'Erase everything' : 'Confirm', word);
}

/* ---------- claude.ai artifact: file saves and first run ---------- */
async function saveViaClaude(content, name){
  const dl = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null;
  if (!dl){ toast('Saving files isn’t available in this view'); return; }
  try { await dl.save({ filename: name, data: content instanceof Blob || typeof content === 'string' ? content : new Blob([content]) }); }
  catch (e) { if (e && e.code !== 'declined') toast('Couldn’t save ' + name + ' (' + (e.code || e.message) + ')'); }
}
function showFirstRun(){
  const host = document.querySelector('main') || document.body;
  if (document.getElementById('firstRun')) return;
  const box = document.createElement('section');
  box.id = 'firstRun'; box.className = 'first-run';
  box.innerHTML = '<h2>Load your data</h2><p>This dashboard starts empty. Your records are kept privately in your Claude account — no one you share the link with can see them.</p>'
    + '<p>Choose your latest <b>portfolio-ledger_backup_…json</b> (from <i>Export &amp; data → Backup JSON</i> in Cowork, or <code>node app/tools/state.js export</code> on your Mac).</p>'
    + '<div class="ask-actions"><label class="btn-like primary">Choose backup file<input type="file" id="firstRunFile" accept=".json" hidden></label>'
    + '<button type="button" class="ghost" id="firstRunDismiss">Start empty</button></div>';
  host.prepend(box);
  box.querySelector('#firstRunFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    await restoreJson(f);
    if (Object.keys(DOC.stores.transactions).length){ applyInSpecieFix(); box.remove(); }
  });
  box.querySelector('#firstRunDismiss').addEventListener('click', () => box.remove());
}
function applyClaudeMode(){
  if (STORE_BACKEND !== 'claude') return;
  ['pdfBtn', 'resetBtn'].forEach(id => { const b = document.getElementById(id); if (b) b.hidden = true; });   // no print dialog; no bundled data to reset to
  document.querySelectorAll('.hint').forEach(h => { if (/saved on this device automatically/.test(h.textContent)) h.textContent = 'Everything is saved to your Claude account automatically. Exports respect the current owner filter.'; });
}
