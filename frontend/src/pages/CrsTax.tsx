import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchTaxFxRates, fetchTaxRaw, fetchTaxReport, importTaxFxRates, triggerTaxCollect } from "@/api/tax";
import type { TaxScheme } from "@/api/types";
import { GlassCard } from "@/components/cards/GlassCard";
import { toNumber } from "@/lib/format";

const currentYear = new Date().getFullYear();
const years = Array.from({ length: 8 }, (_, i) => currentYear - i);
const filingMonths = [3, 4, 5, 6];
const rawPageSizeOptions = [10, 20, 30] as const;
const rawAllPageSize = 500;
const rawKinds = ["executions", "orders", "cashflows", "fx"] as const;
const hiddenRawKeys = new Set(["id", "order_id", "trade_id", "execution_id"]);
const ignoredOrderStatuses = new Set(["Canceled", "Expired", "Rejected", "Unknown"]);
type Lang = "en" | "zh";
type CopyKey =
  | "title"
  | "subtitle"
  | "filingPrefix"
  | "collect"
  | "recommendedTaxDue"
  | "capitalTaxableGain"
  | "dividendIncome"
  | "bestExplainableScheme"
  | "noReportData"
  | "proceeds"
  | "cost"
  | "foreignCredit"
  | "sales"
  | "estimationNote"
  | "fxCompleteness"
  | "taxFxDate"
  | "missingRates"
  | "missingCostLots"
  | "importFxCsv"
  | "importing"
  | "fxSupported"
  | "fetchingFx"
  | "fetchOfficialFx"
  | "fxSource"
  | "incomeSplit"
  | "capitalTax"
  | "matchedSaleQty"
  | "unmatchedSaleQty"
  | "dividendTax"
  | "foreignTaxPaid"
  | "netTaxDue"
  | "economicFxLens"
  | "eventDateCashValue"
  | "observableFxEffect"
  | "observableCashFlows"
  | "executionsMetric"
  | "schemeComparison"
  | "schemes"
  | "method"
  | "loss"
  | "risk"
  | "gain"
  | "taxable"
  | "credit"
  | "due"
  | "prev"
  | "next"
  | "all"
  | "perPage"
  | "loadingRaw"
  | "noRawRows"
  | "langButton"
  | "rawExecutions"
  | "rawOrders"
  | "rawCash"
  | "rawFx"
  | "costTraceTitle"
  | "costTraceHint"
  | "close"
  | "sale"
  | "sellTime"
  | "sellPrice"
  | "sellQty"
  | "matchedQty"
  | "proceedsCny"
  | "costCny"
  | "gainCny"
  | "buyTime"
  | "buyPrice"
  | "buyQty"
  | "unitCostCny"
  | "matchedCostCny"
  | "buyFeeCny"
  | "traceEmpty"
  | "settlementTitle"
  | "settlementSubtitle"
  | "estimatedDue"
  | "readyToReview"
  | "needsAttention"
  | "selectedBasis"
  | "calculation"
  | "capitalTaxFormula"
  | "dividendTaxFormula"
  | "creditFormula"
  | "amountDueFormula"
  | "advancedComparison"
  | "showSchemes"
  | "hideSchemes"
  | "reviewCostTrace";

