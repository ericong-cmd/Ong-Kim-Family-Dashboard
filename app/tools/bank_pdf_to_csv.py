#!/usr/bin/env python3
"""Bank statement PDF → CSV for the family-office dashboard.

Scanned statements (e.g. UOB PDFs photographed on a phone) have no text layer, so each page is
rendered at 300 dpi and read with tesseract. Every transaction is then checked against the running
balance (previous balance ± amount = printed balance) and against the statement's Total line. Only
a statement that reconciles completely is marked "ok" and loaded into the dashboard; anything else
is marked "needs_review" with the exact lines that failed.

Usage:
  python3 app/tools/bank_pdf_to_csv.py [--folder Statements/Bank] [--force]
      Convert new or changed PDFs; prints a JSON summary. Output: <folder>/Parsed/<name>.csv
      plus <folder>/Parsed/manifest.json.
  python3 app/tools/bank_pdf_to_csv.py --accept "<pdf name>"
      After a person (or Claude) corrects <folder>/Parsed/<name>.csv by hand, re-check it against
      the balances and mark it ok if it reconciles.
"""
import argparse, csv, datetime as dt, hashlib, io, json, os, re, shutil, subprocess, sys, tempfile

MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
MONEY = r'\d{1,3}(?:,\d{3})*\.\d{2}'
CSV_HEADER = ['Account Number', 'Date', 'Time', 'Description', 'Your Reference', 'Remarks', 'Withdrawal', 'Deposit', 'Ledger Balance']
TX_START = re.compile(r'^\s*(\d{1,2})\s+(' + '|'.join(m.capitalize() for m in MONTHS) + r')[a-z]*\b\.?\s*(.*)$', re.I)
NOW = lambda: dt.datetime.now().isoformat(timespec='seconds')


def _num(s): return round(float(s.replace(',', '')), 2)
def _near(a, b): return abs(a - b) < 0.005


def anchor_date(filename):
    """A date the statement period sits near, from the file name (20260101 …, or 'January 2026')."""
    base = os.path.basename(filename or '')
    m = re.match(r'(\d{4})(\d{2})(\d{2})', base)
    if m: return dt.date(int(m[1]), int(m[2]), int(m[3]))
    m = re.search(r'(' + '|'.join(MONTHS) + r')[a-z]*\.?\s+(\d{4})', base, re.I)
    if m: return dt.date(int(m[2]), MONTHS.index(m[1][:3].lower()) + 1, 15)
    return None


def _dated(day, mon, anchor):
    """Pick the year that puts 'day mon' closest to the anchor (handles Dec→Jan statements)."""
    mi = MONTHS.index(mon[:3].lower()) + 1
    base = anchor or dt.date.today()
    best = None
    for y in (base.year - 1, base.year, base.year + 1):
        try: d = dt.date(y, mi, int(day))
        except ValueError: continue
        if best is None or abs((d - base).days) < abs((best - base).days): best = d
    return best.isoformat() if best else None


def _classify_extra(line, tx):
    s = line.strip()
    if len(re.sub(r'[^A-Za-z0-9]', '', s)) < 3: return
    if not re.match(r'^CDP[-\s]', s, re.I) and ' ' not in s and re.search(r'\d', s):
        tx['refs'].append(s)
    else:
        tx['notes'].append(s)


