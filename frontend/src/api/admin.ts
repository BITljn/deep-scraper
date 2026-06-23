import { client } from "./client";

export interface LongbridgeTokenStatus {
  configured: boolean;
  token_preview: string | null;
  env_file: string;
}

export async function fetchLongbridgeTokenStatus(): Promise<LongbridgeTokenStatus> {
  const { data } = await client.get<LongbridgeTokenStatus>("/admin/longbridge-token");
  return data;
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: unknown; status?: number } }).response;
    const data = response?.data;
    if (typeof data === "object" && data !== null && "detail" in data) {
      const detail = (data as { detail?: unknown }).detail;
      if (typeof detail === "string") return detail;
    }
    if (response?.status) return `Request failed with HTTP ${response.status}`;
  }
  if (error instanceof Error) return error.message;
  return "Request failed";
}

export async function updateLongbridgeToken(accessToken: string): Promise<LongbridgeTokenStatus> {
  try {
    const { data } = await client.post<LongbridgeTokenStatus>("/admin/longbridge-token", {
      access_token: accessToken,
    });
    return data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}