const copy: Record<Lang, Record<CopyKey, string>> = {
  en: {
    title: "CRS tax estimator",
    subtitle: "CRS is reporting infrastructure; this page estimates China resident individual overseas securities tax.",
    filingPrefix: "Filing M",
    collect: "Collect",
    recommendedTaxDue: "Recommended tax due",
    capitalTaxableGain: "Capital taxable gain",
    dividendIncome: "Dividend income",
    bestExplainableScheme: "Best explainable scheme",
    noReportData: "No report data",
    proceeds: "Proceeds",
    cost: "Cost",
    foreignCredit: "Foreign credit",
    sales: "Sales",
    estimationNote:
      "This is an estimation aid, not tax advice. Aggressive schemes are shown for comparison and should be reviewed before filing.",
    fxCompleteness: "FX completeness",
    taxFxDate: "Tax FX date",
    missingRates: "Missing rates",
    missingCostLots: "Missing cost lots",
    importFxCsv: "Import FX CSV",
    importing: "Importing...",
    fxSupported: "USD/HKD CNY rates supported.",
    fetchingFx: "Fetching CFETS rates...",
    fetchOfficialFx: "Fetch official USD/HKD rates",
    fxSource: "Source: ChinaMoney / CFETS midpoint.",
    incomeSplit: "Income split",
    capitalTax: "Capital tax",
    matchedSaleQty: "Matched sale qty",
    unmatchedSaleQty: "Unmatched sale qty",
    dividendTax: "Dividend tax",
    foreignTaxPaid: "Foreign tax paid",
    netTaxDue: "Net tax due",
    economicFxLens: "Economic FX lens",
    eventDateCashValue: "Event-date cash value",
    observableFxEffect: "Observable FX effect",
    observableCashFlows: "Observable cash flows",
    executionsMetric: "Executions",
    schemeComparison: "Scheme comparison",
    schemes: "schemes",
    method: "Method",
    loss: "Loss",
    risk: "Risk",
    gain: "Gain",
    taxable: "Taxable",
    credit: "Credit",
    due: "Due",
    prev: "Prev",
    next: "Next",
    all: "All",
    perPage: "/ page",
    loadingRaw: "Loading raw rows...",
    noRawRows: "No raw rows collected yet.",
    langButton: "中文",
    rawExecutions: "Executions",
    rawOrders: "Orders",
    rawCash: "Cash",
    rawFx: "FX",
    costTraceTitle: "Cost trace",
    costTraceHint: "Click a cost method to review how sales are matched to buy lots for audit support.",
    close: "Close",
    sale: "Sale",
    sellTime: "Sell time",
    sellPrice: "Sell price",
    sellQty: "Sell qty",
    matchedQty: "Matched qty",
    proceedsCny: "Proceeds CNY",
    costCny: "Cost CNY",
    gainCny: "Gain CNY",
    buyTime: "Buy time",
    buyPrice: "Buy price",
    buyQty: "Buy qty",
    unitCostCny: "Unit cost CNY",
    matchedCostCny: "Matched cost CNY",
    buyFeeCny: "Buy fee CNY",
    traceEmpty: "No traceable lot details for this method.",
    settlementTitle: "Your estimated filing result",
    settlementSubtitle: "A simplified calculation using the selected year, filing month, FX date, and recommended explainable method.",
    estimatedDue: "Estimated amount due",
    readyToReview: "Ready to review",
    needsAttention: "Needs attention",
    selectedBasis: "Selected basis",
    calculation: "Calculation",
    capitalTaxFormula: "Capital taxable gain x 20%",
    dividendTaxFormula: "Dividend tax at 20%",
    creditFormula: "Less foreign tax credit used",
    amountDueFormula: "Estimated final amount due",
    advancedComparison: "Advanced comparison",
    showSchemes: "Show other methods",
    hideSchemes: "Hide other methods",
    reviewCostTrace: "Review cost trace",
  },
  zh: {
    title: "CRS 税务测算",
    subtitle: "CRS 是涉税信息报送机制；本页测算中国税收居民个人境外证券所得个税。",
    filingPrefix: "申报月份 ",
    collect: "采集",
    recommendedTaxDue: "建议口径应补税额",
    capitalTaxableGain: "资本应税收益",
    dividendIncome: "股息收入",
    bestExplainableScheme: "最佳可解释方案",
    noReportData: "暂无报告数据",
    proceeds: "卖出收入",
    cost: "成本",
    foreignCredit: "境外税抵免",
    sales: "卖出笔数",
    estimationNote: "这是申报测算辅助，不替代税务建议。激进口径仅用于对比，申报前应复核确认。",
    fxCompleteness: "汇率完整性",
    taxFxDate: "税法汇率日期",
    missingRates: "缺失汇率",
    missingCostLots: "缺失成本批次",
    importFxCsv: "导入汇率 CSV",
    importing: "导入中...",
    fxSupported: "支持 USD/HKD 对人民币汇率。",
    fetchingFx: "正在获取官方汇率...",
    fetchOfficialFx: "获取官方 USD/HKD 汇率",
    fxSource: "来源：中国货币网 / CFETS 中间价。",
    incomeSplit: "所得拆分",
    capitalTax: "资本税额",
    matchedSaleQty: "已匹配卖出数量",
    unmatchedSaleQty: "未匹配卖出数量",
    dividendTax: "股息税额",
    foreignTaxPaid: "境外已缴税",
    netTaxDue: "应补税额",
    economicFxLens: "经济汇率视角",
    eventDateCashValue: "交易日现金价值",
    observableFxEffect: "可观测汇率影响",
    observableCashFlows: "可观测现金流",
    executionsMetric: "成交记录",
    schemeComparison: "方案对比",
    schemes: "个方案",
    method: "成本方法",
    loss: "亏损口径",
    risk: "风险",
    gain: "收益",
    taxable: "应税",
    credit: "抵免",
    due: "应补",
    prev: "上一页",
    next: "下一页",
    all: "全部",
    perPage: "/ 页",
    loadingRaw: "正在加载原始流水...",
    noRawRows: "暂无原始流水。",
    langButton: "EN",
    rawExecutions: "成交",
    rawOrders: "订单",
    rawCash: "现金流",
    rawFx: "汇率",
    costTraceTitle: "成本追踪",
    costTraceHint: "点击成本方法，可查看每笔卖出如何匹配买入批次，便于回溯和留档。",
    close: "关闭",
    sale: "卖出",
    sellTime: "卖出时间",
    sellPrice: "卖出价",
    sellQty: "卖出数量",
    matchedQty: "匹配数量",
    proceedsCny: "卖出收入 CNY",
    costCny: "成本 CNY",
    gainCny: "收益 CNY",
    buyTime: "买入时间",
    buyPrice: "买入价",
    buyQty: "匹配买入数量",
    unitCostCny: "单位成本 CNY",
    matchedCostCny: "匹配成本 CNY",
    buyFeeCny: "买入费用 CNY",
    traceEmpty: "该方法暂无可回溯批次明细。",
    settlementTitle: "本年度汇算结果",
    settlementSubtitle: "按所选年度、申报月份、汇率日期和推荐可解释口径生成的简化结果。",
    estimatedDue: "预计应补",
    readyToReview: "可复核",
    needsAttention: "需关注",
    selectedBasis: "采用口径",
    calculation: "计算过程",
    capitalTaxFormula: "资本应税收益 x 20%",
    dividendTaxFormula: "股息按 20% 测算",
    creditFormula: "减境外税抵免",
    amountDueFormula: "预计最终应补",
    advancedComparison: "高级方案对比",
    showSchemes: "查看其他算法",
    hideSchemes: "收起其他算法",
    reviewCostTrace: "查看成本追踪",
  },
};

