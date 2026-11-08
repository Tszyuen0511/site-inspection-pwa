import { renderInspectionReport } from "./report-pdf";
import JSZip from "jszip";
import { db } from "./db";
import { orderedPhotos } from "./photos";
import {
  packageName,
  photoNumber,
  safeName,
  type Drawing,
  type Inspection,
  type Photo,
  type PhotoMeta,
  type ReportPlans,
} from "./domain";
import { markLabels } from "./plan-labels";
export function verifyPhotos(
  record: Inspection,
  photos: PhotoMeta[],
  requireOriginal = false,
) {
  for (const p of photos) {
    if (
      p.inspectionId !== record.id ||
      (p.itemId && !record.template.items.some((i) => i.id === p.itemId))
    )
      throw new Error(
        "A photo has an invalid inspection or checklist association.",
      );
    if (
      !p.compressed?.size ||
      (requireOriginal && !(p as Photo).original?.size)
    )
      throw new Error(
        `Photo ${p.name} is missing its stored image. Restore a backup or remove the missing photo.`,
      );
  }
}
export function photoMetadata(photos: Photo[]) {
  return orderedPhotos(photos).map((p, i) => ({
    id: p.id,
    inspectionId: p.inspectionId,
    itemId: p.itemId,
    caption: p.caption,
    remark: p.remark || "",
    markId: p.markId || "",
    order: i,
    number: photoNumber(i),
    name: p.name,
    mimeType: p.original.type,
    size: p.original.size,
    width: p.width,
    height: p.height,
    createdAt: p.createdAt,
    reportSection: p.reportSection || "site",
    reportGroup: p.reportGroup || "",
  }));
}
export async function generatePDF(
  record: Inspection,
  photos: PhotoMeta[],
  fontBase64?: string,
  plans?: ReportPlans,
): Promise<Blob> {
  verifyPhotos(record, photos);
  const content =
    JSON.stringify(record) +
    JSON.stringify(
      photos.map((p) => [
        p.name,
        p.caption,
        p.remark,
        p.reportGroup,
        p.reportSection,
      ]),
    ) +
    JSON.stringify([
      // Only what the report prints; the original file name is not printed.
      plans?.drawings.map((d) => [d.title, d.number, d.revision]),
      plans?.annotations.map((a) => a.text),
    ]);
  if (!fontBase64 && /[^\u0000-\u00ff]/.test(content))
    throw new Error(
      "This report contains characters outside the default Latin font. Add a compatible Unicode .ttf report font in Settings, then retry. JSON and backups preserve all text.",
    );
  return renderInspectionReport(record, photos, fontBase64, plans);
}
export async function generatePackage(
  record: Inspection,
  photos: Photo[],
  font?: string,
  plans?: ReportPlans,
  originals: { drawing: Drawing; bytes: ArrayBuffer }[] = [],
  /** A report already generated for this record, to avoid rendering it twice. */
  prebuiltPdf?: Blob,
) {
  verifyPhotos(record, photos, true);
  const pdf = prebuiltPdf ?? (await generatePDF(record, photos, font, plans));
  const zip = new JSZip();
  const folder = zip.folder(packageName(record))!;
  folder.folder("Photos");
  folder.file("Inspection_Report.pdf", pdf);
  const photoEntries = photoMetadata(photos).map((p, i) => {
    const ext =
      p.mimeType === "image/png"
        ? "png"
        : p.mimeType === "image/webp"
          ? "webp"
          : "jpg";
    return {
      ...p,
      path: `Photos/${photoNumber(i)}_${safeName(p.caption || p.name).slice(0, 48)}_${safeName(p.id)}.${ext}`,
    };
  });
  // Original drawings, unchanged, plus their metadata and annotations with the
  // checklist-aligned labels shown in the report.
  const drawingEntries = originals.map(({ drawing, bytes }, i) => {
    const ext =
      drawing.mimeType === "application/pdf"
        ? "pdf"
        : drawing.mimeType.split("/")[1].replace("jpeg", "jpg");
    const path = `Drawings/D${i + 1}_${safeName(drawing.title || drawing.name).slice(0, 48)}.${ext}`;
    folder.file(path, bytes);
    return { ...drawing, path };
  });
  const labels = markLabels(
    record.template.items,
    plans?.annotations ?? [],
    plans?.drawings ?? [],
  );
  folder.file(
    "Inspection_Data.json",
    JSON.stringify(
      {
        schemaVersion: 3,
        inspection: record,
        photos: photoEntries,
        drawings: drawingEntries,
        annotations: (plans?.annotations ?? []).map((a) => ({
          ...a,
          label: labels.get(a.id)?.label ?? "",
        })),
      },
      null,
      2,
    ),
  );
  const sorted = orderedPhotos(photos);
  photoEntries.forEach((p, i) => folder.file(p.path, sorted[i].original));
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function loadFont() {
  return (await db.meta.get("reportFont"))?.value;
}
