import type { EChartsOption } from "echarts";

/** HUD palette — matches globals.css */
export const colors = {
  bgPrimary: "#0a0a0f",
  surface: "rgba(255,255,255,0.03)",
  borderSubtle: "rgba(255,255,255,0.06)",
  cyan: "#00d4ff",
  green: "#00ff88",
  red: "#ff3366",
  amber: "#ffaa00",
  textPrimary: "#e0e0e6",
  textSecondary: "#6b6b7b",
} as const;

export const chartColors = {
  bullish: colors.green,
  bearish: colors.red,
  accent: colors.cyan,
  warning: colors.amber,
  muted: colors.textSecondary,
} as const;

/**
 * Base ECharts theme: transparent HUD, no grid, minimal axes, cyan/green/red semantics.
 */
export const echartsDarkHudTheme: Record<string, unknown> = {
  backgroundColor: "transparent",
  color: [colors.green, colors.red, colors.cyan, colors.amber, colors.textSecondary],
  textStyle: {
    color: colors.textPrimary,
    fontFamily: "JetBrains Mono, ui-monospace, monospace",
    fontSize: 11,
  },
  categoryAxis: {
    axisLine: { show: true, lineStyle: { color: colors.borderSubtle } },
    axisTick: { show: false },
    axisLabel: { color: colors.textSecondary },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: colors.textSecondary },
    splitLine: { show: false },
  },
  line: {
    smooth: true,
    symbol: "none",
  },
};

/** Merge helper for option defaults */
export function withHudBase(option: EChartsOption): EChartsOption {
  return {
    backgroundColor: "transparent",
    textStyle: {
      color: colors.textPrimary,
      fontFamily: "JetBrains Mono, ui-monospace, monospace",
    },
    ...option,
  };
}
