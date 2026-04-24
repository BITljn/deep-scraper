import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { SentimentCommentCard } from "@/components/cards/SentimentCommentCard";
import { IndicatorChart } from "@/components/charts/IndicatorChart";
import { HeatMap, type HeatMapPoint } from "@/components/charts/HeatMap";
import type { IndicatorData } from "@/api/types";
import { fetchIndicators } from "@/api/indicators";
import {
  fetchSentimentComments,
  fetchSentimentSummary,
} from "@/api/sentiment";
import { toNumber } from "@/lib/format";

const REFETCH = 30_000;
const PAGE_SIZE = 20;

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

const LABEL_FILTERS = [
  { key: null, text: "All" },
  { key: "positive", text: "Positive" },
  { key: "neutral", text: "Neutral" },
  { key: "negative", text: "Negative" },
] as const;

const SOURCE_FILTERS = [
  { key: null, text: "All sources" },
  { key: "topic", text: "Topics" },
  { key: "topic_reply", text: "Replies" },
  { key: "tweet", text: "Tweets" },
] as const;

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

function DhiHeatCollapsible({
  heatData,
  isLoading,
}: {
  heatData: HeatMapPoint[];
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="glass-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
          DHI activity heatmap (date × hour)
        </p>
        <svg
          className={`h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-[var(--border-subtle)] px-4 pb-4">
          {isLoading ? (
            <div className="mt-4 h-[420px] animate-pulse rounded-lg bg-white/[0.04]" />
          ) : heatData.length === 0 ? (
            <p className="mt-4 font-mono text-sm text-[var(--text-secondary)]">
              No DHI buckets to plot — collect indicator data first.
            </p>
          ) : (
            <div className="mt-2">
              <HeatMap data={heatData} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface SentimentMatrixProps {
  symbol: string;
}

export function SentimentMatrix({ symbol }: SentimentMatrixProps) {
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const qSummary = useQuery({
    queryKey: ["sentiment-summary", symbol],
    queryFn: () => fetchSentimentSummary(symbol),
    refetchInterval: REFETCH,
  });

  const qComments = useQuery({
    queryKey: ["sentiment-comments", labelFilter, sourceFilter],
    queryFn: () =>
      fetchSentimentComments({
        label: labelFilter ?? undefined,
        source_type: sourceFilter ?? undefined,
        limit: 500,
      }),
    refetchInterval: REFETCH,
  });

  const qInd = useQuery({
    queryKey: ["indicators", symbol, "sentiment-matrix"],
    queryFn: () => fetchIndicators(symbol, "1d", 400),
    refetchInterval: REFETCH,
  });

  const sortedInd = (qInd.data ?? [])
    .slice()
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const spsSeries = sortedInd
    .filter((r) => r.sps_mean != null)
    .map((r) => ({ ts: r.ts, value: toNumber(r.sps_mean) }));

  const spsNow =
    qSummary.data?.sps ?? spsSeries.at(-1)?.value ?? undefined;

  const dhiSeries = sortedInd
    .filter((r) => r.dhi_zscore != null)
    .map((r) => ({ ts: r.ts, value: toNumber(r.dhi_zscore) }));

  const dhiRawSeries = sortedInd
    .filter((r) => r.dhi_raw != null)
    .map((r) => ({ ts: r.ts, value: toNumber(r.dhi_raw) }));

  const dhiNow = dhiSeries.at(-1)?.value ?? undefined;
  const dhiRawNow = dhiRawSeries.at(-1)?.value ?? undefined;

  const heatData = buildDhiHeat(qInd.data ?? []);

  const comments = qComments.data?.items ?? [];
  const totalComments = qComments.data?.total ?? 0;
  const visibleComments = comments.slice(0, visibleCount);
  const hasMore = visibleCount < comments.length;

  const positiveCount = comments.filter((c) => c.label === "positive").length;
  const negativeCount = comments.filter((c) => c.label === "negative").length;
  const neutralCount = comments.filter((c) => c.label === "neutral").length;

  function handleFilterChange(newLabel: string | null) {
    setLabelFilter(newLabel);
    setVisibleCount(PAGE_SIZE);
  }

  function handleSourceChange(newSource: string | null) {
    setSourceFilter(newSource);
    setVisibleCount(PAGE_SIZE);
  }

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
          SPS trajectory · DHI heat · user comments · {symbol}
        </p>
      </motion.header>

      {/* ── SPS chart ── */}
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

      {/* ── DHI: current score + history curve ── */}
      <motion.section variants={item}>
        <div className="glass-card p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1 space-y-2">
              <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                Discussion heat index (DHI)
              </p>
              <div className="flex items-baseline gap-4">
                <div>
                  <span className="font-mono text-xs text-[var(--text-secondary)]">
                    Z-Score{" "}
                  </span>
                  <span
                    className={`font-mono text-2xl font-bold ${
                      dhiNow !== undefined && dhiNow > 1
                        ? "text-[var(--red)]"
                        : dhiNow !== undefined && dhiNow < -1
                          ? "text-[var(--green)]"
                          : "text-[var(--amber)]"
                    }`}
                  >
                    {dhiNow !== undefined
                      ? `${dhiNow > 0 ? "+" : ""}${dhiNow.toFixed(2)}`
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="font-mono text-xs text-[var(--text-secondary)]">
                    Raw{" "}
                  </span>
                  <span className="font-mono text-sm text-[var(--text-primary)]">
                    {dhiRawNow !== undefined
                      ? `${dhiRawNow > 0 ? "+" : ""}${(dhiRawNow * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                </div>
              </div>
              <p className="max-w-xl font-mono text-xs leading-relaxed text-[var(--text-secondary)]">
                Z-Score measures how far current discussion volume deviates from
                the 30-day mean. |Z| &gt; 2 signals unusual activity.
                Raw shows the period-over-period change rate.
              </p>
            </div>
            {qInd.isLoading ? (
              <div className="h-64 w-full animate-pulse rounded-lg bg-white/[0.04] lg:w-2/3" />
            ) : (
              <div className="w-full lg:w-2/3">
                {dhiSeries.length > 0 ? (
                  <IndicatorChart data={dhiSeries} color="var(--amber)" />
                ) : (
                  <div className="flex h-[200px] items-center justify-center font-mono text-sm text-[var(--text-secondary)]">
                    No DHI series
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.section>

      {/* ── DHI heatmap detail ── */}
      <motion.section variants={item}>
        <DhiHeatCollapsible heatData={heatData} isLoading={qInd.isLoading} />
      </motion.section>

      {/* ── User comments with sentiment ── */}
      <motion.section variants={item}>
        <div className="glass-card p-5">
          {/* Header with count */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h2 className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                User comments sentiment
              </h2>
              <div className="flex items-center gap-3 font-mono text-xs">
                <span className="text-[var(--text-primary)]">
                  {totalComments} comments
                </span>
                {totalComments > 0 && (
                  <>
                    <span className="text-[var(--green)]">
                      {positiveCount} positive
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      {neutralCount} neutral
                    </span>
                    <span className="text-[var(--red)]">
                      {negativeCount} negative
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="mt-4 flex flex-wrap gap-4">
            {/* Label filter */}
            <div className="flex gap-1">
              {LABEL_FILTERS.map((f) => (
                <button
                  key={f.text}
                  onClick={() => handleFilterChange(f.key)}
                  className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${
                    labelFilter === f.key
                      ? "border-[var(--cyan)]/50 bg-[var(--cyan)]/10 text-[var(--cyan)]"
                      : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--cyan)]/30 hover:text-[var(--text-primary)]"
                  }`}
                >
                  {f.text}
                </button>
              ))}
            </div>
            {/* Source filter */}
            <div className="flex gap-1">
              {SOURCE_FILTERS.map((f) => (
                <button
                  key={f.text}
                  onClick={() => handleSourceChange(f.key)}
                  className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${
                    sourceFilter === f.key
                      ? "border-[var(--cyan)]/50 bg-[var(--cyan)]/10 text-[var(--cyan)]"
                      : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--cyan)]/30 hover:text-[var(--text-primary)]"
                  }`}
                >
                  {f.text}
                </button>
              ))}
            </div>
          </div>

          {/* Comment list */}
          <div className="mt-4">
            {qComments.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-20 animate-pulse rounded-xl bg-white/[0.04]"
                  />
                ))}
              </div>
            ) : comments.length === 0 ? (
              <p className="py-6 text-center font-mono text-sm text-[var(--text-secondary)]">
                No sentiment comments found.
              </p>
            ) : (
              <>
                <div className="max-h-[600px] space-y-2 overflow-y-auto pr-1">
                  {visibleComments.map((c) => (
                    <SentimentCommentCard key={c.id} comment={c} />
                  ))}
                </div>

                {/* Load more / show count */}
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                    Showing {visibleComments.length} of {comments.length}
                  </span>
                  {hasMore && (
                    <button
                      onClick={() =>
                        setVisibleCount((v) => v + PAGE_SIZE)
                      }
                      className="rounded-full border border-[var(--border-subtle)] px-4 py-1.5 font-mono text-[11px] text-[var(--cyan)] transition-colors hover:border-[var(--cyan)]/50 hover:bg-[var(--cyan)]/10"
                    >
                      Load more
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}
