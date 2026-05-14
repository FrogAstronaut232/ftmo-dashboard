"""Rebuild the reference equity files for both strategies with:
  1. Strategy equity (daily, compounded from $50k)
  2. SP500 buy-and-hold (^GSPC, normalised to $50k on the same start date)

Outputs:
  data/reference/equity.csv               — ManifoldFX, full 2018-01-02 onwards
  data/backtest_strict_oos/portfolio_bh.csv — G10 with bh_sp500 column added

Run:
  py website\build_benchmark_overlays.py
"""
from __future__ import annotations
from pathlib import Path
import sys

import pandas as pd
import yfinance as yf

HERE         = Path(__file__).resolve().parent             # website/
PROJECT_ROOT = HERE.parent                                  # Execution_FTMO/
INITIAL_USD  = 50_000.0

# Source data
MANIFOLD_RETURNS = PROJECT_ROOT / "2_Assets_FX" / "backtester" / "backtest" / "output" / "equity_cache.csv"
G10_PORTFOLIO    = HERE / "data" / "backtest_strict_oos" / "portfolio.csv"

# Targets
MANIFOLD_REF_OUT = HERE / "data" / "reference" / "equity.csv"
G10_PORTFOLIO_OUT = HERE / "data" / "backtest_strict_oos" / "portfolio.csv"


def _load_sp500(start: str, end: str) -> pd.Series:
    """SP500 daily close normalised to start = INITIAL_USD."""
    df = yf.download("^GSPC", start=start, end=end, progress=False,
                     auto_adjust=False, multi_level_index=False)
    if df.empty:
        raise RuntimeError("yfinance returned no SP500 bars")
    close = df["Close"].astype(float)
    close = close[~close.index.duplicated(keep="first")]
    return close / close.iloc[0] * INITIAL_USD


def build_manifoldfx() -> None:
    print("\n=== ManifoldFX reference (full 2018-2026) ===")
    src = pd.read_csv(MANIFOLD_RETURNS, parse_dates=["Date"])
    src = src.sort_values("Date").reset_index(drop=True)
    print(f"  port_ret rows: {len(src)}   {src['Date'].min().date()} → {src['Date'].max().date()}")

    src["equity"] = INITIAL_USD * (1.0 + src["port_ret"]).cumprod()
    src["peak_equity"]  = src["equity"].cummax()
    src["drawdown_pct"] = (src["peak_equity"] - src["equity"]) / src["peak_equity"] * 100
    src["daily_pnl"]    = src["equity"].diff().fillna(src["equity"].iloc[0] - INITIAL_USD)

    start = src["Date"].iloc[0].strftime("%Y-%m-%d")
    end   = (src["Date"].iloc[-1] + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    sp500 = _load_sp500(start, end)
    print(f"  SP500 rows: {len(sp500)}   {sp500.index.min().date()} → {sp500.index.max().date()}")

    src["bh_sp500"] = src["Date"].map(
        lambda d: sp500.asof(pd.Timestamp(d.date()))
    ).ffill()

    out = pd.DataFrame({
        "date":         src["Date"].dt.strftime("%Y-%m-%d"),
        "balance":      src["equity"].round(2),
        "equity":       src["equity"].round(2),
        "peak_equity":  src["peak_equity"].round(2),
        "drawdown_pct": src["drawdown_pct"].round(4),
        "daily_pnl":    src["daily_pnl"].round(2),
        "bh_sp500":     src["bh_sp500"].round(2),
    })

    # Anchor row at exact $50k baseline (1 day before first return)
    anchor = pd.DataFrame([{
        "date": (src["Date"].iloc[0] - pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
        "balance": INITIAL_USD, "equity": INITIAL_USD,
        "peak_equity": INITIAL_USD, "drawdown_pct": 0.0,
        "daily_pnl": 0.0,
        "bh_sp500": INITIAL_USD,
    }])
    out = pd.concat([anchor, out], ignore_index=True)

    MANIFOLD_REF_OUT.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(MANIFOLD_REF_OUT, index=False, float_format="%.4f")
    print(f"  wrote {MANIFOLD_REF_OUT.name}  ({len(out)} rows)")
    print(f"  final equity: ${out['equity'].iloc[-1]:,.2f}  "
          f"SP500 BH: ${out['bh_sp500'].iloc[-1]:,.2f}")


def build_g10() -> None:
    print("\n=== G10 portfolio (with SP500 BH overlay) ===")
    src = pd.read_csv(G10_PORTFOLIO, parse_dates=["date"])
    src = src.sort_values("date").reset_index(drop=True)
    print(f"  portfolio rows: {len(src)}   {src['date'].min().date()} → {src['date'].max().date()}")

    if "equity" in src.columns:
        # If equity is in unit-baseline form (e.g. 1.0 → 3.4), scale to $.
        if src["equity"].iloc[0] < 10:
            src["equity_usd"] = src["equity"] * INITIAL_USD
        else:
            src["equity_usd"] = src["equity"]
    else:
        src["equity_usd"] = INITIAL_USD * (1.0 + src["return"]).cumprod()

    start = src["date"].iloc[0].strftime("%Y-%m-%d")
    end   = (src["date"].iloc[-1] + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    sp500 = _load_sp500(start, end)
    print(f"  SP500 rows: {len(sp500)}   {sp500.index.min().date()} → {sp500.index.max().date()}")

    src["bh_sp500"] = src["date"].map(
        lambda d: sp500.asof(pd.Timestamp(d.date()))
    ).ffill()

    out = pd.DataFrame({
        "date":      src["date"].dt.strftime("%Y-%m-%d"),
        "return":    src["return"].round(8),
        "equity":    (src["equity_usd"] / INITIAL_USD).round(8),  # preserve unit-baseline format
        "equity_usd": src["equity_usd"].round(2),
        "bh_sp500":  src["bh_sp500"].round(2),
    })

    G10_PORTFOLIO_OUT.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(G10_PORTFOLIO_OUT, index=False, float_format="%.4f")
    print(f"  wrote {G10_PORTFOLIO_OUT.name}  ({len(out)} rows)")
    print(f"  final equity: ${out['equity_usd'].iloc[-1]:,.2f}  "
          f"SP500 BH: ${out['bh_sp500'].iloc[-1]:,.2f}")


def main() -> int:
    build_manifoldfx()
    build_g10()
    return 0


if __name__ == "__main__":
    sys.exit(main())
