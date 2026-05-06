import { client } from "./client";
import type { ArkOverview } from "./types";

export async function fetchBerkshireOverview(): Promise<ArkOverview> {
  const { data } = await client.get<ArkOverview>("/brk/overview", {
    params: { holdings_limit: 100, changes_limit: 100 },
  });
  return data;
}
