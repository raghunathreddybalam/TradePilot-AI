import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const LOGIN_URL =
  "https://Openapi.5paisa.com/VendorsAPI/Service1.svc/V4/LoginRequestMobileNewbyEmail";
const MARKET_FEED_URL =
  "https://Openapi.5paisa.com/VendorsAPI/Service1.svc/V5/MarketFeed";

export function hasFivePaisaCredentials(): boolean {
  // Prefer ready access token; otherwise full login keys
  if (env.FIVEPAISA_ACCESS_TOKEN && env.FIVEPAISA_CLIENT_CODE) return true;
  return Boolean(
    env.FIVEPAISA_APP_NAME &&
      env.FIVEPAISA_APP_SOURCE &&
      env.FIVEPAISA_USER_ID &&
      env.FIVEPAISA_PASSWORD &&
      env.FIVEPAISA_USER_KEY &&
      env.FIVEPAISA_ENCRYPTION_KEY,
  );
}

function encryptPassword(plain: string, encryptionKey: string): string {
  // Best-effort AES compatible with common 5paisa samples; prefer ACCESS_TOKEN path.
  const key = Buffer.alloc(32);
  Buffer.from(encryptionKey, "utf8").copy(key);
  const iv = Buffer.alloc(16);
  Buffer.from(encryptionKey, "utf8").copy(iv);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  let enc = cipher.update(plain, "utf8", "base64");
  enc += cipher.final("base64");
  return enc;
}

export class FivePaisaClient {
  private accessToken: string | null = env.FIVEPAISA_ACCESS_TOKEN ?? null;
  private clientCode: string = env.FIVEPAISA_CLIENT_CODE ?? env.FIVEPAISA_USER_ID ?? "";

  get token(): string {
    if (!this.accessToken) throw new Error("5paisa access token not set");
    return this.accessToken;
  }

  get code(): string {
    return this.clientCode;
  }

  async login(): Promise<void> {
    if (this.accessToken && this.clientCode) {
      console.log("[5paisa] Using FIVEPAISA_ACCESS_TOKEN from env");
      return;
    }

    const appName = env.FIVEPAISA_APP_NAME!;
    const appSource = env.FIVEPAISA_APP_SOURCE!;
    const userId = env.FIVEPAISA_USER_ID!;
    const password = env.FIVEPAISA_PASSWORD!;
    const userKey = env.FIVEPAISA_USER_KEY!;
    const encKey = env.FIVEPAISA_ENCRYPTION_KEY!;

    const payload = {
      head: {
        Key: userKey,
        AppName: appName,
        LoginId: userId,
        RequestCode: "5PLoginV4",
        UserId: userId,
        Password: encryptPassword(password, encKey),
        Email_id: encryptPassword(userId, encKey),
        ContactNumber: "",
        LocalIP: "127.0.0.1",
        MacAddr: randomBytes(6).toString("hex"),
        MachineID: createHash("sha1").update(userId).digest("hex").slice(0, 16),
        VersionNo: "1.0",
        AppSource: Number(appSource),
      },
      body: {
        ClientCode: "",
        Password: encryptPassword(password, encKey),
        Email_id: encryptPassword(userId, encKey),
        DOB: encryptPassword("1990-01-01", encKey),
        My2PIN: encryptPassword("123456", encKey),
      },
    };

    // Note: exact LoginV4 body varies by 5paisa app version; access-token path is preferred.
    const res = await fetch(LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as {
      body?: { AccessToken?: string; ClientCode?: string; Message?: string; Status?: number };
    };

    if (!json.body?.AccessToken) {
      throw new Error(
        `5paisa login failed: ${json.body?.Message ?? "unknown"}. Prefer setting FIVEPAISA_ACCESS_TOKEN + FIVEPAISA_CLIENT_CODE from Xstream portal.`,
      );
    }

    this.accessToken = json.body.AccessToken;
    this.clientCode = json.body.ClientCode ?? userId;
    console.log("[5paisa] Login success");
  }

  async getMarketFeed(
    scrips: Array<{ Exch: string; ExchType: string; ScripCode: number }>,
  ): Promise<
    Array<{
      ScripCode: number;
      LastRate: number;
      TotalQty?: number;
      PClose?: number;
    }>
  > {
    const res = await fetch(MARKET_FEED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        head: {
          key: env.FIVEPAISA_USER_KEY ?? "",
        },
        body: {
          ClientCode: this.clientCode,
          MarketFeedData: scrips,
          LastRequestTime: `/Date(${Date.now()})/`,
          RefreshRate: "H",
        },
      }),
    });

    const json = (await res.json()) as {
      body?: {
        Data?: Array<{ ScripCode: number; LastRate: number; TotalQty?: number; PClose?: number }>;
        Message?: string;
        Status?: number;
      };
      Status?: number;
      Message?: string;
    };

    const data = json.body?.Data;
    if (!data) {
      throw new Error(
        `5paisa market feed failed: ${json.body?.Message ?? json.Message ?? JSON.stringify(json)}`,
      );
    }
    return data;
  }
}
