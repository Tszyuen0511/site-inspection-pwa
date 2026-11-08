import JSZip from "jszip";
import { db } from "./db";
import {
  displayNo,
  localDate,
  safeName,
  type Drawing,
  type Inspection,
  type ReportPlans,
} from "./domain";
import { generatePDF, generatePackage } from "./export";
import { fromStoredPhoto } from "./photos";
import { createBackupVolumes } from "./backup";
import type { BackupLog } from "./storage-health";
import type { IntegrityIssue } from "./integrity";

// One export of several inspections, for moving work off a phone. Each part is
// a ZIP already laid out as Project / Element / Date, holding every
// inspection's PDF report and its package (data, photos, drawings). A
// restorable backup can travel alongside as separate file(s).

/** Parts stay below this size so phones can build and share them. */
export const PART_LIMIT = 200 * 1024 * 1024;

export interface BundleFile {
  name: string;
  blob: Blob;
}
export interface BundleResult {
  files: BundleFile[];
  /** Exported inspection count (forms), excluding the backup. */
  inspections: number;
  /** Set when a backup was included; record it once the files are saved. */
  backupLog?: BackupLog;
  /** Items the backup could not include (from the backup integrity check). */
  backupExcluded: IntegrityIssue[];
}
export interface BundleDeps {
  loadPlans: (inspectionId: string) => Promise<ReportPlans | undefined>;
  loadOriginals: (
    inspectionId: string,
  ) => Promise<{ drawing: Drawing; bytes: ArrayBuffer }[]>;
  font?: string;
}

/** A readable folder name: keeps spaces, drops characters Windows refuses. */
export function folderName(value: string, fallback: string) {
  const cleaned = value
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    .slice(0, 60)
    .trim();
  return cleaned || fallback;
}

/** Project / Element / Date folder for an inspection. */
export function bundleFolder(r: Inspection) {
  return [
    folderName(r.projectName, "Project"),
    folderName(r.element, "Element"),
    r.date || "Undated",
  ].join("/");
}

/** Stored size of an inspection's photos and drawings, read from metadata. */
async function estimateBytes(inspectionId: string) {
  let bytes = 0;
  await db.photos
    .where("inspectionId")
    .equals(inspectionId)
    .each((p) => {
      bytes += (p.original?.byteLength ?? 0) + (p.compressed?.byteLength ?? 0);
    });
  for (const d of await db.drawings
    .where("inspectionId")
    .equals(inspectionId)
    .toArray())
    bytes += d.size;
  return bytes;
}

/** Groups inspections into parts below the limit; one large one stands alone. */
export function planParts<T>(
  items: { item: T; bytes: number }[],
  limit = PART_LIMIT,
) {
  const parts: T[][] = [];
  let current: T[] = [],
    size = 0;
  for (const { item, bytes } of items) {
    if (current.length && size + bytes > limit) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += bytes;
  }
  if (current.length) parts.push(current);
  return parts;
}

export async function createExportBundle(
  records: Inspection[],
  deps: BundleDeps,
  options: {
    includeBackup: boolean;
    partLimit?: number;
    onProgress?: (message: string) => void;
    now?: Date;
  },
): Promise<BundleResult> {
  if (!records.length) throw new Error("Select at least one inspection.");
  const day = localDate(options.now ?? new Date());
  const sized = [];
  for (const record of records)
    sized.push({ item: record, bytes: await estimateBytes(record.id) });
  const parts = planParts(sized, options.partLimit);
  const files: BundleFile[] = [];
  let done = 0;
  const usedPaths = new Set<string>();
  for (const [index, part] of parts.entries()) {
    const zip = new JSZip();
    for (const record of part) {
      done++;
      options.onProgress?.(
        `Preparing ${done} of ${records.length}: ${record.element}`,
      );
      const photos = (
        await db.photos.where("inspectionId").equals(record.id).toArray()
      ).map(fromStoredPhoto);
      const plans = await deps.loadPlans(record.id);
      const pdf = await generatePDF(record, photos, deps.font, plans);
      const pkg = await generatePackage(
        record,
        photos,
        deps.font,
        plans,
        await deps.loadOriginals(record.id),
        pdf,
      );
      // Two inspections of one element on one date share a folder; their
      // file names differ by number, and a repeat number gets a suffix.
      const folder = bundleFolder(record);
      let base = `${folder}/${safeName(displayNo(record))}`;
      for (let n = 2; usedPaths.has(base); n++)
        base = `${folder}/${safeName(displayNo(record))}_${n}`;
      usedPaths.add(base);
      zip.file(`${base}.pdf`, pdf);
      zip.file(`${base}_package.zip`, pkg);
    }
    // PDFs and packages are already compressed: storing them is faster and
    // keeps memory use down on phones.
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "STORE",
    });
    const suffix =
      parts.length > 1 ? `_part-${index + 1}-of-${parts.length}` : "";
    files.push({ name: `Site-Inspections_${day}${suffix}.zip`, blob });
  }
  let backupLog: BackupLog | undefined;
  let backupExcluded: IntegrityIssue[] = [];
  if (options.includeBackup) {
    options.onProgress?.("Preparing a restorable backup of all records");
    const backup = await createBackupVolumes();
    files.push(...backup.files.map((f) => ({ name: f.name, blob: f.blob })));
    backupExcluded = backup.excluded;
    backupLog = {
      at: backup.snapshotAt,
      inspectionCount: backup.inspectionCount,
      excludedIds: backup.excludedInspectionIds,
    };
  }
  return { files, inspections: records.length, backupLog, backupExcluded };
}

/** True when this browser can hand these files to the system share sheet. */
export function canShareFiles(files: BundleFile[]) {
  try {
    const list = files.map(
      (f) => new File([f.blob], f.name, { type: "application/zip" }),
    );
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      !!navigator.canShare?.({ files: list })
    );
  } catch {
    return false;
  }
}

/**
 * Opens the share sheet (phones: Save to Files, OneDrive, Drive, AirDrop...).
 * Must run straight from a tap: browsers only allow sharing on user action.
 * Returns false when the user cancelled.
 */
export async function shareFiles(files: BundleFile[], title: string) {
  try {
    await navigator.share({
      title,
      files: files.map(
        (f) => new File([f.blob], f.name, { type: "application/zip" }),
      ),
    });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return false;
    throw error;
  }
}
