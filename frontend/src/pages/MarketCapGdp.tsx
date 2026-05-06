import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import ReactECharts from "echarts-for-react";
import { MetricCard } from "@/components/cards/MetricCard";
import { fetchMarketCapGdp } from "@/api/macro";
import type { MarketCapGdpPoint, MarketIndexPoint } from "@/api/types";
import { toNumber } from "@/lib/format";
import { colors, withHudBase } from "@/styles/theme";

const REFETCH = 3_600_000;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function formatUsdT(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `$${(value / 1_000).toFixed(1)}T`;
}

function ratio(point: MarketCapGdpPoint | undefined): number {
  return point ? toNumber(point.ratio) : 0;
}

function formatMonthYear(value: string | number | Date | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function normalizedIndex(items: MarketIndexPoint[]): [string, number][] {
  const basePoint = items.find((item) => toNumber(item.value) > 0);
  const base = basePoint ? toNumber(basePoint.value) : 0;
  if (!base) return [];

  return items.map((item) => [item.date, Number(((toNumber(item.value) / base) * 100).toFixed(2))]);
}

function latestRatioPoint(rows: MarketCapGdpPoint[], value: string | number | undefined) {
  if (!rows.length) return undefined;

  const hoverTime = value ? new Date(value).getTime() : Number.NaN;
  if (!Number.isFinite(hoverTime)) return rows.at(-1);

  let candidate = rows[0];
  for (const row of rows) {
    const rowTime = new Date(row.date).getTime();
    if (rowTime > hoverTime) break;
    candidate = row;
  }
  return candidate;
}

export function MarketCapGdp() {
  const [showSp500, setShowSp500] = useState(false);
  const [showNasdaq100, setShowNasdaq100] = useState(false);
  const activeIndices = [
    ...(showSp500 ? ["SP500"] : []),
    ...(showNasdaq100 ? ["NASDAQ100"] : []),
  ];

  const q = useQuery({
    queryKey: ["macro", "market-cap-gdp", 10, activeIndices],
    queryFn: () => fetchMarketCapGdp(10, activeIndices),
    refetchInterval: REFETCH,
    staleTime: REFETCH,
    placeholderData: (previousData) => previousData,
  });

  const rows = q.data?.items ?? [];
  const latest = rows.at(-1);
  const previousYear = rows.length > 4 ? rows.at(-5) : undefined;
  const latestRatio = ratio(latest);
  const oneYearChange = previousYear ? latestRatio - ratio(previousYear) : 0;
  const avg10y = rows.length
    ? rows.reduce((sum, row) => sum + toNumber(row.ratio), 0) / rows.length
    : 0;
  const high = rows.reduce((max, row) => Math.max(max, toNumber(row.ratio)), 0);
  const sp500 = q.data?.indices.find((series) => series.series_id === "SP500");
  const nasdaq100 = q.data?.indices.find((series) => series.series_id === "NASDAQ100");
  const latestDateLabel = formatMonthYear(latest?.date);

  const option = useMemo(() => {
    const ratioSeries = rows.map((row) => [row.date, toNumber(row.ratio)] as [string, number]);
    const avgLine = rows.map((row) => [row.date, Number(avg10y.toFixed(2))] as [string, number]);
    const sp500Series = sp500 ? normalizedIndex(sp500.items) : [];
    const nasdaq100Series = nasdaq100 ? normalizedIndex(nasdaq100.items) : [];
    const showIndexAxis =
      (showSp500 && sp500Series.length > 0) || (showNasdaq100 && nasdaq100Series.length > 0);

    return withHudBase({
      legend: {
        type: "scroll",
        bottom: 0,
        left: "center",
        itemGap: 16,
        itemWidth: 16,
        itemHeight: 8,
        pageIconColor: colors.cyan,
        pageTextStyle: { color: colors.textSecondary },
        textStyle: { color: colors.textSecondary, fontSize: 10 },
      },
      grid: { left: 56, right: showIndexAxis ? 64 : 24, top: 30, bottom: 76 },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: colors.borderSubtle } },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: 10,
          hideOverlap: true,
          margin: 14,
          formatter: (value: number) => {
            const date = new Date(value);
            return String(date.getUTCFullYear());
          },
        },
        minInterval: YEAR_MS,
      },
      yAxis: [
        {
          type: "value",
          name: "%",
          axisLine: { show: false },
          axisLabel: { color: colors.textSecondary, fontSize: 10 },
          splitLine: { lineStyle: { color: colors.borderSubtle } },
        },
        {
          type: "value",
          name: "",
          show: showIndexAxis,
          axisLine: { show: false },
          axisLabel: {
            color: colors.textSecondary,
            fontSize: 10,
            margin: 14,
            formatter: (value: number) => value.toFixed(0),
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "Market cap / GDP",
          type: "line",
          data: ratioSeries,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 3, color: colors.cyan },
          areaStyle: { color: "rgba(0,212,255,0.08)" },
          markLine: {
            symbol: "none",
            label: { show: false },
            lineStyle: { color: "rgba(255,255,255,0.16)", type: "dashed" },
            data: [
              { yAxis: 100, name: "100%" },
              { yAxis: 150, name: "150%" },
              { yAxis: 200, name: "200%" },
            ],
          },
        },
        {
          name: "10Y avg",
          type: "line",
          data: avgLine,
          showSymbol: false,
          lineStyle: { width: 1.5, color: colors.amber, type: "dashed" },
        },
        ...(showSp500 && sp500Series.length
          ? [
              {
                name: "S&P 500 (rebased)",
                type: "line" as const,
                yAxisIndex: 1,
                data: sp500Series,
                smooth: true,
                showSymbol: false,
                lineStyle: { width: 1.8, color: colors.green },
              },
            ]
          : []),
        ...(showNasdaq100 && nasdaq100Series.length
          ? [
              {
                name: "Nasdaq 100 (rebased)",
                type: "line" as const,
                yAxisIndex: 1,
                data: nasdaq100Series,
                smooth: true,
                showSymbol: false,
                lineStyle: { width: 1.8, color: colors.red },
              },
            ]
          : []),
      ],
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(10,10,15,0.94)",
        borderColor: "rgba(0,212,255,0.25)",
        textStyle: { color: colors.textPrimary, fontSize: 11 },
        formatter: (params: unknown) => {
          const items = Array.isArray(params) ? params : [params];
          const first = items[0] as {
            axisValue?: string | number;
            value?: number | [string, number];
          } | undefined;
          const axisValue =
            first?.axisValue ?? (Array.isArray(first?.value) ? first.value[0] : undefined);
          const buffettPoint = latestRatioPoint(rows, axisValue);
          const lines = [formatMonthYear(axisValue)];

          if (buffettPoint) {
            lines.push(
              `<span style="color:${colors.cyan}">●</span> Buffett ratio (${formatMonthYear(
                buffettPoint.date,
              )}): ${toNumber(buffettPoint.ratio).toFixed(2)}%`,
            );
          }
          if (Number.isFinite(avg10y)) {
            lines.push(
              `<span style="color:${colors.amber}">●</span> 10Y avg: ${avg10y.toFixed(2)}%`,
            );
          }

          items.forEach((item) => {
            const point = item as {
              marker?: string;
              seriesName?: string;
              value?: number | [string, number];
            };
            if (point.seriesName === "Market cap / GDP" || point.seriesName === "10Y avg") return;
            const value = Array.isArray(point.value) ? point.value[1] : point.value;
            if (!Number.isFinite(value)) return;
            const suffix = point.seriesName?.includes("rebased") ? "" : "%";
            lines.push(`${point.marker ?? ""}${point.seriesName ?? ""}: ${Number(value).toFixed(2)}${suffix}`);
          });

          return lines.join("<br/>");
        },
      },
    });
  }, [avg10y, nasdaq100, rows, showNasdaq100, showSp500, sp500]);

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.06, delayChildren: 0.04 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="mx-auto max-w-[1200px] space-y-6 pb-12"
    >
      <motion.header variants={item} className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold text-[var(--text-primary)]">
          US market cap / GDP
        </h1>
        <p className="font-mono text-xs text-[var(--text-secondary)]">
          Quarterly Buffett-style valuation ratio · last 10 years
        </p>
      </motion.header>

      {q.isLoading ? (
        <div className="h-[520px] animate-pulse rounded-xl bg-white/[0.04]" />
      ) : q.isError ? (
        <div className="glass-card flex h-[420px] items-center justify-center font-mono text-sm text-[var(--text-secondary)]">
          Macro feed unavailable
        </div>
      ) : (
        <>
          <motion.section variants={item} className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <MetricCard
              label="Latest ratio"
              value={Number(latestRatio.toFixed(2))}
              suffix="%"
              glowColor="cyan"
            />
            <MetricCard
              label="YoY change"
              value={Number(oneYearChange.toFixed(2))}
              suffix=" pts"
              glowColor={oneYearChange >= 0 ? "green" : "red"}
            />
            <MetricCard
              label="10Y average"
              value={Number(avg10y.toFixed(2))}
              suffix="%"
              glowColor="amber"
            />
            <MetricCard
              label="10Y high"
              value={Number(high.toFixed(2))}
              suffix="%"
              glowColor="red"
            />
          </motion.section>

          <motion.section variants={item}>
            <div className="glass-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                    Market cap / GDP
                  </p>
                  <p className="mt-1 max-w-[640px] font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
                    <span>{latestDateLabel}</span>
                    <span className="mx-2 text-white/20">/</span>
                    <span>market cap {formatUsdT(toNumber(latest?.market_cap))}</span>
                    <span className="mx-2 text-white/20">/</span>
                    <span>GDP {formatUsdT(toNumber(latest?.gdp))}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    {
                      id: "sp500",
                      label: "S&P 500",
                      active: showSp500,
                      onClick: () => setShowSp500((active) => !active),
                    },
                    {
                      id: "nasdaq100",
                      label: "Nasdaq 100",
                      active: showNasdaq100,
                      onClick: () => setShowNasdaq100((active) => !active),
                    },
                  ].map((button) => (
                    <button
                      key={button.id}
                      type="button"
                      onClick={button.onClick}
                      className={`rounded-md border px-3 py-2 font-mono text-xs transition-colors ${
                        button.active
                          ? "border-[var(--cyan)]/50 bg-[var(--cyan)]/10 text-[var(--cyan)]"
                          : "border-white/[0.08] bg-white/[0.03] text-[var(--text-secondary)] hover:border-white/[0.16]"
                      }`}
                    >
                      {button.label}
                    </button>
                  ))}
                  <a
                    href={q.data?.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-1 font-mono text-[11px] text-[var(--cyan)] hover:underline"
                  >
                    FRED {q.data?.market_cap_series} / {q.data?.gdp_series}
                  </a>
                  {q.isFetching && !q.isLoading ? (
                    <span className="font-mono text-[10px] text-[var(--text-secondary)]">
                      syncing
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 h-[460px] w-full">
                <ReactECharts
                  option={option}
                  style={{ height: "100%", width: "100%" }}
                  notMerge
                  lazyUpdate
                />
              </div>
            </div>
          </motion.section>
        </>
      )}
    </motion.div>
  );
}
