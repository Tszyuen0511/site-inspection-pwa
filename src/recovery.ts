import JSZip from "jszip";
import { db } from "./db";
import { localDate } from "./domain";
import { scanStoredData, type IntegrityIssue } from "./integrity";

const README = `Site Inspection - raw recovery data
====================================
This archive is an UNVALIDATED copy of everything stored on the device,
including records that failed validation. Nothing was repaired, skipped or
deleted. It is for recovery and support; it cannot be imported with
"Import backup". Keep it safe and do not edit it.

raw/*.json        every stored row of each table (settings, templates, backup
                  log and any quarantined copies are in raw/meta.json)
photos/<id>/      original image and report image for each photograph
photos/index.json photograph metadata (without image data)
drawings/<id>/    original drawing files (metadata is in raw/drawings.json)
manifest.json     counts, read errors and validation issues found
`;
/**
 * Raw, tolerant export used when validation fails. It reads row by row, never
 * throws for a damaged row, and records every read error in the manifest.
 */
export async function createRecoveryDump(): Promise<Blob> {
  const zip = new JSZip();
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  let issues: IntegrityIssue[] = [];
  try {
    issues = (await scanStoredData()).issues;
  } catch (error) {
    errors.push(`validation scan failed: ${String(error)}`);
  }
  for (const name of [
    "projects",
    "inspections",
    "templates",
    "meta",
    "drawings",
    "annotations",
  ] as const)
    try {
      const rows = await db.table(name).toArray();
      counts[name] = rows.length;
      zip.file(`raw/${name}.json`, JSON.stringify(rows, null, 2));
    } catch (error) {
      errors.push(`${name}: ${String(error)}`);
    }
  const index: unknown[] = [];
  try {
    await db.photos.each((row) => {
      try {
        const { original, compressed, ...meta } = row as unknown as Record<
          string,
          unknown
        >;
        index.push(meta);
        const id = String(meta.id);
        if (original instanceof ArrayBuffer || original instanceof Blob)
          zip.file(`photos/${id}/original`, original);
        if (compressed instanceof ArrayBuffer || compressed instanceof Blob)
          zip.file(`photos/${id}/report.jpg`, compressed);
      } catch (error) {
        errors.push(`photo row: ${String(error)}`);
      }
    });
  } catch (error) {
    errors.push(`photos: ${String(error)}`);
  }
  counts.photos = index.length;
  try {
    let n = 0;
    await db.drawingFiles.each((row) => {
      try {
        zip.file(`drawings/${String(row.id)}/original`, row.bytes);
        n++;
      } catch (error) {
        errors.push(`drawing file: ${String(error)}`);
      }
    });
    counts.drawingFiles = n;
  } catch (error) {
    errors.push(`drawing files: ${String(error)}`);
  }
  zip.file("photos/index.json", JSON.stringify(index, null, 2));
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        format: "site-inspection-recovery",
        createdAt: new Date().toISOString(),
        counts,
        issues,
        errors,
      },
      null,
      2,
    ),
  );
  zip.file("README.txt", README);
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
}
export const recoveryFileName = () =>
  `Site_Inspection_Recovery_${localDate()}_${Date.now()}.zip`;
