import { useQuery } from "@tanstack/react-query";
import { fetchIndicators, fetchLatestIndicator } from "@/api/indicators";

const REFETCH_MS = 30_000;

export function useLatestIndicator(symbol: string, bucketSize = "1d") {
  return useQuery({
    queryKey: ["indicator-latest", symbol, bucketSize],
    queryFn: () => fetchLatestIndicator(symbol, bucketSize),
    refetchInterval: REFETCH_MS,
  });
}

export function useIndicators(symbol: string, bucketSize = "1d", limit = 240) {
  return useQuery({
    queryKey: ["indicators", symbol, bucketSize, limit],
    queryFn: () => fetchIndicators(symbol, bucketSize, limit),
    refetchInterval: REFETCH_MS,
  });
}
