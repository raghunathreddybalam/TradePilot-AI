import { Fragment, useCallback, useEffect, useState } from "react";
import { PriceChart } from "./components/PriceChart";
import { StrategyAlertHost } from "./components/StrategyAlertHost";
import { useMarketSocket } from "./hooks/useMarketSocket";
import {
  api,
  type AccountSummary,
  type AppConfig,
  type BacktestSummary,
  type CandlePayload,
  type MonthlyBacktestSummary,
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

function formatIst(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
    hour12: false,
  });
}

function BacktestPanel({ summary }: { summary: BacktestSummary }) {
  const trail = summary.trailStepPoints;
  const ordersNewestFirst = [...summary.orders].sort(
    (a, b) => new Date(b.orderTime).getTime() - new Date(a.orderTime).getTime(),
  );

  return (
    <section className="backtest panel">
      <h2>
        Today’s strategy stats — {summary.symbol} · {new Date().toLocaleDateString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
        })}{" "}
        only (5m · SELL · trail {trail}pts)
      </h2>
      <div className="backtest-metrics">
        <article>
          <span>Orders triggered</span>
          <strong>{summary.ordersTriggered}</strong>
        </article>
        <article>
          <span>Stop-loss hit</span>
          <strong className="down">{summary.stopLossHit}</strong>
        </article>
        <article>
          <span>Trail SL hit</span>
          <strong className="up">{summary.trailStopHit}</strong>
        </article>
        <article>
          <span>Still open</span>
          <strong>{summary.stillOpen}</strong>
        </article>
        <article>
          <span>Win rate (closed)</span>
          <strong>{summary.winRate != null ? `${summary.winRate}%` : "—"}</strong>
        </article>
        <article>
          <span>Option P&amp;L (1 lot)</span>
          <strong
            className={(summary.optionPnlInrTotal ?? 0) >= 0 ? "up" : "down"}
          >
            {summary.optionPnlInrTotal != null
              ? formatInr(summary.optionPnlInrTotal)
              : "—"}
          </strong>
        </article>
      </div>

      <h3>Order details (newest first) · index SELL → buy nearest PE</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Setup</th>
              <th>Order time</th>
              <th>Side</th>
              <th>Entry</th>
              <th>Init SL</th>
              <th>Trail SL</th>
              <th>Max fav</th>
              <th>Exit</th>
              <th>Result</th>
              <th>Idx pts</th>
              <th>Option</th>
              <th>PE in</th>
              <th>PE out</th>
              <th>Opt ₹</th>
            </tr>
          </thead>
          <tbody>
            {ordersNewestFirst.length === 0 && (
              <tr>
                <td colSpan={14} className="empty">
                  No SELL gap→touch setups on today’s loaded 5m candles yet.
                </td>
              </tr>
            )}
            {ordersNewestFirst.map((o, i) => (
              <tr key={`${summary.symbol}-${o.orderTime}-${i}`}>
                <td>{formatIst(o.setupTime)}</td>
                <td>{formatIst(o.orderTime)}</td>
                <td className={o.side === "BUY" ? "up" : "down"}>{o.side}</td>
                <td>{o.entryPrice.toFixed(2)}</td>
                <td>{o.stopLoss.toFixed(2)}</td>
                <td>{o.trailingStopLoss.toFixed(2)}</td>
                <td>{o.maxFavorablePoints.toFixed(1)}</td>
                <td>{o.exitPrice?.toFixed(2) ?? "—"}</td>
                <td
                  className={
                    o.exitReason === "TRAIL_STOP"
                      ? "up"
                      : o.exitReason === "STOPLOSS"
                        ? "down"
                        : ""
                  }
                >
                  {o.exitReason}
                </td>
                <td className={(o.pnlPoints ?? 0) >= 0 ? "up" : "down"}>
                  {o.pnlPoints != null ? o.pnlPoints.toFixed(2) : "—"}
                </td>
                <td>
                  {o.optionSymbol ?? "—"}
                  {o.optionExpiry ? (
                    <span className="opt-exp"> {o.optionExpiry.slice(5)}</span>
                  ) : null}
                </td>
                <td>{o.optionEntryPremium?.toFixed(2) ?? "—"}</td>
                <td>{o.optionExitPremium?.toFixed(2) ?? "—"}</td>
                <td className={(o.optionPnlInr ?? 0) >= 0 ? "up" : "down"}>
                  {o.optionPnlInr != null ? formatInr(o.optionPnlInr) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MonthlyPanel({ summary }: { summary: MonthlyBacktestSummary }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const t = summary.totals;
  const modeLabel =
    summary.exitMode === "rr4" ? "1:4 target" : `trail ${summary.trailStepPoints}pts`;
  const daysNewestFirst = [...summary.days].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <section className="backtest panel month-panel">
      <h2>
        Last month — {summary.symbol} · {modeLabel} ({summary.fromDate} → {summary.toDate})
      </h2>
      <p className="month-note">{summary.note}</p>
      <div className="backtest-metrics">
        <article>
          <span>Trading days</span>
          <strong>{t.tradingDays}</strong>
        </article>
        <article>
          <span>Orders</span>
          <strong>{t.ordersTriggered}</strong>
        </article>
        <article>
          <span>Index pts</span>
          <strong className={t.indexPnlPoints >= 0 ? "up" : "down"}>
            {t.indexPnlPoints.toFixed(1)}
          </strong>
        </article>
        <article>
          <span>Option P&amp;L (1 lot)</span>
          <strong className={(t.optionPnlInr ?? 0) >= 0 ? "up" : "down"}>
            {t.optionPnlInr != null ? formatInr(t.optionPnlInr) : "—"}
          </strong>
        </article>
        <article>
          <span>Win rate</span>
          <strong>{t.winRate != null ? `${t.winRate}%` : "—"}</strong>
        </article>
        <article>
          <span>TP / Trail / SL</span>
          <strong>
            {t.targetHit ?? 0} / {t.trailStopHit} / {t.stopLossHit}
          </strong>
        </article>
      </div>

      <h3>Daily breakdown (newest first) · PE = that day’s open ATM</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Day open</th>
              <th>ATM PE</th>
              <th>Expiry</th>
              <th>Orders</th>
              <th>SL</th>
              <th>Trail</th>
              <th>EOD</th>
              <th>Idx pts</th>
              <th>Opt ₹</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {daysNewestFirst.length === 0 && (
              <tr>
                <td colSpan={11} className="empty">
                  No monthly data yet.
                </td>
              </tr>
            )}
            {daysNewestFirst.map((d) => (
              <Fragment key={d.date}>
                <tr>
                  <td>{d.date}</td>
                  <td>{d.dayOpen.toFixed(2)}</td>
                  <td>{d.atmStrike} PE</td>
                  <td>{d.optionExpiry ?? "—"}</td>
                  <td>{d.ordersTriggered}</td>
                  <td className="down">{d.stopLossHit}</td>
                  <td className="up">{d.trailStopHit}</td>
                  <td>{d.eodExit}</td>
                  <td className={d.indexPnlPoints >= 0 ? "up" : "down"}>
                    {d.indexPnlPoints.toFixed(1)}
                  </td>
                  <td className={(d.optionPnlInr ?? 0) >= 0 ? "up" : "down"}>
                    {d.optionPnlInr != null ? formatInr(d.optionPnlInr) : "—"}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() =>
                        setExpanded(expanded === d.date ? null : d.date)
                      }
                    >
                      {expanded === d.date ? "Hide" : "Trades"}
                    </button>
                  </td>
                </tr>
                {expanded === d.date &&
                  d.orders.map((o, i) => (
                    <tr key={`${d.date}-${i}`} className="month-trade-row">
                      <td colSpan={11}>
                        {formatIst(o.orderTime)} · {o.side} @ {o.entryPrice.toFixed(2)} →{" "}
                        {o.exitReason} · idx {o.pnlPoints ?? "—"} · {o.optionSymbol} · PE{" "}
                        {o.optionEntryPremium ?? "—"}→{o.optionExitPremium ?? "—"} ·{" "}
                        <span className={(o.optionPnlInr ?? 0) >= 0 ? "up" : "down"}>
                          {o.optionPnlInr != null ? formatInr(o.optionPnlInr) : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
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
  const [backtests, setBacktests] = useState<BacktestSummary[]>([]);
  const [monthlies, setMonthlies] = useState<MonthlyBacktestSummary[]>([]);
  const [monthMode, setMonthMode] = useState<"trail" | "rr4">("trail");
  const [monthLoading, setMonthLoading] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [wl, candle, tradeRows, signalRows, acct, cfg, btAll] = await Promise.all([
        api.watchlist(),
        api.candles(symbol),
        api.trades(),
        api.signals(),
        api.account(),
        api.config(),
        api.backtestAll(),
      ]);
      setWatchlist(wl);
      setCandles(candle);
      setTrades(tradeRows);
      setSignals(signalRows);
      setAccount(acct);
      setConfig(cfg);
      setBacktests(btAll.bySymbol);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    }
  }, [symbol]);

  const loadMonth = useCallback(async (mode: "trail" | "rr4" = monthMode) => {
    setMonthLoading(true);
    setMonthError(null);
    try {
      const data = await api.backtestMonthAll(mode);
      setMonthlies(data.bySymbol);
      setMonthMode(mode);
    } catch (err) {
      setMonthError(err instanceof Error ? err.message : "Monthly backtest failed");
    } finally {
      setMonthLoading(false);
    }
  }, [monthMode]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 8000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    void loadMonth("trail");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const snapshot = candles?.indicators.snapshot;

  return (
    <div className="app">
      <StrategyAlertHost signals={signals} trades={trades} />
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
            {config?.marketProvider === "angel"
              ? "Angel feed"
              : config?.marketProvider === "upstox"
                ? "Upstox feed"
                : config?.marketProvider === "fivepaisa"
                  ? "5paisa feed"
                  : config?.marketProvider === "zerodha"
                    ? "Kite feed"
                    : "Mock feed"}
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
              <p>
              {config?.candleIntervalMinutes ?? 5}m candles · EMA(5) gap→touch · SELL only · trail SL 25pts (Nifty) / 70pts (Bank) · no fixed TP
            </p>
            </div>
            {snapshot && (
              <div className="indi">
                <span>EMA5 {snapshot.ema5?.toFixed(2) ?? "—"}</span>
                <span>Close {snapshot.close?.toFixed(2) ?? "—"}</span>
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

      {backtests.map((bt) => (
        <BacktestPanel key={bt.symbol} summary={bt} />
      ))}

      <section className="trades panel">
        <h2>Today’s trades — newest first</h2>
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
                    No paper trades yet — engine evaluates completed 5m candles (gap→touch EMA5).
                  </td>
                </tr>
              )}
              {[...trades]
                .sort(
                  (a, b) =>
                    new Date(b.openedAt ?? b.createdAt).getTime() -
                    new Date(a.openedAt ?? a.createdAt).getTime(),
                )
                .map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.openedAt ?? t.createdAt).toLocaleTimeString("en-IN")}</td>
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

      <div className="month-toolbar">
        <h2 className="month-heading">Last month P&amp;L</h2>
        <div className="month-actions">
          <button
            type="button"
            className={monthMode === "trail" ? "active" : ""}
            onClick={() => void loadMonth("trail")}
            disabled={monthLoading}
          >
            Trail SL
          </button>
          <button
            type="button"
            className={monthMode === "rr4" ? "active" : ""}
            onClick={() => void loadMonth("rr4")}
            disabled={monthLoading}
          >
            1:4 target
          </button>
          <button type="button" onClick={() => void loadMonth(monthMode)} disabled={monthLoading}>
            {monthLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>
      {monthError && <div className="banner error">{monthError}</div>}
      {monthlies.map((m) => (
        <MonthlyPanel key={m.symbol} summary={m} />
      ))}

      <footer className="footer">
        Live orders via Zerodha stay locked until{" "}
        <code>TRADING_MODE=LIVE</code> and <code>LIVE_TRADING_ENABLED=true</code> after
        extensive paper testing.
      </footer>
    </div>
  );
}
