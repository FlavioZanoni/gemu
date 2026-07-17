"use client";

import { useI18n, type Locale } from "@/lib/i18n";

export function LangToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  const options: { value: Locale; label: string }[] = [
    { value: "en", label: "EN" },
    { value: "pt-BR", label: "PT-BR" },
  ];
  return (
    <div
      className={`inline-flex rounded-full border-2 border-(--line) bg-(--panel) p-[3px] ${className}`}
      role="group"
      aria-label="Language"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setLocale(option.value)}
          className={`rounded-full px-3.5 py-1.5 font-mono text-xs font-bold transition-colors ${
            locale === option.value ? "bg-(--ink) text-(--bg)" : "text-(--ink)/50"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
