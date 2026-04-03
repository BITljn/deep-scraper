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
          background:
            "radial-gradient(ellipse 90% 60% at 50% -10%, rgba(0,212,255,0.07), transparent 50%), radial-gradient(ellipse 70% 50% at 100% 50%, rgba(255,51,102,0.04), transparent 45%)",
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
