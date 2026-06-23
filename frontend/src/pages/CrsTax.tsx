import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { updateLongbridgeToken } from "@/api/admin";
import { fetchCollectJobs } from "@/api/collect";
import { fetchTaxRaw, fetchTaxReport, triggerTaxCollect } from "@/api/tax";
import type { TaxScheme } from "@/api/types";
import { GlassCard } from "@/components/cards/GlassCard";
import { toNumber } from "@/lib/format";

const currentYear = new Date().getFullYear();
const years = Array.from({ length: 8 }, (_, i) => currentYear - i);
const rawPageSizeOptions = [10, 20, 30] as const;
const rawAllPageSize = 500;
const rawKinds = ["executions", "orders", "cashflows", "dividends", "fx"] as const;
type RawKind = (typeof rawKinds)[number];
type RawTradeTimeOrder = "asc" | "desc";
const defaultSchemeKey = "highest_cost:portfolio_net";
const defaultCostMethod = "highest_cost";
const defaultLossPolicy = "portfolio_net";
const methodOptions = ["highest_cost", "lifo", "weighted_average", "fifo"] as const;
const lossPolicyOptions = ["portfolio_net", "per_sale", "symbol_net"] as const;
const rawColumns: Record<RawKind, string[]> = {
  executions: ["order_id", "trade_id", "symbol", "side", "trade_done_at", "price", "quantity", "total_amount"],
  orders: ["order_id", "symbol", "side", "status", "currency", "executed_price", "executed_quantity", "trade_count", "submitted_at"],
  cashflows: ["transaction_flow_name", "direction", "business_type", "balance", "currency", "business_time", "symbol", "description"],
  dividends: ["business_time", "symbol", "kind", "amount", "currency", "cny_amount", "description"],
  fx: ["rate_date", "currency", "cny_rate", "source"],
};
const rawDecimalKeys = new Set(["price", "quantity", "total_amount", "executed_price", "executed_quantity", "balance", "amount", "cny_amount", "cny_rate"]);
const rawBeijingTimeKeys = new Set(["trade_done_at", "submitted_at", "business_time", "started_at", "completed_at", "created_at"]);
const ignoredOrderStatuses = new Set(["Canceled", "Expired", "Rejected", "Unknown"]);
type Lang = "en" | "zh";
type ExpandedRawLink = {
  key: string;
  relatedKind: RawKind;
  orderId: string;
} | null;

function normalizeSchemeKey(value: string | null): string {
  return (value ?? defaultSchemeKey).replace(":symbol_net", ":portfolio_net");
}

function formatCollectError(message: string | null | undefined, tokenInvalidHint: string): string | null {
  if (!message) return null;
  if (isLongbridgeTokenInvalid(message)) {
    return tokenInvalidHint + " (" + message + ")";
  }
  return message;
}

function isLongbridgeTokenInvalid(message: string | null | undefined): boolean {
  if (!message) return false;
  return message.includes("401004") || message.toLowerCase().includes("token invalid");
}

