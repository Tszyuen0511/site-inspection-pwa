import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Eraser,
  Hand,
  Highlighter,
  Maximize,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
  SquareDashed,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { db } from "../db";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_RGB,
  HIGHLIGHT_WIDTHS,
  MAX_DRAWINGS,
  MAX_DRAWING_PAGES,
  MAX_STROKE_POINTS,
  highlightColor,
  highlightOpacity,
  highlightWidth,
  type Annotation,
  type Drawing,
  type HighlightColor,
  type Inspection,
} from "../domain";
import {
  addDrawing,
  addHighlight,
  clearHighlights,
  deleteAnnotation,
  deleteDrawing,
  highlightStrokes,
  locationRegion,
  markingPage,
  setLocationRegion,
  undoHighlight,
  updateAnnotation,
  updateDrawing,
} from "../drawings";
import { forgetDrawing, pageImage, readDrawingFile } from "../plan-render";
import { toDrawing, toViewer } from "../plan-view";
import { Button, Dialog, Field } from "./ui";

type Mode = "navigate" | "region" | "highlight" | "erase";
type View = { scale: number; x: number; y: number };
type Point = { x: number; y: number };
type Pen = {
  color: HighlightColor;
  size: keyof typeof HIGHLIGHT_WIDTHS;
  opacity: number;
};
const TOOLS: { mode: Mode; label: string; Icon: typeof Hand }[] = [
  { mode: "navigate", label: "Navigate", Icon: Hand },
  { mode: "region", label: "Place Region", Icon: SquareDashed },
  { mode: "highlight", label: "Highlight Pen", Icon: Highlighter },
  { mode: "erase", label: "Eraser", Icon: Eraser },
];
const rgb = (c: HighlightColor) => `rgb(${HIGHLIGHT_RGB[c].join(" ")})`;
/** Keeps at most MAX_STROKE_POINTS, always including the last point. */
const thin = (points: [number, number][]) => {
  if (points.length <= MAX_STROKE_POINTS) return points;
  const step = points.length / (MAX_STROKE_POINTS - 1);
  return [
    ...Array.from(
      { length: MAX_STROKE_POINTS - 1 },
      (_, i) => points[Math.floor(i * step)],
    ),
    points.at(-1)!,
  ];
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const TAP = 6; // px of movement that still counts as a tap
export function Plans({
  record,
  run,
}: {
  record: Inspection;
  run: (work: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  const readOnly = record.status !== "Draft";
  const drawings = useLiveQuery(
    () => db.drawings.where("inspectionId").equals(record.id).sortBy("order"),
    [record.id],
    [] as Drawing[],
  );
  const annotations = useLiveQuery(
    () => db.annotations.where("inspectionId").equals(record.id).toArray(),
    [record.id],
    [] as Annotation[],
  );
  const [drawingId, setDrawingId] = useState(""),
    [page, setPage] = useState(1),
    [mode, setMode] = useState<Mode>("navigate"),
    [selectedId, setSelectedId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmDrawing, setConfirmDrawing] = useState<Drawing>(),
    [confirmRegion, setConfirmRegion] = useState(false),
    [confirmClear, setConfirmClear] = useState(false),
    [pen, setPen] = useState<Pen>({
      color: "yellow",
      size: "medium",
      opacity: HIGHLIGHT_OPACITY.default,
    });
  const drawing = drawings.find((d) => d.id === drawingId) || drawings[0];
  const currentPage = drawing ? Math.min(page, drawing.pageCount) : 1;
  useEffect(() => {
    if (drawing && drawing.id !== drawingId) setDrawingId(drawing.id);
  }, [drawing, drawingId]);
  useEffect(() => {
    if (readOnly) setMode("navigate");
  }, [readOnly]);
  // The inspected element's single location region (legacy marks are not shown).
  const region = locationRegion(annotations);
  const regionDrawing = region
    ? drawings.find((d) => d.id === region.drawingId)
    : undefined;
  const regionHere =
    !!region && region.drawingId === drawing?.id && region.page === currentPage;
  // Highlighter strokes belong to the same single location as the region.
  const strokes = highlightStrokes(annotations);
  const marked = markingPage(annotations);
  const markedDrawing = marked
    ? drawings.find((d) => d.id === marked.drawingId)
    : undefined;
  const markedHere =
    !!marked && marked.drawingId === drawing?.id && marked.page === currentPage;
  const onPage = [
    ...strokes.filter(
      (s) => s.drawingId === drawing?.id && s.page === currentPage,
    ),
    ...(regionHere ? [region] : []),
  ];
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(list))
        await run(async () => {
          const read = await readDrawingFile(file);
          const added = await addDrawing(record.id, read, read.pageCount);
          setDrawingId(added.id);
          setPage(1);
        }, `${file.name} added to this inspection's plans.`);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <section className="plans" aria-labelledby="plans-title">
      <div className="page-title plans-title">
        <div>
          <div className="eyebrow">INSPECTION PLANS</div>
          <h1 id="plans-title">Plans</h1>
          <p>
            <span className="plans-intro">
              Mark where the inspected element is on the location plan with a
              region, highlighter strokes, or both. They appear on the plan in
              the PDF report.
            </span>
          </p>
        </div>
        {!readOnly && (
          <Button
            variant="outline"
            disabled={busy || drawings.length >= MAX_DRAWINGS}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={17} />
            {busy ? "Checking…" : "Upload drawing"}
          </Button>
        )}
        <input
          ref={fileInput}
          hidden
          type="file"
          multiple
          aria-label="Upload drawing"
          accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => void upload(e.target.files)}
        />
      </div>
      {readOnly && (
        <div className="notice" role="status">
          This inspection is {record.status.toLowerCase()}. Plans are read-only;
          reopen it as a revision to edit the location region.
        </div>
      )}
      {!drawings.length ? (
        <div className="card empty-state plans-empty">
          <MapPin size={34} />
          <h2>No drawings yet</h2>
          <p>
            Upload a PDF, JPEG, PNG or WebP drawing (up to 25 MB; PDFs up to{" "}
            {MAX_DRAWING_PAGES} pages; up to {MAX_DRAWINGS} drawings per
            inspection). The original file is stored on this device unchanged.
          </p>
        </div>
      ) : (
        drawing && (
          <>
            <DrawingBar
              drawings={drawings}
              drawing={drawing}
              page={currentPage}
              marked={marked}
              readOnly={readOnly}
              run={run}
              onDrawing={(id) => {
                setDrawingId(id);
                setPage(1);
                setSelectedId("");
              }}
              onPage={(p) => {
                setPage(p);
                setSelectedId("");
              }}
              onDelete={() => setConfirmDrawing(drawing)}
            />
            <div className="plans-workspace">
              <div className="plans-stage card">
                <div
                  className="plans-toolbar"
                  role="toolbar"
                  aria-label="Plan tools"
                >
                  <div className="plans-tools">
                    {TOOLS.map(({ mode: m, label, Icon }) => (
                      <button
                        key={m}
                        type="button"
                        className={`plan-tool ${mode === m ? "active" : ""} ${m === "region" ? "primary" : ""}`}
                        aria-pressed={mode === m}
                        disabled={readOnly && m !== "navigate"}
                        onClick={() => setMode(m)}
                        title={label}
                      >
                        <Icon size={19} />
                        <span className="plan-tool-label">{label}</span>
                      </button>
                    ))}
                  </div>
                  {mode === "highlight" && !readOnly && (
                    <div
                      className="plans-pen"
                      role="group"
                      aria-label="Highlighter settings"
                    >
                      <div
                        className="pen-swatches"
                        role="radiogroup"
                        aria-label="Highlighter colour"
                      >
                        {HIGHLIGHT_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            role="radio"
                            aria-checked={pen.color === c}
                            aria-label={c[0].toUpperCase() + c.slice(1)}
                            className={`pen-swatch ${pen.color === c ? "selected" : ""}`}
                            style={{ background: rgb(c) }}
                            onClick={() => setPen({ ...pen, color: c })}
                          />
                        ))}
                      </div>
                      <div
                        className="pen-sizes"
                        role="radiogroup"
                        aria-label="Stroke width"
                      >
                        {(["small", "medium", "large"] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            role="radio"
                            aria-checked={pen.size === s}
                            className={`pen-size ${pen.size === s ? "selected" : ""}`}
                            onClick={() => setPen({ ...pen, size: s })}
                          >
                            {s[0].toUpperCase() + s.slice(1)}
                          </button>
                        ))}
                      </div>
                      <label className="pen-opacity">
                        <span>Opacity {Math.round(pen.opacity * 100)}%</span>
                        <input
                          type="range"
                          min={HIGHLIGHT_OPACITY.min}
                          max={HIGHLIGHT_OPACITY.max}
                          step={0.05}
                          value={pen.opacity}
                          onChange={(e) =>
                            setPen({ ...pen, opacity: Number(e.target.value) })
                          }
                        />
                      </label>
                    </div>
                  )}
                  {(mode === "highlight" || mode === "erase") && !readOnly && (
                    <div className="plans-pen-actions">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!strokes.length}
                        onClick={() =>
                          void run(
                            () => undoHighlight(record.id),
                            "Last highlight removed.",
                          )
                        }
                      >
                        <Undo2 size={16} />
                        Undo stroke
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        disabled={!strokes.length}
                        onClick={() => setConfirmClear(true)}
                      >
                        <Trash2 size={16} />
                        Clear highlights
                      </Button>
                    </div>
                  )}
                </div>
                <Viewer
                  key={`${drawing.id}:${currentPage}`}
                  drawing={drawing}
                  page={currentPage}
                  annotations={onPage}
                  mode={mode}
                  readOnly={readOnly}
                  selectedId={selectedId}
                  pen={pen}
                  modeHint={
                    mode === "region"
                      ? region
                        ? "Drag on the drawing to draw a new region. It replaces the current one."
                        : "Drag on the drawing to draw the element's region."
                      : mode === "highlight"
                        ? "Draw over the element's location. Use two fingers to pan or zoom."
                        : mode === "erase"
                          ? "Tap a highlighter stroke to erase it."
                          : readOnly
                            ? "Drag to pan, pinch or scroll to zoom."
                            : "Drag to pan, pinch or scroll to zoom. Drag the region to move it."
                  }
                  onError={setError}
                  onSelect={setSelectedId}
                  onStroke={(points) =>
                    void run(() =>
                      addHighlight({
                        inspectionId: record.id,
                        drawingId: drawing.id,
                        page: currentPage,
                        points: thin(points),
                        color: pen.color,
                        opacity: pen.opacity,
                        width: HIGHLIGHT_WIDTHS[pen.size],
                      }),
                    )
                  }
                  onErase={(a) =>
                    void run(() => deleteAnnotation(a), "Highlight erased.")
                  }
                  onRegion={(a, b) =>
                    void run(async () => {
                      const saved = await setLocationRegion({
                        inspectionId: record.id,
                        drawingId: drawing.id,
                        page: currentPage,
                        a,
                        b,
                      });
                      setSelectedId(saved.id);
                      setMode("navigate");
                    }, "Location region saved.")
                  }
                  onMove={(a, patch) =>
                    void run(() => updateAnnotation(a, patch))
                  }
                />
                {error && (
                  <p className="plans-error" role="alert">
                    {error}
                  </p>
                )}
              </div>
              <aside className="plans-region-side" aria-label="Location region">
                <div className="card plans-panel">
                  <h2 className="plans-panel-title">Location region</h2>
                  {region ? (
                    <>
                      <p className="small">
                        Placed on{" "}
                        <strong>
                          {regionDrawing?.title ||
                            regionDrawing?.name ||
                            "a drawing"}
                        </strong>
                        {regionDrawing && regionDrawing.pageCount > 1
                          ? `, page ${region.page}`
                          : ""}
                        . All checklist items refer to this location.
                      </p>
                      <div className="row wrap">
                        {!regionHere && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setDrawingId(region.drawingId);
                              setPage(region.page);
                              setSelectedId(region.id);
                            }}
                          >
                            <MapPin size={16} />
                            Show region
                          </Button>
                        )}
                        {!readOnly && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger"
                            onClick={() => setConfirmRegion(true)}
                          >
                            <Trash2 size={16} />
                            Remove region
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="muted small">
                      No region yet.
                      {readOnly
                        ? ""
                        : " Choose Place Region, then drag across the element's location on the drawing."}
                    </p>
                  )}
                  <p className="small muted plans-stroke-count">
                    {strokes.length
                      ? `${strokes.length} highlighter stroke${strokes.length === 1 ? "" : "s"}`
                      : "No highlighter strokes."}
                  </p>
                  {marked && !markedHere && !regionHere && (
                    <p className="small muted">
                      The location is marked on{" "}
                      {markedDrawing?.title ||
                        markedDrawing?.name ||
                        "another drawing"}
                      {markedDrawing && markedDrawing.pageCount > 1
                        ? `, page ${marked.page}`
                        : ""}
                      .
                    </p>
                  )}
                </div>
              </aside>
            </div>
          </>
        )
      )}
      <Dialog
        open={!!confirmDrawing}
        onOpenChange={(v) => !v && setConfirmDrawing(undefined)}
        title="Delete this drawing?"
        description={
          region && region.drawingId === confirmDrawing?.id
            ? "The location region on this drawing is deleted with it. The original file is removed from this device."
            : "The original file is removed from this device."
        }
      >
        <div className="form-actions">
          <Button
            variant="outline"
            onClick={() => setConfirmDrawing(undefined)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const d = confirmDrawing!;
              setConfirmDrawing(undefined);
              setSelectedId("");
              void run(async () => {
                await deleteDrawing(d);
                forgetDrawing(d.id);
                setDrawingId("");
              }, "Drawing deleted.");
            }}
          >
            Delete drawing
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={confirmRegion}
        onOpenChange={setConfirmRegion}
        title="Remove the location region?"
        description="The element's location is removed from the plan. You can place a new region at any time."
      >
        <div className="form-actions">
          <Button variant="outline" onClick={() => setConfirmRegion(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setConfirmRegion(false);
              setSelectedId("");
              if (region)
                void run(
                  () => deleteAnnotation(region),
                  "Location region removed.",
                );
            }}
          >
            Remove region
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear all highlights?"
        description={`All ${strokes.length} highlighter stroke(s) are removed from the plan. The location region and the drawing itself are not changed.`}
      >
        <div className="form-actions">
          <Button variant="outline" onClick={() => setConfirmClear(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setConfirmClear(false);
              void run(() => clearHighlights(record.id), "Highlights cleared.");
            }}
          >
            Clear highlights
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

