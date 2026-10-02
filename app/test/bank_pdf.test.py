"""Tests for app/tools/bank_pdf_to_csv.py — run: python3 app/test/bank_pdf.test.py"""
import csv, io, json, os, sys, tempfile, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'app', 'tools'))
import bank_pdf_to_csv as B

failed = 0
def ok(cond, name):
    global failed
    print(('  PASS  ' if cond else '  FAIL  ') + name)
    if not cond: failed += 1

# ---- parser on OCR text (synthetic, UOB layout incl. OCR noise and a year boundary) ----
TXT = """ONG & KIM FAMILY TRUST PTE LTD Page 2 of 3
CORPORATE 347-303-845-3
ee eeeSSSSSSSSSsSSe
Date Description Withdrawals Deposits Balance
28 Dec BALANCE B/F 1,000.00
29 Dec CDP DIVIDEND 250.00 1,250.00
CDP-KEPPEL
A-1Wx-XY
02 Jan SVC Chg 0.50 1,249.50
05 Jan Funds Transfer 249.50 1,000.00
ONG AH WHATT
Total 250.00 250.00 1,000.00
--- End of Transaction Details ---
"""
r = B.parse_statement_text(TXT, B.anchor_date('20260101 Bank Statement.pdf'))
ok(r['account'] == '3473038453', 'account number normalised to digits')
ok(r['opening'] == 1000.0 and len(r['lines']) == 3, 'B/F is the opening balance, not a line')
ok([l['date'] for l in r['lines']] == ['2025-12-29', '2026-01-02', '2026-01-05'], 'year inferred across the Dec→Jan boundary')
ok(r['lines'][0]['deposit'] == 250.0 and r['lines'][0]['withdrawal'] == 0, 'direction from the running balance: deposit')
ok(r['lines'][2]['withdrawal'] == 249.5 and r['lines'][2]['remarks'] == 'ONG AH WHATT', 'withdrawal, continuation line kept as remarks')
ok(r['lines'][0]['ref'] == 'CDP-KEPPEL' or 'CDP-KEPPEL' in r['lines'][0]['remarks'], 'dividend payer reference kept')
ok(r['status'] == 'ok' and not r['issues'], 'balances and totals reconcile → ok')

bad = TXT.replace('02 Jan SVC Chg 0.50 1,249.50', '02 Jan SVC Chg 0.80 1,249.50')
rb = B.parse_statement_text(bad, B.anchor_date('20260101 x.pdf'))
ok(rb['status'] == 'needs_review' and any('02 Jan' in i or '2026-01-02' in i for i in rb['issues']), 'misread amount → needs review, names the line')
ok(B.parse_statement_text('Balance Sheet\nCompany Reg. No.', None)['status'] == 'not_statement', 'non-statement text is skipped')
ok(B.parse_statement_text('Retained profits\n30 Jun 2018 Balance b/f 1,234.00\nProfit for the year 10.00', None)['status'] == 'not_statement', 'financial statements with "balance b/f" are not bank statements')

# ---- CSV round trip matches the dashboard's generic importer header ----
buf = io.StringIO(); B.write_csv(r, buf)
rows = list(csv.reader(io.StringIO(buf.getvalue())))
ok(rows[0] == B.CSV_HEADER and len(rows) == 4, 'CSV header + one row per line')
ok(rows[1][1] == '2025-12-29' and rows[1][7] == '250.00' and rows[1][8] == '1250.00', 'CSV row values')

# ---- the real January 2026 UOB scan (OCR end to end) ----
PDF = os.path.join(ROOT, 'Statements', 'Bank', '20260101 Bank Statement January 2026.pdf')
if os.path.exists(PDF) and shutil.which('tesseract'):
    j = B.process_pdf(PDF)
    ok(j['status'] == 'ok', 'January 2026 statement reconciles (status ' + j['status'] + ' ' + '; '.join(j['issues'][:3]) + ')')
    ok(len(j['lines']) == 18, '18 transactions (got %d)' % len(j['lines']))
    ok(j['opening'] == 505847.23 and j['closing'] == 123053.07, 'B/F 505,847.23 → closing 123,053.07')
    ok(round(sum(l['withdrawal'] for l in j['lines']), 2) == 729446.76 and round(sum(l['deposit'] for l in j['lines']), 2) == 346652.60, 'totals 729,446.76 out / 346,652.60 in')
    ok(j['account'] == '3473038453' and j['lines'][0]['date'] == '2026-01-02', 'same UOB account as the Feb–Jun CSV; dated 2026')

    # manifest run into a temp folder: processes once, then skips unchanged files
    tmp = tempfile.mkdtemp()
    shutil.copy(PDF, tmp)
    fs = os.path.join(ROOT, 'Statements', 'Bank', 'OK Family Trust 2025.pdf')
    if os.path.exists(fs): shutil.copy(fs, tmp)
    s1 = B.run(tmp)
    ok(s1['changed'] and s1['files']['20260101 Bank Statement January 2026.pdf']['status'] == 'ok', 'run() converts the new PDF')
    ok(os.path.exists(os.path.join(tmp, 'Parsed', '20260101 Bank Statement January 2026.csv')), 'CSV written to Parsed/')
    if os.path.exists(fs): ok(s1['files']['OK Family Trust 2025.pdf']['status'] == 'not_statement', 'financial statements PDF skipped')
    for fsn in ['O&K Family Trust 2022.pdf', 'O&K Family Trust 2024.pdf']:
        fp = os.path.join(ROOT, 'Statements', 'Bank', fsn)
        if os.path.exists(fp): ok(B.process_pdf(fp)['status'] == 'not_statement', fsn + ' skipped (not a bank statement)')
    s2 = B.run(tmp)
    ok(not s2['changed'], 'second run: nothing new')
    shutil.rmtree(tmp)
else:
    print('  SKIP  real PDF test (file or tesseract missing)')

print('\n%d TEST(S) FAILED' % failed if failed else '\nALL TESTS PASSED')
sys.exit(1 if failed else 0)
