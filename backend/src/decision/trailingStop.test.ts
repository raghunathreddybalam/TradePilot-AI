import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  trailedStopLoss,
  TRAIL_STEP_POINTS,
  BANKNIFTY_TRAIL_STEP_POINTS,
  trailStepForSymbol,
} from "./trailingStop.js";

describe("trailing stop steps", () => {
  it("keeps initial SL below 25 pts profit", () => {
    assert.equal(trailedStopLoss("SELL", 100, 110, 24), 110);
  });

  it("moves SELL SL to entry at 25 pts", () => {
    assert.equal(trailedStopLoss("SELL", 100, 110, 25), 100);
  });

  it("locks +25 at 50 pts for SELL", () => {
    assert.equal(trailedStopLoss("SELL", 100, 110, 50), 75);
  });

  it("locks +50 at 75 pts for SELL", () => {
    assert.equal(trailedStopLoss("SELL", 100, 110, 75), 50);
  });

  it("uses 25 pt step for NIFTY 50", () => {
    assert.equal(TRAIL_STEP_POINTS, 25);
    assert.equal(trailStepForSymbol("NIFTY 50"), 25);
  });

  it("uses 70 pt step for Bank Nifty", () => {
    assert.equal(BANKNIFTY_TRAIL_STEP_POINTS, 70);
    assert.equal(trailStepForSymbol("NIFTY BANK"), 70);
    assert.equal(trailedStopLoss("SELL", 57000, 57050, 69, 70), 57050);
    assert.equal(trailedStopLoss("SELL", 57000, 57050, 70, 70), 57000);
    assert.equal(trailedStopLoss("SELL", 57000, 57050, 140, 70), 56930);
  });
});
