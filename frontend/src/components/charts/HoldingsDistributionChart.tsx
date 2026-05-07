import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import type { ArkHolding } from "@/api/types";
import {
  buildDistributionRows,
  getProfileAvatar,
  type DistributionProfile,
  type DistributionRow,
} from "@/components/charts/holdingsDistribution";

interface HoldingsDistributionChartProps {
  distributionDate?: string | null;
  holdings: ArkHolding[];
  profileId: DistributionProfile;
  profileLabel: string;
}

interface ChartEventParams {
  data?: {
    ticker?: string;
  };
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function LogoBadge({
  className = "",
  compact = false,
  row,
}: {
  className?: string;
  compact?: boolean;
  row: DistributionRow;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const showLogo = row.logoUrl && !logoFailed;

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.1] bg-[#111118] font-heading text-[10px] font-semibold text-[var(--text-primary)] shadow-lg ${compact ? "h-8 w-8" : "h-10 w-10"} ${className}`}
      style={{ boxShadow: `0 0 18px ${row.color}26` }}
    >
      {showLogo ? (
        <img
          alt={`${row.companyName} logo`}
          className="h-full w-full bg-white object-contain p-1"
          onError={() => setLogoFailed(true)}
          src={row.logoUrl ?? undefined}
        />
      ) : (
        <span className="px-1 text-center leading-none">{row.ticker.slice(0, 4)}</span>
      )}
    </span>
  );
}

function markerPosition(rows: DistributionRow[], index: number) {
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  const before = rows.slice(0, index).reduce((sum, row) => sum + row.weight, 0);
  const mid = total > 0 ? ((before + rows[index]!.weight / 2) / total) * 360 - 90 : -90;
  const radians = (mid * Math.PI) / 180;

  return {
    left: `${50 + Math.cos(radians) * 43}%`,
    top: `${50 + Math.sin(radians) * 43}%`,
  };
}

export function HoldingsDistributionChart({
  distributionDate,
  holdings,
  profileId,
  profileLabel,
}: HoldingsDistributionChartProps) {
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const rows = useMemo(() => buildDistributionRows(holdings), [holdings]);
  const avatar = useMemo(
    () => getProfileAvatar(profileId, profileLabel),
    [profileId, profileLabel],
  );
  const maxWeight = rows[0]?.weight ?? 0;
  const activeRow = rows.find((row) => row.ticker === activeTicker) ?? rows[0] ?? null;

  const chartOption = useMemo<EChartsOption>(
    () => ({
      animationDuration: 450,
      color: rows.map((row) => row.color),
      tooltip: {
        trigger: "item",
        backgroundColor: "#111118",
        borderColor: "rgba(255,255,255,0.12)",
        borderWidth: 1,
        extraCssText: "box-shadow: 0 18px 45px rgba(0,0,0,0.35); border-radius: 8px;",
        formatter: (rawParams: unknown) => {
          const params = Array.isArray(rawParams) ? rawParams[0] : rawParams;
          const data =
            typeof params === "object" && params && "data" in params
              ? (params.data as DistributionRow | undefined)
              : undefined;
          if (!data) return "";
          return [
            `<div style="font-weight:700;color:#e0e0e6;margin-bottom:4px">${data.ticker}</div>`,
            `<div style="color:#8f96a3;margin-bottom:6px">${data.companyName}</div>`,
            `<div style="font-family:monospace;color:#00d4ff">${formatPercent(data.weight)} · ${data.marketValueLabel}</div>`,
          ].join("");
        },
        textStyle: {
          color: "#e0e0e6",
          fontFamily: "Inter, sans-serif",
          fontSize: 12,
        },
      },
      series: [
        {
          avoidLabelOverlap: true,
          clockwise: true,
          data: rows.map((row) => ({
            ...row,
            name: row.ticker,
            selected: row.ticker === activeTicker,
            value: row.weight,
          })),
          emphasis: {
            focus: "self",
            itemStyle: {
              borderColor: "rgba(255,255,255,0.92)",
              borderWidth: 2,
              shadowBlur: 24,
              shadowColor: "rgba(0, 212, 255, 0.24)",
            },
            scale: true,
            scaleSize: 8,
          },
          itemStyle: {
            borderColor: "#0a0a0f",
            borderRadius: 4,
            borderWidth: 2,
          },
          label: {
            color: "rgba(224,224,230,0.86)",
            formatter: "{b}",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: 10,
            show: true,
          },
          labelLine: {
            length: 10,
            length2: 6,
            lineStyle: {
              color: "rgba(255,255,255,0.2)",
            },
          },
          minAngle: 3,
          name: "Holdings",
          radius: ["54%", "78%"],
          selectedMode: "single",
          selectedOffset: 18,
          startAngle: 90,
          type: "pie",
        },
      ],
    }),
    [activeTicker, rows],
  );

  if (rows.length === 0) {
    return (
      <div className="glass-card flex min-h-[360px] items-center justify-center p-4 font-mono text-sm text-[var(--text-secondary)]">
        No distribution data available
      </div>
    );
  }

  return (
    <div className="glass-card p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-[0.25em] text-[var(--text-secondary)]">
          Position distribution
        </h2>
        <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--text-secondary)]">
          {distributionDate ? <span>published {distributionDate}</span> : null}
          <span>top 20</span>
        </div>
      </div>

