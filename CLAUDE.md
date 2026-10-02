# CLAUDE.md — Annual Financial Statements Playbook

## Ong & Kim Family Trust Pte Ltd (UEN 201208211N)

**Purpose:** This file instructs Claude (and any preparer) on how to prepare the company's annual
unaudited financial statements, notes, tax computation, approval resolutions, and ACRA/IRAS filings
each year. Run this playbook after each financial year end (31 March).

> This playbook assists with preparation only. It is not legal, tax, or accounting advice. Final
> documents should be reviewed by the directors and, where needed, a qualified professional before
> signing and filing.

---

## 1. Standing company facts (verify each year against BizFile before use)

| Item | Value |
|---|---|
| Company name | ONG & KIM FAMILY TRUST PTE LTD |
| UEN / Reg. No. | 201208211N |
| Incorporated | Singapore, 2012 |
| Registered office | 38 Prince of Wales Road, Singapore (confirm full address + postal code on BizFile; the FY2025 notes still show the old address "25 Fifth Avenue, Singapore 268789" — do not copy it forward) |
| Financial year end (FYE) | 31 March |
| Directors | Ong Ah Whatt; Ngiow Lee Kim |
| Shareholder | Ong Ah Whatt — 1 ordinary share (sole member) |
| Issued share capital | S$1 (1 ordinary share, no par value) |
| Company type | Exempt private company (EPC) — ≤20 members, no corporate shareholder |
| Principal activity | **Investment holding** — quoted equity securities (CGS brokerage) and Great Eastern life policies on the life of Ong Ah Whatt (company-owned: 0011254391, 0011761817, 0026371681). ⚠️ The FY2025 notes wrongly describe "general wholesale trade" carried over from an old template — always state investment holding. |
| Family mandate | The company's purpose is to provide for the family's **health, education and yearly family trip**. Accordingly, **all insurance premiums for Ong Ah Whatt and Ngiow Lee Kim paid by the company are expensed** (including premiums on policies the company does not own, e.g. NLK policy 0244004327 and personal accident cover). Only the three company-owned OAW life policies are carried as assets. These family-benefit expenses are non-deductible for tax (§9). |
| Audit status | Unaudited — small company exemption, s205C read with the Thirteenth Schedule, Companies Act 1967 (private company + meets 2 of 3: revenue ≤ S$10m, total assets ≤ S$10m, ≤50 employees). The company qualifies comfortably. Confirm no member holding ≥5% has served notice requiring an audit (s205C(2)). |
| Solvency status | Reassess yearly. Insolvent through FY2025; from **FY2026 the company is balance-sheet solvent** (FVTPL revaluation of the portfolio). While solvent at the Annual Return date, an EPC files only the online solvency statement — no FS/XBRL (§8). If it flips back to net liabilities, the letter of financial support (§6) and FS-filing requirement revive. |
| Related-party loans | (a) Shareholder loan — Ong Ah Whatt: interest-free, movements via bank transfers and personal settlements; (b) **Loan from Ngiow Lee Kim: S$3,000,000 drawn 5 Sep 2025, interest 4% p.a. (S$30,000 per quarter, payable Dec/Mar/Jun/Sep)** — accrue interest to 31 March each year and add back as non-deductible in the tax comp. |
| Company secretary / filing agent | [Fill in — needed for Annual Return filing] |

## 2. Reporting framework

- **Companies Act 1967** (Singapore), in particular: s199 (accounting records — keep 5 years),
  s201 (financial statements — true and fair view, compliance with Accounting Standards),
  s201(16) and the **Twelfth Schedule** (Directors' Statement contents), s203 (FS to members),
  s175/175A (AGM and AGM exemption), s197 (Annual Return), s205C (small company audit exemption).
- **Accounting standards:** Singapore Financial Reporting Standards (International) — **SFRS(I)**,
  Singapore's IFRS-identical framework. (The legacy FS referenced "FRS"; either SFRS(I) or SFRS is
  acceptable for a non-listed company — this playbook standardises on SFRS(I). Keep the basis-of-
  preparation note consistent with whichever framework is stated.)
- Presentation currency: **SGD** (functional currency).
- Comparatives: one prior year, drawn from the **signed** prior-year FS (not the working file).

## 3. Inputs to gather each year (covering 1 April – 31 March)

