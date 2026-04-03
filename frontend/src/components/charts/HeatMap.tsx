import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { colors, withHudBase } from "@/styles/theme";

export interface HeatMapPoint {
  date: string;
  hour: number;
  value: number;
}

export interface HeatMapProps {
  data: HeatMapPoint[];
}

export function HeatMap({ data }: HeatMapProps) {
  const option = useMemo(() => {
    const dates = [...new Set(data.map((d) => d.date))].sort();
    const hours = Array.from({ length: 24 }, (_, i) => `${i}h`);

    const matrix: [number, number, number][] = data.map((d) => {
      const xi = dates.indexOf(d.date);
      const yi = Math.max(0, Math.min(23, d.hour));
      return [xi, yi, d.value];
    });

    const vals = data.map((d) => d.value);
    const vmin = vals.length ? Math.min(...vals) : 0;
    const vmax = vals.length ? Math.max(...vals) : 1;

    return withHudBase({
      grid: { left: 56, right: 24, top: 16, bottom: 64 },
      xAxis: {
        type: "category",
        data: dates,
        splitArea: { show: false },
        axisLine: { lineStyle: { color: colors.borderSubtle } },
        axisLabel: { color: colors.textSecondary, fontSize: 10, rotate: 35 },
      },
      yAxis: {
        type: "category",
        data: hours,
        splitArea: { show: false },
        axisLine: { lineStyle: { color: colors.borderSubtle } },
        axisLabel: { color: colors.textSecondary, fontSize: 9 },
      },
      visualMap: {
        min: vmin,
        max: vmax,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 8,
        inRange: {
          color: [colors.cyan, colors.red],
        },
        textStyle: { color: colors.textSecondary, fontSize: 10 },
      },
      series: [
        {
          name: "Intensity",
          type: "heatmap",
          data: matrix,
          label: { show: false },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowColor: "rgba(0, 212, 255, 0.45)" },
          },
        },
      ],
    });
  }, [data]);

  return <ReactECharts option={option} style={{ height: 420, width: "100%" }} notMerge lazyUpdate />;
}
