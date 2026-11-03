import Dexie from "dexie";
import { db } from "./db";
import {
  annotationSchema,
  drawingSchema,
  MAX_ANNOTATIONS,
  MAX_DRAWINGS,
  type Annotation,
  type Drawing,
  type HighlightColor,
} from "./domain";

/**
 * Every drawing/annotation write runs in one transaction that first checks the
 * inspection is still an editable draft, then bumps its updatedAt (so the report
 * preview and other tabs refresh). Storage failures are flagged retryable for the
 * app's shared save queue; validation errors are not.
 */
export async function editPlans<T>(
  inspectionId: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(
      "rw",
      [db.inspections, db.photos, db.drawings, db.drawingFiles, db.annotations],
      async () => {
        const stored = await db.inspections.get(inspectionId);
        if (!stored || stored.status !== "Draft")
          throw new Error(
            "This inspection is read-only. Reopen it as a revision to edit plans.",
          );
        const result = await work();
        await db.inspections.update(inspectionId, {
          updatedAt: new Date().toISOString(),
        });
        return result;
      },
    );
  } catch (error) {
    // Only storage failures can succeed on retry; validation errors cannot.
    if (error instanceof Dexie.DexieError || error instanceof DOMException)
      Object.assign(error, { retryablePhotoWrite: true });
    throw error;
  }
}

export async function addDrawing(
  inspectionId: string,
  file: { name: string; type: Drawing["mimeType"]; bytes: ArrayBuffer },
  pageCount: number,
) {
  return editPlans(inspectionId, async () => {
    const existing = await db.drawings
      .where("inspectionId")
      .equals(inspectionId)
      .toArray();
    if (existing.length >= MAX_DRAWINGS)
      throw new Error(
        `A maximum of ${MAX_DRAWINGS} drawings is supported per inspection.`,
      );
    const drawing = drawingSchema.parse({
      id: crypto.randomUUID(),
      inspectionId,
      name: file.name.slice(0, 300),
      title: "",
      number: "",
      revision: "",
      mimeType: file.type,
      size: file.bytes.byteLength,
      pageCount,
      order: Math.max(-1, ...existing.map((d) => d.order)) + 1,
      createdAt: new Date().toISOString(),
    });
    await db.drawingFiles.add({ id: drawing.id, bytes: file.bytes });
    await db.drawings.add(drawing);
    return drawing;
  });
}

export const updateDrawing = (
  drawing: Drawing,
  patch: Partial<Pick<Drawing, "title" | "number" | "revision">>,
) =>
  editPlans(drawing.inspectionId, async () => {
    drawingSchema.parse({ ...drawing, ...patch });
    await db.drawings.update(drawing.id, patch);
  });

/** Removes photo links to marks that are being deleted; photos keep their item. */
async function unlinkPhotos(inspectionId: string, markIds: string[]) {
  if (!markIds.length) return 0;
  const set = new Set(markIds);
  // Only this inspection's photographs are read, never the whole table.
  return db.photos
    .where("inspectionId")
    .equals(inspectionId)
    .filter((p) => !!p.markId && set.has(p.markId))
    .modify((p) => {
      delete p.markId;
    });
}

export const deleteDrawing = (drawing: Drawing) =>
  editPlans(drawing.inspectionId, async () => {
    const marks = await db.annotations
      .where("drawingId")
      .equals(drawing.id)
      .primaryKeys();
    await unlinkPhotos(drawing.inspectionId, marks);
    await db.annotations.bulkDelete(marks);
    await db.drawingFiles.delete(drawing.id);
    await db.drawings.delete(drawing.id);
  });

