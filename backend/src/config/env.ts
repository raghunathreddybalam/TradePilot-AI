import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const marketProviders = ["mock", "angel", "upstox", "fivepaisa", "zerodha"] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  TRADING_MODE: z.enum(["PAPER", "LIVE"]).default("PAPER"),
  LIVE_TRADING_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  PAPER_STARTING_EQUITY: z.coerce.number().default(50_000),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  AI_FILTER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== "false"),

  /** mock | angel | upstox | fivepaisa | zerodha */
  MARKET_DATA_PROVIDER: z.enum(marketProviders).default("mock"),
  USE_MOCK_MARKET_DATA: z.string().optional(),

  /** Angel One */
  ANGEL_API_KEY: z.string().optional(),
  ANGEL_CLIENT_CODE: z.string().optional(),
  ANGEL_PASSWORD: z.string().optional(),
  ANGEL_TOTP_SECRET: z.string().optional(),

  /** Upstox (free) */
  UPSTOX_ACCESS_TOKEN: z.string().optional(),
  UPSTOX_API_KEY: z.string().optional(),
  UPSTOX_API_SECRET: z.string().optional(),
  UPSTOX_REDIRECT_URI: z.string().optional(),

  /** 5paisa (free) — access token preferred */
  FIVEPAISA_ACCESS_TOKEN: z.string().optional(),
  FIVEPAISA_CLIENT_CODE: z.string().optional(),
  FIVEPAISA_APP_NAME: z.string().optional(),
  FIVEPAISA_APP_SOURCE: z.string().optional(),
  FIVEPAISA_USER_ID: z.string().optional(),
  FIVEPAISA_PASSWORD: z.string().optional(),
  FIVEPAISA_USER_KEY: z.string().optional(),
  FIVEPAISA_ENCRYPTION_KEY: z.string().optional(),

  /** Zerodha */
  KITE_API_KEY: z.string().optional(),
  KITE_API_SECRET: z.string().optional(),
  KITE_ACCESS_TOKEN: z.string().optional(),

  WATCHLIST: z.string().default("NIFTY 50,NIFTY BANK"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;

export type MarketProviderName = (typeof marketProviders)[number];

export const WATCHLIST_SYMBOLS = env.WATCHLIST.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function resolveMarketProvider(): MarketProviderName {
  if (env.MARKET_DATA_PROVIDER) return env.MARKET_DATA_PROVIDER;
  if (env.USE_MOCK_MARKET_DATA === "false") return "upstox";
  return "mock";
}

export function isLiveTradingAllowed(): boolean {
  return (
    env.TRADING_MODE === "LIVE" &&
    env.LIVE_TRADING_ENABLED === true &&
    Boolean(env.KITE_API_KEY && env.KITE_ACCESS_TOKEN)
  );
}
