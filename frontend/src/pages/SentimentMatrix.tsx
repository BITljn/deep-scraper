import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { TopicCard } from "@/components/cards/TopicCard";
import { IndicatorChart } from "@/components/charts/IndicatorChart";
import { HeatMap, type HeatMapPoint } from "@/components/charts/HeatMap";
import type { IndicatorData } from "@/api/types";
import { fetchIndicators } from "@/api/indicators";
import {
  fetchSentimentScores,
  fetchSentimentSummary,
} from "@/api/sentiment";
import type { SentimentScore, Topic } from "@/api/types";
import { toNumber } from "@/lib/format";

const REFETCH = 30_000;

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

function scoreToTopic(s: SentimentScore): Topic {
  return {
    id: s.id,
    symbol: "",
    title: s.label ?? `Signal ${s.id}`,
    description: s.text_snippet ?? "",
    url: null,
    published_at: new Date().toISOString(),
    comments_count: null,
    likes_count: null,
    shares_count: null,
  };
}

function buildDhiHeat(rows: IndicatorData[]): HeatMapPoint[] {
  const out: HeatMapPoint[] = [];
  for (const r of rows) {
    if (r.dhi_zscore == null && r.dhi_raw == null) continue;
    const t = new Date(r.ts);
    if (Number.isNaN(t.getTime())) continue;
    out.push({
      date: r.ts.slice(0, 10),
      hour: t.getUTCHours(),
      value: Math.abs(toNumber(r.dhi_zscore ?? r.dhi_raw)),
    });
  }
  return out;
}

export interface SentimentMatrixProps {
  symbol: string;
}

export function SentimentMatrix({ symbol }: SentimentMatrixProps) {
  const qSummary = useQuery({
    queryKey: ["sentiment-summary", symbol],
    queryFn: () => fetchSentimentSummary(symbol),
    refetchInterval: REFETCH,
  });

  const qScores = useQuery({
    queryKey: ["sentiment-scores", symbol],
    queryFn: () => fetchSentimentScores(symbol, 48),
    refetchInterval: REFETCH,
  });

  const qInd = useQuery({
    queryKey: ["indicators", symbol, "sentiment-matrix"],
    queryFn: () => fetchIndicators(symbol, "1d", 400),
    refetchInterval: REFETCH,
  });

  const spsSeries =
    (qInd.data ?? [])
      .slice()
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      .filter((r) => r.sps_mean != null)
      .map((r) => ({ ts: r.ts, value: toNumber(r.sps_mean) }));

  const spsNow =
    qSummary.data?.sps ??
    spsSeries.at(-1)?.value ??
    undefined;

  const heatData = buildDhiHeat(qInd.data ?? []);

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="mx-auto max-w-[1200px] space-y-6 pb-10"
    >
      <motion.header variants={item} className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold text-[var(--text-primary)]">
          Sentiment matrix
        </h1>
        <p className="font-mono text-xs text-[var(--text-secondary)]">
          SPS trajectory · DHI heat · topic scores · {symbol}
        </p>
      </motion.header>

      <motion.section variants={item}>
        <div className="glass-card p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1 space-y-2">
              <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                Social pulse score (SPS)
              </p>
              <p className="max-w-xl font-mono text-sm leading-relaxed text-[var(--text-primary)]">
                Current SPS{" "}
                <span className="text-[var(--cyan)]">
                  {spsNow !== undefined ? spsNow.toFixed(4) : "—"}
                </span>
                . Higher readings imply stronger positive social velocity aligned
                with the mission narrative.
              </p>
            </div>
            {qInd.isLoading ? (
              <div className="h-64 w-full animate-pulse rounded-lg bg-white/[0.04] lg:w-2/3" />
            ) : (
              <div className="w-full lg:w-2/3">
                {spsSeries.length > 0 ? (
                  <IndicatorChart data={spsSeries} color="var(--cyan)" />
                ) : (
                  <div className="flex h-[200px] items-center justify-center font-mono text-sm text-[var(--text-secondary)]">
                    No SPS series
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.section>

      <motion.section variants={item}>
        <div className="glass-card p-4">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
            DHI activity heat (date × hour)
          </p>
          {qInd.isLoading ? (
            <div className="mt-4 h-[420px] animate-pulse rounded-lg bg-white/[0.04]" />
          ) : heatData.length === 0 ? (
            <p className="mt-4 font-mono text-sm text-[var(--text-secondary)]">
              No DHI buckets to plot — collect indicator data first.
            </p>
          ) : (
            <div className="mt-4">
              <HeatMap data={heatData} />
            </div>
          )}
        </div>
      </motion.section>

      <motion.section variants={item}>
        <h2 className="font-heading mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
          Sentiment scores
        </h2>
        {qScores.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-xl bg-white/[0.04]"
              />
            ))}
          </div>
        ) : (qScores.data?.length ?? 0) === 0 ? (
          <div className="glass-card p-6">
            <p className="font-mono text-sm text-[var(--text-secondary)]">
              No sentiment scores returned.
            </p>
          </div>
        ) : (
          <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
            {qScores.data?.map((s) => (
              <TopicCard
                key={s.id}
                topic={scoreToTopic(s)}
                score={s.score}
                label={s.label}
              />
            ))}
          </div>
        )}
      </motion.section>
    </motion.div>
  );
}
