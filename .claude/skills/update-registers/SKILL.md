---
name: update-registers
description: Fill in or update the Insurance and Property registers of the family-office dashboard from the documents in the Insurance/ and Property/ folders (premium notices, renewals, policy schedules, OTPs, completion accounts, tenancy agreements, MCST invoices, property tax bills). Use when Eric adds a new policy or property document, says "update the insurance/property details", "fill in the details", or asks what is still missing.
---

# Update the Insurance and Property registers

Records live in the dashboard data (`node app/tools/state.js get policies|properties|people`).

1. Find what changed: new or newer files under `Insurance/<person>/<policy folder>/` or `Property/<address>/`
   (folder names carry date, product, policy number and amounts). Skip medical reports, claims and
   health screening papers — they are not needed for the register.
2. Read the newest relevant document (Read tool for PDFs/images; `pdftotext -layout` for text PDFs;
   `tesseract` for scans). Prefer, in order: latest renewal/premium notice → policy schedule → summary sheet
   (`Insurance/Insurance Summary.xlsx` has known errors — documents win).
3. Update one record at a time with the **full** record:
   `node app/tools/state.js get policies <id>` → edit → `node app/tools/state.js put policies '<json>'`.
   - premium = **annual** amount; `freq` monthly/quarterly/half-yearly/annual/single; `due` = a due date (it rolls forward).
   - types must be one of the dashboard's list (Life: Term life, Whole life, Endowment, Investment-linked (ILP),
     Universal life, Annuity / retirement, Mortgage reducing term · Health: MediShield Life, Integrated Shield
     Plan, Shield rider, Critical illness, Early critical illness, Hospital cash, Disability income, CareShield
     Life / long-term care supplement · Personal accident · General: Travel, Home / fire, Home contents, Motor,
     Maid (FDW), Pet · Keyman / business, Other).
   - `paidBy` "Ong & Kim Family Trust Pte Ltd" only with evidence (a payment from the company's UOB account or a company
     reimbursement); otherwise the person, or blank + a note "payer to confirm".
   - Set `needsDetails` false once type, sum assured (if applicable) and premium are known.
   - Properties: purchase price in S$ (blank if bought in another currency — put it in notes); MCST per its
     billing period with `mcstFreq`; property tax per year; loan = outstanding bank loan.
4. Never copy NRIC/passport or bank account numbers into notes. Never overwrite something Eric typed without
   saying so; never delete records (Eric deletes in the page).
5. Report what changed and what is still missing (see "Open items" in app/CLAUDE.md, and update that list).

The folder-derived baseline is `app/src/seed.extra.json` (registry `registry-2026-09-28`). If you refresh it,
bump the registry version in `app/lib/assemble.js` so the one-time fill runs again — it only fills blanks and
adds missing records.
