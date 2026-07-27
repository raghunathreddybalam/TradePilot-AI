import { findAllSetups } from "../decision/strategy.js";
import { trailStepForSymbol } from "../decision/trailingStop.js";
import { resolveUpstox } from "../market/brokerInstruments.js";
import {
  createUpstoxClientOrNull,
  enrichOrdersWithOptionPnl,
  roundToStrike,
  type BacktestOrderWithOption,
} from "./optionPnl.js";
import { resolveExit, type BacktestOrder, type ExitMode } from "./backtest.js";
import type { OhlcvBar } from "../types/market.js";

export interface MonthlyDaySummary {
  date: string;
  dayOpen: number;
  atmStrike: number;
  optionExpiry: string | null;
  ordersTriggered: number;
  stopLossHit: number;
  trailStopHit: number;
  targetHit: number;
  eodExit: number;
  indexPnlPoints: number;
  optionPnlInr: number | null;
  orders: BacktestOrderWithOption[];
}

export interface MonthlyBacktestSummary {
  symbol: string;
  fromDate: string;
  toDate: string;
  exitMode: ExitMode;
  trailStepPoints: number;
  riskReward: number | null;
  days: MonthlyDaySummary[];
  totals: {
    tradingDays: number;
    ordersTriggered: number;
    stopLossHit: number;
    trailStopHit: number;
    targetHit: number;
    eodExit: number;
    indexPnlPoints: number;
    optionPnlInr: number | null;
    winRate: number | null;
  };
  note: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function istDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function parseUpstoxCandles(
  rows: Array<[string, number, number, number, number, number, number?]>,
): OhlcvBar[] {
  return rows
    .map((r) => ({
      timestamp: new Date(r[0]),
      open: r[1],
      high: r[2],
      low: r[3],
      close: r[4],
      volume: r[5] ?? 0,
    }))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  // IST calendar day approx
  const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  ist.setDate(ist.getDate() - days);
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const day = String(ist.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayIst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Pick nearest expiry on/after trade date from available listed expiries */
export function pickExpiryForDay(day: string, expiries: string[]): string | null {
  const future = expiries.filter((e) => e >= day).sort();
  return future[0] ?? null;
}

/**
 * Last ~1 month intraday backtest (Upstox 5m window).
 * Each day: PE strike = round(day open); expiry = nearest listed ≥ day.
 */
export async function backtestMonth(
  symbol: string,
  exitMode: ExitMode = "trail",
): Promise<MonthlyBacktestSummary> {
  const client = createUpstoxClientOrNull();
  const underlying = resolveUpstox(symbol);
  const trailStep = trailStepForSymbol(symbol);
  const toDate = todayIst();
  const fromDate = ymdDaysAgo(27);

  const empty = (note: string): MonthlyBacktestSummary => ({
    symbol,
    fromDate,
    toDate,
    exitMode,
    trailStepPoints: trailStep,
    riskReward: exitMode === "rr4" ? 4 : null,
    days: [],
    totals: {
      tradingDays: 0,
      ordersTriggered: 0,
      stopLossHit: 0,
      trailStopHit: 0,
      targetHit: 0,
      eodExit: 0,
      indexPnlPoints: 0,
      optionPnlInr: null,
      winRate: null,
    },
    note,
  });

  if (!client || !underlying) {
    return empty("Upstox token required for monthly option backtest");
  }

  const raw = await client.getHistoricalCandles(
    underlying.instrumentKey,
    fromDate,
    toDate,
    5,
  );
  const bars = parseUpstoxCandles(raw);
  if (bars.length < 50) {
    return empty("Not enough historical 5m bars from Upstox for this month");
  }

  const contracts = await client.getOptionContracts(underlying.instrumentKey);
  const expiries = [...new Set(contracts.map((c) => c.expiry))].sort();

  const byDay = new Map<string, OhlcvBar[]>();
  for (const b of bars) {
    const day = istDate(b.timestamp);
    const list = byDay.get(day) ?? [];
    list.push(b);
    byDay.set(day, list);
  }

  const daysSorted = [...byDay.keys()].sort();
  const daySummaries: MonthlyDaySummary[] = [];

  // Cache enriched PE candles across days (same expiry often)
  for (let di = 0; di < daysSorted.length; di++) {
    const day = daysSorted[di]!;
    const dayBars = byDay.get(day) ?? [];
    if (dayBars.length < 8) continue;

    const dayOpen = dayBars[0]!.open;
    const atmStrike = roundToStrike(dayOpen, symbol);
    const optionExpiry = pickExpiryForDay(day, expiries);

    const warmup: OhlcvBar[] = [];
    for (let w = Math.max(0, di - 3); w < di; w++) {
      warmup.push(...(byDay.get(daysSorted[w]!) ?? []));
    }
    const series = [...warmup.slice(-40), ...dayBars];
    const dayEndTs = dayBars[dayBars.length - 1]!.timestamp.getTime();
    const seriesIntraday = series.filter((b) => b.timestamp.getTime() <= dayEndTs);

    const setups = findAllSetups(symbol, seriesIntraday, false).filter(
      (s) => istDate(s.confirmTime) === day,
    );

    const intradayOrders: BacktestOrder[] = setups.map((s) => {
      const exit = resolveExit(s, seriesIntraday, symbol, true, exitMode);
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

    const enriched = await enrichOrdersWithOptionPnl(symbol, intradayOrders, {
      fixedStrike: atmStrike,
      fixedExpiry: optionExpiry ?? undefined,
      historyFrom: fromDate,
      historyTo: toDate,
    });

    const stopLossHit = enriched.filter((o) => o.exitReason === "STOPLOSS").length;
    const trailStopHit = enriched.filter((o) => o.exitReason === "TRAIL_STOP").length;
    const targetHit = enriched.filter((o) => o.exitReason === "TARGET").length;
    const eodExit = enriched.filter((o) => o.exitReason === "EOD").length;
    const indexPnlPoints = round2(
      enriched.reduce((s, o) => s + (o.pnlPoints ?? 0), 0),
    );
    const optRows = enriched.filter((o) => o.optionPnlInr != null);
    const optionPnlInr =
      optRows.length > 0
        ? round2(optRows.reduce((s, o) => s + (o.optionPnlInr ?? 0), 0))
        : null;

    daySummaries.push({
      date: day,
      dayOpen: round2(dayOpen),
      atmStrike,
      optionExpiry,
      ordersTriggered: enriched.length,
      stopLossHit,
      trailStopHit,
      targetHit,
      eodExit,
      indexPnlPoints,
      optionPnlInr,
      orders: enriched,
    });
  }

  const allOrders = daySummaries.flatMap((d) => d.orders);
  const closed = allOrders.filter((o) => o.exitReason !== "OPEN");
  const winners = closed.filter((o) => (o.pnlPoints ?? 0) > 0).length;
  const optAll = allOrders.filter((o) => o.optionPnlInr != null);
  const optionPnlInr =
    optAll.length > 0
      ? round2(optAll.reduce((s, o) => s + (o.optionPnlInr ?? 0), 0))
      : null;

  const modeNote =
    exitMode === "rr4"
      ? "Exit mode: fixed 1:4 target + initial SL (no trail)."
      : "Exit mode: trailing SL only (no fixed TP).";

  return {
    symbol,
    fromDate,
    toDate,
    exitMode,
    trailStepPoints: trailStep,
    riskReward: exitMode === "rr4" ? 4 : null,
    days: daySummaries,
    totals: {
      tradingDays: daySummaries.length,
      ordersTriggered: allOrders.length,
      stopLossHit: allOrders.filter((o) => o.exitReason === "STOPLOSS").length,
      trailStopHit: allOrders.filter((o) => o.exitReason === "TRAIL_STOP").length,
      targetHit: allOrders.filter((o) => o.exitReason === "TARGET").length,
      eodExit: allOrders.filter((o) => o.exitReason === "EOD").length,
      indexPnlPoints: round2(allOrders.reduce((s, o) => s + (o.pnlPoints ?? 0), 0)),
      optionPnlInr,
      winRate: closed.length > 0 ? round2((winners / closed.length) * 100) : null,
    },
    note: `${modeNote} Each day uses ATM PE from that day’s open. Expiry = nearest listed ≥ day (expired weeklies need Upstox Plus — often monthly). Intraday only; open trades squared at EOD.`,
  };
}
