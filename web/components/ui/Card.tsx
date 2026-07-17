import type { CSSProperties, HTMLAttributes } from "react";
import { hueFor } from "./gameHues";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: "panel" | "selected" | "hero";
  /** Hue for selected ring / hero fill. */
  gameType?: string;
};

export function Card({
  variant = "panel",
  gameType,
  className = "",
  style,
  children,
  ...rest
}: CardProps) {
  const hue = hueFor(gameType);
  let variantClass = "rounded-2xl p-4";
  let variantStyle: CSSProperties = {};

  if (variant === "panel") {
    variantClass += " bg-(--panel) border-2 border-(--line)";
  } else if (variant === "selected") {
    variantClass += " bg-(--panel)";
    variantStyle = {
      border: `2px solid ${hue.base}`,
      boxShadow: `0 0 0 4px ${hue.base}26`,
    };
  } else if (variant === "hero") {
    variantStyle = {
      background: `linear-gradient(180deg,${hue.gradFrom},${hue.gradTo})`,
      color: hue.ink,
      boxShadow: `0 5px 0 ${hue.drop}`,
    };
  }

  return (
    <div className={`${variantClass} ${className}`} style={{ ...variantStyle, ...style }} {...rest}>
      {children}
    </div>
  );
}
