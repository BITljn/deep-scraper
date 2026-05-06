import { client } from "./client";
import type { ArkOverview } from "./types";

export async function fetchDuquesneOverview(): Promise<ArkOverview> {
  const { data } = await client.get<ArkOverview>("/duquesne/overview", {
    params: { holdings_limit: 100, changes_limit: 100 },
  });
  return data;
}
