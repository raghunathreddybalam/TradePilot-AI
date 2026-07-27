import type { IndicatorSnapshot, TradeDecision } from "../types/market.js";

export interface StrategyContext {
  symbol: string;
  indicators: IndicatorSnapshot;
  /** Previous bar EMA5 for crossover detection */
  prevEma5?: number | null;
  prevClose?: number | null;
}

/**
 * Simple intraday bias strategy:
 * - BUY when price > VWAP, EMA5 > EMA21, RSI between 40-70 (momentum, not overbought)
 * - SELL when price < VWAP, EMA5 < EMA21, RSI between 30-60
 * - HOLD otherwise
 *
 * Risk: stop = 1.5 * ATR, target = 2.5 * ATR
 */
export function evaluateStrategy(ctx: StrategyContext): TradeDecision {
  const { indicators, symbol } = ctx;
  const { close, ema5, ema9, ema21, rsi14, vwap, atr14 } = indicators;

  if (
    ema5 == null ||
    ema9 == null ||
    ema21 == null ||
    rsi14 == null ||
    vwap == null ||
    atr14 == null
  ) {
    return {
      action: "HOLD",
      confidence: 0,
      reason: `Insufficient indicator data for ${symbol}`,
      indicators,
    };
  }

  const aboveVwap = close > vwap;
  const bullishEma = ema5 > ema21 && ema5 > ema9;
  const bearishEma = ema5 < ema21 && ema5 < ema9;
  const rsiOkLong = rsi14 >= 40 && rsi14 <= 70;
  const rsiOkShort = rsi14 >= 30 && rsi14 <= 60;

  // EMA5 cross up through EMA21 recently (uses prev if available)
  const crossedUp =
    ctx.prevEma5 != null &&
    ctx.prevClose != null &&
    ctx.prevEma5 <= (indicators.ema21 ?? Infinity) &&
    ema5 > ema21;

  const crossedDown =
    ctx.prevEma5 != null &&
    ctx.prevClose != null &&
    ctx.prevEma5 >= (indicators.ema21 ?? -Infinity) &&
    ema5 < ema21;

  if (aboveVwap && bullishEma && rsiOkLong) {
    const confidence = Math.min(
      0.95,
      0.55 +
        (crossedUp ? 0.15 : 0) +
        Math.min(0.15, (close - vwap) / vwap) +
        (rsi14 > 50 ? 0.05 : 0),
    );

    return {
      action: "BUY",
      confidence,
      reason: buildReason("BUY", symbol, indicators, { aboveVwap, bullishEma, crossedUp }),
      stopLoss: round2(close - 1.5 * atr14),
      takeProfit: round2(close + 2.5 * atr14),
      indicators,
    };
  }

  if (!aboveVwap && bearishEma && rsiOkShort) {
    const confidence = Math.min(
      0.95,
      0.55 +
        (crossedDown ? 0.15 : 0) +
        Math.min(0.15, (vwap - close) / vwap) +
        (rsi14 < 50 ? 0.05 : 0),
    );

    return {
      action: "SELL",
      confidence,
      reason: buildReason("SELL", symbol, indicators, { aboveVwap, bearishEma, crossedDown }),
      stopLoss: round2(close + 1.5 * atr14),
      takeProfit: round2(close - 2.5 * atr14),
      indicators,
    };
  }

  return {
    action: "HOLD",
    confidence: 0.3,
    reason: `${symbol}: no setup — price ${aboveVwap ? "above" : "below"} VWAP, EMA5 ${ema5.toFixed(2)} vs EMA21 ${ema21.toFixed(2)}, RSI ${rsi14.toFixed(1)}`,
    indicators,
  };
}

function buildReason(
  side: "BUY" | "SELL",
  symbol: string,
  ind: IndicatorSnapshot,
  flags: Record<string, boolean>,
): string {
  const parts = [
    `${side} ${symbol} @ ${ind.close.toFixed(2)}`,
    `EMA5=${ind.ema5?.toFixed(2)} EMA21=${ind.ema21?.toFixed(2)}`,
    `VWAP=${ind.vwap?.toFixed(2)}`,
    `RSI=${ind.rsi14?.toFixed(1)}`,
    `ATR=${ind.atr14?.toFixed(2)}`,
  ];
  const flagText = Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ");
  if (flagText) parts.push(`flags: ${flagText}`);
  return parts.join(" | ");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
