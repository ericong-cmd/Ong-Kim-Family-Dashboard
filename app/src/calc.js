/* calc.js — pure functions for the family-office dashboard. No DOM. Node-testable.
   Loaded in the browser as a plain script (globals) and in Node via module.exports. */

// ---------- SGX prices ----------
// SGX minimum bid sizes: < S$0.20 → 0.001 · S$0.20 to < S$1.00 → 0.005 · ≥ S$1.00 → 0.01
function sgxTick(p){ p = Math.abs(Number(p) || 0); return p < 0.2 ? 0.001 : p < 1 ? 0.005 : 0.01; }
function roundToTick(p){
  if (p == null || !isFinite(p)) return null;
  const t = sgxTick(p);
  return Number((Math.round(p / t) * t).toFixed(3));
}
function onTick(p){
  if (p == null || !isFinite(p)) return false;
  const t = sgxTick(p);
  return Math.abs(p / t - Math.round(p / t)) < 1e-6;
}
// Quotes carry float noise (1.1300000000000001). Snap to the tick when within noise; else keep 6dp.
function snapToTick(p){
  if (p == null || !isFinite(p)) return null;
  return onTick(p) ? roundToTick(p) : Number(Number(p).toFixed(6));
}

// ---------- Fibonacci ----------
function fibLevels(H, L){
  H = Number(H); L = Number(L);
  if (!(isFinite(H) && isFinite(L) && H > L)) return null;
  const R = H - L;
  return { high: H, low: L, range: R,
    r236: H - 0.236 * R, r382: H - 0.382 * R, r500: H - 0.5 * R, r618: H - 0.618 * R, r786: H - 0.786 * R,
    e1000: H, e1272: L + 1.272 * R, e1618: L + 1.618 * R };
}
// Buy 1-3 at the 38.2 / 50 / 61.8 retracements, cut loss at 78.6, sells at the prior high and the
// 127.2 / 161.8 extensions — all rounded to a tradeable SGX tick.
function fibRecommend(H, L){
  const f = fibLevels(H, L); if (!f) return null;
  return { buy1: roundToTick(f.r382), buy2: roundToTick(f.r500), buy3: roundToTick(f.r618), cut: roundToTick(f.r786),
    sell1: roundToTick(f.e1000), sell2: roundToTick(f.e1272), sell3: roundToTick(f.e1618) };
}
function isoDay(t){ return String(t || '').slice(0, 10); }
function swingFromBars(b){
  if (!b || !b.time || !b.time.length) return null;
  let hi = -Infinity, hiI = -1, lo = Infinity, loI = -1;
  for (let i = 0; i < b.time.length; i++){
    const h = Number(b.high[i]), l = Number(b.low[i]);
    if (h > hi){ hi = h; hiI = i; }
    if (l < lo){ lo = l; loI = i; }
  }
  if (hiI < 0 || loI < 0) return null;
  return { high: hi, highDate: isoDay(b.time[hiI]), low: lo, lowDate: isoDay(b.time[loI]), trend: loI < hiI ? 'up' : 'down' };
}
function ruleStatus(last, r){
  if (last == null || !isFinite(last) || !r) return 'unknown';
  if (r.cut != null && last <= r.cut) return 'cut';
  if (r.sell1 != null && last >= r.sell1) return 'profit';
  if (r.buy1 != null && last <= r.buy1) return 'buy';
  return 'hold';
}
function buyTier(last, r){
  if (last == null || !r) return 0;
  if (r.buy3 != null && last <= r.buy3) return 3;
  if (r.buy2 != null && last <= r.buy2) return 2;
  if (r.buy1 != null && last <= r.buy1) return 1;
  return 0;
}

