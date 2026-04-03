import { GlassCard } from "./GlassCard";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";
import type { Quote, Fundamentals } from "@/api/types";
import { toNumber } from "@/lib/format";

interface SpotPanelProps {
  quote: Quote | null | undefined;
  fundamentals: Fundamentals | null | undefined;
  loading?: boolean;
}

function fmt(v: number | null | undefined, opts?: { decimals?: number; prefix?: string; suffix?: string; compact?: boolean }): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const { decimals = 2, prefix = "", suffix = "", compact = false } = opts ?? {};
  if (compact) {
    if (Math.abs(v) >= 1e12) return `${prefix}${(v / 1e12).toFixed(decimals)}T${suffix}`;
    if (Math.abs(v) >= 1e9) return `${prefix}${(v / 1e9).toFixed(decimals)}B${suffix}`;
    if (Math.abs(v) >= 1e6) return `${prefix}${(v / 1e6).toFixed(decimals)}M${suffix}`;
  }
  return `${prefix}${v.toFixed(decimals)}${suffix}`;
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function FundRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
        {label}
      </span>
      <span className="font-mono text-xs tabular-nums text-[var(--text-primary)]">
        {value}
      </span>
    </div>
  );
}

export function SpotPanel({ quote, fundamentals, loading }: SpotPanelProps) {
  const last = quote ? toNumber(quote.last_price) : 0;
  const chg = quote ? toNumber(quote.change_rate) * 100 : 0;
  const animatedPrice = useAnimatedNumber(last, 600);

  if (loading) {
    return (
      <div className="col-span-1 md:col-span-2 h-48 animate-pulse rounded-xl bg-white/[0.04]" />
    );
  }

  const priceDisplay = animatedPrice.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });

  const f = fundamentals;

  return (
    <GlassCard glowColor="cyan" className="col-span-1 md:col-span-2 p-5">
      <div className="grid grid-cols-[1fr_1px_1fr] gap-5">
        {/* Left: price */}
        <div className="flex flex-col justify-between">
          <div>
            <p className="font-heading text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
              TSLA spot
            </p>
            <p className="font-mono mt-1 text-4xl font-semibold tabular-nums tracking-tight text-[var(--text-primary)] md:text-5xl">
              <span className="text-[var(--cyan)] opacity-80">$</span>
              {priceDisplay}
            </p>
            <p
              className={`font-mono mt-1 text-sm tabular-nums ${
                chg >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"
              }`}
            >
              {chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%
            </p>
          </div>
          <div className="mt-3 flex gap-4">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Open</span>
              <p className="font-mono text-xs tabular-nums text-[var(--text-primary)]">
                {quote ? fmt(toNumber(quote.open), { prefix: "$" }) : "—"}
              </p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">High</span>
              <p className="font-mono text-xs tabular-nums text-[var(--text-primary)]">
                {quote ? fmt(toNumber(quote.high), { prefix: "$" }) : "—"}
              </p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Low</span>
              <p className="font-mono text-xs tabular-nums text-[var(--text-primary)]">
                {quote ? fmt(toNumber(quote.low), { prefix: "$" }) : "—"}
              </p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Vol</span>
              <p className="font-mono text-xs tabular-nums text-[var(--text-primary)]">
                {quote?.volume != null ? fmt(quote.volume, { compact: true, decimals: 1 }) : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="bg-[var(--border-subtle)]" />

        {/* Right: fundamentals */}
        <div className="space-y-2">
          <p className="font-heading text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)] mb-2.5">
            Fundamentals
          </p>
          <FundRow label="Mkt Cap" value={f ? fmt(f.market_cap, { prefix: "$", compact: true, decimals: 1 }) : "—"} />
          <FundRow label="EPS" value={f ? fmt(f.eps, { prefix: "$" }) : "—"} />
          <FundRow label="P/E" value={f?.pe_ratio != null ? toNumber(f.pe_ratio).toFixed(1) : "—"} />
          <FundRow label="Fwd P/E" value={f?.forward_pe != null ? toNumber(f.forward_pe).toFixed(1) : "—"} />
          <FundRow label="ROE" value={f ? pct(f.roe) : "—"} />
          <FundRow label="52w H / L" value={
            f?.fifty_two_week_high != null && f?.fifty_two_week_low != null
              ? `$${toNumber(f.fifty_two_week_high).toFixed(0)} / $${toNumber(f.fifty_two_week_low).toFixed(0)}`
              : "—"
          } />
          <FundRow label="Beta" value={f?.beta != null ? toNumber(f.beta).toFixed(2) : "—"} />
        </div>
      </div>
    </GlassCard>
  );
}
