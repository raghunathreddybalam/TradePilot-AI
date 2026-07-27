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
  marketProvider: "mock" | "angel" | "zerodha" | string;
  mockMarketData: boolean;
  candleIntervalMinutes?: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface BacktestOrder {
  symbol: string;
  side: "BUY" | "SELL";
  setupTime: string;
  orderTime: string;
  entryPrice: number;
  stopLoss: number;
  trailingStopLoss: number;
  exitPrice: number | null;
  exitTime: string | null;
  exitReason: "STOPLOSS" | "TRAIL_STOP" | "TARGET" | "EOD" | "OPEN";
  takeProfit?: number | null;
  pnlPoints: number | null;
  maxFavorablePoints: number;
  trailSteps: number;
  reason: string;
  optionSymbol?: string | null;
  optionStrike?: number | null;
  optionType?: "PE" | "CE" | null;
  optionExpiry?: string | null;
  optionLotSize?: number | null;
  optionEntryPremium?: number | null;
  optionExitPremium?: number | null;
  optionPnlPoints?: number | null;
  optionPnlInr?: number | null;
}

export interface BacktestSummary {
  symbol: string;
  timeframeMinutes: number;
  trailStepPoints: number;
  ordersTriggered: number;
  stopLossHit: number;
  trailStopHit: number;
  stillOpen: number;
  winRate: number | null;
  optionPnlInrTotal?: number | null;
  orders: BacktestOrder[];
}

export interface BacktestAllResponse {
  timeframeMinutes: number;
  trailStepPointsBySymbol?: Record<string, number>;
  totals: {
    ordersTriggered: number;
    stopLossHit: number;
    trailStopHit: number;
    stillOpen: number;
    winRate: number | null;
  };
  bySymbol: BacktestSummary[];
}

export interface MonthlyDaySummary {
  date: string;
  dayOpen: number;
  atmStrike: number;
  optionExpiry: string | null;
  ordersTriggered: number;
  stopLossHit: number;
  trailStopHit: number;
  targetHit?: number;
  eodExit: number;
  indexPnlPoints: number;
  optionPnlInr: number | null;
  orders: BacktestOrder[];
}

export interface MonthlyBacktestSummary {
  symbol: string;
  fromDate: string;
  toDate: string;
  exitMode?: "trail" | "rr4";
  trailStepPoints: number;
  riskReward?: number | null;
  days: MonthlyDaySummary[];
  totals: {
    tradingDays: number;
    ordersTriggered: number;
    stopLossHit: number;
    trailStopHit: number;
    targetHit?: number;
    eodExit: number;
    indexPnlPoints: number;
    optionPnlInr: number | null;
    winRate: number | null;
  };
  note: string;
}

export const api = {
  health: () => get<{ ok: boolean; tradingMode: string; marketProvider: string }>("/health"),
  config: () => get<AppConfig>("/config"),
  watchlist: () => get<WatchlistQuote[]>("/watchlist"),
  candles: (symbol: string) => get<CandlePayload>(`/candles/${encodeURIComponent(symbol)}`),
  trades: () => get<TradeRow[]>("/trades?limit=40"),
  signals: () => get<SignalRow[]>("/signals?limit=40"),
  account: () => get<AccountSummary>("/account"),
  backtest: (symbol: string) =>
    get<BacktestSummary>(`/backtest/${encodeURIComponent(symbol)}?count=200`),
  backtestAll: () => get<BacktestAllResponse>("/backtest"),
  backtestMonthAll: (mode: "trail" | "rr4" = "trail") =>
    get<{ exitMode: string; bySymbol: MonthlyBacktestSummary[] }>(
      `/backtest-month?mode=${mode}`,
    ),
  backtestMonthCompare: () =>
    get<{
      trail: { exitMode: string; bySymbol: MonthlyBacktestSummary[] };
      rr4: { exitMode: string; bySymbol: MonthlyBacktestSummary[] };
    }>("/backtest-month-compare"),
};
