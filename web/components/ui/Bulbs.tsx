import type { CSSProperties } from "react";

const bulbColors = [
  { fill: "#ffe9a8", glow: "#ffd23f" },
  { fill: "#ff8a9b", glow: "#ff4f6f" },
  { fill: "#8ceedd", glow: "#35d4b9" },
];

/** Row of blinking marquee bulbs, absolutely positioned by the parent. */
export function Bulbs({
  count = 4,
  size = 8,
  color,
  className = "",
  style,
}: {
  count?: number;
  size?: number;
  /** Single color for all bulbs (e.g. modal header white); default multicolor. */
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`flex justify-between ${className}`} style={style} aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const c = color
          ? { fill: color, glow: color }
          : bulbColors[i % bulbColors.length];
        return (
          <div
            key={i}
            style={{
              width: size,
              height: size,
              borderRadius: 99,
              background: c.fill,
              boxShadow: `0 0 ${size}px ${c.glow}`,
              animation: `bulb 1s ${(i * 0.25) % 1}s infinite`,
            }}
          />
        );
      })}
    </div>
  );
}
