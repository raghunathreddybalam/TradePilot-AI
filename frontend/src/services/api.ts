export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
export const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:4000/ws";

export interface WatchlistQuote {
  symbol: string;
  name: string;
  instrumentType: string;
  price: number;
  change: number;
  changePercent: number;
}

export interface CandlePayload {
  symbol: string;
  bars: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  indicators: {
    snapshot: {
      ema5: number | null;
      ema9: number | null;
      ema21: number | null;
      rsi14: number | null;
      vwap: number | null;
      atr14: number | null;
      close: number;
    };
    ema5: Array<{ time: number; value: number } | null>;
    ema21: Array<{ time: number; value: number } | null>;
    vwap: Array<{ time: number; value: number } | null>;
    rsi14: Array<{ time: number; value: number } | null>;
  };
}

export interface TradeRow {
  id: string;
  side: "BUY" | "SELL";
  status: string;
  mode: string;
  quantity: number;
  entryPrice: number | null;
  exitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  pnl: number | null;
  explanation: string;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  instrument: { symbol: string; name: string };
}

export interface SignalRow {
  id: string;
  action: string;
  confidence: number;
  price: number;
  reason: string;
  aiVerdict: string | null;
  aiReason: string | null;
  aiScore: number | null;
  createdAt: string;
  instrument: { symbol: string };
}

export interface AccountSummary {
  mode: string;
  startingEquity: number;
  cash: number;
  openNotional: number;
  realizedPnl: number;
  openTrades: number;
  closedTrades: number;
  positions: TradeRow[];
}

export interface AppConfig {
  tradingMode: string;
  liveTradingEnabled: boolean;
  liveAllowed: boolean;
  watchlist: string[];
  aiFilterEnabled: boolean;
  mockMarketData: boolean;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<{ ok: boolean; tradingMode: string; marketProvider: string }>("/health"),
  config: () => get<AppConfig>("/config"),
  watchlist: () => get<WatchlistQuote[]>("/watchlist"),
  candles: (symbol: string) => get<CandlePayload>(`/candles/${encodeURIComponent(symbol)}`),
  trades: () => get<TradeRow[]>("/trades?limit=40"),
  signals: () => get<SignalRow[]>("/signals?limit=40"),
  account: () => get<AccountSummary>("/account"),
};
