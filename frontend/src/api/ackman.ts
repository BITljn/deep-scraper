import { client } from "./client";
import type { ArkOverview } from "./types";

export async function fetchAckmanOverview(): Promise<ArkOverview> {
  const { data } = await client.get<ArkOverview>("/ackman/overview", {
    params: { holdings_limit: 100, changes_limit: 100 },
  });
  return data;
}
