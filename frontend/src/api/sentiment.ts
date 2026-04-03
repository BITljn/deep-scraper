import { client } from "./client";
import type { SentimentScore, Topic } from "./types";

export interface SentimentSummary {
  sps?: number;
  symbol?: string;
  updated_at?: string;
}

export async function fetchSentimentScores(
  symbol: string,
  limit = 50,
): Promise<SentimentScore[]> {
  const { data } = await client.get<SentimentScore[]>("/sentiment", {
    params: { symbol, limit },
  });
  return data;
}

/** Optional endpoint — falls back client-side if 404. */
export async function fetchSentimentSummary(
  symbol: string,
): Promise<SentimentSummary | null> {
  try {
    const { data } = await client.get<SentimentSummary>("/sentiment/summary", {
      params: { symbol },
    });
    return data;
  } catch {
    return null;
  }
}

export async function fetchTopics(symbol: string, limit = 30): Promise<Topic[]> {
  const { data } = await client.get<Topic[]>("/topics", {
    params: { symbol, limit },
  });
  return data;
}
