import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchTaxReport } from "@/api/tax";
import type { TaxCostTraceMatch, TaxCostTraceSale, TaxScheme } from "@/api/types";
import { toNumber } from "@/lib/format";

type Lang = "en" | "zh";

const copy = {
  en: {
    back: "Back",
    title: "Cost trace",
    subtitle:
      "Trace every sale back to matched buy lots. Keep this as an audit trail for the selected tax calculation method.",
    loading: "Loading cost trace...",
    missing: "No cost trace found for this scheme.",
    method: "Method",
    year: "Year",
    filingMonth: "Filing month",
    sales: "Sales",
    taxDue: "Tax due",
    sale: "Sale",
    sellTime: "Sell time",
    sellOrder: "Sell order",
    sellTrade: "Sell trade",
    sellPrice: "Sell price",
    sellQty: "Sell qty",
    matchedQty: "Matched qty",
    unmatchedQty: "Unmatched qty",
    proceeds: "Proceeds CNY",
    cost: "Cost CNY",
    gain: "Gain CNY",
    buyTime: "Buy time",
    buyOrder: "Buy order",
    buyTrade: "Buy trade",
    buyPrice: "Buy price",
    buyQty: "Matched buy qty",
    unitCost: "Unit cost CNY",
    matchedCost: "Matched cost CNY",
    buyFee: "Buy fee CNY",
  },
  zh: {
    back: "返回",
    title: "成本追踪明细",
    subtitle: "逐笔回溯卖出交易匹配了哪些买入批次，可作为所选税务计算方法的留档核对材料。",
    loading: "正在加载成本追踪...",
    missing: "该方案暂无成本追踪明细。",
    method: "成本方法",
    year: "年度",
    filingMonth: "申报月份",
    sales: "卖出笔数",
    taxDue: "应补税额",
    sale: "卖出",
    sellTime: "卖出时间",
    sellOrder: "卖出订单",
    sellTrade: "卖出成交",
    sellPrice: "卖出价",
    sellQty: "卖出数量",
    matchedQty: "匹配数量",
    unmatchedQty: "未匹配数量",
    proceeds: "卖出收入 CNY",
    cost: "成本 CNY",
    gain: "收益 CNY",
    buyTime: "买入时间",
    buyOrder: "买入订单",
    buyTrade: "买入成交",
    buyPrice: "买入价",
    buyQty: "匹配买入数量",
    unitCost: "单位成本 CNY",
    matchedCost: "匹配成本 CNY",
    buyFee: "买入费用 CNY",
  },
} satisfies Record<Lang, Record<string, string>>;

