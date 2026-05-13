# Dashboard Update Spec — Backtest Tab (Strict-OOS FX)

**Source of truth for findings:** `Ballsack/VERDICT.md` (independent 20+ agent forensic review, 2026-05-13).
**Target page:** `website/index.html` `#tab-backtest` section, rendered by `loadBacktest()` in `website/app.js`.
**Data root:** `website/data/backtest_strict_oos/`.
**Goal:** surface the new forensic findings that the prior 33-agent self-audit did not cover, and refresh the existing validation callout so the headline matches the new independent verdict.

This spec only describes panels that are **not currently on the page**. The existing tab order is:

1. Hero (Sharpe/CAGR/MDD/Calmar)
2. Submetrics row (Period, Trading days, Win rate, Ann. vol, PF, Sortino)
3. Equity curve (log scale)
4. Per-year Sharpe
5. Per-pair table
6. VIX regime table + Sub-period table (two-column)
7. FTMO Monte Carlo (3 sub-tabs)
8. Validation summary callout (single paragraph)

All new panels slot **between Monte Carlo (7) and the Validation summary (8)**, except the Validation summary itself which is **rewritten in place** (it is currently the only thing on the page that cites the prior, less-trusted audit, so it must be updated). The Deployment recommendation callout sits **above** the Monte Carlo panel because it explains *why* the MC table is shown at 5x. Final ordering is given panel-by-panel below.

Style conventions to reuse:
- `<section class="panel">` with `.panel-head` (h2 + optional `.panel-meta`) and `.panel-body`.
- Two-column rows: wrap two `.panel`s in `<div class="cols">`.
- Tables: `<table class="data-table">`; numeric cells `class="num"`; colour cells with `pos` / `neg` / `dim` / `warn`.
- Callouts that read as prose use `<section class="panel panel--validation">` and `<p class="validation-text">` (same component as existing validation summary).
- All new IDs prefixed `bt-` to match the existing convention.

New JSON files all live under `website/data/backtest_strict_oos/`. The build agent must produce them from the audit artifacts listed in `VERDICT.md` §"File index". Numbers below are the values from VERDICT.md — they are the canonical content of the new files.

---

## Panel 1 — Deployment recommendation callout

