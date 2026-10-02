"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Circle,
  Eraser,
  PaintBucket,
  Pencil,
  RectangleHorizontal,
  Slash,
  Undo2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * Wire format for the client↔client canvas relay (game.stream). Coordinates
 * are in the canvas's internal pixel space (720×880 portrait, 760×560
 * landscape), so both ends must use the same `aspect`.
 *
 * Brush/eraser strokes stream live: the drawer flushes the points gathered
 * every ~50ms as one segment carrying the stroke `id`; each segment repeats
 * the previous segment's last point so receivers join them seamlessly. A
 * receiver snapshots its undo stack on the first segment of a new id — the
 * same moment the drawer snapshotted (pointer-down) — so canvas_undo pops
 * the same state on both ends. Messages without an id are whole strokes.
 */
export type StrokeKind = "brush" | "eraser" | "line" | "rect" | "ellipse" | "fill" | "snapshot";

export type StrokeEvent = {
  action: "stroke";
  kind: StrokeKind;
  /** Live brush/eraser stroke id; segments of one stroke share it. */
  id?: string;
  points?: [number, number][];
  from?: [number, number];
  to?: [number, number];
  x?: number;
  y?: number;
  color?: string;
  size?: number;
  fill?: boolean;
  /** kind "snapshot": the whole canvas as an image data URL. */
  data?: string;
};

export type ClearAction = { action: "canvas_clear" };
export type UndoAction = { action: "canvas_undo" };
export type CanvasAction = StrokeEvent | ClearAction | UndoAction;

export type CompressOptions = {
  /** Long-side cap in px (default 640). */
  maxSide?: number;
  /** Data-URL length cap in chars (default 150_000). */
  maxBytes?: number;
  /** Starting encoder quality (default 0.8). */
  quality?: number;
};

/** Imperative handle. The newer members are optional in the type only so
 *  existing narrower `useRef<{applyRemoteStroke; toDataURL; clear; undo}>`
 *  refs stay assignable — the component always provides them. */
export type DrawingCanvasHandle = {
  applyRemoteStroke: (action: CanvasAction) => void;
  toDataURL: (type?: string, quality?: number) => string;
  clear: () => void;
  undo: () => void;
  /** Small upload-ready image: ≤640px long side, webp (jpeg fallback), ≤~150KB. */
  exportCompressed?: (opts?: CompressOptions) => string;
  /** A "snapshot" stroke of the current canvas, to resync late joiners. */
  snapshot?: () => StrokeEvent;
  /** Drops undo history (e.g. after a snapshot resync on the sender side). */
  resetHistory?: () => void;
  /** True while a local pointer gesture (stroke or shape drag) is underway. */
  isGestureActive?: () => boolean;
};

export type DrawingCanvasProps = {
  onStrokeBatch?: (action: CanvasAction) => void;
  /** Initial image. Loaded on mount and whenever it changes to something the
   *  canvas did not emit itself via onChange (feeding onChange back into
   *  value is safe and never repaints over newer strokes). */
  value?: string;
  onChange?: (dataUrl: string) => void;
  readOnly?: boolean;
  /** Multiplies the picked brush size — avatars render at ~38px, so their
   *  strokes need to be proportionally thicker to survive the downscale. */
  brushScale?: number;
  /** "portrait" 720×880 (default) or "landscape" 760×560 (Gartic). */
  aspect?: "portrait" | "landscape";
  /** Border color (e.g. the game hue for the drawer). */
  hue?: string;
  /** Shrink the canvas so it plus the toolbar fit the viewport height.
   *  `true`: measured from the canvas's own top edge on the page — keeps the
   *  toolbar above the fold for game screens where the canvas sits near the
   *  top (Gartic). `"viewport"`: ignore the page offset — canvas + toolbar
   *  never exceed one viewport height, for canvases further down a page (e.g.
   *  below a form on phones). Either way the canvas stays ≥ 240px wide (or
   *  the full container width when that is narrower). */
  fitHeight?: boolean | "viewport";
  /** Hard cap on the displayed canvas height in px (applied with fitHeight
   *  or alone). */
  maxCanvasHeight?: number;
  /** Extra px to keep free below the canvas when fitHeight is on. */
  reserveBelow?: number;
  /** Live-stroke flush interval in ms (default 50). */
  streamIntervalMs?: number;
  /** Called once each time this canvas mounts (a remount starts blank). */
  onMount?: () => void;
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
const BG = "#fff8e7";
const MAX_UNDO_STACK = 20;
const SIZES = {
  portrait: { w: 720, h: 880 },
  landscape: { w: 760, h: 560 },
} as const;

type Tool = "brush" | "eraser" | "line" | "rect" | "ellipse" | "fill";
type Point = [number, number];

/** Downscale + re-encode a canvas for upload: long side ≤ maxSide, webp
 *  (jpeg where the browser can't encode webp) on a cream background, stepping
 *  quality then size down until the data URL fits maxBytes. */
export function compressCanvas(source: HTMLCanvasElement, opts: CompressOptions = {}): string {
  const { maxSide = 640, maxBytes = 150_000, quality = 0.8 } = opts;
  let scale = Math.min(1, maxSide / Math.max(source.width, source.height, 1));
  let url = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.max(1, Math.round(source.width * scale));
    const h = Math.max(1, Math.round(source.height * scale));
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) return source.toDataURL("image/jpeg", quality);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
    for (let q = quality; q >= 0.4; q -= 0.15) {
      url = out.toDataURL("image/webp", q);
      if (!url.startsWith("data:image/webp")) url = out.toDataURL("image/jpeg", q);
      if (url.length <= maxBytes) return url;
    }
    scale *= 0.75;
  }
  return url;
}