Source folder: `Ong Kim Investment/` (this folder) —

1. **Bank statements** — `Statements/Bank/` — full FY coverage of the company bank account.
2. **Brokerage/trading records** — `Statements/Trading/` (e.g. CGS transactions CSV): buys, sells,
   dividends received, fees.
3. **Portfolio ledger** — the family-office dashboard (Cowork artifact; source in `app/`), its
   backups in `data/backups/portfolio-ledger_backup_*.json` and price files in `data/prices/prices_*.json`
   — holdings and year-end market prices for the quoted securities.
4. **Great Eastern policy** — annual statement: premiums paid, policy dividends/cash payouts,
   year-end cash/surrender value.
5. **Shareholder loan movements** — advances from and repayments to Ong Ah Whatt (visible in bank
   statements as "SHAREHOLDER LOAN OAW" / "RETURN SHH LOAN OAW").
6. **Prior year signed FS** and prior year tax filing.
7. ACRA BizFile profile extract (confirm officers, address, share capital unchanged).

If any input is missing, stop and ask Eric for it before drafting numbers.

## 4. Preparation workflow

### Step 1 — General ledger and trial balance

Post all transactions to the established chart of accounts:

| A/C | Description | Type |
|---|---|---|
| 1000/100 | Cash at bank | Current asset |
| 1200/100 | Insurance policy — cash value | Non-current asset |
| 1300/100 | Quoted securities | Non-current asset (see policy below) |
| 2100/100 | Other payables | Current liability |
| 2200/100 | Interest payable | Current liability |
| 2300/100 | Loan payable | Liability |
| 2400/100 | Amount owing to shareholder — Ong Ah Whatt | Liability (classification per §5.3) |
| 3000/100 | Share capital | Equity |
| 3100/100 | Retained profit / accumulated losses | Equity |
| 4100/100 | Dividend income | Income |
| 4200/100 | Payout from insurance policy | Income |
| 5100/100 | Insurance premium | Expense |
| 5200/100 | Administrative (bank charges, ACRA fees, accounting fees) | Expense |
| 5300–5700, 7100–7200 | Other expense accounts (usually nil) | Expense |

TB must include a **check row proving debits = credits** and beginning balances must equal the
prior-year signed FS.

### Step 2 — Financial statements (in this order)

Prepare with prior-year comparatives, "Notes" column cross-referenced, figures in S$:

1. **Statement of comprehensive income** (P&L, expenses by nature): dividend income, insurance
   policy payouts, fair value gains/losses on quoted securities (§5.2); less insurance premium,
   administrative and other expenses; taxation; total comprehensive income.
2. **Statement of financial position**: non-current assets (insurance policy cash value, quoted
   securities), current assets (cash), equity (share capital, accumulated losses), liabilities
   (shareholder loan, other payables).
3. **Statement of changes in equity** — show only opening balance, total comprehensive income,
   closing balance for current + comparative year. **It must tie exactly to the TB and balance
   sheet** (see §7 — the FY2025 SOCE did not tie).
4. **Statement of cash flows** (indirect method) — ⚠️ **missing from the FY2025 pack; must be
   added**: operating (result adjusted for fair value changes and working-capital movements),
   investing (net purchases/sales of securities), financing (shareholder loan advances/repayments).
5. **Notes to the financial statements** (§5).
6. **Directors' Statement** and (optional but customary) Directors' Report (§6).
7. Cover page: company name, UEN, "Unaudited Financial Statements for the financial year ended
   31 March 20XX".

**Header hygiene:** every page header must carry the correct statement title. ⚠️ In the FY2025 file
the header "TRADING AND PROFIT & LOSS ACCOUNT" was wrongly repeated on the balance sheet, SOCE,
directors' report and directors' statement — fix on every sheet, every year.

### Step 3 — Tax computation (see §9)

### Step 4 — Approvals and resolutions (see §6 and the templates in `Resolutions Templates/`)

### Step 5 — Filings (see §8)

## 5. Notes to the financial statements — required contents

Rebuild the notes for an **investment holding company**. ⚠️ The FY2025 notes were carried over
verbatim from an old FY2022 wholesale-trade template (inventories, staff costs, warehouse rental,
10,000 shares of S$10,000 capital, FRS 39 "loans and receivables" categories, FYE dated
28 February 2022). None of that applies — do not roll it forward. The note set below replaces it.