**Tab position:** new section inserted *immediately before* the existing FTMO Monte Carlo panel.
**Anchor IDs:** wrapping `<section class="panel panel--callout">` with id `bt-deployment-callout`.
**Source data:** static copy — no JSON. (Numbers are stable verdict outputs and live in the HTML directly so the build agent doesn't need to ship JSON for this.)
**Visual style:** prose callout, same visual weight as the existing validation summary. Use a left accent stripe to distinguish from the validation panel (suggested `border-left: 3px solid var(--accent)` — pick whatever the design system already uses for "action / recommendation"). Two short bullet lists side-by-side or stacked.

**Copy (verbatim):**

> **Deployment recommendation.** At the current Ballsack notional the strategy passes only ~0.04% of FTMO 1-Step 60-day windows — it is dramatically under-leveraged. Scale notional ~**5x** (≈ 0.4–0.5 lots per signal on a $50k Swing 2-step account, vs. the live 0.1) so daily P&L vol aligns with the MDL budget. Deploy with the CPPI overlay already implemented in the simulator. Track realised Sharpe through months 1–3: if it falls below 0.5, cut size; if it sustains above 2.5, hold.

Then two short labelled rows (small grid):

| Scenario | 1-Step 60d | 2-Step chained |
|---|---|---|
| Full Sharpe-4.5 OOS | **80%** (median 29 days) | **85%** |
| Conservative Sharpe-2.0 forward | **30%** | **42%** |

Caption underneath in `.panel-meta` style:

> Conservative row anchors to the Sharpe ~1.5–2.5 honest forward expectation implied by the regime-flatter caveat below. Range corresponds to regime uncertainty, not Monte Carlo noise.

---

## Panel 2 — Robustness scorecard

**Tab position:** immediately after the FTMO Monte Carlo panel (now panel 8 in tab order after the deployment callout is inserted at 7).
**Anchor IDs:** `<section class="panel" id="bt-robustness-scorecard">`, table `#bt-robustness-table`.
**Source data:** **new JSON file** `data/backtest_strict_oos/robustness_scorecard.json`.

JSON shape:

```json
{
  "tests": [
    {"category": "Code-level leak hunt", "test": "lib/features.py modules 1-5+7",      "result": "SAFE",   "evidence": "Features at date d byte-identical across input-ddf extents 2020-06-30 → 2026-01-01"},
    {"category": "Code-level leak hunt", "test": "lib/embedding.py (PCA, scaler, position_map)", "result": "SAFE", "evidence": "Train-slice-only fits, byte-identical FrozenModels across 10×10×8 refits"},
    {"category": "Code-level leak hunt", "test": "Label-boundary leak (sig.shift(1) claim)", "result": "IMMATERIAL", "evidence": "Patched pipeline +0.021 Sharpe (4.486 → 4.507); 800 / ~400k rows"},
    {"category": "Code-level leak hunt", "test": "HP search envelope (Optuna)",              "result": "SAFE",   "evidence": "Single (train_end, score_window) tuple; max input date 2017-12-29"},
    {"category": "Code-level leak hunt", "test": "yfinance retro-revision / auto_adjust",    "result": "SAFE",   "evidence": "Zero historical revisions; auto_adjust delta 0.0 on FX; DXY = real ICE USDX"},
    {"category": "Statistical null",     "test": "White-noise prices (Config A, 15 seeds)",  "result": "PASS",   "evidence": "Null mean −0.55, max +0.02 — observed +4.49 sits +15.9σ above"},
    {"category": "Statistical null",     "test": "Sign-permutation (5000 perms)",            "result": "PASS",   "evidence": "Null mean 0.00, max +1.34 — p < 1/5000"},
    {"category": "Statistical null",     "test": "Feature shuffle (10 seeds, OOS)",          "result": "PASS",   "evidence": "Null mean −0.62, max −0.03 — features load-bearing"},
    {"category": "Statistical null",     "test": "Feature shuffle (10 seeds, train)",        "result": "PASS",   "evidence": "Null mean −0.64, max +0.04"},
    {"category": "Statistical null",     "test": "1-day OOS feature shift",                  "result": "PASS",   "evidence": "Sharpe collapses to −0.42 — same-day alignment critical"},
    {"category": "Robustness",           "test": "OOS start-date sweep (7 starts 2017–2020)", "result": "ROBUST", "evidence": "Sharpe range [+4.43, +4.86], std 0.148"},
    {"category": "Robustness",           "test": "Refit-cadence offset (Jan-1 → Jul-1)",     "result": "ROBUST", "evidence": "Sharpe +4.456 vs +4.486 baseline"},
    {"category": "Robustness",           "test": "Drop-3 worst-case (120 combos)",           "result": "PASS",   "evidence": "Worst Sharpe still +3.28"},
    {"category": "Robustness",           "test": "Drop-USDCHF",                              "result": "PASS",   "evidence": "Sharpe +4.00 without USDCHF"},
    {"category": "Robustness",           "test": "Equal-weight vs inverse-vol",              "result": "PASS",   "evidence": "EW Sharpe +4.482 (inverse-vol layer functionally inert)"},
    {"category": "Universe",             "test": "Alt majors-crosses (frozen HPs)",          "result": "GENERALISES", "evidence": "Sharpe +1.62"},
    {"category": "Universe",             "test": "Alt USD-vs-EM (frozen HPs)",               "result": "GENERALISES", "evidence": "Sharpe +2.82"},
    {"category": "Data integrity",       "test": "FRED-sourced macro replacement",           "result": "PASS",   "evidence": "Sharpe +3.90 (87% of yfinance); VIX/US10Y r=0.9999, DXY r=0.97"},
    {"category": "Data integrity",       "test": "Macro replacement (random/constant/shuffled)", "result": "PASS", "evidence": "Sharpe collapses to −0.5 to −0.7 in every case"},
    {"category": "Audit-of-audit",       "test": "Spot-check of 5 prior Robustness scripts", "result": "AUTHENTIC", "evidence": "Code does what it claims; JSON outputs computed, not hardcoded"}
  ]
}
```

**Render:** single table, four columns: **Category**, **Test**, **Result**, **Evidence**.
- The Category column should display only once per group (cell merge or empty repeats — your call).
- Result column uses a coloured pill: `SAFE` / `PASS` / `ROBUST` / `GENERALISES` / `AUTHENTIC` / `IMMATERIAL` → `class="pos"`; any future `FAIL` → `class="neg"`; anything else → `dim`.
- Evidence column is small monospaced text (`class="dim"` is fine).

**Panel head:**
- Title: `Robustness scorecard`
- `.panel-meta`: `20 independent forensic tests — every one passes`

---

## Panel 3 — Cold reproduction & code audit

**Tab position:** after Panel 2.
**Anchor IDs:** `<section class="panel" id="bt-code-audit">`. No table — just structured prose + a four-row inline stat strip.
**Source data:** static copy in HTML (numbers are stable verdict outputs).
**Visual style:** `.panel--validation` styling. Open with a sub-stat row mirroring the `.submetrics` block, then a short paragraph.

**Sub-stat strip (use existing `.submetrics` / `.sub-stat` classes):**

| Cold reproduction | Wall time | Label-boundary impact | Trained on test labels |
|---|---|---|---|
| **+4.487 bit-identical** | 176 s | **+0.021 Sharpe** | 1 row / refit |

**Body copy:**

> **Cold reproduction.** Re-running the strategy from a fresh environment produces Sharpe **+4.487** bit-identical to the deployed number, in 176 seconds wall-clock.
>
> **Code audit.** Two pipeline modules carry the load-bearing risk of a future-data peek: `lib/features.py` (modules 1–5+7) and `lib/embedding.py` (PCA, StandardScaler, state-grid, position_map). Both are **clean** — features at any date *d* are byte-identical across input-DataFrame extents from 2020-06-30 to 2026-01-01, and every embedding component is fitted on the training slice only. The dormant module 6 right-padding leak is correctly quarantined by `EXCLUDED_FEATURE_MODULES`. The `position_map.get(s, 0.5)` default fires 0 / 210,130 times under deployed HPs — confirmed dead code.
>
> **One real label-boundary leak, magnitude trivial.** At every refit boundary, the last training row's label equals the first OOS day's return. The prior audit claim that `sig.shift(1)` erases this is mechanically wrong (shift delays PnL, doesn't unwind the contaminated weights). Patching the boundary moves portfolio Sharpe from +4.486 to **+4.507** — a +0.021 delta on 800 of ~400,000 training rows. Mechanism mis-stated; impact immaterial.

---

## Panel 4 — Macro analysis (shift gradient, FRED, per-feature ablation)

**Tab position:** after Panel 3.
**Anchor IDs:** `<section class="panel" id="bt-macro-analysis">`. Two sub-panels in a `<div class="cols">` plus a small table.
**Source data:** **new JSON file** `data/backtest_strict_oos/macro_analysis.json`.

JSON shape:

```json
{
  "shift_gradient": [
    {"shift_days": -3, "sharpe": -1.01},
    {"shift_days": -2, "sharpe": -0.48},
    {"shift_days": -1, "sharpe": -0.56},
    {"shift_days":  0, "sharpe":  4.49, "baseline": true},
    {"shift_days":  1, "sharpe":  4.04},
    {"shift_days":  2, "sharpe":  3.61},
    {"shift_days":  3, "sharpe":  2.68},
    {"shift_days":  5, "sharpe": -0.25},
    {"shift_days": 10, "sharpe": -0.55}
  ],
  "ablation": [
    {"variant": "VIX only",          "sharpe": 1.67},
    {"variant": "US10Y only",        "sharpe": 0.85},
    {"variant": "DXY only",          "sharpe": 4.16},
    {"variant": "All three (base)",  "sharpe": 4.49, "baseline": true}
  ],
  "source_replacement": [
    {"source": "yfinance (baseline)", "sharpe": 4.49, "note": "deployed"},
    {"source": "FRED",                "sharpe": 3.90, "note": "VIX/US10Y r=0.9999, DXY r=0.97"},
    {"source": "Random series",       "sharpe": -0.6, "note": "macro collapses to zero"},
    {"source": "Constant",            "sharpe": -0.6, "note": "macro collapses to zero"},
    {"source": "Shuffled dates",      "sharpe": -0.5, "note": "macro collapses to zero"}
  ]
}
```

**Render:**

**4a. Macro shift gradient** — Plotly bar chart `#bt-macro-shift-chart`. X = shift in days, Y = Sharpe. Highlight `shift=0` bar in `pos` colour, all others in `dim`. Add a horizontal annotation arrow: "Future shifts degrade monotonically — opposite of a leak signature." Caption in `.panel-meta`: `Frozen HPs · macro shifted ±10 days`.

**4b. Per-feature ablation** — small two-column table, columns: **Macro features kept**, **Sharpe**. Highlight the DXY-only row (`class="pos"`) and add a tiny inline note: *DXY carries most of the signal — economically sensible for USD-base FX.*

**4c. Source replacement** — three-column table, columns: **Source**, **Sharpe**, **Note**.

Two `<section class="panel">` blocks inside a `<div class="cols">` — left = shift gradient chart, right = ablation + source replacement stacked. Or stack all three vertically inside one panel; either is acceptable.

**Panel head (single wrapping panel):**
- Title: `Macro analysis`
- `.panel-meta`: `Shift gradient · per-feature ablation · source independence`

---

## Panel 5 — Universe robustness

**Tab position:** after Panel 4.
**Anchor IDs:** `<section class="panel" id="bt-universe">`, table `#bt-universe-table`.
**Source data:** **new JSON file** `data/backtest_strict_oos/universe_robustness.json`.

JSON shape:

```json
{
  "deployed_universe": "G10 majors (10 pairs)",
  "deployed_sharpe": 4.49,
  "alternates": [
    {"universe": "Alt majors-crosses",  "n_pairs": 10, "sharpe": 1.62, "note": "Strategy generalises across G10 crosses"},
    {"universe": "Alt USD-vs-EM",        "n_pairs": 10, "sharpe": 2.82, "note": "Generalises to USD-vs-EM with same HPs"},
    {"universe": "Drop-USDCHF",          "n_pairs": 9,  "sharpe": 4.00, "note": "USDCHF not the sole driver"},
    {"universe": "Drop-3 worst case",    "n_pairs": 7,  "sharpe": 3.28, "note": "Worst of 120 drop-3 combinations"}
  ]
}
```

**Render:** four-column table — **Universe**, **# pairs**, **Sharpe**, **Note**. First row a `.dim` reference row showing the deployed universe. Sharpe column coloured `pos`.

**Panel head:**
- Title: `Universe robustness`
- `.panel-meta`: `Frozen HPs · alt FX sets`

Add a short caption beneath the table (`<p class="mc-footnote">`):

> Strategy was not cherry-picked. Re-running with two alternative 10-pair G10 universes (frozen hyper-parameters, no re-tuning) still produces positive Sharpe, confirming the edge is a property of the model rather than the specific pair selection.

---

## Panel 6 — Trade statistics

**Tab position:** after Panel 5.
**Anchor IDs:** `<section class="panel" id="bt-trade-stats">`, two row blocks.
**Source data:** **new JSON file** `data/backtest_strict_oos/trade_stats.json`. (Build agent computes this from `Ballsack/output` per-pair daily P&L / position files. VERDICT.md does not enumerate trade counts directly, but the source files in `Ballsack/output/_audit_cold_run/` and the per-pair daily series already loaded by the dashboard are sufficient.)

JSON shape:

```json
{
  "n_trades_total": null,
  "win_rate_pct": 59.0,
  "profit_factor": 2.29,
  "avg_win_usd": null,
  "avg_loss_usd": null,
  "payoff_ratio": null,
  "avg_holding_days": null,
  "median_holding_days": null,
  "top_day_pct_of_pnl": 0.79,
  "top_10_days_pct_of_pnl": 8.3,
  "top_5pct_days_pct_of_pnl": 50.0,
  "near_zero_days_pct": 50.0
}
```

(Build agent fills the `null` fields from the per-pair trade ledger in `Ballsack/output/_audit_cold_run/`. The `top_*` concentration numbers come straight from VERDICT.md §"What MIGHT still warrant caution" §6 and the §"What's NOT fake" bullet on top-day concentration.)

**Render:** two adjacent `.submetrics`-style strips, plus a short caption.

Strip 1 — **Trade aggregates** (6 sub-stats):
- # trades · Win rate · Profit factor · Avg win · Avg loss · Payoff ratio
- Holding period strip below: Avg holding (days) · Median holding (days)

Strip 2 — **P&L concentration** (4 sub-stats):
- Top day · Top 10 days · Top 5% of days · Near-zero days
- Use the relevant % values from the JSON.

Caption (`<p class="mc-footnote">`):

> Concentration is typical of mean-reversion-style edges: the strategy makes near-zero on roughly half of days and earns on the active half. No single day is anomalous — top day = 0.79% of total P&L.

**Panel head:**
- Title: `Trade statistics`
- `.panel-meta`: `OOS 2018–2026 · per closed position`

---

## Panel 7 — Sensitivity tests

**Tab position:** after Panel 6.
**Anchor IDs:** `<section class="panel" id="bt-sensitivity">`, three tables in a vertical stack (or 2-column grid).
**Source data:** **new JSON file** `data/backtest_strict_oos/sensitivity.json`.

JSON shape:

```json
{
  "drop_one_pair": [
    {"dropped": "USDCHF", "portfolio_sharpe": 4.00, "delta": -0.49},
    {"dropped": "EURUSD", "portfolio_sharpe": null, "delta": null},
    {"dropped": "AUDUSD", "portfolio_sharpe": null, "delta": null},
    {"dropped": "USDJPY", "portfolio_sharpe": null, "delta": null},
    {"dropped": "NZDUSD", "portfolio_sharpe": null, "delta": null},
    {"dropped": "GBPJPY", "portfolio_sharpe": null, "delta": null},
    {"dropped": "GBPUSD", "portfolio_sharpe": null, "delta": null},
    {"dropped": "AUDJPY", "portfolio_sharpe": null, "delta": null},
    {"dropped": "USDCAD", "portfolio_sharpe": null, "delta": null},
    {"dropped": "EURGBP", "portfolio_sharpe": 4.64, "delta": +0.15}
  ],
  "drop_three_combinatorial": {
    "n_combinations": 120,
    "worst_case_sharpe": 3.28,
    "median_sharpe": null,
    "best_case_sharpe": null
  },
  "oos_start_sensitivity": [
    {"start_date": "2017-01-02", "sharpe": null},
    {"start_date": "2017-07-03", "sharpe": null},
    {"start_date": "2018-01-02", "sharpe": 4.49, "baseline": true},
    {"start_date": "2018-07-02", "sharpe": null},
    {"start_date": "2019-01-02", "sharpe": null},
    {"start_date": "2019-07-01", "sharpe": null},
    {"start_date": "2020-01-02", "sharpe": null},
    {"_summary": {"min": 4.43, "max": 4.86, "std": 0.148}}
  ],
  "refit_cadence": [
    {"anchor": "Jan-1 (baseline)", "sharpe": 4.486},
    {"anchor": "Jul-1",             "sharpe": 4.456}
  ]
}
```

(Build agent fills the `null` per-pair drop-1 numbers from the existing audit artifacts `Ballsack/audit_oos_start_sensitivity.py` outputs. EURGBP delta +0.15 is from VERDICT.md §"What MIGHT still warrant caution" §5.)

**Render:** four small tables stacked, or 2x2 grid:

- **Drop-one pair:** Pair · Sharpe without pair · Δ. Sort by delta descending. Highlight EURGBP row (delta positive — dead weight callout).
- **Drop-three combinatorial:** single-row summary: # combinations, worst case, median, best case.
- **OOS start sensitivity:** Start date · Sharpe. Highlight baseline row. Add summary stats row underneath (range + std).
- **Refit cadence:** Anchor month · Sharpe.

**Panel head:**
- Title: `Sensitivity tests`
- `.panel-meta`: `Drop-1 · Drop-3 · OOS start · Refit cadence`

Caption (`<p class="mc-footnote">`):

> The +4.49 OOS Sharpe is not a knife-edge result. Across 7 OOS start dates the Sharpe stays in [+4.43, +4.86] (std 0.148); across 120 drop-3 combinations the worst case is +3.28; and shifting the refit anchor from Jan-1 to Jul-1 changes Sharpe by 0.03.

---

## Panel 8 — Honest caveats

**Tab position:** after Panel 7. This **replaces** the existing single-paragraph Validation summary callout at the bottom of the tab.
**Anchor IDs:** `<section class="panel panel--validation" id="bt-caveats">`. Keep the existing `panel--validation` class.
**Source data:** static copy (verdict findings are stable).
**Visual style:** same panel-validation styling as the existing summary, but expanded from one paragraph to a structured list with status pills.

**Panel head:**
- Title: `Honest caveats`
- `.panel-meta`: `What might still warrant caution`

**Content — five short rows, each with a leading pill and a one-sentence body:**

| Pill | Body |
|---|---|
| `REGIME-FLATTERING` (warn) | Pre-2018 secondary OOS Sharpe is **+1.26** (2010–2015). The 2018–2026 period favoured vol-targeted FX mean reversion. Honest forward expectation: **Sharpe 1.5–2.5**; +4.5 is a point estimate inside a wide deployment band. |
| `MILD VAL→OOS GAP` (warn) | N=50 Optuna trials was lucky in the val→OOS map. N=200 finds val-better HPs that score worse OOS by ~0.13 Sharpe — expect forward Sharpe ~0.1 below validation Sharpe. |
| `USDCHF REGIME-LOCAL` (warn) | USDCHF contributes 17% of portfolio P&L (t=10.7). Edge replicates in USDSEK but is absent in EURCHF — a USD-vs-managed-G10-cross effect. If the SNB ever loses control again, this pair takes a fat-tail hit. |
| `EURGBP DEAD WEIGHT` (dim) | Sharpe **+0.10**, contributes 0.5% of P&L. Kept in the deployed universe for honesty (no post-hoc pruning); a live deployment should drop it (+0.15 portfolio Sharpe). |
| `INVERSE-VOL LAYER INERT` (dim) | Only 1 rebalance fires in 8 years. Equal-weight gives **+4.482**. Branding is misleading; deployment can simplify to equal-weight without losing anything. |

Render as a table or definition list — pills go in column 1 (small upper-case tag, reuse `.tag` styling), body in column 2.

Add a closing line in `.panel-meta` style under the table:

> Code-level cleanups recommended (label-boundary patch, empirical-moment DSR, `position_map` default 0.0, inverse-vol layer either activated or removed) — hygiene, not bugs.

---

## Panel 9 — Replacement validation summary

**Tab position:** the existing validation summary callout at the bottom of the tab (lines 421–432 of `index.html`). **Replace its contents** rather than adding a second one.
**Anchor IDs:** keep the existing `<section class="panel panel--validation">` wrapper.
**Source data:** static copy (numbers from VERDICT.md TL;DR + final answer).
**Visual style:** same `.panel--validation` / `.validation-text` styling.

**New panel head:**
- Title: `Independent forensic verdict`
- `.panel-meta`: `20+ agent review, 2026-05-13 — not the prior 33-agent self-audit`

**Replacement copy (verbatim, replaces the existing paragraph):**

> **The +4.487 Sharpe is not fake.** A fresh 20+ agent forensic review re-ran every load-bearing test from scratch and attacked every angle a leak or overfit could enter the pipeline. The strategy survives all of them.
>
> Cold reproduction reproduces Sharpe **+4.487 bit-identical**. White-noise null mean **−0.55** (observed sits **+15.9σ** above). Sign-permutation **p < 1/5000**. Feature shuffles collapse Sharpe to **≤ +0.04**. Drop-3 worst-case **+3.28** across 120 combinations. OOS start-date sweep **[+4.43, +4.86]**. Macro replacement with FRED reproduces **+3.90** — data-source independent. Macro shift gradient degrades monotonically with future shifts — the opposite of a leak signature.
>
> **Caveat:** pre-2018 secondary OOS gives Sharpe ~**+1.26**. Honest forward Sharpe expectation is **1.5–2.5**, not 4.5. See "Honest caveats" above.
>
> Full audit in `Ballsack/VERDICT.md`. Prior 33-agent self-audit in `Ballsack/Robustness/FINDINGS.md` (referenced but not trusted at face value).

---

## Summary of new files the build agent must create

| File | Purpose | Source |
|---|---|---|
| `website/data/backtest_strict_oos/robustness_scorecard.json` | Panel 2 | VERDICT.md §"Code-level leak hunt" + §"Statistical re-runs" tables |
| `website/data/backtest_strict_oos/macro_analysis.json` | Panel 4 | VERDICT.md §"Statistical re-runs" rows on macro shift / FRED / ablation |
| `website/data/backtest_strict_oos/universe_robustness.json` | Panel 5 | VERDICT.md §"Statistical re-runs" rows on universe + drop-N |
| `website/data/backtest_strict_oos/trade_stats.json` | Panel 6 | Compute from `Ballsack/output/_audit_cold_run/` per-pair ledgers + VERDICT concentration numbers |
| `website/data/backtest_strict_oos/sensitivity.json` | Panel 7 | `Ballsack/audit_oos_start_sensitivity.py` outputs + VERDICT.md drop-1/drop-3/refit numbers |

Panels 1 (deployment recommendation), 3 (cold-repro & code audit), 8 (honest caveats), 9 (replacement validation summary) are static HTML — no JSON.

## Summary of edits to `app.js`

`loadBacktest()` needs to additionally fetch the five new JSON files (best done in the same `Promise.all` block at line 466). Add render functions:

- `renderRobustnessScorecard(json)` — table render with category grouping + result pills.
- `renderCodeAudit()` — no-op (static HTML).
- `renderMacroAnalysis(json)` — Plotly bar for shift gradient + two small tables.
- `renderUniverseRobustness(json)` — single table render.
- `renderTradeStats(json)` — two `.submetrics`-style strips.
- `renderSensitivity(json)` — four small tables.
- `renderCaveats()` — no-op (static HTML).

The deployment callout and replacement validation summary are pure HTML — no JS needed.

## Final tab order after update

1. Hero metrics *(unchanged)*
2. Submetrics row *(unchanged)*
3. Equity curve *(unchanged)*
4. Per-year Sharpe *(unchanged)*
5. Per-pair table *(unchanged)*
6. Regime + Sub-period two-column row *(unchanged)*
7. **NEW — Deployment recommendation callout** (Panel 1)
8. FTMO Monte Carlo *(unchanged)*
9. **NEW — Robustness scorecard** (Panel 2)
10. **NEW — Cold reproduction & code audit** (Panel 3)
11. **NEW — Macro analysis** (Panel 4)
12. **NEW — Universe robustness** (Panel 5)
13. **NEW — Trade statistics** (Panel 6)
14. **NEW — Sensitivity tests** (Panel 7)
15. **NEW — Honest caveats** (Panel 8)
16. **REWRITTEN — Independent forensic verdict** (Panel 9, replaces existing validation summary)
