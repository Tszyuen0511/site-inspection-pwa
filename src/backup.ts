import JSZip from "jszip";
import { z } from "zod";
import { db, loadWorkspace, saveWorkspace } from "./db";
import {
  inspectionSchema,
  workspaceSchema,
  projectSchema,
  templateSchema,
  MAX_BACKUP_SIZE,
  type StoredPhoto,
  templates as starterTemplates,
} from "./domain";
import {
  loadReportTemplates,
  reportTemplateSchema,
  reportTemplateKey,
} from "./report-templates";
import { fromStoredPhoto } from "./photos";
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
const backupSchema = z.object({
  format: z.literal("site-inspection-backup"),
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  workspace: workspaceSchema.optional(),
  reportTemplates: z.array(reportTemplateSchema).max(200).default([]),
  exportedAt: z.string(),
  projects: z.array(projectSchema).max(10000),
  inspections: z.array(inspectionSchema).max(10000),
  templates: z.array(templateSchema).max(100),
  photos: z.array(metadataSchema).max(10000),
});
export async function createBackup(): Promise<Blob> {
  const snapshot = await db.transaction(
    "r",
    [db.projects, db.inspections, db.templates, db.photos, db.meta],
    async () => ({
      workspace: await loadWorkspace(),
      reportTemplates: await loadReportTemplates(),
      projects: await db.projects.toArray(),
      inspections: await db.inspections.toArray(),
      templates: await db.templates.toArray(),
      photos: (await db.photos.toArray()).map(fromStoredPhoto),
    }),
  );
  const zip = new JSZip();
  const metadata = snapshot.photos.map(({ original, compressed, ...p }) => {
    if (!original?.size || !compressed?.size)
      throw new Error(`Photo ${p.name} is missing its image.`);
    zip.file(`photos/${p.id}/original`, original);
    zip.file(`photos/${p.id}/report.jpg`, compressed);
    return {
      ...p,
      originalType: original.type,
      originalSize: original.size,
      compressedSize: compressed.size,
    };
  });
  zip.file(
    "backup.json",
    JSON.stringify(
      {
        format: "site-inspection-backup",
        version: 4,
        exportedAt: new Date().toISOString(),
        ...snapshot,
        photos: metadata,
      },
      null,
      2,
    ),
  );
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
}
export async function importBackup(file: Blob): Promise<number> {
  if (file.size > MAX_BACKUP_SIZE)
    throw new Error("Backup exceeds the 250 MB import limit.");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
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
  if (expanded > MAX_BACKUP_SIZE)
    throw new Error("Expanded backup exceeds the 250 MB limit.");
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
    if (!projects.has(r.projectId))
      throw new Error("Backup has an inspection with a missing project.");
    if (
      new Set(r.template.items.map((i) => i.id)).size !==
        r.template.items.length ||
      r.template.items.some((i) => !r.responses[i.id])
    )
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
  return data.inspections.length;
}