/** compressCanvas for an existing data URL (e.g. a stored PNG). */
export function compressDataURL(dataUrl: string, opts: CompressOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || 1;
      canvas.height = image.naturalHeight || 1;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      resolve(compressCanvas(canvas, opts));
    };
    image.onerror = () => reject(new Error("could not decode image"));
    image.src = dataUrl;
  });
}

/** Scanline flood fill over raw RGBA (port of DrawingCanvas.dc.html) with a
 *  visited mask, so a fill color within tolerance of the target can't loop. */
function scanlineFill(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  x: number,
  y: number,
  hex: string,
) {
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sx >= W || sy < 0 || sy >= H) return;
  const rgb = parseInt(hex.slice(1), 16);
  const fr = (rgb >> 16) & 255;
  const fg = (rgb >> 8) & 255;
  const fb = rgb & 255;
  const start = (sy * W + sx) * 4;
  const tr = data[start];
  const tg = data[start + 1];
  const tb = data[start + 2];
  const ta = data[start + 3];
  if (tr === fr && tg === fg && tb === fb && ta === 255) return;
  const visited = new Uint8Array(W * H);
  const match = (p: number) => {
    if (visited[p]) return false;
    const i = p * 4;
    const dr = data[i] - tr;
    const dg = data[i + 1] - tg;
    const db = data[i + 2] - tb;
    const da = data[i + 3] - ta;
    return dr * dr + dg * dg + db * db + da * da < 2500;
  };
  const stack: number[] = [sy * W + sx];
  while (stack.length) {
    const p = stack.pop()!;
    const py = (p / W) | 0;
    let px = p - py * W;
    const row = py * W;
    while (px >= 0 && match(row + px)) px--;
    px++;
    let above = false;
    let below = false;
    while (px < W && match(row + px)) {
      const q = row + px;
      visited[q] = 1;
      const i = q * 4;
      data[i] = fr;
      data[i + 1] = fg;
      data[i + 2] = fb;
      data[i + 3] = 255;
      if (py > 0) {
        const m = match(q - W);
        if (m && !above) stack.push(q - W);
        above = m;
      }
      if (py < H - 1) {
        const m = match(q + W);
        if (m && !below) stack.push(q + W);
        below = m;
      }
      px++;
    }
  }
}

function ctxOf(canvas: HTMLCanvasElement | null) {
  return canvas?.getContext("2d", { willReadFrequently: true }) ?? null;
}

