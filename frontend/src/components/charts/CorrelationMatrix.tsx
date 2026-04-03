import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import type { BacktestResult } from "@/api/types";
import { toNumber } from "@/lib/format";
import { colors, withHudBase } from "@/styles/theme";

export interface CorrelationMatrixProps {
  data: BacktestResult[];
}

export function CorrelationMatrix({ data }: CorrelationMatrixProps) {
  const option = useMemo(() => {
    const windows = [...new Set(data.map((d) => d.window))].sort();
    const indicators = [...new Set(data.map((d) => d.indicator_name))].sort();

    const matrix: [number, number, number][] = [];
    let vmin = 0;
    let vmax = 0;
    data.forEach((row) => {
      const xi = windows.indexOf(row.window);
      const yi = indicators.indexOf(row.indicator_name);
      if (xi < 0 || yi < 0) {
        return;
      }
      const v = toNumber(row.pearson_corr ?? row.spearman_corr ?? 0);
      matrix.push([xi, yi, v]);
      vmin = Math.min(vmin, v);
      vmax = Math.max(vmax, v);
    });

    const pad = Math.max(Math.abs(vmin), Math.abs(vmax), 0.0001);

    return withHudBase({
      grid: { left: 120, right: 48, top: 24, bottom: 48 },
      xAxis: {
        type: "category",
        data: windows,
        splitArea: { show: false },
        axisLine: { lineStyle: { color: colors.borderSubtle } },
        axisLabel: { color: colors.textSecondary, fontSize: 10, rotate: 30 },
      },
      yAxis: {
        type: "category",
        data: indicators,
        splitArea: { show: false },
        axisLine: { lineStyle: { color: colors.borderSubtle } },
        axisLabel: { color: colors.textSecondary, fontSize: 10 },
      },
      visualMap: {
        min: -pad,
        max: pad,
        calculable: true,
        orient: "vertical",
        right: 8,
        top: "middle",
        inRange: {
          color: [colors.red, colors.textSecondary, colors.green],
        },
        textStyle: { color: colors.textSecondary, fontSize: 10 },
      },
      series: [
        {
          name: "ρ",
          type: "heatmap",
          data: matrix,
          label: {
            show: matrix.length < 120,
            color: colors.textPrimary,
            fontSize: 9,
            fontFamily: "JetBrains Mono, monospace",
            formatter: (p: { data?: [number, number, number] }) =>
              p.data !== undefined ? p.data[2].toFixed(2) : "",
          },
          emphasis: {
            itemStyle: { borderColor: colors.cyan, borderWidth: 1 },
          },
        },
      ],
    });
  }, [data]);

  return <ReactECharts option={option} style={{ height: 440, width: "100%" }} notMerge lazyUpdate />;
}
