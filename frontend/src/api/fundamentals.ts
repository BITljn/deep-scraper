import { client } from "./client";
import type { Fundamentals } from "./types";

export async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  const { data } = await client.get<Fundamentals>("/fundamentals/", {
    params: { symbol },
  });
  return data;
}
