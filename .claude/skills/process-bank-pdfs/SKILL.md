---
name: process-bank-pdfs
description: Convert new bank statement PDFs in Statements/Bank to reconciled CSV so they load into the dashboard's Cash on Hand tab, and check any statement the OCR could not reconcile against the scan. Use when Eric says "process the bank PDFs", "read the new bank statement", "the statement needs review", or saves a statement PDF into Statements/Bank.
---

# Process bank statement PDFs

Runs on demand only (Eric's choice — no schedule).

1. `python3 app/tools/bank_pdf_to_csv.py` — prints a JSON summary. Each PDF is OCR'd (tesseract, 300 dpi)
   unless it has a text layer, every line is checked against the running balance and the statement's
   Total line, and the file is marked `ok`, `needs_review` or `not_statement` (e.g. the company's FS PDFs).
   Output: `Statements/Bank/Parsed/<name>.csv` + `Statements/Bank/Parsed/manifest.json`.
   Needs `brew install tesseract poppler` on the Mac.
2. For every `needs_review` file: open the PDF with the Read tool and compare it line by line with
   `Statements/Bank/Parsed/<name>.csv`. Correct only rows that differ from the printed statement (date
   YYYY-MM-DD, amounts without commas, withdrawal/deposit in the right column, ledger balance). **Never
   invent or estimate a figure.** Then `python3 app/tools/bank_pdf_to_csv.py --accept "<pdf file name>"`.
   If it still doesn't reconcile, leave it — it will not be loaded — and report the issues.
3. Load into the dashboard:
   - Local dashboard (`npm start`): nothing to rebuild — the server reads `Statements/Bank` on every page
     load; reload the page (or press *Process new PDFs now*). New lines are added once (deduplicated by key).
   - Cowork artifact: `npm run build`, run the tests, then Cowork `update_artifact` id `ong-kim-family-office`.
4. Report per statement: period, number of lines, closing balance, status, and any dividend credits
   ("CDP DIVIDEND" / remarks "CDP-…") — Eric reviews and adds those in Cash on Hand. **Do not add ledger
   transactions yourself.**

Never delete files; move anything replaced into `_archive/`. Keep the statements local.
