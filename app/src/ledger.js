const OWNERS = ['Ong & Kim Family Trust','Ong Ah Whatt'];
// IBKR contract IDs for the SGX tickers in this portfolio, so a price request names the exact
// instrument (several tickers collide with foreign listings). Extend as new holdings appear.
const IBKR_CONTRACTS = {
  BN4:92216592, O10:92216565, S08:92215134, HMN:397181494, V03:15785535, '1D0':269821774,
  U10:47956044, '8C8U':816850991, J69U:117901249, '42E':201591872, F9D:92216727, '43F':230420176,
  '5E2':701477872, K71U:117901238, UIBU:862405968, C52:38558065, G13:320989025, TQ5:141614718,
  M01:92216570
};
const G = { txns:[], prices:{}, boundaries:{}, histPrices:{} };   // caches
const state = { owner:'ALL', basis:'FY', fy: fyEndYear(todayISO()), sortKey:'name', sortDir:1, recentFilter:'', editingId:null };

/* ---------- changes since last backup ----------
   Every edit is saved on this device automatically (store.js). This only counts how far the last
   Backup JSON file has fallen behind, so an off-device copy can be refreshed now and then. */
let unsavedCount = 0;
function markDirty(){
  unsavedCount++;
  if(typeof updateMiniBar==='function') try{ updateMiniBar(); }catch(e){}
  const b=document.getElementById('jsonBtn');
  if(b) b.textContent = 'Backup JSON ('+unsavedCount+' change'+(unsavedCount>1?'s':'')+' since last backup)';
}
function markClean(){
  unsavedCount=0;
  if(typeof updateMiniBar==='function') try{ updateMiniBar(); }catch(e){}
  const b=document.getElementById('jsonBtn');
  if(b) b.textContent = 'Backup JSON (whole ledger)';
}

/* ---------- formatting ---------- */
const sgd0 = new Intl.NumberFormat('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2});
function fmtSGD(x){ if(x==null||!isFinite(x)) return '—'; const s=sgd0.format(Math.abs(x)); return (x<0?'−S$':'S$')+s; }
function fmtSGDsign(x){ if(x==null||!isFinite(x)) return '—'; const s=sgd0.format(Math.abs(x)); return (x<0?'−S$':'+S$')+s; }
function fmtNum(x,dp){ dp=dp==null?2:dp; if(x==null||!isFinite(x)) return '—'; return Number(x).toLocaleString('en-SG',{minimumFractionDigits:dp,maximumFractionDigits:dp}); }
function fmtQty(x){ if(x==null||!isFinite(x)) return '—'; return Number(x).toLocaleString('en-SG',{maximumFractionDigits:4}); }
function fmtPct(x){ if(x==null||!isFinite(x)) return 'n/a'; return (x*100).toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'; }
function signClass(x){ return x>1e-9?'pos':(x<-1e-9?'neg':''); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2600); }

/* Storage (sAll / sPut / sAdd / sDel / sClear / sBulkAdd) lives in store.js. */

// File reads that work everywhere: Blob.text()/arrayBuffer() where available, FileReader otherwise.
function readFileText(file){
  if(file && typeof file.text==='function') return file.text();
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result)); r.onerror=()=>rej(r.error); r.readAsText(file); });
}
function readFileBuffer(file){
  if(file && typeof file.arrayBuffer==='function') return file.arrayBuffer();
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(r.error); r.readAsArrayBuffer(file); });
}

function pricesMap(){ const m={}; Object.values(G.prices).forEach(p=>{ if(p&&p.price!=null&&p.price!=='') m[p.ticker]=Number(p.price); }); return m; }
function boundaryKey(owner,fy,basis){ return owner+'__'+(basis||state.basis)+'__'+fy; }

async function loadAll(){
  const [tx,pr,bd,hp]=await Promise.all([sAll('transactions'),sAll('prices'),sAll('boundaries'),sAll('histprices')]);
  G.txns=tx;
  G.prices={}; pr.forEach(p=>G.prices[p.ticker]=p);
  G.boundaries={}; bd.forEach(b=>G.boundaries[b.key]=b);
  G.histPrices={}; hp.forEach(h=>{ (G.histPrices[h.date]=G.histPrices[h.date]||{})[h.ticker]=h.price; });
}

/* ---------- scope helpers ---------- */
function scopedTxns(){ return state.owner==='ALL'?G.txns:G.txns.filter(t=>t.owner===state.owner); }
function scopedPositions(){
  return computePositions(scopedTxns())
    .filter(p=> Math.abs(p.qtyHeld)>1e-6 || Math.abs(p.realised)>1e-9 || Math.abs(p.dividends)>1e-9)
    .sort((a,b)=> (a.name||'').localeCompare(b.name||''));
}
// The holdings view for the selected period. A COMPLETED year is shown as a snapshot at its year-end:
// positions as they stood on the last day, valued at that day's close (from stored history). The
// current, still-running year is shown as it stands today at live prices. This is what makes the
// "current price" follow the selected year — it is the close on that year's last date.
function periodView(){
  const {start,end}=periodBounds(state.fy,state.basis);
  const done = end<=todayISO();
  const asOf = done?end:todayISO();
  const priceMap = done ? (G.histPrices[end]||{}) : pricesMap();
  const positions = computePositions(scopedTxns(),{asOf})
    .filter(p=> Math.abs(p.qtyHeld)>1e-6 || Math.abs(p.realised)>1e-9 || Math.abs(p.dividends)>1e-9)
    .sort((a,b)=> (a.name||'').localeCompare(b.name||''));
  return {done,asOf,end,priceMap,positions};
}

/* ---------- render: filters ---------- */
function populateOwner(){
  const sel=document.getElementById('ownerFilter');
  if(sel.dataset.built) { sel.value=state.owner; return; }
  sel.innerHTML='<option value="ALL">All owners</option>'+OWNERS.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('');
  sel.value=state.owner; sel.dataset.built='1';
  // owner select in the form
  const fo=document.getElementById('f_owner');
  fo.innerHTML=OWNERS.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('');
}
function populateFY(){
  const B=state.basis;
  const years=new Set([periodKey(todayISO(),B)]);
  G.txns.forEach(t=>years.add(periodKey(t.date,B)));
  const arr=[...years];
  const min=Math.min(...arr), max=Math.max(...arr);
  const full=[]; for(let y=max;y>=min;y--) full.push(y);
  if(!full.includes(state.fy)) state.fy=full[0];
  const sel=document.getElementById('fyFilter');
  sel.innerHTML=full.map(y=>`<option value="${y}">${periodLabel(y,B)}</option>`).join('');
  sel.value=state.fy;
  document.getElementById('basisFilter').value=B;
  document.getElementById('periodLbl').textContent = B==='CY'?'Calendar year':'Financial year';
  document.getElementById('openLbl').textContent = periodOpenLabel(B);
  document.getElementById('closeLbl').textContent = periodCloseLabel(B);
}
// Switching basis re-keys the selected period so the view stays on the same calendar moment.
function setBasis(newBasis){
  const B=newBasis==='CY'?'CY':'FY';
  if(B===state.basis) return;
  const {end}=periodBounds(state.fy,state.basis);
  state.basis=B;
  state.fy=periodKey(end,B);
  populateFY(); renderFY(); renderHoldings(); renderYearStrip();
}

