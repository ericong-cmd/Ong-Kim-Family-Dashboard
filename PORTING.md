# Porting the family-office dashboard from Cowork to Claude Code — checklist

Done 2 Oct 2026. Open Claude Code **in this folder** (`Ong Kim Investment`). Everything below is already
here; nothing was removed from Cowork — the artifact `ong-kim-family-office` keeps working from the same source.

## 1. Start (once)

```bash
cd "~/Documents/Claude/Projects/Ong & Kim Family Trust Pte Ltd/Ong Kim Investment"
npm install                      # test dependency only
brew install tesseract poppler   # only for reading scanned bank PDFs
npm start                        # http://localhost:8787
npm test                         # every suite should say ALL TESTS PASSED
node app/tools/state.js summary  # what's in the data
```

In Claude Code, connect the **Interactive Brokers** connector (`/mcp`) for live prices.

## 2. What came over

| Item | Where now | Notes |
|---|---|---|
| Dashboard code (all 5 tabs, latest versions) | `app/src/` | Rules (Fibonacci, company names in ticker list), Ledger (cards, allocation, return bridge, real .xlsx export), Cash on Hand (CSV/XLSX upload, PDF processing, dividend capture), Property & Insurance (registers, inline delete) |
| Dashboard data — ledger, prices, year-end closes, boundaries, rules, bank lines, properties, policies, people, learned mappings | `data/state/okfo-state.json` | imported from `data/backups/portfolio-ledger_backup_2026-10-02.json` (your latest Cowork Backup JSON: 428 transactions, 36 policies, 8 properties, 10 people, 100 bank lines, 0 rules) |
| Earlier backups | `data/backups/` | 28 Aug, 2 Sep, 28 Sep (Keppel fix), 1 Oct, 2 Oct + the 20 Jul import |
| Price file | `data/prices/prices_2026-09-02.json` | |
| Folder-derived registers (Insurance/ and Property/ documents) | `app/src/seed.extra.json` | fills blanks only; already applied |
| Bank statements | `Statements/Bank/` + `Statements/Bank/Parsed/` (Jan 2026 PDF → reconciled CSV, manifest) | Jul–Sep 2026 statements uploaded in Cowork are in the data (not as files) |
| Trading statement | `Statements/Trading/Ong CGS Transactions.csv` | |
| PDF → CSV converter | `app/tools/bank_pdf_to_csv.py` | |
| Live prices (Cowork: page calls IBKR on open) | skill `refresh-prices` + `node app/tools/state.js set-prices` | |
| Bank PDF task (Cowork task `ok-bank-statement-pdfs`) | *Process new PDFs now* (local server) + skill `process-bank-pdfs` | on demand only, as you asked |
| Insurance/property document reading | skill `update-registers` | |
| Moving data between Cowork and Claude Code | skill `sync-dashboard-data`, `app/tools/state.js import/export` | |
| Decisions and standing rules | `app/CLAUDE.md` → "Rules that must hold" | closing prices unadjusted, keep cost/market basis, never delete, in-specie once, payout ≠ dividend … |
| Open items (payers to confirm, missing figures) | `app/CLAUDE.md` → "Open items" | |
| Design spec and build plan | `docs/superpowers/specs/`, `docs/superpowers/plans/` | |
| Tests | `app/test/` (engine, basis, calc, store, bank PDF, server, smoke) | `npm test` |
| FS playbook | `CLAUDE.md` (root) | unchanged, plus §13 pointing to the dashboard |
| Cowork conversation and files | `Cowork task Ong Kim Investment Dashboard 2026-10-02/` | open Claude Code in that folder and run `/port-task-data` to read the history |
| Old standalone ledger, Vercel files | `_archive/` | kept, not used |

## 3. Keeping Cowork and Claude Code in step

Use one as the place you edit. If you edit in Cowork again: *Backup JSON* there → save into `data/backups/`
→ `node app/tools/state.js import data/backups/<file>`. If you edit here and want Cowork current:
`node app/tools/state.js export` → *Restore JSON* in the Cowork dashboard.

## 4. Not portable (by nature)

- The Cowork artifact's own browser storage — carried over through the Backup JSON instead.
- `window.cowork` connector calls from the page — replaced by Claude Code skills (prices) and the local
  server (PDFs).
- Cowork scheduled task — Claude Code has no scheduler here; run the skill when needed.
