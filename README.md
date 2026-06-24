# FTMO Live Dashboard (G2 + G10 FX swing strategies)

Live performance tracker for the systematic FX strategies I'm running against FTMO prop-firm
challenges.

**Live site:** https://frogastronaut232.github.io/ftmo-dashboard/

## The Goal

The objective is to generate consistent, risk-controlled returns through FTMO prop-firm
evaluations and funded accounts. The approach is statistical rather than discretionary: identify
a genuine, measurable edge in the FX markets, validate that edge under rigorous out-of-sample and
anti-overfitting testing, and then engineer each strategy specifically around FTMO's evaluation
constraints (the profit target, the daily loss limit, and the maximum loss limit) so the
probability of passing, and of staying funded, is maximised. The end product is not a generic
backtest but a real edge purpose-built for the FTMO ruleset.

This repo is just the public dashboard. The strategy code, model weights, feature recipes and
per-trade reasoning stay private on the machine that trades. What you can see here is the live
equity curve, open positions, closed trades, daily signals and the backtest baselines.

## The two strategies

- **G2** trades 2 pairs (EURUSD, GBPJPY). A frozen ensemble of manifold-state models.
- **G10** trades 10 FX pairs (AUDJPY, AUDUSD, EURGBP, EURUSD, GBPJPY, GBPUSD, NZDUSD, USDCAD,
  USDCHF, USDJPY). A strict out-of-sample multi-pair portfolio.

Both are daily-close swing strategies. They only trade when the signal flips sign, so they hold
positions for a few days at a time rather than scalping.

**Right now only G10 is trading live.** I built a prop-firm Monte Carlo (10,000 simulated
evaluations on the real strategy returns) to settle whether to run both strategies together or
just one. Running G10 by itself actually beat running both: it passed more often (96.5% vs 94.9%
of simulated 2-step evaluations) and blew up less (1.64 vs 2.11 fail-outs per year), for only
about 9% less expected profit. Two engines fighting over the same pairs (EURUSD, GBPJPY) on one
account just added conflict cost without reducing risk. So the live account is G10 alone, and G2
stays on the bench for now.

## The two $50K accounts you'll see

The dashboard has a toggle between two $50,000 accounts:

1. **Old broker (1st dry run, archived).** The very first live run, where G2 and G10 traded
   together on a generic broker demo for about two weeks. This was purely to prove the whole
   pipeline works end to end: data pull, model inference, position sizing, order placement,
   logging, dashboard push. It's finished and frozen.
2. **FTMO Free Trial (live).** The current run: G10 alone on a $50,000 FTMO Free Trial demo,
   Phase 1, fully automated. No real money yet. This is the last dry run before I buy a real
   evaluation, and it mirrors a paid FTMO challenge as closely as I can get (same rules, spreads,
   fills and swap rates). It fires once per weekday at 08:05 AEST.

## Robustness results

Raw results from the robustness suites and the independent forensic review. Full write-ups live
in the research folders (not in this repo).

### G10 (strict out-of-sample 10-pair portfolio)

Design: train 2004-2015, hyperparameter search on 2016-2017 only, test 2018-2026 untouched.

- OOS Sharpe: +4.487 (cold reproduction bit-identical; re-verified from scratch +4.494)
- White-noise null (random prices, 15 seeds): mean Sharpe -0.55, observed +15.9 sigma above
- Sign-permutation null (5000 perms): p < 1/5000
- Macro shift gradient: -1d -0.56, k=0 +4.49, +1d +4.04, +2d +3.61, +3d +2.68 (future shifts degrade, no leak signature)
- FRED-sourced macro (vs yfinance): +3.90
- Universe robustness (frozen HPs): alt majors-crosses +1.62, alt USD-vs-EM +2.82
- Drop-3 worst-case (120 combos): +3.28
- Drop USDCHF (biggest contributor): +4.00; equal-weight instead of inverse-vol: +4.48
- OOS start-date sensitivity (7 starts, 2017-01 to 2020-01): range [+4.43, +4.86], std 0.148
- Refit cadence Jan-1 to Jul-1: +4.456 vs +4.486
- Feature shuffle (OOS / train randomised): mean -0.62 / -0.64
- Top day = 0.79% of net P&L, top 10 days = 8.3%
- Pre-2018 replay (2010-2015, frozen HPs): Sharpe ~+1.26 (regime-flattering; honest forward 1.5-2.5)

### G2 (2-pair manifold-state ensemble)

OOS 2018-2026, T = 2084 obs (8.29 years).

- Annualised Sharpe: 2.573 (re-verified from scratch 2.560); CAGR 16.42%; Max DD -6.24%
- Sortino 3.66; Calmar 2.63
- Sharpe 95% CI (stationary bootstrap, B=50000): [1.860, 3.294]
- Deflated Sharpe Ratio @ N=800 production trials: 0.9816 (passes > 0.95)
- PBO via CSCV: S=8 = 0.0000, S=16 = 0.0012
- Permutation null: p_sign(SR) = 0.000000 (100,000 perms)
- SPA vs zero: p = 0.0000 (B=10000); Haircut Sharpe (Harvey-Liu) single-test p = 1.4e-13
- Cost stress: +1.0 pips SR 2.186, +1.5 pips SR 1.992, survives ~5.4 pips/day before SR < 0.5
- Regime (VIX terciles): low 2.86, mid 2.80, high 2.87
- Shock windows: COVID Feb-Apr 2020 +6.8%, UK gilt Sep 2022 -2.9%, yen carry Aug 2024 +3.3%

## The bigger plan (and a paper)

There's a method behind this, not just two strategies. The repeatable framework is roughly:
build on a long history, hold out a clean test window you never touch, attack your own backtest
with every overfitting and leakage test you can think of, anchor your forward expectation to the
conservative regime, then use Monte Carlo over the real returns to size the strategy so it
actually passes a prop-firm evaluation instead of just looking good on paper.

If this live test goes well and the framework holds up with real money, I want to write it up
as a paper so anyone can follow the same process to design, validate and deploy their own trading
strategies. That's the longer-term goal: not just one funded account, but a documented method
other people can use.

## What's in this repo

Only the dashboard. The static site plus public-safe performance data (trades, equity, signals,
current state, backtest baselines). No strategy logic, no model parameters, no feature code.

```
ftmo-dashboard/
|-- index.html       page layout
|-- style.css        trading-desk theme
|-- app.js           fetches /data, renders charts and tables
|-- .nojekyll        opt out of Jekyll on GitHub Pages
`-- data/
    |-- trial/g10/            live $50k FTMO Free Trial (G10), state + live stream
    |-- 50k/                  archived old-broker dry run (G2 + G10)
    |-- reference/            G2 full 2018-2026 backtest baseline
    `-- backtest_strict_oos/  G10 strict-OOS backtest baseline
```

## How it updates

The Windows box that trades runs a scheduled task at 08:05 AEST each weekday. It wakes the
machine, logs into MT5, computes signals, places the real orders, pushes fresh data to this repo,
then puts the machine back to sleep. Because the machine sleeps the rest of the day, the dashboard
is a once-a-day snapshot rather than a live intraday ticker. The page itself re-fetches the data
every 60 seconds, so once new data is pushed it shows up on a refresh.

## Hosting

Plain GitHub Pages from the repo root on `main`. No build step, no backend.
