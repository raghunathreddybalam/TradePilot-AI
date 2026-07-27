import OpenAI from "openai";
import { env } from "../config/env.js";
import type { AiFilterResult, TradeDecision } from "../types/market.js";

const SYSTEM_PROMPT = `You are a conservative Indian markets risk filter for NIFTY, BANKNIFTY, and NSE stocks.
Given a proposed trade and indicator snapshot, decide if it should proceed.
Reject trades that look like chasing, low-quality RSI extremes, or weak confluence.
Respond ONLY with JSON: {"approved":boolean,"score":0-1,"reason":"short explanation"}`;

/**
 * AI trade filter — rejects low-quality setups before paper/live execution.
 * Falls back to a deterministic heuristic when OpenAI is unavailable.
 */
export async function filterTradeWithAi(
  symbol: string,
  decision: TradeDecision,
): Promise<AiFilterResult> {
  if (!env.AI_FILTER_ENABLED) {
    return {
      approved: true,
      score: decision.confidence,
      reason: "AI filter disabled — passthrough",
      verdict: "skipped",
    };
  }

  if (!env.OPENAI_API_KEY) {
    return heuristicFilter(symbol, decision);
  }

  try {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            symbol,
            action: decision.action,
            confidence: decision.confidence,
            reason: decision.reason,
            indicators: decision.indicators,
            stopLoss: decision.stopLoss,
            takeProfit: decision.takeProfit,
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { approved?: boolean; score?: number; reason?: string };
    const approved = Boolean(parsed.approved);
    return {
      approved,
      score: typeof parsed.score === "number" ? parsed.score : decision.confidence,
      reason: parsed.reason ?? "No AI reason provided",
      verdict: approved ? "approved" : "rejected",
    };
  } catch (err) {
    console.warn("[ai-filter] OpenAI failed, using heuristic:", err);
    return heuristicFilter(symbol, decision);
  }
}

/** Deterministic fallback when OpenAI is offline or unconfigured */
function heuristicFilter(symbol: string, decision: TradeDecision): AiFilterResult {
  const { indicators, confidence, action } = decision;
  const rsi = indicators.rsi14;

  if (action !== "BUY" && action !== "SELL") {
    return {
      approved: false,
      score: 0,
      reason: "Non-actionable signal",
      verdict: "rejected",
    };
  }

  if (confidence < 0.6) {
    return {
      approved: false,
      score: confidence,
      reason: `Heuristic reject ${symbol}: confidence ${confidence.toFixed(2)} below 0.60`,
      verdict: "rejected",
    };
  }

  if (action === "BUY" && rsi != null && rsi > 72) {
    return {
      approved: false,
      score: confidence * 0.5,
      reason: `Heuristic reject: RSI ${rsi.toFixed(1)} overbought for long`,
      verdict: "rejected",
    };
  }

  if (action === "SELL" && rsi != null && rsi < 28) {
    return {
      approved: false,
      score: confidence * 0.5,
      reason: `Heuristic reject: RSI ${rsi.toFixed(1)} oversold for short`,
      verdict: "rejected",
    };
  }

  return {
    approved: true,
    score: confidence,
    reason: `Heuristic approve ${symbol}: confluence OK (no OpenAI key — rule-based)`,
    verdict: "approved",
  };
}
