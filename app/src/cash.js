/* cash.js — bank statements → cash on hand, and dividend capture into the Portfolio Ledger.
   CSV and XLSX are read in the browser; bank PDFs are scanned images, so they go through Claude. */
const CAT_LABEL = { dividend: 'Dividend', settlement: 'Share settlement', payout: 'Payout to shareholder', fee: 'Fees', interest: 'Interest', transfer: 'Transfer', other: 'Other' };

const PDF_TASK_ID = 'ok-bank-statement-pdfs';   // Cowork scheduled task that converts new bank PDFs

/* ---------- statement inbox (Statements/Bank, embedded at build time) ---------- */
function inboxEntries(){
  const el = document.getElementById('inbox'); if (!el) return [];
  try { const j = JSON.parse(el.textContent); return Array.isArray(j.files) ? j.files : []; } catch (e) { return []; }
}
function inboxBuiltAt(){ const el = document.getElementById('inbox'); try { return JSON.parse(el.textContent).builtAt || null; } catch (e) { return null; } }
// Loads every reconciled statement line not already stored. Keys make it idempotent, so it runs on
// every open and only ever adds what is new.
function importInbox(){
  const seen = new Set(Object.keys(DOC.stores.cash || {})), fresh = [], now = new Date().toISOString();
  inboxEntries().filter(f => f.status === 'ok' && f.text).forEach(f => {
    let p; try { p = parseBankStatement(parseCSV(f.text)); } catch (e) { console.warn('inbox ' + f.source, e); return; }
    if (!p.format) return;
    p.lines.forEach(l => { if (seen.has(l.key)) return; seen.add(l.key); fresh.push(Object.assign({}, l, { importedAt: now, source: f.source })); });
  });
  if (fresh.length) sBulkAdd('cash', fresh);
  return fresh.length;
}
function renderStmtFiles(){
  const host = document.getElementById('stmtFiles'); if (!host) return;
  const files = inboxEntries(), stored = cashLines();
  const btn = document.getElementById('pdfProcessBtn');
  if (btn) btn.hidden = !canProcessPdfs();
  if (!files.length){ host.innerHTML = '<div class="hint">No statements found in the folder yet.</div>'; return; }
  const built = inboxBuiltAt();
  host.innerHTML = '<div class="scroll"><table class="tbl"><thead><tr><th>File</th><th>Read as</th><th>Period</th><th class="num">Lines</th><th class="num">Closing balance</th><th>Status</th></tr></thead><tbody>'
    + files.map(f => {
      const mine = stored.filter(l => l.source === f.source);
      const ds = mine.map(l => l.date).sort();
      const period = f.from ? f.from + ' to ' + f.to : ds.length ? ds[0] + ' to ' + ds[ds.length - 1] : '—';
      const n = f.lines != null ? f.lines : mine.length;
      const how = f.kind === 'pdf' ? (/reviewed/.test(f.method || '') ? 'PDF · checked by hand' : f.method === 'text' ? 'PDF text' : 'PDF scan (OCR)') : 'CSV';
      const status = f.status === 'ok'
        ? `<span class="status ok">${f.kind === 'pdf' ? 'Reconciled · loaded' : 'Loaded'}</span>`
        : `<span class="status attn">Needs review</span><div class="hint">${esc((f.issues || []).slice(0, 3).join(' · '))}${(f.issues || []).length > 3 ? ' …' : ''}</div>`;
      return `<tr><td>${esc(f.source)}</td><td>${how}</td><td>${esc(period)}</td><td class="num">${n == null ? '—' : n}</td><td class="num">${f.closing != null ? fmtSGD(f.closing) : ''}</td><td>${status}</td></tr>`;
    }).join('') + '</tbody></table></div>'
    + (built ? `<div class="hint" style="margin-top:6px">Folder last read ${esc(new Date(built).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}. Statements that don't reconcile are never loaded — the background run asks Claude to check them against the scan first.</div>` : '');
}
// PDFs can be processed when the page is served locally (app/server.js runs the converter) or in
// Cowork (a Cowork task does it). A plain file opened from disk can't.
function canProcessPdfs(){ return STORE_BACKEND === 'file' || !!(window.cowork && typeof window.cowork.runScheduledTask === 'function'); }
async function processPdfsNow(){
  if (STORE_BACKEND === 'file'){
    toast('Reading bank statements in Statements/Bank…');
    try {
      const r = await fetch('/api/bank/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      const msg = document.getElementById('cashImportMsg');
      const review = j.needsReview || [];
      if (msg) msg.textContent = (j.changed ? 'Statements read. ' : 'No new PDFs. ') + (review.length ? review.length + ' need review (' + review.join(', ') + ') — in Claude Code ask: "process the bank PDFs".' : '');
      if (j.changed){ toast('Statements read — reloading to load the new lines'); setTimeout(() => location.reload(), 1200); }
      else toast(review.length ? review.length + ' statement(s) need review in Claude Code' : 'No new PDFs in Statements/Bank');
    } catch (e) { toast('Couldn’t read the PDFs: ' + e.message + ' (needs python3, tesseract and poppler — see app/CLAUDE.md)'); }
    return;
  }
  if (!canProcessPdfs()){ toast('Open the dashboard with npm start (Claude Code) or in Cowork to read PDFs'); return; }
  try { await window.cowork.runScheduledTask(PDF_TASK_ID); toast('Reading new statements in the background — reopen the dashboard in a few minutes'); }
  catch (e) { toast('Couldn’t start the background run: ' + e.message); }
}

function cashLines(){ return Object.values(DOC.stores.cash || {}); }
function cashTotalForLedger(){
  const lines = cashLines(); if (!lines.length) return null;
  const c = cashPositions(lines); return c.accounts.length ? { total: c.total, asOf: c.asOf, accounts: c.accounts } : null;
}
function learnedDivMap(){
  const m = {}; Object.values(DOC.stores.maps || {}).forEach(r => { if (String(r.key).startsWith('div:')) m[r.key.slice(4)] = r.value; }); return m;
}
function _divCands(){ return dividendCandidates(cashLines(), G.txns, learnedDivMap()); }
function _holderOn(tk, date){
  for (const o of OWNERS){
    const pos = computePositions(G.txns.filter(t => t.owner === o && String(t.ticker || '').toUpperCase() === tk), { asOf: date });
    if (pos.some(p => p.qtyHeld > 1e-6)) return o;
  }
  return OWNERS[0];
}
function _equityName(tk){ const t = [...G.txns].reverse().find(x => String(x.ticker || '').toUpperCase() === tk && x.equity); return t ? t.equity : tk; }

async function importRows(rows, filename){
  const parsed = parseBankStatement(rows);
  if (!parsed.format) throw new Error('Format not recognised — no Date / Deposit / Withdrawal header found in ' + filename);
  if (!parsed.lines.length) throw new Error('No dated transaction lines found in ' + filename);
  const now = new Date().toISOString(), fresh = [];
  let skipped = 0;
  const seen = new Set(Object.keys(DOC.stores.cash || {}));
  parsed.lines.forEach(l => {
    if (seen.has(l.key)){ skipped++; return; }
    seen.add(l.key); fresh.push(Object.assign({}, l, { importedAt: now, source: filename }));
  });
  if (fresh.length){ await sBulkAdd('cash', fresh); markDirty(); }
  const res = { added: fresh.length, skipped, lines: parsed.lines.length, account: parsed.account || parsed.accountName || '' };
  renderCash(); renderCashKpi();
  const msg = document.getElementById('cashImportMsg');
  if (msg) msg.textContent = filename + ': ' + res.added + ' new line' + (res.added === 1 ? '' : 's') + (res.skipped ? ', ' + res.skipped + ' already loaded' : '') + (parsed.from ? ' · ' + parsed.from + ' to ' + parsed.to : '');
  return res;
}
async function importStatementText(text, filename){ return importRows(parseCSV(text), filename || 'statement.csv'); }
async function importStatementFile(file){
  const name = file.name || 'statement', low = name.toLowerCase();
  document.getElementById('pdfHandoff').hidden = true;
  try {
    let res;
    if (low.endsWith('.pdf') || file.type === 'application/pdf'){ showPdfHandoff(name); return { handoff: true }; }
    if (low.endsWith('.xlsx')) res = await importRows(await xlsxToRows(await readFileBuffer(file)), name);
    else if (low.endsWith('.csv') || low.endsWith('.txt') || /text|csv/.test(file.type || '')) res = await importStatementText(await readFileText(file), name);
    else throw new Error('Use CSV, XLSX or PDF (' + name + ')');
    toast(res.added ? res.added + ' statement lines added' : 'Nothing new — this statement is already loaded');
    return res;
  } catch (e) { toast(e.message); const m = document.getElementById('cashImportMsg'); if (m) m.textContent = e.message; return { error: e.message }; }
}
function showPdfHandoff(name){
  const req = 'Please read the bank statement PDF "' + name + '" (in Statements/Bank of the Ong Kim Investment folder) for Ong & Kim Family Trust Pte Ltd: '
    + 'run app/tools/bank_pdf_to_csv.py, check any lines it flags against the scan, rebuild the dashboard and update the ong-kim-family-office artifact.';
  const known = inboxEntries().find(f => f.source === name);
  const h = document.getElementById('pdfHandoff');
  h.hidden = false;
  h.innerHTML = known && known.status === 'ok'
    ? `<b>${esc(name)}</b> has already been read from the Statements/Bank folder — its lines are loaded below.`
    : `<b>${esc(name)}</b> is a PDF, which is read in the background rather than in this page. Save it into <b>Statements/Bank</b> in the Ong Kim Investment folder, then press <i>Process new PDFs now</i>. Its lines appear here the next time the dashboard opens.
    <div class="actions" style="margin-top:8px"><button type="button" class="primary" id="pdfRunNow">Process new PDFs now</button><button type="button" class="ghost" id="pdfCopy">Copy a request for Claude instead</button><button type="button" class="ghost" id="pdfClose">Dismiss</button></div>`;
  const run = h.querySelector('#pdfRunNow'); if (run){ run.hidden = !canProcessPdfs(); run.addEventListener('click', processPdfsNow); }
  const cp = h.querySelector('#pdfCopy'); if (cp) cp.addEventListener('click', async () => { try { await navigator.clipboard.writeText(req); toast('Request copied — paste it to Claude'); } catch (e) { toast(req); } });
  const cl = h.querySelector('#pdfClose'); if (cl) cl.addEventListener('click', () => { h.hidden = true; });
}
function renderCash(){
  const lines = cashLines(), tot = cashTotalForLedger();
  const cands = lines.length ? _divCands() : [];
  const { start, end } = periodBounds(state.fy, state.basis);
  const inPer = cands.filter(c => c.date >= start && c.date <= end);
  const pending = cands.filter(c => c.status !== 'dup');
  const dates = lines.map(l => l.date).sort();
  document.getElementById('cashKpis').innerHTML = kpiHtml([
    { label: 'Cash on hand', value: tot ? fmtSGD(tot.total) : '—', sub: tot ? (tot.accounts.length > 1 ? tot.accounts.length + ' accounts' : 'account ' + (tot.accounts[0].account || '')) : 'upload a bank statement' },
    { label: 'As at', value: tot ? tot.asOf : '—', sub: dates.length ? 'statements cover ' + dates[0] + ' to ' + dates[dates.length - 1] : '' },
    { label: 'Dividends received · ' + periodLabel(state.fy, state.basis), value: fmtSGD(inPer.reduce((s, c) => s + c.amount, 0)), sub: inPer.length + ' credit' + (inPer.length === 1 ? '' : 's') + ' in the bank' },
    { label: 'Pending review', value: String(pending.length), sub: pending.length ? 'dividends not yet in the ledger' : 'all dividends in the ledger', cls: pending.length ? 'warn' : '' }
  ]);
  renderDivReview(cands);
  renderCashLines(lines);
  renderStmtFiles();
}
function renderDivReview(cands){
  const body = document.getElementById('divReviewBody');
  const tickers = [...new Set(G.txns.map(t => String(t.ticker || '').toUpperCase()).filter(Boolean))].sort();
  const list = [...cands].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (!list.length){ body.innerHTML = '<tr><td colspan="7" class="empty">No dividend credits in the loaded statements.</td></tr>'; document.getElementById('divCommitBtn').disabled = true; return; }
  body.innerHTML = list.map(c => {
    let first = '', tick = esc(c.ticker || ''), owner = '', status;
    if (c.status === 'dup'){ status = '<span class="status ok">Already in ledger</span>'; owner = '<span class="muted">—</span>'; }
    else if (c.status === 'new'){
      first = `<input type="checkbox" data-pick="${esc(c.key)}" aria-label="Add this dividend">`;
      const h = _holderOn(c.ticker, c.date);
      owner = `<select data-owner="${esc(c.key)}">${OWNERS.map(o => `<option${o === h ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      status = '<span class="status new">New</span>';
    } else {
      tick = `<select data-map="${esc(c.key)}" data-payer="${esc(c.payer)}"><option value="">Choose ticker…</option>${tickers.map(t => `<option>${esc(t)}</option>`).join('')}</select>`;
      status = '<span class="status attn">Choose ticker</span>';
    }
    return `<tr data-key="${esc(c.key)}"><td>${first}</td><td>${esc(c.date)}</td><td>${esc(c.payer)}</td><td class="mono">${tick}</td><td class="num">${fmtSGD(c.amount)}</td><td>${owner}</td><td>${status}</td></tr>`;
  }).join('');
  const btn = document.getElementById('divCommitBtn');
  const sync = () => { btn.disabled = !body.querySelector('input[data-pick]:checked'); };
  body.querySelectorAll('input[data-pick]').forEach(i => i.addEventListener('change', sync)); sync();
  body.querySelectorAll('select[data-map]').forEach(s => s.addEventListener('change', async () => {
    if (!s.value) return;
    await sPut('maps', { key: 'div:' + normName(s.dataset.payer), value: s.value });
    toast(s.dataset.payer + ' → ' + s.value + ' (remembered)'); renderCash();
  }));
}
function renderCashLines(lines){
  const f = document.getElementById('cashCatFilter').value;
  const list = lines.filter(l => !f || l.category === f)
    .sort((a, b) => { const x = a.date + (a.time || ''), y = b.date + (b.time || ''); return x < y ? 1 : x > y ? -1 : (b.seq || 0) - (a.seq || 0); });
  document.getElementById('cashLinesBody').innerHTML = list.length ? list.slice(0, 1000).map(l => `<tr>
    <td>${esc(l.date)}</td><td class="mono">${esc(l.account)}</td>
    <td>${esc(l.description)}${l.remarks || l.ref ? `<div class="hint">${esc([l.ref, l.remarks].filter(Boolean).join(' · '))}</div>` : ''}</td>
    <td><span class="status${l.category === 'dividend' ? ' ok' : l.category === 'payout' ? ' attn' : ''}">${esc(CAT_LABEL[l.category] || l.category)}</span></td>
    <td class="num">${l.withdrawal ? fmtSGD(l.withdrawal) : ''}</td><td class="num">${l.deposit ? fmtSGD(l.deposit) : ''}</td>
    <td class="num">${l.balance != null ? fmtSGD(l.balance) : ''}</td></tr>`).join('')
    : '<tr><td colspan="7" class="empty">' + (lines.length ? 'No lines in this category.' : 'No statements loaded yet.') + '</td></tr>';
}
async function commitDividends(keys){
  const want = new Set(keys || []);
  const picks = _divCands().filter(c => want.has(c.key) && c.status === 'new' && c.ticker);
  if (!picks.length){ toast('Nothing to add'); return 0; }
  const recs = picks.map(c => {
    const sel = [...document.querySelectorAll('#divReviewBody select[data-owner]')].find(s => s.dataset.owner === c.key);
    return { type: 'DIVIDEND', date: c.date, owner: sel ? sel.value : _holderOn(c.ticker, c.date), equity: _equityName(c.ticker), ticker: c.ticker,
      dividend: c.amount, currency: 'SGD', note: 'Bank ' + c.date + ' ' + c.payer };
  });
  await sBulkAdd('transactions', recs);
  await loadAll(); renderAll(); markDirty(); renderCash();
  toast(recs.length + ' dividend' + (recs.length === 1 ? '' : 's') + ' added to the ledger');
  return recs.length;
}
document.getElementById('divCommitBtn').addEventListener('click', () => {
  const keys = [...document.querySelectorAll('#divReviewBody input[data-pick]:checked')].map(i => i.dataset.pick);
  commitDividends(keys);
});
document.getElementById('pdfProcessBtn').addEventListener('click', processPdfsNow);
document.getElementById('cashCatFilter').addEventListener('change', () => renderCashLines(cashLines()));
document.getElementById('cashFile').addEventListener('change', e => { if (e.target.files[0]) importStatementFile(e.target.files[0]); e.target.value = ''; });
(() => {
  const dz = document.getElementById('cashDrop');
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) importStatementFile(f); });
})();
