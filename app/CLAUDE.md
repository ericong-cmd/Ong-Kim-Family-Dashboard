# CLAUDE.md — Family-office dashboard (app/)

Dashboard for Ong & Kim Family Trust Pte Ltd and the Ong family: **Rules · Portfolio Ledger · Cash on
Hand · Property · Insurance**. Vanilla JS/HTML/CSS, no framework, no runtime dependencies. Ported from
a Claude Cowork artifact on 2 Oct 2026 — the same source still builds that artifact.

The repo root `CLAUDE.md` is the annual financial-statements playbook; read it for anything about the
FS, ACRA or IRAS. This file covers the dashboard.

## Run it

```bash
npm install          # once — only needed for the tests (jsdom)
npm start            # → http://localhost:8787   (data: data/state/okfo-state.json)
npm test             # every suite; must end with ALL TESTS PASSED in each
npm run state -- summary
```

Prerequisites on the Mac: Node ≥ 20, Python 3; for reading scanned bank PDFs also
`brew install tesseract poppler`.

## Three ways the page runs (one source)

| | Local / Claude Code (`npm start`) | Cowork artifact (`npm run build`) | claude.ai artifact (`npm run build:claude`) |
|---|---|---|---|
| Page | served by `app/server.js` on 127.0.0.1 | `app/dist/family-office.html`, published with Cowork `update_artifact` id `ong-kim-family-office` | `app/dist/family-office.claude.html`, published as https://claude.ai/artifact/S6wGFkmMxbtnpcsJii3qXS (opens in the Claude desktop app) |
| Data | **`data/state/okfo-state.json`** (+ daily snapshots in `data/state/history/`) | the artifact's browser storage (`localStorage` key `okfo:v1`) | the artifact's database, private to each signed-in viewer (`data/users/<id>/okfo-*`); the page itself carries **no data** — first open asks for a Backup JSON |
| Live prices | Claude Code → **refresh-prices** skill → `state.js set-prices` | IBKR connector called from the page on open | Interactive Brokers connector through the page's `mcp` capability, on open |
| Bank PDFs | "Process new PDFs now" → server runs `tools/bank_pdf_to_csv.py` | Cowork task `ok-bank-statement-pdfs` (on demand) | not available — upload CSV/XLSX statements, or process PDFs on the Mac and Backup/Restore |

`store.js` picks the backend: `<script id="claude-backend">` (only `build:claude` adds it) → the
claude.ai database; `<script id="server-state">` (only the server adds it) → the file; otherwise
localStorage. First open with no saved data seeds from the newest
`data/backups/portfolio-ledger_backup_*.json`.

**Moving data between the two:** in either dashboard, *Export & data → Backup JSON* downloads a full
backup (v3: ledger, prices, every tab, one-time-fix flags). Bring it here with
`node app/tools/state.js import <file>`; send it the other way with `node app/tools/state.js export`
and *Restore JSON* in the other dashboard (or rebuild the artifact — the newest backup is its seed).

## Working with the data (Claude Code)

Always go through `app/tools/state.js` (or the open page) — never hand-edit `okfo-state.json` while
the page is open without bumping `rev`. `state.js` writes atomically, bumps `rev`, snapshots the first
version of each day, and the open page reloads within ~5 s. A save from a page that is out of date
is refused (409) and the page reloads, so neither side overwrites the other.

```bash
node app/tools/state.js summary
node app/tools/state.js get policies            # or: rules, properties, people, cash, transactions, prices …
node app/tools/state.js put properties '{"id":4,…full record…}'    # replace one record (omit id to add)
node app/tools/state.js del rules 3
node app/tools/state.js tickers                 # held + rule tickers, IBKR contract ids, stored prices
node app/tools/state.js set-prices BN4=11.30@2026-10-02 V03=16.72
node app/tools/state.js import data/backups/portfolio-ledger_backup_2026-10-02.json
node app/tools/state.js export                  # → data/backups/portfolio-ledger_backup_<today>.json
```

### Data model (`doc.stores.<store>` = object keyed by the key field)

