# Backtest & Robustness Results

The actual backtest and robustness-test output for the two FX swing strategies behind this
project, split into **G2** (2-pair) and **G10** (10-pair). These are the receipts: the real
result files, not a marketing summary.

## Important: results only, strategy is proprietary

Everything here is RESULTS. There is deliberately nothing in this folder that reveals HOW the
strategies work. No hyperparameters, no model or ensemble internals, no feature definitions, no
weights, no signal-construction logic, no code. That stays private. What you get is the evidence
that the edge is real and was tested hard: equity curves, drawdowns, per-year and per-pair
performance, the full anti-overfitting battery, and the prop-firm pass-rate simulations.

## Layout

```
G2/  and  G10/
  backtest/     equity, drawdown, per-year / per-pair performance, return distributions, etc.
  robustness/   the test battery (see below)  [G10 only, numbered 01..23]
  propfirm/     FTMO Monte-Carlo: bankroll trajectories, P&L distribution, pass rates (summary.json)
```

## What the robustness suite covers

Deflated Sharpe Ratio (DSR), Probability of Backtest Overfitting (PBO via CSCV), sign/position
permutation nulls, white-noise and random-walk price nulls, walk-forward Monte-Carlo permutation
(WFO-MCPT), minimum-backtest-length, Sharpe confidence intervals (bootstrap), SPA / Reality-Check
/ MCS, haircut Sharpe, cost & slippage stress, regime-conditional performance, tail-risk (CVaR,
drawdowns, QQ), structural-break tests, information coefficient, factor regression, cross-pair
correlation, pre-2018 out-of-sample replay, and trade-level distributions.

## Honest caveat

The headline backtest Sharpes (G2 ~2.57, G10 ~4.49) are strong but the 2018-2026 window is
regime-flattering. The pre-2018 replay sits around Sharpe ~1.3, so the honest forward expectation
is roughly Sharpe 1.5-2.5, and the strategies are sized to the conservative end. Live results are
on the dashboard: https://frogastronaut232.github.io/ftmo-dashboard/
