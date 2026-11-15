// PDF writer (calc.js pdfDoc, no external library): a valid file (header, objects, xref offsets, trailer),
// text measured with the Helvetica metrics so right-aligned numbers line up, WinAnsi mapping for the
// dashboard's characters (S$, −, —, ·), text that pdftotext can read back, and extra pages when needed.
const C = require('../src/calc.js');
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
let failed = 0; const ok = (c, n) => { console.log((c ? '  PASS' : '  FAIL') + '  ' + n); if (!c) failed++; };

ok(Math.abs(C.pdfTextWidth('S$1,000.00', 10) - 10 * (667 + 556 + 556 + 278 + 556 * 3 + 278 + 556 * 2) / 1000) < 1e-9, 'Helvetica width of "S$1,000.00" at 10pt');
ok(C.pdfTextWidth('Total', 10, true) > C.pdfTextWidth('Total', 10), 'bold is wider than regular');
ok(C.pdfTextWidth('−S$5', 10) === C.pdfTextWidth('-S$5', 10), 'U+2212 minus is set as a hyphen');

const d = C.pdfDoc({ width: 842, height: 595 });
d.page();
d.text(28, 40, 'Portfolio Holdings — FY ending 31 Mar 2027', { size: 15, bold: true });
d.text(814, 40, 'Ong & Kim Family Trust Pte Ltd', { size: 8, align: 'right', color: [0.36, 0.39, 0.44] });
d.text(28, 60, 'All owners · (oldest quote 2026-11-13)', { size: 8 });
d.line(28, 66, 814, 66, { width: 1.2 });
d.text(500, 90, '−S$12,345.67', { size: 9, align: 'right', color: [0.7, 0.15, 0.12] });
d.text(28, 110, 'A very long equity name that will not fit in its column at all', { size: 9, maxWidth: 80 });
d.page();
d.text(28, 40, 'Second page (escape test: a\\b (c))', { size: 10 });
const bytes = d.bytes();
const s = Buffer.from(bytes).toString('latin1');
ok(bytes instanceof Uint8Array && s.startsWith('%PDF-1.4'), 'starts with %PDF-1.4');
ok(/\/Count 2/.test(s) && (s.match(/\/Type \/Page\b/g) || []).length === 2, 'two pages');
ok(/\/Encoding \/WinAnsiEncoding/.test(s) && /Helvetica-Bold/.test(s), 'standard fonts, WinAnsi encoding');
const xref = s.lastIndexOf('\nxref\n') + 1, sx = Number(s.slice(s.lastIndexOf('startxref') + 9).trim().split(/\s/)[0]);
ok(sx === xref, 'startxref points at the xref table');
const offs = s.slice(xref).split('\n').slice(3).filter(l => /^\d{10} 00000 n/.test(l)).map(l => Number(l.slice(0, 10)));
ok(offs.length > 5 && offs.every((o, i) => s.slice(o, o + 20).startsWith((i + 1) + ' 0 obj')), 'every xref offset lands on its object');
ok(/\(S\$12,345.67\)|\(-S\$12,345.67\)/.test(s) && s.includes('\x97'), 'minus mapped to "-", em dash to WinAnsi 0x97');
ok(s.includes('a\\\\b \\(c\\)'), 'backslash and brackets escaped');

let txt = null;
try { const f = path.join(os.tmpdir(), 'okfo_pdf_test.pdf'); fs.writeFileSync(f, bytes); txt = execFileSync('pdftotext', ['-layout', f, '-']).toString(); } catch (e) { txt = null; }
if (txt == null) console.log('  SKIP  pdftotext not installed — text read-back not checked');
else {
  ok(/Portfolio Holdings — FY ending 31 Mar 2027/.test(txt) && /-S\$12,345\.67/.test(txt) && /Second page/.test(txt), 'pdftotext reads the text back');
  ok(/A very long equity/.test(txt) && !/at all/.test(txt) && /\.\.\./.test(txt), 'over-long text is cut to its column with "..."');
}
console.log(failed ? '\n' + failed + ' TEST(S) FAILED' : '\nALL TESTS PASSED');
process.exit(failed ? 1 : 0);
