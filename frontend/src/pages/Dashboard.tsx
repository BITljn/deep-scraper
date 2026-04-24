import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CollectButton } from "@/components/CollectButton";
import { SpotPanel } from "@/components/cards/SpotPanel";
import { PriceChart } from "@/components/charts/PriceChart";
import { SparkLine } from "@/components/SparkLine";
import { TarcoGauge } from "@/components/charts/TarcoGauge";
import { VixGauge } from "@/components/charts/VixGauge";
import { fetchCandlesticks, fetchLatestQuote } from "@/api/quotes";
import { fetchFundamentals } from "@/api/fundamentals";
import { fetchLatestVix } from "@/api/vix";
import type { IndicatorData } from "@/api/types";
import { useLatestIndicator, useIndicators } from "@/hooks/useIndicators";
import { toNumber } from "@/lib/format";

const REFETCH = 30_000;

const STRIP: {
  code: string;
  pick: (r: IndicatorData) => number | null;
  accent: string;
}[] = [
  {
    code: "DHI",
    pick: (r) => (r.dhi_zscore != null ? toNumber(r.dhi_zscore) : null),
    accent: "#00d4ff",
  },
  {
    code: "SPS",
    pick: (r) => (r.sps_mean != null ? toNumber(r.sps_mean) : null),
    accent: "#00ff88",
  },
  {
    code: "EM",
    pick: (r) =>
      r.em_like_comment_ratio != null ? toNumber(r.em_like_comment_ratio) : null,
    accent: "#ffaa00",
  },
  {
    code: "MS",
    pick: (r) => (r.ms_sentiment != null ? toNumber(r.ms_sentiment) : null),
    accent: "#ff3366",
  },
  {
    code: "VFS",
    pick: (r) => (r.vix_level != null ? toNumber(r.vix_level) : null),
    accent: "#e0e0e6",
  },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.07, delayChildren: 0.04 },
  },
};

const block = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

function seriesFor(
  rows: IndicatorData[] | undefined,
  pick: (r: IndicatorData) => number | null,
): number[] {
  if (!rows?.length) return [];
  const sorted = [...rows].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
  const out: number[] = [];
  for (const r of sorted) {
    const v = pick(r);
    if (v !== null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function vixRegimeLabel(v: number): string {
  if (v < 15) return "Complacent";
  if (v <= 25) return "Normal";
  if (v <= 35) return "Elevated";
  return "Panic";
}

export interface DashboardProps {
  symbol: string;
}

export function Dashboard({ symbol }: DashboardProps) {
  const quoteQ = useQuery({
    queryKey: ["quote-latest", symbol],
    queryFn: () => fetchLatestQuote(symbol),
    refetchInterval: REFETCH,
  });

  const candlesQ = useQuery({
    queryKey: ["candles", symbol, "Day"],
    queryFn: () => fetchCandlesticks(symbol, "Day", 120),
    refetchInterval: REFETCH,
  });

  const vixLatestQ = useQuery({
    queryKey: ["vix-latest", "day"],
    queryFn: () => fetchLatestVix("day"),
    refetchInterval: REFETCH,
  });

  const fundQ = useQuery({
    queryKey: ["fundamentals", symbol],
    queryFn: () => fetchFundamentals(symbol),
    refetchInterval: 300_000,
    staleTime: 300_000,
  });

  const { data: latestInd } = useLatestIndicator(symbol, "1d");

  const indQ = useIndicators(symbol, "1d", 240);
  const indicatorRows = indQ.data as IndicatorData[] | undefined;

  const q = quoteQ.data;

  const tarco = latestInd ? toNumber(latestInd.tarco_score) : 0;
  const sig = latestInd?.tarco_signal ?? "NEUTRAL";

  const vx = vixLatestQ.data
    ? toNumber(vixLatestQ.data.close ?? vixLatestQ.data.open)
    : 0;

  const loadingStrip = indQ.isLoading && !indicatorRows?.length;

  return (
    <div className="relative pb-24">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="mx-auto max-w-[1400px] space-y-6"
      >
        <motion.header variants={block} className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-[var(--text-primary)] md:text-3xl">
            Command Center
          </h1>
          <p className="font-mono text-xs text-[var(--text-secondary)]">
            Tesla intelligence · {symbol} · 30s refresh
          </p>
        </motion.header>

        <motion.section
          variants={block}
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
        >
          {quoteQ.isLoading && !q ? (
            <div className="col-span-full h-48 animate-pulse rounded-xl bg-white/[0.04]" />
          ) : (
            <>
              <SpotPanel
                quote={q}
                fundamentals={fundQ.data}
                loading={quoteQ.isLoading && !q}
              />
              <div className="glass-card glow-cyan relative overflow-hidden p-2">
                <TarcoGauge value={tarco} signal={sig} />
              </div>
              <div className="glass-card relative max-h-[300px] scale-95 p-2 md:scale-90">
                {vixLatestQ.isLoading && !vixLatestQ.data ? (
                  <div className="h-[240px] animate-pulse rounded-lg bg-white/[0.04]" />
                ) : (
                  <VixGauge value={vx} regime={vixRegimeLabel(vx)} />
                )}
              </div>
            </>
          )}
        </motion.section>

        <motion.section variants={block}>
          <div className="glass-card glow-cyan p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-xs font-semibold uppercase tracking-[0.25em] text-[var(--text-secondary)]">
                Price action
              </h2>
              {candlesQ.isFetching ? (
                <span className="font-mono text-[10px] text-[var(--cyan)]/80">
                  syncing…
                </span>
              ) : null}
            </div>
            {candlesQ.isLoading ? (
              <div className="h-[420px] animate-pulse rounded-lg bg-white/[0.04]" />
            ) : candlesQ.data && candlesQ.data.length > 0 ? (
              <PriceChart data={candlesQ.data} />
            ) : (
              <div className="flex h-[320px] items-center justify-center font-mono text-sm text-[var(--text-secondary)]">
                No candlestick data
              </div>
            )}
          </div>
        </motion.section>

        <motion.section variants={block}>
          <h2 className="font-heading mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-[var(--text-secondary)]">
            Indicator strip
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {STRIP.map((s) => {
              const pts = seriesFor(indicatorRows, s.pick);
              const latest = pts.at(-1);
              return (
                <motion.div key={s.code} variants={block}>
                  {loadingStrip ? (
                    <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
                  ) : (
                    <SparkLine
                      label={s.code}
                      value={
                        latest !== undefined ? latest.toFixed(3) : "—"
                      }
                      points={
                        pts.length > 1
                          ? pts
                          : [0, 0.1, 0.05, 0.12, 0.08]
                      }
                      accent={s.accent}
                    />
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.section>
      </motion.div>

      <div className="pointer-events-none fixed bottom-6 right-6 z-50 md:bottom-8 md:right-8">
        <div className="pointer-events-auto">
          <CollectButton jobType="all" symbol={symbol} />
        </div>
      </div>
    </div>
  );
}
