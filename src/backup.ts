import JSZip from "jszip";
import { z } from "zod";
import { db, saveWorkspace } from "./db";
import {
  inspectionSchema,
  workspaceSchema,
  projectSchema,
  templateSchema,
  MAX_BACKUP_SIZE,
  type Inspection,
  type StoredPhoto,
  templates as starterTemplates,
} from "./domain";
import { reportTemplateSchema, reportTemplateKey } from "./report-templates";
import { fromStoredPhoto } from "./photos";
import { describeZod, scanStoredData, type IntegrityIssue } from "./integrity";
const metadataSchema = z.object({
  id: z.string().uuid(),
  inspectionId: z.string(),
  itemId: z.string(),
  caption: z.string(),
  order: z.number().int().min(0),
  name: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  createdAt: z.string(),
  reportSection: z.enum(["site", "core", "plan"]).optional(),
  reportGroup: z.string().max(500).optional(),
  originalType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  originalSize: z
    .number()
    .positive()
    .max(20 * 1024 * 1024),
  compressedSize: z
    .number()
    .positive()
    .max(20 * 1024 * 1024),
});
const volumeSchema = z.object({
  id: z.string().min(1).max(100),
  index: z.number().int().min(1),
  total: z.number().int().min(1),
});
export type BackupVolume = z.infer<typeof volumeSchema>;
const backupSchema = z.object({
  format: z.literal("site-inspection-backup"),
  volume: volumeSchema.optional(),
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  workspace: workspaceSchema.optional(),
  reportTemplates: z.array(reportTemplateSchema).max(200).default([]),
  exportedAt: z.string(),
  projects: z.array(projectSchema).max(10000),
  inspections: z.array(inspectionSchema).max(10000),
  templates: z.array(templateSchema).max(100),
  photos: z.array(metadataSchema).max(10000),
});
type BackupData = z.infer<typeof backupSchema>;
export class BackupTooLargeError extends Error {}
export interface ParsedBackup {
  data: BackupData;
  photos: StoredPhoto[];
}
const utf8Size = (text: string) => new Blob([text]).size;
const SLACK = (max: number) => Math.min(1024 * 1024, Math.floor(max * 0.05));
function relationIssue(
  r: BackupData["inspections"][number],
  projects: Set<string>,
) {
  if (!projects.has(r.projectId)) return "its project is missing";
  if (
    new Set(r.template.items.map((i) => i.id)).size !==
      r.template.items.length ||
    r.template.items.some((i) => !r.responses[i.id])
  )
    return "checklist items are missing or duplicated";
}
/** Reads and fully validates a backup without touching the database. */
export async function readBackup(
  file: Blob,
  maxBytes = MAX_BACKUP_SIZE,
): Promise<ParsedBackup> {
  if (file.size > maxBytes)
    throw new BackupTooLargeError(
      `Backup exceeds the ${Math.round(maxBytes / 1048576)} MB import limit.`,
    );
  const zip = await JSZip.loadAsync(await file.arrayBuffer(), {
    checkCRC32: true,
  });
  let expanded = 0;
  for (const entry of Object.values(zip.files)) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })
      ._data?.uncompressedSize;
    if (!entry.dir) {
      if (typeof size !== "number")
        throw new Error("Unable to verify archive sizes.");
      expanded += size;
    }
  }
  if (expanded > maxBytes)
    throw new BackupTooLargeError(
      `Expanded backup exceeds the ${Math.round(maxBytes / 1048576)} MB limit.`,
    );
  const manifest = zip.file("backup.json");
  if (!manifest)
    throw new Error(
      "This is not a Site Inspection backup. Use a backup ZIP from Settings.",
    );
  const data = backupSchema.parse(JSON.parse(await manifest.async("string")));
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (
    !unique(data.inspections.map((r) => r.id)) ||
    !unique(data.projects.map((p) => p.id)) ||
    !unique(data.photos.map((p) => p.id)) ||
    !unique(data.templates.map((t) => t.id)) ||
    !unique(data.reportTemplates.map((t) => t.id))
  )
    throw new Error("Backup contains duplicate IDs.");
  const projects = new Set(data.projects.map((p) => p.id));
  if (
    data.workspace?.defaultProjectId &&
    !projects.has(data.workspace.defaultProjectId)
  )
    throw new Error("Backup default project is missing.");
  const records = new Map(data.inspections.map((r) => [r.id, r]));
  for (const r of data.inspections) {
    const issue = relationIssue(r, projects);
    if (issue === "its project is missing")
      throw new Error("Backup has an inspection with a missing project.");
    if (issue)
      throw new Error("Backup has missing or duplicate checklist items.");
  }
  const photos: StoredPhoto[] = [];
  for (const p of data.photos) {
    const r = records.get(p.inspectionId);
    if (!r || (p.itemId && !r.template.items.some((i) => i.id === p.itemId)))
      throw new Error("Backup photo association is invalid.");
    const original = zip.file(`photos/${p.id}/original`),
      compressed = zip.file(`photos/${p.id}/report.jpg`);
    if (!original || !compressed)
      throw new Error(`Backup photo ${p.name} is missing.`);
    const raw = await original.async("uint8array"),
      jpg = await compressed.async("uint8array");
    if (raw.length !== p.originalSize || jpg.length !== p.compressedSize)
      throw new Error("Photo size does not match backup metadata.");
    const { originalType, originalSize, compressedSize, ...meta } = p;
    photos.push({
      ...meta,
      original: raw.buffer.slice(
        raw.byteOffset,
        raw.byteOffset + raw.byteLength,
      ) as ArrayBuffer,
      compressed: jpg.buffer.slice(
        jpg.byteOffset,
        jpg.byteOffset + jpg.byteLength,
      ) as ArrayBuffer,
      originalType,
    });
  }
  return { data, photos };
}

