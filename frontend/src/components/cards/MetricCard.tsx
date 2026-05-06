import { GlassCard } from "./GlassCard";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";
import { toNumber } from "@/lib/format";

export interface MetricCardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  change?: number;
  glowColor?: "cyan" | "green" | "red" | "amber";
  sparkData?: number[];
  className?: string;
  /** Tailwind text size classes for the value line (e.g. `text-3xl md:text-4xl`). */
  valueClassName?: string;
}

export function MetricCard({
  label,
  value,
  prefix = "",
  suffix = "",
  change,
  glowColor = "cyan",
  sparkData,
  className = "",
  valueClassName,
}: MetricCardProps) {
  const animated = useAnimatedNumber(value, 600);
  const display = animated.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
  const ch = change !== undefined ? toNumber(change) : undefined;

  return (
    <GlassCard glowColor={glowColor} className={`p-4 ${className}`.trim()}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-heading text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
            {label}
          </p>
          <p
            className={`font-mono mt-1 font-semibold tabular-nums tracking-tight text-[var(--text-primary)] ${valueClassName ?? "text-2xl"}`}
          >
            <span className="text-[var(--cyan)] opacity-80">{prefix}</span>
            {display}
            <span className="text-[var(--text-secondary)] text-lg">{suffix}</span>
          </p>
          {ch !== undefined && (
            <p
              className={`font-mono mt-1 text-xs tabular-nums ${
                ch >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"
              }`}
            >
              {ch >= 0 ? "▲" : "▼"} {Math.abs(ch).toFixed(2)}%
            </p>
          )}
        </div>
        {sparkData && sparkData.length > 0 && (
          <svg viewBox="0 0 72 28" className="mt-1 h-7 w-[72px]" preserveAspectRatio="none">
            <path
              d={sparkData
                .map((p, i) => {
                  const min = Math.min(...sparkData);
                  const max = Math.max(...sparkData);
                  const x = (i / Math.max(1, sparkData.length - 1)) * 72;
                  const y = 26 - ((p - min) / (max - min + 1e-9)) * 24;
                  return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
                })
                .join(" ")}
              fill="none"
              stroke="var(--cyan)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
    </GlassCard>
  );
}
