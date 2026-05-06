import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { motion } from "framer-motion";
import ReactECharts from "echarts-for-react";
import { fetchMega7Pe } from "@/api/mega7";
import type { Mega7PePoint } from "@/api/types";
import { MetricCard } from "@/components/cards/MetricCard";
import { colors, withHudBase } from "@/styles/theme";

const YEARS = 10;
const REFRESH_MS = 3_600_000;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const MEGA7_SYMBOLS = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "META", name: "Meta" },
  { symbol: "TSLA", name: "Tesla" },
];

function formatDate(value: string | number | Date | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

function formatPe(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}x`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function pointValue(value: unknown): number | undefined {
  if (Array.isArray(value)) {
    const candidate = Number(value[1]);
    return Number.isFinite(candidate) ? candidate : undefined;
  }
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : undefined;
}

function latestWithPe(items: Mega7PePoint[]): Mega7PePoint | undefined {
  return [...items].reverse().find((point) => point.pe != null);
}

export function Mega7Pe() {
  const [symbol, setSymbol] = useState("AAPL");
  const [showRoe, setShowRoe] = useState(false);
  const [refreshNonceBySymbol, setRefreshNonceBySymbol] = useState<Record<string, number>>({});
  const [refreshSymbol, setRefreshSymbol] = useState<string | null>(null);
  const queries = useQueries({
    queries: MEGA7_SYMBOLS.map((item) => {
      const refreshNonce = refreshNonceBySymbol[item.symbol] ?? 0;
      const shouldRefresh = refreshSymbol === item.symbol && refreshNonce > 0;
      return {
        queryKey: ["mega7-pe", item.symbol, YEARS, refreshNonce],
        queryFn: () => fetchMega7Pe(item.symbol, YEARS, shouldRefresh),
        refetchInterval: REFRESH_MS,
        staleTime: REFRESH_MS,
        gcTime: REFRESH_MS * 4,
      };
    }),
  });
  const selectedIndex = MEGA7_SYMBOLS.findIndex((item) => item.symbol === symbol);
  const q = queries[selectedIndex >= 0 ? selectedIndex : 0]!;

  useEffect(() => {
    if (!q.isFetching && q.data?.symbol === refreshSymbol) {
      setRefreshSymbol(null);
    }
  }, [q.data?.symbol, q.isFetching, refreshSymbol]);

  const items = q.data?.items ?? [];
  const latest = latestWithPe(items);
  const first = items.find((point) => point.close > 0);
  const peValues = items
    .map((point) => point.pe)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const avgPe = peValues.length
    ? peValues.reduce((sum, value) => sum + value, 0) / peValues.length
    : 0;
  const priceReturn =
    first && latest ? ((latest.close - first.close) / first.close) * 100 : 0;
  const highPe = peValues.length ? Math.max(...peValues) : 0;
  const latestRoe = [...items].reverse().find((point) => point.roe != null)?.roe;

  const option = useMemo(() => {
    const peSeries = items
      .filter((point) => point.pe != null)
      .map((point) => [point.date, point.pe] as [string, number]);
    const priceSeries = items.map((point) => [point.date, point.close] as [string, number]);
    const roeSeries = items
      .filter((point) => point.roe != null)
      .map((point) => [point.date, point.roe] as [string, number]);
    const avgLine = peSeries.map(([date]) => [date, Number(avgPe.toFixed(2))] as [string, number]);

    return withHudBase({
      legend: {
        bottom: 0,
        left: "center",
        itemGap: 18,
        itemWidth: 16,
        itemHeight: 8,
        textStyle: { color: colors.textSecondary, fontSize: 10 },
      },
      grid: { left: 56, right: 64, top: 26, bottom: 96 },
      dataZoom: [
        {
          type: "inside",
          filterMode: "none",
        },
        {
          type: "slider",
          bottom: 34,
          height: 22,
          borderColor: "rgba(255,255,255,0.08)",
          fillerColor: "rgba(0,212,255,0.12)",
          handleStyle: { color: colors.cyan },
          moveHandleStyle: { color: colors.cyan },
          textStyle: { color: colors.textSecondary, fontSize: 10 },
          dataBackground: {
            lineStyle: { color: "rgba(0,212,255,0.35)" },
            areaStyle: { color: "rgba(0,212,255,0.08)" },
          },
        },
      ],
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: colors.borderSubtle } },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: 10,
          hideOverlap: true,
          margin: 14,
          formatter: (value: number) => String(new Date(value).getUTCFullYear()),
        },
        minInterval: YEAR_MS,
      },
      yAxis: [
        {
          type: "value",
          name: "",
          axisLine: { show: false },
          axisLabel: {
            color: colors.textSecondary,
            fontSize: 10,
            formatter: (value: number) => `${value.toFixed(0)}x`,
          },
          splitLine: { lineStyle: { color: colors.borderSubtle } },
        },
        {
          type: "value",
          name: "",
          axisLine: { show: false },
          axisLabel: {
            color: colors.textSecondary,
            fontSize: 10,
            margin: 14,
            formatter: (value: number) => `$${value.toFixed(0)}`,
          },
          splitLine: { show: false },
        },
        {
          type: "value",
          name: "",
          show: false,
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "Dynamic PE",
          type: "line",
          data: peSeries,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 3, color: colors.cyan },
          areaStyle: { color: "rgba(0,212,255,0.08)" },
        },
        {
          name: "10Y avg PE",
          type: "line",
          data: avgLine,
          showSymbol: false,
          lineStyle: { width: 1.5, color: colors.amber, type: "dashed" },
        },
        {
          name: "Price",
          type: "line",
          yAxisIndex: 1,
          data: priceSeries,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: colors.green },
        },
        ...(showRoe && roeSeries.length
          ? [
              {
                name: "ROE",
                type: "line" as const,
                yAxisIndex: 2,
                data: roeSeries,
                smooth: true,
                showSymbol: false,
                lineStyle: { width: 2, color: colors.red },
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
          const rows = Array.isArray(params) ? params : [params];
          const firstRow = rows[0] as {
            axisValue?: string | number;
            value?: number | [string, number];
          } | undefined;
          const axisValue =
            firstRow?.axisValue ?? (Array.isArray(firstRow?.value) ? firstRow.value[0] : undefined);
          const lines = [formatDate(axisValue)];

          rows.forEach((row) => {
            const point = row as {
              marker?: string;
              seriesName?: string;
              value?: number | [string, number];
            };
            const value = pointValue(point.value);
            if (value == null) return;
            const formatted =
              point.seriesName === "Price"
                ? formatUsd(value)
                : point.seriesName === "ROE"
                  ? formatPercent(value)
                  : formatPe(value);
            lines.push(`${point.marker ?? ""}${point.seriesName ?? ""}: ${formatted}`);
          });

          const match = items.find((point) => point.date === axisValue);
          if (match?.ttm_eps != null) {
            lines.push(`TTM EPS: ${match.ttm_eps.toFixed(2)}`);
          }
          if (match?.eps_report_date) {
            lines.push(`EPS as of: ${formatDate(match.eps_report_date)}`);
          }
          if (showRoe && match?.ttm_net_income != null) {
            lines.push(`TTM net income: $${match.ttm_net_income.toFixed(1)}B`);
          }
          if (showRoe && match?.equity != null) {
            lines.push(`Equity: $${match.equity.toFixed(1)}B`);
          }

          return lines.join("<br/>");
        },
      },
    });
  }, [avgPe, items, showRoe]);

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
      className="mx-auto max-w-[1300px] space-y-6 pb-12"
    >
      <motion.header
        variants={item}
        className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
      >
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-[var(--text-primary)] md:text-3xl">
            Mega 7 PE
          </h1>
          <p className="mt-1 font-mono text-xs text-[var(--text-secondary)]">
            {q.data?.name ?? symbol} · {YEARS}Y monthly price / TTM EPS · cache {q.data?.cache_status ?? "-"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {MEGA7_SYMBOLS.map((item, index) => (
            <button
              key={item.symbol}
              type="button"
              onClick={() => setSymbol(item.symbol)}
              title={item.name}
              className={`rounded-md border px-3 py-2 font-mono text-xs transition-colors ${
                item.symbol === symbol
                  ? "border-[var(--cyan)]/50 bg-[var(--cyan)]/10 text-[var(--cyan)]"
                  : "border-white/[0.08] bg-white/[0.03] text-[var(--text-secondary)] hover:border-white/[0.16]"
              }`}
            >
              {item.symbol}
              {queries[index]?.isFetching ? (
                <span className="ml-2 text-[var(--amber)]">sync</span>
              ) : null}
            </button>
          ))}
          <button
            type="button"
            disabled={q.isFetching}
            onClick={() => {
              setRefreshSymbol(symbol);
              setRefreshNonceBySymbol((value) => ({
                ...value,
                [symbol]: (value[symbol] ?? 0) + 1,
              }));
            }}
            className="rounded-md border border-[var(--amber)]/45 bg-[var(--amber)]/10 px-3 py-2 font-mono text-xs text-[var(--amber)] transition-colors hover:border-[var(--amber)]/70 disabled:cursor-wait disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </motion.header>

      {q.isLoading ? (
        <div className="h-[620px] animate-pulse rounded-xl bg-white/[0.04]" />
      ) : q.isError ? (
        <div className="glass-card flex h-[420px] items-center justify-center font-mono text-sm text-[var(--text-secondary)]">
          Mega 7 feed unavailable
        </div>
      ) : (
        <>
          <motion.section variants={item} className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <MetricCard
              label="Latest PE"
              value={latest?.pe ? Number(latest.pe.toFixed(1)) : 0}
              suffix="x"
              glowColor="cyan"
            />
            <MetricCard
              label="Latest price"
              value={latest?.close ? Number(latest.close.toFixed(2)) : 0}
              prefix="$"
              glowColor="green"
            />
            <MetricCard
              label="10Y avg PE"
              value={Number(avgPe.toFixed(1))}
              suffix="x"
              glowColor="amber"
            />
            <MetricCard
              label="Price return"
              value={Number(priceReturn.toFixed(1))}
              suffix="%"
              glowColor={priceReturn >= 0 ? "green" : "red"}
            />
          </motion.section>

          <motion.section variants={item}>
            <div className="glass-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                    PE / Price
                  </p>
                  <p className="mt-1 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
                    <span>{formatDate(latest?.date)}</span>
                    <span className="mx-2 text-white/20">/</span>
                    <span>PE {formatPe(latest?.pe)}</span>
                    <span className="mx-2 text-white/20">/</span>
                    <span>price {formatUsd(latest?.close)}</span>
                    <span className="mx-2 text-white/20">/</span>
                    <span>high PE {formatPe(highPe)}</span>
                    <span className="mx-2 text-white/20">/</span>
                    <span>ROE {formatPercent(latestRoe)}</span>
                    <span className="mx-2 text-white/20">/</span>
                    <a
                      href={q.data?.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--cyan)] hover:underline"
                    >
                      Yahoo Finance {q.data?.symbol}
                    </a>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRoe((value) => !value)}
                  className={`rounded-md border px-3 py-2 font-mono text-xs transition-colors ${
                    showRoe
                      ? "border-[var(--red)]/50 bg-[var(--red)]/10 text-[var(--red)]"
                      : "border-white/[0.08] bg-white/[0.03] text-[var(--text-secondary)] hover:border-white/[0.16]"
                  }`}
                >
                  ROE
                </button>
              </div>
              <div className="mt-4 h-[520px] w-full">
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
