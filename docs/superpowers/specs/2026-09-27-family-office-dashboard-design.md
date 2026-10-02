# Family Office Dashboard — Design Spec

**Date:** 2026-09-27 · **Owner:** Eric Ong · **Status:** approved for build (user directed "plan and implement", one-pass spec)

## 1. Goal

Turn the standalone `Portfolio_Ledger.html` into a persistent **Cowork artifact** that opens with the
last saved data, with a left navigation across five areas: **Rules, Portfolio Ledger, Cash on Hand,
Property, Insurance**. Redesign the display cards. Nothing existing is removed — cost/market opening
basis, FY/CY, owner scoping, period-scoped realised/dividends, year-aware pricing, exports, imports and
the reconciliation line all carry over unchanged.

## 2. Constraints that shaped the design

| Constraint | Consequence |
|---|---|
| Artifact runs sandboxed; network blocked except Chart.js / Grid.js / Mermaid CDN tags | No SheetJS, no pdf.js. XLSX read with an inline zip+XML reader; xlsx *export* falls back to CSV. |
| `localStorage` persists across reloads and app restarts in Cowork artifacts | Storage moves from IndexedDB to a localStorage adapter behind the same `sAll/sPut/sAdd/sDel/sClear/sBulkAdd` API, so existing code is untouched. |
| `window.cowork.callMcpTool` available inside the artifact | Pull live prices calls the IBKR connector directly — no more copy-paste-restore loop. |
| Bank PDFs are scanned images (Jan 2026 statement has zero text layer) | PDF statements cannot be parsed in-browser. PDF route = Claude-assisted: the tab copies a request; Claude reads the PDF in chat and returns a CSV the tab loads. |
| Light-mode Cowork UI | `:root{color-scheme:light}`, light canvas, dark sidebar only. |

## 3. Architecture

Single self-contained HTML, split into isolated `<script>` modules with one job each:

| Module | Purpose | Testable in Node |
|---|---|---|
| `engine` | Positions, FIFO, periods, XIRR, Dietz (unchanged) | yes (existing suites) |
| `calc` | Pure functions for new features: SGX tick rounding, Fibonacci levels, bank CSV parsing, statement categorisation, dividend→ticker matching and dedupe, property yields, premium next-due dates | yes (new suite) |
| `store` | localStorage-backed stores + seed bootstrap | — |
| `bridge` | IBKR connector wrapper (snapshot → daily-close fallback, contract search) | — |
| `app` | Existing Portfolio Ledger UI, re-skinned into the new card layout | — |
| `shell` | Left nav, routing, drawer (create/edit forms), toasts | — |
| `rules`, `cash`, `property`, `insurance` | One module per tab | — |

### 3.1 Persistence

- One localStorage document `okfo:v1` = `{version, savedAt, stores:{transactions, prices, boundaries,
  histprices, rules, cash, properties, policies, people, maps, meta}}`, written on every change.
- **Seed:** the latest ledger backup (`portfolio-ledger_backup_2026-09-02.json`) is embedded in the
  artifact. It is loaded **only when no saved document exists** — so first open shows data, and after
  that the user's own saved state always wins.
- Backup JSON / Restore JSON remain for portability. Restore of a price-only file still merges prices.
- "Changes since last backup" counter kept (now informational — data is already saved).
- Danger zone gains **Reset to bundled data** (typed confirmation).
- Quota guard: a failed write shows a toast rather than silently losing data.

### 3.2 Live prices (bridge)

- **Auto-refresh on open** (user requirement): when the artifact opens, prices refresh automatically if
  any held ticker's price is older than 15 minutes during SGX hours (Mon–Fri 09:00–17:00 SGT) or dated
  before the latest trading day otherwise. A manual refresh stays in the header for mid-session use.
  The sandbox blocks direct web fetches, so the IBKR connector is the live-price source.
- Snapshot `get_price_snapshot` (last + bid/ask). Empty/missing last → `get_price_history`
  ONE_DAY/ONE_WEEK last bar, dated with that bar's date. Tickers without a known contract id resolve
  via `search_contracts` (SGX listing).
- Every price passes an SGX tick-grid check before being written; each carries its own `asOf`.
- Outside the artifact (plain file) the existing paste-to-Claude path remains as a fallback.

## 4. Visual design and card layout

Inverted-pyramid layout, identical anatomy on every tab: **page header → KPI cards → main card(s) →
work areas**. The eye lands on the answer first, then the trend, then the composition, then detail.

- **Sidebar:** dark ink (`#16201c`), brand line, five tabs with icons, footer showing save status and
  price freshness. Collapses to a top bar under 760px.
- **KPI cards:** one number per card, three-row anatomy (label / value / context line). Primary row
  answers the three standing questions — *what do we have* (portfolio value), *how is it doing*
  (period return), *how liquid are we* (cash on hand). Secondary row: unrealised, realised (period),
  dividends (period).
- **Trend:** year strip (existing), restyled as compact tiles; click selects the year.
- **Composition:** allocation-by-weight bars (top holdings + "N more") beside a **return bridge**
  (opening → capital in → dividends → closing → return) that visualises the existing reconciliation.
- **Detail:** holdings table in a card (sortable, drill-down unchanged).
- **Work areas:** add/edit transaction beside recent transactions; prices; import; export & data.
- Create/edit forms for Rules, Property and Insurance open in a **right-hand drawer**, so the list
  stays visible while editing.
- Colour carries meaning only: green gain, red loss, amber stale/attention, teal accent.

## 5. Portfolio Ledger tab

Existing functionality, re-laid out per §4. New: cash-on-hand KPI (from Cash tab), allocation card,
return bridge card, prices-freshness indicator in the sidebar, direct live-price pull.

