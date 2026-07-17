import type { ReactNode } from "react";

/** Edge-state banners (Gemu System · 09). */
export function Banner({
  variant,
  children,
  trailing,
  className = "",
}: {
  variant: "reconnecting" | "kicked" | "waiting";
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  if (variant === "reconnecting") {
    return (
      <div
        className={`flex items-center gap-2.5 rounded-xl border-2 border-(--warn) bg-[#3d2314] px-3.5 py-2.5 ${className}`}
      >
        <span
          className="h-[9px] w-[9px] flex-none rounded-full bg-(--warn)"
          style={{ animation: "bulb 1s infinite" }}
        />
        <span className="text-xs font-semibold text-[#ffcf9e]">{children}</span>
        {trailing ? <span className="ml-auto">{trailing}</span> : null}
      </div>
    );
  }
  if (variant === "kicked") {
    return (
      <div
        className={`flex items-center gap-2.5 rounded-xl border-2 border-(--danger) bg-[#3d1420] px-3.5 py-2.5 ${className}`}
      >
        <span className="text-xs font-semibold text-[#ffb3c1]">{children}</span>
        {trailing ? <span className="ml-auto">{trailing}</span> : null}
      </div>
    );
  }
  return (
    <div
      className={`flex items-center gap-2.5 rounded-xl border-2 border-dashed border-(--line) bg-(--panel) px-3.5 py-2.5 ${className}`}
    >
      <span className="text-xs font-semibold text-(--ink)/60">{children}</span>
      {trailing ? (
        <span className="ml-auto font-mono text-[11px] text-(--accent-2)">{trailing}</span>
      ) : null}
    </div>
  );
}
