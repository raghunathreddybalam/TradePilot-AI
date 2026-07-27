export interface OhlcvBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorSnapshot {
  ema5: number | null;
  ema9: number | null;
  ema21: number | null;
  rsi14: number | null;
  vwap: number | null;
  atr14: number | null;
  close: number;
}

export interface Tick {
  symbol: string;
  price: number;
  volume: number;
  timestamp: Date;
  bid?: number;
  ask?: number;
}

export type SignalAction = "BUY" | "SELL" | "HOLD" | "SKIP";

export interface TradeDecision {
  action: SignalAction;
  confidence: number;
  reason: string;
  /** Preferred fill price (e.g. setup candle low/high) */
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  quantity?: number;
  indicators: IndicatorSnapshot;
}

export interface AiFilterResult {
  approved: boolean;
  score: number;
  reason: string;
  verdict: "approved" | "rejected" | "skipped";
}
