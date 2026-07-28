import { findAllSetups, type SetupSignal } from "../decision/strategy.js";
import {
  favorablePoints,
  trailedStopLoss,
  trailStepForSymbol,
} from "../decision/trailingStop.js";
import type { OhlcvBar } from "../types/market.js";

/** trail = ratchet SL every N pts; rr4 = fixed 1:4 target, initial SL only */
export type ExitMode = "trail" | "rr4";

export type ExitReason = "STOPLOSS" | "TRAIL_STOP" | "TARGET" | "EOD" | "OPEN";

export interface BacktestOrder {
  symbol: string;
  side: "BUY" | "SELL";
  setupTime: string;
  orderTime: string;
  entryPrice: number;
  /** Original setup SL */
  stopLoss: number;
  /** SL after trailing (or initial if rr4) */
  trailingStopLoss: number;
  takeProfit: number | null;
  exitPrice: number | null;
  exitTime: string | null;
  exitReason: ExitReason;
  pnlPoints: number | null;
  maxFavorablePoints: number;
  trailSteps: number;
  reason: string;
}

export interface BacktestSummary {
  symbol: string;
  timeframeMinutes: number;
  exitMode: ExitMode;
  trailStepPoints: number;
  riskReward: number | null;
  ordersTriggered: number;
  stopLossHit: number;
  trailStopHit: number;
  targetHit: number;
  stillOpen: number;
  winRate: number | null;
  orders: BacktestOrder[];
}

export const DEFAULT_RISK_REWARD = 4;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function istDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function todayIst(): string {
  return istDate(new Date());
}

export function takeProfitPrice(
  side: "BUY" | "SELL",
  entry: number,
  stop: number,
  rr = DEFAULT_RISK_REWARD,
): number {
  if (side === "SELL") {
    const risk = Math.max(stop - entry, 0.05);
    return round2(entry - rr * risk);
  }
  const risk = Math.max(entry - stop, 0.05);
  return round2(entry + rr * risk);
}

/**
 * Walk forward after confirm.
 * - trail: ratchet SL; no fixed TP
 * - rr4: fixed initial SL + 1:4 TP (no trail)
 * Conservative: if SL and TP both touchable same bar → STOPLOSS.
 * If still open at end and squareOffEod → EOD at last close.
 */
export function resolveExit(
  signal: SetupSignal,
  bars: OhlcvBar[],
  symbol: string,
  squareOffEod = false,
  exitMode: ExitMode = "trail",
): Pick<
  BacktestOrder,
  | "exitPrice"
  | "exitTime"
  | "exitReason"
  | "pnlPoints"
  | "trailingStopLoss"
  | "maxFavorablePoints"
  | "trailSteps"
  | "takeProfit"
