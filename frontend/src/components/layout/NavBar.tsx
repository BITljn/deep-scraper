import { useLayoutEffect, useState } from "react";
import { NavLink } from "react-router-dom";

const items: { to: string; label: string; icon: string }[] = [
  { to: "/", label: "Holdings", icon: "▤" },
  { to: "/macro", label: "Macro", icon: "◇" },
  { to: "/mega7", label: "Mega 7", icon: "⬡" },
  { to: "/vix", label: "VIX", icon: "△" },
  { to: "/crs-tax", label: "CRS Tax", icon: "¥" },
];

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "tarco-theme";

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function NavBar() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const isLight = theme === "light";

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme still applies for the session if storage is unavailable.
    }
  }, [theme]);

  return (
    <aside className="group/nav flex h-full w-14 flex-col overflow-hidden border-r border-[var(--border-subtle)] bg-[var(--bg-chrome)] backdrop-blur-xl transition-[width] duration-300 ease-out hover:w-[200px]">
      <div className="flex h-14 shrink-0 items-center px-3">
        <span
          className="font-heading whitespace-nowrap text-lg font-bold tracking-tight text-[var(--cyan)]"
          style={{ filter: "drop-shadow(var(--brand-shadow))" }}
        >
          TARCO
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
                isActive
                  ? "border-l-2 border-[var(--cyan)] bg-[var(--nav-active-bg)] text-[var(--cyan)] shadow-[var(--nav-active-shadow)]"
                  : "border-l-2 border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`
            }
          >
            <span className="w-6 shrink-0 text-center text-base">{item.icon}</span>
            <span className="whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover/nav:opacity-100">
              {item.label}
            </span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-[var(--border-subtle)] px-2 py-3">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-md border-l-2 border-transparent px-2 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          title={isLight ? "Switch to night mode" : "Switch to day mode"}
          aria-label={isLight ? "Switch to night mode" : "Switch to day mode"}
          onClick={() => setTheme(isLight ? "dark" : "light")}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] font-mono text-[11px] text-[var(--cyan)]">
            {isLight ? "L" : "D"}
          </span>
          <span className="whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover/nav:opacity-100">
            {isLight ? "Day mode" : "Night mode"}
          </span>
        </button>
      </div>
    </aside>
  );
}
