import { env } from "../config/env.js";
import {
  candleCacheKey,
  getCachedCandles,
  setCachedCandles,
  upstoxFetch,
} from "./upstoxThrottle.js";

const BASE = "https://api.upstox.com";

type UpstoxEnvelope<T> = {
  status: string;
  data?: T;
  message?: string | string[];
};

export function hasUpstoxCredentials(): boolean {
  return Boolean(env.UPSTOX_ACCESS_TOKEN);
}

export function hasUpstoxOAuthApp(): boolean {
  return Boolean(env.UPSTOX_API_KEY && env.UPSTOX_API_SECRET && env.UPSTOX_REDIRECT_URI);
}

export function buildUpstoxLoginUrl(state = "tradepilot"): string {
  if (!hasUpstoxOAuthApp()) {
    throw new Error("Set UPSTOX_API_KEY, UPSTOX_API_SECRET, UPSTOX_REDIRECT_URI for OAuth login");
  }
  const params = new URLSearchParams({
    client_id: env.UPSTOX_API_KEY!,
    redirect_uri: env.UPSTOX_REDIRECT_URI!,
    response_type: "code",
    state,
  });
  return `${BASE}/v2/login/authorization/dialog?${params.toString()}`;
}

export async function exchangeUpstoxCode(code: string): Promise<string> {
  if (!hasUpstoxOAuthApp()) {
    throw new Error("Upstox OAuth app credentials missing");
  }

  const body = new URLSearchParams({
    code,
    client_id: env.UPSTOX_API_KEY!,
    client_secret: env.UPSTOX_API_SECRET!,
    redirect_uri: env.UPSTOX_REDIRECT_URI!,
    grant_type: "authorization_code",
  });

  const res = await fetch(`${BASE}/v2/login/authorization/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "Api-Version": "2.0",
    },
    body,
  });

  const json = (await res.json()) as {
    access_token?: string;
    email?: string;
    errors?: Array<{ message: string }>;
  };

  if (!json.access_token) {
    throw new Error(
      `Upstox token exchange failed: ${json.errors?.[0]?.message ?? JSON.stringify(json)}`,
    );
  }
  return json.access_token;
}

export class UpstoxClient {
  constructor(private accessToken: string) {}

  private headers() {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${this.accessToken}`,
    };
  }

  private contractsMemo = new Map<
    string,
    Array<{
      expiry: string;
      strike_price: number;
      instrument_type: string;
      instrument_key: string;
      trading_symbol: string;
      lot_size: number;
      weekly?: boolean;
    }>
  >();

  /** LTP for many instruments in one call — fail-fast (no long rate-limit queue) */
  async getLtp(instrumentKeys: string[]): Promise<
    Array<{ instrumentKey: string; lastPrice: number; volume?: number }>
  > {
    const qs = encodeURIComponent(instrumentKeys.join(","));
    const res = await fetch(`${BASE}/v3/market-quote/ltp?instrument_key=${qs}`, {
      headers: this.headers(),
    });
    const json = (await res.json()) as UpstoxEnvelope<
      Record<string, { last_price: number; instrument_token: string; volume?: number }>
    >;

    if (json.status !== "success" || !json.data) {
      throw new Error(`Upstox LTP failed: ${JSON.stringify(json.message ?? json)}`);
    }

    return Object.values(json.data).map((row) => ({
      instrumentKey: row.instrument_token,
      lastPrice: row.last_price,
      volume: row.volume,
    }));
  }

  /**
   * Intraday candles for today (or last session).
   * Response candles: [timestamp, open, high, low, close, volume, oi]
   */
  async getIntradayCandles(
    instrumentKey: string,
    intervalMinutes = 5,
  ): Promise<Array<[string, number, number, number, number, number, number?]>> {
    const cacheKey = candleCacheKey(instrumentKey, "intraday", String(intervalMinutes));
    const cached = getCachedCandles(cacheKey);
    if (cached) return cached;

    const key = encodeURIComponent(instrumentKey);
    const res = await upstoxFetch(
      `${BASE}/v3/historical-candle/intraday/${key}/minutes/${intervalMinutes}`,
      { headers: this.headers() },
    );
    const json = (await res.json()) as UpstoxEnvelope<{
      candles?: Array<[string, number, number, number, number, number, number?]>;
    }>;

    if (json.status !== "success") {
      throw new Error(`Upstox intraday failed: ${JSON.stringify(json.message ?? json)}`);
    }
    const candles = json.data?.candles ?? [];
    setCachedCandles(cacheKey, candles);
    return candles;
  }

  /** Historical candles between dates (YYYY-MM-DD) */
  async getHistoricalCandles(
    instrumentKey: string,
    fromDate: string,
    toDate: string,
    intervalMinutes = 5,
  ): Promise<Array<[string, number, number, number, number, number, number?]>> {
    const cacheKey = candleCacheKey(
      instrumentKey,
      "history",
      `${fromDate}|${intervalMinutes}`,
      toDate,
    );
    const cached = getCachedCandles(cacheKey);
    if (cached) return cached;

    const key = encodeURIComponent(instrumentKey);
    const res = await upstoxFetch(
      `${BASE}/v3/historical-candle/${key}/minutes/${intervalMinutes}/${toDate}/${fromDate}`,
      { headers: this.headers() },
    );
    const json = (await res.json()) as UpstoxEnvelope<{
      candles?: Array<[string, number, number, number, number, number, number?]>;
    }>;

    if (json.status !== "success") {
      throw new Error(`Upstox historical failed: ${JSON.stringify(json.message ?? json)}`);
    }
    const candles = json.data?.candles ?? [];
    setCachedCandles(cacheKey, candles);
    return candles;
  }

  /** Nearest weekly/monthly expiries + contracts for an underlying */
  async getOptionContracts(underlyingKey: string): Promise<
    Array<{
      expiry: string;
      strike_price: number;
      instrument_type: string;
      instrument_key: string;
      trading_symbol: string;
      lot_size: number;
      weekly?: boolean;
    }>
  > {
    const hit = this.contractsMemo.get(underlyingKey);
    if (hit) return hit;

    const qs = encodeURIComponent(underlyingKey);
    const res = await upstoxFetch(`${BASE}/v2/option/contract?instrument_key=${qs}`, {
      headers: this.headers(),
    });
    const json = (await res.json()) as UpstoxEnvelope<
      Array<{
        expiry: string;
        strike_price: number;
        instrument_type: string;
        instrument_key: string;
        trading_symbol: string;
        lot_size: number;
        weekly?: boolean;
      }>
    >;
    if (json.status !== "success" || !json.data) {
      throw new Error(`Upstox option contracts failed: ${JSON.stringify(json.message ?? json)}`);
    }
    this.contractsMemo.set(underlyingKey, json.data);
    return json.data;
  }

  /** Full option chain (CE+PE market data) for one expiry */
  async getOptionChain(
    underlyingKey: string,
    expiryDate: string,
  ): Promise<
    Array<{
      expiry: string;
      strike_price: number;
      underlying_spot_price?: number;
      call_options?: {
        instrument_key: string;
        market_data?: {
          ltp?: number;
          volume?: number;
          oi?: number;
          close_price?: number;
          bid_price?: number;
          ask_price?: number;
        };
      };
      put_options?: {
        instrument_key: string;
        market_data?: {
          ltp?: number;
          volume?: number;
          oi?: number;
          close_price?: number;
          bid_price?: number;
          ask_price?: number;
        };
      };
    }>
  > {
    const key = encodeURIComponent(underlyingKey);
    const res = await upstoxFetch(
      `${BASE}/v2/option/chain?instrument_key=${key}&expiry_date=${expiryDate}`,
      { headers: this.headers() },
    );
    const json = (await res.json()) as UpstoxEnvelope<
      Array<{
        expiry: string;
        strike_price: number;
        underlying_spot_price?: number;
        call_options?: {
          instrument_key: string;
          market_data?: {
            ltp?: number;
            volume?: number;
            oi?: number;
            close_price?: number;
            bid_price?: number;
            ask_price?: number;
          };
        };
        put_options?: {
          instrument_key: string;
          market_data?: {
            ltp?: number;
            volume?: number;
            oi?: number;
            close_price?: number;
            bid_price?: number;
            ask_price?: number;
          };
        };
      }>
    >;
    if (json.status !== "success" || !json.data) {
      throw new Error(`Upstox option chain failed: ${JSON.stringify(json.message ?? json)}`);
    }
    return json.data;
  }
}
