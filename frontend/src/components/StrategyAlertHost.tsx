import { useEffect, useRef, useState } from "react";
import type { SignalRow, TradeRow } from "../services/api";

export interface StrategyAlertItem {
  id: string;
  kind: "signal" | "trade" | "stoploss" | "trail" | "target";
  title: string;
  body: string;
  side: string;
  symbol: string;
  at: string;
  tone: "buy" | "sell" | "sl" | "win";
}

interface Props {
  signals: SignalRow[];
  trades: TradeRow[];
}

function closeKind(explanation: string): "stoploss" | "trail" | "target" | null {
  if (/Stop-loss\s@/i.test(explanation)) return "stoploss";
  if (/Trail SL\s@/i.test(explanation)) return "trail";
  if (/Target\s@/i.test(explanation)) return "target";
  return null;
}

function buildFromSignal(s: SignalRow): StrategyAlertItem | null {
  if (s.action !== "BUY" && s.action !== "SELL") return null;
  return {
    id: `sig-${s.id}`,
    kind: "signal",
    title: `Strategy hit — ${s.action} ${s.instrument.symbol}`,
    body: [
      `Price ${s.price.toFixed(2)}`,
      `AI ${s.aiVerdict ?? "n/a"}`,
      s.reason,
    ].join(" · "),
    side: s.action,
    symbol: s.instrument.symbol,
    at: s.createdAt,
    tone: s.action === "SELL" ? "sell" : "buy",
  };
}

function buildFromOpenTrade(t: TradeRow): StrategyAlertItem | null {
  if (t.status !== "OPEN") return null;
  if (t.side !== "BUY" && t.side !== "SELL") return null;
  return {
    id: `tr-open-${t.id}`,
    kind: "trade",
    title: `Order placed — ${t.side} ${t.instrument.symbol}`,
    body: [
      `Entry ${t.entryPrice?.toFixed(2) ?? "—"}`,
      `SL ${t.stopLoss?.toFixed(2) ?? "—"}`,
      `Qty ${t.quantity}`,
      t.explanation.slice(0, 180),
    ].join(" · "),
    side: t.side,
    symbol: t.instrument.symbol,
    at: t.openedAt ?? t.createdAt,
    tone: t.side === "SELL" ? "sell" : "buy",
  };
}

function buildFromClosedTrade(t: TradeRow): StrategyAlertItem | null {
  if (t.status !== "CLOSED") return null;
  const kind = closeKind(t.explanation);
  if (!kind) return null;

  const pnl = t.pnl != null ? t.pnl.toFixed(2) : "—";
  const exit = t.exitPrice?.toFixed(2) ?? "—";

  if (kind === "stoploss") {
    return {
      id: `tr-sl-${t.id}`,
      kind: "stoploss",
      title: `Stop-loss hit — ${t.side} ${t.instrument.symbol}`,
      body: `Exit ${exit} · PnL ${pnl} · Entry ${t.entryPrice?.toFixed(2) ?? "—"}`,
      side: t.side,
      symbol: t.instrument.symbol,
      at: t.closedAt ?? t.createdAt,
      tone: "sl",
    };
  }

  if (kind === "trail") {
    return {
      id: `tr-trail-${t.id}`,
      kind: "trail",
      title: `Trail SL hit — ${t.side} ${t.instrument.symbol}`,
      body: `Exit ${exit} · PnL ${pnl} · Locked trail exit`,
      side: t.side,
      symbol: t.instrument.symbol,
      at: t.closedAt ?? t.createdAt,
      tone: (t.pnl ?? 0) >= 0 ? "win" : "sl",
    };
  }

  return {
    id: `tr-tp-${t.id}`,
    kind: "target",
    title: `Target hit — ${t.side} ${t.instrument.symbol}`,
    body: `Exit ${exit} · PnL ${pnl}`,
    side: t.side,
    symbol: t.instrument.symbol,
    at: t.closedAt ?? t.createdAt,
    tone: "win",
  };
}

function badgeFor(kind: StrategyAlertItem["kind"]): string {
  switch (kind) {
    case "stoploss":
      return "STOP-LOSS";
    case "trail":
      return "TRAIL SL";
    case "target":
      return "TARGET";
    case "trade":
      return "ORDER";
    default:
      return "SIGNAL";
  }
}

function beepFor(item: StrategyAlertItem) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = item.tone === "sl" ? "square" : "sine";
    osc.frequency.value =
      item.tone === "sl" ? 220 : item.tone === "win" ? 740 : item.side === "SELL" ? 520 : 660;
    gain.gain.value = item.tone === "sl" ? 0.05 : 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (item.tone === "sl" ? 0.28 : 0.18));
    void ctx.close();
  } catch {
    /* ignore */
  }
}

export function StrategyAlertHost({ signals, trades }: Props) {
  const primed = useRef(false);
  const seen = useRef(new Set<string>());
  const [queue, setQueue] = useState<StrategyAlertItem[]>([]);
  const current = queue[0] ?? null;

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const fresh: StrategyAlertItem[] = [];

    const push = (item: StrategyAlertItem | null) => {
      if (!item) return;
      if (seen.current.has(item.id)) return;
      seen.current.add(item.id);
      if (primed.current) fresh.push(item);
    };

    for (const s of signals) push(buildFromSignal(s));
    for (const t of trades) {
      push(buildFromOpenTrade(t));
      push(buildFromClosedTrade(t));
    }

    if (!primed.current) {
      primed.current = true;
      return;
    }

    if (fresh.length === 0) return;

    setQueue((q) => [...q, ...fresh]);

    for (const item of fresh) {
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(item.title, {
            body: item.body.slice(0, 140),
            tag: item.id,
          });
        } catch {
          /* ignore */
        }
      }
      beepFor(item);
    }
  }, [signals, trades]);

  if (!current) return null;

  return (
    <div className="alert-overlay" role="dialog" aria-modal="true" aria-labelledby="strategy-alert-title">
      <div className={`alert-modal tone-${current.tone}`}>
        <header>
          <span className="alert-badge">{badgeFor(current.kind)}</span>
          <h2 id="strategy-alert-title">{current.title}</h2>
        </header>
        <p className="alert-body">{current.body}</p>
        <footer>
          <span className="alert-meta">
            {current.symbol} · {new Date(current.at).toLocaleTimeString("en-IN")}
          </span>
          <button
            type="button"
            className="alert-dismiss"
            onClick={() => setQueue((q) => q.slice(1))}
          >
            Dismiss{queue.length > 1 ? ` (${queue.length - 1} more)` : ""}
          </button>
        </footer>
      </div>
    </div>
  );
}
