# G2 — Live Dashboard

Public performance dashboard for an FTMO 2-step Swing prop-firm strategy
(EURUSD, GBPJPY).

**Live site:** [https://frogastronaut232.github.io/ftmo-dashboard/](https://frogastronaut232.github.io/ftmo-dashboard/)

## What's here

This repo contains **only the dashboard** — the static site + the public-safe
performance CSVs (trades, equity curve, daily signals, current state). The
strategy code, model parameters, feature recipes, and per-model ensemble
votes are **not** in this repo and never leave the machine that runs the
trades.

```
ftmo-dashboard/
├── index.html       — page layout
├── style.css        — trading-desk theme
├── app.js           — fetches /data, renders charts + tables
├── .nojekyll        — opt out of Jekyll on GitHub Pages
└── data/
    ├── state.json   — current snapshot (equity, today P&L, open positions)
    ├── meta.json    — strategy metadata
    ├── equity.csv   — daily balance / drawdown
    ├── trades.csv   — every closed trade
    └── signals.csv  — daily signals (date, asset, conviction, decision)
```

## How it updates

The Windows execution box runs `scripts/report.py --push` after each daily
signal run, which writes fresh CSVs into `data/` and pushes the commit.
A separate `scripts/heartbeat.py --push` job polls MT5 every 10 min during
market hours to refresh `state.json` with live equity / open-position P&L.

The page polls `data/` every 60 seconds and re-renders.

## Hosting

Plain GitHub Pages, served from the repo root on the `main` branch.
No build step, no backend, free.

To set up Pages: repo *Settings → Pages → Source: Deploy from a branch →
main / (root)*. URL appears within ~1 minute.
