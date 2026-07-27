import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { env, resolveMarketProvider, WATCHLIST_SYMBOLS } from "./config/env.js";
import { createApiRouter } from "./routes/api.js";
import { MockMarketDataProvider, ZerodhaMarketDataProvider } from "./market/provider.js";
import { AngelMarketDataProvider } from "./market/angelProvider.js";
import { hasAngelCredentials } from "./market/angelClient.js";
import { UpstoxMarketDataProvider } from "./market/upstoxProvider.js";
import { hasUpstoxCredentials } from "./market/upstoxClient.js";
import { FivePaisaMarketDataProvider } from "./market/fivepaisaProvider.js";
import { hasFivePaisaCredentials } from "./market/fivepaisaClient.js";
import type { MarketDataProvider } from "./market/provider.js";
import { TradingEngine } from "./services/tradingEngine.js";
import { attachMarketWebSocket } from "./ws/marketWs.js";
import { startScheduler } from "./services/scheduler.js";

async function tryStart(
  label: string,
  canStart: boolean,
  missingMsg: string,
  factory: () => MarketDataProvider,
): Promise<MarketDataProvider | null> {
  if (!canStart) {
    console.warn(`[market] ${missingMsg}`);
    return null;
  }
  const provider = factory();
  try {
    await provider.start(WATCHLIST_SYMBOLS);
    return provider;
  } catch (err) {
    console.warn(`[market] ${label} failed — will fall back. Error:`, err);
    return null;
  }
}

async function startMarket(): Promise<MarketDataProvider> {
  const requested = resolveMarketProvider();

  if (requested === "upstox") {
    const p = await tryStart(
      "Upstox",
      hasUpstoxCredentials(),
      "MARKET_DATA_PROVIDER=upstox but UPSTOX_ACCESS_TOKEN missing — using mock",
      () => new UpstoxMarketDataProvider(),
    );
    if (p) return p;
  }

  if (requested === "fivepaisa") {
    const p = await tryStart(
      "5paisa",
      hasFivePaisaCredentials(),
      "MARKET_DATA_PROVIDER=fivepaisa but credentials missing — using mock",
      () => new FivePaisaMarketDataProvider(),
    );
    if (p) return p;
  }

  if (requested === "angel") {
    const p = await tryStart(
      "Angel",
      hasAngelCredentials(),
      "MARKET_DATA_PROVIDER=angel but credentials missing — using mock",
      () => new AngelMarketDataProvider(),
    );
    if (p) return p;
  }

  if (requested === "zerodha") {
    const z = new ZerodhaMarketDataProvider();
    await z.start(WATCHLIST_SYMBOLS);
    return z;
  }

  if (requested !== "mock") {
    console.warn(`[market] Falling back to mock (requested=${requested})`);
  }

  const mock = new MockMarketDataProvider();
  await mock.start(WATCHLIST_SYMBOLS);
  return mock;
}

async function main() {
  const app = express();
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());

  const market = await startMarket();

  app.use("/api", createApiRouter(market));

  const server = createServer(app);
  attachMarketWebSocket(server, market);

  const engine = new TradingEngine(market);
  await engine.initialize(WATCHLIST_SYMBOLS);

  startScheduler();

  server.listen(env.PORT, () => {
    console.log(`TradePilot AI backend on http://localhost:${env.PORT}`);
    console.log(
      `Mode=${env.TRADING_MODE} | Market=${market.name} | Watchlist=${WATCHLIST_SYMBOLS.join(", ")}`,
    );
    if (market.name === "mock") {
      console.log(
        "Tip: set MARKET_DATA_PROVIDER=upstox (or fivepaisa) + tokens in backend/.env for real quotes",
      );
    }
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});
