import { renderInspectionReport } from "./report-pdf";
import JSZip from "jszip";
import { db } from "./db";
import { orderedPhotos } from "./photos";
import {
  packageName,
  photoNumber,
  safeName,
  type Inspection,
  type Photo,
} from "./domain";
export function verifyPhotos(record: Inspection, photos: Photo[]) {
  for (const p of photos) {
    if (
      p.inspectionId !== record.id ||
      (p.itemId && !record.template.items.some((i) => i.id === p.itemId))
    )
      throw new Error(
        "A photo has an invalid inspection or checklist association.",
      );
    if (!p.original?.size || !p.compressed?.size)
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
  photos: Photo[],
  fontBase64?: string,
): Promise<Blob> {
  verifyPhotos(record, photos);
  const content =
    JSON.stringify(record) + JSON.stringify(photoMetadata(photos));
  if (!fontBase64 && /[^\u0000-\u00ff]/.test(content))
    throw new Error(
      "This report contains characters outside the default Latin font. Add a compatible Unicode .ttf report font in Settings, then retry. JSON and backups preserve all text.",
    );
  return renderInspectionReport(record, photos, fontBase64);
}
export async function generatePackage(
  record: Inspection,
  photos: Photo[],
  font?: string,
) {
  const pdf = await generatePDF(record, photos, font);
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
  folder.file(
    "Inspection_Data.json",
    JSON.stringify(
      { schemaVersion: 2, inspection: record, photos: photoEntries },
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