/* ---------- render: summary + holdings ---------- */
// Realised P/L and dividends attributed to the SELECTED period only (the year the sale/dividend fell
// in), so the holdings table matches the return panel. Using cumulative-to-date here would repeat a
// prior year's realised gain in every later year's view — the opposite of what a period view should show.
function periodRealised(p){ return ((state.basis==='CY'?p.realisedByCY:p.realisedByFY)||{})[state.fy]||0; }
function periodDividends(p){ return ((state.basis==='CY'?p.dividendsByCY:p.dividendsByFY)||{})[state.fy]||0; }
// KPI cards: one number per card, with a context line underneath (label / value / context).
function setKpi(id, value, cls, subId, sub){
  const v=document.getElementById(id); if(v){ v.textContent=value; v.className='kpi-v'+(cls?' '+cls:''); }
  if(subId){ const s=document.getElementById(subId); if(s) s.textContent=sub||''; }
}
function renderSummary(pos, pm, valLabel){
  const per=periodLabel(state.fy,state.basis);
  let mv=0,unreal=0,realAll=0,divAll=0,cost=0,priced=true,held=0;
  pos.forEach(p=>{ if((p.currency||'SGD')!=='SGD') return; realAll+=periodRealised(p); divAll+=periodDividends(p);
    const pr=pm[p.ticker];
    if(p.qtyHeld>1e-6){ held++; cost+=p.adjustedCost; if(pr!=null){ mv+=p.qtyHeld*pr; unreal+=p.qtyHeld*pr-p.adjustedCost; } else priced=false; } });
  const lbl=document.getElementById('kpiMVlbl'); if(lbl) lbl.textContent=valLabel||'Portfolio value';
  setKpi('kpiMV', fmtSGD(mv)+(priced?'':' *'), '', 'kpiMVsub', held+' holding'+(held===1?'':'s')+' · cost '+fmtSGD(cost)+(priced?'':' · * some unpriced'));
  setKpi('kpiUnreal', fmtSGDsign(unreal), signClass(unreal), 'kpiUnrealSub', cost>1e-9?fmtPct(unreal/cost)+' of cost':'');
  const rl=document.getElementById('kpiRealLbl'); if(rl) rl.textContent='Realised P/L · '+per;
  setKpi('kpiReal', fmtSGDsign(realAll), signClass(realAll), 'kpiRealSub', 'sales closed in the period');
  const dl=document.getElementById('kpiDivLbl'); if(dl) dl.textContent='Dividends · '+per;
  setKpi('kpiDiv', fmtSGD(divAll), '', 'kpiDivSub', mv>1e-9?fmtPct(divAll/mv)+' of current value':'');
  renderCashKpi();
}
// Cash on hand comes from the Cash on Hand tab (latest bank statement balance).
function renderCashKpi(){
  const c=(typeof cashTotalForLedger==='function')?cashTotalForLedger():null;
  if(c) setKpi('kpiCash', fmtSGD(c.total), '', 'kpiCashSub', 'bank balance as at '+c.asOf);
  else setKpi('kpiCash', '—', 'muted', 'kpiCashSub', 'Add a bank statement in Cash on Hand');
}
// Allocation by weight: the biggest positions as bars, the rest folded into one line.
function renderAllocation(rows, tMV){
  const host=document.getElementById('allocBody'); if(!host) return;
  const list=rows.filter(r=>r.sgd&&r.mv!=null&&r.mv>0).sort((a,b)=>b.mv-a.mv);
  if(!list.length||!(tMV>0)){ host.innerHTML='<div class="empty">Nothing held at the valuation date.</div>'; return; }
  const top=list.slice(0,6), rest=list.slice(6), max=top[0].mv;
  const bar=(label,sub,v,w)=>`<div class="alloc-row"><span class="alloc-name">${label}${sub?` <span class="tick">${sub}</span>`:''}</span>
    <span class="alloc-bar"><span style="width:${Math.max(2,Math.round(w*100))}%"></span></span><span class="alloc-pct">${fmtPct(v/tMV)}</span></div>`;
  host.innerHTML=top.map(r=>bar(esc(r.p.name),esc(r.p.ticker)+(state.owner==='ALL'&&r.p.owner!==OWNERS[0]?' · '+esc(r.p.owner.split(' ').map(w=>w[0]).join('')):''),r.mv,r.mv/max)).join('')
    +(rest.length?`<div class="alloc-row alloc-rest"><span class="alloc-name">${rest.length} more</span><span class="alloc-bar"></span><span class="alloc-pct">${fmtPct(rest.reduce((s,r)=>s+r.mv,0)/tMV)}</span></div>`:'');
}
function renderHoldings(){
  // Scope the table to the selected period: only equities the owner held at some point during it,
  // valued as the period stood (year-end close for a completed year, live prices for the current one).
  const heldSet=heldDuringPeriod(G.txns, state.owner, state.fy, state.basis);
  const view=periodView();
  const pos=view.positions.filter(p=>inPeriodView(p,heldSet));
  const pm=view.priceMap;
  renderSummary(pos, pm, view.done?('Value at '+view.end):'Market value');
  const cap=document.getElementById('holdingsCap');
  if(cap) cap.textContent = view.done
    ? `As at ${view.end} · valued at that day's close`
    : `Held during ${periodLabel(state.fy,state.basis)} · live prices`;
  const body=document.getElementById('holdingsBody');
  if(!pos.length){ body.innerHTML=`<tr><td colspan="11" class="empty">No holdings during ${periodLabel(state.fy,state.basis)}. Try another year, or add a transaction below.</td></tr>`; document.getElementById('holdingsFoot').innerHTML=''; document.getElementById('oversoldHint').style.display='none'; renderAllocation([],0); return; }

  // First pass: enrich every position once, so totals, weights and sorting all read the same numbers.
  let tCost=0,tMV=0,tUnreal=0,tReal=0,tDiv=0, anyOversold=false, anyForeign=false;
  const rows=pos.map(p=>{
    const pr=pm[p.ticker], held=p.qtyHeld>1e-6, sgd=(p.currency||'SGD')==='SGD';
    const mv=(held&&pr!=null)?p.qtyHeld*pr:null;
    const unreal=(mv!=null)?mv-p.adjustedCost:null;
    const unrealPct=(unreal!=null&&p.adjustedCost>1e-9)?unreal/p.adjustedCost:null;
    const rReal=periodRealised(p), rDiv=periodDividends(p);
    if(sgd){ tCost+=held?p.adjustedCost:0; if(mv!=null)tMV+=mv; if(unreal!=null)tUnreal+=unreal; tReal+=rReal; tDiv+=rDiv; }
    else anyForeign=true;
    if(p.oversold) anyOversold=true;
    return {p,pr,held,sgd,mv,unreal,unrealPct,rReal,rDiv};
  });
  rows.forEach(r=>{ r.wt=(r.sgd&&r.mv!=null&&tMV>1e-9)?r.mv/tMV:null; });
  renderAllocation(rows, tMV);

  // Sort by the clicked column (state.sortKey/sortDir); unpriced values sink to the bottom.
  const K=state.sortKey, D=state.sortDir;
  const keyOf=r=>({name:(r.p.name||'').toLowerCase(),owner:r.p.owner||'',qty:r.p.qtyHeld,cost:r.p.adjustedCost,
    avg:r.p.avgCost,price:r.pr==null?-Infinity*D:r.pr,mv:r.mv==null?-Infinity*D:r.mv,wt:r.wt==null?-Infinity*D:r.wt,
    unreal:r.unreal==null?-Infinity*D:r.unreal,real:r.rReal,div:r.rDiv}[K]);
  rows.sort((a,b)=>{ const x=keyOf(a),y=keyOf(b); return (x<y?-1:x>y?1:0)*D; });
  document.querySelectorAll('#holdingsTable thead th[data-sort]').forEach(th=>{
    th.classList.remove('s-asc','s-desc');
    if(th.dataset.sort===K) th.classList.add(D===1?'s-asc':'s-desc');
  });

  body.innerHTML=rows.map(r=>{
    const {p,pr,held,sgd,mv,unreal,unrealPct,rReal,rDiv,wt}=r;
    return `<tr data-k="${esc(p.owner+'|'+p.ticker)}" title="Click for lots, history and per-year figures"${sgd?'':' style="opacity:.7"'}>
      <td data-label="Equity">${esc(p.name)} ${p.ticker?`<span class="tick">${esc(p.ticker)}</span>`:''}${sgd?'':`<span class="badge">${esc(p.currency)}</span>`}${p.oversold?`<span class="badge warn">oversold</span>`:''}</td>
      <td data-label="Owner">${esc(p.owner)}</td>
      <td class="num" data-label="Qty">${held?fmtQty(p.qtyHeld):'—'}</td>
      <td class="num" data-label="Cost">${held?fmtSGD(p.adjustedCost):'—'}</td>
      <td class="num" data-label="Avg /sh">${held?fmtNum(p.avgCost,4):'—'}</td>
      <td class="num" data-label="Price">${pr!=null?fmtNum(pr,4):(held?`<a class="setprice" data-tk="${esc(p.ticker)}">set price</a>`:`<a class="setprice" data-tk="${esc(p.ticker)}" data-sold="1">set price</a>`)}</td>
      <td class="num" data-label="Mkt value">${mv!=null?fmtSGD(mv):'—'}</td>
      <td class="num" data-label="Wt %">${wt!=null?fmtPct(wt):'—'}</td>
      <td class="num ${unreal!=null?signClass(unreal):''}" data-label="Unreal. P/L">${unreal!=null?fmtSGDsign(unreal):'—'}${unrealPct!=null?`<span class="upct muted">${fmtPct(unrealPct)}</span>`:''}</td>
      <td class="num ${signClass(rReal)}" data-label="Realised (period)">${Math.abs(rReal)>1e-9?fmtSGDsign(rReal):'—'}</td>
      <td class="num" data-label="Divs (period)">${Math.abs(rDiv)>1e-9?fmtSGD(rDiv):'—'}</td>
    </tr>`;
  }).join('');
  document.getElementById('holdingsFoot').innerHTML=`<tr>
    <td data-label="Total">Total (SGD only)</td><td></td><td></td>
    <td class="num" data-label="Cost">${fmtSGD(tCost)}</td><td></td><td></td>
    <td class="num" data-label="Mkt value">${fmtSGD(tMV)}</td>
    <td class="num" data-label="Wt %">100.00%</td>
    <td class="num ${signClass(tUnreal)}" data-label="Unreal. P/L">${fmtSGDsign(tUnreal)}</td>
    <td class="num ${signClass(tReal)}" data-label="Realised">${fmtSGDsign(tReal)}</td>
    <td class="num" data-label="Divs">${fmtSGD(tDiv)}</td></tr>`;

  // Row click → drill-down with lots, per-year figures and full history. Links inside rows opt out.
  const posByK={}; pos.forEach(p=>posByK[p.owner+'|'+p.ticker]=p);
  body.querySelectorAll('tr[data-k]').forEach(tr=>{
    tr.addEventListener('click',ev=>{
      if(ev.target.closest('a')) return;
      const next=tr.nextElementSibling;
      if(next&&next.classList.contains('drill')){ next.remove(); return; }
      body.querySelectorAll('tr.drill').forEach(d=>d.remove());
      const p=posByK[tr.dataset.k]; if(!p) return;
      const d=document.createElement('tr'); d.className='drill';
      d.innerHTML=`<td colspan="11">${drillHtml(p)}</td>`;
      tr.after(d);
    });
  });
  body.querySelectorAll('a.setprice').forEach(a=>a.addEventListener('click',()=>focusPrice(a.dataset.tk, a.dataset.sold==='1')));

  const oh=document.getElementById('oversoldHint'); const notes=[];
  if(anyOversold) notes.push('⚠︎ An <b>oversold</b> position means a sale exceeded recorded holdings — usually a missing BUY or OPENING. Realised P/L for that equity is unreliable until you add the missing lot.');
  if(anyForeign) notes.push('Rows badged with a currency (MYR, HKD) are held in the ledger for the record but are <b>excluded from every SGD total and from all FY / XIRR figures</b>, since FX is out of scope.');
  oh.style.display = notes.length?'block':'none'; oh.innerHTML=notes.join('<br>');
}
// Per-holding drill-down: open FIFO lots as of the view date, realised & dividends by year, full history.
function drillHtml(p){
  const txns=G.txns.filter(t=>t.owner===p.owner&&(t.ticker||t.equity)===p.ticker).sort((a,b)=>a.date<b.date?-1:1);
  const lots=(p.lots||[]).filter(l=>l.qty>1e-9).map(l=>`<tr><td class="mono">${esc(l.date||'')}</td><td class="num">${fmtQty(l.qty)}</td><td class="num">${fmtNum(l.cps,4)}</td><td class="num">${fmtSGD(l.qty*l.cps)}</td></tr>`).join('');
  const byY=(m,f)=>Object.entries(m||{}).sort().map(([y,v])=>`<span class="pill">${state.basis} ${y}: ${f(v)}</span>`).join(' ')||'<span class="hint">none</span>';
  const hist=txns.map(t=>`<tr><td class="mono">${esc(t.date)}</td><td>${esc((t.type||'').replace('_',' '))}</td><td class="num">${detailOf(t)}</td></tr>`).join('');
  return `<div class="drillbox">
    <h4>Open lots (FIFO, as at the view date)</h4>
    ${lots?`<table><thead><tr><th>Acquired</th><th class="num">Qty</th><th class="num">Cost/sh</th><th class="num">Cost</th></tr></thead><tbody>${lots}</tbody></table>`:'<div class="hint">none — fully sold</div>'}
    <h4>Realised by year</h4><div>${byY(state.basis==='CY'?p.realisedByCY:p.realisedByFY,fmtSGDsign)}</div>
    <h4>Dividends by year</h4><div>${byY(state.basis==='CY'?p.dividendsByCY:p.dividendsByFY,fmtSGD)}</div>
    <h4>All transactions — ${p.owner} (${txns.length})</h4>
    <table><thead><tr><th>Date</th><th>Type</th><th class="num">Detail</th></tr></thead><tbody>${hist}</tbody></table>
  </div>`;
}
// Jump from a "set price" cell to the matching input in the prices panel (opening the sold-out fold if needed).
function focusPrice(tk, sold){
  if(sold){ const w=document.getElementById('soldWrap'); if(w) w.open=true; }
  const inp=document.querySelector(`#priceList input[data-tk="${tk}"], #soldPriceList input[data-tk="${tk}"]`);
  if(inp){ inp.scrollIntoView({behavior:'smooth',block:'center'}); setTimeout(()=>inp.focus(),350); }
  else toast('No price row for '+tk);
}

