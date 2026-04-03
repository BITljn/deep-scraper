import { client } from "./client";
import type { CollectJob } from "./types";

export async function triggerCollect(jobType: string, symbol: string): Promise<CollectJob> {
  const { data } = await client.post<CollectJob>("/collect", {
    job_type: jobType,
    symbol,
  });
  return data;
}

export async function fetchCollectJobs(limit = 50): Promise<CollectJob[]> {
  const { data } = await client.get<CollectJob[]>("/collect/jobs", {
    params: { limit },
  });
  return data;
}

export async function fetchCollectJob(id: number): Promise<CollectJob> {
  const { data } = await client.get<CollectJob>(`/collect/jobs/${id}`);
  return data;
}
