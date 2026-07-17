"use client";

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";

/**
 * Serialized stroke format (wire format for client↔client relay):
 * All drawing operations are under action:"stroke" with a kind field.
 */

type StrokeEvent = {
  action: "stroke";
  kind: "brush" | "eraser" | "line" | "rect" | "ellipse" | "fill";
  points?: [number, number][];
  from?: [number, number];
  to?: [number, number];
  x?: number;
  y?: number;
  color?: string;
  size?: number;
  fill?: boolean;
};

type ClearAction = {
  action: "canvas_clear";
};

type UndoAction = {
  action: "canvas_undo";
};

type CanvasAction = StrokeEvent | ClearAction | UndoAction;

type DrawingCanvasProps = {
  gameType?: string;
  onStrokeBatch?: (action: CanvasAction) => void;
  value?: string;
  onChange?: (dataUrl: string) => void;
  readOnly?: boolean;
};

const COLOR_SWATCHES = [
  "#131320",
  "#ffffff",
  "#e84863",
  "#ff9d3f",
  "#ffd23f",
  "#57c75a",
  "#35d4b9",
  "#3f8cff",
  "#b78bff",
  "#ff8ac2",
  "#8a5a3b",
  "#9aa0b5",
];

const BRUSH_SIZES = [4, 10, 22];
const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 880;
const MAX_UNDO_STACK = 20;

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const undoStackRef = useRef<ImageData[]>([]);
  const previewImageRef = useRef<ImageData | null>(null);
  const strokePointsRef = useRef<[number, number][]>([]);

  // Tool and palette state
  const [tool, setTool] = useState<"brush" | "eraser" | "line" | "rect" | "ellipse" | "fill">("brush");
  const [color, setColor] = useState(COLOR_SWATCHES[0]);
  const [size, setSize] = useState(BRUSH_SIZES[1]);
  const [fill, setFill] = useState(false);
  const [startPos, setStartPos] = useState<[number, number] | null>(null);

  // Initialize canvas with 720×880 internal resolution
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set fixed internal resolution
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    // Fill background with cream
    ctx.fillStyle = "#fff8e7";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
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
      ctx.drawImage(image, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    };
    image.src = value;
  }, [value]);

  const saveToUndoStack = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    undoStackRef.current.push(imageData);
    if (undoStackRef.current.length > MAX_UNDO_STACK) {
      undoStackRef.current.shift();
    }
  }, []);

  // Flood fill algorithm for bucket tool
  const floodFill = useCallback((x: number, y: number, fillColor: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const data = imageData.data;

    const sx = Math.floor(x);
    const sy = Math.floor(y);
    if (sx < 0 || sx >= CANVAS_WIDTH || sy < 0 || sy >= CANVAS_HEIGHT) return;

    // Get target color
    const idx = (sy * CANVAS_WIDTH + sx) * 4;
    const targetR = data[idx];
    const targetG = data[idx + 1];
    const targetB = data[idx + 2];
    const targetA = data[idx + 3];

    // Parse fill color
    const fillRgb = parseInt(fillColor.slice(1), 16);
    const fillR = (fillRgb >> 16) & 255;
    const fillG = (fillRgb >> 8) & 255;
    const fillB = fillRgb & 255;

    // Tolerance for color matching (dr²+dg²+db²+da² < 2500)
    const tolerance = 2500;

    // BFS flood fill
    const queue: [number, number][] = [[sx, sy]];
    const visited = new Set<string>();
    visited.add(`${sx},${sy}`);

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      const cidx = (cy * CANVAS_WIDTH + cx) * 4;

      const dr = data[cidx] - targetR;
      const dg = data[cidx + 1] - targetG;
      const db = data[cidx + 2] - targetB;
      const da = data[cidx + 3] - targetA;

      if (dr * dr + dg * dg + db * db + da * da < tolerance) {
        data[cidx] = fillR;
        data[cidx + 1] = fillG;
        data[cidx + 2] = fillB;
        data[cidx + 3] = 255;

        // Add neighbors
        for (const [nx, ny] of [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ]) {
          if (nx >= 0 && nx < CANVAS_WIDTH && ny >= 0 && ny < CANVAS_HEIGHT) {
            const key = `${nx},${ny}`;
            if (!visited.has(key)) {
              visited.add(key);
              queue.push([nx, ny]);
            }
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, []);

  const drawLine = useCallback((x0: number, y0: number, x1: number, y1: number, strokeColor: string, strokeSize: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }, []);

  const drawRect = useCallback((x0: number, y0: number, x1: number, y1: number, strokeColor: string, strokeSize: number, shouldFill: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.globalCompositeOperation = "source-over";
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);

    if (shouldFill) {
      ctx.fillStyle = strokeColor;
      ctx.fillRect(x, y, w, h);
    } else {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeRect(x, y, w, h);
    }
  }, []);

  const drawEllipse = useCallback((x0: number, y0: number, x1: number, y1: number, strokeColor: string, strokeSize: number, shouldFill: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.globalCompositeOperation = "source-over";
    const rx = Math.abs(x1 - x0) / 2;
    const ry = Math.abs(y1 - y0) / 2;
    const cx = Math.min(x0, x1) + rx;
    const cy = Math.min(y0, y1) + ry;

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);

    if (shouldFill) {
      ctx.fillStyle = strokeColor;
      ctx.fill();
    } else {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }, []);

  const drawStroke = useCallback((points: [number, number][], strokeColor: string, strokeSize: number, isEraser: boolean = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (isEraser) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = strokeSize * 2.2;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeSize;
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();

    if (points.length === 0) return;
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }, []);

  const start = (x: number, y: number) => {
    if (readOnly) return;
    saveToUndoStack();
    drawingRef.current = true;
    setStartPos([x, y]);
    strokePointsRef.current = [[x, y]];

    // For bucket fill, execute immediately
    if (tool === "fill") {
      floodFill(x, y, color);
      drawingRef.current = false;
      setStartPos(null);
      strokePointsRef.current = [];

      if (onStrokeBatch) {
        onStrokeBatch({
          action: "stroke",
          kind: "fill",
          x,
          y,
          color,
        });
      }

      if (onChange) {
        const canvas = canvasRef.current;
        if (canvas) onChange(canvas.toDataURL("image/png"));
      }
    }
  };

  const draw = (x: number, y: number) => {
    if (!drawingRef.current || readOnly || !startPos) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Save preview for redraw
    if (!previewImageRef.current) {
      previewImageRef.current = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // Restore canvas to pre-preview state
    if (previewImageRef.current) {
      ctx.putImageData(previewImageRef.current, 0, 0);
    }

    // Draw preview for shape tools
    if (tool === "line") {
      drawLine(startPos[0], startPos[1], x, y, color, size);
    } else if (tool === "rect") {
      drawRect(startPos[0], startPos[1], x, y, color, size, fill);
    } else if (tool === "ellipse") {
      drawEllipse(startPos[0], startPos[1], x, y, color, size, fill);
    } else if (tool === "brush" || tool === "eraser") {
      // For brush/eraser, accumulate points and draw
      strokePointsRef.current.push([x, y]);
      drawStroke(strokePointsRef.current, color, size, tool === "eraser");
    }
  };

  const end = () => {
    if (!drawingRef.current || !startPos) return;
    drawingRef.current = false;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Send stroke event
    if (onStrokeBatch) {
      if (tool === "brush" || tool === "eraser") {
        onStrokeBatch({
          action: "stroke",
          kind: tool,
          points: strokePointsRef.current,
          color,
          size,
        });
      } else if (tool === "line") {
        onStrokeBatch({
          action: "stroke",
          kind: "line",
          from: startPos,
          to: [
            strokePointsRef.current[strokePointsRef.current.length - 1]?.[0] ?? startPos[0],
            strokePointsRef.current[strokePointsRef.current.length - 1]?.[1] ?? startPos[1],
          ],
          color,
          size,
        });
      } else if (tool === "rect" || tool === "ellipse") {
        onStrokeBatch({
          action: "stroke",
          kind: tool,
          from: startPos,
          to: [
            strokePointsRef.current[strokePointsRef.current.length - 1]?.[0] ?? startPos[0],
            strokePointsRef.current[strokePointsRef.current.length - 1]?.[1] ?? startPos[1],
          ],
          color,
          size,
          fill,
        });
      }
    }

    previewImageRef.current = null;
    strokePointsRef.current = [];
    setStartPos(null);

    if (onChange) {
      onChange(canvas.toDataURL("image/png"));
    }
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    saveToUndoStack();
    ctx.fillStyle = "#fff8e7";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

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
      if (stroke.kind === "brush" && stroke.points && stroke.color && stroke.size !== undefined) {
        drawStroke(stroke.points, stroke.color, stroke.size, false);
      } else if (stroke.kind === "eraser" && stroke.points && stroke.size !== undefined) {
        drawStroke(stroke.points, stroke.color || "#000", stroke.size, true);
      } else if (stroke.kind === "line" && stroke.from && stroke.to && stroke.color && stroke.size !== undefined) {
        drawLine(stroke.from[0], stroke.from[1], stroke.to[0], stroke.to[1], stroke.color, stroke.size);
      } else if (stroke.kind === "rect" && stroke.from && stroke.to && stroke.color && stroke.size !== undefined) {
        drawRect(stroke.from[0], stroke.from[1], stroke.to[0], stroke.to[1], stroke.color, stroke.size, stroke.fill ?? false);
      } else if (stroke.kind === "ellipse" && stroke.from && stroke.to && stroke.color && stroke.size !== undefined) {
        drawEllipse(stroke.from[0], stroke.from[1], stroke.to[0], stroke.to[1], stroke.color, stroke.size, stroke.fill ?? false);
      } else if (stroke.kind === "fill" && stroke.x !== undefined && stroke.y !== undefined && stroke.color) {
        floodFill(stroke.x, stroke.y, stroke.color);
      }
    } else if (action.action === "canvas_clear") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff8e7";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } else if (action.action === "canvas_undo") {
      if (undoStackRef.current.length > 0) {
        const previousState = undoStackRef.current.pop();
        if (previousState) {
          const ctx = canvasRef.current?.getContext("2d");
          if (ctx) ctx.putImageData(previousState, 0, 0);
        }
      }
    }
  }, [drawStroke, drawLine, drawRect, drawEllipse, floodFill]);

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
  ): [number, number] => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return [0, 0];

    const rect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const scale = CANVAS_WIDTH / containerRect.width;

    if ("touches" in e) {
      const touch = e.touches[0];
      const x = (touch.clientX - rect.left) * scale;
      const y = (touch.clientY - rect.top) * scale;
      return [Math.max(0, Math.min(CANVAS_WIDTH, x)), Math.max(0, Math.min(CANVAS_HEIGHT, y))];
    }

    const x = (e.clientX - rect.left) * scale;
    const y = (e.clientY - rect.top) * scale;
    return [Math.max(0, Math.min(CANVAS_WIDTH, x)), Math.max(0, Math.min(CANVAS_HEIGHT, y))];
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex flex-col gap-2 bg-(--panel-raised) rounded-lg p-3">
          {/* Tools row 1: Drawing tools */}
          <div className="flex gap-2 flex-wrap justify-center">
            {[
              { id: "brush" as const, label: "✏️" },
              { id: "eraser" as const, label: "◻" },
              { id: "line" as const, label: "╱" },
              { id: "rect" as const, label: "▭" },
              { id: "ellipse" as const, label: "◯" },
              { id: "fill" as const, label: "🪣" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTool(t.id)}
                className={`px-3 py-2 rounded-lg font-bold text-sm transition ${
                  tool === t.id
                    ? "bg-(--accent) text-(--dark-ink) border-2 border-(--accent)"
                    : "bg-(--panel) text-(--ink) border-2 border-(--line)"
                }`}
                type="button"
                title={t.id}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tools row 2: Color swatches */}
          <div className="flex gap-2 flex-wrap justify-center">
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full border-2 transition`}
                style={{
                  backgroundColor: c,
                  borderColor: color === c ? "#ffe9a8" : "rgba(255,255,255,.2)",
                  borderWidth: color === c ? "3px" : "2px",
                }}
                type="button"
                title="Color"
              />
            ))}
          </div>

          {/* Tools row 3: Sizes, fill, undo, clear */}
          <div className="flex gap-2 flex-wrap justify-center items-center">
            {/* Sizes */}
            {BRUSH_SIZES.map((s) => (
              <button
                key={s}
                className={`h-8 w-8 flex items-center justify-center rounded border-2 transition ${
                  size === s ? "border-(--accent) bg-(--accent-faint)" : "border-(--line) bg-(--panel)"
                }`}
                onClick={() => setSize(s)}
                type="button"
                title={`Size ${s}px`}
              >
                <span
                  className="rounded-full"
                  style={{
                    width: Math.max(2, s / 3),
                    height: Math.max(2, s / 3),
                    backgroundColor: size === s ? "#ffe9a8" : "rgba(255,233,168,.4)",
                  }}
                />
              </button>
            ))}

            {/* Fill toggle */}
            <button
              onClick={() => setFill(!fill)}
              className={`px-2 py-1 rounded text-xs font-bold transition border-2 ${
                fill
                  ? "bg-(--accent) text-(--dark-ink) border-(--accent)"
                  : "bg-(--panel) text-(--ink) border-(--line)"
              }`}
              type="button"
              title="Fill toggle"
            >
              FILL
            </button>

            <div className="flex-1" />

            {/* Undo and Clear */}
            <button
              onClick={undo}
              className="px-2 py-1 rounded text-xs font-bold transition border-2 bg-(--panel) text-(--ink) border-(--line) hover:border-(--accent)"
              type="button"
              title="Undo"
            >
              ↩ Undo
            </button>

            <button
              onClick={clear}
              className="px-3 py-1 rounded text-xs font-bold transition border-none text-white bg-gradient-to-b from-[#ff6b85] to-[#e84863]"
              style={{ boxShadow: "0 3px 0 #8f1f33" }}
              type="button"
              title="Clear"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex items-center justify-center rounded-2xl overflow-hidden"
        style={{
          backgroundColor: "#fff8e7",
          border: "3px solid #5a3f7a",
          boxShadow: "0 6px 0 rgba(0,0,0,.35)",
          aspectRatio: "720 / 880",
          width: "100%",
        }}
      >
        <canvas
          ref={canvasRef}
          className="block"
          style={{
            cursor: readOnly ? "default" : tool === "eraser" ? "cell" : "crosshair",
            touchAction: "none",
            maxWidth: "100%",
            maxHeight: "100%",
          }}
          onMouseDown={(e) => {
            const pos = getEventPos(e);
            start(pos[0], pos[1]);
          }}
          onMouseMove={(e) => {
            const pos = getEventPos(e);
            draw(pos[0], pos[1]);
          }}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={(e) => {
            const pos = getEventPos(e);
            start(pos[0], pos[1]);
          }}
          onTouchMove={(e) => {
            const pos = getEventPos(e);
            draw(pos[0], pos[1]);
          }}
          onTouchEnd={end}
          onTouchCancel={end}
        />
      </div>
    </div>
  );
});

DrawingCanvas.displayName = "DrawingCanvas";
