const e=require('../src/engine.js');
let fails=0;
function assert(name,cond){ console.log((cond?'PASS':'FAIL')+': '+name); if(!cond) fails++; }
function close(a,b,t){ t=t||1e-6; return Math.abs(a-b)<=t; }

const O='Ong Ah Whatt';
// Hand-verified scenario: two buys, a dividend, a partial FIFO sale.
const txns=[
 {id:1,equity:'ABC Corp',ticker:'ABC',date:'2024-05-10',type:'BUY',owner:O,quantity:100,price:10,fees:20,currency:'SGD'},
 {id:2,equity:'ABC Corp',ticker:'ABC',date:'2024-08-01',type:'BUY',owner:O,quantity:100,price:12,fees:20,currency:'SGD'},
 {id:3,equity:'ABC Corp',ticker:'ABC',date:'2024-11-15',type:'DIVIDEND',owner:O,dividend:45,currency:'SGD'},
 {id:4,equity:'ABC Corp',ticker:'ABC',date:'2025-02-01',type:'SELL',owner:O,quantity:150,price:15,fees:30,currency:'SGD'},
];
const abc=e.computePositions(txns).find(p=>p.ticker==='ABC');
assert('qtyHeld = 50', close(abc.qtyHeld,50));
assert('adjustedCost = 610 (50 @ 12.20 remaining of lot2)', close(abc.adjustedCost,610));
assert('avgCost = 12.20', close(abc.avgCost,12.2));
assert('realised = 590 (2220 proceeds - 1630 FIFO cost)', close(abc.realised,590));
assert('realised in FY2025 = 590', close(abc.realisedByFY[2025],590));
assert('dividends = 45', close(abc.dividends,45));

const prices={ABC:13};
const fy=e.computeFY(txns,'ALL',2025,{openingValue:0,closingValue:650},prices);
assert('FY buys = 2240', close(fy.buys,2240));
assert('FY sells = 2220', close(fy.sells,2220));
assert('FY dividends = 45', close(fy.dividends,45));
assert('FY realised = 590', close(fy.realisedFY,590));
assert('dollarReturn = 675', close(fy.dollarReturn,675));
assert('xirr finite', fy.xirr!=null && isFinite(fy.xirr));
assert('xirr positive', fy.xirr>0);
const t0=Math.min.apply(null,fy.flows.map(f=>new Date(f.date+'T00:00:00Z').getTime()));
const npv=r=>fy.flows.reduce((s,f)=>s+f.amount/Math.pow(1+r,(new Date(f.date+'T00:00:00Z').getTime()-t0)/(365*24*3600*1000)),0);
assert('npv(xirr) ~ 0', close(npv(fy.xirr),0,1e-3));

// Live closing fallback (no closingValue supplied -> use market value at close).
const fy2=e.computeFY(txns,'ALL',2025,{openingValue:0},prices);
assert('closing live = 650 and flagged', close(fy2.closingValue,650) && fy2.closingIsLive===true);
assert('dollarReturn live = 675', close(fy2.dollarReturn,675));

// Oversold: selling more than held is flagged, not silently wrong.
const ov=[{id:1,ticker:'X',equity:'X',date:'2024-05-01',type:'BUY',owner:O,quantity:10,price:5,fees:0},
 {id:2,ticker:'X',equity:'X',date:'2024-06-01',type:'SELL',owner:O,quantity:25,price:6,fees:0}];
const povr=e.computePositions(ov).find(p=>p.ticker==='X');
assert('oversold flagged, shortfall 15', povr.oversold===true && close(povr.shortfall,15));

// Corporate action: 2:1 split adjusts qty and cost, leaves realised correct.
const sp=[{id:1,ticker:'S',equity:'S',date:'2024-01-10',type:'BUY',owner:O,quantity:100,price:10,fees:0},
 {id:2,ticker:'S',equity:'S',date:'2024-02-10',type:'CORPORATE_ACTION',owner:O,factor:2},
 {id:3,ticker:'S',equity:'S',date:'2024-03-10',type:'SELL',owner:O,quantity:50,price:6,fees:0}];
const ps=e.computePositions(sp).find(p=>p.ticker==='S');
assert('split qtyHeld = 150', close(ps.qtyHeld,150));
assert('split avgCost = 5.00', close(ps.avgCost,5));
assert('split realised = 50', close(ps.realised,50));

// XIRR with no sign change returns null.
assert('xirr no-sign-change = null', e.xirr([{date:'2024-01-01',amount:-100},{date:'2024-06-01',amount:-50}])===null);

// FY labelling boundaries.
assert('1 Apr 2024 -> FY2025', e.fyEndYear('2024-04-01')===2025);
assert('31 Mar 2025 -> FY2025', e.fyEndYear('2025-03-31')===2025);
assert('1 Apr 2025 -> FY2026', e.fyEndYear('2025-04-01')===2026);

console.log('\n'+(fails===0?'ALL TESTS PASSED':fails+' TEST(S) FAILED'));
process.exit(fails===0?0:1);