export interface BackupFile {
  name: string;
  blob: Blob;
  inspections: number;
  photos: number;
}
export interface BackupResult {
  files: BackupFile[];
  /** Stored items left out of the backup (invalid, oversized or incomplete). */
  excluded: IntegrityIssue[];
  /** Inspections whose backup is incomplete; they must not count as backed up. */
  excludedInspectionIds: string[];
  snapshotAt: string;
  inspectionCount: number;
}
const isBuffer = (v: unknown): v is ArrayBuffer =>
  Object.prototype.toString.call(v) === "[object ArrayBuffer]";
const usable = (row: StoredPhoto) =>
  isBuffer(row.original) &&
  isBuffer(row.compressed) &&
  row.original.byteLength > 0 &&
  row.compressed.byteLength > 0;
function sameBytes(a: unknown, b: unknown) {
  if (!isBuffer(a) || !isBuffer(b) || a.byteLength !== b.byteLength)
    return false;
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
// Exact size of a value as written inside backup.json (pretty-printed, nested two
// levels deep, so every line carries four extra indent bytes).
const nested = (value: unknown) => {
  const text = JSON.stringify(value, null, 2);
  return utf8Size(text) + text.split("\n").length * 4 + 8;
};
class VolumeTooLarge extends Error {}
// Limits enforced by backupSchema; a volume must respect them as well as bytes.
const MAX_ROWS = { inspections: 10000, photos: 10000, templates: 100 };
const RESERVE_STEPS = [0, 0.02, 0.05, 0.1];

/**
 * Builds one or more self-contained backup files, each at most `maxBytes` when
 * expanded, and proves every file restorable by running the real import
 * validation on it (CRC, schema, relations, photo sizes) and comparing every
 * photo byte-for-byte with the stored original before returning.
 *
 * Nothing is silently dropped: anything that cannot be included is returned in
 * `excluded`, and the caller must show it. Stored data is never modified.
 */
export async function createBackupVolumes(
  options: { maxBytes?: number; slack?: number } = {},
): Promise<BackupResult> {
  const maxBytes = options.maxBytes ?? MAX_BACKUP_SIZE;
  const slack = options.slack ?? SLACK(maxBytes);
  const snapshotAt = new Date().toISOString();
  const scan = await scanStoredData();
  const baseExcluded: IntegrityIssue[] = [...scan.issues];
  const baseIds = new Set<string>();
  for (const i of scan.issues)
    if (i.kind === "inspection" || i.kind === "photo") baseIds.add(i.id);
  const projects = scan.projects;
  const projectIds = new Set(projects.map((p) => p.id));
  const workspace = { ...scan.workspace };
  if (
    workspace.defaultProjectId &&
    !projectIds.has(workspace.defaultProjectId)
  ) {
    delete workspace.defaultProjectId;
    baseExcluded.push({
      kind: "workspace",
      id: "workspace",
      message: "Default project is missing; the default was omitted.",
    });
  }
  const keep = <T extends { id: string }>(
    rows: T[],
    max: number,
    kind: IntegrityIssue["kind"],
  ) => {
    for (const r of rows.slice(max))
      baseExcluded.push({
        kind,
        id: r.id,
        message: `Not backed up: a backup file holds at most ${max} of these.`,
      });
    return rows.slice(0, max);
  };
  const shared = {
    format: "site-inspection-backup" as const,
    version: 4 as const,
    workspace,
    reportTemplates: keep(scan.reportTemplates, 200, "report-template"),
    projects,
    templates: keep(scan.templates, MAX_ROWS.templates, "template"),
  };
  const overhead = nested(shared) + 4096 + slack;

  // Sizing pass: one inspection (with its photographs) at a time.
  type Sized = { record: Inspection; bytes: number; photos: number };
  const sized: Sized[] = [];
  for (const record of scan.inspections) {
    const issue = relationIssue(record, projectIds);
    if (issue) {
      baseExcluded.push({
        kind: "inspection",
        id: record.id,
        message: `Not backed up: ${issue}.`,
      });
      baseIds.add(record.id);
      continue;
    }
    const rows = await db.photos
      .where("inspectionId")
      .equals(record.id)
      .toArray();
    let bytes = nested(record) + 64,
      photos = 0;
    for (const row of rows) {
      if (!usable(row)) continue; // reported in the build pass
      const { original, compressed, ...meta } = row;
      bytes +=
        original.byteLength +
        compressed.byteLength +
        nested({
          ...meta,
          originalSize: original.byteLength,
          compressedSize: compressed.byteLength,
        }) +
        256;
      photos++;
    }
    sized.push({ record, bytes, photos });
  }

  const volumeId = crypto.randomUUID();
  const stamp = `${snapshotAt.slice(0, 10)}_${Date.parse(snapshotAt)}`;
  const build = async (reserve: number): Promise<BackupResult> => {
    const excluded = [...baseExcluded];
    const excludedIds = new Set(baseIds);
    const budget = maxBytes - overhead - Math.floor(maxBytes * reserve);
    const fit: Sized[] = [];
    for (const item of sized) {
      if (item.bytes > budget) {
        excluded.push({
          kind: "inspection",
          id: item.record.id,
          message: `Not backed up: record and photographs total ${(item.bytes / 1048576).toFixed(1)} MB, more than fits in one restorable backup file (${Math.round(maxBytes / 1048576)} MB). Use Download recovery data to keep a full copy.`,
        });
        excludedIds.add(item.record.id);
      } else fit.push(item);
    }
    const volumes: Sized[][] = [[]];
    let used = 0,
      photoCount = 0;
    for (const item of fit) {
      const current = volumes.at(-1)!;
      if (
        current.length &&
        (used + item.bytes > budget ||
          current.length >= MAX_ROWS.inspections ||
          photoCount + item.photos > MAX_ROWS.photos)
      ) {
        volumes.push([]);
        used = 0;
        photoCount = 0;
      }
      volumes.at(-1)!.push(item);
      used += item.bytes;
      photoCount += item.photos;
    }
    const files: BackupFile[] = [];
    for (const [n, volume] of volumes.entries()) {
      const zip = new JSZip();
      const metadata: BackupData["photos"] = [];
      const ids = new Set(volume.map((v) => v.record.id));
      for (const { record } of volume) {
        const rows = await db.photos
          .where("inspectionId")
          .equals(record.id)
          .toArray();
        for (const row of rows) {
          const reject = (why: string) => {
            excluded.push({
              kind: "photo",
              id: row.id,
              message: `Photograph "${row?.name}" not backed up: ${why}.`,
            });
            excludedIds.add(record.id);
          };
          if (!usable(row)) {
            reject("its image data is missing or damaged");
            continue;
          }
          const { original, compressed, ...p } = fromStoredPhoto(row);
          const check = metadataSchema.safeParse({
            ...p,
            originalType: original.type,
            originalSize: original.size,
            compressedSize: compressed.size,
          });
          if (!check.success) {
            reject(describeZod(check.error));
            continue;
          }
          if (
            row.itemId &&
            !record.template.items.some((i) => i.id === row.itemId)
          ) {
            reject("its checklist item no longer exists");
            continue;
          }
          zip.file(`photos/${row.id}/original`, original);
          zip.file(`photos/${row.id}/report.jpg`, compressed);
          metadata.push(check.data);
        }
      }
      const document: Record<string, unknown> = {
        ...shared,
        exportedAt: snapshotAt,
        inspections: volume.map((v) => v.record),
        photos: metadata,
      };
      if (volumes.length > 1)
        document.volume = { id: volumeId, index: n + 1, total: volumes.length };
      zip.file("backup.json", JSON.stringify(document, null, 2));
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 3 },
      });
      // Prove restorability with the real import validation, then compare photos.
      let parsed: ParsedBackup;
      try {
        parsed = await readBackup(blob, maxBytes);
      } catch (error) {
        if (error instanceof BackupTooLargeError) throw new VolumeTooLarge();
        throw new Error(
          `Backup verification failed, so no backup was produced: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const got = new Set(parsed.data.inspections.map((r) => r.id));
      if (got.size !== ids.size || [...ids].some((id) => !got.has(id)))
        throw new Error(
          "Backup verification failed: the file does not contain the expected inspections.",
        );
      if (parsed.photos.length !== metadata.length)
        throw new Error(
          "Backup verification failed: the file does not contain the expected photographs.",
        );
      for (const photo of parsed.photos) {
        const fresh = await db.photos.get(photo.id);
        if (
          !fresh ||
          !sameBytes(photo.original, fresh.original) ||
          !sameBytes(photo.compressed, fresh.compressed)
        )
          throw new Error(
            `Backup verification failed: photograph ${photo.name} did not match its stored image. The inspection may have been edited during export; try again.`,
          );
      }
      files.push({
        name: `Site_Inspection_Backup_${stamp}${volumes.length > 1 ? `_part-${n + 1}-of-${volumes.length}` : ""}.zip`,
        blob,
        inspections: volume.length,
        photos: metadata.length,
      });
    }
    return {
      files,
      excluded,
      excludedInspectionIds: [...excludedIds],
      snapshotAt,
      inspectionCount: fit.length,
    };
  };
  // If the size estimate was too low, verification (not the estimate) decides:
  // repack with a larger safety reserve rather than emit an unrestorable file.
  for (const reserve of RESERVE_STEPS)
    try {
      return await build(reserve);
    } catch (error) {
      if (!(error instanceof VolumeTooLarge)) throw error;
    }
  throw new Error(
    "Backup verification failed: a backup file exceeded the size limit even with extra margin, so no backup was produced. Use Download recovery data.",
  );
}
/** Single-file convenience wrapper. Throws if the data needs more than one file. */
export async function createBackup(): Promise<Blob> {
  const result = await createBackupVolumes();
  if (result.files.length !== 1)
    throw new BackupTooLargeError(
      "This data needs several backup files; use the Settings export.",
    );
  return result.files[0].blob;
}
export async function importBackup(
  file: Blob,
  maxBytes = MAX_BACKUP_SIZE,
): Promise<number> {
  return (await importBackupDetailed(file, maxBytes)).inspections;
}
export async function importBackupDetailed(
  file: Blob,
  maxBytes = MAX_BACKUP_SIZE,
): Promise<{ inspections: number; volume?: BackupVolume }> {
  const { data, photos } = await readBackup(file, maxBytes);
  // Only unchanged fictional starter records may be replaced. User work is never overwritten.
  await db.transaction(
    "rw",
    [db.projects, db.inspections, db.photos, db.templates, db.meta],
    async () => {
      const seedRecords = JSON.parse(
        (await db.meta.get("seedRecords"))?.value || "{}",
      ) as Record<string, string>;
      const seedProjects = JSON.parse(
        (await db.meta.get("seedProjects"))?.value || "{}",
      ) as Record<string, string>;
      for (const r of data.inspections) {
        const existing = await db.inspections.get(r.id);
        if (
          existing &&
          (seedRecords[r.id] !== JSON.stringify(existing) ||
            (await db.photos.where("inspectionId").equals(r.id).count()))
        )
          throw new Error(
            `Inspection ${r.id} already exists. No records were imported; existing work has been preserved.`,
          );
      }
      for (const p of data.projects) {
        const existing = await db.projects.get(p.id);
        if (
          existing &&
          JSON.stringify(existing) !== JSON.stringify(p) &&
          seedProjects[p.id] !== JSON.stringify(existing)
        )
          throw new Error(
            "A project ID conflicts with local data. No records were imported.",
          );
        await db.projects.put(p);
      }
      for (const t of data.templates) {
        const existing = await db.templates.get(t.id);
        const starter = starterTemplates.find((s) => s.id === t.id);
        if (
          existing &&
          JSON.stringify(existing) !== JSON.stringify(t) &&
          JSON.stringify(existing) !== JSON.stringify(starter)
        )
          throw new Error(
            "A template ID conflicts with a locally configured version. No records were imported.",
          );
        await db.templates.put(t);
      }
      const templateKeys = await db.meta
        .where("key")
        .startsWith("report-template:")
        .primaryKeys();
      if (
        new Set([
          ...templateKeys,
          ...data.reportTemplates.map((t) => reportTemplateKey(t.id)),
        ]).size > 200
      )
        throw new Error(
          "Import would exceed the 200 report template limit. No data was imported.",
        );
      for (const template of data.reportTemplates) {
        const key = reportTemplateKey(template.id);
        const existing = await db.meta.get(key);
        if (
          existing &&
          JSON.stringify(
            reportTemplateSchema.parse(JSON.parse(existing.value)),
          ) !== JSON.stringify(template)
        )
          throw new Error(
            "A report template ID conflicts with a local template. No data was imported.",
          );
        await db.meta.put({ key, value: JSON.stringify(template) });
      }
      await db.inspections.bulkPut(data.inspections);
      await db.photos.bulkAdd(photos);
      if (data.workspace && !(await db.meta.get("workspace")))
        await saveWorkspace(data.workspace);
      await db.meta.delete("seedRecords");
      await db.meta.delete("seedProjects");
      await db.meta.put({ key: "initialized", value: "1" });
    },
  );
  return { inspections: data.inspections.length, volume: data.volume };
}