type CopyKey =
  | "title"
  | "subtitle"
  | "collect"
  | "collectStarting"
  | "collectRunning"
  | "collectRefreshing"
  | "collectComplete"
  | "collectFailed"
  | "collectErrorTitle"
  | "collectTokenInvalidHint"
  | "tokenRefreshTitle"
  | "tokenRefreshPlaceholder"
  | "tokenRefreshSubmit"
  | "tokenRefreshSaving"
  | "tokenRefreshSuccess"
  | "tokenRefreshError"
  | "recommendedTaxDue"
  | "capitalTaxableGain"
  | "dividendIncome"
  | "calculationRules"
  | "costMethodRule"
  | "lossPolicyRule"
  | "taxableRule"
  | "noReportData"
  | "proceeds"
  | "annualSellAmount"
  | "cost"
  | "foreignCredit"
  | "sales"
  | "estimationNote"
  | "fxCompleteness"
  | "taxFxDate"
  | "fxRate"
  | "estimatedFxRate"
  | "noFxRate"
  | "fxSource"
  | "incomeSplit"
  | "capitalTax"
  | "matchedSaleQty"
  | "unmatchedSaleQty"
  | "dividendTax"
  | "foreignTaxPaid"
  | "netTaxDue"
  | "economicFxLens"
  | "moneyMarketLens"
  | "moneyMarketSubscription"
  | "moneyMarketRedemption"
  | "moneyMarketNet"
  | "moneyMarketTransactions"
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
  | "rawSearch"
  | "filterMonth"
  | "filterSide"
  | "langButton"
  | "rawExecutions"
  | "rawOrders"
  | "rawCash"
  | "rawDividends"
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
    collect: "Collect",
    collectStarting: "Starting collection",
    collectRunning: "Collecting in background",
    collectRefreshing: "Refreshing report",
    collectComplete: "Collection complete",
    collectFailed: "Collection failed",
    collectErrorTitle: "Failure reason",
    collectTokenInvalidHint: "Longbridge access token is invalid. Paste a fresh token below, then collect again.",
    tokenRefreshTitle: "Refresh Longbridge token",
    tokenRefreshPlaceholder: "Paste new access token",
    tokenRefreshSubmit: "Update token",
    tokenRefreshSaving: "Updating...",
    tokenRefreshSuccess: "Token updated",
    tokenRefreshError: "Unable to update token",
    recommendedTaxDue: "Recommended tax due",
    capitalTaxableGain: "Capital taxable gain",
    dividendIncome: "Dividend income",
    calculationRules: "Calculation rules",
    costMethodRule: "Cost matching",
    lossPolicyRule: "Loss offset",
    taxableRule: "Taxable gain",
    noReportData: "No report data",
    proceeds: "Proceeds",
    annualSellAmount: "Annual sell amount",
    cost: "Cost",
    foreignCredit: "Foreign credit",
    sales: "Sales",
    estimationNote:
      "This is an estimation aid, not tax advice. Aggressive schemes are shown for comparison and should be reviewed before filing.",
    fxCompleteness: "Year-end FX midpoint",
    taxFxDate: "Midpoint date",
    fxRate: "CNY midpoint",
    estimatedFxRate: "Using prior year-end",
    noFxRate: "No year-end midpoint rate",
    fxSource: "Uses the tax-year Dec 31 RMB midpoint; before year-end data exists, uses the prior year-end midpoint.",
    incomeSplit: "Income split",
    capitalTax: "Capital tax",
    matchedSaleQty: "Matched sale qty",
    unmatchedSaleQty: "Unmatched sale qty",
    dividendTax: "Dividend tax",
    foreignTaxPaid: "Foreign tax paid",
    netTaxDue: "Net tax due",
    economicFxLens: "Economic FX lens",
    moneyMarketLens: "Money market cashflows",
    moneyMarketSubscription: "Subscriptions",
    moneyMarketRedemption: "Redemptions",
    moneyMarketNet: "Net cashflow",
    moneyMarketTransactions: "Transactions",
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
    rawSearch: "Search order or trade ID",
    filterMonth: "Month",
    filterSide: "Side",
    langButton: "中文",
    rawExecutions: "Executions",
    rawOrders: "Orders",
    rawCash: "Cash",
    rawDividends: "Dividends",
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
    settlementSubtitle: "A simplified calculation using the selected year, year-end FX date, and selected basis.",
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
    collect: "采集",
    collectStarting: "正在启动采集",
    collectRunning: "后台采集中",
    collectRefreshing: "正在刷新报告",
    collectComplete: "采集完成",
    collectFailed: "采集失败",
    collectErrorTitle: "失败原因",
    collectTokenInvalidHint: "Longbridge access token 无效。请在下方粘贴新 token，然后重新采集。",
    tokenRefreshTitle: "更新 Longbridge token",
    tokenRefreshPlaceholder: "粘贴新的 access token",
    tokenRefreshSubmit: "更新 token",
    tokenRefreshSaving: "更新中...",
    tokenRefreshSuccess: "Token 已更新",
    tokenRefreshError: "Token 更新失败",
    recommendedTaxDue: "建议口径应补税额",
    capitalTaxableGain: "资本应税收益",
    dividendIncome: "股息收入",
    calculationRules: "计算逻辑",
    costMethodRule: "成本匹配",
    lossPolicyRule: "亏损抵扣",
    taxableRule: "应税规则",
    noReportData: "暂无报告数据",
    proceeds: "卖出收入",
    annualSellAmount: "全年卖出成交额",
    cost: "成本",
    foreignCredit: "境外税抵免",
    sales: "卖出笔数",
    estimationNote: "这是申报测算辅助，不替代税务建议。激进口径仅用于对比，申报前应复核确认。",
    fxCompleteness: "年度汇率中间价",
    taxFxDate: "中间价日期",
    fxRate: "人民币中间价",
    estimatedFxRate: "暂用上一年年末",
    noFxRate: "暂无年度中间价",
    fxSource: "按年度境外所得申报口径，使用纳税年度 12 月 31 日人民币汇率中间价；本年度年末价未生成前，暂用上一年 12 月 31 日中间价。",
    incomeSplit: "所得拆分",
    capitalTax: "资本税额",
    matchedSaleQty: "已匹配卖出数量",
    unmatchedSaleQty: "未匹配卖出数量",
    dividendTax: "股息税额",
    foreignTaxPaid: "境外已缴税",
    netTaxDue: "应补税额",
    economicFxLens: "经济汇率视角",
    moneyMarketLens: "货币基金现金流",
    moneyMarketSubscription: "申购金额",
    moneyMarketRedemption: "赎回金额",
    moneyMarketNet: "净现金流",
    moneyMarketTransactions: "流水笔数",
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
    rawSearch: "搜索订单或成交 ID",
    filterMonth: "月份",
    filterSide: "方向",
    langButton: "EN",
    rawExecutions: "成交",
    rawOrders: "订单",
    rawCash: "现金流",
    rawDividends: "股息",
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
    settlementSubtitle: "按所选年度、年末汇率日期和采用口径生成的简化结果。",
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
    order_id: "Order ID",
    trade_id: "Trade ID",
    symbol: "Symbol",
    side: "Side",
    status: "Status",
    currency: "Currency",
    executed_price: "Executed price",
    executed_quantity: "Executed quantity",
    trade_count: "Trade count",
    submitted_at: "Submitted at",
    updated_at: "Updated at",
    trade_done_at: "Trade time",
    price: "Price",
    quantity: "Quantity",
    total_amount: "Total",
    transaction_flow_name: "Flow",
    direction: "Direction",
    business_type: "Business type",
    balance: "Amount",
    business_time: "Business time",
    description: "Description",
    kind: "Type",
    amount: "Amount",
    cny_amount: "CNY amount",
    rate_date: "Rate date",
    cny_rate: "CNY rate",
    source: "Source",
  },
  zh: {
    order_id: "订单 ID",
    trade_id: "成交 ID",
    symbol: "标的",
    side: "方向",
    status: "状态",
    currency: "币种",
    executed_price: "成交均价",
    executed_quantity: "成交数量",
    trade_count: "成交笔数",
    submitted_at: "提交时间",
    updated_at: "更新时间",
    trade_done_at: "成交时间",
    price: "成交价",
    quantity: "数量",
    total_amount: "成交额",
    transaction_flow_name: "流水类型",
    direction: "方向",
    business_type: "业务类型",
    balance: "金额",
    business_time: "业务时间",
    description: "说明",
    kind: "类型",
    amount: "金额",
    cny_amount: "人民币金额",
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
    income: "Income",
    tax: "Tax",
  },
  zh: {
    Buy: "买入",
    Sell: "卖出",
    Filled: "已成交",
    PartialWithdrawal: "部分成交撤单",
    Out: "支出",
    In: "收入",
    income: "收入",
    tax: "预扣税",
  },
};

