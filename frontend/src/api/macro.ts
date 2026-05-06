import { client } from "./client";
import type { MarketCapGdpResponse } from "./types";

export async function fetchMarketCapGdp(
  years = 10,
  indices: string[] = [],
): Promise<MarketCapGdpResponse> {
  const { data } = await client.get<MarketCapGdpResponse>("/macro/market-cap-gdp", {
    params: { years, indices: indices.join(",") || undefined },
  });
  return data;
}
