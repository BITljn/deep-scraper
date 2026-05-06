export interface Candlestick {
  id: number;
  symbol: string;
  period: string;
  ts: string;
  open: number | string | null;
  high: number | string | null;
  low: number | string | null;
  close: number | string | null;
  volume: number | null;
  turnover: number | string | null;
}

export interface VixData {
  id: number;
  ts: string;
  open: number | string | null;
  high: number | string | null;
  low: number | string | null;
  close: number | string | null;
  period: string;
  fetched_at?: string;
}

export interface MarketCapGdpPoint {
  date: string;
  market_cap: number | string;
  gdp: number | string;
  ratio: number | string;
}

export interface MarketIndexPoint {
  date: string;
  value: number | string;
}

export interface MarketIndexSeries {
  series_id: string;
  name: string;
  source_url: string;
  items: MarketIndexPoint[];
}

export interface MarketCapGdpResponse {
  source: string;
  source_url: string;
  market_cap_series: string;
  gdp_series: string;
  units: string;
  fetched_at: number;
  years: number;
  items: MarketCapGdpPoint[];
  indices: MarketIndexSeries[];
}

export interface Mega7Symbol {
  symbol: string;
  name: string;
}

export interface Mega7PePoint {
  date: string;
  close: number;
  pe: number | null;
  ttm_eps: number | null;
  eps_report_date: string | null;
  roe: number | null;
  ttm_net_income: number | null;
  equity: number | null;
  equity_report_date: string | null;
}

export interface Mega7PeResponse {
  source: string;
  source_url: string;
  fetched_at: number;
  cache_status: string;
  symbol: string;
  name: string;
  years: number;
  items: Mega7PePoint[];
  symbols: Mega7Symbol[];
}

export interface ArkHolding {
  rank: number;
  ticker: string;
  company_name: string;
  price: number | null;
  price_label: string;
  market_value: number | null;
  market_value_label: string;
  weight: number | null;
  shares?: number | null;
  shares_change?: number | null;
  share_change_pct?: number | null;
  activity?: string;
}

export interface ArkTrade {
  date: string;
  fund: string;
  ticker: string;
  company_name?: string | null;
  direction: string;
  market_value: number | null;
  market_value_label: string;
  percent_of_position: number | null;
  percent_of_etf: number | null;
  current_combined_weight: number | null;
}

export interface ArkTradesSummary {
  source: string;
  source_url: string;
  fetched_at: number;
  latest_date: string | null;
  total_buy_value: number;
  total_sell_value: number;
  net_value: number;
  buy_count: number;
  sell_count: number;
  items: ArkTrade[];
}

export interface ArkHoldingsSummary {
  source: string;
  source_url: string;
  fetched_at: number;
  total_market_value: number;
  top_10_weight: number;
  holdings_count: number;
  items: ArkHolding[];
}

export interface ArkOverview {
  manager: string;
  vehicle: string;
  source: string;
  fetched_at: number;
  report_date?: string;
  previous_report_date?: string | null;
  filing_date?: string;
  holdings: ArkHoldingsSummary;
  trades: ArkTradesSummary;
}

export interface CollectJob {
  id: number;
  job_type: string;
  status: string;
  trigger_type: string;
  started_at: string | null;
  completed_at: string | null;
  records_count: number | null;
  error_message: string | null;
  created_at: string;
}
