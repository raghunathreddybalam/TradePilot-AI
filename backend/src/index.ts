import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { env, WATCHLIST_SYMBOLS } from "./config/env.js";
import { createApiRouter } from "./routes/api.js";
import { MockMarketDataProvider, ZerodhaMarketDataProvider } from "./market/provider.js";
import { TradingEngine } from "./services/tradingEngine.js";
import { attachMarketWebSocket } from "./ws/marketWs.js";
import { startScheduler } from "./services/scheduler.js";

async function main() {
  const app = express();
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());

  const market =
    env.USE_MOCK_MARKET_DATA !== false
      ? new MockMarketDataProvider()
      : new ZerodhaMarketDataProvider();

  app.use("/api", createApiRouter(market));

  const server = createServer(app);
  attachMarketWebSocket(server, market);

  await market.start(WATCHLIST_SYMBOLS);

  const engine = new TradingEngine(market);
  await engine.initialize(WATCHLIST_SYMBOLS);

  startScheduler();

  server.listen(env.PORT, () => {
    console.log(`TradePilot AI backend on http://localhost:${env.PORT}`);
    console.log(`Mode=${env.TRADING_MODE} | Market=${market.name} | Watchlist=${WATCHLIST_SYMBOLS.join(", ")}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
