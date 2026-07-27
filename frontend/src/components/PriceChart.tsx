import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import type { CandlePayload } from "../services/api";

interface Props {
  data: CandlePayload | null;
}

function toUtc(time: number): UTCTimestamp {
  return Math.floor(time) as UTCTimestamp;
}

/** Lightweight Charts stores unix UTC; format axis/crosshair in IST for NSE. */
function formatIstTime(time: number, withSeconds = false): string {
  const d = new Date(time * 1000);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  }).format(d);
}

function formatIstTickMark(time: number): string {
  const d = new Date(time * 1000);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function normalizeBars(bars: CandlePayload["bars"]) {
  const byTime = new Map<number, (typeof bars)[number]>();
  for (const b of bars) {
    if (!Number.isFinite(b.time) || !Number.isFinite(b.close)) continue;
    byTime.set(Math.floor(b.time), b);
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, b]) => ({
      time: toUtc(b.time),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
}

function normalizeLine(points: Array<{ time: number; value: number } | null>) {
  const byTime = new Map<number, number>();
  for (const p of points) {
    if (!p || !Number.isFinite(p.time) || !Number.isFinite(p.value)) continue;
    byTime.set(Math.floor(p.time), p.value);
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, value]) => ({ time: toUtc(time), value }));
}

export function PriceChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema5Ref = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#5c6b7a",
        fontFamily: "'IBM Plex Mono', monospace",
      },
      grid: {
        vertLines: { color: "rgba(28, 55, 70, 0.08)" },
        horzLines: { color: "rgba(28, 55, 70, 0.08)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(28, 55, 70, 0.15)" },
      localization: {
        locale: "en-IN",
        timeFormatter: (time) => formatIstTime(time as number),
      },
      timeScale: {
        borderColor: "rgba(28, 55, 70, 0.15)",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time) => formatIstTickMark(time as number),
      },
      width: containerRef.current.clientWidth || 600,
      height: 420,
    });

    const candles = chart.addCandlestickSeries({
      upColor: "#0f8a5f",
      downColor: "#c23b3b",
      borderUpColor: "#0f8a5f",
      borderDownColor: "#c23b3b",
      wickUpColor: "#0f8a5f",
      wickDownColor: "#c23b3b",
    });
    const ema5 = chart.addLineSeries({ color: "#1a7a9c", lineWidth: 2, title: "EMA5" });

    chartRef.current = chart;
    candleRef.current = candles;
    ema5Ref.current = ema5;

    const onResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      ema5Ref.current = null;
    };
  }, []);

  useEffect(() => {
    if (!data || !candleRef.current) return;

    try {
      const bars = normalizeBars(data.bars);
      if (bars.length === 0) return;

      candleRef.current.setData(bars);
      ema5Ref.current?.setData(normalizeLine(data.indicators.ema5));
      chartRef.current?.timeScale().fitContent();
    } catch (err) {
      console.error("[PriceChart] failed to render series", err);
    }
  }, [data]);

  return <div className="chart-wrap" ref={containerRef} />;
}
