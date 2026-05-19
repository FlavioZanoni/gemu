"use client";

import { useEffect, useRef, useState } from "react";

type DrawingCanvasProps = {
  value?: string;
  onChange: (dataUrl: string) => void;
};

const PRESET_COLORS = [
  "#fff2c8",
  "#ffffff",
  "#ff6b6b",
  "#ffa94d",
  "#ffd43b",
  "#69db7c",
  "#4dabf7",
  "#9775fa",
  "#f783ac",
  "#868e96",
  "#212529",
];

const PRESET_SIZES = [3, 6, 10, 16];

const BG_COLOR = "#1c1c2c";

export function DrawingCanvas({ value, onChange }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [size, setSize] = useState(PRESET_SIZES[1]);
  const [eraser, setEraser] = useState(false);

  const activeColor = eraser ? BG_COLOR : color;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastW = 0;
    let lastH = 0;
    let initialized = false;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const { width, height } = parent.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.floor(width * dpr);
      const targetH = Math.floor(height * dpr);
      if (targetW === lastW && targetH === lastH) return;
      lastW = targetW;
      lastH = targetH;

      // Capture existing pixels before resizing (which clears the canvas).
      let snapshot: string | null = null;
      if (initialized) {
        try {
          snapshot = canvas.toDataURL();
        } catch {
          snapshot = null;
        }
      }

      canvas.width = targetW;
      canvas.height = targetH;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, width, height);
      initialized = true;

      if (snapshot) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, width, height);
        };
        img.src = snapshot;
      }
    };

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas.parentElement as Element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!value) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const image = new Image();
    image.onload = () => {
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = value;
  }, [value]);

  const start = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = eraser ? size * 3 : size;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawingRef.current = true;
  };

  const draw = (x: number, y: number) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    onChange(canvas.toDataURL("image/png"));
  };

  const getEventPos = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    if ("touches" in e) {
      const touch = e.touches[0];
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              className={`h-7 w-7 rounded-full border-2 transition ${
                color === c && !eraser
                  ? "border-(--retro-cream) scale-110"
                  : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              onClick={() => {
                setColor(c);
                setEraser(false);
              }}
              type="button"
            />
          ))}
        </div>
        <div className="mt-1 flex flex-col gap-1.5">
          {PRESET_SIZES.map((s) => (
            <button
              key={s}
              className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition ${
                size === s
                  ? "border-(--retro-cream) bg-(--retro-cream)/20"
                  : "border-transparent bg-(--surface)"
              }`}
              onClick={() => setSize(s)}
              type="button"
            >
              <span
                className="rounded-full bg-(--retro-cream)"
                style={{ width: s, height: s }}
              />
            </button>
          ))}
        </div>
        <button
          className={`mt-1 flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs transition ${
            eraser
              ? "border-(--accent-2) bg-(--accent-2) text-(--retro-ink)"
              : "border-transparent bg-(--surface) text-(--retro-cream)"
          }`}
          onClick={() => setEraser(!eraser)}
          type="button"
          title="Eraser"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M20 20H7L3 16a1 1 0 010-1.4l9.6-9.6a1 1 0 011.4 0l7 7a1 1 0 010 1.4L15 20" />
            <path d="M6 12l6 6" />
          </svg>
        </button>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-transparent bg-(--surface) text-xs text-(--retro-cream) transition hover:border-(--retro-cream)"
          onClick={clear}
          type="button"
          title="Clear"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl border-2 border-(--retro-cream) bg-(--surface) p-1">
        <canvas
          ref={canvasRef}
          className="absolute inset-1 block rounded-xl"
          style={{
            width: "calc(100% - 0.5rem)",
            height: "calc(100% - 0.5rem)",
            cursor: eraser ? "cell" : "crosshair",
          }}
          onMouseDown={(e) => {
            const { x, y } = getEventPos(e);
            start(x, y);
          }}
          onMouseMove={(e) => {
            const { x, y } = getEventPos(e);
            draw(x, y);
          }}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={(e) => {
            const { x, y } = getEventPos(e);
            start(x, y);
          }}
          onTouchMove={(e) => {
            const { x, y } = getEventPos(e);
            draw(x, y);
          }}
          onTouchEnd={end}
        />
      </div>
    </div>
  );
}
