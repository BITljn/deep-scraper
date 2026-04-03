import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";
import { colors, withHudBase } from "@/styles/theme";

export interface TarcoGaugeProps {
  value: number;
  signal: string;
}

function signalColor(signal: string): string {
  const s = signal.toLowerCase();
  if (s.includes("buy") || s.includes("bull")) {
    return colors.green;
  }
  if (s.includes("sell") || s.includes("bear")) {
    return colors.red;
  }
  if (s.includes("hold") || s.includes("neutral")) {
    return colors.amber;
  }
  return colors.cyan;
}

export function TarcoGauge({ value, signal }: TarcoGaugeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const animated = useAnimatedNumber(clamped, 500);
  const sigColor = signalColor(signal);

  const option = useMemo(
    () =>
      withHudBase({
        series: [
          {
            type: "gauge",
            startAngle: 210,
            endAngle: -30,
            min: 0,
            max: 100,
            splitNumber: 10,
            radius: "88%",
            center: ["50%", "55%"],
            axisLine: {
              lineStyle: {
                width: 14,
                color: [
                  [0.33, colors.red],
                  [0.66, colors.amber],
                  [1, colors.green],
                ],
              },
            },
            pointer: { show: true, length: "62%", width: 4, itemStyle: { color: colors.cyan } },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: {
              color: colors.textSecondary,
              distance: 12,
              fontSize: 10,
              fontFamily: "JetBrains Mono, monospace",
            },
            detail: { show: false },
            data: [{ value: animated, name: "Tarco" }],
          },
        ],
      }),
    [animated],
  );

  return (
    <div className="relative w-full">
      <ReactECharts option={option} style={{ height: 280, width: "100%" }} notMerge lazyUpdate />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-8">
        <span className="font-mono text-4xl font-bold tabular-nums text-[var(--text-primary)] drop-shadow-[0_0_12px_rgba(0,212,255,0.25)]">
          {animated.toFixed(1)}
        </span>
      </div>
      <p
        className="font-heading -mt-6 text-center text-xs font-semibold uppercase tracking-[0.2em]"
        style={{ color: sigColor }}
      >
        {signal}
      </p>
    </div>
  );
}
