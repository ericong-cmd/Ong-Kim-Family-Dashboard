---
name: sync-dashboard-data
description: Move the family-office dashboard's data between the Cowork artifact and the local Claude Code dashboard (Backup JSON import/export), check what the data contains, or roll back to a daily snapshot. Use when Eric says "import my latest backup", "bring over the Cowork data", "export a backup", "sync the dashboard", "what's in the dashboard data", or "restore yesterday's data".
---

# Sync dashboard data

Data file: `data/state/okfo-state.json` (local dashboard). Backups: `data/backups/portfolio-ledger_backup_<date>.json`.

## Cowork → Claude Code (bring the latest over)
1. Eric exports it: Cowork dashboard → Portfolio Ledger → *Export & data* → **Backup JSON**, and saves the
   file into `data/backups/` (it downloads as `portfolio-ledger_backup_<date>.json`).
2. `node app/tools/state.js import data/backups/<that file>` — replaces the local data with it (the
   previous state is kept in `data/state/history/`).
3. `node app/tools/state.js summary` and report the counts (transactions, rules, properties, policies,
   people, bank lines) so Eric can confirm nothing is missing.

## Claude Code → Cowork
1. `node app/tools/state.js export` → `data/backups/portfolio-ledger_backup_<today>.json`.
2. Either *Restore JSON* that file in the Cowork dashboard, or `npm run build` (the newest backup becomes the
   artifact's seed — used only where the artifact has no saved data) and Cowork `update_artifact`.

## Roll back
Snapshots: `data/state/history/okfo-state_<date>.json` (first version of each day). To restore one, stop the
server, copy the current file into `_archive/` first, copy the snapshot over `data/state/okfo-state.json`,
set its `rev` higher than the current one, and restart. Never delete files.

## Check
`node app/tools/state.js summary` — counts per store, cash on hand, oldest price date, policies still
needing details, and the one-time flags (`fix:inspecie-v1`, `fill:registry-2026-09-28`).
