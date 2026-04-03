import { GlassCard } from "./cards/GlassCard";

export function SparkLine({
  label,
  value,
  points,
  accent = "#00d4ff",
  className = "",
}: {
  label: string;
  value: string | number;
  points: number[];
  accent?: string;
  className?: string;
}) {
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 1);
  const w = 120;
  const h = 36;
  const path = points
    .map((p, i) => {
      const x = (i / Math.max(1, points.length - 1)) * w;
      const t = (p - min) / (max - min + 1e-9);
      const y = h - t * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <GlassCard className={`p-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-['Space_Grotesk'] text-[10px] uppercase tracking-[0.15em] text-[#6b6b7b]">
          {label}
        </span>
        <span className="font-['JetBrains_Mono'] text-sm text-[#e0e0e6]">
          {value}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="mt-2 w-full"
        preserveAspectRatio="none"
      >
        <path
          d={path}
          fill="none"
          stroke={accent}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </GlassCard>
  );
}
