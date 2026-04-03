import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import type { Candlestick } from "@/api/types";
import { toNumber } from "@/lib/format";
import { colors, withHudBase } from "@/styles/theme";

export interface PriceChartProps {
  data: Candlestick[];
  overlayData?: { ts: string; value: number }[];
}

export function PriceChart({ data, overlayData }: PriceChartProps) {
  const sorted = useMemo(
    () => [...data].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()),
    [data],
  );

  const option = useMemo(() => {
    const category = sorted.map((d) => d.ts.slice(0, 16));
    const values = sorted.map((d) => [
      toNumber(d.open),
      toNumber(d.close),
      toNumber(d.low),
      toNumber(d.high),
    ]);
    const vol = sorted.map((d) => toNumber(d.volume));

    const overlayLine =
      overlayData && overlayData.length > 0
        ? sorted.map((d) => {
            const hit = overlayData.find((o) => o.ts === d.ts || o.ts.slice(0, 16) === d.ts.slice(0, 16));
            return hit ? hit.value : null;
          })
        : null;

    const series: object[] = [
      {
        name: "Price",
        type: "candlestick",
        data: values,
        itemStyle: {
          color: colors.red,
          color0: colors.green,
          borderColor: colors.red,
          borderColor0: colors.green,
        },
      },
    ];

    if (overlayLine) {
      series.push({
        name: "Overlay",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: overlayLine,
        smooth: true,
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 1.5, color: colors.amber },
        z: 10,
      });
    }

    series.push({
      name: "Volume",
      type: "bar",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: vol.map((v, i) => {
        const o = values[i];
        const up = o !== undefined && o[1]! >= o[0]!;
        return { value: v, itemStyle: { color: up ? `${colors.green}99` : `${colors.red}99` } };
      }),
    });

    const startPct =
      sorted.length > 0 ? Math.max(0, 100 - Math.min(100, (120 / sorted.length) * 100)) : 0;

    return withHudBase({
      animation: true,
      grid: [
        { left: 48, right: 16, top: 24, height: "58%" },
        { left: 48, right: 16, top: "72%", height: "18%" },
      ],
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      xAxis: [
        {
          type: "category",
          data: category,
          boundaryGap: true,
          axisLine: { lineStyle: { color: colors.borderSubtle } },
          axisLabel: { color: colors.textSecondary, fontSize: 10 },
          splitLine: { show: false },
        },
        {
          type: "category",
          data: category,
          gridIndex: 1,
          boundaryGap: true,
          axisLine: { show: false },
          axisLabel: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
        },
      ],
      yAxis: [
        {
          scale: true,
          axisLine: { show: false },
          axisLabel: { color: colors.textSecondary, fontSize: 10 },
          splitLine: { show: false },
        },
        {
          scale: true,
          gridIndex: 1,
          splitNumber: 2,
          axisLabel: { color: colors.textSecondary, fontSize: 9 },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start: startPct },
        {
          type: "slider",
          xAxisIndex: [0, 1],
          bottom: 4,
          height: 18,
          borderColor: colors.borderSubtle,
          fillerColor: "rgba(0,212,255,0.08)",
          handleStyle: { color: colors.cyan },
          textStyle: { color: colors.textSecondary, fontSize: 10 },
        },
      ],
      series,
    });
  }, [sorted, overlayData]);

  return (
    <ReactECharts
      option={option}
      style={{ height: 420, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}