### 5.1 Note skeleton

1. **General information** — UEN, registered office (current!), principal activity = investment
   holding, date FS authorised for issue by directors' resolution.
2. **Summary of significant accounting policies:**
   - Basis of preparation — historical cost except financial assets at FVTPL; SFRS(I) and the
     Companies Act; statement on new/revised standards adopted and issued-but-not-effective.
   - Critical judgements/estimates — fair value of quoted securities (Level 1 quoted prices);
     carrying amount of the insurance policy asset (surrender value per insurer's statement).
   - Functional and presentation currency — SGD.
   - **Financial assets (SFRS(I) 9)** — quoted equity securities measured at **fair value through
     profit or loss (FVTPL)**; fair value from quoted closing prices at reporting date; dividend
     income recognised when the right to receive payment is established. Cash at amortised cost.
     (⚠️ The legacy working file carries securities at cost of purchases less sales — restate to
     year-end market value using `data/prices/prices_*.json` / broker statement, with the movement through P&L.)
   - **Insurance policy assets** — the three company-owned policies (all on the life of Ong Ah
     Whatt) carried at cash/surrender value per the insurer's statements (surrender values are not
     tracked at each year end — carry forward the last available figure and refresh when GE
     provides updated values); policy dividends/payouts recognised in income when
     received/receivable. **All premiums** (company-owned policies plus other family policies for
     OAW/NLK paid under the family mandate) **expensed as incurred**. Premiums for family policies
     paid from personal accounts enter the books only if Eric directs (expense + credit the payer's
     loan account). Disclose that the policies are on the life of a director/shareholder.
   - Financial liabilities — other payables and shareholder loan at amortised cost.
   - Income taxes — current and deferred tax policy.
   - Impairment of non-financial assets (only if any remain applicable).
3. **Profit/(loss) before tax** — disclose material items (e.g. fair value gain/loss, accounting fees).
4. **Quoted securities** — carrying amount, fair value hierarchy (Level 1), movement for the year.
5. **Insurance policy** — surrender value, related party (life assured is a director/shareholder).
6. **Cash and cash equivalents.**
7. **Share capital** — 1 ordinary share, S$1, no par value, one vote per share. (⚠️ Fix the stale
   "10,000 shares / S$10,000" note.)
8. **Other payables** (if any).
9. **Amount owing to shareholder** — non-trade, unsecured, interest-free; state the actual
   repayment terms consistently with its balance-sheet classification (§5.3).
10. **Financial instruments** — SFRS(I) 9 categories (FVTPL / amortised cost — not FRS 39
    "loans and receivables"); risk management (credit, liquidity, **market/price risk** on the
    equity portfolio — add a sensitivity sentence); maturity table; fair value statement.
11. **Related party transactions** — shareholder loan movements during the year; insurance policy
    on director's life; any dividends paid.
12. **Capital management.**
13. **Going concern** — see §5.3.

### 5.2 Fair value of quoted securities — decision

Preferred treatment (SFRS(I) 9): FVTPL with year-end mark-to-market. If Eric elects to keep the
legacy cost-based approach, record that decision explicitly for the year, keep it consistent, and
note the deviation — but FVTPL is the compliant treatment and the portfolio ledger already tracks
prices, so default to FVTPL.

### 5.3 Shareholder loan classification and going concern

⚠️ FY2025 inconsistency: the balance sheet showed the loan (S$1,015,473) as **non-current**, while
the note said it is "repayable on demand" (= current). Resolve each year in one of two ways:

- **(Preferred)** Obtain the **Letter of Financial Support** from Ong Ah Whatt (template provided)
  in which he undertakes not to demand repayment within 12 months of the FS approval date and to
  provide continuing financial support → classify non-current, and cite the letter in the going
  concern note; **or**
- Classify the loan as **current** and accept the resulting net current liability presentation.

Because the company is in net liabilities, the going concern basis rests on the shareholder's
support. The going concern note must say so, and the letter should be signed **before** the
directors sign the Directors' Statement (the solvency opinion in it depends on this support).

## 6. Directors' Report, Directors' Statement and resolutions

Approval sequence each year (written resolutions, no AGM):

