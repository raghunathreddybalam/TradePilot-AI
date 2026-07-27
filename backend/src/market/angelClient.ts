import { Secret, TOTP } from "otpauth";
import { env } from "../config/env.js";

const BASE = "https://apiconnect.angelone.in";

export interface AngelSession {
  jwtToken: string;
  refreshToken: string;
  feedToken: string;
}

export interface AngelQuote {
  exchange: string;
  tradingSymbol: string;
  symbolToken: string;
  ltp: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  tradeVolume?: number;
}

type AngelEnvelope<T> = {
  status: boolean | string;
  message?: string;
  errorcode?: string;
  data: T;
};

function headers(apiKey: string, jwt?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "00:00:00:00:00:00",
    "X-PrivateKey": apiKey,
  };
  if (jwt) h.Authorization = `Bearer ${jwt}`;
  return h;
}

function generateTotp(secretRaw: string): string {
  const normalized = secretRaw.replace(/\s+/g, "").toUpperCase();
  const totp = new TOTP({
    secret: Secret.fromBase32(normalized),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  });
  return totp.generate();
}

/** Format Date as Angel expects: yyyy-MM-dd HH:mm in IST */
export function formatAngelDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export class AngelSmartApiClient {
  private session: AngelSession | null = null;

  get isLoggedIn(): boolean {
    return Boolean(this.session?.jwtToken);
  }

  get feedToken(): string | undefined {
    return this.session?.feedToken;
  }

  get jwtToken(): string | undefined {
    return this.session?.jwtToken;
  }

  async login(): Promise<AngelSession> {
    const apiKey = env.ANGEL_API_KEY;
    const clientCode = env.ANGEL_CLIENT_CODE;
    const password = env.ANGEL_PASSWORD;
    const totpSecret = env.ANGEL_TOTP_SECRET;

    if (!apiKey || !clientCode || !password || !totpSecret) {
      throw new Error(
        "Angel credentials incomplete. Set ANGEL_API_KEY, ANGEL_CLIENT_CODE, ANGEL_PASSWORD, ANGEL_TOTP_SECRET",
      );
    }

    const totp = generateTotp(totpSecret);
    const res = await fetch(`${BASE}/rest/auth/angelbroking/user/v1/loginByPassword`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        clientcode: clientCode,
        password,
        totp,
      }),
    });

    const json = (await res.json()) as AngelEnvelope<{
      jwtToken: string;
      refreshToken: string;
      feedToken: string;
    } | null>;

    if (!json.status || !json.data?.jwtToken) {
      throw new Error(`Angel login failed: ${json.message ?? "unknown"} (${json.errorcode ?? ""})`);
    }

    this.session = {
      jwtToken: json.data.jwtToken,
      refreshToken: json.data.refreshToken,
      feedToken: json.data.feedToken,
    };
    console.log("[angel] Login success");
    return this.session;
  }

  async getQuotes(exchangeTokens: Record<string, string[]>): Promise<AngelQuote[]> {
    this.assertSession();
    const res = await fetch(`${BASE}/rest/secure/angelbroking/market/v1/quote/`, {
      method: "POST",
      headers: headers(env.ANGEL_API_KEY!, this.session!.jwtToken),
      body: JSON.stringify({ mode: "FULL", exchangeTokens }),
    });

    const json = (await res.json()) as AngelEnvelope<{
      fetched?: AngelQuote[];
      unfetched?: unknown[];
    } | null>;

    if (!json.status) {
      // Session may have expired — try one re-login
      if (json.errorcode === "AG8001" || json.errorcode === "AG8002") {
        await this.login();
        return this.getQuotes(exchangeTokens);
      }
      throw new Error(`Angel quote failed: ${json.message ?? "unknown"}`);
    }

    return json.data?.fetched ?? [];
  }

  /**
   * Historical candles: each row [timestamp, open, high, low, close, volume]
   */
  async getCandleData(params: {
    exchange: string;
    symboltoken: string;
    interval: string;
    fromdate: string;
    todate: string;
  }): Promise<Array<[string, number, number, number, number, number]>> {
    this.assertSession();
    const res = await fetch(`${BASE}/rest/secure/angelbroking/historical/v1/getCandleData`, {
      method: "POST",
      headers: headers(env.ANGEL_API_KEY!, this.session!.jwtToken),
      body: JSON.stringify(params),
    });

    const json = (await res.json()) as AngelEnvelope<
      Array<[string, number, number, number, number, number]> | null
    >;

    if (!json.status) {
      if (json.errorcode === "AG8001" || json.errorcode === "AG8002") {
        await this.login();
        return this.getCandleData(params);
      }
      throw new Error(`Angel candles failed: ${json.message ?? "unknown"}`);
    }

    return json.data ?? [];
  }

  private assertSession() {
    if (!this.session) throw new Error("Angel session not initialized — call login() first");
  }
}

export function hasAngelCredentials(): boolean {
  return Boolean(
    env.ANGEL_API_KEY &&
      env.ANGEL_CLIENT_CODE &&
      env.ANGEL_PASSWORD &&
      env.ANGEL_TOTP_SECRET,
  );
}
