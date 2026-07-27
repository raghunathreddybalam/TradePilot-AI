import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { atr, computeIndicators, ema, rsi, vwap } from "./engine.js";
import type { OhlcvBar } from "../types/market.js";

function bars(closes: number[]): OhlcvBar[] {
  return closes.map((close, i) => ({
    timestamp: new Date(Date.UTC(2024, 0, 1, 9, 15 + i)),
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1000 + i * 10,
  }));
}

describe("indicator engine", () => {
  it("computes EMA matching SMA seed", () => {
    const values = [10, 11, 12, 13, 14, 15, 16];
    const result = ema(values, 3);
    assert.equal(result[0], null);
    assert.equal(result[1], null);
    assert.ok(Math.abs(result[2]! - 11) < 1e-9);
    assert.ok(result[6]! > result[5]!);
  });

  it("computes RSI in 0-100 range", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 0.5 + Math.sin(i) * 2);
    const series = rsi(closes, 14);
    const last = series[series.length - 1]!;
    assert.ok(last >= 0 && last <= 100);
  });

  it("computes VWAP and ATR", () => {
    const data = bars([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115]);
    const v = vwap(data);
    const a = atr(data, 14);
    assert.ok(v[v.length - 1]! > 0);
    assert.ok(a[a.length - 1]! > 0);
  });

  it("builds indicator snapshot", () => {
    const data = bars(Array.from({ length: 40 }, (_, i) => 20000 + i * 5));
    const snap = computeIndicators(data);
    assert.ok(snap.ema5 !== null);
    assert.ok(snap.rsi14 !== null);
    assert.equal(snap.close, data[data.length - 1]!.close);
  });
});
