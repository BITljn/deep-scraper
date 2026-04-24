export interface Quote {
  id: number;
  symbol: string;
  last_price: number | string | null;
  open: number | string | null;
  high: number | string | null;
  low: number | string | null;
  volume: number | null;
  turnover: number | string | null;
  change_rate: number | string | null;
  market_cap: number | string | null;
  fetched_at: string;
}

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

export interface Topic {
  id: number;
  symbol: string;
  title: string;
  description: string | null;
  url: string | null;
  published_at: string;
  comments_count: number | null;
  likes_count: number | null;
  shares_count: number | null;
}

export interface Tweet {
  id: number;
  username: string;
  text: string;
  published_at: string;
  likes_count: number | null;
  retweets_count: number | null;
  replies_count: number | null;
  is_tesla_related: boolean;
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

export interface SentimentScore {
  id: number;
  source_type: string;
  source_id: number;
  text_snippet: string | null;
  score: number | string | null;
  label: string | null;
}

export interface SentimentComment {
  id: number;
  source_type: string;
  source_id: string;
  score: number;
  label: string;
  title: string;
  body: string;
  author: string | null;
  published_at: string | null;
  likes_count: number;
  comments_count: number;
  computed_at: string;
}

export interface SentimentCommentsResponse {
  total: number;
  items: SentimentComment[];
}

export interface IndicatorData {
  id: number;
  symbol: string;
  ts: string;
  bucket_size: string;
  dhi_raw: number | string | null;
  dhi_zscore: number | string | null;
  sps_mean: number | string | null;
  sps_std: number | string | null;
  sps_count: number | null;
  em_like_comment_ratio: number | string | null;
  em_share_rate: number | string | null;
  em_reply_depth_avg: number | string | null;
  ms_tweet_count: number | null;
  ms_sentiment: number | string | null;
  ms_tesla_mention: boolean | null;
  vix_level: number | string | null;
  vix_change: number | string | null;
  vix_regime: string | null;
  tarco_score: number | string | null;
  tarco_signal: string | null;
}

export interface BacktestResult {
  id: number;
  symbol: string;
  indicator_name: string;
  window: string;
  start_date: string;
  end_date: string;
  pearson_corr: number | string | null;
  spearman_corr: number | string | null;
  signal_accuracy: number | string | null;
  avg_return: number | string | null;
  sharpe_ratio: number | string | null;
  max_drawdown: number | string | null;
  total_signals: number | null;
  computed_at?: string;
}

export interface Fundamentals {
  symbol: string;
  market_cap: number | null;
  pe_ratio: number | null;
  forward_pe: number | null;
  eps: number | null;
  roe: number | null;
  revenue: number | null;
  profit_margin: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  beta: number | null;
  dividend_yield: number | null;
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
}

export interface ArkTrade {
  date: string;
  fund: string;
  ticker: string;
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