| Store | Key | Holds |
|---|---|---|
| transactions | id | `{type: BUY|SELL|DIVIDEND|OPENING|CORPORATE_ACTION, owner, date, ticker, equity, quantity, price, fees, dividend, factor, currency, note, acquired?}` — a DIVIDEND booked from a declaration also carries `paymentDate`, `caKey` (`TICKER|XD|per-share`) and `source` |
| prices | ticker | `{ticker, price, asOf, source}` — SGX closing/last prices, **unadjusted** |
| histprices | `date|ticker` | year-end closes used for completed periods |
| boundaries | `owner__basis__year` | opening/closing values and opening basis (MARKET/COST) per period |
| rules | id | `{ticker, name, lookback, high, low, buy1-3, cut, sell1-3, notes}` |
| cash | key | bank statement lines `{account, date, time, description, ref, remarks, deposit, withdrawal, balance, category, source}` |
| properties | id | `{name, address, owner, purchasePrice, purchaseDate, loan, instalment, mcst, mcstFreq, propertyTax, tenant, tenantContact, rent, leaseEnd, agent, agentContact, notes}` |
| policies | id | `{insured, insurer, type, policyNo, owner, status, sumAssured, premium (annual), freq, due, paidBy, method, start, maturity, cashValue, beneficiary, riders, agent, agentContact, notes, needsDetails}` |
| people | id | `{name, relation?}` |
| maps | key | learned mappings: `div:<payer>` → ticker, `cid:<ticker>` → IBKR contract id |
| meta | key | `lastPage`, `lastPriceRefresh`, `seededFrom`, `dividendWatch` (upcoming declared dividends, last check), one-time flags `fix:*` / `fill:*` |

## Source layout

```
app/
  server.js           local server (Claude Code); createServer() exported for tests
  build.js            → dist/family-office.html (Cowork artifact); --claude → dist/family-office.claude.html (claude.ai artifact)
  lib/assemble.js     builds the page: src modules + seed (newest backup + newest price file + registry) + Statements/Bank inbox
  lib/statefile.js    read/write data/state/okfo-state.json (atomic, rev, daily snapshots)
  src/index.html, styles.css
  src/engine.js       positions, FIFO, periods, XIRR, Modified Dietz — the maths of record
  src/calc.js         pure helpers: SGX ticks, Fibonacci, bank CSV/XLSX parsing, dividend matching, yields, premium dates, market hours, XLSX writer, PDF writer (Helvetica, no library)
  src/store.js        storage backends + backup ⇄ document conversion
  src/bridge.js       IBKR connector (Cowork: window.cowork; claude.ai artifact: mcp capability)
  src/ledger.js       Portfolio Ledger page, exports, backup/restore
  src/shell.js        navigation, drawer, forms, KPI cards, inline delete confirmation
  src/rules.js  cash.js  property.js  insurance.js     one module per tab
  src/dividends.js    declared dividends: IBKR corporate actions → entitlement → DIVIDEND on XD (page check, once a day)
  src/boot.js         start-up: one-time fixes, registry fill, statement inbox, render, auto price refresh, dividend check
  src/seed.extra.json folder-derived registry (people, policies, properties) from Insurance/ and Property/
  tools/state.js      data CLI (above)
  tools/dividends.js  declared-dividend check for the local data (skill: check-dividends)
  tools/bank_pdf_to_csv.py   OCR + reconcile bank PDFs → Statements/Bank/Parsed/
  tools/extract.js    pulls `// @file` code blocks out of the plan document (historical)
  test/               engine, engine.basis, dividends, pdf, markets, calc, store, bank_pdf (python), server, smoke + claude (jsdom)
