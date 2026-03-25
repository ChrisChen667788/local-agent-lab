"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  APP_LOCALES,
  LOCALE_LABELS,
  getDictionary,
  normalizeLocale,
  type AppLocale
} from "@/lib/i18n";

type LocaleContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  dictionary: ReturnType<typeof getDictionary>;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>("zh-CN");

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("agent-ui-locale") : null;
    const nextLocale = normalizeLocale(stored || (typeof navigator !== "undefined" ? navigator.language : "zh-CN"));
    setLocaleState(nextLocale);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem("agent-ui-locale", locale);
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale: setLocaleState,
      dictionary: getDictionary(locale)
    }),
    [locale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error("useLocale must be used inside LocaleProvider.");
  }
  return value;
}

export { APP_LOCALES, LOCALE_LABELS };
