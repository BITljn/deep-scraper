import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchTaxReport } from "@/api/tax";
import type { TaxCostTraceMatch, TaxCostTraceSale, TaxReport, TaxScheme } from "@/api/types";
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
    generateReport: "Generate tax report",
    hideReport: "Hide tax report",
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
    generateReport: "生成报税表格",
    hideReport: "收起报税表格",
  },
} satisfies Record<Lang, Record<string, string>>;

function money(v: number | string | null | undefined): string {
  return `¥${toNumber(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function compactNumber(v: number | string | null | undefined): string {
  return toNumber(v).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
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
  const [showTaxReport, setShowTaxReport] = useState(false);

  const reportQuery = useQuery({
    queryKey: ["tax-report", year, filingMonth],
    queryFn: () => fetchTaxReport(year, filingMonth),
  });

  const scheme = reportQuery.data?.schemes.find((item) => item.scheme_key === schemeKey) ?? null;
  const trace = scheme?.cost_trace ?? [];
  const reportRows = useMemo(() => buildReportRows(trace), [trace]);

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
        <button
          type="button"
          onClick={() => setShowTaxReport((value) => !value)}
          className="inline-flex h-10 w-fit items-center justify-center rounded-md border border-[var(--cyan)]/40 bg-[var(--cyan)]/10 px-4 font-mono text-xs font-semibold text-[var(--cyan)] transition-colors hover:bg-[var(--cyan)]/16 disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:text-[var(--text-secondary)]"
          disabled={!scheme}
        >
          {showTaxReport ? t.hideReport : t.generateReport}
        </button>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <MiniStat label={t.year} value={String(year)} />
        <MiniStat label={t.filingMonth} value={String(filingMonth)} />
        <MiniStat label={t.method} value={scheme ? `${methodLabel(scheme.cost_method, lang)} · ${lossLabel(scheme.loss_policy, lang)}` : schemeKey} />
        <MiniStat label={t.sales} value={String(trace.length || scheme?.sale_count || 0)} />
        <MiniStat label={t.taxDue} value={money(scheme?.tax_due_cny)} />
      </section>

      {showTaxReport && reportQuery.data && scheme && (
        <ChinaUsTaxReport report={reportQuery.data} scheme={scheme} rows={reportRows} />
      )}

      <section className="glass-card overflow-hidden">
        {reportQuery.isLoading && <p className="p-4 font-mono text-xs text-[var(--text-secondary)]">{t.loading}</p>}
        {!reportQuery.isLoading && !trace.length && (
          <p className="p-4 font-mono text-xs text-[var(--text-secondary)]">{t.missing}</p>
        )}
        {!!trace.length && (
          <div className="divide-y divide-white/[0.06]">
            {trace.map((sale) => (
              <SaleTrace key={`${sale.index}-${sale.symbol}-${sale.sell_time}`} sale={sale} lang={lang} />
            ))}
          </div>
        )}
      </section>
    </motion.div>
  );
}

interface ReportRow {
  key: string;
  asset: string;
  acquiredDate: string;
  soldDate: string;
  quantity: number | string;
  proceedsCny: number;
  costCny: number;
  adjustmentCny: number;
  gainCny: number;
  term: "short" | "long";
  evidence: string;
}

function buildReportRows(trace: TaxCostTraceSale[]): ReportRow[] {
  return trace.flatMap((sale) =>
    sale.matches.map((match, index) => {
      const matchedCost = toNumber(match.matched_cost_cny);
      const saleMatchedQty = toNumber(sale.matched_quantity);
      const matchQty = toNumber(match.matched_quantity);
      const allocatedProceeds = saleMatchedQty ? (toNumber(sale.proceeds_cny) * matchQty) / saleMatchedQty : 0;
      const gain = allocatedProceeds - matchedCost;
      const acquiredDate = dateOnly(match.buy_time);
      const soldDate = dateOnly(sale.sell_time);
      return {
        key: `${sale.index}-${sale.sell_trade_id}-${match.buy_trade_id}-${index}`,
        asset: `${sale.symbol} 境外证券 · 数量 ${compactNumber(match.matched_quantity)}`,
        acquiredDate,
        soldDate,
        quantity: compactNumber(match.matched_quantity),
        proceedsCny: allocatedProceeds,
        costCny: matchedCost,
        adjustmentCny: 0,
        gainCny: gain,
        term: holdingTerm(acquiredDate, soldDate),
        evidence: `卖出成交 ${sale.sell_trade_id} / 买入成交 ${match.buy_trade_id}`,
      };
    }),
  );
}

function holdingTerm(acquiredDate: string, soldDate: string): "short" | "long" {
  const acquired = new Date(`${acquiredDate}T00:00:00`);
  const sold = new Date(`${soldDate}T00:00:00`);
  if (Number.isNaN(acquired.getTime()) || Number.isNaN(sold.getTime())) return "short";
  const days = (sold.getTime() - acquired.getTime()) / 86_400_000;
  return days > 365 ? "long" : "short";
}

function ChinaUsTaxReport({ report, scheme, rows }: { report: TaxReport; scheme: TaxScheme; rows: ReportRow[] }) {
  const totalProceeds = rows.reduce((sum, row) => sum + row.proceedsCny, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.costCny, 0);
  const totalGain = rows.reduce((sum, row) => sum + row.gainCny, 0);
  const shortRows = rows.filter((row) => row.term === "short");
  const longRows = rows.filter((row) => row.term === "long");
  const hasMissingData = report.status !== "complete" || report.missing_fx_rates.length > 0 || report.unmatched_cost_lots.length > 0;

  return (
    <section className="glass-card overflow-hidden border-[var(--cyan)]/20">
      <div className="border-b border-white/[0.08] bg-white/[0.025] p-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-sm border border-[var(--cyan)]/35 px-2 py-1 font-mono text-[10px] font-semibold text-[var(--cyan)]">
                Form 8949-style
              </span>
              <span className="font-mono text-[10px] uppercase text-[var(--text-secondary)]">
                Sales and Other Dispositions of Capital Assets / 中国境外证券财产转让所得底稿
              </span>
            </div>
            <h2 className="font-heading text-xl font-semibold text-[var(--text-primary)]">资本资产出售和其他处置明细表</h2>
            <p className="max-w-5xl text-sm leading-6 text-[var(--text-secondary)]">
              版式按 IRS Form 8949 的主结构生成：先区分短期和长期，再用 (a) 至 (h) 列列示资产描述、取得日期、处置日期、转让收入、成本基础、调整代码、调整金额和收益/亏损。中国个税不因持有期改变财产转让所得税率，本表保留短期/长期分区仅用于模拟美国表格格式和留档核对。
            </p>
          </div>
          <div className="grid min-w-[300px] grid-cols-2 gap-2">
            <FormField label="姓名" value="个人境外证券投资者" />
            <FormField label="纳税年度" value={String(report.year)} />
            <FormField label="纳税人识别号" value="留档不展示" />
            <FormField label="申报月份" value={`${report.filing_month} 月`} />
          </div>
        </div>
      </div>

      <div className="border-b border-white/[0.06] p-5">
        <div className="grid gap-3 md:grid-cols-4">
          <MiniStat label="逐笔明细行数" value={String(rows.length)} />
          <MiniStat label="明细转让收入" value={money(totalProceeds)} />
          <MiniStat label="明细财产原值" value={money(totalCost)} />
          <MiniStat label="明细所得/亏损" value={money(totalGain)} />
        </div>
      </div>

      <div className="space-y-5 p-5">
        <Form8949Part
          title="Part I 短期交易"
          subtitle="持有 1 年或以下的资本资产交易。中国申报口径下仅用于模拟 Form 8949 分类，不改变 20% 财产转让所得税率。"
          checkboxRows={[
            ["A", "已由券商税表报告，且成本基础已报告给税务机关", false],
            ["B", "已由券商税表报告，但成本基础未报告给税务机关", false],
            ["C", "未收到美国 Form 1099-B/1099-DA；使用券商流水和自有记录生成", true],
          ]}
          rows={shortRows}
        />
        <Form8949Part
          title="Part II 长期交易"
          subtitle="持有超过 1 年的资本资产交易。该分区用于保留 IRS Form 8949 的 Part II 结构。"
          checkboxRows={[
            ["D", "已由券商税表报告，且成本基础已报告给税务机关", false],
            ["E", "已由券商税表报告，但成本基础未报告给税务机关", false],
            ["F", "未收到美国 Form 1099-B/1099-DA；使用券商流水和自有记录生成", true],
          ]}
          rows={longRows}
        />
      </div>

      <div className="grid gap-4 border-t border-white/[0.06] p-5 lg:grid-cols-[0.92fr_1.08fr]">
        <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="font-heading text-sm font-semibold text-[var(--text-primary)]">Schedule D 风格年度汇总</h3>
          <div className="mt-3 space-y-2">
            <ReportSplit label="状态" value={hasMissingData ? "需复核" : "数据完整"} accent={hasMissingData ? "amber" : "green"} />
            <ReportSplit label="成本方法" value={`${methodLabel(scheme.cost_method, "zh")} · ${lossLabel(scheme.loss_policy, "zh")}`} />
            <ReportSplit label="税法汇率日期" value={report.tax_fx_rate_date} />
            <ReportSplit label="卖出收入" value={money(scheme.capital_proceeds_cny)} />
            <ReportSplit label="成本及买入费用" value={money(scheme.capital_cost_cny)} />
            <ReportSplit label="资本应税收益" value={money(scheme.capital_taxable_gain_cny)} />
            <ReportSplit label="资本税额 20%" value={money(scheme.capital_tax_cny)} />
            <ReportSplit label="股息税额 20%" value={money(scheme.dividend_tax_cny)} />
            <ReportSplit label="境外税抵免使用" value={`-${money(scheme.foreign_tax_credit_used_cny)}`} />
            <ReportSplit label="预计应补税额" value={money(scheme.tax_due_cny)} accent="cyan" />
          </div>
        </div>

        <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="font-heading text-sm font-semibold text-[var(--text-primary)]">法律信息与职能作用概述</h3>
          <div className="mt-3 grid gap-3 text-sm leading-6 text-[var(--text-secondary)] md:grid-cols-2">
            <p>
              美国 IRS Form 8949 的作用是列示资本资产出售或交换，并与 Form 1099-B、1099-DA、1099-S 或券商替代表单中的收入、成本基础进行勾稽；其小计再进入 Schedule D 计算整体资本利得或损失。
            </p>
            <p>
              结合中国个人所得税规则，境外证券处置一般按“财产转让所得”做留档测算：应纳税所得额以转让收入扣除财产原值和合理费用后的余额确定，适用比例税率 20%；有价证券原值通常包括买入价及买入时相关费用。
            </p>
            <p>
              本页面的职能不是生成正式税局表单，而是把交易流水、成本匹配、人民币折算、境外已缴税和应补税额组织成可追溯的工作底稿，便于后续人工复核、申报填报或交给专业人士审阅。
            </p>
            <p>
              若存在缺失汇率、未匹配成本批次或需要确认的成本方法，本表应作为“待复核版本”使用；正式申报前应以主管税务机关要求、完整券商材料和专业意见为准。
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-white/[0.06] p-5">
        <h3 className="font-heading text-sm font-semibold text-[var(--text-primary)]">附件与复核提示</h3>
        <div className="mt-3 grid gap-3 text-sm leading-6 text-[var(--text-secondary)] md:grid-cols-3">
          <p>建议随本表留存券商年度 tax statement、成交记录、订单费用、分红及预扣税流水、汇率来源记录。</p>
          <p>本表的“调整 CNY”预留给成本修正、费用调整、税法不认可损失或其他申报调整；当前基于系统数据默认填 0。</p>
          <p>参考来源：IRS Form 8949 / Schedule D；《中华人民共和国个人所得税法》及其实施条例关于财产转让所得、财产原值和合理费用的规则。</p>
        </div>
      </div>
    </section>
  );
}

function FormField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-white/[0.08] bg-white/[0.02] px-3 py-2">
      <p className="font-mono text-[10px] text-[var(--text-secondary)]">{label}</p>
      <p className="mt-1 truncate font-mono text-xs text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function Form8949Part({
  title,
  subtitle,
  checkboxRows,
  rows,
}: {
  title: string;
  subtitle: string;
  checkboxRows: Array<[string, string, boolean]>;
  rows: ReportRow[];
}) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.proceeds += row.proceedsCny;
      acc.cost += row.costCny;
      acc.adjustment += row.adjustmentCny;
      acc.gain += row.gainCny;
      return acc;
    },
    { proceeds: 0, cost: 0, adjustment: 0, gain: 0 },
  );

  return (
    <div className="overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.015]">
      <div className="border-b border-white/[0.06] bg-white/[0.025] p-4">
        <h3 className="font-heading text-base font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{subtitle}</p>
        <div className="mt-3 grid gap-2 text-xs text-[var(--text-secondary)] lg:grid-cols-3">
          {checkboxRows.map(([code, label, checked]) => (
            <div key={code} className="flex items-start gap-2 rounded-sm border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <span className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center border font-mono text-[10px] ${checked ? "border-[var(--cyan)] text-[var(--cyan)]" : "border-white/[0.18] text-transparent"}`}>
                X
              </span>
              <span>
                <span className="font-mono text-[var(--text-primary)]">({code}) </span>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-auto">
        <table className="w-full min-w-[1600px] text-left font-mono text-xs">
          <thead className="text-[var(--text-secondary)]">
            <tr className="border-b border-white/[0.06]">
              <th className="w-[34px] px-3 py-3 font-medium">#</th>
              <th className="px-3 py-3 font-medium">(a) 资产描述</th>
              <th className="px-3 py-3 font-medium">(b) 取得日期</th>
              <th className="px-3 py-3 font-medium">(c) 出售或处置日期</th>
              <th className="px-3 py-3 text-right font-medium">(d) 转让收入</th>
              <th className="px-3 py-3 text-right font-medium">(e) 成本或其他基础</th>
              <th className="px-3 py-3 font-medium">(f) 调整代码</th>
              <th className="px-3 py-3 text-right font-medium">(g) 调整金额</th>
              <th className="px-3 py-3 text-right font-medium">(h) 收益或亏损</th>
              <th className="px-3 py-3 font-medium">附件凭证</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key} className="border-b border-white/[0.04]">
                <td className="px-3 py-3 text-[var(--text-primary)]">{index + 1}</td>
                <td className="px-3 py-3 text-[var(--text-primary)]">{row.asset}</td>
                <td className="px-3 py-3 text-[var(--text-secondary)]">{row.acquiredDate}</td>
                <td className="px-3 py-3 text-[var(--text-secondary)]">{row.soldDate}</td>
                <td className="px-3 py-3 text-right text-[var(--text-secondary)]">{money(row.proceedsCny)}</td>
                <td className="px-3 py-3 text-right text-[var(--text-secondary)]">{money(row.costCny)}</td>
                <td className="px-3 py-3 text-[var(--text-secondary)]">—</td>
                <td className="px-3 py-3 text-right text-[var(--text-secondary)]">{money(row.adjustmentCny)}</td>
                <td className={`px-3 py-3 text-right ${row.gainCny >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                  {money(row.gainCny)}
                </td>
                <td className="px-3 py-3 text-[var(--text-secondary)]">{row.evidence}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="px-3 py-5 text-[var(--text-secondary)]" colSpan={10}>
                  本分区暂无交易。
                </td>
              </tr>
            )}
            <tr className="bg-white/[0.025] text-[var(--text-primary)]">
              <td className="px-3 py-3" colSpan={4}>
                第 2 行小计
              </td>
              <td className="px-3 py-3 text-right">{money(totals.proceeds)}</td>
              <td className="px-3 py-3 text-right">{money(totals.cost)}</td>
              <td className="px-3 py-3">—</td>
              <td className="px-3 py-3 text-right">{money(totals.adjustment)}</td>
              <td className="px-3 py-3 text-right">{money(totals.gain)}</td>
              <td className="px-3 py-3 text-[var(--text-secondary)]">转入年度汇总</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportSplit({ label, value, accent }: { label: string; value: string; accent?: "cyan" | "green" | "amber" }) {
  const colorClass =
    accent === "cyan" ? "text-[var(--cyan)]" : accent === "green" ? "text-[var(--green)]" : accent === "amber" ? "text-[var(--amber)]" : "text-[var(--text-primary)]";
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.04] pb-2 font-mono text-xs">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className={`text-right ${colorClass}`}>{value}</span>
    </div>
  );
}

function SaleTrace({ sale, lang }: { sale: TaxCostTraceSale; lang: Lang }) {
  const t = copy[lang];
  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-3 font-mono text-xs md:grid-cols-4 lg:grid-cols-8">
        <MiniStat label={t.sale} value={`${sale.index} · ${sale.symbol}`} />
        <MiniStat label={t.sellTime} value={dateOnly(sale.sell_time)} />
        <MiniStat label={t.sellOrder} value={sale.sell_order_id} />
        <MiniStat label={t.sellTrade} value={sale.sell_trade_id} />
        <MiniStat label={t.sellPrice} value={`${compactNumber(sale.sell_price)} ${sale.currency}`} />
        <MiniStat label={t.sellQty} value={compactNumber(sale.sell_quantity)} />
        <MiniStat label={t.matchedQty} value={compactNumber(sale.matched_quantity)} />
        <MiniStat label={t.gain} value={money(sale.gain_cny)} />
      </div>
      <div className="grid grid-cols-2 gap-3 font-mono text-xs md:grid-cols-4">
        <MiniStat label={t.unmatchedQty} value={compactNumber(sale.unmatched_quantity)} />
        <MiniStat label={t.proceeds} value={money(sale.proceeds_cny)} />
        <MiniStat label={t.cost} value={money(sale.cost_cny)} />
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
        {compactNumber(sale.sell_price)} {sale.currency}
      </td>
      <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{compactNumber(match.matched_quantity)}</td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">{dateOnly(match.buy_time)}</td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">{match.buy_order_id}</td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">{match.buy_trade_id}</td>
      <td className="px-3 py-2 text-[var(--text-secondary)]">
        {compactNumber(match.buy_price)} {match.buy_currency}
      </td>
      <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{compactNumber(match.matched_quantity)}</td>
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
