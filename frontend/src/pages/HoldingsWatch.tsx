import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { fetchAckmanOverview } from "@/api/ackman";
import { fetchArkOverview } from "@/api/ark";
import { fetchBerkshireOverview } from "@/api/brk";
import { fetchDuquesneOverview } from "@/api/duquesne";
import { fetchHhOverview } from "@/api/hh";
import { fetchPelosiOverview } from "@/api/pelosi";
import type { ArkHolding, ArkTrade } from "@/api/types";

const REFRESH_MS = 900_000;
type Profile = "brk" | "ark" | "hh" | "pelosi" | "duquesne" | "ackman";
type ProfileMode = "quarterly" | "etf" | "allocation";

const PROFILES: Array<{
  id: Profile;
  label: string;
  mode: ProfileMode;
  queryFn: () => ReturnType<typeof fetchArkOverview>;
}> = [
  { id: "brk", label: "Berkshire 13F", mode: "quarterly", queryFn: fetchBerkshireOverview },
  { id: "ark", label: "ARK Daily", mode: "etf", queryFn: fetchArkOverview },
  { id: "hh", label: "Duan H&H", mode: "quarterly", queryFn: fetchHhOverview },
  { id: "pelosi", label: "Paul Pelosi", mode: "allocation", queryFn: fetchPelosiOverview },
  { id: "duquesne", label: "Druckenmiller", mode: "quarterly", queryFn: fetchDuquesneOverview },
  { id: "ackman", label: "Ackman", mode: "quarterly", queryFn: fetchAckmanOverview },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

const block = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function sideColor(direction: string): string {
  const lower = direction.toLowerCase();
  if (lower.startsWith("buy") || lower === "add" || lower === "new") return "text-[var(--green)]";
  if (lower.startsWith("sell") || lower === "reduce" || lower === "sold") return "text-[var(--red)]";
  return "text-[var(--text-secondary)]";
}

function formatTickerName(ticker: string, companyName?: string | null): string {
  return companyName ? `${ticker} (${companyName})` : ticker;
}

function StatTile({
  label,
  value,
  sub,
  tone = "text-[var(--text-primary)]",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">
        {label}
      </div>
      <div className={`mt-1 font-heading text-xl ${tone}`}>{value}</div>
      <div className="mt-1 font-mono text-[10px] text-[var(--text-secondary)]">
        {sub}
      </div>
    </div>
  );
}

function HoldingBar({ holding, maxWeight }: { holding: ArkHolding; maxWeight: number }) {
  const width = maxWeight > 0 && holding.weight ? (holding.weight / maxWeight) * 100 : 0;
  return (
    <div className="grid grid-cols-[52px_1fr_76px] items-center gap-3 border-b border-white/[0.04] py-2 last:border-0">
      <span className="font-mono text-xs text-[var(--text-primary)]">{holding.ticker}</span>
      <div className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="truncate text-xs text-[var(--text-secondary)]">
            {holding.company_name}
          </span>
          <span className="font-mono text-[11px] text-[var(--text-primary)]">
            {formatPercent(holding.weight)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-white/[0.05]">
          <div
            className="h-full rounded bg-[var(--cyan)]/75"
            style={{ width: `${Math.max(width, 2)}%` }}
          />
        </div>
      </div>
      <span className="text-right font-mono text-xs text-[var(--text-primary)]">
        {holding.market_value_label}
      </span>
    </div>
  );
}

function TradeRow({
  trade,
  companyName,
}: {
  trade: ArkTrade;
  companyName?: string | null;
}) {
  const tickerName = formatTickerName(trade.ticker, companyName ?? trade.company_name);

  return (
    <tr className="border-b border-white/[0.04] last:border-0">
      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)]">
        {trade.date}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-[var(--text-primary)]">{trade.fund}</td>
      <td className="max-w-[260px] px-3 py-2 font-heading text-sm text-[var(--text-primary)]">
        <span className="group relative inline-block max-w-full align-middle">
          <span className="block max-w-full truncate">{tickerName}</span>
          <span className="pointer-events-none invisible absolute left-0 top-6 z-50 whitespace-nowrap rounded-md border border-white/[0.1] bg-[#111118] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)] opacity-0 shadow-xl transition-opacity group-hover:visible group-hover:opacity-100">
            {tickerName}
          </span>
        </span>
      </td>
      <td className={`px-3 py-2 font-mono text-xs ${sideColor(trade.direction)}`}>
        {trade.direction}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-[var(--text-primary)]">
        {trade.market_value_label}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-[var(--text-primary)]">
        {formatPercent(trade.percent_of_etf)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-[var(--text-primary)]">
        {formatPercent(trade.percent_of_position)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-[var(--text-secondary)]">
        {formatPercent(trade.current_combined_weight)}
      </td>
    </tr>
  );
}

export function HoldingsWatch() {
  const [profile, setProfile] = useState<Profile>("brk");
  const [showLedgerHelp, setShowLedgerHelp] = useState(false);
  const overviewQueries = useQueries({
    queries: PROFILES.map((item) => ({
      queryKey: ["holdings-watch", item.id],
      queryFn: item.queryFn,
      refetchInterval: REFRESH_MS,
      staleTime: REFRESH_MS,
      gcTime: REFRESH_MS * 4,
    })),
  });
  const profileIndex = PROFILES.findIndex((item) => item.id === profile);
  const profileConfig = PROFILES[profileIndex >= 0 ? profileIndex : 0]!;
  const overviewQ = overviewQueries[profileIndex >= 0 ? profileIndex : 0]!;

  const overview = overviewQ.data;
  const holdings = overview?.holdings.items ?? [];
  const trades = overview?.trades.items ?? [];
  const companyByTicker = useMemo(
    () =>
      new Map(
        holdings.map((holding) => [holding.ticker.toUpperCase(), holding.company_name]),
      ),
    [holdings],
  );

  const latestTrades = useMemo(() => {
    const latestDate = overview?.trades.latest_date;
    return latestDate ? trades.filter((trade) => trade.date === latestDate) : trades.slice(0, 12);
  }, [overview?.trades.latest_date, trades]);

  const buyRank = useMemo(
    () =>
      trades
        .filter((trade) => {
          const direction = trade.direction.toLowerCase();
          return direction.startsWith("buy") || direction === "add" || direction === "new";
        })
        .sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0))
        .slice(0, 8),
    [trades],
  );

  const sellRank = useMemo(
    () =>
      trades
        .filter((trade) => {
          const direction = trade.direction.toLowerCase();
          return direction.startsWith("sell") || direction === "reduce" || direction === "sold";
        })
        .sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0))
        .slice(0, 8),
    [trades],
  );

  const maxWeight = holdings[0]?.weight ?? 0;
  const isQuarterly = profileConfig.mode === "quarterly";
  const isAllocation = profileConfig.mode === "allocation";
  const distributionDate =
    overview?.filing_date ?? overview?.report_date ?? overview?.trades.latest_date ?? null;

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="mx-auto max-w-[1500px] space-y-6 pb-20"
    >
      <motion.header variants={block} className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-[var(--text-primary)] md:text-3xl">
            The Big Whale Watch
          </h1>
          <p className="mt-1 font-mono text-xs text-[var(--text-secondary)]">
            {overview?.manager ?? "Berkshire Hathaway"} · {overview?.vehicle ?? "13F Equity Portfolio"} ·{" "}
            {isQuarterly
              ? `quarterly 13F${overview?.report_date ? ` · ${overview.report_date}` : ""}`
              : `${isAllocation ? "allocation tracker" : "15m refresh"}${overview?.report_date ? ` · ${overview.report_date}` : ""}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PROFILES.map((item, index) => (
            <button
              key={item.id}
              onClick={() => {
                setProfile(item.id);
              }}
              className={`rounded-md border px-3 py-2 font-mono text-xs transition-colors ${
                item.id === profile
                  ? "border-[var(--cyan)]/50 bg-[var(--cyan)]/10 text-[var(--cyan)]"
                  : "border-white/[0.08] bg-white/[0.03] text-[var(--text-secondary)]"
              }`}
              type="button"
            >
              {item.label}
              {overviewQueries[index]?.isFetching ? (
                <span className="ml-2 text-[var(--amber)]">sync</span>
              ) : null}
            </button>
          ))}
        </div>
      </motion.header>

      {overviewQ.isLoading ? (
        <div className="h-[620px] animate-pulse rounded-xl bg-white/[0.04]" />
      ) : overviewQ.isError ? (
        <div className="glass-card flex h-[420px] items-center justify-center font-mono text-sm text-[var(--text-secondary)]">
          Holdings feed unavailable
        </div>
      ) : overview ? (
        <>
          <motion.section variants={block} className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <StatTile
              label="AUM tracked"
              value={formatMoney(overview.holdings.total_market_value)}
              sub={`${overview.holdings.holdings_count} holdings`}
              tone="text-[var(--cyan)]"
            />
            <StatTile
              label="Top 10"
              value={formatPercent(overview.holdings.top_10_weight)}
              sub="combined weight"
              tone="text-[var(--amber)]"
            />
            <StatTile
              label="Buy flow"
              value={formatMoney(overview.trades.total_buy_value)}
              sub={`${overview.trades.buy_count} ${isQuarterly ? "adds/new" : isAllocation ? "allocation adds" : "recent trades"}`}
              tone="text-[var(--green)]"
            />
            <StatTile
              label="Sell flow"
              value={formatMoney(overview.trades.total_sell_value)}
              sub={`${overview.trades.sell_count} ${isQuarterly ? "reduces/sold" : isAllocation ? "allocation cuts" : "recent trades"}`}
              tone="text-[var(--red)]"
            />
            <StatTile
              label="Net flow"
              value={formatMoney(overview.trades.net_value)}
              sub={isQuarterly || isAllocation ? "value delta est." : overview.trades.latest_date ?? "-"}
              tone="text-[var(--text-primary)]"
            />
            <StatTile
              label="Largest"
              value={holdings[0]?.ticker ?? "-"}
              sub={formatPercent(holdings[0]?.weight)}
              tone="text-[var(--text-primary)]"
            />
          </motion.section>

          <motion.section variants={block} className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="glass-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-heading text-xs font-semibold uppercase tracking-[0.25em] text-[var(--text-secondary)]">
                  Position distribution
                </h2>
                <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--text-secondary)]">
                  {distributionDate ? <span>published {distributionDate}</span> : null}
                  <span>top 20</span>
                </div>
              </div>
              <div className="grid gap-x-6 lg:grid-cols-2">
                {holdings.slice(0, 20).map((holding) => (
                  <HoldingBar key={holding.ticker} holding={holding} maxWeight={maxWeight} />
                ))}
              </div>
            </div>

            <div className="glass-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-heading text-xs font-semibold uppercase tracking-[0.25em] text-[var(--text-secondary)]">
                  Latest flow
                </h2>
                {overviewQ.isFetching ? (
                  <span className="font-mono text-[10px] text-[var(--amber)]">syncing...</span>
                ) : null}
              </div>
              <div className="space-y-2">
                {latestTrades.slice(0, 10).map((trade, idx) => (
                  <div
                    key={`${trade.date}-${trade.fund}-${trade.ticker}-${idx}`}
                    className="grid grid-cols-[52px_1fr_78px_70px] items-center gap-3 rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2"
                  >
                    <span className="font-mono text-xs text-[var(--text-primary)]">
                      {trade.fund}
                    </span>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-heading text-sm text-[var(--text-primary)]">
                          {formatTickerName(
                            trade.ticker,
                            trade.company_name ?? companyByTicker.get(trade.ticker.toUpperCase()),
                          )}
                        </span>
                        <span className={`shrink-0 font-mono text-[10px] ${sideColor(trade.direction)}`}>
                          {trade.direction}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-[var(--text-secondary)]">
                        {isQuarterly || isAllocation ? "Weight" : "ETF"} {formatPercent(trade.percent_of_etf)} · {isAllocation ? "Alloc Chg" : "Position"} {formatPercent(trade.percent_of_position)}
                      </div>
                    </div>
                    <span className="text-right font-mono text-xs text-[var(--text-primary)]">
                      {trade.market_value_label}
                    </span>
                    <span className="text-right font-mono text-[11px] text-[var(--text-secondary)]">
                      {formatPercent(trade.current_combined_weight)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.section>

          <motion.section variants={block} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {[
              [isQuarterly ? "Top adds/new" : "Top buys", buyRank],
              [isQuarterly ? "Top reduces/sold" : "Top sells", sellRank],
            ].map(([title, rows]) => (
              <div key={title as string} className="glass-card p-4">
                <h2 className="font-heading mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-[var(--text-secondary)]">
                  {title as string}
                </h2>
                <div className="space-y-2">
                  {(rows as ArkTrade[]).map((trade, idx) => (
                    <div
                      key={`${trade.date}-${trade.fund}-${trade.ticker}-${idx}`}
                      className="grid grid-cols-[46px_54px_1fr_82px_82px] items-center gap-3 border-b border-white/[0.04] py-2 last:border-0"
                    >
                      <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                        #{idx + 1}
                      </span>
                      <span className="font-mono text-xs text-[var(--text-primary)]">
                        {trade.fund}
                      </span>
                      <span className="min-w-0 truncate font-heading text-sm text-[var(--text-primary)]">
                        {formatTickerName(
                          trade.ticker,
                          trade.company_name ?? companyByTicker.get(trade.ticker.toUpperCase()),
                        )}
                      </span>
                      <span className="text-right font-mono text-xs text-[var(--text-primary)]">
                        {trade.market_value_label}
                      </span>
                      <span className="text-right font-mono text-[11px] text-[var(--text-secondary)]">
                        {formatPercent(trade.percent_of_position)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </motion.section>

          <motion.section variants={block} className="glass-card overflow-hidden p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="relative flex items-center gap-2">
                <h2 className="font-heading text-xs font-semibold uppercase tracking-[0.25em] text-[var(--text-secondary)]">
                  Trade ledger
                </h2>
                <button
                  type="button"
                  aria-expanded={showLedgerHelp}
                  aria-label="Explain ledger columns"
                  onClick={() => setShowLedgerHelp((open) => !open)}
                  className="flex h-5 w-5 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.04] font-mono text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--cyan)]/50 hover:text-[var(--cyan)]"
                >
                  !
                </button>
                {showLedgerHelp ? (
                  <div className="absolute left-0 top-7 z-20 w-[min(520px,calc(100vw-64px))] rounded-lg border border-white/[0.08] bg-[#111118] p-4 shadow-2xl">
                    <div className="font-heading text-sm text-[var(--text-primary)]">
                      Column notes
                    </div>
                    <div className="mt-3 space-y-2 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
                      {isQuarterly ? (
                        <>
                          <p>
                            Weight is the holding's current percentage of the manager's latest
                            disclosed 13F portfolio.
                          </p>
                          <p>
                            Share Chg is the share-count change versus the previous 13F
                            quarter. ADD/REDUCE use the reported share count, not exact
                            trade dates.
                          </p>
                          <p>
                            Value Delta is an estimate based on quarter-end disclosed
                            values, so it is not actual cash spent or received.
                          </p>
                        </>
                      ) : isAllocation ? (
                        <>
                          <p>
                            Weight is the position's current allocation in the public
                            Pelosi Tracker portfolio view.
                          </p>
                          <p>
                            Share Chg is shown as allocation-point change from the tracker
                            history, not reported share-count change.
                          </p>
                          <p>
                            Value Delta is estimated from current tracked total invested
                            value and the allocation-point change.
                          </p>
                        </>
                      ) : (
                        <>
                          <p>
                            % ETF is the trade amount as a percentage of that ARK ETF.
                          </p>
                          <p>
                            % Position is the trade amount compared with ARK's previous
                            position in that ticker.
                          </p>
                          <p>
                            Now Weight is the ticker's current weight in the combined
                            ARK holdings view.
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              <span className="font-mono text-[10px] text-[var(--text-secondary)]">
                {overview.trades.source}
              </span>
            </div>
            <div className="overflow-auto rounded-lg border border-white/[0.06]">
              <table className="w-full min-w-[900px]">
                <thead className="bg-white/[0.03]">
                  <tr className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">{isQuarterly ? "Form" : isAllocation ? "Source" : "Fund"}</th>
                    <th className="px-3 py-2 text-left font-medium">Ticker</th>
                    <th className="px-3 py-2 text-left font-medium">{isQuarterly || isAllocation ? "Activity" : "Side"}</th>
                    <th className="px-3 py-2 text-right font-medium">{isQuarterly || isAllocation ? "Value Delta" : "Amount"}</th>
                    <th className="px-3 py-2 text-right font-medium">{isQuarterly || isAllocation ? "Weight" : "% ETF"}</th>
                    <th className="px-3 py-2 text-right font-medium">{isQuarterly ? "Share Chg %" : isAllocation ? "Alloc Chg" : "% Position"}</th>
                    <th className="px-3 py-2 text-right font-medium">Now Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, 60).map((trade, idx) => (
                    <TradeRow
                      key={`${trade.date}-${trade.fund}-${trade.ticker}-${idx}`}
                      trade={trade}
                      companyName={companyByTicker.get(trade.ticker.toUpperCase())}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </motion.section>
        </>
      ) : null}
    </motion.div>
  );
}
