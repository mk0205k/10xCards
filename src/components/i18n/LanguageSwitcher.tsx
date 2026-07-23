import { getLocale, locales, setLocale } from "@/paraglide/runtime.js";
import { m } from "@/paraglide/messages.js";
import { cn } from "@/lib/utils";

const LABELS: Record<(typeof locales)[number], () => string> = {
  pl: m.language_pl,
  en: m.language_en,
};

export default function LanguageSwitcher() {
  const active = getLocale();

  return (
    <div
      className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5"
      role="group"
      aria-label={m.language_switcher_label()}
    >
      {locales.map((loc) => {
        const isActive = loc === active;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => {
              if (loc !== active) {
                void setLocale(loc);
              }
            }}
            aria-pressed={isActive}
            className={cn(
              "rounded-md px-2 py-0.5 text-xs font-medium uppercase transition-colors",
              isActive
                ? "bg-purple-500/30 text-purple-100"
                : "text-purple-300/70 hover:bg-white/5 hover:text-purple-100",
            )}
          >
            {LABELS[loc]()}
          </button>
        );
      })}
    </div>
  );
}