1. **Directors' resolutions in writing** — approve the FS and notes, note the s205C small-company
   audit exemption, note the letter of financial support, authorise two directors to sign the
   Directors' Statement, direct circulation of FS to the member within 5 months of FYE, and
   authorise the Annual Return filing. → Template: `Directors_Resolutions_FS_Approval.docx`
2. **Directors' Statement** (part of the FS pack; s201(16) + Twelfth Schedule) — signed by both
   directors, stating: (a) in the directors' opinion the FS give a true and fair view of the
   financial position and performance, changes in equity and cash flows; and (b) at the date of the
   statement there are reasonable grounds to believe the company will be able to pay its debts as
   and when they fall due (supported by the shareholder's letter). Include the audit-exemption
   paragraph (s205C; no ≥5% member has required an audit; directors acknowledge s199
   record-keeping responsibilities). ⚠️ The FY2025 statement still referenced "28th February 2022"
   and had singular/plural typos — the date must be the current FYE and grammar corrected.
3. **Directors' Report** (customary, kept from past practice) — directors in office; arrangements
   to acquire shares/debentures (nil); directors' interests in shares (Ong Ah Whatt — 1 ordinary
   share, per s164 register) with as-at start/end of year columns; directors' benefits; share
   options (nil).
4. **Circulate FS to the sole member by 31 August** (within 5 months of FYE) — this satisfies
   s203(1) and secures the private-company AGM exemption under s175A(1)(a), so no AGM is required
   (the member retains the right to require one within the statutory window).
5. **Members' resolutions in writing** — sole member (Ong Ah Whatt) resolves to receive and adopt
   the FS and notes the audit exemption. → Template: `Members_Written_Resolutions.docx`
6. **Letter of financial support** — signed by Ong Ah Whatt, addressed to the board, dated on or
   before the Directors' Statement. → Template: `Letter_of_Financial_Support.docx`

Dating rule: Directors' resolutions and Directors' Statement date = FS authorisation date (also
disclosed in Note 1). Members' resolutions follow after circulation. All before the Annual Return.

## 7. Tie-out checklist (run before anything is signed)

- [ ] TB balances (debits = credits, check row ≈ 0 with no rounding residue).
- [ ] TB opening balances = prior-year **signed** FS closing balances.
- [ ] SOCE rolls: opening + total comprehensive income = closing, for both years shown, and the
      closing accumulated losses **equal the balance sheet and TB figure**. ⚠️ In FY2025 the SOCE
      showed −116,307.07 vs balance sheet −123,434.53 (S$7,127.46 break, ≈ the FY2020 loss) —
      rebuild the SOCE from signed FS history rather than rolling the sheet forward.
- [ ] P&L retained-profit b/f and c/f lines agree to the TB to the cent (FY2025 had a S$0.29
      discrepancy) — better: remove retained-profit lines from the face of the P&L; they belong in
      the SOCE.
- [ ] Balance sheet balances: total assets = equity + liabilities (both years).
- [ ] Cash flow statement closing cash = balance sheet cash.
- [ ] Quoted securities carrying value agrees to year-end market valuation (broker statement /
      prices file); insurance policy value agrees to insurer's statement.
- [ ] Shareholder loan closing balance agrees to a movement schedule (opening + advances −
      repayments) built from the bank statements.
- [ ] Every note figure agrees to the face of the statements; note cross-references filled in.
- [ ] All page headers show the correct statement titles and current FYE date.
- [ ] Comparative column figures identical to the prior-year signed FS.
- [ ] Registered office, principal activity, share capital, directors — current and consistent
      across cover, report, statement, and notes.

## 8. ACRA filings

| What | Deadline (FYE 31 Mar) | Notes |
|---|---|---|
| FS to member (s203 / s175A) | **31 August** (5 months) | Secures AGM exemption |
| AGM | Not held | Private company exempt under s175A(1)(a) if FS sent by 31 Aug; otherwise AGM due by 30 September (6 months) |
| Annual Return (s197) | **31 October** (7 months) | File via BizFile+; late = penalties |

**XBRL decision (check yearly):** the company is an EPC. If it were solvent, no FS need be filed
with the Annual Return (online solvency declaration only). While it is **balance-sheet insolvent**
(liabilities exceed assets — the current position), the FS **must be filed**:

- **Full XBRL** if total revenue **or** total assets exceed S$500,000 → currently applies (total
  assets ≈ S$892k) even though revenue is tiny.
