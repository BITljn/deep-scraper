import { client } from "./client";
import type { BacktestResult } from "./types";

export async function fetchBacktestResults(
  symbol: string,
  indicator?: string,
  window?: string,
): Promise<BacktestResult[]> {
  const { data } = await client.get<BacktestResult[]>("/backtest/results", {
    params: {
      symbol,
      ...(indicator !== undefined ? { indicator_name: indicator } : {}),
      ...(window !== undefined ? { window } : {}),
    },
  });
  return data;
}

export async function triggerBacktest(_symbol: string): Promise<{ status: string }> {
  void _symbol;
  const { data } = await client.post<{ status: string }>("/backtest/run");
  return data;
}
