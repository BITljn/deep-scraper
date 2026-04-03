import { client } from "./client";
import type { VixData } from "./types";

export async function fetchLatestVix(period = "day"): Promise<VixData | null> {
  const { data } = await client.get<VixData | null>("/vix/latest", {
    params: { period },
  });
  return data;
}

export async function fetchVix(period = "day", limit = 100): Promise<VixData[]> {
  const { data } = await client.get<VixData[]>("/vix/", {
    params: { period, limit },
  });
  return data;
}
