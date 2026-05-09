import { client } from "./client";

export interface AuthUser {
  username: string;
}

export async function login(input: { username: string; password: string }): Promise<AuthUser> {
  const { data } = await client.post<AuthUser>("/auth/login", input);
  return data;
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const { data } = await client.get<AuthUser>("/auth/me");
  return data;
}

export async function logout(): Promise<void> {
  await client.post("/auth/logout");
}
