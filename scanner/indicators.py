"""
Tauric Research — Technical Indicators
Pure pandas/numpy implementations (no pandas-ta dependency needed)
"""
import pandas as pd
import numpy as np


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period, min_periods=period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.ewm(alpha=1/period, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    ema_fast = ema(close, fast)
    ema_slow = ema(close, slow)
    macd_line = ema_fast - ema_slow
    signal_line = ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    tr1 = high - low
    tr2 = (high - close.shift(1)).abs()
    tr3 = (low - close.shift(1)).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return tr.ewm(alpha=1/period, min_periods=period).mean()


def bollinger_bands(close: pd.Series, period: int = 20, std_dev: float = 2):
    mid = sma(close, period)
    std = close.rolling(window=period, min_periods=period).std()
    upper = mid + std_dev * std
    lower = mid - std_dev * std
    return upper, mid, lower


def supertrend(high: pd.Series, low: pd.Series, close: pd.Series,
               period: int = 7, multiplier: float = 3) -> pd.Series:
    """Returns a Series of 'bullish' / 'bearish' strings."""
    atr_val = atr(high, low, close, period)
    hl2 = (high + low) / 2
    upper_band = hl2 + multiplier * atr_val
    lower_band = hl2 - multiplier * atr_val

    st = pd.Series(index=close.index, dtype='object')
    trend = 1  # start bullish

    for i in range(len(close)):
        if i == 0:
            st.iloc[i] = 'bullish' if trend == 1 else 'bearish'
            continue

        # Adjust bands
        if close.iloc[i] > upper_band.iloc[i - 1]:
            trend = 1
        elif close.iloc[i] < lower_band.iloc[i - 1]:
            trend = -1

        if trend == 1:
            lower_band.iloc[i] = max(lower_band.iloc[i], lower_band.iloc[i - 1]) if close.iloc[i - 1] >= lower_band.iloc[i - 1] else lower_band.iloc[i]
            st.iloc[i] = 'bullish'
        else:
            upper_band.iloc[i] = min(upper_band.iloc[i], upper_band.iloc[i - 1]) if close.iloc[i - 1] <= upper_band.iloc[i - 1] else upper_band.iloc[i]
            st.iloc[i] = 'bearish'

    return st


def rolling_max(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window=window, min_periods=1).max()