function DrawingBar({
  drawings,
  drawing,
  page,
  marked,
  readOnly,
  run,
  onDrawing,
  onPage,
  onDelete,
}: {
  drawings: Drawing[];
  drawing: Drawing;
  page: number;
  marked?: { drawingId: string; page: number };
  readOnly: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
  onDrawing: (id: string) => void;
  onPage: (page: number) => void;
  onDelete: () => void;
}) {
  const hasMarking = (p: number) =>
    marked?.drawingId === drawing.id && marked.page === p;
  return (
    <div className="card plans-drawing-bar">
      <div className="plans-drawing-pick">
        <Field label="Drawing">
          <select
            value={drawing.id}
            onChange={(e) => onDrawing(e.target.value)}
          >
            {drawings.map((d, i) => (
              <option key={d.id} value={d.id}>
                {i + 1}. {d.title || d.name}
              </option>
            ))}
          </select>
        </Field>
        {drawing.pageCount > 1 && (
          <Field label={`Page (of ${drawing.pageCount})`}>
            <select
              value={page}
              onChange={(e) => onPage(Number(e.target.value))}
            >
              {Array.from({ length: drawing.pageCount }, (_, i) => i + 1).map(
                (p) => (
                  <option key={p} value={p}>
                    Page {p}
                    {hasMarking(p) ? " · marked location" : ""}
                  </option>
                ),
              )}
            </select>
          </Field>
        )}
      </div>
      <details className="plans-meta">
        <summary>Drawing details</summary>
        <div className="plans-meta-fields" key={drawing.id}>
          {(
            [
              ["title", "Drawing title", "[Drawing title]", 300],
              ["number", "Drawing number", "[Drawing number]", 100],
              ["revision", "Revision", "[Rev.]", 50],
            ] as const
          ).map(([key, label, placeholder, max]) => (
            <Field key={key} label={label}>
              <input
                defaultValue={drawing[key]}
                disabled={readOnly}
                maxLength={max}
                placeholder={placeholder}
                onChange={(e) =>
                  void run(() =>
                    updateDrawing(drawing, { [key]: e.target.value }),
                  )
                }
              />
            </Field>
          ))}
          <p className="small muted">
            File: {drawing.name} · {(drawing.size / 1048576).toFixed(1)} MB ·{" "}
            {drawing.pageCount} page{drawing.pageCount === 1 ? "" : "s"}. Stored
            unchanged on this device.
          </p>
          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              onClick={onDelete}
            >
              <Trash2 size={16} />
              Delete drawing
            </Button>
          )}
        </div>
      </details>
    </div>
  );
}

