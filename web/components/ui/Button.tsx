"use client";

import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { hueFor } from "./gameHues";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "hue";
  size?: "md" | "lg" | "sm";
  /** For variant="hue": which game's palette to wear. */
  gameType?: string;
};

const sizeClasses = {
  sm: "px-4 py-2 text-xs",
  md: "px-6 py-3 text-sm",
  lg: "px-7 py-3.5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  gameType,
  className = "",
  style,
  children,
  ...rest
}: ButtonProps) {
  if (variant === "ghost") {
    return (
      <button
        className={`rounded-full border-2 border-(--accent-2) bg-transparent px-4 py-2 font-sans text-[13px] font-semibold text-(--accent-2) transition-colors hover:bg-[rgba(53,212,185,0.12)] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
        style={style}
        {...rest}
      >
        {children}
      </button>
    );
  }

  let variantStyle: CSSProperties = {};
  let variantClass = "";
  if (variant === "primary") {
    variantStyle = {
      background: "linear-gradient(180deg,#ffd23f,#f5b32a)",
      color: "var(--dark-ink)",
    };
  } else if (variant === "secondary") {
    variantClass = "border-2 border-(--ink) bg-(--panel) text-(--ink)";
    variantStyle = { ["--buzzer-drop" as string]: "rgba(0,0,0,.4)" };
  } else if (variant === "danger") {
    variantStyle = {
      background: "linear-gradient(180deg,#ff6b85,#e84863)",
      color: "#fff",
      ["--buzzer-drop" as string]: "#8f1f33",
    };
  } else if (variant === "hue") {
    const hue = hueFor(gameType);
    variantStyle = {
      background: `linear-gradient(180deg,${hue.gradFrom},${hue.gradTo})`,
      color: hue.ink,
      ["--buzzer-drop" as string]: hue.drop,
    };
  }

  return (
    <button
      className={`buzzer ${sizeClasses[size]} ${variantClass} ${className}`}
      style={{ ...variantStyle, ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}
