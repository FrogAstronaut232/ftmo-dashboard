# G2 + G10 - FTMO Live Dashboard

Public performance dashboard for two FTMO 2-step Swing prop-firm strategies
running concurrently on the same MT5 demo account.

**Live site:** [https://frogastronaut232.github.io/ftmo-dashboard/](https://frogastronaut232.github.io/ftmo-dashboard/)

## The two strategies

- **G2** trades 2 pairs (EURUSD, GBPJPY). Magic number 84207, order comment `G2`.
- **G10** trades 10 G10 FX pairs (AUDJPY, AUDUSD, EURGBP, EURUSD, GBPJPY,
  GBPUSD, NZDUSD, USDCAD, USDCHF, USDJPY). Magic numbers 100010 through 100019
  (one per pair), order comment `ManifoldFX10`.

Both fire at 08:05 AEST (= 22:05 UTC) each weekday, sized for a $50k FTMO
Swing 2-step account with 20% annualised portfolio vol target (Phase 1).
Distinct magic numbers and comment tags keep the two strategies cleanly
separable inside MT5's trade history.

## Live testing window

We are running **1 month of live forward-testing on a demo account** before
committing real capital to a funded FTMO Challenge account. The goal of the
demo period is to confirm:

1. Live MT5 fills match the backtest signal direction and sizing.
2. The end-to-end automation (scheduled tasks, MT5 IPC, dashboard push) is
   reliable for at least 20 consecutive trading days.
3. Floating P&L behaviour and drawdown patterns look plausible compared to
   the 2018-2026 backtest.

If the demo month is clean, the better-performing of the two strategies will
be deployed on a funded Challenge. If both look strong, both get deployed
on separate accounts.

## What's in this repo

This repo contains only the dashboard: the static site plus the public-safe
performance CSVs (trades, equity curve, daily signals, current state). The
strategy code, model parameters, feature recipes, and per-model ensemble
votes are NOT in this repo and never leave the machine that runs the trades.

```
ftmo-dashboard/
├── index.html       (page layout)
├── style.css        (trading-desk theme)
├── app.js           (fetches /data, renders charts + tables)
├── .nojekyll        (opt out of Jekyll on GitHub Pages)
└── data/
    ├── state.json              (G2 current snapshot)
    ├── meta.json               (G2 strategy metadata)
    ├── live/                   (G2 live forward-test data)
    ├── reference/              (G2 full 2018-2026 backtest)
    ├── g10/                    (G10 state, live data)
    └── backtest_strict_oos/    (G10 Strict-OOS backtest data)
```

## How it updates

The Windows execution box runs two daily tasks at 08:05 AEST (one per
strategy), each calling `execute.py --phase auto` to compute signals, place
real orders on MT5, and push fresh CSVs to this repo. A separate heartbeat
job runs every 15 minutes to refresh `state.json` and floating P&L with
live data straight from the MT5 broker connection.

The page itself polls `data/` every 60 seconds and re-renders.

## Hosting

Plain GitHub Pages, served from the repo root on the `main` branch. No
build step, no backend, free.

To set up Pages: repo Settings then Pages then Source: Deploy from a branch
then main / (root). URL appears within about 1 minute.