/* ---------- render: FY panel ---------- */
function currentBoundary(){ return G.boundaries[boundaryKey(state.owner,state.fy)]||{}; }
function renderFY(){
  const b=currentBoundary();
  const fy=computePeriod(G.txns, state.owner, state.fy, state.basis, {openingValue:b.openingValue, closingValue:b.closingValue, openingBasis:b.openingBasis}, pricesMap(), G.histPrices);
  const costMode = fy.openingBasis==='COST';
  document.getElementById('hlScope').textContent = (state.owner==='ALL'?'All owners':state.owner)+' · '+periodLabel(state.fy,state.basis)+(costMode?' · vs cost':'');
  const xr=document.getElementById('hlXirr'), dl=document.getElementById('hlDollar'), hint=document.getElementById('hlHint');
  if(fy.openingMissing){
    // Holdings existed at the opening date but no valuation was supplied. Treating opening as zero
    // would make the whole portfolio look like it appeared from nothing, so state nothing instead.
    xr.textContent='—'; xr.className='big muted';
    dl.textContent='opening value required'; dl.className='dollar muted';
    hint.textContent='enter the market value at '+fy.openingDate+', or switch to cost basis';
  } else if(costMode){
    // Measured against what the holdings cost, so this is cumulative gain since purchase — not
    // performance over this period. Plain ratio: annualising money committed years ago is meaningless.
    xr.textContent = fy.gainPct==null?'n/a':fmtPct(fy.gainPct);
    xr.className='big '+(fy.gainPct==null?'muted':signClass(fy.gainPct));
    dl.textContent=fmtSGDsign(fy.dollarReturn); dl.className='dollar '+signClass(fy.dollarReturn);
    hint.textContent='gain against cost · cumulative since purchase, not annualised';
  } else if(!fy.periodDone){
    // A year still in progress: show the ACTUAL return for the period so far, not an annualised
    // projection — annualising a few months multiplies noise into a number that looks like a year.
    xr.textContent = fy.periodPct==null?'n/a':fmtPct(fy.periodPct);
    xr.className='big '+(fy.periodPct==null?'muted':signClass(fy.periodPct));
    dl.textContent=fmtSGDsign(fy.dollarReturn); dl.className='dollar '+signClass(fy.dollarReturn);
    hint.textContent='actual return for the period to date · not annualised';
  } else {
    xr.textContent = fy.xirr==null?'n/a':fmtPct(fy.xirr);
    xr.className='big '+(fy.xirr==null?'muted':signClass(fy.xirr));
    dl.textContent=fmtSGDsign(fy.dollarReturn); dl.className='dollar '+signClass(fy.dollarReturn);
    hint.textContent='money-weighted, annualised'+(fy.periodPct!=null?' · '+fmtPct(fy.periodPct)+' for the period':'');
  }
  document.getElementById('hlFy').textContent=`${periodLabel(state.fy,state.basis)} · ${fy.start} to ${fy.closeDate}${fy.closeDate!==fy.end?' (year still running — valued to today)':''}`;
  renderStaleNote(); updateMiniBar(fy);

  // boundary inputs — the opening figure is derived on cost basis, so hide the manual box there
  const oi=document.getElementById('openingVal'), ci=document.getElementById('closingVal');
  document.getElementById('openBasisSel').value=fy.openingBasis;
  document.getElementById('openValFld').style.display = costMode?'none':'';
  document.getElementById('openLbl').textContent='Opening value · market close '+fy.openingDate;
  oi.value=(b.openingValue!=null&&b.openingValue!=='')?b.openingValue:'';
  ci.value=(b.closingValue!=null&&b.closingValue!=='')?b.closingValue:'';
  ci.placeholder = fy.closingIsLive? ('live: '+fmtSGD(fy.closingValue)) : 'live';

  // components — each boundary figure says where it came from, so entered vs derived is never a guess
  const openSrc={ENTERED:'entered by you',DERIVED:'derived from stored closes',COST:'from ledger cost',EMPTY:''}[fy.openingSource]||'';
  const closeSrc={ENTERED:'entered by you',HIST:'year-end close',LIVE:'live prices',LIVE_FALLBACK:'live (no year-end close stored)'}[fy.closingSource]||'';
  // Return bridge: opening → capital in and out → dividends → closing → return. Same figures as the
  // reconciliation line below, laid out as a flow so the result can be read at a glance.
  const step=(op,k,v,cls,sub)=>`<div class="bridge-row${cls?' '+cls:''}"><span class="b-op">${op}</span><span class="k">${k}${sub?`<span class="b-sub">${sub}</span>`:''}</span><span class="v">${v}</span></div>`;
  const out=[
    step('', costMode?'Opening cost':'Opening value', fmtSGD(fy.openingValue), 'bridge-anchor', (costMode?'holdings at cost, ':'market close ')+fy.openingDate+(openSrc?' · '+openSrc:'')),
    step('+', 'Buys', fmtSGD(fy.buys)),
  ];
  if(fy.introduced>0.005) out.push(step('+', 'Stock introduced', fmtSGD(fy.introduced), '', 'at cost'));
  out.push(step('−', 'Sells', fmtSGD(fy.sells), '', 'proceeds'));
  out.push(step('+', 'Dividends', fmtSGD(fy.dividends)));
  out.push(step('', 'Closing value', fmtSGD(fy.closingValue), 'bridge-anchor', (closeSrc||'')+(fy.closeDate?' · '+fy.closeDate:'')));
  out.push(step('=', costMode?'Gain vs cost':'Return', fmtSGDsign(fy.dollarReturn), 'bridge-total '+signClass(fy.dollarReturn)));
  out.push(`<div class="bridge-foot"><span>Net invested <b>${fmtSGDsign(fy.netInvested)}</b></span><span>Realised P/L <b class="${signClass(fy.realisedFY)}">${fmtSGDsign(fy.realisedFY)}</b></span></div>`);
  document.getElementById('fyComponents').innerHTML=out.join('');

  document.getElementById('reconLine').innerHTML = fy.openingMissing
    ? `You already held stock at ${fy.openingDate}, so this period's return can't be stated until you enter the <b>opening value</b> — the market value at the close of ${fy.openingDate}. Or switch the basis to <b>cost</b>, which the ledger can work out on its own. Market value now is <b>${fmtSGD(fy.closingValue)}</b>; realised P/L <b>${fmtSGDsign(fy.realisedFY)}</b> and dividends <b>${fmtSGD(fy.dividends)}</b> are unaffected either way.`
    : costMode
    ? `<b>Gain vs cost ${fmtSGDsign(fy.dollarReturn)}</b> = (value now ${fmtSGD(fy.closingValue)} − cost of holdings at ${fy.openingDate} ${fmtSGD(fy.openingValue)}) − buys ${fmtSGD(fy.buys)} + sells ${fmtSGD(fy.sells)} + dividends ${fmtSGD(fy.dividends)}. <span class="muted">This is gain accumulated since purchase, not performance over ${periodLabel(state.fy,state.basis)} — switch to market value for a period return.</span>`
    : `<b>Dollar return ${fmtSGDsign(fy.dollarReturn)}</b> = (closing ${fmtSGD(fy.closingValue)} − opening ${fmtSGD(fy.openingValue)}) − buys ${fmtSGD(fy.buys)}${fy.introduced>0.005?' − stock introduced '+fmtSGD(fy.introduced):''} + sells ${fmtSGD(fy.sells)} + dividends ${fmtSGD(fy.dividends)}`
      + (fy.openingSource==='DERIVED'?` <span class="muted">Opening derived from ${fy.openingDate} closes × quantity held.</span>`:'');

  const ln=document.getElementById('liveNote');
  if(fy.periodDone && !costMode && !fy.openingMissing && fy.xirr==null){ ln.style.display='block'; ln.textContent='XIRR is n/a — the dated cash flows don’t produce a sign change (e.g. no opening value and no sells yet). Enter an opening value or wait for a realised flow.'; }
  else if(fy.closingIsLive){ ln.style.display='block'; ln.textContent='Closing value is taken from current prices'+(fy.closeDate!==fy.end?' as of today (year still running).':' — enter a dated 31 Mar valuation for a historical year rather than relying on today’s prices.'); }
  else ln.style.display='none';
}

/* ---------- render: year strip / staleness / mini bar ---------- */
// One card per year with activity: the same headline metric the panel would show for that year
// (annualised XIRR for completed years, actual-to-date for the running one). Clicking selects it.
function renderYearStrip(){
  const host=document.getElementById('yearStrip'); if(!host) return;
  const B=state.basis;
  const years=new Set([periodKey(todayISO(),B)]);
  G.txns.forEach(t=>years.add(periodKey(t.date,B)));
  const list=[...years].sort((a,b)=>a-b);
  host.innerHTML=list.map(y=>{
    const b=G.boundaries[boundaryKey(state.owner,y)]||{};
    const r=computePeriod(G.txns,state.owner,y,B,{openingValue:b.openingValue,closingValue:b.closingValue,openingBasis:b.openingBasis},pricesMap(),G.histPrices);
    const pct = r.openingMissing?null : r.periodDone ? (r.xirr!=null?r.xirr:r.gainPct) : (r.periodPct!=null?r.periodPct:r.gainPct);
    const lbl=(B==='CY'?'CY ':'FY ')+y+(r.periodDone?'':' ·now');
    const na=pct==null;
    return `<div class="ycard${y===state.fy?' active':''}${na?' na':''}" data-y="${y}" title="${esc(r.label)}${r.periodDone?'':' — in progress'}">
      <div class="yl">${esc(lbl)}</div>
      <div class="yp ${na?'':signClass(pct)}">${na?'—':fmtPct(pct)}</div>
      <div class="yd">${na?'needs opening':fmtSGDsign(r.dollarReturn)}</div>
    </div>`;
  }).join('');
  host.querySelectorAll('.ycard').forEach(c=>c.addEventListener('click',()=>{
    state.fy=Number(c.dataset.y);
    document.getElementById('fyFilter').value=state.fy;
    renderFY(); renderHoldings(); renderYearStrip();
  }));
}
// Valuations are only as fresh as the stored quotes. Surface the oldest held-ticker price age at the
// headline — the one place it is always seen — instead of leaving asOf buried in the price panel.
function renderStaleNote(){
  const el=document.getElementById('staleNote'); if(!el) return;
  const {end}=periodBounds(state.fy,state.basis);
  if(end<=todayISO()){ el.style.display='none'; return; }   // completed year: valued at year-end close, staleness moot
  const held=[...new Set(computePositions(scopedTxns()).filter(p=>p.qtyHeld>1e-6&&(p.currency||'SGD')==='SGD').map(p=>p.ticker))];
  if(!held.length){ el.style.display='none'; return; }
  let oldest=null;
  held.forEach(tk=>{ const p=G.prices[tk]; const d=p&&p.asOf?p.asOf:'1970-01-01'; if(oldest==null||d<oldest) oldest=d; });
  const days=Math.round((Date.parse(todayISO())-Date.parse(oldest))/86400000);
  if(days<=3){ el.style.display='none'; return; }
  el.style.display='block';
  el.innerHTML=`Valued on prices as old as <b>${esc(oldest)}</b> (${days} days) — <a href="#" id="staleGo">pull live prices</a> to refresh.`;
  const a=el.querySelector('#staleGo'); if(a) a.addEventListener('click',e=>{ e.preventDefault(); pullLive(); });
}
function priceFreshness(){
  const held=[...new Set(computePositions(G.txns).filter(p=>p.qtyHeld>1e-6&&(p.currency||'SGD')==='SGD').map(p=>p.ticker))];
  let oldest=null; held.forEach(tk=>{ const p=G.prices[tk]; const d=p&&p.asOf?p.asOf:null; if(d&&(oldest==null||d<oldest)) oldest=d; });
  return oldest;
}
function updateMiniBar(fy){
  const s=document.getElementById('mbScope'); if(!s) return;
  s.textContent=(state.owner==='ALL'?'All owners':state.owner)+' · '+periodLabel(state.fy,state.basis)
    +(fy?(' · '+(fy.periodDone ? (fy.xirr!=null?fmtPct(fy.xirr):'') : (fy.periodPct!=null?fmtPct(fy.periodPct)+' to date':''))):'');
  const oldest=priceFreshness();
  document.getElementById('mbPrices').textContent=oldest?('prices @'+oldest):'';
  const d=document.getElementById('mbDirty');
  d.textContent=unsavedCount>0?(unsavedCount+' change'+(unsavedCount>1?'s':'')+' since last backup'):'';
  d.className='mb-ok';
}

