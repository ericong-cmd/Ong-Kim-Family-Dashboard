---
name: check-dividends
description: Check every held SGX counter for declared dividends through the Interactive Brokers (IBKR) connector — XD date, amount per share, payment date — work out each owner's entitlement from the ledger holding on the day before XD, and book XD-passed dividends into the dashboard ledger. Use when Eric says "check dividends", "any dividends declared", "when is the XD date", "update dividends received", or when the twice-weekly scheduled task runs it.
---

# Check declared dividends

Runs on the Mac against the local dashboard data (`data/state/okfo-state.json`). Meant to run twice a
week as a scheduled task (Mon and Thu evening SGT), and on demand. The claude.ai artifact and the Cowork
dashboard do the same check by themselves once a day when they open.

1. Tickers to check: `node app/tools/dividends.js tickers` → `TICKER  contract_id`. These are counters
   held now or at any time in the last 60 days (a sale after XD still collects the dividend). For a ticker
   without a contract id, use `search_contracts` and take the **SGX** row whose symbol matches exactly;
   save it with `node app/tools/state.js put maps '{"key":"cid:<TICKER>","value":<id>}'`.
2. For each ticker call the IBKR connector's `get_price_history` with
   `{contract_id, security_type: "STK", exchange: "SGX", step: "ONE_MONTH", period: "ONE_YEAR", outside_rth: false, include_corporate_actions: true}`
   and keep the response's `corp_actions` array **exactly as returned** (empty array if none).
   Each row: `date` = XD date (YYYYMMDD), `announce_date`, `payment_date`, `value` = amount per share,
   `currency`, `type` (`CashDividends`, or e.g. `Splits`).
3. Write them into one file, keyed by ticker, e.g. `data/dividends/corp-actions_<today>.json`:
   `{ "J69U": [ …corp_actions… ], "V03": [ … ], … }`. Do not edit the values.
4. `node app/tools/dividends.js plan data/dividends/corp-actions_<today>.json` and read the plan:
   - **To book** — XD has passed and the ledger has no dividend for that ticker and owner between 7 days
     before XD and 14 days after payment. Amount = shares held at the close of the day before XD
     (per owner, from the ledger) × amount per share, to the cent.
   - **Upcoming** — XD still ahead; the estimate uses today's holding.
   - **Already in the ledger** — matched to an existing dividend (e.g. one added from a bank statement).
     If the ledger amount differs from the entitlement, say so; do not change it.
   - **Other corporate action** (split, bonus, scrip) — never booked; report it for Eric to enter by hand.
5. `node app/tools/dividends.js apply data/dividends/corp-actions_<today>.json` books every "To book" line
   as a DIVIDEND dated on the **XD date** (Eric's decision: the right to receive is fixed at XD, as in the
   FS playbook), with `paymentDate`, the per-share amount and share count in the note, and a source key so
   it is never added twice. The upcoming list is saved for the dashboard's *Declared dividends* card. The
   open dashboard reloads by itself.
6. Report: dividends booked (ticker, owner, XD, payable, per share × shares = amount, financial year it
   falls in), upcoming XD dates with estimates, anything already in the ledger with a different amount,
   other corporate actions, and tickers that failed (and why). If the IBKR connector isn't available,
   say so and stop — never estimate or invent a dividend.

Notes
- The bank statement match uses the payment date of an XD-booked dividend, so when the CDP credit
  arrives in Cash on Hand it shows as already in the ledger (no double count).
- Look-back is 60 days (`--since <days>` to change it). XD dates older than that are left alone.
- Never delete or overwrite ledger entries; never book a dividend whose XD is still ahead.