function styleStroke(
  ctx: CanvasRenderingContext2D,
  strokeColor: string,
  strokeSize: number,
  eraser: boolean,
) {
  // The eraser paints the paper color, so exports (jpeg/webp) and flood
  // fills never meet transparent holes.
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = eraser ? BG : strokeColor;
  ctx.fillStyle = eraser ? BG : strokeColor;
  ctx.lineWidth = eraser ? strokeSize * 2.2 : strokeSize;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvasComponent(
    {
      onStrokeBatch,
      value,
      onChange,
      readOnly = false,
      brushScale = 1,
      aspect = "portrait",
      hue,
      fitHeight = false,
      maxCanvasHeight,
      reserveBelow = 0,
      streamIntervalMs = 50,
      onMount,
    },
    ref,
  ) {
    const { t } = useI18n();
    const { w: W, h: H } = SIZES[aspect];
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const toolbarRef = useRef<HTMLDivElement | null>(null);
    const undoStackRef = useRef<ImageData[]>([]);
    const lastEmittedRef = useRef<string | undefined>(undefined);

    // Active local gesture.
    const pointerIdRef = useRef<number | null>(null);
    const startPosRef = useRef<Point | null>(null);
    const lastPosRef = useRef<Point | null>(null);
    const previewRef = useRef<ImageData | null>(null);
    // Live streaming of the active brush/eraser stroke.
    const strokeIdRef = useRef<string | null>(null);
    const pendingRef = useRef<Point[]>([]);
    const lastSentRef = useRef<Point | null>(null);
    const flushTimerRef = useRef<number | null>(null);
    // Remote side.
    const remoteStrokeIdRef = useRef<string | null>(null);
    const remoteQueueRef = useRef<CanvasAction[] | null>(null);

    const [tool, setTool] = useState<Tool>("brush");
    const [color, setColor] = useState(COLOR_SWATCHES[0]);
    const [size, setSize] = useState(BRUSH_SIZES[1]);
    const [fill, setFill] = useState(false);
    const [fitWidth, setFitWidth] = useState<number | null>(null);
    // Short viewports (landscape phones, small call tiles) get a tighter
    // toolbox so more of it stays above the fold.
    const [compact, setCompact] = useState(false);
    const effectiveSize = size * brushScale;
    const toolH = compact ? 38 : 46;
    const swatchD = compact ? 26 : 30;
    const btnH = compact ? 34 : 40;

    useLayoutEffect(() => {
      const check = () => setCompact(window.innerHeight < 600);
      check();
      window.addEventListener("resize", check);
      return () => window.removeEventListener("resize", check);
    }, []);

    const onMountRef = useRef(onMount);
    useEffect(() => {
      onMountRef.current = onMount;
    }, [onMount]);
    useEffect(() => {
      onMountRef.current?.();
    }, []);

    // Fixed internal resolution, cream background.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);
    }, [W, H]);

    // Load `value` — but never one we emitted ourselves: parents that feed
    // onChange back into value would otherwise repaint a stale image over
    // strokes drawn while it decoded.
    useEffect(() => {
      if (!value || value === lastEmittedRef.current) return;
      lastEmittedRef.current = value;
      const image = new Image();
      image.onload = () => {
        const ctx = ctxOf(canvasRef.current);
        if (!ctx) return;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(image, 0, 0, W, H);
      };
      image.src = value;
    }, [value, W, H]);

    // Fit-to-height: the widest canvas whose height plus the toolbar (and
    // reserveBelow) fits under the canvas's top edge in the viewport.
    useLayoutEffect(() => {
      if (!fitHeight && !maxCanvasHeight) return;
      const root = rootRef.current;
      if (!root) return;
      const measure = () => {
        const parentWidth = root.parentElement?.clientWidth ?? root.clientWidth;
        let availH = Infinity;
        if (fitHeight) {
          const top = fitHeight === "viewport" ? 0 : root.getBoundingClientRect().top + window.scrollY;
          const toolbar = toolbarRef.current ? toolbarRef.current.offsetHeight + 12 : 0;
          availH = window.innerHeight - top - toolbar - reserveBelow - 14;
        }
        if (maxCanvasHeight) availH = Math.min(availH, maxCanvasHeight);
        const byHeight = Math.floor((availH * W) / H);
        // Never shrink below a usable size; a tiny tile scrolls instead.
        const floor = Math.min(parentWidth, 240);
        const next = Math.max(floor, Math.min(parentWidth, byHeight));
        setFitWidth((prev) => (prev === next ? prev : next));
      };
      measure();
      const observer = new ResizeObserver(measure);
      if (root.parentElement) observer.observe(root.parentElement);
      window.addEventListener("resize", measure);
      return () => {
        observer.disconnect();
        window.removeEventListener("resize", measure);
      };
    }, [fitHeight, maxCanvasHeight, reserveBelow, W, H, readOnly, compact]);

    const emitChange = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas || !onChange) return;
      const url = canvas.toDataURL("image/png");
      lastEmittedRef.current = url;
      onChange(url);
    }, [onChange]);

    const saveToUndoStack = useCallback(() => {
      const ctx = ctxOf(canvasRef.current);
      if (!ctx) return;
      undoStackRef.current.push(ctx.getImageData(0, 0, W, H));
      if (undoStackRef.current.length > MAX_UNDO_STACK) undoStackRef.current.shift();
    }, [W, H]);

    const floodFill = useCallback(
      (x: number, y: number, fillColor: string) => {
        const ctx = ctxOf(canvasRef.current);
        if (!ctx) return;
        const image = ctx.getImageData(0, 0, W, H);
        scanlineFill(image.data, W, H, x, y, fillColor);
        ctx.putImageData(image, 0, 0);
      },
      [W, H],
    );

    const drawPolyline = useCallback(
      (points: Point[], strokeColor: string, strokeSize: number, eraser: boolean) => {
        const ctx = ctxOf(canvasRef.current);
        if (!ctx || points.length === 0) return;
        styleStroke(ctx, strokeColor, strokeSize, eraser);
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        if (points.length === 1) {
          ctx.lineTo(points[0][0] + 0.01, points[0][1] + 0.01);
        }
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
        ctx.stroke();
      },
      [],
    );

    const drawShape = useCallback(
      (
        kind: "line" | "rect" | "ellipse",
        from: Point,
        to: Point,
        strokeColor: string,
        strokeSize: number,
        shouldFill: boolean,
      ) => {
        const ctx = ctxOf(canvasRef.current);
        if (!ctx) return;
        styleStroke(ctx, strokeColor, strokeSize, false);
        const [x0, y0] = from;
        const [x1, y1] = to;
        ctx.beginPath();
        if (kind === "line") {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        } else if (kind === "rect") {
          const x = Math.min(x0, x1);
          const y = Math.min(y0, y1);
          const w = Math.abs(x1 - x0);
          const h = Math.abs(y1 - y0);
          if (shouldFill) ctx.fillRect(x, y, w, h);
          else ctx.strokeRect(x, y, w, h);
        } else {
          const rx = Math.abs(x1 - x0) / 2;
          const ry = Math.abs(y1 - y0) / 2;
          ctx.ellipse(Math.min(x0, x1) + rx, Math.min(y0, y1) + ry, rx, ry, 0, 0, Math.PI * 2);
          if (shouldFill) ctx.fill();
          else ctx.stroke();
        }
      },
      [],
    );

    const paintBackground = useCallback(() => {
      const ctx = ctxOf(canvasRef.current);
      if (!ctx) return;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);
    }, [W, H]);

    // ---- live stroke streaming (drawer side) ----

    const flushStroke = useCallback(() => {
      const id = strokeIdRef.current;
      if (!id || !onStrokeBatch) return;
      const pending = pendingRef.current;
      if (pending.length === 0) return;
      const points = lastSentRef.current ? [lastSentRef.current, ...pending] : pending;
      lastSentRef.current = pending[pending.length - 1];
      pendingRef.current = [];
      onStrokeBatch({
        action: "stroke",
        kind: tool === "eraser" ? "eraser" : "brush",
        id,
        points: points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]),
        color,
        size: effectiveSize,
      });
    }, [onStrokeBatch, tool, color, effectiveSize]);

    const stopFlushTimer = () => {
      if (flushTimerRef.current !== null) {
        window.clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };

    useEffect(() => () => stopFlushTimer(), []);

    // ---- pointer handling ----

    const getEventPos = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return [0, 0];
      // Map from the canvas's own displayed box, per axis.
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (W / rect.width);
      const y = (e.clientY - rect.top) * (H / rect.height);
      return [Math.max(0, Math.min(W, x)), Math.max(0, Math.min(H, y))];
    };

    const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (readOnly || pointerIdRef.current !== null) return;
      e.preventDefault();
      const pos = getEventPos(e);
      saveToUndoStack();

      if (tool === "fill") {
        floodFill(pos[0], pos[1], color);
        onStrokeBatch?.({ action: "stroke", kind: "fill", x: pos[0], y: pos[1], color });
        emitChange();
        return;
      }

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events may not be capturable; drawing still works.
      }
      pointerIdRef.current = e.pointerId;
      startPosRef.current = pos;
      lastPosRef.current = pos;

      if (tool === "brush" || tool === "eraser") {
        drawPolyline([pos], color, effectiveSize, tool === "eraser");
        if (onStrokeBatch) {
          strokeIdRef.current = Math.random().toString(36).slice(2, 10);
          pendingRef.current = [pos];
          lastSentRef.current = null;
          stopFlushTimer();
          flushTimerRef.current = window.setInterval(flushStroke, streamIntervalMs);
        }
      } else {
        const ctx = ctxOf(canvasRef.current);
        previewRef.current = ctx ? ctx.getImageData(0, 0, W, H) : null;
      }
    };

    const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (readOnly || pointerIdRef.current !== e.pointerId) return;
      const start = startPosRef.current;
      const last = lastPosRef.current;
      if (!start || !last) return;
      const pos = getEventPos(e);
      if (tool === "brush" || tool === "eraser") {
        drawPolyline([last, pos], color, effectiveSize, tool === "eraser");
        if (strokeIdRef.current) pendingRef.current.push(pos);
      } else {
        const ctx = ctxOf(canvasRef.current);
        if (ctx && previewRef.current) ctx.putImageData(previewRef.current, 0, 0);
        drawShape(tool as "line" | "rect" | "ellipse", start, pos, color, effectiveSize, fill);
      }
      lastPosRef.current = pos;
    };

    const endGesture = () => {
      if (pointerIdRef.current === null) return;
      pointerIdRef.current = null;
      const start = startPosRef.current;
      const last = lastPosRef.current ?? start;
      startPosRef.current = null;
      lastPosRef.current = null;
      previewRef.current = null;
      if (!start || !last) return;

      if (tool === "brush" || tool === "eraser") {
        stopFlushTimer();
        flushStroke();
        strokeIdRef.current = null;
        lastSentRef.current = null;
        pendingRef.current = [];
      } else if (onStrokeBatch) {
        onStrokeBatch({
          action: "stroke",
          kind: tool as "line" | "rect" | "ellipse",
          from: start,
          to: last,
          color,
          size: effectiveSize,
          fill: tool === "line" ? undefined : fill,
        });
      }
      emitChange();
    };

    const clear = useCallback(() => {
      if (!canvasRef.current) return;
      saveToUndoStack();
      paintBackground();
      emitChange();
      onStrokeBatch?.({ action: "canvas_clear" });
    }, [emitChange, onStrokeBatch, paintBackground, saveToUndoStack]);

    const undo = useCallback(() => {
      const ctx = ctxOf(canvasRef.current);
      const previous = undoStackRef.current.pop();
      if (!ctx || !previous) return;
      ctx.putImageData(previous, 0, 0);
      emitChange();
      onStrokeBatch?.({ action: "canvas_undo" });
    }, [emitChange, onStrokeBatch]);

    // ---- remote side ----

    const applyNow = useCallback(
      (action: CanvasAction) => {
        if (action.action === "canvas_clear") {
          saveToUndoStack();
          remoteStrokeIdRef.current = null;
          paintBackground();
          return;
        }
        if (action.action === "canvas_undo") {
          remoteStrokeIdRef.current = null;
          const previous = undoStackRef.current.pop();
          const ctx = ctxOf(canvasRef.current);
          if (previous && ctx) ctx.putImageData(previous, 0, 0);
          return;
        }
        if (action.action !== "stroke") return;
        const s = action;
        const size = typeof s.size === "number" ? s.size : 10;
        const strokeColor = typeof s.color === "string" ? s.color : "#131320";
        if (s.kind === "brush" || s.kind === "eraser") {
          if (!Array.isArray(s.points) || s.points.length === 0) return;
          // Snapshot once per stroke: the first segment of a new id, or every
          // id-less whole stroke.
          if (!s.id || s.id !== remoteStrokeIdRef.current) {
            saveToUndoStack();
            remoteStrokeIdRef.current = s.id ?? null;
          }
          drawPolyline(s.points, strokeColor, size, s.kind === "eraser");
          return;
        }
        remoteStrokeIdRef.current = null;
        if ((s.kind === "line" || s.kind === "rect" || s.kind === "ellipse") && s.from && s.to) {
          saveToUndoStack();
          drawShape(s.kind, s.from, s.to, strokeColor, size, !!s.fill);
        } else if (s.kind === "fill" && typeof s.x === "number" && typeof s.y === "number") {
          saveToUndoStack();
          floodFill(s.x, s.y, strokeColor);
        } else if (s.kind === "snapshot" && typeof s.data === "string" && s.data.startsWith("data:image/")) {
          // Resync: replace the canvas and start a fresh history (the
          // sender drops theirs too). Strokes arriving while the image
          // decodes queue up behind it.
          undoStackRef.current = [];
          remoteQueueRef.current = [];
          const image = new Image();
          const finish = () => {
            const queued = remoteQueueRef.current ?? [];
            remoteQueueRef.current = null;
            queued.forEach((queuedAction) => applyRemoteRef.current(queuedAction));
          };
          image.onload = () => {
            paintBackground();
            ctxOf(canvasRef.current)?.drawImage(image, 0, 0, W, H);
            finish();
          };
          image.onerror = finish;
          image.src = s.data;
        }
      },
      [W, H, drawPolyline, drawShape, floodFill, paintBackground, saveToUndoStack],
    );

    const applyRemoteStroke = useCallback(
      (action: CanvasAction) => {
        if (!action || typeof action !== "object") return;
        if (remoteQueueRef.current) {
          remoteQueueRef.current.push(action);
          return;
        }
        applyNow(action);
      },
      [applyNow],
    );
    const applyRemoteRef = useRef(applyRemoteStroke);
    useEffect(() => {
      applyRemoteRef.current = applyRemoteStroke;
    }, [applyRemoteStroke]);

    useImperativeHandle(
      ref,
      () => ({
        applyRemoteStroke,
        toDataURL: (type = "image/png", quality = 1) =>
          canvasRef.current?.toDataURL(type, quality) ?? "",
        exportCompressed: (opts?: CompressOptions) =>
          canvasRef.current ? compressCanvas(canvasRef.current, opts) : "",
        snapshot: () => {
          let canvas = canvasRef.current;
          // Mid-drag of a line/rect/ellipse the canvas shows the preview,
          // which isn't part of the drawing yet (the shape is sent on
          // pointer-up): snapshot the pre-gesture image instead.
          const preview = previewRef.current;
          if (canvas && preview) {
            const copy = document.createElement("canvas");
            copy.width = preview.width;
            copy.height = preview.height;
            copy.getContext("2d")?.putImageData(preview, 0, 0);
            canvas = copy;
          }
          let data = canvas?.toDataURL("image/png") ?? "";
          // Lossless when small; otherwise full-size webp/jpeg.
          if (canvas && data.length > 150_000) {
            data = compressCanvas(canvas, { maxSide: Math.max(W, H), quality: 0.9 });
          }
          return { action: "stroke", kind: "snapshot", data };
        },
        clear,
        undo,
        resetHistory: () => {
          undoStackRef.current = [];
        },
        isGestureActive: () => pointerIdRef.current !== null,
      }),
      [applyRemoteStroke, clear, undo, W, H],
    );

    const border = hue ?? "#5a3f7a";

    return (
      <div ref={rootRef} className="flex w-full flex-col items-center gap-3">
        <div
          style={{
            width: fitWidth ?? "100%",
            maxWidth: "100%",
            borderRadius: 18,
            border: `3px solid ${border}`,
            boxShadow: "0 6px 0 rgba(0,0,0,.35)",
            background: BG,
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          <canvas
            ref={canvasRef}
            data-testid="drawing-canvas"
            className="block"
            style={{
              width: "100%",
              aspectRatio: `${W} / ${H}`,
              cursor: readOnly ? "default" : tool === "eraser" ? "cell" : "crosshair",
              // Viewers can scroll the page over the canvas; drawers can't.
              touchAction: readOnly ? "auto" : "none",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onLostPointerCapture={endGesture}
            // Pointer events ONLY — browsers also fire compatibility mouse
            // events after pointer events; duplicating handlers would run
            // every stroke twice.
          />
        </div>

        {/* Toolbox below the canvas (design/DrawingCanvas.dc.html) */}
        {!readOnly && (
          <div
            ref={toolbarRef}
            data-testid="drawing-toolbar"
            className="flex w-full flex-col gap-2.5"
            style={{ maxWidth: fitWidth ? Math.max(fitWidth, 340) : undefined }}
          >
            <div className="flex justify-center gap-1.5">
              {(
                [
                  { id: "brush", Icon: Pencil, label: t("canvas.tool.brush") },
                  { id: "eraser", Icon: Eraser, label: t("canvas.tool.eraser") },
                  { id: "line", Icon: Slash, label: t("canvas.tool.line") },
                  { id: "rect", Icon: RectangleHorizontal, label: t("canvas.tool.rect") },
                  { id: "ellipse", Icon: Circle, label: t("canvas.tool.ellipse") },
                  { id: "fill", Icon: PaintBucket, label: t("canvas.tool.fill") },
                ] as const
              ).map(({ id, Icon, label }) => {
                const active = tool === id;
                return (
                  <button
                    key={id}
                    type="button"
                    data-testid={`canvas-tool-${id}`}
                    onClick={() => setTool(id)}
                    title={label}
                    aria-label={label}
                    aria-pressed={active}
                    className="flex flex-1 items-center justify-center active:translate-y-0.5"
                    style={{
                      maxWidth: 56,
                      height: toolH,
                      borderRadius: 12,
                      border: `2px solid ${active ? "#ffd23f" : "#5a3f7a"}`,
                      background: active ? "linear-gradient(180deg,#ffd23f,#f5b32a)" : "#2b1a3d",
                      color: active ? "#3d1f0e" : "#ffe9a8",
                      boxShadow: "0 3px 0 rgba(0,0,0,.35)",
                      cursor: "pointer",
                    }}
                  >
                    <Icon size={19} strokeWidth={2.5} />
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap justify-center gap-[5px]">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setColor(c);
                    if (tool === "eraser") setTool("brush");
                  }}
                  title={t("canvas.color")}
                  aria-label={`${t("canvas.color")} ${c}`}
                  aria-pressed={color === c}
                  style={{
                    width: swatchD,
                    height: swatchD,
                    borderRadius: 99,
                    background: c,
                    border: color === c ? "3px solid #ffe9a8" : "2px solid rgba(255,255,255,.2)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {BRUSH_SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSize(s)}
                    title={t("canvas.size", { px: s })}
                    aria-label={t("canvas.size", { px: s })}
                    aria-pressed={size === s}
                    className="flex items-center justify-center"
                    style={{
                      width: btnH,
                      height: btnH,
                      borderRadius: 12,
                      border: `2px solid ${size === s ? "#ffe9a8" : "#5a3f7a"}`,
                      background: size === s ? "#3a2751" : "#2b1a3d",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        width: Math.max(5, s * 0.8),
                        height: Math.max(5, s * 0.8),
                        borderRadius: 99,
                        background: "#ffe9a8",
                      }}
                    />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setFill(!fill)}
                  title={t("canvas.fillShapes")}
                  aria-pressed={fill}
                  style={{
                    height: btnH,
                    padding: "0 12px",
                    borderRadius: 12,
                    border: `2px solid ${fill ? "#35d4b9" : "#5a3f7a"}`,
                    background: fill ? "#35d4b9" : "#2b1a3d",
                    color: fill ? "#0c3d33" : "rgba(255,233,168,.6)",
                    font: "700 11px 'Space Mono', monospace",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fill ? t("canvas.fillOn") : t("canvas.fillOff")}
                </button>
              </div>

              <div className="flex gap-1.5">
                <button
                  type="button"
                  data-testid="canvas-undo"
                  onClick={undo}
                  className="flex items-center gap-1 active:translate-y-0.5"
                  style={{
                    height: btnH,
                    padding: "0 14px",
                    borderRadius: 12,
                    border: "2px solid #5a3f7a",
                    background: "#2b1a3d",
                    color: "#ffe9a8",
                    font: "700 13px 'Space Grotesk', sans-serif",
                    cursor: "pointer",
                    boxShadow: "0 3px 0 rgba(0,0,0,.35)",
                  }}
                >
                  <Undo2 size={15} strokeWidth={2.5} /> {t("canvas.undo")}
                </button>
                <button
                  type="button"
                  data-testid="canvas-clear"
                  onClick={clear}
                  className="active:translate-y-0.5"
                  style={{
                    height: btnH,
                    padding: "0 14px",
                    borderRadius: 12,
                    border: "none",
                    background: "linear-gradient(180deg,#ff6b85,#e84863)",
                    color: "#fff",
                    font: "700 13px 'Space Grotesk', sans-serif",
                    cursor: "pointer",
                    boxShadow: "0 3px 0 #8f1f33",
                  }}
                >
                  {t("canvas.clear")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);

DrawingCanvas.displayName = "DrawingCanvas";
