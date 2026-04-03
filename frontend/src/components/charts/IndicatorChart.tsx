import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { colors, withHudBase } from "@/styles/theme";

export interface IndicatorChartPoint {
  ts: string;
  value: number;
}

export interface IndicatorChartProps {
  data: IndicatorChartPoint[];
  color?: string;
}

export function IndicatorChart({ data, color = colors.cyan }: IndicatorChartProps) {
  const option = useMemo(() => {
    const sorted = [...data].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    const x = sorted.map((d) => d.ts.slice(5, 16));
    const y = sorted.map((d) => d.value);

    return withHudBase({
      grid: { left: 40, right: 16, top: 16, bottom: 28 },
      xAxis: {
        type: "category",
        data: x,
        boundaryGap: false,
        axisLine: { lineStyle: { color: colors.borderSubtle } },
        axisLabel: { color: colors.textSecondary, fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLine: { show: false },
        axisLabel: { color: colors.textSecondary, fontSize: 10 },
        splitLine: { show: false },
      },
      series: [
        {
          type: "line",
          data: y,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color, shadowBlur: 12, shadowColor: `${color}55` },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${color}44` },
                { offset: 1, color: `${color}00` },
              ],
            },
          },
        },
      ],
    });
  }, [data, color]);

  return <ReactECharts option={option} style={{ height: 260, width: "100%" }} notMerge lazyUpdate />;
}