def parse_statement_text(text, anchor):
    out = {'account': '', 'opening': None, 'closing': None, 'lines': [], 'issues': [], 'status': 'not_statement', 'totals': None}
    # A bank statement carries a brought-forward balance AND withdrawal/deposit columns; the
    # company's financial statements also say "balance b/f", so one marker alone is not enough.
    if not (re.search(r'BALANCE\s*B/?F', text or '', re.I) and re.search(r'withdrawal', text or '', re.I) and re.search(r'deposit', text or '', re.I)):
        return out
    m = re.search(r'(\d{3}-\d{3}-\d{3}-\d)', text)
    if m: out['account'] = re.sub(r'\D', '', m[1])
    cur, raw = None, []
    in_body = False
    for ln in text.splitlines():
        s = ln.strip()
        if not s: continue
        if re.match(r'^Total\b', s, re.I) and in_body:
            toks = re.findall(MONEY, s)
            if len(toks) >= 3: out['totals'] = {'withdrawals': _num(toks[-3]), 'deposits': _num(toks[-2]), 'closing': _num(toks[-1])}
            cur = None; in_body = False
            continue
        if re.search(r'End of Transaction', s, re.I):
            cur = None; in_body = False; continue
        t = TX_START.match(s)
        if t:
            in_body = True
            rest = t[3]
            toks = list(re.finditer(MONEY, rest))
            date = _dated(t[1], t[2], anchor)
            if re.search(r'BALANCE\s*B/?F', rest, re.I):
                if toks and out['opening'] is None: out['opening'] = _num(toks[-1][0])
                elif toks: raw.append({'kind': 'bf', 'date': date, 'balance': _num(toks[-1][0])})
                cur = None; continue
            if re.search(r'BALANCE\s*C/?F', rest, re.I):
                cur = None; continue
            desc = rest[:toks[-2].start()].strip() if len(toks) >= 2 else (rest[:toks[0].start()].strip() if toks else rest.strip())
            cur = {'kind': 'tx', 'date': date, 'label': t[1] + ' ' + t[2], 'desc': re.sub(r'\s+', ' ', desc),
                   'amount': _num(toks[-2][0]) if len(toks) >= 2 else None, 'balance': _num(toks[-1][0]) if toks else None,
                   'refs': [], 'notes': []}
            raw.append(cur)
            continue
        if cur is not None and in_body:
            _classify_extra(s, cur)
    # direction from the running balance
    prev = out['opening']
    if prev is None: out['issues'].append('No BALANCE B/F found — cannot check the running balance')
    for r in raw:
        if r['kind'] == 'bf':
            if prev is not None and not _near(prev, r['balance']): out['issues'].append('%s: balance brought forward %.2f does not follow %.2f' % (r['date'], r['balance'], prev))
            prev = r['balance']; continue
        line = {'date': r['date'], 'description': r['desc'], 'ref': ' / '.join(r['refs']), 'remarks': ' / '.join(r['notes']),
                'withdrawal': 0.0, 'deposit': 0.0, 'balance': r['balance']}
        if r['amount'] is None or r['balance'] is None:
            out['issues'].append('%s %s (%s): amount or balance not read' % (r['label'], r['date'], r['desc']))
        elif prev is not None:
            delta = round(r['balance'] - prev, 2)
            if _near(delta, r['amount']): line['deposit'] = r['amount']
            elif _near(delta, -r['amount']): line['withdrawal'] = r['amount']
            else:
                out['issues'].append('%s %s (%s): %.2f does not move the balance from %.2f to %.2f' % (r['label'], r['date'], r['desc'], r['amount'], prev, r['balance']))
                if delta >= 0: line['deposit'] = r['amount']
                else: line['withdrawal'] = r['amount']
        if r['balance'] is not None: prev = r['balance']
        out['lines'].append(line)
    out['closing'] = prev
    if not out['lines']: out['issues'].append('No transactions found')
    tot = out['totals']
    if tot:
        w = round(sum(l['withdrawal'] for l in out['lines']), 2); d = round(sum(l['deposit'] for l in out['lines']), 2)
        if not _near(w, tot['withdrawals']): out['issues'].append('Withdrawals add up to %.2f but the statement total is %.2f' % (w, tot['withdrawals']))
        if not _near(d, tot['deposits']): out['issues'].append('Deposits add up to %.2f but the statement total is %.2f' % (d, tot['deposits']))
        if prev is not None and not _near(prev, tot['closing']): out['issues'].append('Closing balance %.2f differs from the statement total line %.2f' % (prev, tot['closing']))
    out['status'] = 'ok' if not out['issues'] else 'needs_review'
    return out


def write_csv(result, fh):
    w = csv.writer(fh, lineterminator='\n')
    w.writerow(CSV_HEADER)
    for l in result['lines']:
        w.writerow([result['account'], l['date'], '', l['description'], l['ref'], l['remarks'],
                    '%.2f' % l['withdrawal'], '%.2f' % l['deposit'], '' if l['balance'] is None else '%.2f' % l['balance']])


def read_csv_lines(path):
    with open(path, newline='', encoding='utf-8') as fh:
        rows = list(csv.DictReader(fh))
    lines = [{'date': r['Date'], 'description': r['Description'], 'ref': r.get('Your Reference', ''), 'remarks': r.get('Remarks', ''),
              'withdrawal': _num(r['Withdrawal'] or '0'), 'deposit': _num(r['Deposit'] or '0'),
              'balance': _num(r['Ledger Balance']) if r.get('Ledger Balance') else None} for r in rows]
    return lines, (rows[0]['Account Number'] if rows else '')


