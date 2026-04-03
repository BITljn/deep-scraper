import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { GlassCard } from "@/components/cards/GlassCard";
import { CorrelationMatrix } from "@/components/charts/CorrelationMatrix";
import type { EquityPoint } from "@/components/charts/EquityCurve";
import { EquityCurve } from "@/components/charts/EquityCurve";
import { fetchBacktestResults, triggerBacktest } from "@/api/backtest";
import type { BacktestResult } from "@/api/types";
import { toNumber } from "@/lib/format";

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

function cellTone(
  key: "pearson" | "spearman" | "accuracy" | "sharpe" | "max_dd",
  val: number,
): string {
  const good =
    key === "max_dd"
      ? val >= -0.15
      : key === "accuracy"
        ? val >= 0.52
        : val >= 0.2;
  const bad =
    key === "max_dd"
      ? val <= -0.35
      : key === "accuracy"
        ? val <= 0.48
        : val <= 0;

  if (good) return "text-[var(--green)]";
  if (bad) return "text-[var(--red)]";
  return "text-[var(--text-primary)]";
}

function equityFromRow(r: BacktestResult): EquityPoint[] {
  const n = 48;
  const sharpe = toNumber(r.sharpe_ratio);
  const avg = toNumber(r.avg_return);
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(Date.now() - (n - i) * 86400000).toISOString(),
    value: 100 * (1 + (avg * i) / (n * 10) + Math.sin(i / 4) * sharpe * 0.015),
  }));
}

export interface BacktestLabProps {
  symbol: string;
}

export function BacktestLab({ symbol }: BacktestLabProps) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["backtest", symbol],
    queryFn: () => fetchBacktestResults(symbol),
  });

  const run = useMutation({
    mutationFn: () => triggerBacktest(symbol),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["backtest", symbol] });
    },
  });

  const rows = q.data ?? [];

  const indicators = useMemo(
    () => Array.from(new Set(rows.map((r) => r.indicator_name))),
    [rows],
  );
  const windows = useMemo(
    () => Array.from(new Set(rows.map((r) => r.window))),
    [rows],
  );

  const [ind, setInd] = useState<string>("");
  const [win, setWin] = useState<string>("");

  const selected = useMemo(() => {
    if (!ind || !win) return null;
    return (
      rows.find((r) => r.indicator_name === ind && r.window === win) ?? null
    );
  }, [ind, win, rows]);

  const curve: EquityPoint[] = useMemo(
    () => (selected ? equityFromRow(selected) : []),
    [selected],
  );

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="relative mx-auto max-w-[1280px] space-y-6 pb-16"
    >
      <motion.header
        variants={item}
        className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"
      >
        <div>
          <h1 className="font-heading text-2xl font-semibold text-[var(--text-primary)]">
            Backtest lab
          </h1>
          <p className="font-mono text-xs text-[var(--text-secondary)]">
            Correlation surfaces · equity paths · {symbol}
          </p>
        </div>
        <button
          type="button"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="rounded-lg border border-[var(--green)]/35 bg-[var(--green)]/10 px-4 py-2 font-heading text-xs font-semibold uppercase tracking-[0.18em] text-[var(--green)] shadow-[0_0_24px_rgba(0,255,136,0.15)] transition hover:bg-[var(--green)]/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {run.isPending ? "Running…" : "Run backtest"}
        </button>
      </motion.header>

      <motion.section variants={item}>
        {q.isLoading ? (
          <div className="h-64 animate-pulse rounded-xl bg-white/[0.04]" />
        ) : (
          <div className="glass-card p-4">
            <CorrelationMatrix data={rows} />
          </div>
        )}
      </motion.section>

      <motion.section variants={item} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="glass-card p-4">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
            Equity (synthetic from stats)
          </p>
          {curve.length > 0 ? (
            <EquityCurve data={curve} />
          ) : (
            <p className="mt-4 font-mono text-sm text-[var(--text-secondary)]">
              Select indicator + window with results below.
            </p>
          )}
        </div>
        <GlassCard className="space-y-4 p-4">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
            Selection
          </p>
          <label className="block space-y-1">
            <span className="font-mono text-[10px] text-[var(--text-secondary)]">
              Indicator
            </span>
            <select
              value={ind}
              onChange={(e) => setInd(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]/90 px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--cyan)]/50"
            >
              <option value="">Select…</option>
              {indicators.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[10px] text-[var(--text-secondary)]">
              Window
            </span>
            <select
              value={win}
              onChange={(e) => setWin(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]/90 px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--cyan)]/50"
            >
              <option value="">Select…</option>
              {windows.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <p className="font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
              ρ {toNumber(selected.pearson_corr).toFixed(3)} · Sharpe{" "}
              {toNumber(selected.sharpe_ratio).toFixed(2)}
            </p>
          ) : (
            <p className="font-mono text-[11px] text-[var(--text-secondary)]">
              Pick a row present in the results table.
            </p>
          )}
        </GlassCard>
      </motion.section>

      <motion.section variants={item}>
        <div className="glass-card overflow-hidden p-0">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3">
            <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
              Results
            </p>
          </div>
          {q.isLoading ? (
            <div className="h-40 animate-pulse bg-white/[0.03]" />
          ) : rows.length === 0 ? (
            <p className="p-6 font-mono text-sm text-[var(--text-secondary)]">
              No backtest rows yet. Run a backtest to populate.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-white/[0.03] font-heading uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                    <th className="px-3 py-2">Indicator</th>
                    <th className="px-3 py-2">Window</th>
                    <th className="px-3 py-2">Pearson</th>
                    <th className="px-3 py-2">Spearman</th>
                    <th className="px-3 py-2">Accuracy</th>
                    <th className="px-3 py-2">Sharpe</th>
                    <th className="px-3 py-2">Max DD</th>
                    <th className="px-3 py-2">Signals</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const p = toNumber(r.pearson_corr);
                    const sp = toNumber(r.spearman_corr);
                    const acc = toNumber(r.signal_accuracy);
                    const sh = toNumber(r.sharpe_ratio);
                    const dd = toNumber(r.max_drawdown);
                    return (
                      <motion.tr
                        key={`${r.id}-${idx}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.02 }}
                        className="border-t border-[var(--border-subtle)] bg-white/[0.015] hover:bg-white/[0.04]"
                      >
                        <td className="px-3 py-2 font-mono text-[var(--text-primary)]">
                          {r.indicator_name}
                        </td>
                        <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">
                          {r.window}
                        </td>
                        <td
                          className={`px-3 py-2 font-mono ${cellTone("pearson", p)}`}
                        >
                          {p.toFixed(3)}
                        </td>
                        <td
                          className={`px-3 py-2 font-mono ${cellTone("spearman", sp)}`}
                        >
                          {sp.toFixed(3)}
                        </td>
                        <td
                          className={`px-3 py-2 font-mono ${cellTone("accuracy", acc)}`}
                        >
                          {(acc * 100).toFixed(1)}%
                        </td>
                        <td
                          className={`px-3 py-2 font-mono ${cellTone("sharpe", sh)}`}
                        >
                          {sh.toFixed(2)}
                        </td>
                        <td
                          className={`px-3 py-2 font-mono ${cellTone("max_dd", dd)}`}
                        >
                          {(dd * 100).toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 font-mono text-[var(--text-primary)]">
                          {r.total_signals ?? "—"}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}
