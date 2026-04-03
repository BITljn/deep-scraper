import { useQuery } from "@tanstack/react-query";
import { fetchCollectJobs } from "@/api/collect";

type Freshness = "fresh" | "stale" | "old";

function freshnessFromIso(iso: string | null | undefined): Freshness {
  if (!iso) {
    return "old";
  }
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) {
    return "old";
  }
  const ageMin = (Date.now() - t) / 60_000;
  if (ageMin < 5) {
    return "fresh";
  }
  if (ageMin < 30) {
    return "stale";
  }
  return "old";
}

function Dot({ state }: { state: Freshness }) {
  const cls =
    state === "fresh"
      ? "bg-[var(--green)] shadow-[0_0_8px_rgba(0,255,136,0.5)]"
      : state === "stale"
        ? "bg-[var(--amber)] shadow-[0_0_8px_rgba(255,170,0,0.45)]"
        : "bg-[var(--red)] shadow-[0_0_8px_rgba(255,51,102,0.45)]";
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
}

const SOURCES = [
  { key: "quote", label: "Quotes" },
  { key: "topic", label: "Topics" },
  { key: "tweet", label: "Tweets" },
  { key: "vix", label: "VIX" },
] as const;

export function StatusBar() {
  const { data: jobs = [] } = useQuery({
    queryKey: ["collect-jobs"],
    queryFn: () => fetchCollectJobs(80),
    refetchInterval: 60_000,
  });

  const lastByType = new Map<string, string>();
  jobs.forEach((j) => {
    if (j.status !== "completed" || !j.completed_at) {
      return;
    }
    const prev = lastByType.get(j.job_type);
    if (!prev || new Date(j.completed_at) > new Date(prev)) {
      lastByType.set(j.job_type, j.completed_at);
    }
  });

  return (
    <footer className="flex h-8 shrink-0 items-center gap-6 border-t border-[var(--border-subtle)] bg-[rgba(6,6,10,0.92)] px-4 text-[11px] text-[var(--text-secondary)] backdrop-blur-md">
      <span className="font-mono uppercase tracking-wider text-[var(--text-secondary)]">Telemetry</span>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        {SOURCES.map((s) => {
          const iso = lastByType.get(s.key) ?? null;
          const fr = freshnessFromIso(iso);
          const label = iso ? new Date(iso).toLocaleTimeString() : "—";
          return (
            <div key={s.key} className="flex items-center gap-2">
              <Dot state={fr} />
              <span className="text-[var(--text-primary)]">{s.label}</span>
              <span className="font-mono text-[var(--text-secondary)]">{label}</span>
            </div>
          );
        })}
      </div>
    </footer>
  );
}
