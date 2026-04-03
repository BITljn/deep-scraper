export function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) {
    return 0;
  }
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : 0;
  }
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) {
    return "—";
  }
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 48) {
    return `${h}h ago`;
  }
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