export const addAnnotation = (value: Omit<Annotation, "id" | "createdAt">) =>
  editPlans(value.inspectionId, async () => {
    const count = await db.annotations
      .where("inspectionId")
      .equals(value.inspectionId)
      .count();
    if (count >= MAX_ANNOTATIONS)
      throw new Error(
        `A maximum of ${MAX_ANNOTATIONS} plan annotations is supported.`,
      );
    if (!(await db.drawings.get(value.drawingId)))
      throw new Error("The drawing no longer exists.");
    const annotation = annotationSchema.parse({
      ...value,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
    await db.annotations.add(annotation);
    return annotation;
  });

export const updateAnnotation = (
  annotation: Annotation,
  patch: Partial<Pick<Annotation, "x" | "y" | "x2" | "y2" | "text" | "itemId">>,
) =>
  editPlans(annotation.inspectionId, async () => {
    annotationSchema.parse({ ...annotation, ...patch });
    await db.annotations.update(annotation.id, patch);
  });

export const deleteAnnotation = (annotation: Annotation) =>
  editPlans(annotation.inspectionId, async () => {
    await unlinkPhotos(annotation.inspectionId, [annotation.id]);
    await db.annotations.delete(annotation.id);
  });

/**
 * The inspected element's location region: the newest "region" annotation.
 * setLocationRegion keeps only one, so "newest" matters only for damaged data.
 */
export function locationRegion(annotations: Annotation[]) {
  return annotations
    .filter((a) => a.kind === "region")
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    )[0];
}

/** Highlighter strokes, oldest first (the order they are drawn in). */
export function highlightStrokes(annotations: Annotation[]) {
  return annotations
    .filter((a) => a.kind === "highlight" && (a.points?.length ?? 0) >= 2)
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
}

/**
 * The single drawing page that holds the element's location marking (its
 * region and/or highlighter strokes), if any. One element has one location, so
 * every marking stays on this page.
 */
export function markingPage(annotations: Annotation[]) {
  const mark =
    locationRegion(annotations) ?? highlightStrokes(annotations).at(-1);
  return mark ? { drawingId: mark.drawingId, page: mark.page } : undefined;
}

const OTHER_PAGE =
  "This element's location is already marked on another drawing page. Remove that marking first, or mark the same page.";

async function inspectionMarks(inspectionId: string) {
  return db.annotations.where("inspectionId").equals(inspectionId).toArray();
}

/** Adds one freehand highlighter stroke (drawing-relative points). */
export const addHighlight = (value: {
  inspectionId: string;
  drawingId: string;
  page: number;
  points: [number, number][];
  color: HighlightColor;
  opacity: number;
  width: number;
}) =>
  editPlans(value.inspectionId, async () => {
    const drawing = await db.drawings.get(value.drawingId);
    if (!drawing || drawing.inspectionId !== value.inspectionId)
      throw new Error("The drawing no longer exists.");
    const existing = await inspectionMarks(value.inspectionId);
    const at = markingPage(existing);
    if (at && (at.drawingId !== value.drawingId || at.page !== value.page))
      throw new Error(OTHER_PAGE);
    if (existing.length >= MAX_ANNOTATIONS)
      throw new Error(
        `A maximum of ${MAX_ANNOTATIONS} plan annotations is supported.`,
      );
    const stroke = annotationSchema.parse({
      id: crypto.randomUUID(),
      inspectionId: value.inspectionId,
      drawingId: value.drawingId,
      page: value.page,
      kind: "highlight",
      x: value.points[0][0],
      y: value.points[0][1],
      points: value.points,
      color: value.color,
      opacity: value.opacity,
      width: value.width,
      createdAt: new Date().toISOString(),
    });
    await db.annotations.add(stroke);
    return stroke;
  });

/** Removes the most recent highlighter stroke; returns it, or undefined. */
export const undoHighlight = (inspectionId: string) =>
  editPlans(inspectionId, async () => {
    const last = highlightStrokes(await inspectionMarks(inspectionId)).at(-1);
    if (last) await db.annotations.delete(last.id);
    return last;
  });

/** Removes every highlighter stroke (the region is kept). */
export const clearHighlights = (inspectionId: string) =>
  editPlans(inspectionId, async () => {
    const ids = highlightStrokes(await inspectionMarks(inspectionId)).map(
      (a) => a.id,
    );
    await db.annotations.bulkDelete(ids);
    return ids.length;
  });

/**
 * Places the element's location region, replacing any existing region in the
 * same transaction, so an inspection never has more than one. Coordinates are
 * drawing-relative (0..1), independent of zoom, pan and screen size.
 */
export const setLocationRegion = (value: {
  inspectionId: string;
  drawingId: string;
  page: number;
  a: { x: number; y: number };
  b: { x: number; y: number };
}) =>
  editPlans(value.inspectionId, async () => {
    const drawing = await db.drawings.get(value.drawingId);
    if (!drawing || drawing.inspectionId !== value.inspectionId)
      throw new Error("The drawing no longer exists.");
    // A replacement region may move pages, but not away from highlighter strokes.
    const strokes = highlightStrokes(await inspectionMarks(value.inspectionId));
    if (
      strokes.some(
        (s) => s.drawingId !== value.drawingId || s.page !== value.page,
      )
    )
      throw new Error(OTHER_PAGE);
    const region = annotationSchema.parse({
      id: crypto.randomUUID(),
      inspectionId: value.inspectionId,
      drawingId: value.drawingId,
      page: value.page,
      kind: "region",
      x: Math.min(value.a.x, value.b.x),
      y: Math.min(value.a.y, value.b.y),
      x2: Math.max(value.a.x, value.b.x),
      y2: Math.max(value.a.y, value.b.y),
      createdAt: new Date().toISOString(),
    });
    await db.annotations
      .where("inspectionId")
      .equals(value.inspectionId)
      .filter((a) => a.kind === "region")
      .delete();
    await db.annotations.add(region);
    return region;
  });

/**
 * Pages printed in the report: the page holding the location marking (region
 * and/or highlighter strokes), or page 1 of each drawing when nothing has been
 * marked. Marks from earlier versions no longer select pages.
 */
export function reportPages(drawings: Drawing[], annotations: Annotation[]) {
  const sorted = [...drawings].sort(
    (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
  );
  const at = markingPage(annotations);
  const holder = at && sorted.find((d) => d.id === at.drawingId);
  if (holder)
    return [{ drawing: holder, page: Math.min(at.page, holder.pageCount) }];
  return sorted.map((d) => ({ drawing: d, page: 1 }));
}