```

All `src/*.js` modules share one global scope in load order (see `ORDER` in lib/assemble.js); the
build refuses duplicate top-level names. Don't put a literal `</script>` in source.

## Rules that must hold (Eric's standing decisions)

- **Never delete data or features.** Keep cost basis *and* market basis, FY *and* CY, owner scoping,
  period-scoped realised/dividends, exports, imports, the reconciliation line. Never delete files —
  move them to `_archive/`.
- **Prices:** use the closing/last price exactly as quoted — no corporate-action adjustment. Every
  price carries its own `asOf`. Round to SGX ticks (< S$0.20 → 0.001; < S$1 → 0.005; else 0.01).
- **Periods:** financial year 1 Apr – 31 Mar (FY2027 = Apr 2026 – Mar 2027). Completed years show
  annualised XIRR; the running year shows the **actual** return to date (Modified Dietz), never annualised.
- **Opening basis:** MARKET (value at the prior period close) or COST (ledger cost) per period/owner.
- **In-specie distributions count once:** booked as a DIVIDEND; the units come in as an OPENING
  without `acquired: 'EARNED'` (Keppel REIT units, 8 May 2026 — fixed 28 Sep 2026).
- **Holdings view = held during the period OR produced income in it**, so holdings totals tie to the
  period return (e.g. a 5E2 dividend paid after the sale).
- **Bank lines:** a withdrawal referenced "Div" (e.g. the S$60,000 "Div 2025") is a payout to the
  shareholder, not dividend income. Bank dividends are matched to ledger dividends (same ticker, ±S$0.01,
  ±7 days, incl. split/aggregated bookings) and only added after Eric ticks them.
- **Bank PDFs:** processed **on demand only** (no schedule). A statement is loaded only if every line
  reconciles to the running balance and the Total line; otherwise it stays "needs review".
- **Insurance:** premiums paid by the company are expensed under the family mandate (root CLAUDE.md).
  The three company-owned GE policies on Ong Ah Whatt (0011254391, 0011761817, 0026371681) are carried
  at surrender value in the FS.
- **Registers:** `seed.extra.json` (from the Insurance/ and Property/ folders) only **fills blanks /
  adds missing** records once (`fill:registry-2026-09-28`); it never overwrites what Eric typed and never
  re-adds records he deleted.
- **Declared dividends** (15 Nov 2026): checked twice a week on the Mac (skill `check-dividends`,
  scheduled task) and once a day by the artifact/Cowork page on open, from IBKR corporate actions.
  Entitlement = shares held at the close of the day before XD, per owner; booked as a DIVIDEND **on the
  XD date** with `paymentDate` kept. The bank match uses `paymentDate`, so the CDP credit later shows as
  already booked. Never booked before XD; splits/scrip are reported, never booked.
- **Rules are not limited to the portfolio** (21 Nov 2026): any stock listed in Singapore (SGX), Malaysia
  (Bursa), Hong Kong (HKEX) or the US, found with the IBKR search in the rule drawer. Keys: bare SGX tickers
  (`D05`) as before; other markets `SYMBOL.MY` / `.HK` / `.US` (calc.js `marketOfKey`). Levels round to
  that market's ticks (`tickSize`); prices are quoted on its exchange and kept in its currency.
- **Shared snapshot** (`npm run build:shared <backup.json>`, passphrase in `OKFO_SHARE_PASS`): view-only,
  backup encrypted in the page, deployed separately (https://ong-kim-shared.vercel.app). Rebuild and
  redeploy to refresh it. Its strength is the passphrase.
- Fibonacci levels: Buy 1-3 at 38.2/50/61.8% retracements, cut loss 78.6%, Sell 1 prior high, Sell 2-3
  at 127.2/161.8% extensions. A charting convention — say so; not advice.
- Deletes in the page use the inline "Delete? [Delete] [Cancel]" confirmation (Cowork blocks pop-ups).
  Other confirmations go through `confirmDialog` / `typedConfirm` (shell.js): native dialogs locally and
  in Cowork, an in-page dialog in the claude.ai artifact (it never shows `confirm()`/`prompt()`).
- **Holdings PDF:** *Export PDF* (holdings card, and *Export & data*) writes a real PDF file in the page
  (calc.js `pdfDoc`, ledger.js `holdingsPdfBytes`) — works in every mode. A4 landscape, font scaled to fit
  one page; long lists continue with the header repeated. *Print holdings (1 page)* keeps the print
  layout where a print dialog exists (hidden in the claude.ai artifact).
- **The website build never embeds data either:** `npm run build:web` → `app/dist/web/index.html`.
  Its Vercel project (ong-kim-family-dashboard) was deleted on 21 Nov 2026 at Eric's request — only the
  shared snapshot is online; `vercel.json` stays for a future deploy. Each browser keeps its own records (localStorage), loaded once
  from a Backup JSON. No IBKR there — prices and dividends refresh in the artifact or on the Mac.
- **The claude.ai artifact never embeds data.** To update it: `npm run build:claude`, `npm test`, then
  publish `app/dist/family-office.claude.html` to the same URL with the Artifact tool.

## Open items carried over from Cowork (2 Oct 2026)

- Payer to confirm: OAW/NLK hospitalisation plans (personal StanChart account), OAW & NLK travel
  policies, OAW South Africa trip premium, grandchildren's single-premium policies (S$322,750.20, OCBC).
- Missing: Sun Life Malaysia policy number; Ong Annie's current plan/premium (SupremeHealth S$572.50 vs
  TotalCare S$741); Eunice's hospital plans and Jenny's AIA premiums are 2021–22 figures.
- Property: MCST and loans for Robin Suites #07-02 and Kum Hing Court #04-34; whether the Ngwe Saung land
  was sold. Verify NLK accident sum assured (Plan C S$90,000 assumed) and the S$500,000 major-illness
  figure on 11761817.
- Three Jul–Sep 2026 statements (`AccountStatements_01102026_*.csv`) were uploaded in the dashboard and
  live only in the data — save the original files into `Statements/Bank/` if you still have them.

## Tests

`npm test` runs every suite. The smoke test boots the built page in jsdom (Cowork mode), the server
test boots it against a live server on a temp data dir (local mode), and the claude test boots the
claude.ai build against a fake platform (db, user, mcp, downloads) with synthetic data. Write the failing test first, then
the code; keep all three modes green.
