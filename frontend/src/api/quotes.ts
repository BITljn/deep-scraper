import { client } from "./client";
import type { Candlestick } from "./types";

export async function fetchCandlesticks(
  symbol: string,
  period: string,
  limit = 200,
): Promise<Candlestick[]> {
  const { data } = await client.get<Candlestick[]>("/candlesticks", {
    params: { symbol, period, limit },
  });
  return data;
}
