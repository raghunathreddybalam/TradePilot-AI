/** Shared candle timeframe for charts + strategy (minutes). */
export const CANDLE_INTERVAL_MINUTES = 5;

export function floorToCandleBucket(date: Date, intervalMinutes = CANDLE_INTERVAL_MINUTES): Date {
  const ms = intervalMinutes * 60_000;
  return new Date(Math.floor(date.getTime() / ms) * ms);
}