/* ---------- render: prices ---------- */
function priceRowHtml(t){
  const p=G.prices[t]||{};
  return `<div class="rowflex" style="justify-content:space-between;border-bottom:1px solid var(--rule-soft);padding:6px 0">
    <span class="mono">${esc(t)}</span>
    <span class="rowflex">
      <input type="number" step="any" class="num-in inline-price" data-tk="${esc(t)}" value="${p.price!=null?p.price:''}" placeholder="price">
      <span class="hint">${p.asOf?('@'+esc(p.asOf)+(p.source?(' · '+esc(p.source)):'')):''}</span>
    </span></div>`;
}
function wirePriceInputs(host){
  host.querySelectorAll('input[data-tk]').forEach(inp=>{
    inp.addEventListener('change',async()=>{
      const tk=inp.dataset.tk, v=inp.value;
      await sPut('prices',{ticker:tk, price:v===''?null:Number(v), asOf:todayISO(), source:'manual'});
      await loadAll(); renderHoldings(); renderFY(); renderPrices(); markDirty();
      toast('Price saved — '+tk);
    });
  });
}
function renderPrices(){
  // Held tickers get first-class rows; sold-out ones live in a fold so they can still be priced
  // for the record (a zero-quantity price never moves any total).
  const all=computePositions(G.txns).filter(p=>(p.currency||'SGD')==='SGD');
  const held=[...new Set(all.filter(p=>p.qtyHeld>1e-6).map(p=>p.ticker))].sort();
  const sold=[...new Set(all.filter(p=>p.qtyHeld<=1e-6).map(p=>p.ticker))].filter(t=>!held.includes(t)).sort();
  const host=document.getElementById('priceList');
  host.innerHTML=held.length?held.map(priceRowHtml).join(''):'<div class="hint">No holdings to price yet.</div>';
  wirePriceInputs(host);
  const soldHost=document.getElementById('soldPriceList');
  if(soldHost){
    soldHost.innerHTML=sold.length?sold.map(priceRowHtml).join(''):'<div class="hint">No sold-out positions.</div>';
    wirePriceInputs(soldHost);
  }
}

/* ---------- render: recent ---------- */
function detailOf(t){
  if(t.type==='DIVIDEND') return fmtSGD(num(t.dividend));
  if(t.type==='CORPORATE_ACTION') return 'factor '+fmtNum(t.factor,4);
  const q=fmtQty(t.quantity), pr=fmtNum(t.price,4);
  return `${q} @ ${pr}${num(t.fees)?(' · fee '+fmtNum(t.fees,2)):''}`;
}
function renderRecent(){
  const q=(state.recentFilter||'').trim().toLowerCase();
  const match=t=>!q || [t.ticker,t.equity,t.type,t.owner,t.date].some(v=>String(v||'').toLowerCase().includes(q));
  const filtered=[...G.txns].filter(match).sort((a,b)=> a.date<b.date?1:a.date>b.date?-1:(b.id||0)-(a.id||0));
  const list=filtered.slice(0,40);
  const body=document.getElementById('recentBody');
  if(!list.length){ body.innerHTML=`<tr><td colspan="6" class="empty">${q?'Nothing matches “'+esc(q)+'”.':'No transactions yet.'}</td></tr>`; return; }
  body.innerHTML=list.map(t=>`<tr${state.editingId===t.id?' style="outline:2px solid var(--accent)"':''}>
    <td class="mono">${esc(t.date)}</td>
    <td>${esc((t.type||'').replace('_',' '))}</td>
    <td>${esc(t.owner)}</td>
    <td>${esc(t.equity||'')} ${t.ticker?`<span class="tick">${esc(t.ticker)}</span>`:''}</td>
    <td class="num">${detailOf(t)}</td>
    <td class="num" style="white-space:nowrap"><button class="ghost" data-edit="${t.id}" style="padding:4px 8px">edit</button> <button class="danger" data-del="${t.id}">delete</button></td>
  </tr>`).join('')
  +(filtered.length>40?`<tr><td colspan="6" class="hint" style="text-align:center">…and ${filtered.length-40} more — narrow the filter to see them</td></tr>`:'');
  body.querySelectorAll('button[data-del]').forEach(b=>b.addEventListener('click',async()=>{
    if(state.editingId===Number(b.dataset.del)) cancelEdit();
    await sDel('transactions', Number(b.dataset.del));
    await loadAll(); renderAll(); markDirty(); toast('Transaction deleted');
  }));
  body.querySelectorAll('button[data-edit]').forEach(b=>b.addEventListener('click',()=>editTxn(Number(b.dataset.edit))));
}
/* Edit-in-place: load an entry back into the form; submit then updates instead of adding. */
function editTxn(id){
  const t=G.txns.find(x=>x.id===id); if(!t){ toast('Entry not found'); return; }
  state.editingId=id;
  document.getElementById('f_type').value=t.type||'BUY'; syncFormFields();
  document.getElementById('f_owner').value=t.owner||OWNERS[0];
  document.getElementById('f_date').value=t.date||todayISO();
  document.getElementById('f_equity').value=t.equity||'';
  document.getElementById('f_ticker').value=t.ticker||'';
  document.getElementById('f_qty').value=t.quantity!=null?t.quantity:'';
  document.getElementById('f_price').value=t.price!=null?t.price:'';
  document.getElementById('f_fees').value=t.fees!=null?t.fees:'';
  document.getElementById('f_div').value=t.dividend!=null?t.dividend:'';
  if(t.type==='CORPORATE_ACTION'){ document.getElementById('f_caNew').value=t.factor||''; document.getElementById('f_caOld').value=1; }
  document.getElementById('f_note').value=t.note||'';
  document.getElementById('txSubmit').textContent='Save changes';
  document.getElementById('cancelEditBtn').style.display='';
  document.getElementById('txHint').textContent='Editing the '+t.date+' '+(t.type||'')+' entry';
  renderRecent();
  document.getElementById('txForm').scrollIntoView({behavior:'smooth',block:'center'});
}
function cancelEdit(){
  state.editingId=null;
  document.getElementById('txForm').reset();
  document.getElementById('f_date').value=todayISO();
  document.getElementById('txSubmit').textContent='Add to ledger';
  document.getElementById('cancelEditBtn').style.display='none';
  document.getElementById('txHint').textContent='';
  syncFormFields(); renderRecent();
}

/* ---------- master render ---------- */
function renderAll(){ populateOwner(); populateFY(); renderHoldings(); renderFY(); renderPrices(); renderRecent(); renderYearStrip(); populateTickers(); }

/* ---------- transaction form ---------- */
function syncFormFields(){
  const type=document.getElementById('f_type').value;
  const showQty=['BUY','SELL','OPENING'].includes(type);
  document.querySelectorAll('.grp-qty').forEach(e=>e.style.display=showQty?'':'none');
  document.querySelectorAll('.grp-div').forEach(e=>e.style.display=type==='DIVIDEND'?'':'none');
  document.querySelectorAll('.grp-ca').forEach(e=>e.style.display=type==='CORPORATE_ACTION'?'':'none');
  document.getElementById('lbl_price').firstChild.textContent = type==='OPENING'?'Cost basis / share':'Price / share';
}
async function submitTx(ev){
  ev.preventDefault();
  const type=document.getElementById('f_type').value;
  const rec={
    type, owner:document.getElementById('f_owner').value,
    date:document.getElementById('f_date').value||todayISO(),
    equity:document.getElementById('f_equity').value.trim(),
    ticker:document.getElementById('f_ticker').value.trim().toUpperCase(),
    quantity:0, price:0, fees:0, dividend:0, currency:'SGD',
    note:document.getElementById('f_note').value.trim()
  };
  if(!rec.equity && !rec.ticker){ toast('Enter an equity name or ticker'); return; }
  if(!rec.ticker) rec.ticker=rec.equity.toUpperCase();
  if(['BUY','SELL','OPENING'].includes(type)){
    rec.quantity=num(document.getElementById('f_qty').value);
    rec.price=num(document.getElementById('f_price').value);
    rec.fees=num(document.getElementById('f_fees').value);
    if(rec.quantity<=0){ toast('Quantity must be greater than 0'); return; }
  } else if(type==='DIVIDEND'){
    rec.dividend=num(document.getElementById('f_div').value);
    if(rec.dividend===0){ toast('Enter a dividend amount'); return; }
  } else if(type==='CORPORATE_ACTION'){
    const nw=num(document.getElementById('f_caNew').value), od=num(document.getElementById('f_caOld').value);
    if(nw<=0||od<=0){ toast('Enter a valid ratio, e.g. 2 : 1'); return; }
    rec.factor=nw/od;
  }
  if(state.editingId!=null){
    rec.id=state.editingId;
    await sPut('transactions',rec);
    await loadAll(); cancelEdit(); renderAll(); markDirty();
    toast('Entry updated');
    return;
  }
  // Statements get imported AND keyed by hand, so an identical entry is usually a double-keying.
  const dup=G.txns.find(t=> t.type===rec.type && t.owner===rec.owner && t.date===rec.date &&
    (t.ticker||'')===(rec.ticker||'') &&
    Math.abs(num(t.quantity)-rec.quantity)<1e-9 && Math.abs(num(t.price)-rec.price)<1e-9 &&
    Math.abs(num(t.dividend)-rec.dividend)<1e-9);
  if(dup && !(await confirmDialog('An identical entry already exists ('+dup.date+' '+dup.type+' '+(dup.ticker||'')+'). Add it anyway?','Add anyway'))) return;
  await sAdd('transactions',rec);
  await loadAll(); renderAll(); markDirty();
  document.getElementById('txForm').reset();
  document.getElementById('f_date').value=todayISO();
  syncFormFields();
  toast(type.replace('_',' ')+' added');
}
/* Known tickers feed the datalist; picking one auto-fills the equity name, so a typo can't
   silently split a position into two spellings. */
function populateTickers(){
  const dl=document.getElementById('tickerList'); if(!dl) return;
  const names={};
  G.txns.forEach(t=>{ const tk=(t.ticker||'').toUpperCase(); if(tk && !names[tk]) names[tk]=t.equity||''; });
  dl.innerHTML=Object.keys(names).sort().map(tk=>`<option value="${esc(tk)}">${esc(names[tk])}</option>`).join('');
  populateTickers.names=names;
}
function autofillEquity(){
  const tk=document.getElementById('f_ticker').value.trim().toUpperCase();
  const known=(populateTickers.names||{})[tk];
  const eq=document.getElementById('f_equity');
  if(known && !eq.value.trim()) eq.value=known;
}

/* ---------- price actions: live via the IBKR connector ----------
   A browser file can't reach IBKR directly (auth + cross-origin). Interactive Brokers is available
   through the Claude connector instead, so this button bridges to it. Two paths, auto-selected:
     • Direct — if the page is running as a Cowork live view, window.cowork.callMcpTool is present and
       we call the connector straight away, writing the returned prices in.
     • Prompt — a standalone file has no such bridge, so we build a precise request (every held ticker
       with its IBKR contract id) and hand it to Claude, which fetches the quotes and returns an updated
       price block to restore. The request is copied to the clipboard and shown for one-click sending. */
