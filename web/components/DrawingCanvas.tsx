"use client";

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { hueFor } from "./ui/gameHues";

/**
 * Serialized stroke format (wire format for client↔client relay):
 * {
 *   action: "stroke" | "canvas_clear" | "canvas_undo"
 *   playerId?: string  (server adds when relaying)
 *   points?: [[x,y], [x,y], ...]  (stroke-only; array of coordinate pairs)
 *   color?: "#xxxxxx"  (stroke-only)
 *   size?: number  (stroke-only)
 * }
 */

type StrokeEvent = {
  action: "stroke";
  points: [number, number][];
  color: string;
  size: number;
};

type ClearAction = {
  action: "canvas_clear";
};

type UndoAction = {
  action: "canvas_undo";
};

type CanvasAction = StrokeEvent | ClearAction | UndoAction;

type DrawingCanvasProps = {
  /** Game type for hue (e.g. "gartic") */
  gameType?: string;
  /** For drawer mode: callback to send stroke batches to other players */
  onStrokeBatch?: (action: CanvasAction) => void;
  /** For submit mode: optional initial image data */
  value?: string;
  /** For submit mode: called when canvas changes (drawEnd, clear, undo) */
  onChange?: (dataUrl: string) => void;
  /** Read-only mode: don't capture input, just display */
  readOnly?: boolean;
};

export const DrawingCanvas = forwardRef<
  {
    applyRemoteStroke: (action: CanvasAction) => void;
    toDataURL: (type?: string, quality?: number) => string;
    clear: () => void;
    undo: () => void;
  },
  DrawingCanvasProps
