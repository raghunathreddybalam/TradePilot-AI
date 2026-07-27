import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import type { CandlePayload } from "../services/api";

interface Props {
  data: CandlePayload | null;
}

export function PriceChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema5Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);

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
      timeScale: { borderColor: "rgba(28, 55, 70, 0.15)", timeVisible: true },
      width: containerRef.current.clientWidth,
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
    const ema21 = chart.addLineSeries({ color: "#c47a1a", lineWidth: 2, title: "EMA21" });
    const vwap = chart.addLineSeries({
      color: "#6b4ea3",
      lineWidth: 1,
      lineStyle: 2,
      title: "VWAP",
    });

    chartRef.current = chart;
    candleRef.current = candles;
    ema5Ref.current = ema5;
    ema21Ref.current = ema21;
    vwapRef.current = vwap;

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
    };
  }, []);

  useEffect(() => {
    if (!data || !candleRef.current) return;

    const bars = data.bars as CandlestickData[];
    candleRef.current.setData(bars);

    const toLine = (points: Array<{ time: number; value: number } | null>): LineData[] =>
      points.filter((p): p is { time: number; value: number } => p != null) as LineData[];

    ema5Ref.current?.setData(toLine(data.indicators.ema5));
    ema21Ref.current?.setData(toLine(data.indicators.ema21));
    vwapRef.current?.setData(toLine(data.indicators.vwap));
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return <div className="chart-wrap" ref={containerRef} />;
}
