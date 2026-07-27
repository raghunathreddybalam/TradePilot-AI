import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  /** PAPER | LIVE — LIVE requires explicit enable + Zerodha credentials */
  TRADING_MODE: z.enum(["PAPER", "LIVE"]).default("PAPER"),
  LIVE_TRADING_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  /** Starting paper equity in INR */
  PAPER_STARTING_EQUITY: z.coerce.number().default(500_000),

  /** OpenAI */
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  AI_FILTER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== "false"),

  /** Zerodha Kite Connect */
  KITE_API_KEY: z.string().optional(),
  KITE_API_SECRET: z.string().optional(),
  KITE_ACCESS_TOKEN: z.string().optional(),

  /** Use simulated ticks when Zerodha is not configured */
  USE_MOCK_MARKET_DATA: z
    .string()
    .optional()
    .transform((v) => v !== "false"),

  /** Watchlist symbols (comma-separated) */
  WATCHLIST: z.string().default("NIFTY 50,NIFTY BANK,RELIANCE,TCS,INFY,HDFCBANK"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;

export const WATCHLIST_SYMBOLS = env.WATCHLIST.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Hard safety: live orders only when both flags are set */
export function isLiveTradingAllowed(): boolean {
  return (
    env.TRADING_MODE === "LIVE" &&
    env.LIVE_TRADING_ENABLED === true &&
    Boolean(env.KITE_API_KEY && env.KITE_ACCESS_TOKEN)
  );
}
