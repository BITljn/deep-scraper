import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";
import { colors, withHudBase } from "@/styles/theme";

export interface VixGaugeProps {
  value: number;
  regime: string;
}

function zoneColor(v: number): string {
  if (v < 15) {
    return colors.green;
  }
  if (v <= 25) {
    return colors.textPrimary;
  }
  if (v <= 35) {
    return colors.amber;
  }
  return colors.red;
}

export function VixGauge({ value, regime }: VixGaugeProps) {
  const clamped = Math.max(0, Math.min(80, value));
  const animated = useAnimatedNumber(clamped, 500);
  const rg = zoneColor(animated);

  const option = useMemo(
    () =>
      withHudBase({
        series: [
          {
            type: "gauge",
            startAngle: 200,
            endAngle: -20,
            min: 0,
            max: 80,
            splitNumber: 8,
            radius: "88%",
            center: ["50%", "55%"],
            axisLine: {
              lineStyle: {
                width: 14,
                color: [
                  [15 / 80, colors.green],
                  [25 / 80, "rgba(224,224,230,0.85)"],
                  [35 / 80, colors.amber],
                  [1, colors.red],
                ],
              },
            },
            pointer: { show: true, length: "58%", width: 4, itemStyle: { color: colors.cyan } },
            axisTick: { distance: -14, length: 6, lineStyle: { color: colors.borderSubtle } },
            splitLine: { show: false },
            axisLabel: {
              color: colors.textSecondary,
              distance: 14,
              fontSize: 10,
              fontFamily: "JetBrains Mono, monospace",
            },
            detail: { show: false },
            data: [{ value: animated, name: "VIX" }],
          },
        ],
      }),
    [animated],
  );

  return (
    <div className="relative w-full">
      <ReactECharts option={option} style={{ height: 280, width: "100%" }} notMerge lazyUpdate />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-8">
        <span className="font-mono text-4xl font-bold tabular-nums text-[var(--text-primary)]">
          {animated.toFixed(2)}
        </span>
      </div>
      <p
        className="font-heading -mt-6 text-center text-xs font-semibold uppercase tracking-[0.25em]"
        style={{ color: rg }}
      >
        {regime}
      </p>
    </div>
  );
}
