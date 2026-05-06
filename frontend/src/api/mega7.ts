import { client } from "./client";
import type { Mega7PeResponse } from "./types";

export async function fetchMega7Pe(
  symbol = "AAPL",
  years = 10,
  refresh = false,
): Promise<Mega7PeResponse> {
  const { data } = await client.get<Mega7PeResponse>("/mega7/pe", {
    params: { symbol, years, refresh },
  });
  return data;
}
