# Ong & Kim Family Office dashboard

Tabs: Rules · Portfolio Ledger · Cash on Hand · Property · Insurance. One source, two ways to run it.
Full guide for Claude Code: **`app/CLAUDE.md`**.

## Local / Claude Code

```bash
npm install            # test dependency (jsdom) — once
npm start              # http://localhost:8787 — data in data/state/okfo-state.json
npm test               # all suites
npm run state -- summary
```

- First open with no `data/state/okfo-state.json` seeds from the newest `data/backups/portfolio-ledger_backup_*.json`.
- To bring the latest data from Cowork: Backup JSON in the Cowork dashboard → save into `data/backups/` →
  `node app/tools/state.js import data/backups/<file>`.
- Live prices: ask Claude Code to "refresh prices" (skill `refresh-prices`, IBKR connector).
- Bank PDFs: save into `Statements/Bank/`, press *Process new PDFs now* (needs `brew install tesseract poppler`);
  anything that doesn't reconcile → ask Claude Code to "process the bank PDFs".
- Daily snapshots of the data: `data/state/history/`.

## Cowork artifact

`npm run build` → `app/dist/family-office.html`, published with Cowork `update_artifact` id
`ong-kim-family-office` (IBKR connector tools: `get_price_snapshot`, `get_price_history`, `search_contracts`).
Data lives in the artifact's browser storage; the newest backup is the seed for a device with no saved data.
Bank PDFs there run through the Cowork task `ok-bank-statement-pdfs` (on demand).

## Moving data

*Export & data → Backup JSON* (either dashboard) writes a v3 backup: ledger, prices, histories, boundaries,
rules, bank lines, properties, policies, people, learned mappings and one-time-fix flags.
`node app/tools/state.js import|export` moves it in/out of the local data file; *Restore JSON* loads it in a page.

## Source

See the layout table in `app/CLAUDE.md`. Specs and the build plan: `docs/superpowers/`.
