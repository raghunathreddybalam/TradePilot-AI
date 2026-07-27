import type { ExitMode } from "./backtest.js";
import { backtestMonth, type MonthlyBacktestSummary } from "./monthlyBacktest.js";

type CacheEntry = { at: number; value: MonthlyBacktestSummary };

const TTL_MS = 10 * 60_000;
const cache = new Map<string, CacheEntry>();
let queue: Promise<unknown> = Promise.resolve();

function cacheKey(symbol: string, mode: ExitMode) {
  return `${symbol}|${mode}`;
}

/** One monthly backtest at a time + 10m result cache (avoids Upstox 429). */
export async function backtestMonthCached(
  symbol: string,
  mode: ExitMode = "trail",
): Promise<MonthlyBacktestSummary> {
  const key = cacheKey(symbol, mode);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const run = async () => {
    const again = cache.get(key);
    if (again && Date.now() - again.at < TTL_MS) return again.value;
    const value = await backtestMonth(symbol, mode);
    cache.set(key, { at: Date.now(), value });
    return value;
  };

  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function backtestMonthAllCached(mode: ExitMode = "trail") {
  const { WATCHLIST_SYMBOLS } = await import("../config/env.js");
  const bySymbol: MonthlyBacktestSummary[] = [];
  for (const symbol of WATCHLIST_SYMBOLS) {
    bySymbol.push(await backtestMonthCached(symbol, mode));
  }
  return { exitMode: mode, bySymbol };
}