function Viewer({
  drawing,
  page,
  annotations,
  mode,
  readOnly,
  selectedId,
  pen,
  modeHint,
  onError,
  onSelect,
  onRegion,
  onStroke,
  onErase,
  onMove,
}: {
  drawing: Drawing;
  page: number;
  annotations: Annotation[];
  mode: Mode;
  readOnly: boolean;
  selectedId: string;
  pen: Pen;
  modeHint: string;
  onError: (message: string) => void;
  onSelect: (id: string) => void;
  onRegion: (a: Point, b: Point) => void;
  onStroke: (points: [number, number][]) => void;
  onErase: (a: Annotation) => void;
  onMove: (a: Annotation, patch: Partial<Annotation>) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<{
    url: string;
    width: number;
    height: number;
  }>();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [fitted, setFitted] = useState(false);
  const [draft, setDraft] = useState<{ a: Point; b: Point }>();
  // The highlighter stroke being drawn, in drawing-relative coordinates.
  const [ink, setInk] = useState<[number, number][]>();
  const [moving, setMoving] = useState<{
    id: string;
    dx: number;
    dy: number;
  }>();
  const gesture = useRef<{
    pointers: Map<number, Point>;
    start?: Point;
    view?: View;
    pinch?: { dist: number; mid: Point; view: View };
    target?: Annotation;
    moved: boolean;
    stroke?: [number, number][];
  }>({ pointers: new Map(), moved: false });

  useEffect(() => {
    let live = true;
    setImage(undefined);
    onError("");
    pageImage(drawing, page)
      .then((img) => live && setImage(img))
      .catch(
        (e) => live && onError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      live = false;
    };
    // Only a different file or page needs a new render; metadata edits do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing.id, drawing.mimeType, page, onError]);
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fitScale =
    image && size.w
      ? Math.min(size.w / image.width, size.h / image.height) * 0.96
      : 1;
  const fit = useCallback(() => {
    if (!image || !size.w) return;
    const s = Math.min(size.w / image.width, size.h / image.height) * 0.96;
    setView({
      scale: s,
      x: (size.w - image.width * s) / 2,
      y: (size.h - image.height * s) / 2,
    });
  }, [image, size.w, size.h]);
  useEffect(() => {
    if (image && size.w && !fitted) {
      fit();
      setFitted(true);
    }
  }, [image, size.w, fitted, fit]);
  // Keep the drawing fitted when the screen rotates or resizes before any zoom.
  const lastSize = useRef(size);
  useEffect(() => {
    // If the drawing was still fitted at the previous size (not zoomed by the
    // user), refit after a rotation or resize.
    const prev = lastSize.current;
    if (fitted && image && prev.w) {
      const prevFit =
        Math.min(prev.w / image.width, prev.h / image.height) * 0.96;
      if (Math.abs(view.scale - prevFit) < 1e-3 * prevFit) fit();
    }
    lastSize.current = size;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  const zoomAt = (factor: number, px = size.w / 2, py = size.h / 2) =>
    setView((v) => {
      const scale = Math.min(
        fitScale * 16,
        Math.max(fitScale * 0.5, v.scale * factor),
      );
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  // Wheel zoom needs a non-passive listener so the page does not also scroll.
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  wheel.current = (e: WheelEvent) => {
    e.preventDefault();
    const p = toLocal(e.clientX, e.clientY);
    zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  };
  useEffect(() => {
    const el = box.current!;
    const listener = (e: WheelEvent) => wheel.current(e);
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, []);
  const toLocal = (clientX: number, clientY: number): Point => {
    // Children are positioned inside the border, so measure from there.
    const el = box.current!,
      r = el.getBoundingClientRect();
    return {
      x: clientX - r.left - el.clientLeft,
      y: clientY - r.top - el.clientTop,
    };
  };
  const toRel = (p: Point): Point =>
    image ? toDrawing(p, view, image) : { x: 0, y: 0 };
  const toScreen = (x: number, y: number): Point =>
    image ? toViewer(x, y, view, image) : { x: 0, y: 0 };
  const inside = (p: Point) =>
    !!image &&
    p.x >= view.x &&
    p.y >= view.y &&
    p.x <= view.x + image.width * view.scale &&
    p.y <= view.y + image.height * view.scale;

  const down = (e: React.PointerEvent) => {
    if (!image) return;
    try {
      box.current!.setPointerCapture(e.pointerId);
    } catch {
      /* Capture is an optimisation; the gesture still works without it. */
    }
    const g = gesture.current,
      p = toLocal(e.clientX, e.clientY);
    g.pointers.set(e.pointerId, p);
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view,
      };
      setDraft(undefined);
      setMoving(undefined);
      g.stroke = undefined;
      setInk(undefined);
      return;
    }
    const id = (e.target as Element)
      .closest("[data-annotation-id]")
      ?.getAttribute("data-annotation-id");
    g.target = id ? annotations.find((a) => a.id === id) : undefined;
    g.start = p;
    g.view = view;
    g.moved = false;
    if (mode === "highlight" && !readOnly && inside(p)) {
      const r = toRel(p);
      g.stroke = [[r.x, r.y]];
      setInk(g.stroke);
    }
  };
  const move = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    const p = toLocal(e.clientX, e.clientY);
    g.pointers.set(e.pointerId, p);
    if (g.pinch && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y),
        mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const v = g.pinch.view;
      const scale = Math.min(
        fitScale * 16,
        Math.max(fitScale * 0.5, (v.scale * dist) / g.pinch.dist),
      );
      const k = scale / v.scale;
      setView({
        scale,
        x: mid.x - (g.pinch.mid.x - v.x) * k,
        y: mid.y - (g.pinch.mid.y - v.y) * k,
      });
      return;
    }
    if (g.stroke) {
      // Freehand: add a point once the pointer has moved a couple of pixels.
      const [lx, ly] = g.stroke.at(-1)!;
      const last = toScreen(lx, ly);
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 2) {
        const r = toRel(p);
        g.stroke.push([r.x, r.y]);
        setInk([...g.stroke]);
      }
      return;
    }
    if (!g.start || !g.view) return;
    const dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) > TAP) g.moved = true;
    if (!g.moved) return;
    if (g.target?.kind === "region" && mode === "navigate" && !readOnly) {
      setMoving({
        id: g.target.id,
        dx: dx / (image!.width * view.scale),
        dy: dy / (image!.height * view.scale),
      });
    } else if (mode === "navigate" || mode === "erase") {
      setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    } else if (mode === "region" && inside(g.start))
      setDraft({ a: toRel(g.start), b: toRel(p) });
  };
  const up = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.delete(e.pointerId);
    if (g.pinch) {
      if (g.pointers.size === 0) g.pinch = undefined;
      g.start = undefined;
      g.stroke = undefined;
      return;
    }
    const start = g.start,
      target = g.target;
    g.start = undefined;
    g.target = undefined;
    if (!start) return;
    const p = toLocal(e.clientX, e.clientY);
    if (g.stroke) {
      const points = g.stroke;
      g.stroke = undefined;
      g.moved = false;
      setInk(undefined);
      if (e.type === "pointercancel") return;
      const r = toRel(p);
      const [lx, ly] = points.at(-1)!;
      if (r.x !== lx || r.y !== ly) points.push([r.x, r.y]);
      // A tap leaves a dot: a stroke needs two points.
      if (points.length === 1)
        points.push([clamp01(points[0][0] + 0.001), points[0][1]]);
      onStroke(points);
      return;
    }
    // The final result is computed from the pointer coordinates themselves, not
    // from preview state: browsers (notably Safari) can deliver pointerup before
    // React has rendered the last pointermove, so preview state may be stale.
    const moved = g.moved || Math.hypot(p.x - start.x, p.y - start.y) > TAP;
    g.moved = false;
    setMoving(undefined);
    setDraft(undefined);
    if (
      moved &&
      target?.kind === "region" &&
      mode === "navigate" &&
      !readOnly &&
      image
    ) {
      const mx = (p.x - start.x) / (image.width * view.scale),
        my = (p.y - start.y) / (image.height * view.scale);
      onMove(target, {
        x: clamp01(target.x + mx),
        y: clamp01(target.y + my),
        ...(target.x2 !== undefined
          ? {
              x2: clamp01(target.x2 + mx),
              y2: clamp01((target.y2 ?? 0) + my),
            }
          : {}),
      });
      return;
    }
    if (moved && mode === "region" && inside(start) && !readOnly) {
      const a = toRel(start),
        b = toRel(p);
      // Ignore accidental slivers; a region needs some width and height.
      if (Math.abs(a.x - b.x) > 0.005 && Math.abs(a.y - b.y) > 0.005)
        onRegion(a, b);
      return;
    }
    if (moved) return;
    if (mode === "erase" && target?.kind === "highlight" && !readOnly)
      return onErase(target);
    onSelect(target ? target.id : "");
  };
  const key = (e: React.KeyboardEvent) => {
    const step = 60;
    const actions: Record<string, () => void> = {
      "+": () => zoomAt(1.25),
      "=": () => zoomAt(1.25),
      "-": () => zoomAt(0.8),
      "0": fit,
      ArrowLeft: () => setView((v) => ({ ...v, x: v.x + step })),
      ArrowRight: () => setView((v) => ({ ...v, x: v.x - step })),
      ArrowUp: () => setView((v) => ({ ...v, y: v.y + step })),
      ArrowDown: () => setView((v) => ({ ...v, y: v.y - step })),
      // Keyboard placement: a region around the centre of the current view.
      Enter: () => {
        if (readOnly || mode !== "region" || !image) return;
        const c = toRel({ x: size.w / 2, y: size.h / 2 }),
          dx = (size.w * 0.12) / (image.width * view.scale),
          dy = (size.h * 0.12) / (image.height * view.scale);
        onRegion(
          { x: clamp01(c.x - dx), y: clamp01(c.y - dy) },
          { x: clamp01(c.x + dx), y: clamp01(c.y + dy) },
        );
      },
    };
    if (e.target !== box.current || !actions[e.key]) return;
    e.preventDefault();
    actions[e.key]();
  };
  const position = (a: Annotation) =>
    moving?.id === a.id
      ? {
          ...a,
          x: a.x + moving.dx,
          y: a.y + moving.dy,
          x2: a.x2 !== undefined ? a.x2 + moving.dx : undefined,
          y2: a.y2 !== undefined ? a.y2 + moving.dy : undefined,
        }
      : a;

  return (
    <div className="plans-viewer-wrap">
      <div
        ref={box}
        className={`plans-viewer mode-${mode}`}
        tabIndex={0}
        role="application"
        aria-roledescription="drawing viewer"
        aria-label={`${drawing.title || drawing.name}, page ${page} of ${drawing.pageCount}. ${modeHint} Keyboard: arrows pan, plus and minus zoom, 0 fits${mode === "region" ? ", Enter places a region at the centre" : ""}.`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        {image ? (
          <img
            src={image.url}
            alt=""
            draggable={false}
            className="plans-image"
            style={{
              width: image.width,
              height: image.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
          />
        ) : (
          <p className="plans-loading">Rendering drawing…</p>
        )}
        {image && (
          <svg
            className="plans-shapes"
            width={size.w}
            height={size.h}
            aria-hidden="false"
          >
            {annotations.map((raw) => {
              if (raw.kind === "highlight") {
                const pts = raw
                  .points!.map(([u, v]) => {
                    const q = toScreen(u, v);
                    return `${q.x},${q.y}`;
                  })
                  .join(" ");
                const sw = highlightWidth(raw) * image.width * view.scale;
                return (
                  <g
                    key={raw.id}
                    data-annotation-id={raw.id}
                    className={`plan-highlight ${mode === "erase" && !readOnly ? "erasable" : ""}`}
                    role="img"
                    aria-label="Highlighter stroke"
                  >
                    <polyline
                      points={pts}
                      stroke={rgb(highlightColor(raw))}
                      strokeOpacity={highlightOpacity(raw)}
                      strokeWidth={sw}
                    />
                    <polyline
                      className="hit"
                      points={pts}
                      strokeWidth={Math.max(sw, 22)}
                    />
                  </g>
                );
              }
              const a = position(raw);
              const p1 = toScreen(a.x, a.y),
                p2 = toScreen(a.x2 ?? a.x, a.y2 ?? a.y);
              const shape = (
                <rect
                  x={Math.min(p1.x, p2.x)}
                  y={Math.min(p1.y, p2.y)}
                  width={Math.abs(p2.x - p1.x)}
                  height={Math.abs(p2.y - p1.y)}
                />
              );
              return (
                <g
                  key={a.id}
                  data-annotation-id={a.id}
                  className={`plan-shape plan-region ${a.id === selectedId ? "selected" : ""}`}
                  role="img"
                  aria-label="Location region of the inspected element"
                >
                  <g className="fill">{shape}</g>
                  <g className="halo">{shape}</g>
                  <g className="stroke">{shape}</g>
                  <g className="hit">{shape}</g>
                </g>
              );
            })}
            {ink && (
              <polyline
                className="plan-highlight draft"
                points={ink
                  .map(([u, v]) => {
                    const q = toScreen(u, v);
                    return `${q.x},${q.y}`;
                  })
                  .join(" ")}
                stroke={rgb(pen.color)}
                strokeOpacity={pen.opacity}
                strokeWidth={
                  HIGHLIGHT_WIDTHS[pen.size] * image.width * view.scale
                }
              />
            )}
            {draft && (
              <DraftShape
                a={toScreen(draft.a.x, draft.a.y)}
                b={toScreen(draft.b.x, draft.b.y)}
              />
            )}
          </svg>
        )}
      </div>
      <div className="plans-viewbar">
        <span className="plans-hint" aria-live="polite">
          {modeHint}
        </span>
        <span className="plans-zoom">
          <Button
            size="icon"
            variant="outline"
            aria-label="Zoom out"
            onClick={() => zoomAt(0.8)}
          >
            <Minus size={18} />
          </Button>
          <span className="plans-zoom-level">
            {Math.round((view.scale / fitScale) * 100)}%
          </span>
          <Button
            size="icon"
            variant="outline"
            aria-label="Zoom in"
            onClick={() => zoomAt(1.25)}
          >
            <Plus size={18} />
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="Fit drawing to view"
            onClick={fit}
          >
            <Maximize size={18} />
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="Reset view"
            onClick={() => {
              fit();
              onSelect("");
            }}
          >
            <RotateCcw size={18} />
          </Button>
        </span>
      </div>
    </div>
  );
}
function DraftShape({ a, b }: { a: Point; b: Point }) {
  return (
    <g className="plan-shape plan-region draft">
      <g className="stroke">
        <rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
        />
      </g>
    </g>
  );
}
