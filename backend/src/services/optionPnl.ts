import { env } from "../config/env.js";
import { resolveUpstox } from "../market/brokerInstruments.js";
import { hasUpstoxCredentials, UpstoxClient } from "../market/upstoxClient.js";
import type { BacktestOrder, BacktestSummary } from "./backtest.js";

export interface OptionLegQuote {
  underlying: string;
  expiry: string;
  strike: number;
  optionType: "PE" | "CE";
  instrumentKey: string;
  tradingSymbol: string;
  lotSize: number;
  ltp: number | null;
  bid: number | null;
  ask: number | null;
  spot: number | null;
}

export interface OptionPnlFields {
  optionSymbol: string | null;
  optionStrike: number | null;
  optionType: "PE" | "CE" | null;
  optionExpiry: string | null;
  optionLotSize: number | null;
  optionEntryPremium: number | null;
  optionExitPremium: number | null;
  optionPnlPoints: number | null;
  /** Rupee P&L for 1 lot: premium change × lot size */
  optionPnlInr: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function istYmd(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Nifty strikes step 50; Bank Nifty step 100 */
export function strikeStepForSymbol(symbol: string): number {
  const s = symbol.toUpperCase();
  return s.includes("BANK") ? 100 : 50;
}

export function roundToStrike(price: number, symbol: string): number {
  const step = strikeStepForSymbol(symbol);
  return Math.round(price / step) * step;
}

function candleCloseAt(
  candles: Array<[string, number, number, number, number, number, number?]>,
  isoTime: string | null,
): number | null {
  if (!isoTime || candles.length === 0) return null;
  const target = new Date(isoTime).getTime();
  let best: (typeof candles)[number] | null = null;
  let bestDiff = Infinity;
  for (const c of candles) {
    const t = new Date(c[0]).getTime();
    const diff = Math.abs(t - target);
    // Prefer candle at or just before the event (within 6 minutes)
    if (t <= target + 60_000 && diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  if (!best || bestDiff > 6 * 60_000) return null;
  return best[4]; // close
}

export function createUpstoxClientOrNull(): UpstoxClient | null {
  if (!hasUpstoxCredentials() || !env.UPSTOX_ACCESS_TOKEN) return null;
  return new UpstoxClient(env.UPSTOX_ACCESS_TOKEN);
}

/** Nearest upcoming expiry (weekly preferred when available) */
export async function resolveNearestExpiry(
  client: UpstoxClient,
  underlyingKey: string,
): Promise<string | null> {
  const contracts = await client.getOptionContracts(underlyingKey);
  const today = istYmd();
  const expiries = [...new Set(contracts.map((c) => c.expiry))]
    .filter((e) => e >= today)
    .sort();
  return expiries[0] ?? null;
}

/**
 * Current PE quote for strike nearest to `spotOrStrike` (or exact strike if given).
 * SELL index trades → we simulate buying this PE.
 */
export async function getAtmPeQuote(
  symbol: string,
  preferredStrike?: number,
): Promise<OptionLegQuote | null> {
  const client = createUpstoxClientOrNull();
  const underlying = resolveUpstox(symbol);
  if (!client || !underlying) return null;

  const expiry = await resolveNearestExpiry(client, underlying.instrumentKey);
  if (!expiry) return null;

  const chain = await client.getOptionChain(underlying.instrumentKey, expiry);
  if (!chain.length) return null;

  const spot = chain[0]?.underlying_spot_price ?? preferredStrike ?? 0;
  const strike = preferredStrike ?? roundToStrike(spot, symbol);
  const row =
    chain.find((r) => r.strike_price === strike) ??
    chain.reduce((best, r) =>
      Math.abs(r.strike_price - strike) < Math.abs(best.strike_price - strike) ? r : best,
    );

  const pe = row.put_options;
  if (!pe?.instrument_key) return null;

  const md = pe.market_data;
  return {
    underlying: symbol,
    expiry,
    strike: row.strike_price,
    optionType: "PE",
    instrumentKey: pe.instrument_key,
    tradingSymbol: `${symbol.includes("BANK") ? "BANKNIFTY" : "NIFTY"} ${row.strike_price} PE`,
    lotSize: symbol.toUpperCase().includes("BANK") ? 30 : 65,
    ltp: md?.ltp ?? null,
    bid: md?.bid_price ?? null,
    ask: md?.ask_price ?? null,
    spot: row.underlying_spot_price ?? spot,
  };
}

export type BacktestOrderWithOption = BacktestOrder & OptionPnlFields;

export interface EnrichOptionOpts {
  /** Force PE strike (e.g. day-open ATM). Default: round each order entry. */
  fixedStrike?: number;
  /** Force expiry YYYY-MM-DD. Default: nearest upcoming. */
  fixedExpiry?: string;
  /** Load PE history from this date (for monthly). Default: intraday only. */
  historyFrom?: string;
  historyTo?: string;
}

/**
 * For each SELL order: buy PE (day-open ATM if fixedStrike set),
 * price entry/exit from PE 5m candles, 1-lot option P&L.
 */
export async function enrichOrdersWithOptionPnl(
  symbol: string,
  orders: BacktestOrder[],
  opts: EnrichOptionOpts = {},
): Promise<BacktestOrderWithOption[]> {
  const empty = (o: BacktestOrder): BacktestOrderWithOption => ({
    ...o,
    optionSymbol: null,
    optionStrike: null,
    optionType: null,
    optionExpiry: null,
    optionLotSize: null,
    optionEntryPremium: null,
    optionExitPremium: null,
    optionPnlPoints: null,
    optionPnlInr: null,
  });

  const client = createUpstoxClientOrNull();
  const underlying = resolveUpstox(symbol);
  if (!client || !underlying || orders.length === 0) {
    return orders.map(empty);
  }

  try {
    const contracts = await client.getOptionContracts(underlying.instrumentKey);
    const expiries = [...new Set(contracts.map((c) => c.expiry))].sort();
    const today = istYmd();
    const expiry =
      opts.fixedExpiry ??
      expiries.find((e) => e >= today) ??
      (await resolveNearestExpiry(client, underlying.instrumentKey));
    if (!expiry) return orders.map(empty);

    const name = symbol.toUpperCase().includes("BANK") ? "BANKNIFTY" : "NIFTY";
    const fallbackLot = symbol.toUpperCase().includes("BANK") ? 30 : 65;

    const peByStrike = new Map<number, { key: string; lot: number; strike: number }>();
    for (const c of contracts) {
      if (c.expiry !== expiry || c.instrument_type !== "PE") continue;
      peByStrike.set(c.strike_price, {
        key: c.instrument_key,
        lot: c.lot_size || fallbackLot,
        strike: c.strike_price,
      });
    }
    if (peByStrike.size === 0) return orders.map(empty);

    const candleCache = new Map<
      string,
      Array<[string, number, number, number, number, number, number?]>
    >();

    const loadCandles = async (instrumentKey: string) => {
      if (candleCache.has(instrumentKey)) return candleCache.get(instrumentKey)!;
      try {
        let candles: Array<[string, number, number, number, number, number, number?]>;
        if (opts.historyFrom && opts.historyTo) {
          candles = await client.getHistoricalCandles(
            instrumentKey,
            opts.historyFrom,
            opts.historyTo,
            5,
          );
        } else {
          candles = await client.getIntradayCandles(instrumentKey, 5);
        }
        candleCache.set(instrumentKey, candles);
        return candles;
      } catch (err) {
        console.warn(`[options] candle fetch failed for ${instrumentKey}:`, err);
        candleCache.set(instrumentKey, []);
        return [];
      }
    };

    const pickPe = (strike: number) => {
      if (peByStrike.has(strike)) return peByStrike.get(strike)!;
      let best: { key: string; lot: number; strike: number } | null = null;
      let bestDiff = Infinity;
      for (const row of peByStrike.values()) {
        const d = Math.abs(row.strike - strike);
        if (d < bestDiff) {
          best = row;
          bestDiff = d;
        }
      }
      return best;
    };

    const out: BacktestOrderWithOption[] = [];
    for (const order of orders) {
      if (order.side !== "SELL") {
        out.push(empty(order));
        continue;
      }

      const strike = opts.fixedStrike ?? roundToStrike(order.entryPrice, symbol);
      const pe = pickPe(strike);
      if (!pe) {
        out.push(empty(order));
        continue;
      }

      const candles = await loadCandles(pe.key);
      const entryPrem = candleCloseAt(candles, order.orderTime);
      const latestClose = candles[0]?.[4] ?? null;
      const exitPrem =
        order.exitReason === "OPEN"
          ? latestClose
          : candleCloseAt(candles, order.exitTime);

      const pnlPts =
        entryPrem != null && exitPrem != null ? round2(exitPrem - entryPrem) : null;
      const pnlInr = pnlPts != null ? round2(pnlPts * pe.lot) : null;

      out.push({
        ...order,
        optionSymbol: `${name} ${pe.strike} PE`,
        optionStrike: pe.strike,
        optionType: "PE",
        optionExpiry: expiry,
        optionLotSize: pe.lot,
        optionEntryPremium: entryPrem != null ? round2(entryPrem) : null,
        optionExitPremium: exitPrem != null ? round2(exitPrem) : null,
        optionPnlPoints: pnlPts,
        optionPnlInr: pnlInr,
      });
    }
    return out;
  } catch (err) {
    console.error("[options] enrich failed:", err);
    return orders.map(empty);
  }
}

export async function enrichBacktestSummary(
  summary: BacktestSummary,
): Promise<
  BacktestSummary & { orders: BacktestOrderWithOption[]; optionPnlInrTotal: number | null }
> {
  const client = createUpstoxClientOrNull();
  const underlying = resolveUpstox(summary.symbol);
  let fixedStrike: number | undefined;
  if (client && underlying) {
    try {
      const candles = await client.getIntradayCandles(underlying.instrumentKey, 5);
      const openBar = candles[candles.length - 1];
      if (openBar) fixedStrike = roundToStrike(openBar[1], summary.symbol);
    } catch {
      /* keep entry-based strike */
    }
  }

  const orders = await enrichOrdersWithOptionPnl(summary.symbol, summary.orders, {
    fixedStrike,
  });
  const withPnl = orders.filter((o) => o.optionPnlInr != null);
  const total =
    withPnl.length > 0
      ? round2(withPnl.reduce((s, o) => s + (o.optionPnlInr ?? 0), 0))
      : null;
  return { ...summary, orders, optionPnlInrTotal: total };
}
