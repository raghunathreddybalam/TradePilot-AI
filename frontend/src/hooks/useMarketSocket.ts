import { useEffect, useRef, useState } from "react";
import { WS_URL } from "./api";

export interface LiveTick {
  symbol: string;
  price: number;
  volume: number;
  timestamp: string;
}

export function useMarketSocket() {
  const [ticks, setTicks] = useState<Record<string, LiveTick>>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (alive) setConnected(true);
      };

      ws.onclose = () => {
        if (!alive) return;
        setConnected(false);
        retry = setTimeout(connect, 2000);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            type: string;
            symbol?: string;
            price?: number;
            volume?: number;
            timestamp?: string;
          };
          if (msg.type === "tick" && msg.symbol && msg.price != null) {
            setTicks((prev) => ({
              ...prev,
              [msg.symbol!]: {
                symbol: msg.symbol!,
                price: msg.price!,
                volume: msg.volume ?? 0,
                timestamp: msg.timestamp ?? new Date().toISOString(),
              },
            }));
          }
        } catch {
          /* ignore malformed */
        }
      };
    };

    connect();

    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  return { ticks, connected };
}
