"use client";

import { useEffect, useRef } from "react";

/** Mini 96×96 doodle canvas for drawing your avatar at join (Gemu System ·
 *  06). Stroke color = the player's assigned color. Emits a PNG data URL
 *  after every stroke. Not the in-game canvas — that's DrawingCanvas. */
export function DoodlePad({
  strokeColor,
  onChange,
  size = 96,
  className = "",
}: {
  strokeColor: string;
  onChange: (dataUrl: string) => void;
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#3a2751";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const point = (e: PointerEvent | React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={`touch-none rounded-full ${className}`}
      style={{ width: size, height: size, border: `2px solid ${strokeColor}` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = true;
        const ctx = e.currentTarget.getContext("2d")!;
        const { x, y } = point(e);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(x, y);
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const ctx = e.currentTarget.getContext("2d")!;
        const { x, y } = point(e);
        ctx.lineTo(x, y);
        ctx.stroke();
      }}
      onPointerUp={(e) => {
        drawing.current = false;
        onChange(e.currentTarget.toDataURL("image/png"));
      }}
    />
  );
}