function money(v: number | string | null | undefined): string {
  return `¥${toNumber(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function methodLabel(method: string, lang: Lang): string {
  if (method === "fifo") return "FIFO";
  if (method === "weighted_average") return lang === "zh" ? "移动加权" : "Weighted avg";
  if (method === "highest_cost") return lang === "zh" ? "高成本优先" : "High cost";
  return method;
}

function lossLabel(policy: string, lang: Lang): string {
  if (policy === "per_sale") return lang === "zh" ? "逐笔" : "Per sale";
  if (policy === "symbol_net") return lang === "zh" ? "同标的净额" : "Symbol net";
  if (policy === "portfolio_net") return lang === "zh" ? "组合净额" : "Portfolio net";
  return policy;
}

export function CrsTaxCostTrace() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const year = Number(params.get("year") ?? new Date().getFullYear() - 1);
  const filingMonth = Number(params.get("filing_month") ?? 6);
  const schemeKey = params.get("scheme_key") ?? "highest_cost:per_sale";
  const lang: Lang = params.get("lang") === "en" ? "en" : "zh";
  const t = copy[lang];

  const reportQuery = useQuery({
    queryKey: ["tax-report", year, filingMonth],
    queryFn: () => fetchTaxReport(year, filingMonth),
  });

  const scheme = reportQuery.data?.schemes.find((item) => item.scheme_key === schemeKey) ?? null;
  const trace = scheme?.cost_trace ?? [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto max-w-[1280px] space-y-6 pb-12">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <button
            type="button"
            onClick={() => navigate(`/crs-tax?year=${year}&filing_month=${filingMonth}`)}
            className="mb-4 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:border-white/[0.16]"
          >
            {t.back}
          </button>
          <h1 className="font-heading text-2xl font-semibold text-[var(--text-primary)]">{t.title}</h1>
          <p className="mt-2 max-w-3xl font-mono text-xs leading-5 text-[var(--text-secondary)]">{t.subtitle}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <MiniStat label={t.year} value={String(year)} />
        <MiniStat label={t.filingMonth} value={String(filingMonth)} />
        <MiniStat label={t.method} value={scheme ? `${methodLabel(scheme.cost_method, lang)} · ${lossLabel(scheme.loss_policy, lang)}` : schemeKey} />
        <MiniStat label={t.sales} value={String(trace.length || scheme?.sale_count || 0)} />
        <MiniStat label={t.taxDue} value={money(scheme?.tax_due_cny)} />
      </section>

      <section className="glass-card overflow-hidden">
        {reportQuery.isLoading && <p className="p-4 font-mono text-xs text-[var(--text-secondary)]">{t.loading}</p>}
        {!reportQuery.isLoading && !trace.length && (
          <p className="p-4 font-mono text-xs text-[var(--text-secondary)]">{t.missing}</p>
        )}
        {!!trace.length && (
          <div className="divide-y divide-white/[0.06]">
            {trace.map((sale) => (
              <SaleTrace key={`${sale.index}-${sale.symbol}-${sale.sell_time}`} sale={sale} scheme={scheme} lang={lang} />
            ))}
          </div>
        )}
      </section>
    </motion.div>
  );
}

function SaleTrace({ sale, scheme, lang }: { sale: TaxCostTraceSale; scheme: TaxScheme | null; lang: Lang }) {
  const t = copy[lang];
  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-3 font-mono text-xs md:grid-cols-4 lg:grid-cols-8">
        <MiniStat label={t.sale} value={`${sale.index} · ${sale.symbol}`} />
        <MiniStat label={t.sellTime} value={dateOnly(sale.sell_time)} />
        <MiniStat label={t.sellOrder} value={sale.sell_order_id} />
        <MiniStat label={t.sellTrade} value={sale.sell_trade_id} />
        <MiniStat label={t.sellPrice} value={`${sale.sell_price} ${sale.currency}`} />
        <MiniStat label={t.sellQty} value={String(sale.sell_quantity)} />
        <MiniStat label={t.matchedQty} value={String(sale.matched_quantity)} />
        <MiniStat label={t.gain} value={money(sale.gain_cny)} />
      </div>
      <div className="grid grid-cols-2 gap-3 font-mono text-xs md:grid-cols-4">
        <MiniStat label={t.unmatchedQty} value={String(sale.unmatched_quantity)} />
        <MiniStat label={t.proceeds} value={money(sale.proceeds_cny)} />
        <MiniStat label={t.cost} value={money(sale.cost_cny)} />
        <MiniStat label={t.taxDue} value={scheme ? money(scheme.tax_due_cny) : "—"} />
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[1680px] text-left font-mono text-xs">
          <thead className="text-[var(--text-secondary)]">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">{t.sellTime}</th>
              <th className="px-3 py-2 font-medium">{t.sellOrder}</th>
              <th className="px-3 py-2 font-medium">{t.sellTrade}</th>
              <th className="px-3 py-2 font-medium">{t.sellPrice}</th>
              <th className="px-3 py-2 font-medium text-right">{t.sellQty}</th>
              <th className="px-3 py-2 font-medium">{t.buyTime}</th>
              <th className="px-3 py-2 font-medium">{t.buyOrder}</th>
              <th className="px-3 py-2 font-medium">{t.buyTrade}</th>
              <th className="px-3 py-2 font-medium">{t.buyPrice}</th>
              <th className="px-3 py-2 font-medium text-right">{t.buyQty}</th>
              <th className="px-3 py-2 font-medium text-right">{t.unitCost}</th>
              <th className="px-3 py-2 font-medium text-right">{t.matchedCost}</th>
              <th className="px-3 py-2 font-medium text-right">{t.buyFee}</th>
            </tr>
          </thead>
          <tbody>
            {sale.matches.map((match, index) => (
              <MatchRow key={`${match.buy_trade_id}-${index}`} index={index + 1} sale={sale} match={match} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchRow({ index, sale, match }: { index: number; sale: TaxCostTraceSale; match: TaxCostTraceMatch }) {
  return (
    <tr className="border-t border-white/[0.04]">
      <td className="px-3 py-2 text-[var(--text-primary)]">{index}</td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">{dateOnly(sale.sell_time)}</td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">{sale.sell_order_id}</td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">{sale.sell_trade_id}</td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">
        {sale.sell_price} {sale.currency}
      </td>
      <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{match.matched_quantity}</td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">{dateOnly(match.buy_time)}</td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">{match.buy_order_id}</td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">{match.buy_trade_id}</td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">
        {match.buy_price} {match.buy_currency}
      </td>
      <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{match.matched_quantity}</td>
      <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{money(match.unit_cost_cny)}</td>
      <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{money(match.matched_cost_cny)}</td>
      <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{money(match.buy_fee_cny)}</td>
    </tr>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.03] p-3">
      <p className="font-heading text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">{label}</p>
      <p className="mt-2 truncate font-mono text-sm text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