>(function DrawingCanvasComponent(
  {
    gameType = "gartic",
    onStrokeBatch,
    value,
    onChange,
    readOnly = false,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const strokeBufferRef = useRef<[number, number][]>([]);
  const undoStackRef = useRef<ImageData[]>([]);

  const hue = hueFor(gameType);
  const [color, setColor] = useState(hue.base);
  const [size, setSize] = useState(6);
  const [eraser, setEraser] = useState(false);

  const activeColor = eraser ? "#1c1230" : color;

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const { width, height } = parent.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const dpr = window.devicePixelRatio || 1;

      // Save current canvas content
      const saved = canvas.toDataURL();

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#1c1230";
      ctx.fillRect(0, 0, width, height);

      // Restore content
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
      };
      img.src = saved;
    };

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas.parentElement as Element);
    return () => observer.disconnect();
  }, []);

  // Load initial value
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

  const drawStroke = useCallback(
    (points: [number, number][], strokeColor: string, strokeSize: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();

      if (points.length === 0) return;
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.stroke();
    },
    []
  );

  const saveToUndoStack = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStackRef.current.push(imageData);
  }, []);

  const start = (x: number, y: number) => {
    if (readOnly) return;
    saveToUndoStack();
    drawingRef.current = true;
    strokeBufferRef.current = [[x, y]];
  };

  const draw = (x: number, y: number) => {
    if (!drawingRef.current || readOnly) return;
    strokeBufferRef.current.push([x, y]);
    const points = strokeBufferRef.current;
    if (points.length >= 2) {
      const lastIdx = points.length - 1;
      drawStroke([points[lastIdx - 1], points[lastIdx]], activeColor, eraser ? size * 3 : size);
    }
  };

  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;

    // Batch and send stroke
    if (strokeBufferRef.current.length > 0 && onStrokeBatch) {
      const stroke: StrokeEvent = {
        action: "stroke",
        points: strokeBufferRef.current,
        color: activeColor,
        size: eraser ? size * 3 : size,
      };
      onStrokeBatch(stroke);
    }
    strokeBufferRef.current = [];

    // Notify change
    if (onChange) {
      const canvas = canvasRef.current;
      if (canvas) onChange(canvas.toDataURL("image/png"));
    }
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    saveToUndoStack();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#1c1230";
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    if (onChange) onChange(canvas.toDataURL("image/png"));
    if (onStrokeBatch) onStrokeBatch({ action: "canvas_clear" });
  }, [onChange, onStrokeBatch, saveToUndoStack]);

  const undo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (undoStackRef.current.length === 0) return;
    const previousState = undoStackRef.current.pop();
    if (!previousState) return;

    ctx.putImageData(previousState, 0, 0);
    if (onChange) onChange(canvas.toDataURL("image/png"));
    if (onStrokeBatch) onStrokeBatch({ action: "canvas_undo" });
  }, [onChange, onStrokeBatch]);

  const applyRemoteStroke = useCallback((action: CanvasAction) => {
    if (action.action === "stroke") {
      const stroke = action as StrokeEvent;
      drawStroke(stroke.points, stroke.color, stroke.size);
    } else if (action.action === "canvas_clear") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#1c1230";
      ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    } else if (action.action === "canvas_undo") {
      if (undoStackRef.current.length > 0) {
        const previousState = undoStackRef.current.pop();
        if (previousState) {
          const ctx = canvasRef.current?.getContext("2d");
          if (ctx) ctx.putImageData(previousState, 0, 0);
        }
      }
    }
  }, [drawStroke]);

  useImperativeHandle(
    ref,
    () => ({
      applyRemoteStroke,
      toDataURL: (type = "image/png", quality = 1) =>
        canvasRef.current?.toDataURL(type, quality) ?? "",
      clear,
      undo,
    }),
    [applyRemoteStroke, clear, undo]
  );

  const getEventPos = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    if ("touches" in e) {
      const touch = e.touches[0];
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const colorPalette = [
    hue.base,
    "#ffffff",
    "#ff6b6b",
    "#ffa94d",
    "#69db7c",
    "#4dabf7",
    "#9775fa",
    "#f783ac",
    "#868e96",
    "#212529",
  ];

  return (
    <div className="flex gap-3">
      {!readOnly && (
        <div className="flex flex-col gap-2">
          {/* Color palette */}
          <div className="flex flex-col gap-1.5">
            {colorPalette.map((c) => (
              <button
                key={c}
                className={`h-7 w-7 rounded-full border-2 transition ${
                  color === c && !eraser ? "scale-110" : ""
                }`}
                style={{
                  backgroundColor: c,
                  borderColor: color === c && !eraser ? hue.base : "transparent",
                }}
                onClick={() => {
                  setColor(c);
                  setEraser(false);
                }}
                type="button"
                title="Color"
              />
            ))}
          </div>

          {/* Brush sizes */}
          <div className="mt-1 flex flex-col gap-1.5">
            {[3, 6, 10, 16].map((s) => (
              <button
                key={s}
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition ${
                  size === s ? "border-current bg-(--accent-2)/20" : "border-transparent bg-(--panel)"
                }`}
                onClick={() => setSize(s)}
                type="button"
                title="Brush size"
              >
                <span
                  className="rounded-full"
                  style={{
                    width: s,
                    height: s,
                    backgroundColor: size === s ? hue.base : "var(--ink-faint)",
                  }}
                />
              </button>
            ))}
          </div>

          {/* Eraser */}
          <button
            className={`mt-1 flex h-7 w-7 items-center justify-center rounded-full border-2 transition ${
              eraser ? `border-current` : "border-transparent bg-(--panel)"
            }`}
            onClick={() => setEraser(!eraser)}
            type="button"
            title="Eraser"
            style={{
              borderColor: eraser ? hue.base : "transparent",
              backgroundColor: eraser ? `${hue.base}20` : "var(--panel)",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M20 20H7L3 16a1 1 0 010-1.4l9.6-9.6a1 1 0 011.4 0l7 7a1 1 0 010 1.4L15 20" />
              <path d="M6 12l6 6" />
            </svg>
          </button>

          {/* Undo */}
          <button
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-transparent bg-(--panel) transition hover:border-current"
            onClick={undo}
            type="button"
            title="Undo"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M3 7v6h6M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
            </svg>
          </button>

          {/* Clear */}
          <button
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-transparent bg-(--panel) transition hover:border-current"
            onClick={clear}
            type="button"
            title="Clear"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 rounded-2xl border-2 p-1" style={{ borderColor: hue.base, backgroundColor: "var(--panel)" }}>
        <canvas
          ref={canvasRef}
          className="block h-full w-full rounded-xl"
          style={{ cursor: readOnly ? "default" : eraser ? "cell" : "crosshair" }}
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
          onTouchCancel={end}
        />
      </div>
    </div>
  );
});

DrawingCanvas.displayName = "DrawingCanvas";
