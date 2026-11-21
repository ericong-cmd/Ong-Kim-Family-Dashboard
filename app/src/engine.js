function todayISO(d){
  d = d || new Date();
  const y=d.getUTCFullYear(), m=String(d.getUTCMonth()+1).padStart(2,'0'), day=String(d.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function fyEndYear(dateStr){
  const d = new Date(dateStr + (dateStr.length<=10 ? 'T00:00:00Z' : ''));
  const m = d.getUTCMonth(), y = d.getUTCFullYear();
  return m>=3 ? y+1 : y;
}
function fyBounds(endYear){ return { start:`${endYear-1}-04-01`, end:`${endYear}-03-31` }; }
function fyLabel(endYear){ return `FY ending 31 Mar ${endYear}`; }
// --- period basis: 'FY' (1 Apr - 31 Mar) or 'CY' (1 Jan - 31 Dec) ---
function cyYear(dateStr){ return Number(String(dateStr).slice(0,4)); }
function periodKey(dateStr, basis){ return basis==='CY' ? cyYear(dateStr) : fyEndYear(dateStr); }
function periodBounds(key, basis){ return basis==='CY' ? {start:`${key}-01-01`, end:`${key}-12-31`} : fyBounds(key); }
function periodLabel(key, basis){ return basis==='CY' ? `CY ${key}` : fyLabel(key); }
function periodOpenLabel(basis){ return basis==='CY' ? 'Opening value · 1 Jan' : 'Opening value · 1 Apr'; }
function periodCloseLabel(basis){ return basis==='CY' ? 'Closing value · 31 Dec' : 'Closing value · 31 Mar'; }
const TYPE_ORDER = { OPENING:0, BUY:1, CORPORATE_ACTION:2, DIVIDEND:3, SELL:4 };
function num(x){ const n=Number(x); return isFinite(n)?n:0; }
function computePositions(txns, opts){
  opts = opts||{};
  const asOf = opts.asOf || null;
  const list = txns
    .filter(t=> !asOf || t.date <= asOf)
    .slice()
    .sort((a,b)=>{
      if(a.date!==b.date) return a.date<b.date?-1:1;
      const to=(TYPE_ORDER[a.type]??9)-(TYPE_ORDER[b.type]??9);
      if(to!==0) return to;
      return (a.id||0)-(b.id||0);
    });
  const positions = {};
  function P(owner,ticker,name){
    const k = owner+'|'+ticker;
    if(!positions[k]) positions[k]={owner,ticker,name:name||ticker,currency:'SGD',lots:[],realised:0,realisedByFY:{},realisedByCY:{},dividends:0,dividendsByFY:{},dividendsByCY:{},oversold:false,shortfall:0};
    if(name) positions[k].name=name;
    return positions[k];
  }
  for(const t of list){
    const p=P(t.owner, t.ticker||t.equity, t.equity||t.ticker);
    if(t.currency) p.currency=t.currency;
    const q=num(t.quantity), price=num(t.price), fees=num(t.fees);
    if(t.type==='BUY' || t.type==='OPENING'){
      const total = price*q + (t.type==='BUY'?fees:0);
      const cps = q!==0 ? total/q : 0;
      p.lots.push({qty:q, cps, date:t.date});
    } else if(t.type==='SELL'){
      const proceeds = price*q - fees;
      const avail = p.lots.reduce((s,l)=>s+l.qty,0);
      if(q>avail+1e-9){ p.oversold=true; p.shortfall += (q-avail); }
      let toSell=q, cost=0;
      while(toSell>1e-9 && p.lots.length){
        const lot=p.lots[0];
        const take=Math.min(lot.qty,toSell);
        cost += take*lot.cps;
        lot.qty-=take; toSell-=take;
        if(lot.qty<=1e-9) p.lots.shift();
      }
      const realised = proceeds - cost;
      const fy=fyEndYear(t.date), cy=cyYear(t.date);
      p.realised+=realised; p.realisedByFY[fy]=(p.realisedByFY[fy]||0)+realised;
      p.realisedByCY[cy]=(p.realisedByCY[cy]||0)+realised;
    } else if(t.type==='DIVIDEND'){
      const amt=num(t.dividend); const fy=fyEndYear(t.date), cy=cyYear(t.date);
      p.dividends+=amt; p.dividendsByFY[fy]=(p.dividendsByFY[fy]||0)+amt;
      p.dividendsByCY[cy]=(p.dividendsByCY[cy]||0)+amt;
    } else if(t.type==='CORPORATE_ACTION'){
      const factor = num(t.factor)||1;
      if(factor>0) for(const lot of p.lots){ lot.qty*=factor; lot.cps/=factor; }
    }
  }
  return Object.values(positions).map(p=>{
    const qtyHeld=p.lots.reduce((s,l)=>s+l.qty,0);
    const adjustedCost=p.lots.reduce((s,l)=>s+l.qty*l.cps,0);
    const avgCost = qtyHeld>1e-9 ? adjustedCost/qtyHeld : 0;
    return Object.assign({}, p, {qtyHeld, adjustedCost, avgCost});
  });
}
// Set of owner|ticker keys that held stock at any instant during the period — i.e. came into the
// period holding it, or acquired it (BUY/OPENING) inside the period. A position sold off before the
// period, or first bought after it, is absent. Used to scope the holdings table to the selected year.
function heldDuringPeriod(txns, ownerScope, endYear, basis){
  basis = basis==='CY' ? 'CY' : 'FY';
  const {start,end}=periodBounds(endYear,basis);
  const scoped = txns.filter(t=> ownerScope==='ALL'||t.owner===ownerScope);
  const keys = new Set();
  // Held coming into the period (quantity on hand at the close of the day before it began).
  computePositions(scoped,{asOf:prevDay(start)}).forEach(p=>{ if(p.qtyHeld>1e-6) keys.add(p.owner+'|'+p.ticker); });
  // Acquired stock during the period, even if sold again before it ended.
  scoped.forEach(t=>{ if((t.type==='BUY'||t.type==='OPENING') && t.date>=start && t.date<=end) keys.add(t.owner+'|'+(t.ticker||t.equity)); });
  return keys;
}
function liveValue(txns, ownerScope, asOf, prices){
  const scoped = txns.filter(t=> ownerScope==='ALL'||t.owner===ownerScope);
  const positions = computePositions(scoped, {asOf});
  let v=0;
  positions.forEach(p=>{ if((p.currency||'SGD')!=='SGD') return; const pr=prices?prices[p.ticker]:null; if(pr!=null && isFinite(pr)) v += p.qtyHeld*pr; });
  return v;
}
function xirr(flows){
  const fs = flows.filter(f=> Math.abs(f.amount)>1e-12);
  if(fs.length<2) return null;
  if(!fs.some(f=>f.amount>0) || !fs.some(f=>f.amount<0)) return null;
  const times = fs.map(f=> new Date(f.date+'T00:00:00Z').getTime());
  const t0 = Math.min.apply(null, times);
  const yf = i => (times[i]-t0)/(365*24*3600*1000);
  const npv = r => fs.reduce((s,f,i)=> s + f.amount/Math.pow(1+r, yf(i)), 0);
  const dnpv = r => fs.reduce((s,f,i)=> s - yf(i)*f.amount/Math.pow(1+r, yf(i)+1), 0);
  let r=0.1;
  for(let i=0;i<80;i++){
    const v=npv(r), d=dnpv(r);
    if(!isFinite(v)||!isFinite(d)||d===0) break;
    let rn=r-v/d;
    if(rn<=-0.9999) rn=(r-0.9999)/2;
    if(!isFinite(rn)) break;
    if(Math.abs(rn-r)<1e-11){ r=rn; break; }
    r=rn;
  }
  if(isFinite(r) && r>-0.9999 && Math.abs(npv(r))<1e-6) return r;
  let lo=-0.9999, hi=1000, flo=npv(lo), fhi=npv(hi);
  if(!(isFinite(flo)&&isFinite(fhi))) return null;
  if(flo*fhi>0){
    let found=false, prevR=lo, prevV=flo;
    for(let i=1;i<=400;i++){
      const rr=lo+(hi-lo)*i/400, vv=npv(rr);
      if(isFinite(vv)&&prevV*vv<=0){ lo=prevR; hi=rr; flo=prevV; found=true; break; }
      prevR=rr; prevV=vv;
    }
    if(!found) return null;
  }
  for(let i=0;i<200;i++){
    const mid=(lo+hi)/2, vm=npv(mid);
    if(!isFinite(vm)) return null;
    if(Math.abs(vm)<1e-7) return mid;
    if(flo*vm<0){ hi=mid; } else { lo=mid; flo=vm; }
  }
  const mid=(lo+hi)/2;
  return Math.abs(npv(mid))<1e-4 ? mid : null;
}
// Calendar day before an ISO date. The opening point is the last day of the previous month:
// 1 Apr opens on 31 Mar, 1 Jan opens on 31 Dec.
function prevDay(iso){ const d=new Date(iso+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()-1); return d.toISOString().slice(0,10); }
// Total adjusted cost of SGD positions still held at a date — the cost-basis opening value.
// Needs no market data: the ledger already knows what each holding cost.
function costBasisAt(txns, ownerScope, dateISO){
  const scoped = txns.filter(t=> (ownerScope==='ALL'||t.owner===ownerScope) && (t.currency||'SGD')==='SGD');
  return computePositions(scoped,{asOf:dateISO}).reduce((s,p)=> s + (p.qtyHeld>1e-9 ? p.adjustedCost : 0), 0);
}
// Market value at a past date: quantity held on that date × that date's close, per holding.
// Returns null (rather than a partial total) if any holding has no price for the date.
function marketValueAt(txns, ownerScope, dateISO, closes){
  const scoped = txns.filter(t=> (ownerScope==='ALL'||t.owner===ownerScope) && (t.currency||'SGD')==='SGD');
  const held = computePositions(scoped,{asOf:dateISO}).filter(p=>p.qtyHeld>1e-9);
  if(!held.length) return {value:0, unpriced:[]};
  const unpriced = held.filter(p=>!closes || closes[p.ticker]==null).map(p=>p.ticker);
  if(unpriced.length) return {value:null, unpriced};
  return {value: held.reduce((s,p)=>s+p.qtyHeld*closes[p.ticker],0), unpriced:[]};
}
function computePeriod(txns, ownerScope, endYear, basis, boundary, prices, histPrices){
  basis = basis==='CY' ? 'CY' : 'FY';
  const {start,end}=periodBounds(endYear,basis);
  const today=todayISO();
  const closeDate = end<=today ? end : today;
  // SGD is the reporting currency: non-SGD trades stay in the ledger but never enter FY figures.
  const scoped = txns.filter(t=> (ownerScope==='ALL'||t.owner===ownerScope) && (t.currency||'SGD')==='SGD');
  const inFY = t => t.date>=start && t.date<=end;
  let buys=0, sells=0, dividends=0, introduced=0;
  const flows=[];
  // Opening value on either basis, both anchored to the same date (last day of the previous month).
  //   MARKET — what the portfolio was worth then. User-supplied; a period return needs it.
  //   COST   — what the holdings cost. Derived from the ledger, so always available, but it
  //            measures gain since purchase, not performance over this period.
  const openingDate = prevDay(start);
  const openingBasis = (boundary && boundary.openingBasis==='COST') ? 'COST' : 'MARKET';
  let openingValue, openingMissing=false, openingSource='NONE', openingUnpriced=[];
  if(openingBasis==='COST'){
    openingValue = costBasisAt(txns, ownerScope, openingDate);
    openingSource = 'COST';
  } else {
    const supplied = boundary && boundary.openingValue!=null && boundary.openingValue!=='';
    if(supplied){
      openingValue = num(boundary.openingValue); openingSource='ENTERED';
    } else {
      // Nothing entered — derive it from that date's closes if we hold one for every position.
      const mv = marketValueAt(txns, ownerScope, openingDate, histPrices && histPrices[openingDate]);
      if(mv.value!=null){ openingValue=mv.value; openingSource = mv.value===0 ? 'EMPTY' : 'DERIVED'; }
      else { openingValue=0; openingMissing=true; openingUnpriced=mv.unpriced; }
    }
  }
  // Closing value. Priority: a manually entered figure; else for a COMPLETED year the actual close on
  // the year-end date (quantity held then × that date's close, from stored history); else live prices.
  // A past year must be valued at its own year-end prices, never today's.
  let closingValue = boundary && boundary.closingValue!=null && boundary.closingValue!=='' ? num(boundary.closingValue) : null;
  let closingSource = closingValue!=null ? 'ENTERED' : null;
  const periodDone = end<=today;
  if(closingValue==null && periodDone){
    const mv = marketValueAt(txns, ownerScope, end, histPrices && histPrices[end]);
    if(mv.value!=null){ closingValue=mv.value; closingSource='HIST'; }
  }
  if(closingValue==null){ closingValue = liveValue(txns, ownerScope, closeDate, prices); closingSource = periodDone?'LIVE_FALLBACK':'LIVE'; }
  const closingIsLive = (closingSource==='LIVE'||closingSource==='LIVE_FALLBACK');
  flows.push({date:start, amount:-openingValue});
  // Modified Dietz base: capital employed over the period, with each external flow weighted by the
  // fraction of the period it was actually invested. This gives an honest UNANNUALISED period
  // return even when large sums arrive mid-year — dividing by the opening value alone would
  // overstate the %, and by opening+all-flows would understate it. Dividends are income, not
  // external capital, so they never enter the base.
  const _t0=Date.parse(start), _span=Math.max(1, Date.parse(closeDate)-_t0);
  const dietzW = dt => Math.min(1, Math.max(0, 1-(Date.parse(dt)-_t0)/_span));
  let dietzFlows=0;
  scoped.filter(inFY).forEach(t=>{
    if(t.type==='BUY'){ const c=num(t.price)*num(t.quantity)+num(t.fees); buys+=c; flows.push({date:t.date,amount:-c}); dietzFlows+=c*dietzW(t.date); }
    else if(t.type==='SELL'){ const pr=num(t.price)*num(t.quantity)-num(t.fees); sells+=pr; flows.push({date:t.date,amount:pr}); dietzFlows-=pr*dietzW(t.date); }
    else if(t.type==='DIVIDEND'){ const a=num(t.dividend); dividends+=a; flows.push({date:t.date,amount:a}); }
    // An OPENING record dated inside the period is stock brought in after the opening valuation was
    // struck. It lands in the closing value, so without a matching inflow the capital reads as profit.
    // Exception: acquired:'EARNED' marks stock received on an existing holding (an in-specie
    // distribution). That genuinely is return, so it takes no inflow and flows through to the gain.
    else if(t.type==='OPENING' && t.acquired!=='EARNED'){ const c=num(t.price)*num(t.quantity); introduced+=c; flows.push({date:t.date,amount:-c}); dietzFlows+=c*dietzW(t.date); }
  });
  flows.push({date:closeDate, amount:closingValue});
  const dollarReturn=(closingValue-openingValue)-buys-introduced+sells+dividends;
  const dietzBase = openingValue + dietzFlows;
  const periodPct = (openingBasis!=='COST' && !openingMissing && dietzBase>1e-9) ? dollarReturn/dietzBase : null;
  const positions=computePositions(scoped);
  let realisedFY=0; positions.forEach(p=> realisedFY+=((basis==='CY'?p.realisedByCY:p.realisedByFY)[endYear]||0));
  // XIRR is only meaningful against a market-value opening. On a cost basis the "opening" cash was
  // committed years ago, not at period start, so annualising it would overstate the rate badly.
  const rate = (openingBasis==='COST' || openingMissing) ? null : xirr(flows);
  // Denominator for the cost ratio is everything put in — opening cost plus purchases made during
  // the period — otherwise mid-period buying inflates the percentage against a stale opening base.
  const gainBase = openingBasis==='COST' ? openingValue+buys+introduced : openingValue;
  const gainPct = gainBase>1e-9 ? dollarReturn/gainBase : null;
  return {endYear,key:endYear,basis,label:periodLabel(endYear,basis),start,end,closeDate,openingDate,openingBasis,openingMissing,openingSource,openingUnpriced,openingValue,closingValue,closingIsLive,buys,sells,dividends,introduced,netInvested:buys+introduced-sells,realisedFY,realisedPeriod:realisedFY,dollarReturn,gainPct,periodPct,dietzBase,xirr:rate,closingSource,periodDone,flows};
}
// Back-compat wrapper: financial-year basis.
function computeFY(txns, ownerScope, endYear, boundary, prices){
  return computePeriod(txns, ownerScope, endYear, 'FY', boundary, prices);
}
// ---------- declared dividends (IBKR corporate actions) ----------
// IBKR returns corp_actions as {type, date:'YYYYMMDD' (XD), announce_date, payment_date, value, currency}
// per ticker. Normalise to {ticker, type, xd, pay, announced, dps, currency}.
function _ymd(s){ s=String(s||''); return /^\d{8}$/.test(s) ? s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8) : (s.slice(0,10)||null); }
function normaliseCorpActions(byTicker){
  const out=[];
  Object.entries(byTicker||{}).forEach(([tk,list])=>(list||[]).forEach(a=>{
    out.push({ticker:String(tk).toUpperCase(), type:a.type||'CashDividends', xd:_ymd(a.date), pay:_ymd(a.payment_date), announced:_ymd(a.announce_date),
      dps:Number(a.value), currency:a.currency||'SGD'});
  }));
  return out;
}
function _days(a,b){ return Math.round((Date.parse(a)-Date.parse(b))/86400000); }
// Entitlement = shares held at the close of the day before XD (a buy dated on/after XD does not
// qualify; a sale on/after XD keeps it), per owner. Booked on the XD date — the right to receive is
// established then (SFRS(I) 9) — with the payment date kept for the bank match.
// status: 'book' (XD passed, not in the ledger yet) · 'booked' (already in the ledger) ·
// 'upcoming' (XD ahead; estimate on today's holding) · 'other' (non-cash action, reported only).
// XDs older than opts.sinceDays (default 60) are left alone.
function dividendEntitlements(txns, actions, opts){
  opts=opts||{};
  const today=opts.today||todayISO(), since=opts.sinceDays==null?60:opts.sinceDays;
  const divs=(txns||[]).filter(t=>t.type==='DIVIDEND');
  const res=[];
  (actions||[]).forEach(a=>{
    if(!a.xd || _days(today,a.xd)>since) return;
    if(a.type!=='CashDividends'){ res.push({ticker:a.ticker,type:a.type,xd:a.xd,pay:a.pay,dps:a.dps,status:'other'}); return; }
    if(!(a.dps>0)) return;
    const upcoming=a.xd>today;
    const asOf=upcoming?today:prevDay(a.xd);
    const scoped=(txns||[]).filter(t=>String(t.ticker||'').toUpperCase()===a.ticker);
    computePositions(scoped,{asOf}).forEach(p=>{
      if(!(p.qtyHeld>1e-6)) return;
      const qty=p.qtyHeld, amount=Math.round(qty*a.dps*100)/100;
      const caKey=a.ticker+'|'+a.xd+'|'+a.dps;
      const r={ticker:a.ticker,owner:p.owner,equity:p.name,type:a.type,xd:a.xd,pay:a.pay,announced:a.announced,dps:a.dps,currency:a.currency,qty,amount,caKey,status:upcoming?'upcoming':'book',matchId:null};
      if(!upcoming){
        const end=a.pay&&a.pay>a.xd?a.pay:a.xd;
        const hit=divs.find(t=>t.caKey===caKey&&t.owner===p.owner)
          || divs.find(t=>String(t.ticker||'').toUpperCase()===a.ticker && t.owner===p.owner && _days(t.date,a.xd)>=-7 && _days(t.date,end)<=14);
        if(hit){ r.status='booked'; r.matchId=hit.id; r.bookedAmount=num(hit.dividend); }
      }
      res.push(r);
    });
  });
  return res.sort((x,y)=>x.xd<y.xd?-1:x.xd>y.xd?1:(x.ticker<y.ticker?-1:1));
}
// Ledger DIVIDEND records for entitlements to book.
function dividendRecords(ents){
  return (ents||[]).filter(e=>e.status==='book').map(e=>({type:'DIVIDEND',owner:e.owner,ticker:e.ticker,equity:e.equity,date:e.xd,
    paymentDate:e.pay||null,dividend:e.amount,quantity:0,currency:e.currency||'SGD',caKey:e.caKey,source:'IBKR corporate action',
    note:'Declared dividend '+e.dps+'/sh × '+e.qty.toLocaleString('en-SG')+' sh · XD '+e.xd+(e.pay?' · payable '+e.pay:'')+' · added from IBKR corporate actions'}));
}
if(typeof module!=='undefined' && module.exports){
  module.exports={todayISO,fyEndYear,fyBounds,fyLabel,cyYear,periodKey,periodBounds,periodLabel,computePositions,liveValue,xirr,computeFY,computePeriod,costBasisAt,prevDay,marketValueAt,heldDuringPeriod,normaliseCorpActions,dividendEntitlements,dividendRecords};
}
