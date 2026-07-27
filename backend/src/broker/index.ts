import { OrderMode } from "@prisma/client";
import { env, isLiveTradingAllowed } from "../config/env.js";

export interface PlaceOrderRequest {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price?: number;
  orderType?: "MARKET" | "LIMIT";
  tag?: string;
}

export interface PlaceOrderResult {
  success: boolean;
  mode: OrderMode;
  orderId: string;
  averagePrice: number;
  message: string;
}

export interface BrokerAdapter {
  name: string;
  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;
  getLtp(symbol: string): Promise<number | null>;
}

/** Paper broker — fills at requested/mock price, never hits Zerodha */
export class PaperBroker implements BrokerAdapter {
  name = "paper";
  private prices = new Map<string, number>();

  setPrice(symbol: string, price: number) {
    this.prices.set(symbol, price);
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const price = req.price ?? this.prices.get(req.symbol) ?? 0;
    if (price <= 0) {
      return {
        success: false,
        mode: OrderMode.PAPER,
        orderId: "",
        averagePrice: 0,
        message: `No price available for ${req.symbol}`,
      };
    }

    const orderId = `PAPER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      success: true,
      mode: OrderMode.PAPER,
      orderId,
      averagePrice: price,
      message: `Paper ${req.side} ${req.quantity} ${req.symbol} @ ${price}`,
    };
  }

  async getLtp(symbol: string): Promise<number | null> {
    return this.prices.get(symbol) ?? null;
  }
}

/**
 * Zerodha Kite Connect adapter.
 * LIVE orders are gated by isLiveTradingAllowed().
 * Without credentials, methods fail safely.
 */
export class ZerodhaBroker implements BrokerAdapter {
  name = "zerodha";

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    if (!isLiveTradingAllowed()) {
      return {
        success: false,
        mode: OrderMode.LIVE,
        orderId: "",
        averagePrice: 0,
        message:
          "Live trading blocked. Set TRADING_MODE=LIVE, LIVE_TRADING_ENABLED=true, and Zerodha tokens after extensive paper testing.",
      };
    }

    // Placeholder for kiteconnect SDK integration
    // import { KiteConnect } from "kiteconnect";
    // const kc = new KiteConnect({ api_key: env.KITE_API_KEY });
    // kc.setAccessToken(env.KITE_ACCESS_TOKEN);
    // const order = await kc.placeOrder("regular", { ... });

    console.warn("[zerodha] Live placeOrder called but SDK wiring is intentionally stubbed until paper validation is complete.");
    return {
      success: false,
      mode: OrderMode.LIVE,
      orderId: "",
      averagePrice: 0,
      message: `Zerodha live order stub — configure kiteconnect SDK before enabling. Request was ${req.side} ${req.quantity} ${req.symbol}`,
    };
  }

  async getLtp(_symbol: string): Promise<number | null> {
    if (!env.KITE_API_KEY || !env.KITE_ACCESS_TOKEN) return null;
    // Stub until Kite quote API is wired
    return null;
  }
}

export function getActiveBroker(): BrokerAdapter {
  if (isLiveTradingAllowed()) return new ZerodhaBroker();
  return paperBroker;
}

export const paperBroker = new PaperBroker();
export const zerodhaBroker = new ZerodhaBroker();
