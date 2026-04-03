import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { GlassCard } from "@/components/cards/GlassCard";
import { MetricCard } from "@/components/cards/MetricCard";
import { VixGauge } from "@/components/charts/VixGauge";
import { fetchCandlesticks } from "@/api/quotes";
import type { VixData } from "@/api/types";
import { fetchLatestVix, fetchVix } from "@/api/vix";
import { toNumber } from "@/lib/format";
import { colors, withHudBase } from "@/styles/theme";

const REFETCH = 30_000;
const DEFAULT_SYMBOL = "TSLA.US";

function regimeFromVix(v: number): string {
  if (v < 15) return "Complacent";
  if (v <= 25) return "Normal";
  if (v <= 35) return "Elevated";
  return "Panic";
}

function segmentColor(v: number): string {
  if (v < 15) return colors.green;
  if (v <= 25) return colors.textPrimary;
  if (v <= 35) return colors.amber;
  return colors.red;
}

function vixValue(d: VixData): number {
  return toNumber(d.close ?? d.open ?? d.high);
}

export interface VixFearProps {
  symbol?: string;
}

export function VixFear({ symbol = DEFAULT_SYMBOL }: VixFearProps) {
  const qLatest = useQuery({
    queryKey: ["vix-latest", "day"],
    queryFn: () => fetchLatestVix("day"),
    refetchInterval: REFETCH,
  });

  const qSeries = useQuery({
    queryKey: ["vix", "series", "day"],
    queryFn: () => fetchVix("day", 180),
    refetchInterval: REFETCH,
  });

  const qCandles = useQuery({
    queryKey: ["candles", symbol, "vix-align"],
    queryFn: () => fetchCandlesticks(symbol, "Day", 220),
    refetchInterval: REFETCH,
  });

  const latestV = qLatest.data ? vixValue(qLatest.data) : 0;
  const prevV =
    qSeries.data && qSeries.data.length > 1
      ? vixValue(qSeries.data[1]!)
      : latestV;
  const vixChgPct =
    prevV !== 0 ? ((latestV - prevV) / prevV) * 100 : 0;

  const dualOption = useMemo(() => {
    const vixSorted = [...(qSeries.data ?? [])].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    const candles = [...(qCandles.data ?? [])].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    const priceByDay = new Map(
      candles.map((c) => [c.ts.slice(0, 10), toNumber(c.close)] as const),
    );

    const categories = vixSorted.map((d) => d.ts.slice(0, 10));
    const vixY = vixSorted.map((d) => vixValue(d));
    const tslaY = categories.map((day) => priceByDay.get(day) ?? null);

    return withHudBase({
      legend: {
        textStyle: { color: colors.textSecondary, fontSize: 10 },
        top: 0,
      },
      grid: { left: 52, right: 52, top: 32, bottom: 28 },
      xAxis: {
        type: "category",
        data: categories,
        axisLine: { lineStyle: { color: colors.borderSubtle } },
        axisLabel: { color: colors.textSecondary, fontSize: 9, rotate: 35 },
      },
      yAxis: [
        {
          type: "value",
          name: "TSLA",
          position: "left",
          axisLine: { show: false },
          axisLabel: { color: colors.cyan, fontSize: 10 },
          splitLine: { lineStyle: { color: colors.borderSubtle } },
        },
        {
          type: "value",
          name: "VIX",
          position: "right",
          axisLine: { show: false },
          axisLabel: { color: colors.amber, fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "TSLA",
          type: "line",
          yAxisIndex: 0,
          data: tslaY,
          smooth: true,
          showSymbol: false,
          connectNulls: true,
          lineStyle: { width: 2, color: colors.cyan },
        },
        {
          name: "VIX",
          type: "line",
          yAxisIndex: 1,
          data: vixY,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: colors.amber },
        },
      ],
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(10,10,15,0.92)",
        borderColor: "rgba(0,212,255,0.25)",
        textStyle: { color: colors.textPrimary, fontSize: 11 },
      },
    });
  }, [qSeries.data, qCandles.data]);

  const vixHistory = useMemo(
    () =>
      [...(qSeries.data ?? [])].sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
      ),
    [qSeries.data],
  );

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

  const hasDual =
    (qSeries.data?.length ?? 0) > 0 && (qCandles.data?.length ?? 0) > 0;

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="mx-auto max-w-[1200px] space-y-6 pb-12"
    >
      <motion.header variants={item} className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold text-[var(--text-primary)]">
          VIX fear gauge
        </h1>
        <p className="font-mono text-xs text-[var(--text-secondary)]">
          Volatility vs {symbol} close — regime trail
        </p>
      </motion.header>

      <motion.section
        variants={item}
        className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,1fr))]"
      >
        {qLatest.isLoading && !qLatest.data ? (
          <div className="col-span-full h-40 animate-pulse rounded-xl bg-white/[0.04]" />
        ) : (
          <>
            <div className="glass-card p-2">
              <VixGauge value={latestV} regime={regimeFromVix(latestV)} />
            </div>
            <MetricCard
              label="VIX Δ (vs prior bar)"
              value={Number(vixChgPct.toFixed(2))}
              suffix="%"
              glowColor="amber"
            />
            <GlassCard className="flex flex-col justify-center p-4">
              <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                Regime
              </p>
              <span
                className="mt-3 inline-flex w-fit rounded-full px-3 py-1 font-mono text-xs font-semibold uppercase tracking-[0.12em]"
                style={{
                  backgroundColor: `${segmentColor(latestV)}22`,
                  color: segmentColor(latestV),
                  border: `1px solid ${segmentColor(latestV)}55`,
                }}
              >
                {regimeFromVix(latestV)}
              </span>
            </GlassCard>
          </>
        )}
      </motion.section>

      <motion.section variants={item}>
        <div className="glass-card p-4">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
            VIX (amber) vs TSLA close (cyan)
          </p>
          {qSeries.isLoading || qCandles.isLoading ? (
            <div className="mt-4 h-80 animate-pulse rounded-lg bg-white/[0.04]" />
          ) : hasDual ? (
            <div className="mt-4 h-80 w-full">
              <ReactECharts
                option={dualOption}
                style={{ height: "100%", width: "100%" }}
                notMerge
                lazyUpdate
              />
            </div>
          ) : (
            <p className="mt-4 font-mono text-sm text-[var(--text-secondary)]">
              Not enough overlapping history to plot.
            </p>
          )}
        </div>
      </motion.section>

      <motion.section variants={item}>
        <div className="glass-card p-4">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
            Regime history
          </p>
          {qSeries.isLoading ? (
            <div className="mt-4 h-10 animate-pulse rounded-md bg-white/[0.04]" />
          ) : (
            <div className="mt-4 flex h-10 w-full overflow-hidden rounded-md border border-[var(--border-subtle)]">
              {vixHistory.map((p, i) => (
                <motion.div
                  key={`${p.ts}-${i}`}
                  className="h-full min-w-[2px] flex-1"
                  style={{ backgroundColor: segmentColor(vixValue(p)) }}
                  title={`${p.ts.slice(0, 10)} · ${regimeFromVix(vixValue(p))}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.002 }}
                />
              ))}
            </div>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}
