import { client } from "./client";
import type { Tweet } from "./types";

export async function fetchTweets(
  username: string,
  limit = 50,
  teslaOnly = false,
): Promise<Tweet[]> {
  const { data } = await client.get<Tweet[]>("/tweets", {
    params: { username, limit, tesla_only: teslaOnly },
  });
  return data;
}