function heldTickersForPricing(){
  // Everything currently held, across all owners, in the reporting currency.
  return [...new Set(computePositions(G.txns)
    .filter(p=>p.qtyHeld>1e-6 && (p.currency||'SGD')==='SGD')
    .map(p=>p.ticker))].sort();
}
function buildPricePrompt(tickers){
  const lines = tickers.map(tk=>{
    const cid=IBKR_CONTRACTS[tk];
    return '  • '+tk+(cid?'  (IBKR contract '+cid+', SGX)':'  (resolve the SGX contract by symbol)');
  }).join('\n');
  return [
    'Refresh live prices for my Ong & Kim portfolio via the IBKR connector.',
    'For each ticker below, take the latest available price — the real-time last during SGX hours, otherwise the most recent daily close — and give me back an updated JSON price block I can Restore into the dashboard (same shape as the existing prices array: {ticker, price, asOf, source:"IBKR"}). Un-adjust any corporate-action-adjusted closes to the actual traded price, as before.',
    '',
    'Tickers held ('+tickers.length+'):',
    lines
  ].join('\n');
}
async function pullLive(){
  const tickers=heldTickersForPricing();
  if(!tickers.length){ toast('No SGD holdings to price'); return; }

  // Inside the Cowork artifact the IBKR connector is available: refresh everything now (bridge.js).
  if(hasBridge()){
    try{ await autoRefreshPrices(true); }catch(e){ toast('Live pull failed: '+e.message); }
    return;
  }

  // Prompt path: no connector in the page. Locally (npm start) Claude Code refreshes the prices in the
  // data file and the page reloads by itself; for a plain file, Claude returns a price file to restore.
  const prompt = STORE_BACKEND==='file'
    ? 'Refresh prices for the Ong & Kim dashboard (refresh-prices skill): quote every held ticker on SGX through the IBKR connector and write them with `node app/tools/state.js set-prices`.\n\nTickers ('+tickers.length+'): '+tickers.join(', ')
    : buildPricePrompt(tickers);
  let copied=false;
  try{ await navigator.clipboard.writeText(prompt); copied=true; }catch(e){}
  showPromptModal(prompt, copied);
}
function showPromptModal(text, copied){
  const back=document.createElement('div');
  back.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
  back.innerHTML=`<div style="background:var(--panel,#fff);color:inherit;max-width:640px;width:100%;border-radius:12px;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.3)">
    <h3 style="margin:0 0 6px">Get live prices from IBKR</h3>
    <p style="margin:0 0 10px;font-size:.9em;opacity:.8">${copied?'This request has been <b>copied to your clipboard</b>. ':''}${STORE_BACKEND==='file'
      ? 'Paste it to <b>Claude Code</b> in the Ong Kim Investment folder (or just say “refresh prices”). Claude pulls the quotes through the IBKR connector and writes them into the data file — this page reloads by itself when they land.'
      : 'Paste it to Claude in the Cowork chat — Claude will pull the quotes through the IBKR connector and hand back a JSON price file. Load it with <b>Restore JSON</b>: a price-only file updates prices and <b>leaves your transactions untouched</b>.'}</p>
    <textarea readonly style="width:100%;height:200px;font:12px/1.5 ui-monospace,Menlo,monospace;padding:10px;border:1px solid var(--line,#ccc);border-radius:8px;resize:vertical;box-sizing:border-box">${text.replace(/</g,'&lt;')}</textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button id="pmCopy" class="ghost">Copy again</button>
      <button id="pmClose" class="ghost">Close</button>
    </div></div>`;
  document.body.appendChild(back);
  const close=()=>back.remove();
  back.addEventListener('click',e=>{ if(e.target===back) close(); });
  back.querySelector('#pmClose').addEventListener('click',close);
  back.querySelector('#pmCopy').addEventListener('click',async()=>{ try{ await navigator.clipboard.writeText(text); toast('Copied'); }catch(e){ back.querySelector('textarea').select(); } });
  back.querySelector('textarea').focus(); back.querySelector('textarea').select();
}

