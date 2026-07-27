/** Shared instrument maps for broker market-data providers. */

export interface UpstoxInstrument {
  symbol: string;
  instrumentKey: string;
}

export interface FivePaisaInstrument {
  symbol: string;
  exch: "N" | "B";
  exchType: "C" | "D" | "U";
  scripCode: number;
}

export const UPSTOX_INSTRUMENTS: Record<string, UpstoxInstrument> = {
  "NIFTY 50": { symbol: "NIFTY 50", instrumentKey: "NSE_INDEX|Nifty 50" },
  NIFTY: { symbol: "NIFTY 50", instrumentKey: "NSE_INDEX|Nifty 50" },
  "NIFTY BANK": { symbol: "NIFTY BANK", instrumentKey: "NSE_INDEX|Nifty Bank" },
  BANKNIFTY: { symbol: "NIFTY BANK", instrumentKey: "NSE_INDEX|Nifty Bank" },
  RELIANCE: { symbol: "RELIANCE", instrumentKey: "NSE_EQ|INE002A01018" },
  TCS: { symbol: "TCS", instrumentKey: "NSE_EQ|INE467B01029" },
  INFY: { symbol: "INFY", instrumentKey: "NSE_EQ|INE009A01021" },
  HDFCBANK: { symbol: "HDFCBANK", instrumentKey: "NSE_EQ|INE040A01034" },
  SBIN: { symbol: "SBIN", instrumentKey: "NSE_EQ|INE062A01020" },
};

/** 5paisa NSE cash / index scrip codes */
export const FIVEPAISA_INSTRUMENTS: Record<string, FivePaisaInstrument> = {
  "NIFTY 50": { symbol: "NIFTY 50", exch: "N", exchType: "C", scripCode: 999920000 },
  NIFTY: { symbol: "NIFTY 50", exch: "N", exchType: "C", scripCode: 999920000 },
  "NIFTY BANK": { symbol: "NIFTY BANK", exch: "N", exchType: "C", scripCode: 999920005 },
  BANKNIFTY: { symbol: "NIFTY BANK", exch: "N", exchType: "C", scripCode: 999920005 },
  RELIANCE: { symbol: "RELIANCE", exch: "N", exchType: "C", scripCode: 2885 },
  TCS: { symbol: "TCS", exch: "N", exchType: "C", scripCode: 11536 },
  INFY: { symbol: "INFY", exch: "N", exchType: "C", scripCode: 1594 },
  HDFCBANK: { symbol: "HDFCBANK", exch: "N", exchType: "C", scripCode: 1333 },
  SBIN: { symbol: "SBIN", exch: "N", exchType: "C", scripCode: 3045 },
};

export function resolveUpstox(symbol: string): UpstoxInstrument | undefined {
  return UPSTOX_INSTRUMENTS[symbol] ?? UPSTOX_INSTRUMENTS[symbol.toUpperCase()];
}

export function resolveFivePaisa(symbol: string): FivePaisaInstrument | undefined {
  return FIVEPAISA_INSTRUMENTS[symbol] ?? FIVEPAISA_INSTRUMENTS[symbol.toUpperCase()];
}
