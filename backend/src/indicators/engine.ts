import type { IndicatorSnapshot, OhlcvBar } from "../types/market.js";

/** Exponential Moving Average */
export function ema(values: number[], period: number): (number | null)[] {
  if (period <= 0) throw new Error("EMA period must be > 0");
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;

  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  result[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

/** Relative Strength Index (Wilder) */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

/** Session VWAP from OHLCV bars (typical price * volume cumulative) */
export function vwap(bars: OhlcvBar[]): (number | null)[] {
  const result: (number | null)[] = new Array(bars.length).fill(null);
  let cumPv = 0;
  let cumVol = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const typical = (bar.high + bar.low + bar.close) / 3;
    cumPv += typical * bar.volume;
    cumVol += bar.volume;
    result[i] = cumVol === 0 ? null : cumPv / cumVol;
  }
  return result;
}

/** Average True Range (Wilder) */
export function atr(bars: OhlcvBar[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length <= period) return result;

  const trs: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    if (i === 0) {
      trs.push(bar.high - bar.low);
    } else {
      const prevClose = bars[i - 1]!.close;
      trs.push(
        Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - prevClose),
          Math.abs(bar.low - prevClose),
        ),
      );
    }
  }

  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i]!;
  let prev = sum / period;
  result[period - 1] = prev;

  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]!) / period;
    result[i] = prev;
  }
  return result;
}

export function computeIndicators(bars: OhlcvBar[]): IndicatorSnapshot {
  if (bars.length === 0) {
    return {
      ema5: null,
      ema9: null,
      ema21: null,
      rsi14: null,
      vwap: null,
      atr14: null,
      close: 0,
    };
  }

  const closes = bars.map((b) => b.close);
  const last = bars.length - 1;

  const ema5Series = ema(closes, 5);
  const ema9Series = ema(closes, 9);
  const ema21Series = ema(closes, 21);
  const rsiSeries = rsi(closes, 14);
  const vwapSeries = vwap(bars);
  const atrSeries = atr(bars, 14);

  return {
    ema5: ema5Series[last] ?? null,
    ema9: ema9Series[last] ?? null,
    ema21: ema21Series[last] ?? null,
    rsi14: rsiSeries[last] ?? null,
    vwap: vwapSeries[last] ?? null,
    atr14: atrSeries[last] ?? null,
    close: closes[last]!,
  };
}

/** Full series for chart overlays */
export function computeIndicatorSeries(bars: OhlcvBar[]) {
  const closes = bars.map((b) => b.close);
  return {
    ema5: ema(closes, 5),
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    rsi14: rsi(closes, 14),
    vwap: vwap(bars),
    atr14: atr(bars, 14),
  };
}
