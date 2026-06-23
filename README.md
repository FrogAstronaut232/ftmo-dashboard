# FTMO Live Dashboard (G2 + G10 FX swing strategies)

Live performance tracker for the systematic FX strategies I'm running against FTMO prop-firm
challenges.

**Live site:** https://frogastronaut232.github.io/ftmo-dashboard/

## What I'm actually doing here

The goal is simple: I want to make money trading prop firms.
FTMO (and firms like it) give you a funded account if you can pass an evaluation, hit a profit
target without breaching a daily or total loss limit, and then they let you keep most of the
upside. So the game is to build trading strategies that are genuinely good, prove to myself they
aren't just curve-fit nonsense, size them so they pass the evaluation more often than not, and
run them on autopilot.

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

## "Okay but is it just overfit?"

Fair question, and it's the one I cared about most, because a backtest that looks amazing and
then loses money live is the default outcome in this space. So before trusting any of it I threw
a large adversarial robustness suite at both strategies, plus a separate independent review whose
explicit job was to find evidence the results were fake. Here is what came back. The full
write-ups are in the research folders (not in this repo, but here's the gist).

### G10 (strict out-of-sample 10-pair portfolio)

The design is strict: train on 2004 to 2015, do all hyperparameter search on 2016 to 2017 only,
and leave 2018 to 2026 completely untouched until the very end. Headline out-of-sample Sharpe is
about 4.49, and it reproduces bit-for-bit from a cold run. More importantly, 20-plus independent
checks tried to break it and couldn't:

- **No leak.** Feeding the macro inputs from the future degrades performance smoothly the further
  forward you shift them. A real future-data leak would do the opposite (it would get better). It
  doesn't.
- **Not noise.** Replacing prices with white noise or random walks gives a Sharpe around -0.55.
  The real result sits about 16 standard deviations above that null. Sign-permutation and block
  permutation nulls both reject at p < 1/5000.
- **Not one lucky pair or one lucky day.** Drop the single biggest contributor (USDCHF) and it's
  still 4.00. Drop any 3 pairs and the worst case is 3.28. The top trading day is under 1% of
  total profit.
- **Not fragile to the setup.** Shift the out-of-sample start date by plus or minus 18 months and
  Sharpe stays between 4.43 and 4.86. Swap to entirely different FX universes and it still earns
  (1.6 to 2.8). Pull the macro data from a totally different source (FRED instead of yfinance) and
  it reproduces at 3.90.
- **Honest caveat I'm not hiding:** the 2018 to 2026 window flatters the strategy. Replayed on
  2010 to 2015 the Sharpe is closer to 1.3. So my real forward expectation is Sharpe 1.5 to 2.5,
  not 4.5, and I size to the conservative number on purpose.

### G2 (2-pair manifold-state ensemble)

8.3 years out-of-sample (2018 to 2026), annualised Sharpe 2.57, CAGR about 16%, max drawdown
about 6%. The overfitting-specific tests are the ones that matter here:

- **Deflated Sharpe Ratio** at the actual production search budget (800 real trials) is 0.98,
  above the 0.95 bar. This is the metric that directly penalises you for how much searching you
  did.
- **Probability of Backtest Overfitting** (PBO via combinatorially-symmetric cross-validation) is
  essentially zero (0.00 to 0.001).
- **Permutation null:** p(sign) = 0.000000 over 100,000 permutations.
- **Cost stress:** it survives an extra 5.4 pips per day of trading cost before Sharpe drops below
  0.5, and it's still at 2.0 with an extra 1.5 pips. Real fills won't be anywhere near that bad.
- **Regime stable:** roughly the same Sharpe across low, mid and high VIX, and it stayed positive
  through COVID, the 2022 UK gilt crisis, the BoJ FX interventions and the 2024 yen-carry unwind.
- Bootstrap 95% confidence interval on the Sharpe is about [1.86, 3.29].

None of this makes either strategy a sure thing. Live is always harder than backtest. But "is it
just overfit" has a real answer here, and the answer is no, the edge is there, just smaller than
the headline.

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
