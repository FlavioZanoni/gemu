"use client";

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { Pencil, PaintBucket, Undo2 } from "lucide-react";

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
  onStrokeBatch?: (action: CanvasAction) => void;
  value?: string;
  onChange?: (dataUrl: string) => void;
  readOnly?: boolean;
  /** Multiplies the picked brush size — avatars render at ~38px, so their
   *  strokes need to be proportionally thicker to survive the downscale. */
  brushScale?: number;
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
    onStrokeBatch,
    value,
    onChange,
    readOnly = false,
    brushScale = 1,
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
  const effectiveSize = size * brushScale;
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
      drawLine(startPos[0], startPos[1], x, y, color, effectiveSize);
    } else if (tool === "rect") {
      drawRect(startPos[0], startPos[1], x, y, color, effectiveSize, fill);
    } else if (tool === "ellipse") {
      drawEllipse(startPos[0], startPos[1], x, y, color, effectiveSize, fill);
    } else if (tool === "brush" || tool === "eraser") {
      // For brush/eraser, accumulate points and draw
      strokePointsRef.current.push([x, y]);
      drawStroke(strokePointsRef.current, color, effectiveSize, tool === "eraser");
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
          size: effectiveSize,
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
          size: effectiveSize,
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
          size: effectiveSize,
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
    e: React.PointerEvent<HTMLCanvasElement>
  ): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];

    // Map from the canvas's own displayed box, per axis. Scaling off the
    // container's width breaks the pointer the moment the canvas letterboxes
    // (maxWidth/maxHeight) inside it — the cursor drifts more the farther you
    // draw from the top-left.
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (CANVAS_WIDTH / rect.width);
    const y = (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height);
    return [Math.max(0, Math.min(CANVAS_WIDTH, x)), Math.max(0, Math.min(CANVAS_HEIGHT, y))];
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex items-center justify-center rounded-3xl overflow-hidden"
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
          onPointerDown={(e) => {
            const pos = getEventPos(e);
            start(pos[0], pos[1]);
          }}
          onPointerMove={(e) => {
            const pos = getEventPos(e);
            draw(pos[0], pos[1]);
          }}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
          // Pointer events ONLY — browsers also fire compatibility mouse
          // events after pointer events, so duplicating handlers would run
          // every stroke twice (double undo pushes, doubled stroke relay).
        />
      </div>

      {/* Toolbar (below the canvas — design/DrawingCanvas.dc.html) */}
      {!readOnly && (
        <div className="flex flex-col gap-2 rounded-lg p-3" style={{ background: "#2b1a3d" }}>
          {/* Tools row 1: Drawing tools (6 tools) */}
          <div className="flex gap-2 justify-center flex-wrap">
            {[
              { id: "brush" as const, icon: Pencil },
              { id: "eraser" as const, label: "◻" },
              { id: "line" as const, label: "╱" },
              { id: "rect" as const, label: "▭" },
              { id: "ellipse" as const, label: "◯" },
              { id: "fill" as const, icon: PaintBucket },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTool(t.id);
                }}
                className="flex-1 max-w-14 h-12 rounded-2xl font-bold text-lg transition flex items-center justify-center"
                style={{
                  background: tool === t.id ? "linear-gradient(180deg,#ffd23f,#f5b32a)" : "#2b1a3d",
                  color: tool === t.id ? "#3d1f0e" : "#ffe9a8",
                  border: tool === t.id ? "2px solid #ffd23f" : "2px solid #5a3f7a",
                  boxShadow: tool === t.id ? "0 3px 0 rgba(0,0,0,.35)" : "none",
                  cursor: "pointer",
                }}
                type="button"
                title={t.id}
              >
                {t.icon ? <t.icon size={20} strokeWidth={2.5} /> : t.label}
              </button>
            ))}
          </div>

          {/* Tools row 2: Color swatches (12 colors) */}
          <div className="flex gap-2 flex-wrap justify-center">
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setColor(c);
                  // Switch to brush if eraser was active
                  if (tool === "eraser") setTool("brush");
                }}
                className="h-8 w-8 rounded-full border-2 transition"
                style={{
                  backgroundColor: c,
                  borderColor: color === c ? "#ffe9a8" : "rgba(255,255,255,.2)",
                  borderWidth: color === c ? "3px" : "2px",
                  cursor: "pointer",
                  padding: 0,
                }}
                type="button"
                title="Color"
              />
            ))}
          </div>

          {/* Tools row 3: Sizes, fill, undo, clear */}
          <div className="flex gap-2 flex-wrap justify-between items-center">
            <div className="flex gap-2 items-center">
              {/* Sizes */}
              {BRUSH_SIZES.map((s) => (
                <button
                  key={s}
                  className="h-10 w-10 flex items-center justify-center rounded-2xl transition"
                  style={{
                    background: size === s ? "#3a2751" : "#2b1a3d",
                    border: size === s ? "2px solid #ffe9a8" : "2px solid #5a3f7a",
                    cursor: "pointer",
                  }}
                  onClick={() => setSize(s)}
                  type="button"
                  title={`Size ${s}px`}
                >
                  <span
                    className="rounded-full"
                    style={{
                      width: Math.max(5, s * 0.8),
                      height: Math.max(5, s * 0.8),
                      backgroundColor: "#ffe9a8",
                    }}
                  />
                </button>
              ))}

              {/* Fill toggle */}
              <button
                onClick={() => setFill(!fill)}
                className="h-10 px-3 rounded-2xl text-xs font-bold transition"
                style={{
                  background: fill ? "#35d4b9" : "#2b1a3d",
                  color: fill ? "#0c3d33" : "rgba(255,233,168,.6)",
                  border: fill ? "2px solid #35d4b9" : "2px solid #5a3f7a",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontFamily: "'Space Mono', monospace",
                }}
                type="button"
                title="Fill toggle"
              >
                {fill ? "FILL: ON" : "FILL: OFF"}
              </button>
            </div>

            <div className="flex gap-2">
              {/* Undo */}
              <button
                onClick={undo}
                className="h-10 px-3.5 rounded-2xl text-xs font-bold transition flex items-center gap-1"
                style={{
                  background: "#2b1a3d",
                  color: "#ffe9a8",
                  border: "2px solid #5a3f7a",
                  cursor: "pointer",
                  boxShadow: "0 3px 0 rgba(0,0,0,.35)",
                  fontSize: "13px",
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: "700",
                }}
                type="button"
                title="Undo"
              >
                <Undo2 size={16} strokeWidth={2.5} /> Undo
              </button>

              {/* Clear */}
              <button
                onClick={clear}
                className="h-10 px-3.5 rounded-2xl text-xs font-bold transition text-white"
                style={{
                  background: "linear-gradient(180deg,#ff6b85,#e84863)",
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 3px 0 #8f1f33",
                  fontSize: "13px",
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: "700",
                }}
                type="button"
                title="Clear"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

DrawingCanvas.displayName = "DrawingCanvas";
