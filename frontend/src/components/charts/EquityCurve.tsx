import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { colors, withHudBase } from "@/styles/theme";

export interface EquityPoint {
  ts: string;
  value: number;
}

export interface EquityCurveProps {
  data: EquityPoint[];
}

export function EquityCurve({ data }: EquityCurveProps) {
  const option = useMemo(() => {
    const sorted = [...data].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    const x = sorted.map((d) => d.ts.slice(5, 16));
    const y = sorted.map((d) => d.value);

    let rm = -Infinity;
    const markAreaData: [{ xAxis: string }, { xAxis: string }][] = [];
    let start: number | null = null;

    y.forEach((v, i) => {
      rm = Math.max(rm, v);
      const underwater = v < rm - 1e-9;
      if (underwater && start === null) {
        start = i;
      }
      if (!underwater && start !== null) {
        const s = start;
        const e = Math.max(s, i - 1);
        markAreaData.push([{ xAxis: x[s]! }, { xAxis: x[e]! }]);
        start = null;
      }
    });
    if (start !== null) {
      markAreaData.push([{ xAxis: x[start]! }, { xAxis: x[x.length - 1]! }]);
    }

    return withHudBase({
      grid: { left: 48, right: 16, top: 16, bottom: 28 },
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
          name: "Equity",
          type: "line",
          data: y,
          smooth: true,
          showSymbol: false,
          z: 3,
          lineStyle: {
            width: 2,
            color: colors.cyan,
            shadowBlur: 14,
            shadowColor: `${colors.cyan}44`,
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${colors.cyan}55` },
                { offset: 1, color: `${colors.cyan}00` },
              ],
            },
          },
          markArea: {
            silent: true,
            itemStyle: {
              color: "rgba(255, 51, 102, 0.12)",
            },
            data: markAreaData,
          },
        },
      ],
    });
  }, [data]);

  return <ReactECharts option={option} style={{ height: 300, width: "100%" }} notMerge lazyUpdate />;
}
