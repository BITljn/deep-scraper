import { NavLink } from "react-router-dom";

const items: { to: string; label: string; icon: string }[] = [
  { to: "/", label: "Holdings", icon: "▤" },
  { to: "/macro", label: "Macro", icon: "◇" },
  { to: "/mega7", label: "Mega 7", icon: "⬡" },
  { to: "/vix", label: "VIX", icon: "△" },
];

export function NavBar() {
  return (
    <aside className="group/nav flex h-full w-14 flex-col overflow-hidden border-r border-[var(--border-subtle)] bg-[rgba(8,8,12,0.85)] backdrop-blur-xl transition-[width] duration-300 ease-out hover:w-[200px]">
      <div className="flex h-14 shrink-0 items-center px-3">
        <span className="font-heading text-lg font-bold tracking-tight text-[var(--cyan)] drop-shadow-[0_0_14px_rgba(0,212,255,0.45)] whitespace-nowrap">
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
                  ? "border-l-2 border-[var(--cyan)] bg-[rgba(0,212,255,0.08)] text-[var(--cyan)] shadow-[inset_0_0_20px_rgba(0,212,255,0.12)]"
                  : "border-l-2 border-transparent text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]"
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
    </aside>
  );
}
