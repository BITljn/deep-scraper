import { client } from "./client";
import type { TaxRawResponse, TaxReport } from "./types";

export async function fetchTaxReport(year: number, filingMonth = 6): Promise<TaxReport> {
  const { data } = await client.get<TaxReport>("/tax/report", {
    params: { year, filing_month: filingMonth },
  });
  return data;
}

export async function triggerTaxCollect(input: {
  start_year?: number;
  end_year?: number;
  symbols?: string[];
}): Promise<{ status: string; job_type: string; id?: number | null }> {
  const { data } = await client.post("/tax/collect", input);
  return data;
}

export async function fetchTaxRaw(
  kind: string,
  limit = 20,
  year?: number,
  offset = 0,
  search?: string,
  month?: number | "all",
  side?: string,
  tradeTimeOrder?: "asc" | "desc",
): Promise<TaxRawResponse> {
  const { data } = await client.get<TaxRawResponse>("/tax/raw", {
    params: {
      kind,
      limit,
      year,
      offset,
      search: search || undefined,
      month: month === "all" ? undefined : month,
      side: side || undefined,
      trade_time_order: tradeTimeOrder,
    },
  });
  return data;
}

export async function importTaxFxRates(file: File): Promise<{ imported: number; currencies: string[] }> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await client.post("/tax/fx-rates/import", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120_000,
  });
  return data;
}

export async function fetchTaxFxRates(input: {
  start_date: string;
  end_date: string;
  currencies?: string[];
}): Promise<{
  imported: number;
  currencies: string[];
  by_currency: Record<string, number>;
  source: string;
  source_url: string;
}> {
  const { data } = await client.post("/tax/fx-rates/fetch", {
    currencies: ["USD", "HKD"],
    ...input,
  });
  return data;
}
