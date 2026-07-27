import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { Tick } from "../types/market.js";
import type { MarketDataProvider } from "../market/provider.js";

export function attachMarketWebSocket(server: Server, market: MarketDataProvider) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "hello",
        provider: market.name,
        time: new Date().toISOString(),
      }),
    );
  });

  const onTick = (tick: Tick) => {
    const payload = JSON.stringify({
      type: "tick",
      symbol: tick.symbol,
      price: tick.price,
      volume: tick.volume,
      timestamp: tick.timestamp.toISOString(),
    });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  };

  market.onTick(onTick);

  return {
    broadcast(event: unknown) {
      const payload = JSON.stringify(event);
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
      }
    },
    close() {
      market.offTick(onTick);
      wss.close();
    },
  };
}
