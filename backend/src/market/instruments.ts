/** Angel One SmartAPI instrument map for TradePilot watchlist symbols. */
export interface AngelInstrument {
  symbol: string;
  exchange: "NSE" | "NFO" | "BSE";
  /** SmartAPI symbol token (string) */
  token: string;
  /** Exchange type for WebSocket subscribe: 1 = NSE CM */
  exchangeType: number;
  tradingSymbol: string;
}

/**
 * Tokens from Angel One scrip master (NSE).
 * NIFTY 50 = 99926000, NIFTY BANK = 99926009 are standard index tokens.
 */
export const ANGEL_INSTRUMENTS: Record<string, AngelInstrument> = {
  "NIFTY 50": {
    symbol: "NIFTY 50",
    exchange: "NSE",
    token: "99926000",
    exchangeType: 1,
    tradingSymbol: "Nifty 50",
  },
  NIFTY: {
    symbol: "NIFTY 50",
    exchange: "NSE",
    token: "99926000",
    exchangeType: 1,
    tradingSymbol: "Nifty 50",
  },
  "NIFTY BANK": {
    symbol: "NIFTY BANK",
    exchange: "NSE",
    token: "99926009",
    exchangeType: 1,
    tradingSymbol: "Nifty Bank",
  },
  BANKNIFTY: {
    symbol: "NIFTY BANK",
    exchange: "NSE",
    token: "99926009",
    exchangeType: 1,
    tradingSymbol: "Nifty Bank",
  },
  RELIANCE: {
    symbol: "RELIANCE",
    exchange: "NSE",
    token: "2885",
    exchangeType: 1,
    tradingSymbol: "RELIANCE-EQ",
  },
  TCS: {
    symbol: "TCS",
    exchange: "NSE",
    token: "11536",
    exchangeType: 1,
    tradingSymbol: "TCS-EQ",
  },
  INFY: {
    symbol: "INFY",
    exchange: "NSE",
    token: "1594",
    exchangeType: 1,
    tradingSymbol: "INFY-EQ",
  },
  HDFCBANK: {
    symbol: "HDFCBANK",
    exchange: "NSE",
    token: "1333",
    exchangeType: 1,
    tradingSymbol: "HDFCBANK-EQ",
  },
  SBIN: {
    symbol: "SBIN",
    exchange: "NSE",
    token: "3045",
    exchangeType: 1,
    tradingSymbol: "SBIN-EQ",
  },
};

export function resolveAngelInstrument(symbol: string): AngelInstrument | undefined {
  return ANGEL_INSTRUMENTS[symbol] ?? ANGEL_INSTRUMENTS[symbol.toUpperCase()];
}