// ---------- parsing primitives ----------
function parseCSV(text){
  text = String(text || '').replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (q){ if (ch === '"'){ if (text[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ','){ row.push(cur); cur = ''; }
    else if (ch === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length){ row.push(cur); rows.push(row); }
  return rows.map(r => r.map(x => x.replace(/^﻿/, '').trim())).filter(r => r.some(x => x !== ''));
}
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function toISODate(s){
  s = String(s == null ? '' : s).trim(); let m;
  if ((m = s.match(/^(\d{5})(\.\d+)?$/))){                       // Excel serial (days since 1899-12-30)
    return new Date(Date.UTC(1899, 11, 30) + Number(m[1]) * 86400000).toISOString().slice(0, 10);
  }
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/))) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  if ((m = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3})[a-z]*[\s\-]+(\d{4})$/))){
    const mi = MONTHS.indexOf(m[2].toLowerCase()); if (mi >= 0) return m[3] + '-' + String(mi + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }
  return null;
}
function toNum(s){
  if (s == null) return 0;
  if (typeof s === 'number') return isFinite(s) ? s : 0;
  const t = String(s).replace(/[,\s$]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = Number(t); return isFinite(n) ? n : 0;
}
function to24h(t){
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return '';
  let h = Number(m[1]); const ap = (m[4] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + m[2] + ':' + (m[3] || '00');
}
function round2(x){ return Math.round(Number(x) * 100) / 100; }
function dayDiff(a, b){ return Math.round((Date.parse(a) - Date.parse(b)) / 86400000); }

// ---------- bank statements ----------
function makeIndex(hdr){
  const l = hdr.map(x => String(x).toLowerCase());
  const f = (...res) => { for (const re of res){ const i = l.findIndex(x => re.test(x)); if (i >= 0) return i; } return -1; };
  return { account: f(/^account number$/), date: f(/^date$/, /transaction date/, /^date/), valueDate: f(/value date/),
    time: f(/^time$/), desc: f(/^description$/, /description|particulars|details/), ref1: f(/your reference/, /^reference$/),
    ref2: f(/our reference/), remarks: f(/^remarks?$/, /remark/), dep: f(/^deposit$/, /deposit|credit|money in/),
    wd: f(/^withdrawal$/, /withdraw|debit|money out/), bal: f(/ledger balance/, /balance/) };
}
function categorise(l){
  const d = String(l.description || '').toUpperCase();
  const x = (String(l.ref || '') + ' ' + String(l.remarks || '')).toUpperCase();
  if (l.deposit > 0 && (/DIVIDEND|DISTRIBUTION/.test(d) || /\bCDP-/.test(x))) return 'dividend';
  if (l.withdrawal > 0 && /\bDIV\b|DIVIDEND/.test(x + ' ' + d)) return 'payout';
  if (/SVC\s*CHG|SERVICE CHARGE|\bFEE\b|\bCHARGES?\b/.test(d)) return 'fee';
  if (/\bSES\b|-SES\b/.test(d)) return 'settlement';
  if (/INTEREST/.test(d)) return 'interest';
  if (/TRANSFER|PAYNOW|FAST|GIRO|\bIBG\b|MEPS|FUNDS/.test(d)) return 'transfer';
  return 'other';
}
function lineKey(l){
  return [l.account, l.date, l.time, l.ref, l.description, l.deposit.toFixed(2), l.withdrawal.toFixed(2), l.balance == null ? '' : l.balance.toFixed(2)].join('|');
}
function lineFrom(r, col, acct, i){
  const g = k => col[k] >= 0 ? String(r[col[k]] == null ? '' : r[col[k]]).trim() : '';
  const line = { account: g('account') || acct || '', date: toISODate(g('date')) || toISODate(g('valueDate')),
    valueDate: toISODate(g('valueDate')), time: to24h(g('time')), description: g('desc'),
    ref: [g('ref1'), g('ref2')].filter(Boolean).join(' / '), remarks: g('remarks'),
    deposit: Math.abs(toNum(g('dep'))), withdrawal: Math.abs(toNum(g('wd'))),
    balance: col.bal >= 0 && g('bal') !== '' ? toNum(g('bal')) : null, seq: i };
  line.category = categorise(line);
  line.key = lineKey(line);
  return line;
}
function parseBankStatement(rows){
  const out = { account: '', accountName: '', from: null, to: null, lines: [], format: null };
  const tag = r => String(r[0] || '').trim().toUpperCase();
  const d1 = rows.find(r => tag(r) === 'D1');
  if (d1){
    out.format = 'dbs';
    const h1 = rows.find(r => tag(r) === 'H1'), h2 = rows.find(r => tag(r) === 'H2');
    if (h1 && h2){
      const ix = n => h1.findIndex(x => String(x).toLowerCase() === n);
      out.account = String(h2[ix('account number')] || '').trim();
      out.accountName = String(h2[ix('account name')] || '').trim();
      out.from = toISODate(h2[ix('date from')]); out.to = toISODate(h2[ix('date to')]);
    }
    const col = makeIndex(d1);
    // DBS exports end with an unquoted legend ("D1 , Detail Desc" / "D2 , Detail" / "T , Trailer")
    // that reuses the row tags — keep only D2 rows that carry a real date.
    rows.filter(r => tag(r) === 'D2').forEach((r, i) => { const ln = lineFrom(r, col, out.account, i); if (ln.date) out.lines.push(ln); });
    return out;
  }
  const hi = rows.findIndex(r => { const l = r.map(x => String(x).toLowerCase());
    return l.some(x => /date/.test(x)) && l.some(x => /deposit|credit|money in/.test(x)) && l.some(x => /withdraw|debit|money out/.test(x)); });
  if (hi < 0) return out;
  out.format = 'generic';
  const col = makeIndex(rows[hi]);
  rows.slice(hi + 1).forEach((r, i) => { const ln = lineFrom(r, col, out.account, i); if (ln.date) out.lines.push(ln); });
  const ds = out.lines.map(l => l.date).sort();
  out.from = ds[0] || null; out.to = ds[ds.length - 1] || null;
  return out;
}
function cashPositions(lines){
  const by = {};
  const ord = l => (l.date || '') + 'T' + (l.time || '00:00:00') + '#' + (l.importedAt || '') + '#' + String(l.seq == null ? 0 : l.seq).padStart(6, '0');
  (lines || []).forEach(l => {
    if (l.balance == null) return;
    const k = l.account || '(account)';
    if (!by[k] || ord(l) > ord(by[k])) by[k] = l;
  });
  const accounts = Object.entries(by).map(([account, l]) => ({ account, balance: l.balance, asOf: l.date }));
  return { accounts, total: round2(accounts.reduce((s, a) => s + a.balance, 0)),
    asOf: accounts.map(a => a.asOf).sort().slice(-1)[0] || null };
}

// ---------- XLSX (inline reader: zip central directory + deflate-raw + regex XML) ----------
async function inflateRaw(u8){
  const ds = new DecompressionStream('deflate-raw');
  const out = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}
async function unzip(buf, want){
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--){ if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; } }
  if (eocd < 0) throw new Error('Not an XLSX file');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const files = {};
  const td = new TextDecoder();
  for (let n = 0; n < count; n++){
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged XLSX file');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true),
      elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    if (!want || want(name)){
      const ln = dv.getUint16(off + 26, true), le = dv.getUint16(off + 28, true);
      const data = u8.subarray(off + 30 + ln + le, off + 30 + ln + le + csize);
      files[name] = method === 0 ? data : method === 8 ? await inflateRaw(data) : null;
    }
    p += 46 + nlen + elen + clen;
  }
  return files;
}
function xmlDecode(s){
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}
function colIndex(ref){ const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
async function xlsxToRows(buf){
  const files = await unzip(buf, n => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const dec = u => u ? new TextDecoder().decode(u) : '';
  const ss = [];
  (dec(files['xl/sharedStrings.xml']).match(/<si>[\s\S]*?<\/si>/g) || []).forEach(si => {
    ss.push(xmlDecode((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(t => t.replace(/<t[^>]*>|<\/t>/g, '')).join('')));
  });
  const sheet = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/(\d+)\.xml$/)[1]) - parseInt(b.match(/(\d+)\.xml$/)[1]))[0];
  if (!sheet) throw new Error('No worksheet in this XLSX');
  const rows = [];
  (dec(files[sheet]).match(/<row[^>]*\/>|<row[\s\S]*?<\/row>/g) || []).forEach(rx => {
    const row = [];
    (rx.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) || []).forEach(cx => {
      const ref = (cx.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const t = (cx.match(/\bt="(\w+)"/) || [])[1];
      const v = (cx.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (t === 's') val = ss[+v] || '';
      else if (t === 'inlineStr') val = xmlDecode(((cx.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1]) || '');
      else if (v != null) val = xmlDecode(v);
      row[ref ? colIndex(ref) : row.length] = String(val).trim();
    });
    for (let i = 0; i < row.length; i++) if (row[i] == null) row[i] = '';
    rows.push(row);
  });
  return rows.filter(r => r.some(x => x !== ''));
}

// ---------- dividends: payer → ticker, dedupe against the ledger ----------
const NAME_NOISE = /\b(LTD|LIMITED|PTE|HLDGS?|HOLDINGS|CORP|CORPORATION|GROUP|INC|PLC)\b/g;
function normName(s){
  return String(s || '').toUpperCase().replace(/^CDP[-\s]*/, '').replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(NAME_NOISE, ' ').replace(/\s+/g, ' ').trim();
}
function buildNameMap(txns){
  const m = {};
  [...(txns || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach(t => {
    const tk = String(t.ticker || '').toUpperCase(); if (!tk) return;
    if (t.equity) m[normName(t.equity)] = tk;
    m[normName(tk)] = tk;
  });
  return m;
}
function matchTicker(payer, nameMap, learned){
  const n = normName(payer); if (!n) return null;
  if (learned && learned[n]) return learned[n];
  if (nameMap[n]) return nameMap[n];
  const hits = Object.keys(nameMap).filter(k => k.length >= 4 && (k.startsWith(n + ' ') || n.startsWith(k + ' ')));
  const tks = [...new Set(hits.map(k => nameMap[k]))];
  return tks.length === 1 ? tks[0] : null;
}
function payerOf(l){
  const r = String(l.remarks || ''); const m = r.match(/CDP[-\s]+(.+)/i);
  if (m) return m[1].trim();
  if (r) return r.trim();
  return String(l.description || '').replace(/CDP\s*DIVIDEND/i, '').trim();
}
// Match bank dividend lines to ledger DIVIDEND entries (same ticker, amount to the cent, within ±tol days):
// 1) one line ↔ one entry, closest date first; 2) several same-day lines ↔ one entry (booked as a total);
// 3) one line ↔ two or three entries (booked split). Each ledger entry is used at most once.
function dividendCandidates(lines, txns, learned, opts){
  const tol = (opts && opts.tolDays) || 7;
  const nm = buildNameMap(txns);
  const cands = (lines || []).filter(l => l.category === 'dividend').map(l => {
    const payer = payerOf(l), tk = matchTicker(payer, nm, learned);
    return { key: l.key, date: l.date, amount: round2(l.deposit), payer, ticker: tk, status: tk ? 'new' : 'unmapped', matchId: null, matchIds: [] };
  });
  const ledger = (txns || []).filter(t => t.type === 'DIVIDEND')
    .map(t => ({ id: t.id, ticker: String(t.ticker || '').toUpperCase(), date: t.paymentDate || t.date, amount: round2(t.dividend), used: false }));   // XD-booked dividends meet the bank on their payment date
  const near = (t, c) => t.ticker === c.ticker && Math.abs(dayDiff(t.date, c.date)) <= tol;
  cands.filter(c => c.ticker).forEach(c => {
    let best = null;
    ledger.forEach(t => { if (t.used || !near(t, c) || Math.abs(t.amount - c.amount) > 0.011) return;
      const dd = Math.abs(dayDiff(t.date, c.date)); if (!best || dd < best.dd) best = { t, dd }; });
    if (best){ best.t.used = true; c.status = 'dup'; c.matchId = best.t.id; c.matchIds = [best.t.id]; }
  });
  const groups = {};
  cands.filter(c => c.status === 'new').forEach(c => { const g = c.ticker + '|' + c.date; (groups[g] = groups[g] || []).push(c); });
  Object.values(groups).forEach(g => {
    if (g.length < 2) return;
    const sum = round2(g.reduce((s, c) => s + c.amount, 0));
    const t = ledger.find(t => !t.used && near(t, g[0]) && Math.abs(t.amount - sum) <= 0.011);
    if (t){ t.used = true; g.forEach(c => { c.status = 'dup'; c.matchId = t.id; c.matchIds = [t.id]; }); }
  });
  cands.filter(c => c.status === 'new').forEach(c => {
    const pool = ledger.filter(t => !t.used && near(t, c)).slice(0, 8);
    for (let mask = 1; mask < (1 << pool.length); mask++){
      const pick = pool.filter((_, i) => mask & (1 << i));
      if (pick.length < 2 || pick.length > 3) continue;
      if (Math.abs(round2(pick.reduce((s, t) => s + t.amount, 0)) - c.amount) <= 0.011){
        pick.forEach(t => { t.used = true; }); c.status = 'dup'; c.matchId = pick[0].id; c.matchIds = pick.map(t => t.id); break;
      }
    }
  });
  return cands;
}

// ---------- XLSX writer (no external library — the artifact sandbox can't load SheetJS) ----------
// sheets: [{name, rows:[[cell…]], cols:[{w, fmt}]}]. A cell is a string, a number, null/'' (empty) or
// {v, fmt}. Column/cell fmt: 'money' (#,##0.00, negatives red), 'pct' (0.00%), 'qty' (#,##0.####),
// 'price' (#,##0.000). Row 1 is a bold header. Files are stored uncompressed in a standard zip.
const _CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function _crc32(u8){ let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = _CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function _zipStore(files){   // files: [{name, data:Uint8Array}]
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  files.forEach(f => {
    const name = enc.encode(f.name), crc = _crc32(f.data), n = f.data.length;
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(crc), ...u32(n), ...u32(n), ...u16(name.length), ...u16(0)]);
    parts.push(local, name, f.data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(crc), ...u32(n), ...u32(n), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
    off += local.length + name.length + n;
  });
  const cdLen = central.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdLen), ...u32(off), ...u16(0)]);
  const all = parts.concat(central, [end]), out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0; all.forEach(a => { out.set(a, p); p += a.length; });
  return out;
}
function _xesc(s){ return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _colName(i){ let s = ''; i++; while (i > 0){ const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
const _XF = { money: 1, pct: 2, qty: 3, price: 4 };
function xlsxWrite(sheets){
  const enc = new TextEncoder(), files = [];
  const put = (name, xml) => files.push({ name, data: enc.encode(xml) });
  const n = sheets.length;
  put('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>');
  put('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  const used = new Set();
  const sheetName = s => { let b = String(s || 'Sheet').replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31) || 'Sheet', x = b, k = 2; while (used.has(x.toLowerCase())) x = b.slice(0, 28) + ' ' + k++; used.add(x.toLowerCase()); return x; };
  put('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + sheets.map((s, i) => `<sheet name="${_xesc(sheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>');
  put('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  put('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]\\-#,##0.00"/><numFmt numFmtId="165" formatCode="0.00%"/><numFmt numFmtId="166" formatCode="#,##0.####"/><numFmt numFmtId="167" formatCode="#,##0.000"/></numFmts>'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  sheets.forEach((s, si) => {
    const cols = s.cols || [];
    const colXml = cols.length ? '<cols>' + cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${(c && c.w) || 12}" customWidth="1"/>`).join('') + '</cols>' : '';
    const rowsXml = (s.rows || []).map((row, ri) => '<row r="' + (ri + 1) + '">' + row.map((cell, ci) => {
      const ref = _colName(ci) + (ri + 1);
      let v = cell, fmt = cols[ci] && cols[ci].fmt;
      if (v && typeof v === 'object'){ fmt = v.fmt || fmt; v = v.v; }
      if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '';
      if (ri === 0) return `<c r="${ref}" s="5" t="inlineStr"><is><t>${_xesc(v)}</t></is></c>`;
      if (typeof v === 'number') return `<c r="${ref}"${_XF[fmt] ? ` s="${_XF[fmt]}"` : ''}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${_xesc(v)}</t></is></c>`;
    }).join('') + '</row>').join('');
    put(`xl/worksheets/sheet${si + 1}.xml`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + colXml + '<sheetData>' + rowsXml + '</sheetData></worksheet>');
  });
  return _zipStore(files);
}

// An in-specie distribution must be counted once. If the units are booked as an OPENING flagged
// acquired:'EARNED' (value flows to the return) AND the same value is booked as a same-day DIVIDEND,
// the return counts it twice. Returns each such pair; the fix is to drop the EARNED flag, so the
// opening becomes capital in and the dividend alone carries the income.
function doubleCountedInSpecie(txns){
  const divs = (txns || []).filter(t => t.type === 'DIVIDEND');
  const used = new Set(), out = [];
  (txns || []).filter(t => t.type === 'OPENING' && t.acquired === 'EARNED').forEach(o => {
    const val = round2(toNum(o.quantity) * toNum(o.price));
    const d = divs.find(x => !used.has(x.id) && x.date === o.date && (!o.owner || !x.owner || x.owner === o.owner) && Math.abs(round2(toNum(x.dividend)) - val) <= 0.011);
    if (d && val > 0){ used.add(d.id); out.push({ openingId: o.id, dividendId: d.id, date: o.date, ticker: o.ticker, value: val }); }
  });
  return out;
}

// ---------- property ----------
const FREQ_PER_YEAR = { monthly: 12, quarterly: 4, 'half-yearly': 2, annual: 1, single: 1 };
function propertyYields(p){
  const price = toNum(p.purchasePrice), rent = toNum(p.rent) * 12;
  const mcst = toNum(p.mcst) * (FREQ_PER_YEAR[p.mcstFreq] || 4), tax = toNum(p.propertyTax);
  return { annualRent: rent, annualMcst: mcst, annualTax: tax, noi: rent - mcst - tax,
    gross: price > 0 ? rent / price : null, net: price > 0 ? (rent - mcst - tax) / price : null,
    ltv: price > 0 ? toNum(p.loan) / price : null };
}
function portfolioYields(list){
  let price = 0, rent = 0, noi = 0;
  (list || []).forEach(p => { const y = propertyYields(p); if (toNum(p.purchasePrice) > 0){ price += toNum(p.purchasePrice); rent += y.annualRent; noi += y.noi; } });
  return { price, annualRent: rent, noi, gross: price > 0 ? rent / price : null, net: price > 0 ? noi / price : null };
}

// ---------- insurance ----------
const FREQ_MONTHS = { monthly: 1, quarterly: 3, 'half-yearly': 6, annual: 12, single: 0 };
function addMonths(iso, n){
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}
// Roll the payment due date forward by the premium frequency until it is today or later.
// Always counted from the original date so month-end dates don't drift (31 Jan → 28 Feb → 31 Mar).
function nextDue(due, freq, today){
  if (!due) return null;
  const step = FREQ_MONTHS[freq];
  if (!step || due >= today) return due;
  let k = 0, d = due;
  while (d < today && k < 1200){ k++; d = addMonths(due, step * k); }
  return d;
}
function instalment(annual, freq){ const n = FREQ_PER_YEAR[freq] || 1; return freq === 'single' ? toNum(annual) : toNum(annual) / n; }

// ---------- market state / auto refresh (SGX, Singapore time UTC+8) ----------
function sgtParts(ms){ const d = new Date(ms + 8 * 3600e3); return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
function prevWeekday(iso){ const d = new Date(iso + 'T00:00:00Z'); do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10); }
function marketState(ms){
  const p = sgtParts(ms), wk = p.dow >= 1 && p.dow <= 5;
  return { today: p.date, mins: p.mins, weekday: wk, open: wk && p.mins >= 540 && p.mins < 1020,
    lastTradingDay: (wk && p.mins >= 540) ? p.date : prevWeekday(p.date) };
}
function shouldAutoRefresh(o){
  const tickers = o.tickers || [], prices = o.prices || {}, last = o.lastRefreshMs, now = o.nowMs;
  if (!tickers.length) return { refresh: false, reason: 'no holdings' };
  const missing = tickers.filter(t => !prices[t] || prices[t].price == null);
  if (missing.length) return { refresh: true, reason: 'missing prices: ' + missing.join(', ') };
  const m = marketState(now);
  if (m.open) return (!last || now - last > 15 * 60e3) ? { refresh: true, reason: 'market open; last refresh over 15 minutes ago' } : { refresh: false, reason: 'refreshed recently' };
  const closeOf = d => Date.parse(d + 'T17:00:00+08:00');
  if (last && last >= closeOf(m.lastTradingDay)) return { refresh: false, reason: 'closing prices already captured' };
  const stale = tickers.filter(t => String(prices[t].asOf || '') < m.lastTradingDay);
  if (stale.length) return { refresh: true, reason: 'prices older than ' + m.lastTradingDay };
  if (m.weekday && m.mins >= 1020 && (!last || last < closeOf(m.today))) return { refresh: true, reason: 'closing prices not yet captured' };
  return { refresh: false, reason: 'prices current' };
}

if (typeof module !== 'undefined' && module.exports){
  module.exports = { sgxTick, roundToTick, onTick, snapToTick, fibLevels, fibRecommend, swingFromBars, ruleStatus, buyTier,
    parseCSV, toISODate, toNum, to24h, round2, dayDiff, parseBankStatement, categorise, lineKey, cashPositions,
    xlsxToRows, normName, buildNameMap, matchTicker, payerOf, dividendCandidates, doubleCountedInSpecie, xlsxWrite,
    propertyYields, portfolioYields, nextDue, addMonths, instalment, sgtParts, marketState, shouldAutoRefresh,
    FREQ_PER_YEAR, FREQ_MONTHS };
}
