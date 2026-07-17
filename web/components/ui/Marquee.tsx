import type { ReactNode } from "react";
import { Bulbs } from "./Bulbs";

/** Bulb-framed marquee box — reserved for drumroll moments (game pick, vote
 *  winner, podium). Caption on top, slab title below. */
export function Marquee({
  caption,
  children,
  className = "",
}: {
  caption?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative inline-block rounded-2xl border-[3px] border-(--accent) bg-(--panel) px-9 pb-4 pt-3.5 ${className}`}
    >
      <Bulbs className="absolute -top-1.5 left-3.5 right-3.5" />
      <Bulbs className="absolute -bottom-1.5 left-3.5 right-3.5" />
      {caption ? (
        <div className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-(--accent-2)">
          {caption}
        </div>
      ) : null}
      <div className="slab text-center text-3xl">{children}</div>
    </div>
  );
}