const rawHeaderLabels: Record<Lang, Record<string, string>> = {
  en: {
    symbol: "Symbol",
    side: "Side",
    status: "Status",
    currency: "Currency",
    executed_price: "Executed price",
    executed_quantity: "Executed quantity",
    submitted_at: "Submitted at",
    updated_at: "Updated at",
    trade_done_at: "Trade time",
    price: "Price",
    quantity: "Quantity",
    transaction_flow_name: "Flow",
    direction: "Direction",
    business_type: "Business type",
    balance: "Amount",
    business_time: "Business time",
    description: "Description",
    rate_date: "Rate date",
    cny_rate: "CNY rate",
    source: "Source",
  },
  zh: {
    symbol: "标的",
    side: "方向",
    status: "状态",
    currency: "币种",
    executed_price: "成交均价",
    executed_quantity: "成交数量",
    submitted_at: "提交时间",
    updated_at: "更新时间",
    trade_done_at: "成交时间",
    price: "成交价",
    quantity: "数量",
    transaction_flow_name: "流水类型",
    direction: "方向",
    business_type: "业务类型",
    balance: "金额",
    business_time: "业务时间",
    description: "说明",
    rate_date: "汇率日期",
    cny_rate: "人民币汇率",
    source: "来源",
  },
};

const rawValueLabels: Record<Lang, Record<string, string>> = {
  en: {
    Buy: "Buy",
    Sell: "Sell",
    Filled: "Filled",
    PartialWithdrawal: "Partial filled",
    Out: "Out",
    In: "In",
  },
  zh: {
    Buy: "买入",
    Sell: "卖出",
    Filled: "已成交",
    PartialWithdrawal: "部分成交撤单",
    Out: "支出",
    In: "收入",
  },
};