/* ---------- export: xlsx (SheetJS at click) + CSV fallback ---------- */
function scopeTag(){ return (state.owner==='ALL'?'all-owners':state.owner.replace(/[^A-Za-z0-9]+/g,'-')).toLowerCase(); }
function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=()=>rej(new Error('CDN load failed')); document.head.appendChild(s); }); }
// One row per equity held during the selected period, matching the holdings table on screen:
// completed year → snapshot at its year-end close; current year → live prices. Realised P/L and
// dividends are the amounts that fell in the selected period. Totals are SGD positions only.
// A position belongs in the period view if it was held during the period OR produced income in it —
// e.g. a small dividend paid after the shares were sold — so holdings totals tie to the period return.
function inPeriodView(p,heldSet){ return heldSet.has(p.owner+'|'+p.ticker) || Math.abs(periodRealised(p))>1e-9 || Math.abs(periodDividends(p))>1e-9; }
function holdingsExport(){
  const heldSet=heldDuringPeriod(G.txns, state.owner, state.fy, state.basis);
  const view=periodView(); const pm=view.priceMap; const per=(state.basis==='CY'?'CY':'FY')+state.fy;   // short label for headers / sheet names
  const priceHdr = view.done ? ('Close '+view.end) : 'Current price';
  const sel=view.positions.filter(p=>inPeriodView(p,heldSet));
  let tMV=0; sel.forEach(p=>{ const pr=pm[p.ticker]; if(p.qtyHeld>1e-6&&pr!=null&&(p.currency||'SGD')==='SGD') tMV+=p.qtyHeld*pr; });
  const cols=[
    {k:'equity',h:'Equity',w:26},{k:'ticker',h:'Ticker',w:9},{k:'owner',h:'Owner',w:24},{k:'asAt',h:'As at',w:11},
    {k:'qty',h:'Qty held',w:12,fmt:'qty'},{k:'cost',h:'Adjusted cost (S$)',w:16,fmt:'money'},{k:'avg',h:'Avg cost / sh',w:12,fmt:'price'},
    {k:'price',h:priceHdr,w:13,fmt:'price'},{k:'mv',h:'Market value (S$)',w:16,fmt:'money'},{k:'wt',h:'Weight',w:9,fmt:'pct'},
    {k:'unreal',h:'Unrealised P/L (S$)',w:17,fmt:'money'},{k:'real',h:'Realised P/L '+per+' (S$)',w:22,fmt:'money'},{k:'div',h:'Dividends '+per+' (S$)',w:20,fmt:'money'}];
  const rows=sel.map(p=>{
    const pr=pm[p.ticker], held=p.qtyHeld>1e-6, sgd=(p.currency||'SGD')==='SGD', mv=(held&&pr!=null)?p.qtyHeld*pr:null;
    return {equity:p.name,ticker:p.ticker,owner:p.owner,asAt:view.asOf,qty:held?p.qtyHeld:0,cost:held?p.adjustedCost:0,avg:held?p.avgCost:null,
      price:pr!=null?pr:null,mv,wt:(mv!=null&&sgd&&tMV>1e-9)?mv/tMV:null,unreal:mv!=null?mv-p.adjustedCost:null,
      real:periodRealised(p),div:periodDividends(p),sgd};
  });
  const sum=k=>rows.filter(r=>r.sgd&&r[k]!=null).reduce((s,r)=>s+r[k],0);
  const total={equity:'Total (SGD)',cost:sum('cost'),mv:sum('mv'),wt:tMV>1e-9?1:null,unreal:sum('unreal'),real:sum('real'),div:sum('div')};
  return {cols,rows,total,period:per,view};
}
function holdingsRows(){ return holdingsExport().rows; }
function periodSummaryRows(){
  const b=currentBoundary(); const fy=computePeriod(G.txns,state.owner,state.fy,state.basis,{openingValue:b.openingValue,closingValue:b.closingValue,openingBasis:b.openingBasis},pricesMap(),G.histPrices);
  const m=v=>({v,fmt:'money'});
  return [['Item','Value'],
    ['Scope',state.owner==='ALL'?'All owners':state.owner],['Period basis',state.basis==='CY'?'Calendar year (Jan–Dec)':'Financial year (Apr–Mar)'],
    ['Period',periodLabel(state.fy,state.basis)+' · '+fy.start+' to '+fy.closeDate],
    ['Opening basis',fy.openingBasis==='COST'?('Cost of holdings at '+fy.openingDate):('Market value at '+fy.openingDate)],
    ['Opening value',m(fy.openingValue)],['Buys',m(fy.buys)],['Stock introduced',m(fy.introduced||0)],['Sells',m(fy.sells)],
    ['Dividends',m(fy.dividends)],['Realised P/L',m(fy.realisedFY)],['Closing value'+(fy.closingIsLive?' (live prices)':''),m(fy.closingValue)],
    ['Net invested',m(fy.netInvested)],['Dollar return',m(fy.dollarReturn)],
    [fy.periodDone?'XIRR (annualised)':'Return to date (not annualised)',(fy.periodDone?fy.xirr:fy.periodPct)==null?'n/a':{v:fy.periodDone?fy.xirr:fy.periodPct,fmt:'pct'}],
    ['Exported',new Date().toLocaleString('en-SG')]];
}
// Real .xlsx written in the page (calc.js xlsxWrite) — works inside the Cowork artifact, where
// external libraries can't load. Sheets: Holdings, Period Summary, Dividends, Transactions.
function exportXlsx(){
  try{
    const H=holdingsExport();
    const hRows=[H.cols.map(c=>c.h)].concat(H.rows.map(r=>H.cols.map(c=>r[c.k]==null?'':r[c.k])), [H.cols.map(c=>H.total[c.k]==null?'':H.total[c.k])]);
    const {start,end}=periodBounds(state.fy,state.basis);
    const divs=scopedTxns().filter(t=>t.type==='DIVIDEND'&&t.date>=start&&t.date<=end).sort((a,b)=>a.date<b.date?-1:1);
    const dRows=[['Date','Owner','Equity','Ticker','Amount (S$)','Note']].concat(divs.map(t=>[t.date,t.owner,t.equity,t.ticker,{v:num(t.dividend),fmt:'money'},t.note||'']),
      [['Total','','','',{v:divs.reduce((s,t)=>s+num(t.dividend),0),fmt:'money'},'']]);
    const T=scopedTxns().slice().sort((a,b)=>a.date<b.date?-1:1);
    const tRows=[['Date','Type','Owner','Equity','Ticker','Quantity','Price','Fees','Dividend','Factor','Currency','Note']].concat(T.map(t=>[t.date,t.type,t.owner,t.equity,t.ticker,
      t.quantity?num(t.quantity):'',t.price?num(t.price):'',t.fees?num(t.fees):'',t.dividend?num(t.dividend):'',t.factor||'',t.currency||'SGD',t.note||'']));
    const bytes=xlsxWrite([
      {name:'Holdings',cols:H.cols.map(c=>({w:c.w,fmt:c.fmt})),rows:hRows},
      {name:'Period Summary',cols:[{w:30},{w:44}],rows:periodSummaryRows()},
      {name:'Dividends '+H.period,cols:[{w:11},{w:24},{w:24},{w:9},{w:14,fmt:'money'},{w:50}],rows:dRows},
      {name:'Transactions',cols:[{w:11},{w:16},{w:24},{w:24},{w:9},{w:11,fmt:'qty'},{w:11,fmt:'price'},{w:10,fmt:'money'},{w:12,fmt:'money'},{w:8},{w:9},{w:50}],rows:tRows}
    ]);
    downloadBlob(bytes,`portfolio-ledger_${scopeTag()}_${state.basis}${state.fy}_${todayISO()}.xlsx`,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast('Excel workbook exported — '+H.rows.length+' holdings, '+divs.length+' dividends');
  }catch(e){
    console.warn('xlsx export failed',e);
    toast('Excel export failed ('+e.message+') — exporting holdings CSV instead');
    exportCsv(true);
  }
}
function exportCsv(silent){
  const H=holdingsExport();
  const cell=v=>{ if(v==null) return ''; if(typeof v==='number') return String(Math.round(v*1e6)/1e6); v=String(v); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  const lines=[H.cols.map(c=>cell(c.h)).join(',')].concat(H.rows.map(r=>H.cols.map(c=>cell(r[c.k])).join(',')), [H.cols.map(c=>cell(H.total[c.k])).join(',')]);
  downloadBlob(lines.join('\n'),`portfolio-holdings_${scopeTag()}_${state.basis}${state.fy}_${todayISO()}.csv`,'text/csv');
  if(!silent) toast('Holdings CSV exported');
}
function downloadBlob(content,name,type){ if(STORE_BACKEND==='claude') return saveViaClaude(content,name); const b=new Blob([content],{type:type||'application/octet-stream'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(u),1500); }

/* ---------- export: one-page PDF of the current holdings view ----------
   Renders a self-contained A4-landscape document in a hidden iframe and opens the print dialog
   ("Save as PDF"). No CDN dependency, and the text stays selectable vector rather than a bitmap.
   It recomputes rows through the SAME helpers the table uses (periodView / heldDuringPeriod /
   periodRealised), so the printout can never drift from what is on screen. Font size steps down
   with row count so everything lands on a single page. */
function exportHoldingsPdf(){
  const heldSet=heldDuringPeriod(G.txns, state.owner, state.fy, state.basis);
  const view=periodView(); const pm=view.priceMap;
  const pos=view.positions.filter(p=>inPeriodView(p,heldSet));
  if(!pos.length){ toast('Nothing to export for '+periodLabel(state.fy,state.basis)); return; }

  let tCost=0,tMV=0,tUnreal=0,tReal=0,tDiv=0,priced=true;
  const rows=pos.map(p=>{
    const pr=pm[p.ticker], held=p.qtyHeld>1e-6, sgd=(p.currency||'SGD')==='SGD';
    const mv=(held&&pr!=null)?p.qtyHeld*pr:null;
    const unreal=(mv!=null)?mv-p.adjustedCost:null;
    const unrealPct=(unreal!=null&&p.adjustedCost>1e-9)?unreal/p.adjustedCost:null;
    const rReal=periodRealised(p), rDiv=periodDividends(p);
    if(sgd){ tCost+=held?p.adjustedCost:0; if(mv!=null)tMV+=mv; if(unreal!=null)tUnreal+=unreal; tReal+=rReal; tDiv+=rDiv; if(held&&pr==null)priced=false; }
    // Append the negative marker to the existing class — a second class attribute would be ignored.
    const neg=v=>(v!=null&&v<0)?' n':'';
    return `<tr${sgd?'':' class="fx"'}>
      <td>${esc(p.name)} <span class="tk">${esc(p.ticker||'')}</span>${sgd?'':' <span class="tk">'+esc(p.currency)+'</span>'}</td>
      <td>${esc(p.owner)}</td>
      <td class="r">${held?fmtQty(p.qtyHeld):'—'}</td>
      <td class="r">${held?fmtSGD(p.adjustedCost):'—'}</td>
      <td class="r">${held?fmtNum(p.avgCost,4):'—'}</td>
      <td class="r">${pr!=null?fmtNum(pr,4):'—'}</td>
      <td class="r">${mv!=null?fmtSGD(mv):'—'}</td>
      <td class="r${neg(unreal)}">${unreal!=null?fmtSGDsign(unreal):'—'}${unrealPct!=null?' <span class="pc">'+fmtPct(unrealPct)+'</span>':''}</td>
      <td class="r${neg(rReal)}">${Math.abs(rReal)>1e-9?fmtSGDsign(rReal):'—'}</td>
      <td class="r">${Math.abs(rDiv)>1e-9?fmtSGD(rDiv):'—'}</td>
    </tr>`;
  }).join('');

  // Fit one A4 landscape page (usable height ~192mm ≈ 726px at 96dpi) by scaling the base font to
  // the row count, rather than fixed tiers that overflow once the list gets long. Each row costs
  // roughly 3.3× the font size (value line + the unrealised-% sub-line + padding); ~14× covers the
  // header, summary cards, table head, totals and footer. Clamped so it stays legible but always fits.
  const n=pos.length;
  const fs = Math.max(4.8, Math.min(9.4, 660/(n*3.3+14)));
  const per=periodLabel(state.fy,state.basis);
  const scope=state.owner==='ALL'?'All owners':state.owner;
  const valLine=view.done
    ? 'Valued at the close of '+view.end
    : 'Valued at latest available prices (oldest quote '+(priceFreshness()||view.asOf)+') — '+per+' still running';
  const cards=[
    [view.done?'Value at '+view.end:'Market value', fmtSGD(tMV)+(priced?'':' *')],
    ['Unrealised P/L', fmtSGDsign(tUnreal)],
    ['Realised P/L ('+per+')', fmtSGDsign(tReal)],
    ['Dividends ('+per+')', fmtSGD(tDiv)],
    ['Cost of holdings', fmtSGD(tCost)]
  ].map(c=>`<div class="card"><div class="k">${esc(c[0])}</div><div class="v">${c[1]}</div></div>`).join('');

  const doc=`<!doctype html><html><head><meta charset="utf-8"><title>Holdings ${esc(per)} — ${esc(scope)}</title>
<style>
  @page{size:A4 landscape;margin:9mm}
  *{box-sizing:border-box}
  body{margin:0;font:${fs}px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#14161a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  h1{margin:0;font-size:${(fs*1.55).toFixed(1)}px;letter-spacing:-.01em}
  .sub{margin-top:2px;font-size:${(fs*.95).toFixed(1)}px;color:#5b6470}
  .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.5px solid #14161a;padding-bottom:5px;margin-bottom:7px}
  .hd .rt{text-align:right;font-size:${(fs*.9).toFixed(1)}px;color:#5b6470;white-space:nowrap}
  .cards{display:flex;gap:${(fs*1.6).toFixed(1)}px;margin-bottom:7px;flex-wrap:wrap}
  .card .k{font-size:${(fs*.82).toFixed(1)}px;color:#5b6470;text-transform:uppercase;letter-spacing:.04em}
  .card .v{font-size:${(fs*1.2).toFixed(1)}px;font-weight:600;font-variant-numeric:tabular-nums}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  th,td{padding:${(fs*.34).toFixed(1)}px ${(fs*.42).toFixed(1)}px;text-align:left;vertical-align:top;border-bottom:.5px solid #e3e6ea}
  th{font-size:${(fs*.82).toFixed(1)}px;text-transform:uppercase;letter-spacing:.03em;color:#5b6470;font-weight:600;border-bottom:1px solid #14161a}
  td.r,th.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  td.n{color:#b3261e}
  .tk{color:#8a929c;font-size:${(fs*.86).toFixed(1)}px}
  .pc{display:block;font-size:${(fs*.8).toFixed(1)}px;color:#8a929c}
  .fx td{color:#8a929c}
  tfoot td{border-top:1.2px solid #14161a;border-bottom:none;font-weight:700;padding-top:${(fs*.45).toFixed(1)}px}
  .ft{margin-top:6px;font-size:${(fs*.82).toFixed(1)}px;color:#8a929c;display:flex;justify-content:space-between;gap:10px}
  col.c1{width:19%}col.c2{width:11%}col.c3{width:8.5%}col.c4{width:9.5%}col.c5{width:8%}
  col.c6{width:7.5%}col.c7{width:9.5%}col.c8{width:10.5%}col.c9{width:9%}col.c10{width:7.5%}
</style></head><body>
  <div class="hd">
    <div><h1>Portfolio Holdings — ${esc(per)}</h1>
      <div class="sub">${esc(scope)} · ${esc(valLine)}</div></div>
    <div class="rt">Ong &amp; Kim Family Trust Pte Ltd<br>Generated ${todayISO()}</div>
  </div>
  <div class="cards">${cards}</div>
  <table>
    <colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5"><col class="c6"><col class="c7"><col class="c8"><col class="c9"><col class="c10"></colgroup>
    <thead><tr>
      <th>Equity</th><th>Owner</th><th class="r">Qty</th><th class="r">Cost</th><th class="r">Avg /sh</th>
      <th class="r">Price</th><th class="r">Mkt value</th><th class="r">Unreal. P/L</th>
      <th class="r">Realised<br>${esc(per)}</th><th class="r">Divs<br>${esc(per)}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td>Total (SGD only)</td><td></td><td></td><td class="r">${fmtSGD(tCost)}</td><td></td><td></td>
      <td class="r">${fmtSGD(tMV)}</td><td class="r${tUnreal<0?' n':''}">${fmtSGDsign(tUnreal)}</td>
      <td class="r${tReal<0?' n':''}">${fmtSGDsign(tReal)}</td><td class="r">${fmtSGD(tDiv)}</td>
    </tr></tfoot>
  </table>
  <div class="ft">
    <div>All figures in SGD. Cost basis FIFO. Realised P/L and dividends are for ${esc(per)} only.${priced?'':' * some holdings have no price for the valuation date.'}</div>
    <div>${n} position${n===1?'':'s'}</div>
  </div>
</body></html>`;

  // A hidden same-origin iframe prints reliably and is not blocked like a popup window.
  const old=document.getElementById('pdfFrame'); if(old) old.remove();
  const f=document.createElement('iframe');
  f.id='pdfFrame';
  f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(f);
  f.onload=()=>{ try{ f.contentWindow.focus(); f.contentWindow.print(); }catch(e){ toast('Could not open the print dialog: '+e.message); } };
  f.srcdoc=doc;
  toast('Choose "Save as PDF" in the print dialog');
}

/* ---------- JSON backup / restore ---------- */
// Stores that belong to the other tabs; backed up and restored alongside the ledger.
const EXTRA_STORES=BACKUP_STORES;   // tab stores carried in backups (store.js)
// Whole document → Backup JSON (v3: ledger, prices, every tab's records and the one-time fix flags).
async function backupJson(){
  const data=backupFromDoc(DOC);
  downloadBlob(JSON.stringify(data,null,2),`portfolio-ledger_backup_${todayISO()}.json`,'application/json');
  markClean();
  toast('JSON backup downloaded — '+data.transactions.length+' transactions, '+data.policies.length+' policies, '+data.properties.length+' properties, '+data.rules.length+' rules');
}
async function restoreJson(file){
  const text=await readFileText(file); let data;
  try{ data=JSON.parse(text); }catch(e){ toast('Not valid JSON'); return; }
  if(!data){ toast('Not valid JSON'); return; }
  // A price-only file (no transactions) is a price refresh, not a ledger replacement. Merge the
  // prices in and leave transactions alone — replacing the ledger here would destroy newer entries.
  const priceOnly = !Array.isArray(data.transactions) &&
    (Array.isArray(data.prices)&&data.prices.length || Array.isArray(data.histPrices)&&data.histPrices.length);
  if(priceOnly){
    const n=(data.prices||[]).length, h=(data.histPrices||[]).length;
    if(!(await confirmDialog(`Update prices only?\n\n${n} current price(s)${h?` and ${h} historical price(s)`:''} will be merged.\nTransactions and boundaries are left untouched.`,'Update prices'))) return;
    for(const p of (data.prices||[])) await sPut('prices',{ticker:p.ticker,price:p.price==null?null:Number(p.price),asOf:p.asOf||todayISO(),source:p.source||'import'});
    for(const x of (data.histPrices||[])) await sPut('histprices',Object.assign({key:x.date+'|'+x.ticker},x));
    await loadAll(); renderAll(); markDirty();
    toast(`Prices updated (${n} current${h?`, ${h} historical`:''}) — transactions unchanged`);
    return;
  }
  if(!Array.isArray(data.transactions)){ toast('JSON has no transactions and no prices — nothing to load'); return; }
  if(!(await confirmDialog('Restore will REPLACE the current ledger with the file contents. Continue?','Restore'))) return;
  await Promise.all([sClear('transactions'),sClear('prices'),sClear('boundaries'),sClear('histprices')]);
  const tx=data.transactions.map(t=>{ const c=Object.assign({},t); delete c.id; return c; });
  await sBulkAdd('transactions',tx);
  if(Array.isArray(data.prices)&&data.prices.length) await sBulkAdd('prices',data.prices);
  if(Array.isArray(data.boundaries)&&data.boundaries.length) await sBulkAdd('boundaries',data.boundaries);
  if(Array.isArray(data.histPrices)&&data.histPrices.length) await sBulkAdd('histprices',data.histPrices.map(h=>Object.assign({key:h.date+'|'+h.ticker},h)));
  // Tab data is replaced only when the file carries it — an older ledger-only backup leaves
  // properties, policies, rules and statements untouched.
  let extras=0;
  for(const s of EXTRA_STORES){
    if(!Array.isArray(data[s])) continue;
    await sClear(s);
    for(const r of data[s]) await sPut(s,r);
    extras+=data[s].length;
  }
  for(const m of (data.metaFlags||[])) await sPut('meta',m);   // one-time fixes already applied in that data
  await loadAll(); renderAll(); if(typeof renderCurrentPage==='function') renderCurrentPage(); markClean();
  toast('Ledger restored ('+tx.length+' transactions'+(extras?', '+extras+' tab records':'')+')');
}
async function resetToBundled(){
  if(!(await typedConfirm('Discard everything saved on this device and return to the data bundled with this dashboard?','RESET'))){ toast('Not reset'); return; }
  storeReset();
  await loadAll(); renderAll(); if(typeof renderCurrentPage==='function') renderCurrentPage(); markClean();
  toast('Back to the bundled data');
}

/* ---------- demo / clear ---------- */
async function loadDemo(){
  const O='Ong Ah Whatt';
  const demo=[
    {equity:'ABC Corp',ticker:'ABC',date:'2024-05-10',type:'BUY',owner:O,quantity:100,price:10,fees:20,currency:'SGD',note:'demo'},
    {equity:'ABC Corp',ticker:'ABC',date:'2024-08-01',type:'BUY',owner:O,quantity:100,price:12,fees:20,currency:'SGD',note:'demo'},
    {equity:'ABC Corp',ticker:'ABC',date:'2024-11-15',type:'DIVIDEND',owner:O,dividend:45,currency:'SGD',note:'demo'},
    {equity:'ABC Corp',ticker:'ABC',date:'2025-02-01',type:'SELL',owner:O,quantity:150,price:15,fees:30,currency:'SGD',note:'demo'}
  ];
  await sBulkAdd('transactions',demo);
  await sPut('prices',{ticker:'ABC',price:13,asOf:todayISO(),source:'manual'});
  await sPut('boundaries',{key:boundaryKey('ALL',2025),owner:'ALL',fy:2025,openingValue:0,closingValue:''});
  state.fy=2025;
  await loadAll(); renderAll(); markDirty();
  toast('Demo loaded — FY2025 dollar return should read +S$675.00');
}
async function clearAll(){
  if(!(await typedConfirm('This erases ALL data on this device — ledger, prices, rules, statements, properties and policies — and cannot be undone.','DELETE'))){ toast('Not cleared'); return; }
  await Promise.all([sClear('transactions'),sClear('prices'),sClear('boundaries'),sClear('histprices')].concat(EXTRA_STORES.map(s=>sClear(s))));
  await loadAll(); renderAll(); if(typeof renderCurrentPage==='function') renderCurrentPage(); markClean(); toast('All data cleared');
}

/* ---------- ingestion (CSV / XLSX) ---------- */
const FIELDS_TRADING=[['date','Date'],['ticker','Ticker'],['equity','Equity name'],['type','Type (buy/sell/…)'],['quantity','Quantity'],['price','Price/share'],['fees','Fees']];
const FIELDS_BANK=[['date','Date'],['description','Description'],['amount','Amount']];
let IMP=null; // {headers, rows, kind}
function importParseCSV(text){
  const rows=[]; let row=[],cur='',q=false;
  for(let i=0;i<text.length;i++){ const ch=text[i];
    if(q){ if(ch==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=ch; }
    else { if(ch==='"') q=true; else if(ch===','||ch==='\t'){ row.push(cur); cur=''; } else if(ch==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; } else if(ch==='\r'){} else cur+=ch; }
  }
  if(cur.length||row.length){ row.push(cur); rows.push(row); }
  const clean=rows.filter(r=>r.some(c=>String(c).trim()!==''));
  return { headers:(clean[0]||[]).map(h=>String(h).trim()), rows:clean.slice(1) };
}
async function handleFile(file){
  const name=file.name.toLowerCase();
  try{
    if(name.endsWith('.csv')||name.endsWith('.tsv')){ IMP=Object.assign(importParseCSV(await readFileText(file)),{kind:'trading'}); }
    else{
      // Inline reader (calc.js) — the artifact sandbox can't load SheetJS from a CDN.
      const arr=await xlsxToRows(await readFileBuffer(file));
      IMP={headers:(arr[0]||[]).map(h=>String(h).trim()), rows:arr.slice(1), kind:'trading'};
    }
  }catch(e){ toast('Could not read file: '+e.message); return; }
  if(!IMP.headers.length){ toast('No columns detected'); return; }
  renderMapper();
}
function guess(headers,keys){ const low=headers.map(h=>h.toLowerCase()); for(const k of keys){ const i=low.findIndex(h=>h.includes(k)); if(i>=0) return i; } return -1; }
function renderMapper(){
  const area=document.getElementById('mapArea');
  const kind=IMP.kind;
  const fields = kind==='bank'?FIELDS_BANK:FIELDS_TRADING;
  const guesses={ date:guess(IMP.headers,['date','trade date','settle']), ticker:guess(IMP.headers,['ticker','symbol','stock','instrument']),
    equity:guess(IMP.headers,['name','description','security','equity']), type:guess(IMP.headers,['type','action','side','activity']),
    quantity:guess(IMP.headers,['quantity','qty','shares','units']), price:guess(IMP.headers,['price','unit price','avg price']),
    fees:guess(IMP.headers,['fee','commission','charge','brokerage']), description:guess(IMP.headers,['description','details','narrative','memo','particular']),
    amount:guess(IMP.headers,['amount','value','credit','debit','sgd']) };
  const opts=(sel)=>'<option value="-1">— none —</option>'+IMP.headers.map((h,i)=>`<option value="${i}" ${i===sel?'selected':''}>${esc(h||('col'+i))}</option>`).join('');
  area.innerHTML=`
    <div class="panel" style="margin-top:16px;background:#fbfcfb">
      <div class="rowflex" style="justify-content:space-between">
        <div class="rowflex">
          <strong>${IMP.rows.length} rows</strong>
          <label class="rowflex" style="gap:6px"><input type="radio" name="kind" value="trading" ${kind==='trading'?'checked':''}> Trading statement</label>
          <label class="rowflex" style="gap:6px"><input type="radio" name="kind" value="bank" ${kind==='bank'?'checked':''}> Bank statement</label>
        </div>
        <label class="fld" style="text-transform:none">Assign owner
          <select id="imp_owner">${OWNERS.map(o=>`<option>${esc(o)}</option>`).join('')}</select>
        </label>
      </div>
      <div style="margin-top:12px" id="mapFields">
        ${fields.map(f=>`<div class="map-row"><span class="hint" style="text-transform:none">${f[1]}</span><select data-f="${f[0]}">${opts(guesses[f[0]])}</select></div>`).join('')}
        ${kind==='trading'?`<div class="map-row"><span class="hint" style="text-transform:none">Default type (if blank)</span><select id="imp_defType"><option>BUY</option><option>SELL</option><option>DIVIDEND</option><option>OPENING</option></select></div>`:''}
      </div>
      <div id="impPreview"></div>
      <div class="actions">
        <button class="primary" id="impConfirm">Review &amp; append</button>
        <button class="ghost" id="impCancel">Cancel</button>
      </div>
      <div class="hint" id="impMsg" style="margin-top:6px"></div>
    </div>`;
  area.querySelectorAll('input[name=kind]').forEach(r=>r.addEventListener('change',()=>{ IMP.kind=r.value; renderMapper(); }));
  area.querySelectorAll('#mapFields select[data-f]').forEach(s=>s.addEventListener('change',previewImport));
  document.getElementById('imp_owner').addEventListener('change',previewImport);
  if(document.getElementById('imp_defType')) document.getElementById('imp_defType').addEventListener('change',previewImport);
  document.getElementById('impConfirm').addEventListener('click',commitImport);
  document.getElementById('impCancel').addEventListener('click',()=>{ IMP=null; area.innerHTML=''; });
  previewImport();
}
function mapping(){ const m={}; document.querySelectorAll('#mapFields select[data-f]').forEach(s=>m[s.dataset.f]=Number(s.value)); return m; }
function normType(v,def){ const s=String(v||'').toLowerCase(); if(/sell|sold|sale|\bs\b/.test(s))return'SELL'; if(/buy|bought|purchase|\bb\b/.test(s))return'BUY'; if(/div/.test(s))return'DIVIDEND'; if(/open/.test(s))return'OPENING'; return def||'BUY'; }
function importToNum(v){ if(v==null)return 0; const n=Number(String(v).replace(/[^0-9.\-]/g,'')); return isFinite(n)?n:0; }
function normDate(v){ if(v==null)return''; if(typeof v==='number'&&v>20000&&v<80000){ const d=new Date(Date.UTC(1899,11,30)); d.setUTCDate(d.getUTCDate()+Math.round(v)); return todayISO(d); } const s=String(v).trim();
  let m=s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/); if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  m=s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/); if(m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  const d=new Date(s); return isNaN(d)?s:todayISO(d); }
function buildImportRecords(){
  const m=mapping(), owner=document.getElementById('imp_owner').value, kind=IMP.kind;
  const get=(row,f)=> (m[f]>=0? row[m[f]] : undefined);
  if(kind==='trading'){
    const def=document.getElementById('imp_defType')?document.getElementById('imp_defType').value:'BUY';
    return IMP.rows.map(row=>{
      const type=m.type>=0?normType(get(row,'type'),def):def;
      const rec={type,owner,date:normDate(get(row,'date')),ticker:String(get(row,'ticker')||'').trim().toUpperCase(),equity:String(get(row,'equity')||'').trim(),currency:'SGD',note:'import'};
      if(type==='DIVIDEND'){ rec.dividend=importToNum(get(row,'price'))||importToNum(get(row,'fees')); }
      else { rec.quantity=importToNum(get(row,'quantity')); rec.price=importToNum(get(row,'price')); rec.fees=importToNum(get(row,'fees')); }
      if(!rec.ticker&&rec.equity) rec.ticker=rec.equity.toUpperCase();
      rec._ok = !!rec.date && !!(rec.ticker||rec.equity) && (type==='DIVIDEND'?rec.dividend!==0:rec.quantity>0);
      return rec;
    });
  } else {
    // bank: reconcile against existing trades for corroboration; propose dividends for unmatched credits
    return IMP.rows.map(row=>{
      const date=normDate(get(row,'date')); const desc=String(get(row,'description')||'').trim(); const amt=importToNum(get(row,'amount'));
      const match=reconcileBank(date,amt);
      const rec={_bank:true,date,desc,amount:amt,match, owner,
        include: match.kind==='unmatched-credit', // default: only unmatched credits (likely dividends) proposed
        asType: amt>0?'DIVIDEND':'BUY', ticker:'', currency:'SGD', note:'bank: '+desc};
      return rec;
    });
  }
}
function reconcileBank(date,amt){
  const tol=Math.max(0.02, Math.abs(amt)*0.005);
  const within=(a,b)=>Math.abs(a-b)<=tol;
  const near=(d)=>{ if(!date||!d) return true; const dd=Math.abs((new Date(date)-new Date(d))/86400000); return dd<=6; };
  for(const t of G.txns){
    if(t.type==='BUY'){ const c=num(t.price)*num(t.quantity)+num(t.fees); if(amt<0&&within(Math.abs(amt),c)&&near(t.date)) return {kind:'matched',label:'matches BUY '+(t.ticker||t.equity)}; }
    if(t.type==='SELL'){ const p=num(t.price)*num(t.quantity)-num(t.fees); if(amt>0&&within(amt,p)&&near(t.date)) return {kind:'matched',label:'matches SELL '+(t.ticker||t.equity)}; }
    if(t.type==='DIVIDEND'){ if(amt>0&&within(amt,num(t.dividend))&&near(t.date)) return {kind:'matched',label:'matches DIVIDEND '+(t.ticker||t.equity)}; }
  }
  return amt>0?{kind:'unmatched-credit',label:'unmatched credit — likely dividend'}:{kind:'unmatched-debit',label:'unmatched debit — review'};
}
function previewImport(){
  const recs=buildImportRecords(); IMP._recs=recs;
  const host=document.getElementById('impPreview'); if(!host) return;
  if(IMP.kind==='trading'){
    const ok=recs.filter(r=>r._ok).length;
    document.getElementById('impMsg').textContent=`${ok} of ${recs.length} rows look valid and will be appended. Rows missing a date, ticker or amount are skipped.`;
    host.innerHTML=`<div class="scroll"><table><thead><tr><th>Date</th><th>Type</th><th>Ticker</th><th>Equity</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Fees/Amt</th><th></th></tr></thead><tbody>${
      recs.slice(0,10).map(r=>`<tr><td class="mono">${esc(r.date)}</td><td>${esc(r.type)}</td><td class="tick">${esc(r.ticker)}</td><td>${esc(r.equity)}</td><td class="num">${r.type==='DIVIDEND'?'—':fmtQty(r.quantity)}</td><td class="num">${r.type==='DIVIDEND'?'—':fmtNum(r.price,4)}</td><td class="num">${r.type==='DIVIDEND'?fmtSGD(r.dividend):fmtNum(r.fees,2)}</td><td>${r._ok?'<span class="status-ok">ok</span>':'<span class="status-no">skip</span>'}</td></tr>`).join('')
    }</tbody></table></div>${recs.length>10?`<div class="hint">…and ${recs.length-10} more</div>`:''}`;
  } else {
    const inc=recs.filter(r=>r.include).length;
    document.getElementById('impMsg').innerHTML=`Bank rows are corroboration. Matched lines are already in your ledger and won’t be re-added. Tick the credits you want to add as dividends. <b>${inc}</b> selected.`;
    host.innerHTML=`<div class="scroll"><table><thead><tr><th></th><th>Date</th><th class="num">Amount</th><th>Description</th><th>Reconciliation</th><th>Add as</th><th>Ticker</th></tr></thead><tbody>${
      recs.map((r,i)=>`<tr>
        <td><input type="checkbox" data-inc="${i}" ${r.include?'checked':''}></td>
        <td class="mono">${esc(r.date)}</td>
        <td class="num ${r.amount<0?'neg':'pos'}">${fmtSGDsign(r.amount)}</td>
        <td>${esc(r.desc).slice(0,44)}</td>
        <td class="${r.match.kind==='matched'?'status-ok':'status-no'}">${esc(r.match.label)}</td>
        <td><select data-as="${i}"><option ${r.asType==='DIVIDEND'?'selected':''}>DIVIDEND</option><option ${r.asType==='BUY'?'selected':''}>BUY</option><option ${r.asType==='SELL'?'selected':''}>SELL</option></select></td>
        <td><input type="text" class="mono inline-price" data-tk="${i}" value="${esc(r.ticker)}" placeholder="ticker"></td>
      </tr>`).join('')
    }</tbody></table></div>`;
    host.querySelectorAll('input[data-inc]').forEach(c=>c.addEventListener('change',()=>{ recs[+c.dataset.inc].include=c.checked; }));
    host.querySelectorAll('select[data-as]').forEach(s=>s.addEventListener('change',()=>{ recs[+s.dataset.as].asType=s.value; }));
    host.querySelectorAll('input[data-tk]').forEach(t=>t.addEventListener('input',()=>{ recs[+t.dataset.tk].ticker=t.value.trim().toUpperCase(); }));
  }
}
async function commitImport(){
  const recs=IMP._recs||[]; let toAdd=[];
  if(IMP.kind==='trading'){
    toAdd=recs.filter(r=>r._ok).map(r=>{ const c=Object.assign({},r); delete c._ok; return c; });
  } else {
    for(const r of recs){ if(!r.include) continue;
      if(!r.ticker){ toast('Tick rows need a ticker before adding'); return; }
      const base={owner:r.owner,date:r.date,ticker:r.ticker,equity:r.ticker,currency:'SGD',note:r.note,type:r.asType};
      if(r.asType==='DIVIDEND') base.dividend=Math.abs(r.amount);
      else { base.price=Math.abs(r.amount); base.quantity=1; base.fees=0; base.note+=' (verify qty/price)'; }
      toAdd.push(base);
    }
  }
  if(!toAdd.length){ toast('Nothing selected to append'); return; }
  await sBulkAdd('transactions',toAdd);
  IMP=null; document.getElementById('mapArea').innerHTML='';
  await loadAll(); renderAll(); markDirty(); toast(toAdd.length+' transaction(s) appended');
}

/* ---------- wiring ---------- */
function wire(){
  document.getElementById('ownerFilter').addEventListener('change',e=>{ state.owner=e.target.value; renderAll(); });
  document.getElementById('fyFilter').addEventListener('change',e=>{ state.fy=Number(e.target.value); renderFY(); renderHoldings(); renderYearStrip(); });
  document.getElementById('recentFilter').addEventListener('input',e=>{ state.recentFilter=e.target.value; renderRecent(); });
  document.getElementById('cancelEditBtn').addEventListener('click',cancelEdit);
  document.getElementById('f_ticker').addEventListener('change',autofillEquity);
  document.querySelector('#holdingsTable thead').addEventListener('click',e=>{
    const th=e.target.closest('th[data-sort]'); if(!th) return;
    const k=th.dataset.sort;
    if(state.sortKey===k) state.sortDir=-state.sortDir; else { state.sortKey=k; state.sortDir = (k==='name'||k==='owner')?1:-1; }
    renderHoldings();
  });
  window.addEventListener('scroll',()=>{ document.getElementById('miniBar').classList.toggle('show', window.scrollY>280); },{passive:true});
  document.getElementById('basisFilter').addEventListener('change',e=>setBasis(e.target.value));
  document.getElementById('f_type').addEventListener('change',syncFormFields);
  document.getElementById('txForm').addEventListener('submit',submitTx);
  document.getElementById('openBasisSel').addEventListener('change',saveBoundary);
  document.getElementById('openingVal').addEventListener('change',saveBoundary);
  document.getElementById('closingVal').addEventListener('change',saveBoundary);
  document.getElementById('useLiveBtn').addEventListener('click',useLive);
  document.getElementById('recomputeBtn').addEventListener('click',async()=>{ await loadAll(); renderHoldings(); renderFY(); toast('Market values recomputed'); });
  document.getElementById('ibkrBtn').addEventListener('click',pullLive);
  document.getElementById('refreshPricesBtn').addEventListener('click',pullLive);
  document.getElementById('resetBtn').addEventListener('click',resetToBundled);
  document.getElementById('xlsxBtn').addEventListener('click',exportXlsx);
  document.getElementById('csvBtn').addEventListener('click',()=>exportCsv(false));
  document.getElementById('pdfBtn').addEventListener('click',exportHoldingsPdf);
  document.getElementById('jsonBtn').addEventListener('click',backupJson);
  document.getElementById('restoreInput').addEventListener('change',e=>{ if(e.target.files[0]) restoreJson(e.target.files[0]); e.target.value=''; });
  document.getElementById('demoBtn').addEventListener('click',loadDemo);
  document.getElementById('clearBtn').addEventListener('click',clearAll);
  document.getElementById('fileInput').addEventListener('change',e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); e.target.value=''; });
  const dz=document.getElementById('dropZone');
  ['dragover','dragenter'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop',e=>{ const f=e.dataTransfer.files[0]; if(f) handleFile(f); });
  document.getElementById('f_date').value=todayISO();
  syncFormFields();
}
async function saveBoundary(){
  const key=boundaryKey(state.owner,state.fy);
  const ov=document.getElementById('openingVal').value, cv=document.getElementById('closingVal').value;
  const ob=document.getElementById('openBasisSel').value==='COST'?'COST':'MARKET';
  await sPut('boundaries',{key,owner:state.owner,fy:state.fy,openingBasis:ob,openingValue:ov===''?null:Number(ov),closingValue:cv===''?'':Number(cv)});
  await loadAll(); renderFY(); renderHoldings(); markDirty(); toast('Boundary saved');
}
async function useLive(){
  const b=currentBoundary();
  const fy=computePeriod(G.txns,state.owner,state.fy,state.basis,{openingValue:b.openingValue,openingBasis:b.openingBasis},pricesMap(),G.histPrices);
  document.getElementById('closingVal').value=Number(fy.closingValue.toFixed(2));
  await saveBoundary();
  if(fy.closeDate!==fy.end) toast('Filled from current prices (today).');
  else toast('Filled from current prices — note these are today’s, not the historical 31 Mar close.');
}

/* Start-up lives in boot.js (runs after every tab module has loaded). */