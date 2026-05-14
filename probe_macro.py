import sys
import pandas as pd
import numpy as np
import yfinance as yf

TICKERS = ["^VIX", "^TNX", "DX-Y.NYB"]
START = "2003-01-01"


def probe(ticker: str) -> None:
    print(f"\n=== {ticker} ===")
    df = yf.download(
        ticker,
        start=START,
        progress=False,
        auto_adjust=False,
        threads=False,
    )
    if df is None or df.empty:
        print("  NO DATA RETURNED")
        return

    # Flatten MultiIndex columns if present
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]

    close = df["Close"].dropna()
    print(f"  rows (raw):           {len(df)}")
    print(f"  rows (close non-NaN): {len(close)}")
    print(f"  first valid date:     {close.index.min().date()}")
    print(f"  last valid date:      {close.index.max().date()}")

    nan_ct = int(df["Close"].isna().sum())
    zero_ct = int((df["Close"] == 0).sum())
    neg_ct = int((df["Close"] < 0).sum())
    print(f"  NaN closes:           {nan_ct}")
    print(f"  zero closes:          {zero_ct}")
    print(f"  negative closes:      {neg_ct}")

    # Gaps in business days
    idx = close.index
    bdays = pd.bdate_range(idx.min(), idx.max())
    missing = bdays.difference(idx)
    if len(missing) == 0:
        print("  gaps > 5 bdays:       none")
        return

    # Group consecutive missing business days
    miss_series = pd.Series(1, index=missing)
    grp = (miss_series.index.to_series().diff() > pd.Timedelta(days=4)).cumsum()
    runs = miss_series.groupby(grp).agg(["count", lambda s: s.index.min(), lambda s: s.index.max()])
    runs.columns = ["len", "start", "end"]
    big = runs[runs["len"] > 5]
    if big.empty:
        print(f"  gaps > 5 bdays:       none (total missing bdays: {len(missing)})")
    else:
        print(f"  gaps > 5 bdays:       {len(big)}")
        for _, r in big.iterrows():
            print(f"    {r['start'].date()} -> {r['end'].date()}  ({int(r['len'])} bdays)")


for t in TICKERS:
    try:
        probe(t)
    except Exception as e:
        print(f"\n=== {t} ===\n  ERROR: {type(e).__name__}: {e}")
