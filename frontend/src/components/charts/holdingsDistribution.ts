import type { ArkHolding } from "@/api/types";

export type DistributionProfile =
  | "brk"
  | "ark"
  | "hh"
  | "pelosi"
  | "duquesne"
  | "ackman"
  | "situational";
export type AvatarTone = "cyan" | "amber" | "green" | "red" | "violet" | "slate";

export interface DistributionRow {
  color: string;
  companyName: string;
  logoUrl: string | null;
  marketValueLabel: string;
  rank: number;
  ticker: string;
  weight: number;
}

export interface ProfileAvatar {
  initials: string;
  label: string;
  tone: AvatarTone;
}

const COLORS = [
  "#00d4ff",
  "#ffaa00",
  "#00ff88",
  "#ff3366",
  "#a78bfa",
  "#38bdf8",
  "#f472b6",
  "#f97316",
  "#22c55e",
  "#60a5fa",
  "#eab308",
  "#14b8a6",
  "#fb7185",
  "#c084fc",
  "#2dd4bf",
  "#f59e0b",
  "#84cc16",
  "#818cf8",
  "#f43f5e",
  "#64748b",
];

const PROFILE_META: Record<DistributionProfile, Omit<ProfileAvatar, "label">> = {
  brk: { initials: "BRK", tone: "amber" },
  ark: { initials: "ARK", tone: "cyan" },
  hh: { initials: "H&H", tone: "green" },
  pelosi: { initials: "P", tone: "violet" },
  duquesne: { initials: "SD", tone: "red" },
  ackman: { initials: "PSH", tone: "slate" },
  situational: { initials: "SA", tone: "cyan" },
};

const LOGO_DOMAINS: Record<string, string> = {
  AAPL: "apple.com",
  AMD: "amd.com",
  ASML: "asml.com",
  AMZN: "amazon.com",
  AVGO: "broadcom.com",
  AXP: "americanexpress.com",
  BAC: "bankofamerica.com",
  BE: "bloomenergy.com",
  BITF: "bitfarms.com",
  BN: "brookfield.com",
  BRK: "berkshirehathaway.com",
  "BRK.B": "berkshirehathaway.com",
  BTDR: "bitdeer.com",
  CLSK: "cleanspark.com",
  CMG: "chipotle.com",
  COIN: "coinbase.com",
  CORZ: "corescientific.com",
  CP: "cpkcr.com",
  CRWV: "coreweave.com",
  CVX: "chevron.com",
  GLW: "corning.com",
  GOOGL: "google.com",
  GOOG: "google.com",
  HLT: "hilton.com",
  INTC: "intel.com",
  IREN: "iren.com",
  KHC: "kraftheinzcompany.com",
  KO: "coca-cola.com",
  MA: "mastercard.com",
  META: "meta.com",
  MCO: "moodys.com",
  MSFT: "microsoft.com",
  MU: "micron.com",
  NFLX: "netflix.com",
  NVDA: "nvidia.com",
  ORCL: "oracle.com",
  OXY: "oxy.com",
  QSR: "rbi.com",
  RIOT: "riotplatforms.com",
  ROKU: "roku.com",
  SHOP: "shopify.com",
  SMH: "vaneck.com",
  SNDK: "sandisk.com",
  SQ: "block.xyz",
  TSM: "tsmc.com",
  TSLA: "tesla.com",
  UNH: "unitedhealthgroup.com",
  V: "visa.com",
};

export function buildDistributionRows(holdings: ArkHolding[]): DistributionRow[] {
  return holdings
    .filter((holding) => {
      const weight = holding.weight;
      return weight != null && Number.isFinite(weight) && weight > 0;
    })
    .slice(0, 20)
    .map((holding, index) => {
      const ticker = holding.ticker.toUpperCase();
      return {
        color: COLORS[index % COLORS.length]!,
        companyName: holding.company_name,
        logoUrl: logoUrlForTicker(ticker),
        marketValueLabel: holding.market_value_label,
        rank: holding.rank,
        ticker,
        weight: holding.weight ?? 0,
      };
    });
}

export function getProfileAvatar(
  profile: DistributionProfile,
  profileLabel: string,
): ProfileAvatar {
  return {
    ...PROFILE_META[profile],
    label: profileLabel,
  };
}

export function logoUrlForTicker(ticker: string): string | null {
  const domain = LOGO_DOMAINS[ticker.toUpperCase().split(" ")[0] ?? ""];
  return domain ? `https://logo.clearbit.com/${domain}` : null;
}