function money(v: number | string | null | undefined): string {
  return `¥${toNumber(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function methodLabel(method: string, lang: Lang): string {
  if (method === "fifo") return "FIFO";
  if (method === "weighted_average") return lang === "zh" ? "移动加权" : "Weighted avg";
  if (method === "highest_cost") return lang === "zh" ? "高成本优先" : "High cost";
  return method;
}

function methodDescription(method: string, lang: Lang): string {
  if (method === "fifo") {
    if (lang === "zh") {
      return "先进先出：每次卖出优先消耗最早剩余的买入批次。成本为匹配买入价加分摊买入费用。";
    }
    return "First in, first out: each sale consumes the earliest remaining buy lots. Cost basis is the matched buy price plus allocated buy fees.";
  }
  if (method === "weighted_average") {
    if (lang === "zh") {
      return "移动加权平均：每次卖出前，按同标的剩余总成本除以剩余数量得到单位成本。";
    }
    return "Moving weighted average: before each sale, cost per share is total remaining cost divided by total remaining quantity for the same symbol.";
  }
  if (method === "highest_cost") {
    if (lang === "zh") {
      return "高成本优先模拟：每次卖出优先匹配可用成本最高的批次，以降低应税收益。该方案需税务确认。";
    }
    return "Highest cost simulation: each sale matches the highest available cost lots first to reduce taxable gain. Marked as a tax-confirmation scenario.";
  }
  if (lang === "zh") return "用于将卖出成交与可用买入批次匹配的成本计算方法。";
  return "Cost method used to match sell executions with available buy lots.";
}

function lossLabel(policy: string, lang: Lang): string {
  if (policy === "per_sale") return lang === "zh" ? "逐笔" : "Per sale";
  if (policy === "symbol_net") return lang === "zh" ? "同标的净额" : "Symbol net";
  if (policy === "portfolio_net") return lang === "zh" ? "组合净额" : "Portfolio net";
  return policy;
}

function riskClass(scheme: TaxScheme): string {
  if (scheme.is_explainable) return "border-[var(--green)]/35 bg-[var(--green)]/10 text-[var(--green)]";
  if (scheme.risk_level === "aggressive") return "border-[var(--red)]/35 bg-[var(--red)]/10 text-[var(--red)]";
  return "border-[var(--amber)]/35 bg-[var(--amber)]/10 text-[var(--amber)]";
}

export function CrsTax() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const rawScrollYRef = useRef<number | null>(null);
  const [lang, setLang] = useState<Lang>("zh");
  const [year, setYear] = useState(Math.min(2025, currentYear));
  const [filingMonth, setFilingMonth] = useState(6);
  const [rawKind, setRawKind] = useState<(typeof rawKinds)[number]>("executions");
  const [rawPage, setRawPage] = useState(0);
  const [rawPageSize, setRawPageSize] = useState<number | "all">(20);
  const [showSchemeComparison, setShowSchemeComparison] = useState(false);
  const [fxImportResult, setFxImportResult] = useState<string | null>(null);
  const [fxFetchResult, setFxFetchResult] = useState<string | null>(null);

  const reportQuery = useQuery({
    queryKey: ["tax-report", year, filingMonth],
    queryFn: () => fetchTaxReport(year, filingMonth),
    refetchInterval: 60_000,
  });

  const rawLimit = rawPageSize === "all" ? rawAllPageSize : rawPageSize;
  const rawOffset = rawPageSize === "all" ? 0 : rawPage * rawLimit;

  const rawQuery = useQuery({
    queryKey: ["tax-raw", rawKind, year, rawPage, rawPageSize],
    queryFn: () => fetchTaxRaw(rawKind, rawLimit, year, rawOffset),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    setRawPage(0);
  }, [rawKind, year, rawPageSize]);

  useLayoutEffect(() => {
    if (rawScrollYRef.current === null || rawQuery.isFetching) return;
    const scrollY = rawScrollYRef.current;
    rawScrollYRef.current = null;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, left: 0, behavior: "auto" });
    });
  }, [rawQuery.dataUpdatedAt, rawQuery.isFetching]);

  const collectMutation = useMutation({
    mutationFn: () => triggerTaxCollect({ start_year: 2019, end_year: currentYear }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["collect-jobs"] });
    },
  });

  const fxMutation = useMutation({
    mutationFn: importTaxFxRates,
    onSuccess: (data) => {
      setFxImportResult(`${data.imported} rates · ${data.currencies.join(", ") || "no currency"}`);
      void queryClient.invalidateQueries({ queryKey: ["tax-report"] });
      void queryClient.invalidateQueries({ queryKey: ["tax-raw"] });
    },
  });

  const fxFetchMutation = useMutation({
    mutationFn: () =>
      fetchTaxFxRates({
        start_date: `${Math.min(year - 1, year)}-01-01`,
        end_date: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: (data) => {
      setFxFetchResult(
        `${data.imported} rates · ${Object.entries(data.by_currency)
          .map(([currency, count]) => `${currency}:${count}`)
          .join(", ")}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["tax-report"] });
      void queryClient.invalidateQueries({ queryKey: ["tax-raw"] });
    },
  });

  const report = reportQuery.data;
  const best = report?.best_scheme ?? null;
  const sortedSchemes = useMemo(
    () => [...(report?.schemes ?? [])].sort((a, b) => toNumber(a.tax_due_cny) - toNumber(b.tax_due_cny)),
    [report?.schemes],
  );
  const rawItems = useMemo(() => {
    const items = rawQuery.data?.items ?? [];
    if (rawKind !== "orders") return items;
    return items.filter((item) => {
      const quantity = toNumber(item.executed_quantity as number | string | null | undefined);
      const status = String(item.status ?? "");
      return quantity > 0 && !ignoredOrderStatuses.has(status);
    });
  }, [rawKind, rawQuery.data?.items]);
  const rawKeys = useMemo(
    () => Array.from(new Set(rawItems.flatMap((item) => Object.keys(item).filter((key) => !hiddenRawKeys.has(key))))).slice(0, 8),
    [rawItems],
  );
  const rawTotal = rawQuery.data?.total ?? 0;
  const rawStart = rawTotal ? rawOffset + 1 : 0;
  const rawEnd = rawPageSize === "all" ? rawTotal : Math.min(rawTotal, rawOffset + rawItems.length);
  const hasPreviousRawPage = rawPageSize !== "all" && rawPage > 0;
  const hasNextRawPage = rawPageSize !== "all" && rawOffset + rawItems.length < rawTotal;
  const t = (key: CopyKey) => copy[lang][key];
  const rawKindLabel = (key: (typeof rawKinds)[number]) => {
    if (key === "executions") return t("rawExecutions");
    if (key === "orders") return t("rawOrders");
    if (key === "cashflows") return t("rawCash");
    return t("rawFx");
  };
  const rawHeaderLabel = (key: string) => rawHeaderLabels[lang][key] ?? key;
  const rawCellValue = (key: string, value: unknown) => {
    if (value == null) return "—";
    const text = String(value);
    if (["side", "status", "direction", "business_type"].includes(key)) {
      return rawValueLabels[lang][text] ?? text;
    }
    return text;
  };
  const keepRawScrollPosition = () => {
    rawScrollYRef.current = window.scrollY;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mx-auto max-w-[1280px] space-y-6 pb-12"
    >
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-[var(--text-primary)]">
            {t("title")}
          </h1>
          <p className="max-w-3xl font-mono text-xs leading-5 text-[var(--text-secondary)]">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setLang((current) => (current === "zh" ? "en" : "zh"))}
            className="rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-[var(--text-primary)] transition-colors hover:border-white/[0.16]"
          >
            {t("langButton")}
          </button>
          <select
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
            className="rounded-md border border-white/[0.08] bg-[#111118] px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
          >
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            value={filingMonth}
            onChange={(event) => setFilingMonth(Number(event.target.value))}
            className="rounded-md border border-white/[0.08] bg-[#111118] px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
          >
            {filingMonths.map((item) => (
              <option key={item} value={item}>
                {t("filingPrefix")}
                {item}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => collectMutation.mutate()}
            disabled={collectMutation.isPending}
            className="rounded-md border border-[var(--cyan)]/45 bg-[var(--cyan)]/10 px-3 py-2 font-mono text-xs text-[var(--cyan)] transition-colors hover:border-[var(--cyan)]/70 disabled:cursor-wait disabled:opacity-50"
          >
            {collectMutation.isPending ? `${t("collect")}...` : `⟳ ${t("collect")}`}
          </button>
        </div>
      </header>

      <section className="glass-card overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
          <div className="border-b border-white/[0.06] p-5 lg:border-b-0 lg:border-r">
            <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
              {t("settlementTitle")}
            </p>
            <div className="mt-5">
              <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">{t("estimatedDue")}</p>
              <p className="mt-2 font-heading text-4xl font-semibold text-[var(--green)] md:text-5xl">
                {money(best?.tax_due_cny)}
              </p>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md border px-2 py-1 font-mono text-[11px] uppercase ${
                  report?.status === "complete"
                    ? "border-[var(--green)]/35 bg-[var(--green)]/10 text-[var(--green)]"
                    : "border-[var(--amber)]/35 bg-[var(--amber)]/10 text-[var(--amber)]"
                }`}
              >
                {report?.status === "complete" ? t("readyToReview") : t("needsAttention")}
              </span>
              <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)]">
                {report?.tax_fx_rate_date ?? "-"}
              </span>
            </div>
            <p className="mt-4 max-w-lg font-mono text-xs leading-5 text-[var(--text-secondary)]">
              {t("settlementSubtitle")}
            </p>
          </div>

          <div className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                  {t("selectedBasis")}
                </p>
                <h2 className="mt-2 font-heading text-xl text-[var(--text-primary)]">
                  {best ? `${methodLabel(best.cost_method, lang)} · ${lossLabel(best.loss_policy, lang)}` : t("noReportData")}
                </h2>
              </div>
              {best && (
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/crs-tax/cost-trace?year=${year}&filing_month=${filingMonth}&scheme_key=${encodeURIComponent(
                        best.scheme_key,
                      )}&lang=${lang}`,
                    )
                  }
                  className="rounded-md border border-[var(--cyan)]/40 bg-[var(--cyan)]/10 px-3 py-2 font-mono text-xs text-[var(--cyan)] transition-colors hover:border-[var(--cyan)]/70"
                >
                  {t("reviewCostTrace")}
                </button>
              )}
            </div>

            <div className="mt-5 space-y-2">
              <ResultRow label={t("capitalTaxFormula")} value={money(best?.capital_tax_cny)} />
              <ResultRow label={t("dividendTaxFormula")} value={money(best?.dividend_tax_cny)} />
              <ResultRow label={t("creditFormula")} value={`-${money(best?.foreign_tax_credit_used_cny)}`} />
              <ResultRow label={t("amountDueFormula")} value={money(best?.tax_due_cny)} accent />
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <GlassCard className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                {t("bestExplainableScheme")}
              </p>
              <h2 className="mt-2 font-heading text-xl text-[var(--text-primary)]">
                {best ? `${methodLabel(best.cost_method, lang)} · ${lossLabel(best.loss_policy, lang)}` : t("noReportData")}
              </h2>
            </div>
            <span
              className={`rounded-md border px-2 py-1 font-mono text-[11px] uppercase ${best ? riskClass(best) : "border-white/[0.08] text-[var(--text-secondary)]"}`}
            >
              {report?.status ?? "empty"}
            </span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniStat label={t("proceeds")} value={money(best?.capital_proceeds_cny)} />
            <MiniStat label={t("cost")} value={money(best?.capital_cost_cny)} />
            <MiniStat label={t("foreignCredit")} value={money(best?.foreign_tax_credit_used_cny)} />
            <MiniStat label={t("sales")} value={String(best?.sale_count ?? 0)} />
          </div>
          <p className="mt-4 border-t border-white/[0.06] pt-3 font-mono text-xs leading-5 text-[var(--text-secondary)]">
            {t("estimationNote")}
          </p>
        </GlassCard>

        <GlassCard className="p-4">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
            {t("fxCompleteness")}
          </p>
          <div className="mt-3 space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[var(--text-secondary)]">{t("taxFxDate")}</span>
              <span className="text-[var(--text-primary)]">{report?.tax_fx_rate_date ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[var(--text-secondary)]">{t("missingRates")}</span>
              <span className={report?.missing_fx_rates.length ? "text-[var(--amber)]" : "text-[var(--green)]"}>
                {report?.missing_fx_rates.length ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[var(--text-secondary)]">{t("missingCostLots")}</span>
              <span className={report?.unmatched_cost_lots.length ? "text-[var(--amber)]" : "text-[var(--green)]"}>
                {report?.unmatched_cost_lots.length ?? 0}
              </span>
            </div>
            {!!report?.unmatched_cost_lots.length && (
              <div className="rounded-md border border-[var(--amber)]/30 bg-[var(--amber)]/10 p-2 text-[var(--amber)]">
                {report.unmatched_cost_lots
                  .map((item) => `${item.symbol} ${toNumber(item.quantity).toLocaleString()} sh`)
                  .join(" · ")}
              </div>
            )}
            <label className="block rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[var(--text-secondary)]">
              <span className="block pb-2 uppercase tracking-wider">{t("importFxCsv")}</span>
              <input
                type="file"
                accept=".csv,.txt"
                className="block w-full text-[11px]"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    fxMutation.mutate(file);
                  }
                }}
              />
            </label>
            <p className="text-[var(--text-secondary)]">
              {fxMutation.isPending ? t("importing") : fxImportResult ?? t("fxSupported")}
            </p>
            <button
              type="button"
              onClick={() => fxFetchMutation.mutate()}
              disabled={fxFetchMutation.isPending}
              className="w-full rounded-md border border-[var(--green)]/40 bg-[var(--green)]/10 px-3 py-2 text-left font-mono text-xs text-[var(--green)] transition-colors hover:border-[var(--green)]/70 disabled:cursor-wait disabled:opacity-50"
            >
              {fxFetchMutation.isPending ? t("fetchingFx") : t("fetchOfficialFx")}
            </button>
            <p className="text-[var(--text-secondary)]">
              {fxFetchResult ?? t("fxSource")}
            </p>
          </div>
        </GlassCard>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GlassCard className="p-4">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
            {t("incomeSplit")}
          </p>
          <div className="mt-4 space-y-3">
            <SplitRow label={t("capitalTax")} value={money(best?.capital_tax_cny)} />
            <SplitRow label={t("matchedSaleQty")} value={String(best?.matched_sale_quantity ?? 0)} />
            <SplitRow label={t("unmatchedSaleQty")} value={String(best?.unmatched_sale_quantity ?? 0)} />
            <SplitRow label={t("dividendTax")} value={money(best?.dividend_tax_cny)} />
            <SplitRow label={t("foreignTaxPaid")} value={money(best?.foreign_tax_paid_cny)} />
            <SplitRow label={t("netTaxDue")} value={money(best?.tax_due_cny)} accent />
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
            {t("economicFxLens")}
          </p>
          <div className="mt-4 space-y-3">
            <SplitRow label={t("eventDateCashValue")} value={money(report?.economic_fx.event_date_cash_value_cny)} />
            <SplitRow label={t("observableFxEffect")} value={money(report?.economic_fx.observable_fx_effect_cny)} />
            <SplitRow label={t("observableCashFlows")} value={String(report?.economic_fx.observable_cash_flow_count ?? 0)} />
            <SplitRow label={t("executionsMetric")} value={String(report?.raw_counts.executions ?? 0)} />
          </div>
        </GlassCard>
      </section>

      <section className="glass-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] p-4">
          <div>
            <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
              {t("advancedComparison")}
            </p>
            <p className="mt-1 font-mono text-xs text-[var(--text-secondary)]">
              {sortedSchemes.length} {t("schemes")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowSchemeComparison((value) => !value)}
            className="rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:border-white/[0.16]"
          >
            {showSchemeComparison ? t("hideSchemes") : t("showSchemes")}
          </button>
        </div>
        {showSchemeComparison ? (
          <div className="overflow-auto">
          <table className="w-full min-w-[860px] text-left font-mono text-xs">
            <thead className="text-[var(--text-secondary)]">
              <tr>
                <th className="px-4 py-3 font-medium">{t("method")}</th>
                <th className="px-4 py-3 font-medium">{t("loss")}</th>
                <th className="px-4 py-3 font-medium">{t("risk")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("gain")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("taxable")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("credit")}</th>
                <th className="px-4 py-3 font-medium text-right">{t("due")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedSchemes.map((scheme) => (
                <tr key={scheme.scheme_key} className="border-t border-white/[0.04]">
                  <td className="px-4 py-3 text-[var(--text-primary)]">
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/crs-tax/cost-trace?year=${year}&filing_month=${filingMonth}&scheme_key=${encodeURIComponent(
                            scheme.scheme_key,
                          )}&lang=${lang}`,
                        )
                      }
                      className="group relative inline-flex cursor-pointer items-center border-b border-dotted border-[var(--cyan)]/70 text-left text-[var(--text-primary)] transition-colors hover:text-[var(--cyan)]"
                    >
                      {methodLabel(scheme.cost_method, lang)}
                      <span className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-[300px] rounded-md border border-white/[0.12] bg-[#111118] p-3 text-left font-mono text-[11px] leading-5 text-[var(--text-secondary)] shadow-xl group-hover:block">
                        {methodDescription(scheme.cost_method, lang)}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{lossLabel(scheme.loss_policy, lang)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md border px-2 py-1 text-[10px] uppercase ${riskClass(scheme)}`}>
                      {scheme.risk_level}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">{money(scheme.capital_realized_gain_cny)}</td>
                  <td className="px-4 py-3 text-right">{money(scheme.capital_taxable_gain_cny)}</td>
                  <td className="px-4 py-3 text-right">{money(scheme.foreign_tax_credit_used_cny)}</td>
                  <td className="px-4 py-3 text-right text-[var(--cyan)]">{money(scheme.tax_due_cny)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-4 font-mono text-xs md:grid-cols-4">
            <ResultRow label={t("method")} value={best ? methodLabel(best.cost_method, lang) : "-"} />
            <ResultRow label={t("loss")} value={best ? lossLabel(best.loss_policy, lang) : "-"} />
            <ResultRow label={t("taxable")} value={money(best?.capital_taxable_gain_cny)} />
            <ResultRow label={t("due")} value={money(best?.tax_due_cny)} accent />
          </div>
        )}
      </section>

      <section className="glass-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] p-4">
          <div className="flex flex-wrap items-center gap-2">
            {rawKinds.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setRawKind(item)}
                className={`rounded-md border px-3 py-2 font-mono text-xs transition-colors ${
                  rawKind === item
                    ? "border-[var(--cyan)]/50 bg-[var(--cyan)]/10 text-[var(--cyan)]"
                    : "border-white/[0.08] bg-white/[0.03] text-[var(--text-secondary)] hover:border-white/[0.16]"
                }`}
              >
                {rawKindLabel(item)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <select
              value={String(rawPageSize)}
              onChange={(event) => {
                keepRawScrollPosition();
                const value = event.target.value;
                setRawPageSize(value === "all" ? "all" : Number(value));
              }}
              className="rounded-md border border-white/[0.08] bg-[#111118] px-3 py-2 text-[var(--text-primary)]"
            >
              {rawPageSizeOptions.map((item) => (
                <option key={item} value={item}>
                  {item} {t("perPage")}
                </option>
              ))}
              <option value="all">{t("all")}</option>
            </select>
            <span className="text-[var(--text-secondary)]">
              {rawStart}-{rawEnd} / {rawTotal}
            </span>
            <button
              type="button"
              onClick={() => {
                keepRawScrollPosition();
                setRawPage((page) => Math.max(0, page - 1));
              }}
              disabled={!hasPreviousRawPage || rawQuery.isFetching}
              className="rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[var(--text-secondary)] transition-colors hover:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("prev")}
            </button>
            <button
              type="button"
              onClick={() => {
                keepRawScrollPosition();
                setRawPage((page) => page + 1);
              }}
              disabled={!hasNextRawPage || rawQuery.isFetching}
              className="rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[var(--text-secondary)] transition-colors hover:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("next")}
            </button>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[760px] text-left font-mono text-xs">
            <thead className="text-[var(--text-secondary)]">
              <tr>
                {rawKeys.map((key) => (
                  <th key={key} className="px-4 py-3 font-medium">
                    {rawHeaderLabel(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rawItems.map((item, index) => (
                <tr key={index} className="border-t border-white/[0.04]">
                  {rawKeys.map((key) => (
                    <td key={key} className="max-w-[220px] truncate px-4 py-3 text-[var(--text-secondary)]">
                      {rawCellValue(key, item[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!rawItems.length && (
            <p className="p-4 font-mono text-xs text-[var(--text-secondary)]">
              {rawQuery.isLoading ? t("loadingRaw") : t("noRawRows")}
            </p>
          )}
        </div>
      </section>
    </motion.div>
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

function ResultRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 rounded-md border border-white/[0.06] bg-white/[0.025] px-3 py-2 font-mono text-xs">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className={accent ? "font-semibold text-[var(--green)]" : "text-[var(--text-primary)]"}>{value}</span>
    </div>
  );
}

function SplitRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2 font-mono text-xs">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className={accent ? "text-[var(--cyan)]" : "text-[var(--text-primary)]"}>{value}</span>
    </div>
  );
}
