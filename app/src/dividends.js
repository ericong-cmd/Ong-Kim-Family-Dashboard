/* dividends.js — declared dividends. Where the page reaches the IBKR connector (Cowork, claude.ai
   artifact) it checks once a day on open, or on "Check now": each held counter's corporate actions →
   entitlement at the close of the day before XD, per owner → booked as a DIVIDEND on the XD date
   (payment date kept for the bank match). Locally (npm start) the check-dividends skill does the same
   through app/tools/dividends.js; either way the upcoming list lives in meta.dividendWatch. */
const DIV_SINCE_DAYS = 60;
function dividendTickers(txns, today){
  const from = prevDay(new Date(Date.parse(today) - DIV_SINCE_DAYS * 86400000).toISOString().slice(0, 10));
  const set = new Set();
  [from, today].forEach(d => computePositions(txns, { asOf: d }).forEach(p => { if (p.qtyHeld > 1e-6 && (p.currency || 'SGD') === 'SGD') set.add(String(p.ticker).toUpperCase()); }));
  txns.filter(t => t.date > from && (t.type === 'SELL' || t.type === 'BUY')).forEach(t => set.add(String(t.ticker || '').toUpperCase()));
  return [...set].filter(Boolean).sort();
}
let _divChecking = false;
async function autoCheckDividends(force){
  await bridgeReady();
  if (!hasBridge() || _divChecking || !G.txns.length){ renderDividendWatch(); return { skipped: !G.txns.length ? 'no ledger' : 'no connector' }; }
  const today = sgtParts(Date.now()).date;
  const last = (DOC.stores.meta.dividendWatch || {}).checkedAt;
  if (!force && last && sgtParts(Date.parse(last)).date === today){ renderDividendWatch(); return { skipped: 'checked today' }; }
  _divChecking = true; setDivBusy(true);
  const raw = {}, fail = [];
  try {
    for (const tk of dividendTickers(G.txns, today)){
      try {
        const cid = await contractFor(tk); if (!cid) throw new Error('no SGX listing');
        const h = await ibkr('get_price_history', { contract_id: cid, security_type: 'STK', exchange: 'SGX', step: 'ONE_MONTH', period: 'ONE_YEAR', outside_rth: false, include_corporate_actions: true });
        raw[tk] = (h && h.corp_actions) || [];
      } catch (e) { fail.push(tk + ' (' + e.message + ')'); }
    }
    const ents = dividendEntitlements(G.txns, normaliseCorpActions(raw), { today, sinceDays: DIV_SINCE_DAYS });
    const recs = dividendRecords(ents);
    for (const r of recs) await sAdd('transactions', r);
    await sPut('meta', { key: 'dividendWatch', value: ents.filter(e => e.status === 'upcoming'), checkedAt: new Date().toISOString(),
      booked: recs.map(r => ({ ticker: r.ticker, owner: r.owner, xd: r.date, amount: r.dividend })), failed: fail });
    if (recs.length){ await loadAll(); renderAll(); if (typeof renderCurrentPage === 'function') renderCurrentPage(); }
    renderDividendWatch();
    if (recs.length) toast('Booked ' + recs.length + ' declared dividend' + (recs.length === 1 ? '' : 's') + ' (' + fmtSGD(recs.reduce((s, r) => s + r.dividend, 0)) + ')');
    else if (force) toast('Dividends checked — nothing new to book' + (fail.length ? '; failed: ' + fail.length : ''));
    return { booked: recs.length, failed: fail };
  } finally { _divChecking = false; setDivBusy(false); }
}
function setDivBusy(on){ const b = document.getElementById('divCheckBtn'); if (b){ b.disabled = !!on; b.textContent = on ? 'Checking…' : 'Check now (IBKR)'; } }
function renderDividendWatch(){
  const host = document.getElementById('divList'); if (!host) return;
  const w = DOC.stores.meta.dividendWatch || {};
  const hint = document.getElementById('divHint');
  if (hint) hint.textContent = w.checkedAt ? 'Last checked ' + _hm(w.checkedAt) + (hasBridge() ? ' · checks once a day when the dashboard opens' : ' · run the check-dividends skill to update')
    : (hasBridge() ? 'Not checked yet' : 'Run the check-dividends skill in Claude Code to check for declared dividends');
  const up = (w.value || []).slice().sort((a, b) => a.xd < b.xd ? -1 : 1);
  const booked = (w.booked || []);
  const row = e => `<tr><td>${esc(e.equity || e.ticker)} <span class="muted mono">${esc(e.ticker)}</span></td><td>${esc(e.owner)}</td>
    <td>${esc(e.xd)}</td><td>${esc(e.pay || '—')}</td><td class="num">${esc(String(e.dps))}</td><td class="num">${fmtQty(e.qty)}</td><td class="num">${fmtSGD(e.amount)}</td></tr>`;
  host.innerHTML = (up.length ? `<div class="scroll"><table><thead><tr><th>Upcoming</th><th>Owner</th><th>XD</th><th>Payable</th><th class="num">Per share</th><th class="num">Shares</th><th class="num">Estimate</th></tr></thead><tbody>${up.map(row).join('')}</tbody></table></div>`
      : '<div class="muted">No declared dividends with an XD date ahead.</div>')
    + (booked.length ? '<div class="hint" style="margin-top:8px">Booked at the last check: ' + booked.map(b => esc(b.ticker) + ' ' + esc(b.xd) + ' ' + fmtSGD(b.amount)).join(' · ') + '</div>' : '')
    + ((w.failed || []).length ? '<div class="hint warn" style="margin-top:6px">Could not check: ' + esc(w.failed.join(', ')) + '</div>' : '');
}
