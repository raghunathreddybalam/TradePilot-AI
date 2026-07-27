import { useCallback, useEffect, useState } from "react";
import { PriceChart } from "./components/PriceChart";
import { useMarketSocket } from "./hooks/useMarketSocket";
import {
  api,
  type AccountSummary,
  type AppConfig,
  type CandlePayload,
  type SignalRow,
  type TradeRow,
  type WatchlistQuote,
} from "./services/api";
import "./App.css";

function formatInr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPrice(n: number) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export default function App() {
  const { ticks, connected } = useMarketSocket();
  const [symbol, setSymbol] = useState("NIFTY 50");
  const [watchlist, setWatchlist] = useState<WatchlistQuote[]>([]);
  const [candles, setCandles] = useState<CandlePayload | null>(null);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [wl, candle, tradeRows, signalRows, acct, cfg] = await Promise.all([
        api.watchlist(),
        api.candles(symbol),
        api.trades(),
        api.signals(),
        api.account(),
        api.config(),
      ]);
      setWatchlist(wl);
      setCandles(candle);
      setTrades(tradeRows);
      setSignals(signalRows);
      setAccount(acct);
      setConfig(cfg);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    }
  }, [symbol]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 8000);
    return () => clearInterval(id);
  }, [refresh]);

  const snapshot = candles?.indicators.snapshot;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <h1>TradePilot AI</h1>
            <p>Paper-first Indian markets desk</p>
          </div>
        </div>
        <div className="status-row">
          <span className={`pill ${connected ? "live" : "off"}`}>
            {connected ? "WS live" : "WS reconnecting"}
          </span>
          <span className="pill mode">{config?.tradingMode ?? "…"}</span>
          <span className="pill">
            {config?.mockMarketData ? "Mock feed" : "Kite feed"}
          </span>
          <span className="pill">
            AI filter {config?.aiFilterEnabled ? "on" : "off"}
          </span>
        </div>
      </header>

      {error && <div className="banner error">{error} — is the backend running on :4000?</div>}

      <section className="metrics">
        <article>
          <span>Equity</span>
          <strong>{account ? formatInr(account.cash) : "—"}</strong>
        </article>
        <article>
          <span>Realized P&amp;L</span>
          <strong className={(account?.realizedPnl ?? 0) >= 0 ? "up" : "down"}>
            {account ? formatInr(account.realizedPnl) : "—"}
          </strong>
        </article>
        <article>
          <span>Open trades</span>
          <strong>{account?.openTrades ?? "—"}</strong>
        </article>
        <article>
          <span>Closed</span>
          <strong>{account?.closedTrades ?? "—"}</strong>
        </article>
      </section>

      <div className="layout">
        <aside className="watchlist panel">
          <h2>Watchlist</h2>
          <ul>
            {watchlist.map((q) => {
              const live = ticks[q.symbol]?.price ?? q.price;
              const change = ticks[q.symbol] ? live - q.price + q.change : q.change;
              const active = symbol === q.symbol;
              return (
                <li key={q.symbol}>
                  <button
                    type="button"
                    className={active ? "active" : ""}
                    onClick={() => setSymbol(q.symbol)}
                  >
                    <span className="sym">{q.symbol}</span>
                    <span className="price">{formatPrice(live)}</span>
                    <span className={change >= 0 ? "up" : "down"}>
                      {change >= 0 ? "+" : ""}
                      {change.toFixed(2)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="chart-panel panel">
          <div className="chart-header">
            <div>
              <h2>{symbol}</h2>
              <p>1m candles · EMA5 · EMA21 · VWAP</p>
            </div>
            {snapshot && (
              <div className="indi">
                <span>EMA5 {snapshot.ema5?.toFixed(2) ?? "—"}</span>
                <span>EMA21 {snapshot.ema21?.toFixed(2) ?? "—"}</span>
                <span>VWAP {snapshot.vwap?.toFixed(2) ?? "—"}</span>
                <span>RSI {snapshot.rsi14?.toFixed(1) ?? "—"}</span>
                <span>ATR {snapshot.atr14?.toFixed(2) ?? "—"}</span>
              </div>
            )}
          </div>
          <PriceChart data={candles} />
        </main>

        <aside className="signals panel">
          <h2>Signals &amp; AI</h2>
          <div className="scroll">
            {signals.length === 0 && <p className="empty">Waiting for setups…</p>}
            {signals.map((s) => (
              <article key={s.id} className="signal-card">
                <header>
                  <strong>
                    {s.action} {s.instrument.symbol}
                  </strong>
                  <span className={`verdict ${s.aiVerdict ?? ""}`}>{s.aiVerdict ?? "—"}</span>
                </header>
                <p>{s.reason}</p>
                {s.aiReason && <p className="ai">{s.aiReason}</p>}
                <footer>
                  conf {(s.confidence * 100).toFixed(0)}%
                  {s.aiScore != null && ` · AI ${(s.aiScore * 100).toFixed(0)}%`}
                </footer>
              </article>
            ))}
          </div>
        </aside>
      </div>

      <section className="trades panel">
        <h2>Trades — every fill explained</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>P&amp;L</th>
                <th>Status</th>
                <th>Explanation</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty">
                    No paper trades yet — engine evaluates every ~15s with a 5m cooldown.
                  </td>
                </tr>
              )}
              {trades.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.createdAt).toLocaleTimeString("en-IN")}</td>
                  <td>{t.instrument.symbol}</td>
                  <td className={t.side === "BUY" ? "up" : "down"}>{t.side}</td>
                  <td>{t.quantity}</td>
                  <td>{t.entryPrice?.toFixed(2) ?? "—"}</td>
                  <td>{t.exitPrice?.toFixed(2) ?? "—"}</td>
                  <td className={(t.pnl ?? 0) >= 0 ? "up" : "down"}>
                    {t.pnl != null ? t.pnl.toFixed(2) : "—"}
                  </td>
                  <td>{t.status}</td>
                  <td className="explain">{t.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="footer">
        Live orders via Zerodha stay locked until{" "}
        <code>TRADING_MODE=LIVE</code> and <code>LIVE_TRADING_ENABLED=true</code> after
        extensive paper testing.
      </footer>
    </div>
  );
}
