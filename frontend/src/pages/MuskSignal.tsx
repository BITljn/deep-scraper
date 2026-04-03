import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useState } from "react";
import { GlassCard } from "@/components/cards/GlassCard";
import { MetricCard } from "@/components/cards/MetricCard";
import { IndicatorChart } from "@/components/charts/IndicatorChart";
import { TweetCard } from "@/components/cards/TweetCard";
import { fetchIndicators } from "@/api/indicators";
import { fetchTweets } from "@/api/tweets";
import { toNumber } from "@/lib/format";

const REFETCH = 60_000;
const MUSK_USER = "elonmusk";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.03 },
  },
};

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32 } },
};

export interface MuskSignalProps {
  symbol: string;
}

export function MuskSignal({ symbol }: MuskSignalProps) {
  const [teslaOnly, setTeslaOnly] = useState(false);

  const qTweets = useQuery({
    queryKey: ["tweets", MUSK_USER, teslaOnly],
    queryFn: () => fetchTweets(MUSK_USER, 80, teslaOnly),
    refetchInterval: REFETCH,
  });

  const qMs = useQuery({
    queryKey: ["indicators", symbol, "musk-ms"],
    queryFn: () => fetchIndicators(symbol, "1d", 200),
    refetchInterval: REFETCH,
  });

  const msSeries =
    (qMs.data ?? [])
      .slice()
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      .filter((r) => r.ms_sentiment != null)
      .map((r) => ({ ts: r.ts, value: toNumber(r.ms_sentiment) }));

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="mx-auto max-w-[1200px] pb-10"
    >
      <motion.header
        variants={item}
        className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
      >
        <div>
          <h1 className="font-heading text-2xl font-semibold text-[var(--text-primary)]">
            Musk signal
          </h1>
          <p className="font-mono text-xs text-[var(--text-secondary)]">
            @{MUSK_USER} · MS sentiment vs narrative
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2 font-mono text-xs text-[var(--text-primary)] backdrop-blur-md">
          <span>Tesla only</span>
          <button
            type="button"
            role="switch"
            aria-checked={teslaOnly}
            onClick={() => setTeslaOnly((v) => !v)}
            className={`relative h-6 w-11 rounded-full transition ${
              teslaOnly ? "bg-[var(--cyan)]/40" : "bg-[#2a2a33]"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-[var(--text-primary)] transition ${
                teslaOnly ? "left-5" : "left-0.5"
              }`}
            />
          </button>
        </label>
      </motion.header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,13fr)_minmax(0,7fr)] lg:gap-8">
        <motion.section variants={item} className="min-w-0">
          <h2 className="font-heading mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
            Feed
          </h2>
          {qTweets.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-xl bg-white/[0.04]"
                />
              ))}
            </div>
          ) : (
            <div className="max-h-[calc(100vh-220px)] space-y-3 overflow-y-auto pr-1">
              {(qTweets.data?.length ?? 0) === 0 ? (
                <GlassCard className="p-6">
                  <p className="font-mono text-sm text-[var(--text-secondary)]">
                    No tweets in this filter.
                  </p>
                </GlassCard>
              ) : (
                qTweets.data?.map((tw) => (
                  <TweetCard key={tw.id} tweet={tw} />
                ))
              )}
            </div>
          )}
        </motion.section>

        <motion.aside variants={item} className="space-y-4">
          <MetricCard
            label="Tweet count"
            value={qTweets.data?.length ?? 0}
            glowColor="cyan"
          />
          <div className="glass-card p-4">
            <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
              MS sentiment
            </p>
            {qMs.isLoading ? (
              <div className="mt-3 h-56 animate-pulse rounded-lg bg-white/[0.04]" />
            ) : msSeries.length > 0 ? (
              <div className="mt-3">
                <IndicatorChart data={msSeries} color="var(--red)" />
              </div>
            ) : (
              <p className="mt-4 font-mono text-sm text-[var(--text-secondary)]">
                No MS series yet.
              </p>
            )}
          </div>
        </motion.aside>
      </div>
    </motion.div>
  );
}
