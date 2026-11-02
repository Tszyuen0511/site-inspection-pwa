import Dexie from "dexie";
import { db } from "./db";
import {
  annotationSchema,
  drawingSchema,
  MAX_ANNOTATIONS,
  MAX_DRAWINGS,
  type Annotation,
  type Drawing,
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

/** Pages printed in the report: every annotated page; page 1 of an unmarked drawing. */
export function reportPages(drawings: Drawing[], annotations: Annotation[]) {
  return [...drawings]
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
    .flatMap((d) => {
      const pages = [
        ...new Set(
          annotations.filter((a) => a.drawingId === d.id).map((a) => a.page),
        ),
      ].sort((a, b) => a - b);
      return (pages.length ? pages : [1]).map((page) => ({ drawing: d, page }));
    });
}