- **Simplified XBRL + PDF** of the signed FS only if **both** total revenue **and** total assets
  are ≤ S$500,000.

Prepare the XBRL file with ACRA's BizFinx preparation tool (or via the filing agent) from the
approved FS, validate, and attach to the Annual Return.

## 9. IRAS filings and tax computation

| What | Deadline | Notes |
|---|---|---|
| ECI | 30 June (3 months after FYE) | **Waived** if annual revenue ≤ S$5m **and** ECI is nil — check both conditions each year; historically satisfied (losses, no revenue) |
| Form C-S / C | **30 November** | Form C-S if revenue ≤ S$5m (C-S (Lite) if ≤ S$200k); keep the tax computation on file |

Tax computation mechanics (investment holding company — IRAS IHC basis):

- Start with net accounting profit/(loss).
- **Non-taxable receipts:** Singapore one-tier dividends (exempt); life insurance policy
  payouts/bonuses (capital receipts); fair value gains on securities and realised gains of a
  capital nature (Singapore does not tax capital gains). ⚠️ Label these correctly — the FY2025 comp
  lumped the policy payout under "dividend income".
- **Non-deductible:** premiums on the policy on the director's life (not incurred in producing
  income), fair value losses (capital), and expenses attributable to non-income-producing assets.
- As an IHC, statutory expenses are deductible only against investment income by source; **excess
  expenses cannot be carried forward** and unabsorbed "losses" are disregarded.
- Expected outcome in a typical year: **chargeable income NIL, tax NIL** — but compute and retain
  the working every year.

## 10. Known recurring errors — fix list (from FY2025 file review)

1. Wrong header ("TRADING AND PROFIT & LOSS ACCOUNT") on balance sheet, SOCE, directors' report and
   directors' statement.
2. Directors' Statement dated/referenced to 28 February 2022; grammar errors ("The director
   consider…", "acknowledges").
3. Notes carried from an obsolete wholesale-trade template: wrong principal activity, wrong
   registered office, inventories/staff-cost/rental notes that don't exist, share capital note
   showing 10,000 shares / S$10,000 (actual: 1 share / S$1), FRS 39 categories.
4. SOCE does not tie to balance sheet (S$7,127.46 break) and P&L retained-profit lines off by
   S$0.29.
5. No statement of cash flows.
6. Shareholder loan: non-current on the face vs "repayable on demand" in the note.
7. Quoted securities at accumulated cost, not fair value.
8. Tax comp mislabels the insurance payout as dividend income.

## 11. Output conventions

- Working file: `OK Family Trust 20XX.xlsx` (GL, Trial Balance, Tax Computations, P&L, Balance
  Sheet, SOCE, Cash Flow, Cover page, Report of directors, Statement of directors, Notes).
- Final FS pack for signature/filing: single PDF, named
  `Ong & Kim Family Trust Pte Ltd - Unaudited FS FYE 31 Mar 20XX.pdf`.
- Resolutions: fill the templates in `Resolutions Templates/`, save signed scans alongside the FS.
- Keep all records at least 5 years (s199 Companies Act; IRAS record-keeping).

## 12. Annual timeline (FYE 31 March)

| When | Action |
|---|---|
| April – May | Gather inputs (§3); post GL; draft TB |
| June | Draft FS + notes; run tie-out checklist (§7); check ECI waiver by 30 June |
| July – August | Directors' resolutions + support letter; sign Directors' Statement; **send FS to member by 31 Aug**; members' written resolutions |
| September – October | Prepare XBRL; **file Annual Return by 31 Oct** |
| By 30 November | File Form C-S with IRAS |

---

## 13. Family-office dashboard (Claude Code)

The dashboard (Rules · Portfolio Ledger · Cash on Hand · Property · Insurance) lives in `app/` — see
**`app/CLAUDE.md`** for how it works, the data model, and the standing rules. Quick start: `npm start` →
http://localhost:8787 (data in `data/state/okfo-state.json`); `npm test`; `node app/tools/state.js summary`.
Project skills: `refresh-prices`, `process-bank-pdfs`, `sync-dashboard-data`, `update-registers`.
For the FS (§3 item 3), the year-end holdings and prices come from this data — export a Backup JSON with
`node app/tools/state.js export` and use the Holdings/Period Summary export (*Export .xlsx*) for the year.
`PORTING.md` lists everything that came over from Cowork.
