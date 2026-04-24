import { client } from "./client";
import type { ArkHoldingsSummary, ArkOverview, ArkTradesSummary } from "./types";

export async function fetchArkTrades(
  limit = 40,
  ticker?: string,
): Promise<ArkTradesSummary> {
  const { data } = await client.get<ArkTradesSummary>("/ark/trades", {
    params: { limit, ticker },
  });
  return data;
}

export async function fetchArkHoldings(limit = 100): Promise<ArkHoldingsSummary> {
  const { data } = await client.get<ArkHoldingsSummary>("/ark/holdings", {
    params: { limit },
  });
  return data;
}

export async function fetchArkOverview(): Promise<ArkOverview> {
  const { data } = await client.get<ArkOverview>("/ark/overview", {
    params: { holdings_limit: 100, trades_limit: 80 },
  });
  return data;
}
