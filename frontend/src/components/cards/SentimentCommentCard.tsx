import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SentimentComment } from "@/api/types";
import { formatRelativeTime } from "@/lib/format";

export interface SentimentCommentCardProps {
  comment: SentimentComment;
}

const LABEL_CONFIG: Record<string, { text: string; color: string; bg: string }> = {
  positive: {
    text: "Positive",
    color: "text-[var(--green)]",
    bg: "bg-[var(--green)]/10 border-[var(--green)]/30",
  },
  negative: {
    text: "Negative",
    color: "text-[var(--red)]",
    bg: "bg-[var(--red)]/10 border-[var(--red)]/30",
  },
  neutral: {
    text: "Neutral",
    color: "text-[var(--text-secondary)]",
    bg: "bg-white/5 border-[var(--border-subtle)]",
  },
};

const SOURCE_ICON: Record<string, string> = {
  topic: "📝",
  topic_reply: "💬",
  tweet: "𝕏",
};

function scoreBorder(score: number): string {
  if (score > 0.3) return "border-l-[var(--green)]";
  if (score < -0.3) return "border-l-[var(--red)]";
  return "border-l-[var(--text-secondary)]";
}

function scoreBar(score: number): { width: string; color: string } {
  const pct = Math.round(((score + 1) / 2) * 100);
  if (score > 0.3) return { width: `${pct}%`, color: "var(--green)" };
  if (score < -0.3) return { width: `${pct}%`, color: "var(--red)" };
  return { width: `${pct}%`, color: "var(--text-secondary)" };
}

export function SentimentCommentCard({ comment }: SentimentCommentCardProps) {
  const [expanded, setExpanded] = useState(false);

  const cfg = LABEL_CONFIG[comment.label] ?? LABEL_CONFIG.neutral;
  const icon = SOURCE_ICON[comment.source_type] ?? "•";
  const border = scoreBorder(comment.score);
  const bar = scoreBar(comment.score);

  const previewText =
    comment.body.length > 80
      ? comment.body.slice(0, 80) + "…"
      : comment.body;

  return (
    <article
      className={`glass-card border-l-4 ${border} cursor-pointer select-none transition-all hover:border-[var(--cyan)]/40`}
      onClick={() => setExpanded((v) => !v)}
    >
      {/* Collapsed header — always visible */}
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 text-base leading-none">{icon}</span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading truncate text-sm font-semibold text-[var(--text-primary)]">
              {comment.title}
            </h3>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium ${cfg.bg} ${cfg.color}`}
            >
              {cfg.text}
            </span>
            <span className="font-mono text-[10px] text-[var(--text-secondary)]">
              {comment.score > 0 ? "+" : ""}
              {comment.score.toFixed(3)}
            </span>
          </div>

          {!expanded && (
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              {previewText}
            </p>
          )}
        </div>

        <svg
          className={`mt-1 h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-[var(--border-subtle)] px-4 pb-4 pt-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">
                {comment.body}
              </p>

              {/* Score bar */}
              <div className="mt-3 space-y-1">
                <div className="flex items-center justify-between font-mono text-[10px] text-[var(--text-secondary)]">
                  <span>-1.0 Bearish</span>
                  <span>Bullish +1.0</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: bar.width, backgroundColor: bar.color }}
                  />
                </div>
              </div>

              {/* Metadata row */}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-secondary)]">
                {comment.published_at && (
                  <span className="font-mono text-[var(--cyan)]/90">
                    {formatRelativeTime(comment.published_at)}
                  </span>
                )}
                {comment.author && (
                  <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5">
                    👤 {comment.author}
                  </span>
                )}
                {comment.likes_count > 0 && (
                  <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5">
                    ♥ {comment.likes_count}
                  </span>
                )}
                {comment.comments_count > 0 && (
                  <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5">
                    💬 {comment.comments_count}
                  </span>
                )}
                <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 uppercase">
                  {comment.source_type.replace("_", " ")}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}
