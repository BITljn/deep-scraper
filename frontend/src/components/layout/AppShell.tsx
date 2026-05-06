import type { ReactNode } from "react";
import { NavBar } from "./NavBar";
import { StatusBar } from "./StatusBar";

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-primary)]">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background: "var(--bg-overlay)",
        }}
      />
      <div className="flex min-h-0 min-h-screen flex-1">
        <NavBar />
        <main className="min-h-0 flex-1 overflow-auto p-6 pb-10">{children}</main>
      </div>
      <StatusBar />
    </div>
  );
}
