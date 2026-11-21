// Rules across markets (SGX, Bursa Malaysia, HKEX, US): ticker keys, IBKR listing filter, and each
// market's own tick table for rounding the Fibonacci levels.
const c = require('../src/calc.js');
let failed = 0; const ok = (cond, n) => { console.log((cond ? '  PASS' : '  FAIL') + '  ' + n); if (!cond) failed++; };

// keys: SGX tickers stay bare (back-compatible); other markets carry a suffix
ok(c.marketOfKey('D05') === 'SG' && c.marketOfKey('700.HK') === 'HK' && c.marketOfKey('MAYBANK.MY') === 'MY' && c.marketOfKey('AAPL.US') === 'US', 'market from key');
ok(c.symbolOfKey('700.HK') === '700' && c.symbolOfKey('D05') === 'D05' && c.symbolOfKey('BRK.B.US') === 'BRK.B', 'symbol from key (dots inside US symbols kept)');
ok(c.listingMarket('SGX') === 'SG' && c.listingMarket('BURSAMY') === 'MY' && c.listingMarket('SEHK') === 'HK' && c.listingMarket('NASDAQ') === 'US' && c.listingMarket('NYSE') === 'US', 'IBKR exchange → market');
ok(c.listingMarket('PINK') === null && c.listingMarket('FWB') === null && c.listingMarket('MEXI') === null, 'OTC and other exchanges are not offered');
ok(c.listingKey('D05', 'SGX') === 'D05' && c.listingKey('700', 'SEHK') === '700.HK' && c.listingKey('AAPL', 'NASDAQ') === 'AAPL.US', 'listing → key');

// IBKR search rows → choices (STK on the four markets only, optional market filter)
const rows = [
  { underlying_contract_id: 152791428, exchange: 'SEHK', symbol: '700', description: 'TENCENT HOLDINGS LTD', country_code: 'HK', sections: [{ security_type: 'STK' }] },
  { underlying_contract_id: 55279376, exchange: 'PINK', symbol: 'TCEHY', description: 'TENCENT HOLDINGS LTD-UNS ADR', sections: [{ security_type: 'STK' }] },
  { underlying_contract_id: 739709087, exchange: 'SGX', symbol: 'HTCD', description: 'TENCENT HOLDINGS LTD-SDR', sections: [{ security_type: 'STK' }] },
  { issuer: 'e1401278', description: 'Tencent Holdings Ltd', sections: [{ security_type: 'BOND' }] },
  { underlying_contract_id: 911897789, exchange: 'KALSHI', symbol: 'KX', description: 'x', sections: [{ security_type: 'IND' }] }
];
const all = c.listingChoices(rows), hk = c.listingChoices(rows, 'HK');
ok(all.length === 2 && all[0].key === '700.HK' && all[0].currency === 'HKD' && all[0].conid === 152791428 && all[0].name === 'TENCENT HOLDINGS LTD', 'search rows → HKEX and SGX stocks only (no OTC, bonds, indices)');
ok(hk.length === 1 && hk[0].key === '700.HK', 'market filter');

// tick tables
ok(c.tickSize(0.25, 'HK') === 0.001 && c.tickSize(0.3, 'HK') === 0.005 && c.tickSize(9.9, 'HK') === 0.01 && c.tickSize(15, 'HK') === 0.02 && c.tickSize(450, 'HK') === 0.2 && c.tickSize(600, 'HK') === 0.5, 'HKEX spread table');
ok(c.tickSize(0.995, 'MY') === 0.005 && c.tickSize(9.5, 'MY') === 0.01 && c.tickSize(10, 'MY') === 0.02 && c.tickSize(120, 'MY') === 0.1, 'Bursa tick table');
ok(c.tickSize(0.5, 'US') === 0.0001 && c.tickSize(190, 'US') === 0.01, 'US: $0.0001 under $1, $0.01 above');
ok(c.tickSize(0.15) === 0.001 && c.tickSize(0.5, 'SG') === 0.005 && c.tickSize(12) === 0.01, 'SGX unchanged (default)');
ok(c.roundToTick(452.37, 'HK') === 452.4 && c.roundToTick(452.37) === 452.37 && c.roundToTick(10.031, 'MY') === 10.04 && c.roundToTick(0.12345, 'US') === 0.1235, 'round to the market tick');
ok(c.onTick(452.4, 'HK') && !c.onTick(452.3 + 0.05, 'HK') && c.onTick(10.04, 'MY') && !c.onTick(10.03, 'MY'), 'on-tick per market');
const rec = c.fibRecommend(520, 400, 'HK');
ok(rec && [rec.buy1, rec.buy2, rec.buy3, rec.cut, rec.sell1, rec.sell2, rec.sell3].every(v => c.onTick(v, 'HK')) && rec.buy2 === 460 && rec.sell1 === 520, 'Fibonacci proposal rounded to HKEX ticks');
ok(JSON.stringify(c.fibRecommend(2, 1)) === JSON.stringify(c.fibRecommend(2, 1, 'SG')), 'SGX proposal unchanged without a market');

console.log(failed ? '\n' + failed + ' TEST(S) FAILED' : '\nALL TESTS PASSED');
process.exit(failed ? 1 : 0);
