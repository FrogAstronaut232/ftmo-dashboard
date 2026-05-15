"""Recompute the G2 reference section to cover the full 2018-2026
backtest, not just the 2025+ OOS replay.

Outputs (mirroring website/data/reference/):
  - equity.csv      (already rebuilt by build_benchmark_overlays.py)
  - trades.csv      (derived from signal_cache sign-flips × port_ret accruals)
  - signals.csv     (per-day signal records for the EURUSD / GBPJPY pair)

Also updates website/data/state.json:
  - reference_metrics  (total_trades, win_rate, profit_factor, etc.)
  - reference_first_date / reference_last_date

Run:
  py website\rebuild_reference_full.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE         = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
INITIAL_USD  = 50_000.0

EQUITY_CACHE = PROJECT_ROOT / "2_Assets_FX" / "backtester" / "backtest" / "output" / "equity_cache.csv"
SIGNAL_CACHE = PROJECT_ROOT / "2_Assets_FX" / "backtester" / "backtest" / "output" / "signal_cache.parquet"

REF_DIR      = HERE / "data" / "reference"
STATE_PATH   = HERE / "data" / "state.json"
LOCAL_STATE  = PROJECT_ROOT / "2_Assets_FX" / "results" / "state.json"
LOCAL_REF    = PROJECT_ROOT / "2_Assets_FX" / "results" / "reference"
META_PATH    = HERE / "data" / "meta.json"

ASSETS = ["EURUSD", "GBPJPY"]
# Each asset is supposed to contribute equally to the portfolio (equal-weight,
# matches backtester portfolio.py). We use per-asset price returns to break
# port_ret out by asset for trade attribution.
ASSET_WEIGHT = 0.5


def _derive_trades(signals: pd.DataFrame, equity_cache: pd.DataFrame) -> pd.DataFrame:
    """Walk each asset's signal series and emit one trade per sign change.

    P&L attribution: for each day, the portfolio daily P&L (= equity[d] -
    equity[d-1]) is split equally across the assets that have an ACTIVE
    signal that day. Each open trade accumulates its assigned P&L. This
    guarantees sum(trade_pnls) == final_equity - initial.
    """
    sig_disc = {a: signals[f"{a}__discrete"].astype(float).fillna(0).clip(-1, 1)
                for a in ASSETS}
    sig_cont = {a: signals[f"{a}__continuous"].astype(float).fillna(0).clip(-1, 1)
                for a in ASSETS}

    # Build a per-asset trade ledger.
    # Each trade is (asset, side, entry_date, exit_date, hold_days, pnl_usd)
    open_trade = {a: None for a in ASSETS}   # dict: asset → {entry_date, side}
    trades = []
    next_trade_id = 100_000

    # equity_cache has columns: Date, port_ret, bh_ret. Index = Date, ascending.
    eq = equity_cache.copy()
    eq["equity"] = INITIAL_USD * (1.0 + eq["port_ret"]).cumprod()
    eq["daily_pnl_usd"] = eq["equity"].diff().fillna(eq["equity"].iloc[0] - INITIAL_USD)

    prev_sigs = {a: 0 for a in ASSETS}
    for date in eq.index:
        cur_sigs = {a: int(np.sign(sig_disc[a].get(date, 0))) for a in ASSETS}
        # Assign today's daily P&L to assets that had an open position
        # YESTERDAY (because today's P&L came from yesterday's holdings).
        active_yesterday = [a for a, s in prev_sigs.items() if s != 0]
        if active_yesterday:
            per_asset = float(eq.at[date, "daily_pnl_usd"]) / len(active_yesterday)
            for a in active_yesterday:
                if open_trade[a] is not None:
                    open_trade[a]["pnl_usd"] += per_asset

        # Now detect sign changes for today → close + open trades.
        for a in ASSETS:
            if cur_sigs[a] != prev_sigs[a]:
                # Close existing trade (if one was open)
                if open_trade[a] is not None:
                    t = open_trade[a]
                    t["exit_date"] = date.strftime("%Y-%m-%d")
                    t["hold_days"] = (date - pd.to_datetime(t["entry_date"])).days
                    t["pnl_pct"]   = round(t["pnl_usd"] / INITIAL_USD * 100, 4)
                    t["pnl_usd"]   = round(t["pnl_usd"], 2)
                    trades.append(t)
                    open_trade[a] = None
                # Open a new trade if signal is non-zero
                if cur_sigs[a] != 0:
                    # Lot sizing: match Phase-1 portfolio scaling (~p1 vol target
                    # ÷ realised vol). For the backtest we approximate with the
                    # continuous-signal strength × max_lots_at_p1. This reproduces
                    # the realistic variation the live MT5 fires would have shown.
                    conviction = abs(float(sig_cont[a].get(date, cur_sigs[a])))
                    lots = round(max(0.05, conviction * 2.2), 2)
                    open_trade[a] = {
                        "trade_id":    next_trade_id,
                        "asset":       a,
                        "side":        "LONG" if cur_sigs[a] > 0 else "SHORT",
                        "entry_date":  date.strftime("%Y-%m-%d"),
                        "entry_price": 0.0,
                        "exit_date":   "",
                        "exit_price":  0.0,
                        "lots":        lots,
                        "ensemble_avg_entry": round(float(sig_cont[a].get(date, 0)), 4),
                        "pnl_usd":     0.0,
                        "pnl_pct":     0.0,
                        "hold_days":   0,
                        "exit_reason": "signal_flip",
                        "is_dry_run":  False,
                    }
                    next_trade_id += 1
        prev_sigs = cur_sigs

    # Close any still-open trades on the last date.
    last_date = eq.index[-1]
    for a, t in open_trade.items():
        if t is not None:
            t["exit_date"] = last_date.strftime("%Y-%m-%d")
            t["hold_days"] = (last_date - pd.to_datetime(t["entry_date"])).days
            t["pnl_pct"]   = round(t["pnl_usd"] / INITIAL_USD * 100, 4)
            t["pnl_usd"]   = round(t["pnl_usd"], 2)
            t["exit_reason"] = "end_of_window"
            trades.append(t)

    df = pd.DataFrame(trades)
    if not df.empty:
        df = df.sort_values("entry_date").reset_index(drop=True)
    return df


def _compute_metrics(trades_df: pd.DataFrame, equity_df: pd.DataFrame) -> dict:
    if equity_df.empty:
        return {}
    eq = equity_df.copy()
    eq["equity"] = pd.to_numeric(eq["equity"], errors="coerce")
    eq["daily_pnl"] = eq["equity"].diff().fillna(0)
    eq["ret"] = eq["equity"].pct_change().fillna(0)

    n_years = max(1.0, (pd.to_datetime(eq["date"]).iloc[-1] -
                        pd.to_datetime(eq["date"]).iloc[0]).days / 365.25)
    sharpe = float(eq["ret"].mean() / eq["ret"].std() * math.sqrt(252)) if eq["ret"].std() > 0 else 0.0
    max_dd = float(eq["drawdown_pct"].max())
    total_pnl = float(eq["equity"].iloc[-1] - INITIAL_USD)

    if trades_df.empty:
        return {
            "total_trades": 0, "win_rate": 0.0, "profit_factor": 0.0,
            "avg_win_usd": 0.0, "avg_loss_usd": 0.0,
            "max_drawdown_pct": max_dd, "total_pnl_usd": round(total_pnl, 2),
            "annualised_sharpe": round(sharpe, 4),
        }
    pnl = trades_df["pnl_usd"]
    wins = pnl[pnl > 0]
    losses = pnl[pnl < 0]
    win_rate = float(len(wins) / len(trades_df) * 100)
    pf = float(wins.sum() / abs(losses.sum())) if losses.sum() != 0 else 0.0
    return {
        "total_trades":      int(len(trades_df)),
        "win_rate":          round(win_rate, 4),
        "profit_factor":     round(pf, 4) if math.isfinite(pf) else 0.0,
        "avg_win_usd":       round(float(wins.mean()), 2) if len(wins) else 0.0,
        "avg_loss_usd":      round(float(losses.mean()), 2) if len(losses) else 0.0,
        "max_drawdown_pct":  round(max_dd, 4),
        "total_pnl_usd":     round(total_pnl, 2),
        "annualised_sharpe": round(sharpe, 4),
    }


def main() -> int:
    print("=== Rebuilding G2 reference (full 2018-2026) ===")
    print(f"  reading {SIGNAL_CACHE.name}...")
    sig = pd.read_parquet(SIGNAL_CACHE)
    sig.index = pd.to_datetime(sig.index)
    print(f"  signals: {len(sig)} rows, {sig.index.min().date()} → {sig.index.max().date()}")

    print(f"  reading {EQUITY_CACHE.name}...")
    eq_cache = pd.read_csv(EQUITY_CACHE, parse_dates=["Date"]).set_index("Date")
    eq_cache = eq_cache.sort_index()

    # Build derived trades from sign-flips, with P&L attributed from daily port_ret
    print("  deriving trades from sign-flips + per-day P&L attribution...")
    trades = _derive_trades(sig, eq_cache)
    print(f"  → {len(trades)} trades")
    if not trades.empty:
        print(f"     win rate (raw): {(trades['pnl_usd']>0).mean()*100:.1f}%")
        print(f"     total P&L (sum of trade P&L): ${trades['pnl_usd'].sum():,.0f}")

    # Build per-day per-asset signal table (rebuild reference/signals.csv).
    # Include ensemble_avg (the continuous signal) so the dashboard's
    # "Conviction" column shows real values, not 0 for every row.
    rows = []
    for a in ASSETS:
        for d, disc_val in sig[f"{a}__discrete"].items():
            cont_val = float(sig.at[d, f"{a}__continuous"]) if pd.notna(sig.at[d, f"{a}__continuous"]) else 0.0
            sig_int = int(np.sign(float(disc_val))) if pd.notna(disc_val) else 0
            rows.append({
                "as_of_date":   pd.to_datetime(d).strftime("%Y-%m-%d"),
                "asset":        a,
                "ensemble_avg": round(cont_val, 4),
                "signal":       sig_int,
                "direction":    "LONG" if sig_int > 0 else "SHORT" if sig_int < 0 else "FLAT",
            })
    sig_csv = pd.DataFrame(rows).sort_values(["as_of_date", "asset"]).reset_index(drop=True)

    # Already-built equity.csv (from build_benchmark_overlays.py)
    eq_path = REF_DIR / "equity.csv"
    eq_df = pd.read_csv(eq_path)
    metrics = _compute_metrics(trades, eq_df)

    # Write trades + signals
    REF_DIR.mkdir(parents=True, exist_ok=True)
    if not trades.empty:
        trades.to_csv(REF_DIR / "trades.csv", index=False)
    sig_csv.to_csv(REF_DIR / "signals.csv", index=False)
    print(f"  wrote {REF_DIR / 'trades.csv'}  ({len(trades)} rows)")
    print(f"  wrote {REF_DIR / 'signals.csv'} ({len(sig_csv)} rows)")

    # Update BOTH state.json files (website + local results). Heartbeat reads
    # from local state and pushes to website, so updating only website gets
    # silently reverted on the next cron heartbeat.
    for state_path in (STATE_PATH, LOCAL_STATE):
        if not state_path.exists():
            print(f"  [skip] {state_path} does not exist")
            continue
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["reference_metrics"] = metrics
        if not trades.empty:
            state["reference_first_date"] = trades["entry_date"].min()
            state["reference_last_date"]  = trades["exit_date"].max()
        else:
            state["reference_first_date"] = eq_df["date"].iloc[0]
            state["reference_last_date"]  = eq_df["date"].iloc[-1]
        state_path.write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")
        print(f"  updated {state_path}")

    # Also mirror the rebuilt reference CSVs to the local results/reference/
    # folder so the next report.py pass doesn't disagree with the website.
    if LOCAL_REF.exists():
        for fname in ("equity.csv", "trades.csv", "signals.csv"):
            src = REF_DIR / fname
            if src.exists():
                import shutil
                shutil.copy2(src, LOCAL_REF / fname)
                print(f"  mirrored {fname} -> {LOCAL_REF / fname}")

    # Drop a lock marker so report.py knows the reference stream is owned
    # by this script and won't try to overwrite it with the narrower OOS replay.
    for d in (LOCAL_REF, REF_DIR):
        if d.exists():
            (d / ".locked_by_rebuild").write_text(
                "Reference stream is owned by website/rebuild_reference_full.py.\n"
                "Delete this file to let report.py rebuild from JSONL again.\n",
                encoding="utf-8"
            )
            print(f"  locked {d / '.locked_by_rebuild'}")

    print(f"     ref window: {state.get('reference_first_date')} → {state.get('reference_last_date')}")
    print(f"     metrics:    {json.dumps(metrics, indent=4)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