      <div className="grid items-center gap-5 xl:grid-cols-[minmax(320px,0.92fr)_1fr]">
        <div className="relative mx-auto aspect-square w-full max-w-[430px]">
          <ReactECharts
            className="h-full w-full"
            notMerge
            onEvents={{
              mouseout: () => setActiveTicker(null),
              mouseover: (params: ChartEventParams) => {
                if (params.data?.ticker) setActiveTicker(params.data.ticker);
              },
            }}
            option={chartOption}
            opts={{ renderer: "svg" }}
            style={{ height: "100%", width: "100%" }}
          />

          <div className="pointer-events-none absolute inset-[34%] flex flex-col items-center justify-center rounded-full border border-white/[0.08] bg-[#111118]/95 text-center shadow-2xl">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-full border font-heading text-lg font-semibold ${
                avatar.tone === "amber"
                  ? "border-[var(--amber)]/40 bg-[var(--amber)]/12 text-[var(--amber)]"
                  : avatar.tone === "green"
                    ? "border-[var(--green)]/40 bg-[var(--green)]/12 text-[var(--green)]"
                    : avatar.tone === "red"
                      ? "border-[var(--red)]/40 bg-[var(--red)]/12 text-[var(--red)]"
                      : avatar.tone === "violet"
                        ? "border-violet-300/40 bg-violet-300/12 text-violet-200"
                        : avatar.tone === "slate"
                          ? "border-slate-300/30 bg-slate-300/10 text-slate-200"
                          : "border-[var(--cyan)]/40 bg-[var(--cyan)]/12 text-[var(--cyan)]"
              }`}
            >
              {avatar.initials}
            </div>
            <div className="mt-2 max-w-[120px] truncate font-mono text-[10px] text-[var(--text-secondary)]">
              {avatar.label}
            </div>
            {activeRow ? (
              <div className="mt-1 font-mono text-[11px] text-[var(--text-primary)]">
                {activeRow.ticker} · {formatPercent(activeRow.weight)}
              </div>
            ) : null}
          </div>

          {rows.map((row, index) => {
            const active = row.ticker === activeTicker;
            return (
              <button
                aria-label={`${row.ticker} ${formatPercent(row.weight)}`}
                className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-lg transition-transform ${
                  active ? "scale-125" : "scale-100 hover:scale-110"
                }`}
                key={row.ticker}
                onBlur={() => setActiveTicker(null)}
                onFocus={() => setActiveTicker(row.ticker)}
                onMouseEnter={() => setActiveTicker(row.ticker)}
                onMouseLeave={() => setActiveTicker(null)}
                style={markerPosition(rows, index)}
                type="button"
              >
                <LogoBadge compact={index >= 8} row={row} />
              </button>
            );
          })}
        </div>

        <div className="min-w-0 space-y-2">
          {rows.map((row) => {
            const active = row.ticker === activeTicker;
            const width = maxWeight > 0 ? (row.weight / maxWeight) * 100 : 0;
            return (
              <button
                className={`grid w-full grid-cols-[32px_38px_minmax(0,1fr)_72px_86px] items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-[var(--cyan)]/45 bg-[var(--cyan)]/10"
                    : "border-white/[0.05] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
                }`}
                key={row.ticker}
                onBlur={() => setActiveTicker(null)}
                onFocus={() => setActiveTicker(row.ticker)}
                onMouseEnter={() => setActiveTicker(row.ticker)}
                onMouseLeave={() => setActiveTicker(null)}
                type="button"
              >
                <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                  #{row.rank}
                </span>
                <LogoBadge compact row={row} />
                <span className="min-w-0">
                  <span className="block truncate font-heading text-sm text-[var(--text-primary)]">
                    {row.ticker} ({row.companyName})
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                    <span
                      className="block h-full rounded-full"
                      style={{ backgroundColor: row.color, width: `${Math.max(width, 2)}%` }}
                    />
                  </span>
                </span>
                <span className="text-right font-mono text-xs text-[var(--text-primary)]">
                  {formatPercent(row.weight)}
                </span>
                <span className="text-right font-mono text-xs text-[var(--text-secondary)]">
                  {row.marketValueLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