> {
  const step = trailStepForSymbol(symbol);
  const start = signal.confirmIndex + 1;
  let currentSl = signal.stopLoss;
  let bestFav = 0;
  const tp =
    exitMode === "rr4"
      ? takeProfitPrice(signal.side, signal.entryPrice, signal.stopLoss)
      : null;

  for (let i = start; i < bars.length; i++) {
    const bar = bars[i]!;

    if (signal.side === "SELL") {
      const hitSl = bar.high >= currentSl;
      const hitTp = tp != null && bar.low <= tp;

      if (exitMode === "rr4") {
        if (hitSl && hitTp) {
          return {
            exitPrice: currentSl,
            exitTime: bar.timestamp.toISOString(),
            exitReason: "STOPLOSS",
            pnlPoints: round2(signal.entryPrice - currentSl),
            trailingStopLoss: round2(currentSl),
            maxFavorablePoints: round2(bestFav),
            trailSteps: 0,
            takeProfit: tp,
          };
        }
        if (hitSl) {
          return {
            exitPrice: currentSl,
            exitTime: bar.timestamp.toISOString(),
            exitReason: "STOPLOSS",
            pnlPoints: round2(signal.entryPrice - currentSl),
            trailingStopLoss: round2(currentSl),
            maxFavorablePoints: round2(bestFav),
            trailSteps: 0,
            takeProfit: tp,
          };
        }
        if (hitTp) {
          return {
            exitPrice: tp,
            exitTime: bar.timestamp.toISOString(),
            exitReason: "TARGET",
            pnlPoints: round2(signal.entryPrice - tp),
            trailingStopLoss: round2(currentSl),
            maxFavorablePoints: round2(
              Math.max(bestFav, favorablePoints("SELL", signal.entryPrice, tp)),
            ),
            trailSteps: 0,
            takeProfit: tp,
          };
        }
        bestFav = Math.max(bestFav, favorablePoints("SELL", signal.entryPrice, bar.low));
      } else {
        if (hitSl) {
          const trailed = currentSl !== signal.stopLoss;
          return {
            exitPrice: currentSl,
            exitTime: bar.timestamp.toISOString(),
            exitReason: trailed ? "TRAIL_STOP" : "STOPLOSS",
            pnlPoints: round2(signal.entryPrice - currentSl),
            trailingStopLoss: round2(currentSl),
            maxFavorablePoints: round2(bestFav),
            trailSteps: Math.floor(bestFav / step),
            takeProfit: null,
          };
        }
        bestFav = Math.max(bestFav, favorablePoints("SELL", signal.entryPrice, bar.low));
        currentSl = trailedStopLoss("SELL", signal.entryPrice, signal.stopLoss, bestFav, step);
      }
    } else {
      const hitSl = bar.low <= currentSl;
      const hitTp = tp != null && bar.high >= tp;

      if (exitMode === "rr4") {
        if (hitSl && hitTp) {
          return {
            exitPrice: currentSl,
            exitTime: bar.timestamp.toISOString(),
            exitReason: "STOPLOSS",
            pnlPoints: round2(currentSl - signal.entryPrice),
            trailingStopLoss: round2(currentSl),
            maxFavorablePoints: round2(bestFav),
            trailSteps: 0,
            takeProfit: tp,
          };
        }
        if (hitSl) {
          return {
            exitPrice: currentSl,
            exitTime: bar.timestamp.toISOString(),
            exitReason: "STOPLOSS",
            pnlPoints: round2(currentSl - signal.entryPrice),
            trailingStopLoss: round2(currentSl),
            maxFavorablePoints: round2(bestFav),
            trailSteps: 0,
            takeProfit: tp,
          };
        }
        if (hitTp) {
          return {
            exitPrice: tp,
            exitTime: bar.timestamp.toISOString(),
            exitReason: "TARGET",
            pnlPoints: round2(tp - signal.entryPrice),
            trailingStopLoss: round2(currentSl),
            maxFavorablePoints: round2(
              Math.max(bestFav, favorablePoints("BUY", signal.entryPrice, tp)),
            ),
            trailSteps: 0,
            takeProfit: tp,
          };
        }
        bestFav = Math.max(bestFav, favorablePoints("BUY", signal.entryPrice, bar.high));
      } else {
        if (hitSl) {
          const trailed = currentSl !== signal.stopLoss;
          return {
            exitPrice: currentSl,
            exitTime: bar.timestamp.toISOString(),
            exitReason: trailed ? "TRAIL_STOP" : "STOPLOSS",
            pnlPoints: round2(currentSl - signal.entryPrice),
            trailingStopLoss: round2(currentSl),
            maxFavorablePoints: round2(bestFav),
            trailSteps: Math.floor(bestFav / step),
            takeProfit: null,
          };
        }
        bestFav = Math.max(bestFav, favorablePoints("BUY", signal.entryPrice, bar.high));
        currentSl = trailedStopLoss("BUY", signal.entryPrice, signal.stopLoss, bestFav, step);
      }
    }
  }

  if (squareOffEod && bars.length > 0) {
    const last = bars[bars.length - 1]!;
    const exitPrice = last.close;
    const pnl =
      signal.side === "SELL"
        ? round2(signal.entryPrice - exitPrice)
        : round2(exitPrice - signal.entryPrice);
    return {
      exitPrice: round2(exitPrice),
      exitTime: last.timestamp.toISOString(),
      exitReason: "EOD",
      pnlPoints: pnl,
      trailingStopLoss: round2(currentSl),
      maxFavorablePoints: round2(bestFav),
      trailSteps: exitMode === "trail" ? Math.floor(bestFav / step) : 0,
      takeProfit: tp,
    };
  }

  return {
    exitPrice: null,
    exitTime: null,
    exitReason: "OPEN",
    pnlPoints: null,
    trailingStopLoss: round2(currentSl),
    maxFavorablePoints: round2(bestFav),
    trailSteps: exitMode === "trail" ? Math.floor(bestFav / step) : 0,
    takeProfit: tp,
  };
}

/**
 * Backtest today's IST session only (EMA warm-up may use prior bars).
 */
export function backtestSymbol(
  symbol: string,
  bars: OhlcvBar[],
  timeframeMinutes: number,
  exitMode: ExitMode = "trail",
): BacktestSummary {
  const completed = bars.length > 0 ? bars.slice(0, -1) : [];
  const day = todayIst();
  // Scan full history for EMA context, keep only setups confirmed today (IST)
  const setups = findAllSetups(symbol, bars, true).filter(
    (s) => istDate(s.confirmTime) === day,
  );
  const trailStep = trailStepForSymbol(symbol);

  const orders: BacktestOrder[] = setups.map((s) => {
    const exit = resolveExit(s, completed, symbol, false, exitMode);
    return {
      symbol,
      side: s.side,
      setupTime: s.setupTime.toISOString(),
      orderTime: s.confirmTime.toISOString(),
      entryPrice: s.entryPrice,
      stopLoss: s.stopLoss,
      trailingStopLoss: exit.trailingStopLoss,
      takeProfit: exit.takeProfit,
      exitPrice: exit.exitPrice,
      exitTime: exit.exitTime,
      exitReason: exit.exitReason,
      pnlPoints: exit.pnlPoints,
      maxFavorablePoints: exit.maxFavorablePoints,
      trailSteps: exit.trailSteps,
      reason: s.reason,
    };
  });

  const stopLossHit = orders.filter((o) => o.exitReason === "STOPLOSS").length;
  const trailStopHit = orders.filter((o) => o.exitReason === "TRAIL_STOP").length;
  const targetHit = orders.filter((o) => o.exitReason === "TARGET").length;
  const stillOpen = orders.filter((o) => o.exitReason === "OPEN").length;
  const closed = orders.filter((o) => o.exitReason !== "OPEN");
  const winners = closed.filter((o) => (o.pnlPoints ?? 0) > 0).length;

  return {
    symbol,
    timeframeMinutes,
    exitMode,
    trailStepPoints: trailStep,
    riskReward: exitMode === "rr4" ? DEFAULT_RISK_REWARD : null,
    ordersTriggered: orders.length,
    stopLossHit,
    trailStopHit,
    targetHit,
    stillOpen,
    winRate: closed.length > 0 ? round2((winners / closed.length) * 100) : null,
    orders,
  };
}
