"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { common } from "./common";
import { screens } from "./screens";
import { games } from "./games";

export type Locale = "en" | "pt-BR";

const storageKey = "gemu:locale";

const dictionaries: Record<Locale, Record<string, string>> = {
  en: { ...common.en, ...screens.en, ...games.en },
  "pt-BR": { ...common["pt-BR"], ...screens["pt-BR"], ...games["pt-BR"] },
};

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue>({
  locale: "en",
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(storageKey);
    } catch {
      // Sandboxed frame without storage: keep the default.
    }
    // Deliberate post-hydration set: SSR always renders "en"; switching in an
    // initializer would cause a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "en" || saved === "pt-BR") setLocaleState(saved);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Not persisted; still switches for this page.
    }
  }, []);

  // Keep <html lang> in step with the UI language (screen readers, hyphens).
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      // Fall back en -> key so a missing translation shows something readable.
      let text = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
      }
      return text;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
