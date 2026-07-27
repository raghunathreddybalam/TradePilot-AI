import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findAllSetups } from "./strategy.js";
import { backtestSymbol } from "../services/backtest.js";
import type { OhlcvBar } from "../types/market.js";

function bar(o: number, h: number, l: number, c: number, minsAgo: number): OhlcvBar {
  return {
    timestamp: new Date(Date.now() - minsAgo * 60_000),
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 1,
  };
}

describe("backtest trail-only (no fixed TP)", () => {
  it("counts SELL setup with stop when price reverses up", () => {
    const flat = Array.from({ length: 10 }, (_, i) => bar(100, 100.2, 99.8, 100, 100 - i));
    const bars: OhlcvBar[] = [
      ...flat,
      bar(102, 103, 101.5, 102.5, 15), // setup above
      bar(102, 102.2, 99.5, 100, 10), // confirm touch
      bar(100, 103.5, 99.8, 103, 5), // hits SL (high >= 103)
      bar(103, 103.2, 102.8, 103, 0), // forming
    ];

    const summary = backtestSymbol("NIFTY 50", bars, 5);
    assert.ok(summary.ordersTriggered >= 1);
    const sell = summary.orders.find((o) => o.side === "SELL");
    assert.ok(sell);
    assert.equal(sell!.stopLoss, 103);
    assert.equal(sell!.exitReason, "STOPLOSS");
  });

  it("findAllSetups returns chronologically", () => {
    const bars: OhlcvBar[] = Array.from({ length: 12 }, (_, i) =>
      bar(100 + i * 0.1, 100.5 + i * 0.1, 99.5 + i * 0.1, 100 + i * 0.1, 60 - i * 5),
    );
    const setups = findAllSetups("X", bars, true);
    assert.ok(Array.isArray(setups));
  });
});