function money(v: number | string | null | undefined): string {
  return `¥${toNumber(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatFxRate(v: number | string | null | undefined): string {
  return toNumber(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function compactDecimal(v: number | string | null | undefined): string {
  return toNumber(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function currencyForRawRow(item?: Record<string, unknown>): string {
  if (typeof item?.currency === "string" && item.currency) return item.currency;
  const symbol = typeof item?.symbol === "string" ? item.symbol.toUpperCase() : "";
  if (symbol.endsWith(".US")) return "USD";
  if (symbol.endsWith(".HK")) return "HKD";
  if (symbol.endsWith(".SH") || symbol.endsWith(".SZ")) return "CNY";
  return "";
}

function formatRawAmountWithCurrency(value: unknown, item?: Record<string, unknown>): string {
  const formatted = toNumber(value as number | string | null | undefined).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const currency = currencyForRawRow(item);
  return currency ? `${formatted} ${currency}` : formatted;
}

function formatBeijingTime(value: unknown): string {
  const raw = String(value);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
}

function instrumentMultiplier(item?: Record<string, unknown>): number {
  const symbol = typeof item?.symbol === "string" ? item.symbol.toUpperCase() : "";
  return /[A-Z.]+\d{6}[CP]\d+\.US$/.test(symbol) ? 100 : 1;
}

function methodLabel(method: string, lang: Lang): string {
  if (method === "fifo") return "FIFO";
  if (method === "lifo") return lang === "zh" ? "后进先出" : "LIFO";
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
  if (method === "lifo") {
    if (lang === "zh") {
      return "后进先出：每次卖出优先消耗卖出前最近买入且仍有剩余的批次。不会使用卖出之后发生的买入。";
    }
    return "Last in, first out: each sale consumes the latest remaining buy lots available before the sale. Buys after the sale are never used.";
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
  if (policy === "per_sale") return lang === "zh" ? "盈利计税（亏损不抵）" : "Gain-only";
  if (policy === "symbol_net") return lang === "zh" ? "同标的抵扣" : "Same-symbol netting";
  if (policy === "portfolio_net") return lang === "zh" ? "盈亏相抵" : "Portfolio netting";
  return policy;
}

function schemeKeyFor(costMethod: string, lossPolicy: string): string {
  return `${costMethod}:${lossPolicy}`;
}

function lossDescription(policy: string, lang: Lang): string {
  if (policy === "per_sale") {
    if (lang === "zh") return "逐笔计算每次卖出收益，单笔亏损不抵扣其他卖出收益；只有正收益进入应税收益。";
    return "Each sale is evaluated separately. Loss-making sales do not offset other gains; only positive sale gains are taxable.";
  }
  if (policy === "symbol_net") {
    if (lang === "zh") return "先按同一标的汇总全年卖出收益和亏损；只允许同标的内部亏损抵扣盈利。";
    return "Gains and losses are netted within the same symbol only.";
  }
  if (policy === "portfolio_net") {
    if (lang === "zh") return "先汇总组合内全部标的的全年收益和亏损，亏损可以抵扣其他标的盈利；组合净额小于 0 时按 0 计入应税收益。";
    return "Gains and losses are netted across the portfolio. A negative portfolio net contributes 0 taxable gain.";
  }
  if (lang === "zh") return "用于决定亏损是否可以抵扣其他卖出收益的计算口径。";
  return "Determines whether losses can offset other sale gains.";
}

function taxableDescription(scheme: TaxScheme, lang: Lang): string {
  if (lang === "zh") {
    return `资本应税收益为 ${money(scheme.capital_taxable_gain_cny)}，按 20% 测算资本税额 ${money(scheme.capital_tax_cny)}；再加股息税，并扣除可用境外税抵免。`;
  }
  return `Capital taxable gain is ${money(scheme.capital_taxable_gain_cny)}. Capital tax is estimated at 20% (${money(
    scheme.capital_tax_cny,
  )}), then dividend tax is added and available foreign tax credit is deducted.`;
}

function riskClass(scheme: TaxScheme): string {
  if (scheme.is_explainable) return "border-[var(--green)]/35 bg-[var(--green)]/10 text-[var(--green)]";
  if (scheme.risk_level === "aggressive") return "border-[var(--red)]/35 bg-[var(--red)]/10 text-[var(--red)]";
  return "border-[var(--amber)]/35 bg-[var(--amber)]/10 text-[var(--amber)]";
}

export function CrsTax() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [urlParams, setUrlParams] = useSearchParams();
  const initialYear = Number(urlParams.get("year"));
  const rawScrollYRef = useRef<number | null>(null);
  const [lang, setLang] = useState<Lang>(urlParams.get("lang") === "en" ? "en" : "zh");
  const [year, setYear] = useState(Number.isFinite(initialYear) && initialYear >= 2000 ? initialYear : Math.min(2025, currentYear));
  const [rawKind, setRawKind] = useState<(typeof rawKinds)[number]>("executions");
  const [rawPage, setRawPage] = useState(0);
  const [rawPageSize, setRawPageSize] = useState<number | "all">(20);
  const [rawSearch, setRawSearch] = useState("");
  const [rawOrderMonth, setRawOrderMonth] = useState<number | "all">("all");
  const [rawOrderSide, setRawOrderSide] = useState("");
  const [rawExecutionSide, setRawExecutionSide] = useState("");
  const [rawTradeTimeOrder, setRawTradeTimeOrder] = useState<RawTradeTimeOrder>("desc");
  const [expandedRawLink, setExpandedRawLink] = useState<ExpandedRawLink>(null);
  const [showSchemeComparison, setShowSchemeComparison] = useState(false);
  const [selectedSchemeKey, setSelectedSchemeKey] = useState(() => normalizeSchemeKey(urlParams.get("scheme_key")));
  const [collectStartedAt, setCollectStartedAt] = useState<number | null>(null);
  const [collectProgress, setCollectProgress] = useState(0);
  const [longbridgeTokenInput, setLongbridgeTokenInput] = useState("");

  const reportQuery = useQuery({
    queryKey: ["tax-report", year],
    queryFn: () => fetchTaxReport(year),
    refetchInterval: 60_000,
  });
  const collectJobsQuery = useQuery({
    queryKey: ["collect-jobs"],
    queryFn: () => fetchCollectJobs(80),
    refetchInterval: collectStartedAt ? 2_000 : 60_000,
  });

  useEffect(() => {
    if (!urlParams.has("filing_month")) return;
    const nextParams = new URLSearchParams(urlParams);
    nextParams.delete("filing_month");
    setUrlParams(nextParams, { replace: true });
  }, [setUrlParams, urlParams]);

  useEffect(() => {
    const nextParams = new URLSearchParams(urlParams);
    let changed = false;
    if (nextParams.get("year") !== String(year)) {
      nextParams.set("year", String(year));
      changed = true;
    }
    if (nextParams.get("scheme_key") !== selectedSchemeKey) {
      nextParams.set("scheme_key", selectedSchemeKey);
      changed = true;
    }
    if (nextParams.get("lang") !== lang) {
      nextParams.set("lang", lang);
      changed = true;
    }
    if (changed) {
      setUrlParams(nextParams, { replace: true });
    }
  }, [lang, selectedSchemeKey, setUrlParams, urlParams, year]);

  const rawLimit = rawPageSize === "all" ? rawAllPageSize : rawPageSize;
  const rawOffset = rawPageSize === "all" ? 0 : rawPage * rawLimit;

  const rawSide = rawKind === "executions" ? rawExecutionSide : rawKind === "orders" ? rawOrderSide : "";
  const rawQuery = useQuery({
    queryKey: [
      "tax-raw",
      rawKind,
      year,
      rawPage,
      rawPageSize,
      rawSearch.trim(),
      rawOrderMonth,
      rawSide,
      rawTradeTimeOrder,
    ],
    queryFn: () =>
      fetchTaxRaw(
        rawKind,
        rawLimit,
        year,
        rawOffset,
        rawSearch.trim(),
        rawKind === "orders" ? rawOrderMonth : "all",
        rawSide,
        rawKind === "executions" ? rawTradeTimeOrder : undefined,
      ),
  });
  const relatedRawQuery = useQuery({
    queryKey: ["tax-raw-related", expandedRawLink?.relatedKind, year, expandedRawLink?.orderId],
    queryFn: () => fetchTaxRaw(expandedRawLink?.relatedKind ?? "executions", 20, year, 0, expandedRawLink?.orderId ?? ""),
    enabled: expandedRawLink !== null,
  });
  const latestTaxCollectJob = useMemo(() => {
    const startedAt = collectStartedAt ? collectStartedAt - 5_000 : 0;
    return (collectJobsQuery.data ?? [])
      .filter((job) => {
        if (job.job_type !== "tax") return false;
        const jobStartedAt = new Date(job.started_at ?? job.created_at).getTime();
        return Number.isFinite(jobStartedAt) && jobStartedAt >= startedAt;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  }, [collectJobsQuery.data, collectStartedAt]);

  useEffect(() => {
    setRawPage(0);
  }, [rawKind, year, rawPageSize, rawSearch, rawOrderMonth, rawOrderSide, rawExecutionSide, rawTradeTimeOrder]);

  useEffect(() => {
    setExpandedRawLink(null);
  }, [rawKind, year, rawSearch, rawSide, rawTradeTimeOrder]);

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
    onMutate: () => {
      setCollectStartedAt(Date.now());
      setCollectProgress(6);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["collect-jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["tax-report", year] });
      void queryClient.invalidateQueries({ queryKey: ["tax-raw"] });
      [2_000, 6_000, 15_000, 30_000].forEach((delay) => {
        window.setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ["collect-jobs"] });
          void queryClient.invalidateQueries({ queryKey: ["tax-report", year] });
          void queryClient.invalidateQueries({ queryKey: ["tax-raw"] });
        }, delay);
      });
    },
    onError: () => {
      setCollectProgress(100);
      window.setTimeout(() => {
        setCollectStartedAt(null);
        setCollectProgress(0);
      }, 1_500);
    },
  });
  const tokenMutation = useMutation({
    mutationFn: () => updateLongbridgeToken(longbridgeTokenInput.trim()),
    onSuccess: () => {
      setLongbridgeTokenInput("");
    },
  });

  useEffect(() => {
    if (!collectStartedAt) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - collectStartedAt;
      const nextProgress = Math.min(95, 8 + Math.floor((elapsed / 30_000) * 87));
      setCollectProgress((current) => Math.max(current, nextProgress));
    }, 500);
    return () => window.clearInterval(timer);
  }, [collectStartedAt]);

  useEffect(() => {
    if (!collectStartedAt || !latestTaxCollectJob) return;
    if (!["completed", "failed"].includes(latestTaxCollectJob.status)) return;
    setCollectProgress(100);
    void queryClient.invalidateQueries({ queryKey: ["collect-jobs"] });
    void queryClient.invalidateQueries({ queryKey: ["tax-report", year] });
    void queryClient.invalidateQueries({ queryKey: ["tax-raw"] });
    const timer = window.setTimeout(() => {
      setCollectStartedAt(null);
      setCollectProgress(0);
    }, latestTaxCollectJob.status === "failed" ? 8_000 : 1_500);
    return () => window.clearTimeout(timer);
  }, [collectStartedAt, latestTaxCollectJob, queryClient, year]);

  const report = reportQuery.data;
  const sortedSchemes = useMemo(
    () =>
      [...(report?.schemes ?? [])].sort((a, b) => {
        const aPriority = a.scheme_key === defaultSchemeKey ? 0 : a.loss_policy === "portfolio_net" ? 1 : 2;
        const bPriority = b.scheme_key === defaultSchemeKey ? 0 : b.loss_policy === "portfolio_net" ? 1 : 2;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return toNumber(a.tax_due_cny) - toNumber(b.tax_due_cny);
      }),
    [report?.schemes],
  );
  const best =
    report?.schemes.find((item) => item.scheme_key === selectedSchemeKey) ??
    report?.schemes.find((item) => item.scheme_key === defaultSchemeKey) ??
    report?.best_scheme ??
    null;
  const selectedMethod = best?.cost_method ?? defaultCostMethod;
  const selectedLossPolicy = best?.loss_policy ?? defaultLossPolicy;
  const rawItems = useMemo(() => {
    if (rawQuery.data?.kind !== rawKind) return [];
    const items = rawQuery.data?.items ?? [];
    if (rawKind !== "orders") return items;
    return items.filter((item) => {
      const quantity = toNumber(item.executed_quantity as number | string | null | undefined);
      const status = String(item.status ?? "");
      return quantity > 0 && !ignoredOrderStatuses.has(status);
    });
  }, [rawKind, rawQuery.data?.items, rawQuery.data?.kind]);
  const rawKeys = rawColumns[rawKind];
  const rawTotal = rawQuery.data?.total ?? 0;
  const rawStart = rawTotal ? rawOffset + 1 : 0;
  const rawEnd = rawPageSize === "all" ? rawTotal : Math.min(rawTotal, rawOffset + rawItems.length);
  const hasPreviousRawPage = rawPageSize !== "all" && rawPage > 0;
  const hasNextRawPage = rawPageSize !== "all" && rawOffset + rawItems.length < rawTotal;
  const t = (key: CopyKey) => copy[lang][key];
  const isCollecting = collectMutation.isPending || collectStartedAt !== null;
  const collectProgressLabel = collectMutation.isPending
    ? t("collectStarting")
    : latestTaxCollectJob?.status === "completed"
      ? t("collectComplete")
      : latestTaxCollectJob?.status === "failed"
        ? t("collectFailed")
        : reportQuery.isFetching || rawQuery.isFetching
          ? t("collectRefreshing")
          : t("collectRunning");
  const collectErrorMessage = latestTaxCollectJob?.status === "failed"
    ? formatCollectError(latestTaxCollectJob.error_message, t("collectTokenInvalidHint"))
    : null;
  const collectErrorIsTokenInvalid =
    latestTaxCollectJob?.status === "failed" && isLongbridgeTokenInvalid(latestTaxCollectJob.error_message);
  const rawKindLabel = (key: (typeof rawKinds)[number]) => {
    if (key === "executions") return t("rawExecutions");
    if (key === "orders") return t("rawOrders");
    if (key === "cashflows") return t("rawCash");
    if (key === "dividends") return t("rawDividends");
    return t("rawFx");
  };
  const rawHeaderLabel = (key: string) => rawHeaderLabels[lang][key] ?? key;
  const rawCellValue = (key: string, value: unknown, item?: Record<string, unknown>) => {
    if (key === "total_amount" && value == null) {
      const price = toNumber(item?.price as number | string | null | undefined);
      const quantity = toNumber(item?.quantity as number | string | null | undefined);
      if (price > 0 && quantity > 0) {
        return formatRawAmountWithCurrency(price * quantity * instrumentMultiplier(item), item);
      }
    }
    if (value == null) return "—";
    const text = String(value);
    if (["side", "status", "direction", "business_type", "kind"].includes(key)) {
      return rawValueLabels[lang][text] ?? text;
    }
    if (rawBeijingTimeKeys.has(key)) {
      return formatBeijingTime(text);
    }
    if (rawDecimalKeys.has(key)) {
      if (key === "total_amount") {
        return formatRawAmountWithCurrency(value, item);
      }
      return toNumber(text).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    return text;
  };
  const toggleRelatedRawRows = (rowKey: string, relatedKind: RawKind, orderId: string) => {
    setExpandedRawLink((current) =>
      current?.key === rowKey ? null : { key: rowKey, relatedKind, orderId },
    );
  };
  const rawCellNode = (key: string, value: unknown, rowKey: string, item: Record<string, unknown>) => {
    if (key === "total_amount" && value == null) {
      const price = toNumber(item.price as number | string | null | undefined);
      const quantity = toNumber(item.quantity as number | string | null | undefined);
      if (price > 0 && quantity > 0) {
        return formatRawAmountWithCurrency(price * quantity * instrumentMultiplier(item), item);
      }
    }
    if (value == null) return "—";
    const text = String(value);
    if (key === "order_id" && rawKind === "orders") {
      return (
        <button
          type="button"
          onClick={() => toggleRelatedRawRows(rowKey, "executions", text)}
          className="max-w-full truncate border-b border-dotted border-[var(--cyan)]/70 text-left text-[var(--cyan)] transition-colors hover:text-[var(--green)]"
        >
          {text}
        </button>
      );
    }
    return rawCellValue(key, value, item);
  };
  const keepRawScrollPosition = () => {
    rawScrollYRef.current = window.scrollY;
  };
  const toggleRawTradeTimeOrder = () => {
    keepRawScrollPosition();
    setRawTradeTimeOrder((current) => (current === "desc" ? "asc" : "desc"));
  };
  const rawHeaderNode = (key: string) => {
    if (rawKind === "executions" && key === "side") {
      return (
        <select
          value={rawExecutionSide}
          onChange={(event) => {
            keepRawScrollPosition();
            setRawExecutionSide(event.target.value);
          }}
          className="max-w-[120px] rounded-md border border-white/[0.08] bg-[#111118] px-2 py-1 font-mono text-xs text-[var(--text-primary)] outline-none transition-colors hover:border-white/[0.16] focus:border-[var(--cyan)]/50"
          aria-label={t("filterSide")}
        >
          <option value="">{rawHeaderLabel(key)}: {t("all")}</option>
          <option value="Buy">{rawHeaderLabel(key)}: {rawValueLabels[lang].Buy}</option>
          <option value="Sell">{rawHeaderLabel(key)}: {rawValueLabels[lang].Sell}</option>
        </select>
      );
    }
    if (rawKind === "executions" && key === "trade_done_at") {
      return (
        <button
          type="button"
          onClick={toggleRawTradeTimeOrder}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-left font-medium text-[var(--text-secondary)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-primary)]"
          aria-label={`${rawHeaderLabel(key)} ${rawTradeTimeOrder === "desc" ? "desc" : "asc"}`}
        >
          <span>{rawHeaderLabel(key)}</span>
          <span className="text-[var(--cyan)]">{rawTradeTimeOrder === "desc" ? "↓" : "↑"}</span>
        </button>
      );
    }
    return rawHeaderLabel(key);
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
              <div className="mt-4 inline-flex flex-col rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono">
                <span className="text-[11px] uppercase tracking-wider text-[var(--text-secondary)]">
                  {t("capitalTaxableGain")}
                </span>
                <span className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                  {money(best?.capital_taxable_gain_cny)}
                </span>
              </div>
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
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={selectedMethod}
                    onChange={(event) => setSelectedSchemeKey(schemeKeyFor(event.target.value, selectedLossPolicy))}
                    disabled={!sortedSchemes.length}
                    className="min-w-[170px] rounded-md border border-white/[0.08] bg-[#111118] px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none transition-colors hover:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {!sortedSchemes.length && <option value="">{t("noReportData")}</option>}
                    {methodOptions.map((method) => (
                      <option key={method} value={method}>
                        {methodLabel(method, lang)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedLossPolicy}
                    onChange={(event) => setSelectedSchemeKey(schemeKeyFor(selectedMethod, event.target.value))}
                    disabled={!sortedSchemes.length}
                    className="min-w-[220px] rounded-md border border-white/[0.08] bg-[#111118] px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none transition-colors hover:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {!sortedSchemes.length && <option value="">{t("noReportData")}</option>}
                    {lossPolicyOptions.map((policy) => (
                      <option key={policy} value={policy}>
                        {lossLabel(policy, lang)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => collectMutation.mutate()}
                    disabled={isCollecting}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--cyan)]/45 bg-[var(--cyan)]/10 px-3 py-2 font-mono text-sm text-[var(--cyan)] transition-colors hover:border-[var(--cyan)]/70 disabled:cursor-wait disabled:opacity-70"
                  >
                    <span className={isCollecting ? "inline-block animate-spin" : ""}>⟳</span>
                    <span>{isCollecting ? collectProgressLabel : t("collect")}</span>
                  </button>
                </div>
                {(isCollecting || collectErrorMessage) && (
                  <div className="mt-3 max-w-[560px] rounded-md border border-[var(--cyan)]/20 bg-[var(--cyan)]/5 p-3">
                    {isCollecting && (
                      <>
                        <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-[var(--text-secondary)]">
                          <span>{collectProgressLabel}</span>
                          <span className="text-[var(--cyan)]">{Math.round(collectProgress)}%</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                          <div
                            className="h-full rounded-full bg-[var(--cyan)] transition-all duration-500"
                            style={{ width: `${Math.max(4, collectProgress)}%` }}
                          />
                        </div>
                      </>
                    )}
                    {collectErrorMessage && (
                      <div className="mt-3 rounded-md border border-[var(--red)]/25 bg-[var(--red)]/10 px-3 py-2 font-mono text-[11px] leading-5 text-[var(--text-primary)]">
                        <div className="font-semibold text-[var(--red)]">{t("collectErrorTitle")}</div>
                        <div className="mt-1 break-words text-[var(--text-secondary)]">{collectErrorMessage}</div>
                        {collectErrorIsTokenInvalid && (
                          <form
                            className="mt-3 space-y-2 border-t border-[var(--red)]/20 pt-3"
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (longbridgeTokenInput.trim()) {
                                tokenMutation.mutate();
                              }
                            }}
                          >
                            <div className="font-semibold text-[var(--text-primary)]">{t("tokenRefreshTitle")}</div>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <input
                                value={longbridgeTokenInput}
                                onChange={(event) => setLongbridgeTokenInput(event.target.value)}
                                className="min-h-9 flex-1 rounded-md border border-white/[0.08] bg-[var(--bg-input)] px-3 font-mono text-xs text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--cyan)]/60"
                                type="password"
                                autoComplete="off"
                                placeholder={t("tokenRefreshPlaceholder")}
                              />
                              <button
                                type="submit"
                                disabled={tokenMutation.isPending || !longbridgeTokenInput.trim()}
                                className="min-h-9 rounded-md border border-[var(--cyan)]/40 bg-[var(--cyan)]/10 px-3 font-mono text-xs text-[var(--cyan)] transition-colors hover:border-[var(--cyan)]/70 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {tokenMutation.isPending ? t("tokenRefreshSaving") : t("tokenRefreshSubmit")}
                              </button>
                            </div>
                            {tokenMutation.isSuccess && tokenMutation.data && (
                              <div className="text-[var(--green)]">
                                {t("tokenRefreshSuccess")}: {tokenMutation.data.token_preview ?? "****"}
                              </div>
                            )}
                            {tokenMutation.isError && (
                              <div className="break-words text-[var(--red)]">
                                {t("tokenRefreshError")}: {tokenMutation.error.message}
                              </div>
                            )}
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {best && (
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/crs-tax/cost-trace?year=${year}&scheme_key=${encodeURIComponent(
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
                {t("calculationRules")}
              </p>
            </div>
            <span
              className={`rounded-md border px-2 py-1 font-mono text-[11px] uppercase ${best ? riskClass(best) : "border-white/[0.08] text-[var(--text-secondary)]"}`}
            >
              {report?.status ?? "empty"}
            </span>
          </div>
          {best && (
            <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-4 font-mono text-xs leading-5">
              <RuleBlock label={t("costMethodRule")} value={methodDescription(best.cost_method, lang)} />
              <RuleBlock label={t("lossPolicyRule")} value={lossDescription(best.loss_policy, lang)} />
              <RuleBlock label={t("taxableRule")} value={taxableDescription(best, lang)} />
            </div>
          )}
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            <MiniStat label={t("annualSellAmount")} value={money(report?.annual_sell_amount_cny)} />
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
            {Object.entries(report?.tax_fx_rates ?? {}).length ? (
              Object.entries(report?.tax_fx_rates ?? {}).map(([currency, rate]) => {
                const usedDate = report?.tax_fx_rate_dates?.[currency];
                const isEstimated = Boolean(report?.estimated_fx_rates?.includes(currency));
                return (
                <div key={currency} className="flex items-start justify-between gap-4">
                  <span className="text-[var(--text-secondary)]">
                    {currency}/CNY {t("fxRate")}
                  </span>
                  <span className="text-right text-[var(--text-primary)]">
                    <span>{formatFxRate(rate)}</span>
                    {isEstimated && usedDate ? (
                      <span className="block text-[11px] text-[var(--amber)]">
                        {t("estimatedFxRate")} {usedDate}
                      </span>
                    ) : null}
                  </span>
                </div>
                );
              })
            ) : (
              <div className="rounded-md border border-[var(--amber)]/30 bg-[var(--amber)]/10 p-2 text-[var(--amber)]">
                {t("noFxRate")}
              </div>
            )}
            <p className="border-t border-white/[0.06] pt-3 text-[var(--text-secondary)]">
              {t("fxSource")}
            </p>
          </div>
        </GlassCard>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassCard className="p-4">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
            {t("incomeSplit")}
          </p>
          <div className="mt-4 space-y-3">
            <SplitRow label={t("capitalTax")} value={money(best?.capital_tax_cny)} />
            <SplitRow label={t("matchedSaleQty")} value={compactDecimal(best?.matched_sale_quantity)} />
            <SplitRow label={t("unmatchedSaleQty")} value={compactDecimal(best?.unmatched_sale_quantity)} />
            <SplitRow label={t("dividendIncome")} value={money(best?.dividend_income_cny)} />
            <SplitRow label={t("dividendTax")} value={money(best?.dividend_tax_cny)} />
            <SplitRow label={t("foreignTaxPaid")} value={money(best?.foreign_tax_paid_cny)} />
            <SplitRow label={t("netTaxDue")} value={money(best?.tax_due_cny)} accent />
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
            {t("moneyMarketLens")}
          </p>
          <div className="mt-4 space-y-3">
            <SplitRow label={t("moneyMarketSubscription")} value={money(report?.money_market?.subscription_cny)} />
            <SplitRow label={t("moneyMarketRedemption")} value={money(report?.money_market?.redemption_cny)} />
            <SplitRow label={t("moneyMarketNet")} value={money(report?.money_market?.net_cashflow_cny)} accent />
            <SplitRow label={t("moneyMarketTransactions")} value={String(report?.money_market?.transaction_count ?? 0)} />
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
            {t("economicFxLens")}
          </p>
          <div className="mt-4 space-y-3">
            <SplitRow label={t("eventDateCashValue")} value={money(report?.economic_fx?.event_date_cash_value_cny)} />
            <SplitRow label={t("observableFxEffect")} value={money(report?.economic_fx?.observable_fx_effect_cny)} />
            <SplitRow label={t("observableCashFlows")} value={String(report?.economic_fx?.observable_cash_flow_count ?? 0)} />
            <SplitRow label={t("executionsMetric")} value={String(report?.raw_counts?.executions ?? 0)} />
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
                          `/crs-tax/cost-trace?year=${year}&scheme_key=${encodeURIComponent(
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
            <input
              type="search"
              value={rawSearch}
              onChange={(event) => setRawSearch(event.target.value)}
              placeholder={t("rawSearch")}
              className="min-w-[240px] rounded-md border border-white/[0.08] bg-[#111118] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-secondary)] hover:border-white/[0.16] focus:border-[var(--cyan)]/50"
            />
            {rawKind === "orders" && (
              <>
                <select
                  value={String(rawOrderMonth)}
                  onChange={(event) => setRawOrderMonth(event.target.value === "all" ? "all" : Number(event.target.value))}
                  className="rounded-md border border-white/[0.08] bg-[#111118] px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
                  aria-label={t("filterMonth")}
                >
                  <option value="all">{t("filterMonth")}: {t("all")}</option>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                    <option key={month} value={month}>
                      {t("filterMonth")}: {month}
                    </option>
                  ))}
                </select>
                <select
                  value={rawOrderSide}
                  onChange={(event) => setRawOrderSide(event.target.value)}
                  className="rounded-md border border-white/[0.08] bg-[#111118] px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
                  aria-label={t("filterSide")}
                >
                  <option value="">{t("filterSide")}: {t("all")}</option>
                  <option value="Buy">{t("filterSide")}: {rawValueLabels[lang].Buy}</option>
                  <option value="Sell">{t("filterSide")}: {rawValueLabels[lang].Sell}</option>
                </select>
              </>
            )}
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
                    {rawHeaderNode(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rawItems.map((item, index) => {
                const rowId =
                  rawKind === "executions"
                    ? String(item.trade_id ?? item.order_id ?? index)
                    : String(item.order_id ?? item.trade_id ?? index);
                const rowKey = `${rawKind}-${rowId}`;
                return (
                  <Fragment key={rowKey}>
                    <tr className="border-t border-white/[0.04]">
                      {rawKeys.map((key) => (
                        <td key={key} className="max-w-[220px] truncate px-4 py-3 text-[var(--text-secondary)]">
                          {rawCellNode(key, item[key], rowKey, item)}
                        </td>
                      ))}
                    </tr>
                    {expandedRawLink?.key === rowKey && (
                      <tr className="border-t border-white/[0.04] bg-white/[0.015]">
                        <td colSpan={Math.max(rawKeys.length, 1)} className="px-4 py-3">
                          <RelatedRawRows
                            kind={expandedRawLink.relatedKind}
                            items={relatedRawQuery.data?.items ?? []}
                            loading={relatedRawQuery.isLoading}
                            headerLabel={rawHeaderLabel}
                            cellValue={rawCellValue}
                            emptyText={t("noRawRows")}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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

function RuleBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-white/[0.04] pb-3 last:border-b-0 last:pb-0">
      <span className="text-[var(--text-primary)]">{label}</span>
      <span className="text-[var(--text-secondary)]">{value}</span>
    </div>
  );
}

function RelatedRawRows({
  kind,
  items,
  loading,
  headerLabel,
  cellValue,
  emptyText,
}: {
  kind: RawKind;
  items: Record<string, unknown>[];
  loading: boolean;
  headerLabel: (key: string) => string;
  cellValue: (key: string, value: unknown, item?: Record<string, unknown>) => string;
  emptyText: string;
}) {
  const keys = rawColumns[kind];
  if (loading) {
    return <p className="font-mono text-xs text-[var(--text-secondary)]">Loading...</p>;
  }
  if (!items.length) {
    return <p className="font-mono text-xs text-[var(--text-secondary)]">{emptyText}</p>;
  }
  return (
    <div className="overflow-auto rounded-md border border-white/[0.06] bg-black/[0.12]">
      <table className="w-full min-w-[720px] text-left font-mono text-[11px]">
        <thead className="text-[var(--text-secondary)]">
          <tr>
            {keys.map((key) => (
              <th key={key} className="px-3 py-2 font-medium">
                {headerLabel(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={index} className="border-t border-white/[0.04]">
              {keys.map((key) => (
                <td key={key} className="max-w-[220px] truncate px-3 py-2 text-[var(--text-secondary)]">
                  {cellValue(key, item[key], item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
