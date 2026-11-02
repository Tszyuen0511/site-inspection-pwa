import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowUpRight,
  Camera,
  Circle,
  Hand,
  ListOrdered,
  Maximize,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { db } from "../db";
import {
  MAX_DRAWINGS,
  MAX_DRAWING_PAGES,
  MAX_PHOTOS,
  photoNumber,
  type Annotation,
  type Drawing,
  type Inspection,
  type Photo,
  type PhotoView,
} from "../domain";
import {
  addAnnotation,
  addDrawing,
  deleteAnnotation,
  deleteDrawing,
  editPlans,
  updateAnnotation,
  updateDrawing,
} from "../drawings";
import { forgetDrawing, pageImage, readDrawingFile } from "../plan-render";
import { legendRows, markLabels, statusText } from "../plan-labels";
import { orderedPhotos, preparePhoto, toStoredPhoto } from "../photos";
import { Button, Dialog, Field } from "./ui";
import { PhotoImage } from "./PhotoManager";

type Mode = "navigate" | "marker" | "rect" | "circle" | "arrow" | "text";
type View = { scale: number; x: number; y: number };
type Point = { x: number; y: number };
const TOOLS: { mode: Mode; label: string; Icon: typeof Hand }[] = [
  { mode: "navigate", label: "Navigate", Icon: Hand },
  { mode: "marker", label: "Place mark", Icon: MapPin },
  { mode: "rect", label: "Rectangle", Icon: Square },
  { mode: "circle", label: "Circle", Icon: Circle },
  { mode: "arrow", label: "Arrow", Icon: ArrowUpRight },
  { mode: "text", label: "Text note", Icon: Type },
];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const TAP = 6; // px of movement that still counts as a tap
/** Matches the CSS breakpoint where details and legend sit in a side panel. */
const SIDE_PANEL = "(min-width: 1100px)";
function useSidePanel() {
  const [wide, setWide] = useState(() => matchMedia(SIDE_PANEL).matches);
  useEffect(() => {
    const query = matchMedia(SIDE_PANEL);
    const update = () => setWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

export function Plans({
  record,
  photos,
  run,
  onOpenItem,
}: {
  record: Inspection;
  photos: PhotoView[];
  run: (work: () => Promise<unknown>, success?: string) => Promise<void>;
  onOpenItem: (itemId: string) => void;
}) {
  const readOnly = record.status !== "Draft";
  const sidePanel = useSidePanel();
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
    [itemId, setItemId] = useState(record.template.items[0]?.id || ""),
    [selectedId, setSelectedId] = useState(""),
    [sheet, setSheet] = useState<"" | "mark" | "legend">(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmDrawing, setConfirmDrawing] = useState<Drawing>(),
    [confirmMark, setConfirmMark] = useState<{
      a: Annotation;
      photos: number;
    }>(),
    [textAt, setTextAt] = useState<Point>(),
    [textValue, setTextValue] = useState("");
  const drawing = drawings.find((d) => d.id === drawingId) || drawings[0];
  const currentPage = drawing ? Math.min(page, drawing.pageCount) : 1;
  useEffect(() => {
    if (drawing && drawing.id !== drawingId) setDrawingId(drawing.id);
  }, [drawing, drawingId]);
  useEffect(() => {
    if (readOnly) setMode("navigate");
  }, [readOnly]);
  const labels = useMemo(
    () => markLabels(record.template.items, annotations, drawings),
    [record.template.items, annotations, drawings],
  );
  const onPage = annotations.filter(
    (a) => a.drawingId === drawing?.id && a.page === currentPage,
  );
  const selected = annotations.find((a) => a.id === selectedId);
  const legend = legendRows(record, annotations, drawings);
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
              Mark inspection locations on drawings. Marks follow the checklist
              numbering and appear in the PDF report.
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
          reopen it as a revision to edit marks.
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
              annotations={annotations}
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
                        className={`plan-tool ${mode === m ? "active" : ""} ${m === "marker" ? "primary" : ""}`}
                        aria-pressed={mode === m}
                        disabled={readOnly && m !== "navigate"}
                        onClick={() => setMode(m)}
                        title={label}
                      >
                        <Icon size={19} />
                        <span
                          className={
                            m === "marker" || m === "navigate"
                              ? "plan-tool-label"
                              : "sr-only"
                          }
                        >
                          {label}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="plan-tool plans-legend-button"
                      onClick={() => setSheet("legend")}
                      aria-label={`Legend, ${legend.length} marks`}
                    >
                      <ListOrdered size={19} />
                      <span aria-hidden="true">{legend.length}</span>
                    </button>
                  </div>
                  <label className="plans-item-select">
                    <span>Checklist item for marks</span>
                    <select
                      value={itemId}
                      disabled={readOnly}
                      onChange={(e) => setItemId(e.target.value)}
                    >
                      {record.template.items.map((item, i) => (
                        <option key={item.id} value={item.id}>
                          {i + 1}. {item.description}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Viewer
                  key={`${drawing.id}:${currentPage}`}
                  drawing={drawing}
                  page={currentPage}
                  annotations={onPage}
                  labels={labels}
                  mode={mode}
                  readOnly={readOnly}
                  selectedId={selectedId}
                  // Phones: keep the selected mark visible above the bottom sheet.
                  focusId={!sidePanel && sheet === "mark" ? selectedId : ""}
                  modeHint={
                    mode === "marker"
                      ? `Tap the drawing to place a mark for item ${record.template.items.findIndex((i) => i.id === itemId) + 1}.`
                      : mode === "navigate"
                        ? "Drag to pan, pinch or scroll to zoom. Tap a mark to see its item."
                        : mode === "text"
                          ? "Tap where the note should go."
                          : "Drag on the drawing to draw."
                  }
                  onError={setError}
                  onSelect={(id) => {
                    setSelectedId(id);
                    // Phones and tablets: details open as a sheet; wide screens
                    // already show them in the side panel.
                    if (id && !sidePanel) setSheet("mark");
                  }}
                  onPlace={(p) =>
                    void run(async () => {
                      if (!itemId)
                        throw new Error("Choose a checklist item first.");
                      const a = await addAnnotation({
                        inspectionId: record.id,
                        drawingId: drawing.id,
                        page: currentPage,
                        kind: "marker",
                        itemId,
                        x: p.x,
                        y: p.y,
                      });
                      setSelectedId(a.id);
                    })
                  }
                  onShape={(kind, a, b) =>
                    void run(() =>
                      addAnnotation({
                        inspectionId: record.id,
                        drawingId: drawing.id,
                        page: currentPage,
                        kind,
                        x: a.x,
                        y: a.y,
                        x2: b.x,
                        y2: b.y,
                      }),
                    )
                  }
                  onText={(p) => {
                    setTextValue("");
                    setTextAt(p);
                  }}
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
              <aside
                className="plans-side"
                aria-label="Mark details and legend"
              >
                <div className="card plans-panel">
                  {selected ? (
                    <MarkDetails
                      annotation={selected}
                      record={record}
                      photos={photos}
                      label={labels.get(selected.id)?.label}
                      readOnly={readOnly}
                      run={run}
                      onOpenItem={onOpenItem}
                      onDelete={async () =>
                        setConfirmMark({
                          a: selected,
                          photos: photos.filter((p) => p.markId === selected.id)
                            .length,
                        })
                      }
                    />
                  ) : (
                    <p className="muted small">
                      Select a mark to see its checklist item, status, remarks
                      and photographs.
                    </p>
                  )}
                </div>
                <div className="card plans-panel">
                  <Legend
                    rows={legend}
                    drawings={drawings}
                    onSelect={(row) => {
                      setDrawingId(row.drawingId);
                      setPage(row.page);
                      setSelectedId(row.annotationId);
                    }}
                  />
                </div>
              </aside>
            </div>
          </>
        )
      )}
      {/* Phone: details and legend open as bottom sheets. */}
      <Dialog
        open={sheet === "mark" && !!selected && !sidePanel}
        onOpenChange={(v) => !v && setSheet("")}
        title={
          selected?.kind === "marker"
            ? `Mark ${labels.get(selected.id)?.label ?? ""}`
            : "Annotation"
        }
        className="plans-sheet"
      >
        {selected && (
          <MarkDetails
            annotation={selected}
            record={record}
            photos={photos}
            label={labels.get(selected.id)?.label}
            readOnly={readOnly}
            run={run}
            onOpenItem={(id) => {
              setSheet("");
              onOpenItem(id);
            }}
            onDelete={async () => {
              setSheet("");
              setConfirmMark({
                a: selected,
                photos: photos.filter((p) => p.markId === selected.id).length,
              });
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={sheet === "legend" && !sidePanel}
        onOpenChange={(v) => !v && setSheet("")}
        title="Plan legend"
        description="Generated from the checklist. Labels follow item numbers; several locations for one item get A, B, C."
        className="plans-sheet"
      >
        <Legend
          rows={legend}
          drawings={drawings}
          onSelect={(row) => {
            setDrawingId(row.drawingId);
            setPage(row.page);
            setSelectedId(row.annotationId);
            setSheet("");
          }}
        />
      </Dialog>
      <Dialog
        open={!!textAt}
        onOpenChange={(v) => !v && setTextAt(undefined)}
        title="Text note"
        description="A short note shown on the drawing (up to 120 characters)."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const at = textAt!,
              text = textValue.trim();
            setTextAt(undefined);
            if (text && drawing)
              void run(() =>
                addAnnotation({
                  inspectionId: record.id,
                  drawingId: drawing.id,
                  page: currentPage,
                  kind: "text",
                  x: at.x,
                  y: at.y,
                  text,
                }),
              );
          }}
        >
          <Field label="Note">
            <input
              autoFocus
              maxLength={120}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="[Short note]"
            />
          </Field>
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setTextAt(undefined)}
            >
              Cancel
            </Button>
            <Button type="submit">Add note</Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={!!confirmDrawing}
        onOpenChange={(v) => !v && setConfirmDrawing(undefined)}
        title="Delete this drawing?"
        description={(() => {
          const n = annotations.filter(
            (a) => a.drawingId === confirmDrawing?.id,
          ).length;
          return n
            ? `It has ${n} mark(s) or note(s) that will be deleted with it. Photographs stay with their checklist items but lose the location link. The original file is removed from this device.`
            : "The original file is removed from this device.";
        })()}
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
        open={!!confirmMark}
        onOpenChange={(v) => !v && setConfirmMark(undefined)}
        title="Delete this annotation?"
        description={
          confirmMark?.photos
            ? `${confirmMark.photos} photograph(s) were taken for this mark. They stay with their checklist item but lose the location link.`
            : "This removes it from the drawing."
        }
      >
        <div className="form-actions">
          <Button variant="outline" onClick={() => setConfirmMark(undefined)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const a = confirmMark!.a;
              setConfirmMark(undefined);
              setSelectedId("");
              void run(() => deleteAnnotation(a), "Annotation deleted.");
            }}
          >
            Delete
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
  annotations,
  readOnly,
  run,
  onDrawing,
  onPage,
  onDelete,
}: {
  drawings: Drawing[];
  drawing: Drawing;
  page: number;
  annotations: Annotation[];
  readOnly: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
  onDrawing: (id: string) => void;
  onPage: (page: number) => void;
  onDelete: () => void;
}) {
  const count = (p: number) =>
    annotations.filter((a) => a.drawingId === drawing.id && a.page === p)
      .length;
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
                    {count(p)
                      ? ` · ${count(p)} annotation${count(p) === 1 ? "" : "s"}`
                      : ""}
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
  labels,
  mode,
  readOnly,
  selectedId,
  focusId,
  modeHint,
  onError,
  onSelect,
  onPlace,
  onShape,
  onText,
  onMove,
}: {
  drawing: Drawing;
  page: number;
  annotations: Annotation[];
  labels: ReturnType<typeof markLabels>;
  mode: Mode;
  readOnly: boolean;
  selectedId: string;
  focusId: string;
  modeHint: string;
  onError: (message: string) => void;
  onSelect: (id: string) => void;
  onPlace: (p: Point) => void;
  onShape: (kind: "rect" | "circle" | "arrow", a: Point, b: Point) => void;
  onText: (p: Point) => void;
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

  useEffect(() => {
    const a = annotations.find((x) => x.id === focusId);
    if (!a || !image || !size.h) return;
    setView((v) => {
      const px = v.x + a.x * image.width * v.scale,
        py = v.y + a.y * image.height * v.scale;
      // Sheets cover the lower part of the screen: move the mark to the top third.
      return py > size.h * 0.3
        ? { ...v, x: v.x + (size.w / 2 - px), y: v.y + (size.h * 0.22 - py) }
        : v;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);
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
    image
      ? {
          x: clamp01((p.x - view.x) / (image.width * view.scale)),
          y: clamp01((p.y - view.y) / (image.height * view.scale)),
        }
      : { x: 0, y: 0 };
  const toScreen = (x: number, y: number): Point =>
    image
      ? {
          x: view.x + x * image.width * view.scale,
          y: view.y + y * image.height * view.scale,
        }
      : { x: 0, y: 0 };
  const inside = (p: Point) =>
    !!image &&
    p.x >= view.x &&
    p.y >= view.y &&
    p.x <= view.x + image.width * view.scale &&
    p.y <= view.y + image.height * view.scale;

  const down = (e: React.PointerEvent) => {
    if (!image) return;
    box.current!.setPointerCapture(e.pointerId);
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
      return;
    }
    const id = (e.target as Element)
      .closest("[data-annotation-id]")
      ?.getAttribute("data-annotation-id");
    g.target = id ? annotations.find((a) => a.id === id) : undefined;
    g.start = p;
    g.view = view;
    g.moved = false;
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
    if (!g.start || !g.view) return;
    const dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) > TAP) g.moved = true;
    if (!g.moved) return;
    if (g.target && mode === "navigate" && !readOnly) {
      setMoving({
        id: g.target.id,
        dx: dx / (image!.width * view.scale),
        dy: dy / (image!.height * view.scale),
      });
    } else if (mode === "navigate" || mode === "marker" || mode === "text") {
      setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    } else if (inside(g.start)) setDraft({ a: toRel(g.start), b: toRel(p) });
  };
  const up = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.delete(e.pointerId);
    if (g.pinch) {
      if (g.pointers.size === 0) g.pinch = undefined;
      g.start = undefined;
      return;
    }
    const start = g.start,
      target = g.target;
    g.start = undefined;
    g.target = undefined;
    if (!start) return;
    const p = toLocal(e.clientX, e.clientY);
    if (moving && target) {
      const t = target;
      setMoving(undefined);
      const mx = moving.dx,
        my = moving.dy;
      onMove(t, {
        x: clamp01(t.x + mx),
        y: clamp01(t.y + my),
        ...(t.x2 !== undefined
          ? { x2: clamp01(t.x2 + mx), y2: clamp01((t.y2 ?? 0) + my) }
          : {}),
      });
      return;
    }
    if (draft) {
      const { a, b } = draft;
      setDraft(undefined);
      if (
        Math.hypot(a.x - b.x, a.y - b.y) > 0.01 &&
        (mode === "rect" || mode === "circle" || mode === "arrow")
      )
        onShape(mode, a, b);
      return;
    }
    if (g.moved) return;
    if (target) return onSelect(target.id);
    if (!inside(p)) return;
    if (readOnly) return onSelect("");
    if (mode === "marker") onPlace(toRel(p));
    else if (mode === "text") onText(toRel(p));
    else onSelect("");
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
      // Keyboard placement: the mark goes at the centre of the current view.
      Enter: () => {
        if (readOnly) return;
        const centre = toRel({ x: size.w / 2, y: size.h / 2 });
        if (mode === "marker") onPlace(centre);
        else if (mode === "text") onText(centre);
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
        aria-label={`${drawing.title || drawing.name}, page ${page} of ${drawing.pageCount}. ${modeHint} Keyboard: arrows pan, plus and minus zoom, 0 fits${mode === "marker" ? ", Enter places a mark at the centre" : ""}.`}
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
            {annotations
              .filter((a) => a.kind !== "marker")
              .map((raw) => {
                const a = position(raw);
                const p1 = toScreen(a.x, a.y),
                  p2 = toScreen(a.x2 ?? a.x, a.y2 ?? a.y);
                const sel = a.id === selectedId;
                const common = {
                  "data-annotation-id": a.id,
                  className: `plan-shape ${sel ? "selected" : ""}`,
                };
                if (a.kind === "text") {
                  const w = Math.min(240, (a.text?.length || 1) * 7.5 + 14);
                  return (
                    <g
                      key={a.id}
                      {...common}
                      role="button"
                      aria-label={`Text note: ${a.text}`}
                    >
                      <rect
                        x={p1.x}
                        y={p1.y - 13}
                        width={w}
                        height={26}
                        rx={4}
                        className="plan-note-box"
                      />
                      <text
                        x={p1.x + 7}
                        y={p1.y + 5}
                        className="plan-note-text"
                      >
                        {a.text}
                      </text>
                    </g>
                  );
                }
                const shape =
                  a.kind === "rect" ? (
                    <rect
                      x={Math.min(p1.x, p2.x)}
                      y={Math.min(p1.y, p2.y)}
                      width={Math.abs(p2.x - p1.x)}
                      height={Math.abs(p2.y - p1.y)}
                    />
                  ) : a.kind === "circle" ? (
                    <ellipse
                      cx={(p1.x + p2.x) / 2}
                      cy={(p1.y + p2.y) / 2}
                      rx={Math.abs(p2.x - p1.x) / 2}
                      ry={Math.abs(p2.y - p1.y) / 2}
                    />
                  ) : (
                    <>
                      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />
                      <ArrowHead from={p1} to={p2} />
                    </>
                  );
                return (
                  <g
                    key={a.id}
                    {...common}
                    role="button"
                    aria-label={
                      a.kind === "rect"
                        ? "Rectangle"
                        : a.kind === "circle"
                          ? "Circle"
                          : "Arrow"
                    }
                  >
                    <g className="halo">{shape}</g>
                    <g className="stroke">{shape}</g>
                    <g className="hit">{shape}</g>
                  </g>
                );
              })}
            {draft && (
              <DraftShape
                mode={mode}
                a={toScreen(draft.a.x, draft.a.y)}
                b={toScreen(draft.b.x, draft.b.y)}
              />
            )}
          </svg>
        )}
        {image &&
          annotations
            .filter((a) => a.kind === "marker")
            .map((raw) => {
              const a = position(raw);
              const p = toScreen(a.x, a.y);
              const l = labels.get(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  data-annotation-id={a.id}
                  className={`plan-marker ${a.id === selectedId ? "selected" : ""} ${l?.linked ? "" : "unlinked"}`}
                  style={{ left: p.x, top: p.y }}
                  aria-label={`Mark ${l?.label}: ${l?.linked ? `item ${l.itemIndex + 1}, ${l.description}` : "linked item no longer exists"}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelect(a.id);
                    }
                  }}
                >
                  <span>{l?.label}</span>
                </button>
              );
            })}
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
function ArrowHead({ from, to }: { from: Point; to: Point }) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x),
    size = 12;
  const p = (a: number) =>
    `${to.x - size * Math.cos(angle + a)},${to.y - size * Math.sin(angle + a)}`;
  return <polyline points={`${p(0.45)} ${to.x},${to.y} ${p(-0.45)}`} />;
}
function DraftShape({ mode, a, b }: { mode: Mode; a: Point; b: Point }) {
  return (
    <g className="plan-shape draft">
      <g className="stroke">
        {mode === "rect" ? (
          <rect
            x={Math.min(a.x, b.x)}
            y={Math.min(a.y, b.y)}
            width={Math.abs(b.x - a.x)}
            height={Math.abs(b.y - a.y)}
          />
        ) : mode === "circle" ? (
          <ellipse
            cx={(a.x + b.x) / 2}
            cy={(a.y + b.y) / 2}
            rx={Math.abs(b.x - a.x) / 2}
            ry={Math.abs(b.y - a.y) / 2}
          />
        ) : (
          <>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <ArrowHead from={a} to={b} />
          </>
        )}
      </g>
    </g>
  );
}

function Legend({
  rows,
  drawings,
  onSelect,
}: {
  rows: ReturnType<typeof legendRows>;
  drawings: Drawing[];
  onSelect: (row: ReturnType<typeof legendRows>[number]) => void;
}) {
  if (!rows.length)
    return (
      <p className="muted small">
        No marks yet. Choose an item, then Place mark.
      </p>
    );
  return (
    <>
      <h2 className="plans-panel-title">Legend</h2>
      <table className="plans-legend">
        <thead>
          <tr>
            <th scope="col">Mark</th>
            <th scope="col">Checklist item</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const d = drawings.findIndex((x) => x.id === row.drawingId);
            return (
              <tr
                key={row.annotationId}
                className={row.linked ? "" : "unlinked"}
              >
                <td>
                  <button
                    type="button"
                    className="legend-mark"
                    onClick={() => onSelect(row)}
                    aria-label={`Show mark ${row.label} on drawing ${d + 1}, page ${row.page}`}
                  >
                    {row.label}
                  </button>
                </td>
                <td>
                  {row.item}
                  <small>
                    Drawing {d + 1}, page {row.page}
                  </small>
                </td>
                <td>
                  <strong>{row.status}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function MarkDetails({
  annotation,
  record,
  photos,
  label,
  readOnly,
  run,
  onOpenItem,
  onDelete,
}: {
  annotation: Annotation;
  record: Inspection;
  photos: PhotoView[];
  label?: string;
  readOnly: boolean;
  run: (work: () => Promise<unknown>, success?: string) => Promise<void>;
  onOpenItem: (itemId: string) => void;
  onDelete: () => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  if (annotation.kind !== "marker")
    return (
      <div className="plans-details">
        <p>
          <strong>
            {annotation.kind === "text"
              ? "Text note"
              : annotation.kind === "rect"
                ? "Rectangle"
                : annotation.kind === "circle"
                  ? "Circle"
                  : "Arrow"}
          </strong>
          {annotation.text ? `: ${annotation.text}` : ""}
        </p>
        <p className="small muted">
          Supporting annotation; not linked to a checklist item.
        </p>
        {!readOnly && (
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            onClick={onDelete}
          >
            <Trash2 size={16} />
            Delete annotation
          </Button>
        )}
      </div>
    );
  const items = record.template.items;
  const index = items.findIndex((i) => i.id === annotation.itemId);
  const item = items[index];
  const response = item ? record.responses[item.id] : undefined;
  const sorted = orderedPhotos(photos);
  const atMark = sorted.filter((p) => p.markId === annotation.id);
  const forItem = sorted.filter(
    (p) => item && p.itemId === item.id && p.markId !== annotation.id,
  );
  const add = async (list: FileList | null) => {
    if (!list?.length || !item) return;
    const files = Array.from(list);
    setAdding(true);
    try {
      await run(async () => {
        const prepared: Photo[] = [];
        for (const [i, file] of files.entries())
          prepared.push({
            ...(await preparePhoto(file, record.id, item.id, i)),
            markId: annotation.id,
          });
        const stored = await Promise.all(prepared.map(toStoredPhoto));
        await editPlans(record.id, async () => {
          const existing = await db.photos
            .where("inspectionId")
            .equals(record.id)
            .toArray();
          if (existing.length + stored.length > MAX_PHOTOS)
            throw new Error(
              `A maximum of ${MAX_PHOTOS} photographs is supported per inspection.`,
            );
          if (!(await db.annotations.get(annotation.id)))
            throw new Error(
              "This mark was deleted before the photo was saved.",
            );
          const order = Math.max(-1, ...existing.map((p) => p.order)) + 1;
          await db.photos.bulkAdd(
            stored.map((p, i) => ({ ...p, order: order + i })),
          );
        });
      }, `Photograph saved for mark ${label}.`);
    } finally {
      setAdding(false);
      if (camera.current) camera.current.value = "";
    }
  };
  return (
    <div className="plans-details">
      <h2 className="plans-panel-title">
        <span className="plan-marker static" aria-hidden="true">
          <span>{label}</span>
        </span>
        {item
          ? `Item ${index + 1}: ${item.description}`
          : "Linked checklist item no longer exists"}
      </h2>
      {item ? (
        <dl className="plans-facts">
          <dt>Status</dt>
          <dd>
            <strong>{statusText(response?.status)}</strong>
          </dd>
          <dt>Remarks</dt>
          <dd>{response?.remarks || "No remarks recorded."}</dd>
        </dl>
      ) : (
        <p className="notice warning small">
          This mark is not attached to any item. Choose the correct item below
          or delete the mark. It is never moved to another item automatically.
        </p>
      )}
      {!readOnly && (
        <Field label="Linked checklist item">
          <select
            value={item ? item.id : ""}
            onChange={(e) =>
              void run(() =>
                updateAnnotation(annotation, { itemId: e.target.value }),
              )
            }
          >
            {!item && (
              <option value="" disabled>
                Choose an item…
              </option>
            )}
            {items.map((it, i) => (
              <option key={it.id} value={it.id}>
                {i + 1}. {it.description}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="plans-photos">
        <strong className="small">
          Photographs ({atMark.length} at this mark
          {forItem.length ? `, ${forItem.length} more for the item` : ""})
        </strong>
        <div className="plans-photo-strip">
          {[...atMark, ...forItem].map((p) => (
            <figure
              key={p.id}
              className={p.markId === annotation.id ? "at-mark" : ""}
            >
              <PhotoImage photo={p} />
              <figcaption>
                {photoNumber(sorted.indexOf(p))}
                {p.markId === annotation.id ? ` · ${label}` : ""}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
      <input
        ref={camera}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        multiple
        aria-label={`Add photographs for mark ${label}`}
        onChange={(e) => void add(e.target.files)}
      />
      <div className="row wrap plans-actions">
        {item && (
          <Button variant="outline" onClick={() => onOpenItem(item.id)}>
            Open item
          </Button>
        )}
        {item && !readOnly && (
          <Button
            className="btn-accent"
            disabled={adding}
            onClick={() => camera.current?.click()}
          >
            <Camera size={17} />
            {adding ? "Saving…" : "Add photo"}
          </Button>
        )}
        {!readOnly && (
          <Button variant="ghost" className="text-danger" onClick={onDelete}>
            <Trash2 size={16} />
            Delete mark
          </Button>
        )}
      </div>
    </div>
  );
}