## 6. Rules tab (Fibonacci)

**Create rule:** pick a held/known ticker or type a new SGX symbol. The tab loads daily history
(lookback 3M / 6M / 1Y, default 6M) and proposes levels from the swing high H (max high) and swing low
L (min low) of the window, range R = H − L:

| Level | Formula | Recommended use |
|---|---|---|
| 23.6% | H − 0.236R | reference |
| 38.2% | H − 0.382R | **Buy 1** |
| 50.0% | H − 0.5R | **Buy 2** |
| 61.8% | H − 0.618R | **Buy 3** |
| 78.6% | H − 0.786R | **Cut loss** |
| 100% ext | H | **Sell 1** (prior high) |
| 127.2% ext | L + 1.272R | **Sell 2** |
| 161.8% ext | L + 1.618R | **Sell 3** |

All proposals round to SGX ticks (<S$0.20 → 0.001; S$0.20–<1 → 0.005; ≥S$1 → 0.01). Every value is
editable; H and L can be overridden manually (also the fallback when the connector is unavailable).
The chart plots closes with the levels as horizontal lines (buys green, sells blue, cut loss red,
references grey). UI notes Fibonacci levels are a charting convention, not a forecast or advice.

**Summary table:** stock, last price, Buy 1–3, cut loss, Sell 1–3, status vs last price —
*Cut loss hit* (≤ cut loss), *Buy zone* (≤ Buy 1), *Take profit* (≥ Sell 1), else *Hold* — plus
edit/delete.

## 7. Cash on Hand tab

- **Upload** CSV (native; DBS iBanking H1/H2/D1/D2 layout auto-detected, generic column mapping
  otherwise), XLSX (inline reader), PDF (Claude-assisted handoff — see §2).
- Lines stored with a dedupe key (account, date, reference, amount, balance) so overlapping statements
  never double count.
- **KPIs:** cash on hand (latest ledger balance per account, summed), as-at date, dividends captured
  this period, statement coverage.
- **Categorisation:** Dividend (`CDP DIVIDEND` deposit), Share settlement (`SES`), Payout to
  shareholder (withdrawal with "Div" reference — explicitly *not* dividend income), Fees
  (`SVC Chg`), Transfer, Other.
- **Dividend capture:** each dividend deposit maps remarks (`CDP-KIMLY`) → ticker via normalised name
  match against ledger equity names plus remembered user mappings. Each candidate is checked against
  existing ledger dividends (same ticker, amount within S$0.01, date within ±7 days) → *Already in
  ledger*. New ones go to a **review queue**; the user ticks and commits, creating `DIVIDEND`
  transactions (owner Ong & Kim Family Trust, note with bank reference). They then flow automatically
  into period dividends, the return, holdings and the year strip.

## 8. Property tab

Fields: property name, address, owner (company / Ong Ah Whatt / Ngiow Lee Kim / joint / other), purchase
price, purchase date, loan outstanding, monthly instalment, MCST (amount + monthly/quarterly/annual),
property tax (annual), tenant name, tenant contact, rent per month, lease end date, property agent name,
agent contact, notes.

- **Gross yield** = rent × 12 ÷ purchase price.
- **Net yield** = (rent × 12 − annual MCST − property tax) ÷ purchase price. Loan interest excluded
  (financing, not property performance) — stated in the UI.
- KPIs: number of properties, total purchase value, total loans, monthly rent roll, portfolio gross and
  net yield.

## 9. Insurance tab

Fields: insured person, insurer/agency, policy number, policy type (grouped dropdown), policy owner
(company / person), sum assured, annual premium, premium frequency, payment due date, payment by
(each family member + Ong & Kim Family Trust Pte Ltd), payment method, policy start date, maturity/
expiry date, cash/surrender value, beneficiary/nominee, riders, status, agent name, agent number,
notes.

**Policy types** (MoneySense life / health / general split): Term life, Whole life, Endowment,
Investment-linked (ILP), Universal life, Annuity / retirement, Mortgage reducing term · MediShield
Life, Integrated Shield Plan, Shield rider, Critical illness, Early critical illness, Hospital cash,
Disability income, CareShield Life / long-term care supplement · Personal accident · Travel, Home /
fire, Home contents, Motor, Maid (FDW), Pet · Keyman / business · Other.

- **Summary per family member:** policies, total sum assured, total annual premium, next due date.
- **Upcoming premiums** (next 60 days) and **company-paid premium total** (these are expensed under
  the family mandate — ties to the FS playbook).
- Seeded with the four policies named in `CLAUDE.md` (three company-owned Great Eastern policies on
  Ong Ah Whatt; Ngiow Lee Kim policy 0244004327), marked *complete details*.

## 10. Error handling

- Connector failures → toast naming the ticker; partial results still saved; stale prices keep their
  old `asOf` so the staleness flag stays honest.
- Unparseable file → specific message (format not recognised / no header / PDF route).
- Unmapped dividend payer → row stays in the queue with a ticker picker; never auto-guessed.
- Validation on every form (required fields, positive numbers, date order).

## 11. Testing and verification

- Existing engine suites must stay green.
- New `calc` suite: tick rounding bands, Fibonacci level maths, DBS CSV parsing on the real Feb–Jun
  2026 statement (row count, closing balance, dividend rows, payout excluded), name→ticker mapping,
  dedupe against the real ledger (e.g. Keppel 8 May already present), yields, next due date.
- DOM smoke test: every tab renders, forms open and save, no console errors.
- After publishing: `verify_artifact` console check; live-price pull tested from the artifact.

## 12. Out of scope

In-artifact OCR; automatic broker sync; property market valuations; FX; alerts outside the dashboard.
