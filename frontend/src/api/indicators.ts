import { client } from "./client";
import type { IndicatorData } from "./types";

export async function fetchIndicators(
  symbol: string,
  bucketSize = "1d",
  limit = 200,
): Promise<IndicatorData[]> {
  const { data } = await client.get<IndicatorData[]>("/indicators/", {
    params: { symbol, bucket_size: bucketSize, limit },
  });
  return data;
}

export async function fetchLatestIndicator(
  symbol: string,
  bucketSize = "1d",
): Promise<IndicatorData | null> {
  const { data } = await client.get<IndicatorData | null>("/indicators/latest", {
    params: { symbol, bucket_size: bucketSize },
  });
  return data;
}
