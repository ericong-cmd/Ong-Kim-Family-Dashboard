---
name: refresh-prices
description: Refresh live SGX prices for every held equity (and every ticker with a rule) in the Ong & Kim family-office dashboard through the Interactive Brokers (IBKR) connector, and write them into the dashboard data. Use when Eric says "refresh prices", "update prices", "pull live prices", "what's the portfolio worth now", or pastes the price request from the dashboard.
---

# Refresh prices

The dashboard's data is `data/state/okfo-state.json`; prices are written with `app/tools/state.js`
(the open dashboard reloads by itself).

1. List what to quote: `node app/tools/state.js tickers` → `TICKER  contract_id  stored_price  asOf`.
2. For each ticker, with the Interactive Brokers connector:
   - no contract id → `search_contracts` with the symbol; take the **SGX** listing whose symbol matches
     exactly, and remember it: `node app/tools/state.js put maps '{"key":"cid:<TICKER>","value":<id>}'`.
   - `get_price_snapshot` (contract_id, exchange `SGX`, market_data_names `["last","bid_ask"]`). Use
     `last.price` when present and not halted, dated today in Singapore time (or the `ts` date).
   - Empty `last` (market closed / no trade) → `get_price_history` (security_type `STK`, exchange `SGX`,
     step `ONE_DAY`, period `ONE_WEEK`, outside_rth false) and take the **last close**, dated with that
     bar's date (`time[n-1]`, first 10 characters).
   - Use the price **exactly as quoted — never adjust for corporate actions.**
3. Write all prices in one call:
   `node app/tools/state.js set-prices BN4=11.30@2026-10-02 V03=16.72@2026-10-02 …`
   (values are snapped to SGX ticks; `--source IBKR` is the default).
4. Report: how many refreshed, any that failed (and why), and the as-of date(s). If the IBKR connector
   isn't available in this session, say so and suggest connecting it via `/mcp`.

Notes
- SGX trades 09:00–17:00 SGT, Mon–Fri. Outside those hours the latest daily close is the right price.
- Illiquid counters may have no bar for days — keep the older close with its own `asOf`; don't invent.
- For the Cowork artifact the page does this itself on open; this skill is for the local dashboard.
