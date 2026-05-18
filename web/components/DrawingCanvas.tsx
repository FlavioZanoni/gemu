"use client";

import { useEffect, useRef, useState } from "react";

type DrawingCanvasProps = {
  value?: string;
  onChange: (dataUrl: string) => void;
};

export function DrawingCanvas({ value, onChange }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [color, setColor] = useState("#fff2c8");
  const [size, setSize] = useState(6);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const { width } = parent.getBoundingClientRect();
      const height = 320;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#1c1c2c";
      ctx.fillRect(0, 0, width, height);
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
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
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
    ctx.fillStyle = "#1c1c2c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    onChange(canvas.toDataURL("image/png"));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-[color:var(--retro-cream)]/70">
          Color
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="ml-2 h-8 w-12 rounded border-2 border-[color:var(--retro-cream)] bg-[color:var(--surface)]"
          />
        </label>
        <label className="text-xs text-[color:var(--retro-cream)]/70">
          Size
          <input
            type="range"
            min={2}
            max={18}
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
            className="ml-2"
          />
        </label>
        <button
          className="retro-btn border-2 border-[color:var(--retro-cream)] bg-[color:var(--surface)] px-3 py-1 text-xs text-[color:var(--retro-cream)]"
          onClick={clear}
          type="button"
        >
          Clear
        </button>
      </div>
      <div className="rounded-2xl border-2 border-[color:var(--retro-cream)] bg-[color:var(--surface)] p-2">
        <canvas
          ref={canvasRef}
          className="block h-[320px] w-full rounded-xl"
          onMouseDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            start(event.clientX - rect.left, event.clientY - rect.top);
          }}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            draw(event.clientX - rect.left, event.clientY - rect.top);
          }}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const touch = event.touches[0];
            start(touch.clientX - rect.left, touch.clientY - rect.top);
          }}
          onTouchMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const touch = event.touches[0];
            draw(touch.clientX - rect.left, touch.clientY - rect.top);
          }}
          onTouchEnd={end}
        />
      </div>
    </div>
  );
}
