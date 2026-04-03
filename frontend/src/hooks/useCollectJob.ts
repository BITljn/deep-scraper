import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { fetchCollectJob, triggerCollect } from "@/api/collect";

const POLL_MS = 2000;

function isActiveStatus(status: string): boolean {
  return status === "pending" || status === "running";
}

export function useCollectJob() {
  const queryClient = useQueryClient();
  const [activeJobId, setActiveJobId] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: ({ jobType, symbol }: { jobType: string; symbol: string }) =>
      triggerCollect(jobType, symbol),
    onSuccess: (job) => {
      setActiveJobId(job.id);
      void queryClient.invalidateQueries({ queryKey: ["collect-jobs"] });
    },
  });

  const jobQuery = useQuery({
    queryKey: ["collect-job", activeJobId],
    queryFn: () => fetchCollectJob(activeJobId!),
    enabled: activeJobId !== null,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s && isActiveStatus(s)) {
        return POLL_MS;
      }
      return false;
    },
  });

  const trigger = useCallback(
    (jobType: string, symbol: string) => {
      mutation.mutate({ jobType, symbol });
    },
    [mutation],
  );

  const isCollecting =
    mutation.isPending ||
    (jobQuery.data !== undefined && isActiveStatus(jobQuery.data.status));

  return {
    trigger,
    isCollecting,
    job: jobQuery.data ?? mutation.data ?? null,
    error: (mutation.error ?? jobQuery.error) as Error | null,
  };
}
