import type { Tweet } from "@/api/types";
import { formatRelativeTime, toNumber } from "@/lib/format";

export interface TweetCardProps {
  tweet: Tweet;
  sentimentScore?: number | string | null;
  sentimentLabel?: string | null;
}

function sentimentPill(score?: number | string | null, label?: string | null): {
  text: string;
  className: string;
} {
  if (label) {
    const l = label.toLowerCase();
    if (l.includes("bull") || l.includes("pos")) {
      return { text: label, className: "bg-[var(--green)]/15 text-[var(--green)] border-[var(--green)]/35" };
    }
    if (l.includes("bear") || l.includes("neg")) {
      return { text: label, className: "bg-[var(--red)]/15 text-[var(--red)] border-[var(--red)]/35" };
    }
    return { text: label, className: "bg-white/5 text-[var(--text-secondary)] border-[var(--border-subtle)]" };
  }
  if (score !== undefined && score !== null) {
    const n = toNumber(score);
    if (n > 0.1) {
      return { text: "Bullish", className: "bg-[var(--green)]/15 text-[var(--green)] border-[var(--green)]/35" };
    }
    if (n < -0.1) {
      return { text: "Bearish", className: "bg-[var(--red)]/15 text-[var(--red)] border-[var(--red)]/35" };
    }
  }
  return { text: "Neutral", className: "bg-white/5 text-[var(--text-secondary)] border-[var(--border-subtle)]" };
}

export function TweetCard({ tweet, sentimentScore, sentimentLabel }: TweetCardProps) {
  const pill = sentimentPill(sentimentScore, sentimentLabel);

  return (
    <article className="glass-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-heading text-sm font-semibold text-[var(--cyan)]">
          @{tweet.username}
        </span>
        <span className="font-mono text-[11px] text-[var(--text-secondary)]">
          {formatRelativeTime(tweet.published_at)}
        </span>
        {tweet.is_tesla_related && (
          <span className="rounded-full border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--amber)]">
            Tesla
          </span>
        )}
        <span
          className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${pill.className}`}
        >
          {pill.text}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-primary)]">{tweet.text}</p>
      <div className="mt-3 flex flex-wrap gap-4 font-mono text-[11px] text-[var(--text-secondary)]">
        <span>♥ {tweet.likes_count ?? "—"}</span>
        <span>↻ {tweet.retweets_count ?? "—"}</span>
        <span>⌘ {tweet.replies_count ?? "—"}</span>
      </div>
    </article>
  );
}
