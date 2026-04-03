import type { Topic } from "@/api/types";
import { formatRelativeTime, toNumber } from "@/lib/format";

export interface TopicCardProps {
  topic: Topic;
  score?: number | string | null;
  label?: string | null;
}

function sentimentBorder(score?: number | string | null, label?: string | null): string {
  if (label) {
    const l = label.toLowerCase();
    if (l.includes("bull") || l.includes("pos")) {
      return "border-l-[var(--green)]";
    }
    if (l.includes("bear") || l.includes("neg")) {
      return "border-l-[var(--red)]";
    }
  }
  if (score !== undefined && score !== null) {
    const n = toNumber(score);
    if (n > 0.05) {
      return "border-l-[var(--green)]";
    }
    if (n < -0.05) {
      return "border-l-[var(--red)]";
    }
  }
  return "border-l-[var(--text-secondary)]";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max - 1)}…`;
}

export function TopicCard({ topic, score, label }: TopicCardProps) {
  const border = sentimentBorder(score, label);
  const desc = topic.description ?? "";

  return (
    <article
      className={`glass-card border-l-4 ${border} p-4 transition-colors hover:border-[var(--cyan)]/40`}
    >
      <h3 className="font-heading text-sm font-semibold leading-snug text-[var(--text-primary)]">
        {topic.title}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        {truncate(desc, 220)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-secondary)]">
        <span className="font-mono text-[var(--cyan)]/90">{formatRelativeTime(topic.published_at)}</span>
        {topic.comments_count != null && (
          <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5">
            💬 {topic.comments_count}
          </span>
        )}
        {topic.likes_count != null && (
          <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5">
            ♥ {topic.likes_count}
          </span>
        )}
        {topic.shares_count != null && (
          <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5">
            ↗ {topic.shares_count}
          </span>
        )}
      </div>
    </article>
  );
}
