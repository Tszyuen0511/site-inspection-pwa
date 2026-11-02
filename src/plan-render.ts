// Browser-only rendering of drawings (images and PDF pages) for the plan viewer
// and the PDF report. Everything is local: pdf.js and its worker are bundled.
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerURL from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { db } from "./db";
import {
  DRAWING_TYPES,
  MAX_DRAWING_PAGES,
  MAX_DRAWING_SIZE,
  type Drawing,
  type PlanPageImage,
  type ReportPlans,
} from "./domain";
import { reportPages } from "./drawings";
import { headerSize } from "./image-header";
GlobalWorkerOptions.workerSrc = workerURL;

const MAX_IMAGE_PIXELS = 80_000_000;
/** Longest side, in pixels, of the drawing image shown in the viewer. */
export const VIEW_RESOLUTION = 3000;
/** Longest side, in pixels, used for report pages (about 200 dpi on A4). */
export const REPORT_RESOLUTION = 2400;

const sniff = (b: Uint8Array): Drawing["mimeType"] | undefined => {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
};
const openPdf = (bytes: ArrayBuffer) =>
  // pdf.js may detach the buffer it is given, so it always gets a copy.
  getDocument({ data: new Uint8Array(bytes.slice(0)), useSystemFonts: true });

/** Validates type, size and that the file actually decodes. Nothing is stored. */
export async function readDrawingFile(file: File) {
  if (!file.size) throw new Error(`${file.name}: the file is empty.`);
  if (file.size > MAX_DRAWING_SIZE)
    throw new Error(
      `${file.name}: drawings are limited to ${MAX_DRAWING_SIZE / 1048576} MB.`,
    );
  const bytes = await file.arrayBuffer();
  const type = sniff(new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength)));
  if (!type || !(DRAWING_TYPES as readonly string[]).includes(type))
    throw new Error(
      `${file.name}: choose a PDF, JPEG, PNG or WebP drawing. Other formats (DWG, HEIC, TIFF) are not supported.`,
    );
  let pageCount = 1;
  const tooBig = () =>
    new Error(`${file.name}: images are limited to 80 megapixels.`);
  if (type !== "application/pdf") {
    const size = headerSize(new Uint8Array(bytes), type);
    if (size && size.w * size.h > MAX_IMAGE_PIXELS) throw tooBig();
  }
  try {
    if (type === "application/pdf") {
      const task = openPdf(bytes);
      try {
        const doc = await task.promise;
        pageCount = doc.numPages;
        if (pageCount > MAX_DRAWING_PAGES)
          throw new RangeError(
            `${file.name}: PDFs are limited to ${MAX_DRAWING_PAGES} pages. Extract the sheets you need first.`,
          );
        await doc.getPage(1);
      } finally {
        // Validation only: the document is always closed again.
        void task.destroy();
      }
    } else {
      const bitmap = await createImageBitmap(new Blob([bytes], { type }));
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (pixels > MAX_IMAGE_PIXELS)
        throw new RangeError(
          `${file.name}: images are limited to 80 megapixels.`,
        );
    }
  } catch (error) {
    if (error instanceof RangeError) throw new Error(error.message);
    throw new Error(
      `${file.name}: the drawing could not be opened. It may be damaged or password-protected.`,
    );
  }
  return { name: file.name, type, bytes, pageCount };
}

const docs = new Map<
  string,
  { promise: Promise<PDFDocumentProxy>; destroy: () => void }
>();
async function fileBytes(id: string) {
  const file = await db.drawingFiles.get(id);
  if (!file) throw new Error("The drawing file is missing from this device.");
  return file.bytes;
}
/** Renders one page to an image, preserving the page's aspect ratio. */
export async function renderPage(
  drawing: Drawing,
  page: number,
  maxSide: number,
  quality = 0.9,
) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx)
    throw new Error("Drawing rendering is unavailable in this browser.");
  if (drawing.mimeType === "application/pdf") {
    if (!docs.has(drawing.id)) {
      let task: ReturnType<typeof openPdf> | undefined;
      const promise = fileBytes(drawing.id).then(
        (b) => (task = openPdf(b)).promise,
      );
      // A failed open is not cached; the next attempt tries again.
      promise.catch(() => docs.delete(drawing.id));
      docs.set(drawing.id, { promise, destroy: () => void task?.destroy() });
    }
    const pdf = await docs.get(drawing.id)!.promise;
    const p = await pdf.getPage(Math.min(page, pdf.numPages));
    const natural = p.getViewport({ scale: 1 });
    const viewport = p.getViewport({
      scale: maxSide / Math.max(natural.width, natural.height),
    });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await p.render({ canvas, viewport, background: "#ffffff" }).promise;
  } else {
    const bitmap = await createImageBitmap(
      new Blob([await fileBytes(drawing.id)], { type: drawing.mimeType }),
    );
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error("The drawing could not be rendered.")),
      "image/jpeg",
      quality,
    ),
  );
  return { blob, width: canvas.width, height: canvas.height };
}

const views = new Map<
  string,
  Promise<{ url: string; width: number; height: number }>
>();
/** Cached viewer image for a drawing page (original bytes never change). */
export function pageImage(drawing: Drawing, page: number) {
  const key = `${drawing.id}:${page}`;
  if (!views.has(key)) {
    const job = renderPage(drawing, page, VIEW_RESOLUTION).then((r) => ({
      url: URL.createObjectURL(r.blob),
      width: r.width,
      height: r.height,
    }));
    job.catch(() => views.delete(key));
    views.set(key, job);
  }
  return views.get(key)!;
}
/** Releases cached renders of a deleted drawing. */
export function forgetDrawing(id: string) {
  for (const [key, job] of views)
    if (key.startsWith(id + ":")) {
      void job.then((v) => URL.revokeObjectURL(v.url)).catch(() => {});
      views.delete(key);
    }
  docs.get(id)?.destroy();
  docs.delete(id);
  for (const key of reportCache.keys())
    if (key.startsWith(id + ":")) reportCache.delete(key);
}

const reportCache = new Map<string, Promise<PlanPageImage>>();
/** Loads and renders every plan page the report includes, for one inspection. */
export async function loadReportPlans(
  inspectionId: string,
): Promise<ReportPlans | undefined> {
  const [drawings, annotations] = await Promise.all([
    db.drawings.where("inspectionId").equals(inspectionId).toArray(),
    db.annotations.where("inspectionId").equals(inspectionId).toArray(),
  ]);
  if (!drawings.length) return undefined;
  const pages = await Promise.all(
    reportPages(drawings, annotations).map(({ drawing, page }) => {
      const key = `${drawing.id}:${page}`;
      if (!reportCache.has(key)) {
        const job = renderPage(drawing, page, REPORT_RESOLUTION, 0.88).then(
          async (r) => ({
            drawing,
            page,
            jpeg: new Uint8Array(await r.blob.arrayBuffer()),
            width: r.width,
            height: r.height,
          }),
        );
        job.catch(() => reportCache.delete(key));
        reportCache.set(key, job);
      }
      // Metadata (title, number, revision) may have changed since rendering.
      return reportCache.get(key)!.then((p) => ({ ...p, drawing }));
    }),
  );
  return { drawings, annotations, pages };
}
/** Original drawing files for the inspection ZIP package. */
export async function loadDrawingOriginals(inspectionId: string) {
  const drawings = await db.drawings
    .where("inspectionId")
    .equals(inspectionId)
    .sortBy("order");
  return Promise.all(
    drawings.map(async (drawing) => ({
      drawing,
      bytes: await fileBytes(drawing.id),
    })),
  );
}
