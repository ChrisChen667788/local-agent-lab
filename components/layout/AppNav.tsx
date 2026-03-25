"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_LOCALES, LOCALE_LABELS, useLocale } from "@/components/layout/LocaleProvider";

const links = [
  { href: "/agent", key: "agent" },
  { href: "/admin", key: "dashboard" }
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function AppNav() {
  const pathname = usePathname();
  const { locale, setLocale, dictionary } = useLocale();

  return (
    <nav className="w-full overflow-x-auto border-b border-border bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
        {links.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-full px-3 py-1.5 text-sm transition ${
                active
                  ? "bg-ink text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {link.key === "agent" ? dictionary.nav.agent : dictionary.nav.dashboard}
            </Link>
          );
        })}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
            {dictionary.nav.language}
          </span>
          <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1">
            {APP_LOCALES.map((option) => {
              const active = option === locale;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setLocale(option)}
                  className={`rounded-full px-2.5 py-1 text-xs transition ${
                    active ? "bg-ink text-white" : "text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {LOCALE_LABELS[option]}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
