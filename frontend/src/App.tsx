import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { Route, Routes } from "react-router-dom";
import { fetchCurrentUser, login, logout } from "./api/auth";
import { AppShell } from "./components/layout/AppShell";
import { CrsTax } from "./pages/CrsTax";
import { CrsTaxCostTrace } from "./pages/CrsTaxCostTrace";
import { HoldingsWatch } from "./pages/HoldingsWatch";
import { MarketCapGdp } from "./pages/MarketCapGdp";
import { Mega7Pe } from "./pages/Mega7Pe";
import { VixFear } from "./pages/VixFear";

const DEFAULT_SYMBOL = "TSLA.US";
const REMEMBER_LOGIN_KEY = "tarco-remember-login";
const REMEMBERED_USERNAME_KEY = "tarco-login-username";
const REMEMBERED_PASSWORD_KEY = "tarco-login-password";

function readStoredLogin() {
  if (typeof window === "undefined") {
    return { rememberPassword: false, username: "admin", password: "" };
  }
  try {
    const rememberPassword = window.localStorage.getItem(REMEMBER_LOGIN_KEY) === "true";
    return {
      rememberPassword,
      username: rememberPassword ? window.localStorage.getItem(REMEMBERED_USERNAME_KEY) || "admin" : "admin",
      password: rememberPassword ? window.localStorage.getItem(REMEMBERED_PASSWORD_KEY) || "" : "",
    };
  } catch {
    return { rememberPassword: false, username: "admin", password: "" };
  }
}

function storeLoginPreference(username: string, password: string, rememberPassword: boolean) {
  try {
    if (rememberPassword) {
      window.localStorage.setItem(REMEMBER_LOGIN_KEY, "true");
      window.localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
      window.localStorage.setItem(REMEMBERED_PASSWORD_KEY, password);
      return;
    }
    window.localStorage.removeItem(REMEMBER_LOGIN_KEY);
    window.localStorage.removeItem(REMEMBERED_USERNAME_KEY);
    window.localStorage.removeItem(REMEMBERED_PASSWORD_KEY);
  } catch {
    // Login still works if local storage is blocked.
  }
}

export default function App() {
  const queryClient = useQueryClient();
  const authQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchCurrentUser,
    retry: false,
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(["auth", "me"], null);
      void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });

  if (authQuery.isLoading) {
    return <AuthLoading />;
  }

  if (!authQuery.data) {
    return <LoginPage />;
  }

  return (
    <AppShell onLogout={() => logoutMutation.mutate()} userLabel={authQuery.data.username}>
      <Routes>
        <Route path="/" element={<HoldingsWatch />} />
        <Route path="/holdings" element={<HoldingsWatch />} />
        <Route path="/macro" element={<MarketCapGdp />} />
        <Route path="/mega7" element={<Mega7Pe />} />
        <Route path="/vix" element={<VixFear symbol={DEFAULT_SYMBOL} />} />
        <Route path="/crs-tax" element={<CrsTax />} />
        <Route path="/crs-tax/cost-trace" element={<CrsTaxCostTrace />} />
      </Routes>
    </AppShell>
  );
}

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] text-[var(--text-secondary)]">
      <div className="glass-card px-5 py-4 font-mono text-xs">Checking session...</div>
    </div>
  );
}

function LoginPage() {
  const queryClient = useQueryClient();
  const [storedLogin] = useState(readStoredLogin);
  const [username, setUsername] = useState(storedLogin.username);
  const [password, setPassword] = useState(storedLogin.password);
  const [rememberPassword, setRememberPassword] = useState(storedLogin.rememberPassword);
  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      storeLoginPreference(username, password, rememberPassword);
      queryClient.setQueryData(["auth", "me"], user);
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate({ username, password });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] p-6">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background: "var(--bg-overlay)",
        }}
      />
      <section className="glass-card w-full max-w-[420px] border-[var(--cyan)]/20 p-6">
        <div className="mb-6">
          <p
            className="font-heading text-lg font-bold tracking-tight text-[var(--cyan)]"
            style={{ filter: "drop-shadow(var(--brand-shadow))" }}
          >
            TARCO
          </p>
          <h1 className="mt-3 font-heading text-2xl font-semibold text-[var(--text-primary)]">登录</h1>
          <p className="mt-2 font-mono text-xs leading-5 text-[var(--text-secondary)]">
            输入本地账号密码后进入控制台。
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="font-mono text-xs text-[var(--text-secondary)]">用户名</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-white/[0.08] bg-[var(--bg-input)] px-3 font-mono text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--cyan)]/60"
              autoComplete="username"
            />
          </label>
          <label className="block">
            <span className="font-mono text-xs text-[var(--text-secondary)]">密码</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-white/[0.08] bg-[var(--bg-input)] px-3 font-mono text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--cyan)]/60"
              type="password"
              autoComplete="current-password"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-[var(--text-secondary)]">
            <input
              checked={rememberPassword}
              onChange={(event) => {
                const checked = event.target.checked;
                setRememberPassword(checked);
                if (!checked) {
                  storeLoginPreference(username, password, false);
                }
              }}
              className="h-4 w-4 rounded border-white/[0.16] bg-[var(--bg-input)] accent-[var(--cyan)]"
              type="checkbox"
            />
            记住密码
          </label>

          {loginMutation.isError && (
            <p className="rounded-md border border-[var(--red)]/35 bg-[var(--red)]/10 px-3 py-2 font-mono text-xs text-[var(--red)]">
              用户名或密码不正确
            </p>
          )}

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="h-11 w-full rounded-md border border-[var(--cyan)]/45 bg-[var(--cyan)]/12 px-4 font-mono text-sm font-semibold text-[var(--cyan)] transition-colors hover:border-[var(--cyan)]/70 hover:bg-[var(--cyan)]/18 disabled:cursor-wait disabled:opacity-60"
          >
            {loginMutation.isPending ? "登录中..." : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}