def check_lines(lines, opening, totals):
    issues, prev = [], opening
    for l in lines:
        if prev is not None and l['balance'] is not None and not _near(round(prev + l['deposit'] - l['withdrawal'], 2), l['balance']):
            issues.append('%s %s: %.2f %+.2f −%.2f ≠ %.2f' % (l['date'], l['description'], prev, l['deposit'], l['withdrawal'], l['balance']))
        if l['balance'] is not None: prev = l['balance']
    if totals:
        if not _near(round(sum(l['withdrawal'] for l in lines), 2), totals['withdrawals']): issues.append('withdrawals do not add up to the statement total')
        if not _near(round(sum(l['deposit'] for l in lines), 2), totals['deposits']): issues.append('deposits do not add up to the statement total')
    return issues, prev


def pdf_text(pdf):
    """Text layer if the PDF has one; otherwise OCR every page at 300 dpi."""
    try:
        t = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True, timeout=120).stdout
    except Exception:
        t = ''
    if len(re.sub(r'\s', '', t)) > 200:
        return t, 'text'
    tmp = tempfile.mkdtemp()
    try:
        subprocess.run(['pdftoppm', '-r', '300', '-png', pdf, os.path.join(tmp, 'p')], check=True, timeout=600)
        pages = sorted(f for f in os.listdir(tmp) if f.endswith('.png'))
        parts = [subprocess.run(['tesseract', os.path.join(tmp, p), '-', '--psm', '6'], capture_output=True, text=True, timeout=300).stdout for p in pages]
        return '\n'.join(parts), 'ocr'
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def process_pdf(pdf):
    text, how = pdf_text(pdf)
    r = parse_statement_text(text, anchor_date(pdf))
    r['method'] = how
    return r


def _sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()


def _load_manifest(folder):
    p = os.path.join(folder, 'Parsed', 'manifest.json')
    if os.path.exists(p):
        with open(p) as fh: return json.load(fh)
    return {'version': 1, 'files': {}}


def _save_manifest(folder, man):
    os.makedirs(os.path.join(folder, 'Parsed'), exist_ok=True)
    with open(os.path.join(folder, 'Parsed', 'manifest.json'), 'w') as fh: json.dump(man, fh, indent=2)


def run(folder, force=False):
    man = _load_manifest(folder)
    changed = False
    for name in sorted(os.listdir(folder)):
        if not name.lower().endswith('.pdf'): continue
        path = os.path.join(folder, name)
        sha = _sha(path)
        prev = man['files'].get(name)
        if prev and prev.get('sha256') == sha and not force: continue
        r = process_pdf(path)
        entry = {'sha256': sha, 'status': r['status'], 'method': r['method'], 'processedAt': NOW()}
        if r['status'] != 'not_statement':
            os.makedirs(os.path.join(folder, 'Parsed'), exist_ok=True)
            csv_name = os.path.splitext(name)[0] + '.csv'
            with open(os.path.join(folder, 'Parsed', csv_name), 'w', newline='', encoding='utf-8') as fh: write_csv(r, fh)
            dates = [l['date'] for l in r['lines'] if l['date']]
            entry.update({'csv': csv_name, 'account': r['account'], 'lines': len(r['lines']), 'opening': r['opening'], 'closing': r['closing'],
                          'totals': r['totals'], 'from': min(dates) if dates else None, 'to': max(dates) if dates else None, 'issues': r['issues']})
        man['files'][name] = entry
        changed = True
    if changed: _save_manifest(folder, man)
    return {'changed': changed, 'files': man['files']}


def accept(folder, name):
    """Re-check a hand-corrected CSV; mark it ok when it reconciles."""
    man = _load_manifest(folder)
    e = man['files'].get(name)
    if not e or not e.get('csv'): return {'ok': False, 'error': 'No parsed CSV recorded for ' + name}
    lines, acct = read_csv_lines(os.path.join(folder, 'Parsed', e['csv']))
    issues, closing = check_lines(lines, e.get('opening'), e.get('totals'))
    e.update({'issues': issues, 'lines': len(lines), 'closing': closing, 'status': 'ok' if not issues else 'needs_review',
              'account': acct or e.get('account'), 'reviewedAt': NOW()})
    if not issues: e['method'] = e.get('method', 'ocr') + '+reviewed'
    _save_manifest(folder, man)
    return {'ok': not issues, 'issues': issues}


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap.add_argument('--folder', default=os.path.join(root, 'Statements', 'Bank'))
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--accept')
    a = ap.parse_args()
    res = accept(a.folder, a.accept) if a.accept else run(a.folder, a.force)
    print(json.dumps(res, indent=2))
