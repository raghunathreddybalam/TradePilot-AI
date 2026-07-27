/** Default trail step for NIFTY 50 */
export const TRAIL_STEP_POINTS = 25;
/** Wider trail for Bank Nifty (larger point moves) */
export const BANKNIFTY_TRAIL_STEP_POINTS = 70;

export type TrailSide = "BUY" | "SELL";

/**
 * Per-symbol trail step:
 *   NIFTY 50 → 25 pts
 *   NIFTY BANK → 70 pts
 */
export function trailStepForSymbol(symbol: string): number {
  const s = symbol.toUpperCase().replace(/\s+/g, " ");
  if (s.includes("BANK") || s.includes("BANKNIFTY")) {
    return BANKNIFTY_TRAIL_STEP_POINTS;
  }
  return TRAIL_STEP_POINTS;
}

/**
 * Ratchet stop every +step pts of unrealized profit:
 *   ≥1×step → SL to entry (breakeven)
 *   ≥2×step → SL locks +1×step pts
 *   ≥3×step → SL locks +2×step pts
 *   …
 * Never loosens vs initial SL.
 */
export function trailedStopLoss(
  side: TrailSide,
  entryPrice: number,
  initialStopLoss: number,
  favorablePoints: number,
  step: number = TRAIL_STEP_POINTS,
): number {
  const steps = Math.floor(Math.max(0, favorablePoints) / step);
  if (steps < 1) return initialStopLoss;

  const locked = (steps - 1) * step;
  const candidate =
    side === "SELL" ? entryPrice - locked : entryPrice + locked;

  if (side === "SELL") {
    // SELL SL only moves down (tighter)
    return Math.min(initialStopLoss, candidate);
  }
  // BUY SL only moves up
  return Math.max(initialStopLoss, candidate);
}

/** Points of favorable price move from entry */
export function favorablePoints(
  side: TrailSide,
  entryPrice: number,
  price: number,
): number {
  return side === "SELL" ? entryPrice - price : price - entryPrice;
}
