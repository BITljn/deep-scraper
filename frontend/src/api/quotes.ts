import { client } from "./client";
import type { Candlestick, Quote } from "./types";

export async function fetchLatestQuote(symbol: string): Promise<Quote | null> {
  const { data } = await client.get<Quote | null>("/quotes/latest", {
    params: { symbol },
  });
  return data;
}

export async function fetchQuotes(symbol: string, limit = 100): Promise<Quote[]> {
  const { data } = await client.get<Quote[]>("/quotes", {
    params: { symbol, limit },
  });
  return data;
}

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
