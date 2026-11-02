import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { db, loadWorkspace, saveWorkspace } from "./db";
import { newInspection, templates, type Inspection } from "./domain";
import { toStoredPhoto } from "./photos";
import {
  BackupTooLargeError,
  createBackup,
  createBackupVolumes,
  importBackup,
  importBackupDetailed,
  readBackup,
} from "./backup";
import { scanStoredData } from "./integrity";
import { createRecoveryDump } from "./recovery";
import {
  loadReportTemplates,
  reportTemplateKey,
  reportTemplateSchema,
  storeReportTemplate,
} from "./report-templates";
import {
  backupStatus,
  suspectedStorageLoss,
  type BackupLog,
} from "./storage-health";
import { details } from "./test-fixtures";

const KB = 1024;
// Deterministic, effectively incompressible bytes (like real JPEG data).
function noise(size: number, seed: number) {
  const out = new Uint8Array(size);
  let x = seed * 2654435761 + 1;
  for (let i = 0; i < size; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  out[0] = 0xff;
  out[1] = 0xd8;
  out[2] = 0xff;
  return out;
}
async function addInspection(
  element: string,
  photoSizes: number[],
  seed: number,
): Promise<{ record: Inspection; bytes: Map<string, Uint8Array[]> }> {
  const record = newInspection({ ...details, element }, templates[0]);
  await db.inspections.add(record);
  const bytes = new Map<string, Uint8Array[]>();
  for (const [i, size] of photoSizes.entries()) {
    const original = noise(size, seed * 100 + i),
      compressed = noise(Math.max(64, size >> 3), seed * 100 + i + 50);
    const id = crypto.randomUUID();
    bytes.set(id, [original, compressed]);
    await db.photos.add(
      await toStoredPhoto({
        id,
        inspectionId: record.id,
        itemId: i % 2 ? "toe-level" : "",
        caption: `caption ${i}`,
        order: i,
        name: `p${i}.jpg`,
        original: new Blob([original.slice()], { type: "image/jpeg" }),
        compressed: new Blob([compressed.slice()], { type: "image/jpeg" }),
        width: 100,
        height: 50,
        createdAt: record.createdAt,
      }),
    );
  }
  return { record, bytes };
}
const wipe = async () =>
  db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
const seedProject = async () => {
  await db.projects.add({
    id: details.projectId,
    name: details.projectName,
    reference: details.projectReference,
    fictional: false,
  });
  await db.templates.bulkAdd(templates);
};
const expanded = async (blob: Blob) => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  let n = 0;
  for (const f of Object.values(zip.files))
    if (!f.dir) n += (await f.async("uint8array")).length;
  return n;
};
beforeEach(async () => {
  await wipe();
  await seedProject();
});

describe("backup export is proven restorable", () => {
  it("splits an oversized dataset into volumes that each fit the limit and restore byte-for-byte", async () => {
    const limit = 320 * KB;
    const sources = [] as Awaited<ReturnType<typeof addInspection>>[];
    for (let n = 0; n < 6; n++)
      sources.push(await addInspection(`E-${n}`, [60 * KB, 40 * KB], n + 1));
    const before = await db.photos.toArray();
    const result = await createBackupVolumes({ maxBytes: limit });
    expect(result.excluded).toEqual([]);
    expect(result.files.length).toBeGreaterThan(1);
    expect(result.files.reduce((a, f) => a + f.inspections, 0)).toBe(6);
    for (const f of result.files) {
      expect(f.blob.size).toBeLessThanOrEqual(limit);
      expect(await expanded(f.blob)).toBeLessThanOrEqual(limit);
      expect(f.name).toContain(`part-`);
    }
    await wipe();
    let restored = 0;
    const seen = [];
    for (const f of result.files) {
      const r = await importBackupDetailed(f.blob, limit);
      restored += r.inspections;
      seen.push(r.volume);
    }
    expect(restored).toBe(6);
    expect(new Set(seen.map((v) => v?.id)).size).toBe(1);
    expect(seen[0]?.total).toBe(result.files.length);
    expect(await db.inspections.count()).toBe(6);
    expect(await db.photos.count()).toBe(12);
    // Byte-for-byte photo integrity, including metadata associations.
    for (const { record, bytes } of sources) {
      expect(await db.inspections.get(record.id)).toEqual(record);
      for (const [id, [orig, comp]] of bytes) {
        const row = (await db.photos.get(id))!;
        expect(row.inspectionId).toBe(record.id);
        expect(new Uint8Array(row.original)).toEqual(orig);
        expect(new Uint8Array(row.compressed)).toEqual(comp);
        const was = before.find((p) => p.id === id)!;
        expect(row.itemId).toBe(was.itemId);
        expect(row.caption).toBe(was.caption);
        expect(row.order).toBe(was.order);
      }
    }
  });
  it("uses one limit for export and import: a file made for a limit is refused under a smaller one", async () => {
    await addInspection("E-1", [100 * KB], 1);
    const { files } = await createBackupVolumes({ maxBytes: 400 * KB });
    expect(files).toHaveLength(1);
    await expect(readBackup(files[0].blob, 50 * KB)).rejects.toBeInstanceOf(
      BackupTooLargeError,
    );
    await expect(readBackup(files[0].blob, 400 * KB)).resolves.toBeDefined();
  });
  it("reports, rather than silently dropping, an inspection too large for any restorable file", async () => {
    const small = await addInspection("SMALL", [20 * KB], 1);
    const huge = await addInspection("HUGE", [400 * KB], 2);
    const result = await createBackupVolumes({ maxBytes: 200 * KB });
    expect(result.excludedInspectionIds).toContain(huge.record.id);
    expect(
      result.excluded.some(
        (i) => i.id === huge.record.id && /Recovery/i.test(i.message),
      ),
    ).toBe(true);
    expect(result.inspectionCount).toBe(1);
    // Local data is untouched and the rest is restorable.
    expect(await db.inspections.get(huge.record.id)).toBeDefined();
    expect(await db.photos.count()).toBe(2);
    await wipe();
    expect(await importBackup(result.files[0].blob, 200 * KB)).toBe(1);
    expect(await db.inspections.get(small.record.id)).toBeDefined();
  });
  it("createBackup returns one restorable file when the data fits", async () => {
    for (let n = 0; n < 3; n++) await addInspection(`E-${n}`, [30 * KB], n);
    const single = await createBackup();
    expect(single.size).toBeGreaterThan(0);
  });
  it("detects corruption inside a backup file", async () => {
    await addInspection("E-1", [200 * KB], 1);
    const { files } = await createBackupVolumes();
    const bytes = new Uint8Array(await files[0].blob.arrayBuffer());
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    await expect(readBackup(new Blob([bytes]))).rejects.toThrow();
  });
  it("does not modify stored data and refuses duplicate imports", async () => {
    const a = await addInspection("E-1", [30 * KB], 1);
    const snapshot = JSON.stringify(await db.inspections.toArray());
    const { files } = await createBackupVolumes();
    expect(JSON.stringify(await db.inspections.toArray())).toBe(snapshot);
    await expect(importBackup(files[0].blob)).rejects.toThrow("already exists");
    expect(await db.inspections.get(a.record.id)).toEqual(a.record);
  });
});

describe("review regressions", () => {
  it("a photo row with missing image data is reported and does not block the backup", async () => {
    const good = await addInspection("GOOD", [20 * KB], 1);
    const bad = await addInspection("BAD", [20 * KB], 2);
    const [badId] = [...bad.bytes.keys()];
    await db.photos.update(badId, { original: undefined } as never);
    const result = await createBackupVolumes();
    expect(
      result.excluded.some((i) => i.kind === "photo" && i.id === badId),
    ).toBe(true);
    expect(result.excludedInspectionIds).toContain(bad.record.id);
    await wipe();
    expect(await importBackup(result.files[0].blob)).toBe(2);
    expect(await db.photos.get([...good.bytes.keys()][0])).toBeDefined();
  });
  it("a limit with no safety slack still yields only files that fit and restore", async () => {
    for (let n = 0; n < 5; n++)
      await addInspection(`E-${n}`, [50 * KB, 30 * KB], n + 7);
    const probe = await createBackupVolumes({ maxBytes: 10 * 1024 * KB });
    const total = await expanded(probe.files[0].blob);
    const limit = Math.floor(total * 0.6);
    const result = await createBackupVolumes({ maxBytes: limit, slack: 0 });
    expect(result.excluded).toEqual([]);
    expect(result.files.length).toBeGreaterThan(1);
    for (const f of result.files) {
      expect(await expanded(f.blob)).toBeLessThanOrEqual(limit);
      await expect(readBackup(f.blob, limit)).resolves.toBeDefined();
    }
  });
  it("rejects a backup whose report image is not a JPEG, and reports such a stored photo", async () => {
    const { bytes, record } = await addInspection("E", [20 * KB], 1);
    const [id] = [...bytes.keys()];
    // Export side: a stored report image that is really a GIF is reported, not packed.
    const gif = new TextEncoder().encode(
      "GIF89a\x01\x00\x01\x00 more bytes here",
    ).buffer;
    await db.photos.update(id, { compressed: gif } as never);
    const result = await createBackupVolumes();
    expect(result.excluded.some((i) => i.kind === "photo" && i.id === id)).toBe(
      true,
    );
    expect(result.excludedInspectionIds).toContain(record.id);
    // Import side: swap the image inside an otherwise valid backup.
    await db.photos.update(id, {
      compressed: bytes.get(id)![1].slice().buffer,
    } as never);
    const good = await createBackupVolumes();
    const zip = await JSZip.loadAsync(await good.files[0].blob.arrayBuffer());
    const forged = new Uint8Array(bytes.get(id)![1].length);
    forged.set(new TextEncoder().encode("GIF89a"));
    zip.file(`photos/${id}/report.jpg`, forged);
    const blob = await zip.generateAsync({ type: "blob" });
    await expect(readBackup(blob)).rejects.toThrow("invalid report image");
  });
  it("keeps an original whose bytes do not match its declared type (never rejects user photos)", async () => {
    const { bytes, record } = await addInspection("E", [20 * KB], 1);
    const [id] = [...bytes.keys()];
    const png = new Uint8Array(2000);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG saved as image/jpeg
    await db.photos.update(id, { original: png.buffer } as never);
    const result = await createBackupVolumes();
    expect(result.excluded).toEqual([]);
    await wipe();
    expect(await importBackup(result.files[0].blob)).toBe(1);
    expect(new Uint8Array((await db.photos.get(id))!.original)).toEqual(png);
    expect(record.id).toBeDefined();
  });
  it("counts hidden invalid inspections as unbacked work", () => {
    expect(backupStatus([], undefined, Date.now(), 1)).toMatchObject({
      state: "remind",
      unbacked: 1,
    });
  });
});

describe("damaged stored data is reported and preserved", () => {
  it("excludes an invalid inspection from the backup, reports it, and keeps the raw row", async () => {
    const good = await addInspection("GOOD", [20 * KB], 1);
    const bad = await addInspection("BAD", [20 * KB], 2);
    const damaged = { ...bad.record, template: undefined } as unknown;
    await db.inspections.put(damaged as Inspection);
    const scan = await scanStoredData();
    expect(scan.inspections.map((r) => r.id)).toEqual([good.record.id]);
    expect(scan.issues.some((i) => i.id === bad.record.id)).toBe(true);
    const result = await createBackupVolumes();
    expect(result.excluded.some((i) => i.id === bad.record.id)).toBe(true);
    expect(result.excludedInspectionIds).toContain(bad.record.id);
    expect(result.inspectionCount).toBe(1);
    expect(await db.inspections.get(bad.record.id)).toEqual(damaged);
    expect(
      await db.photos.where("inspectionId").equals(bad.record.id).count(),
    ).toBe(1);
    // Raw recovery data still contains the damaged row and its photograph bytes.
    const dump = await JSZip.loadAsync(
      await (await createRecoveryDump()).arrayBuffer(),
    );
    const raw = JSON.parse(
      await dump.file("raw/inspections.json")!.async("string"),
    );
    expect(raw.find((r: Inspection) => r.id === bad.record.id)).toBeDefined();
    const manifest = JSON.parse(
      await dump.file("manifest.json")!.async("string"),
    );
    expect(
      manifest.issues.some((i: { id: string }) => i.id === bad.record.id),
    ).toBe(true);
    const [photoId] = [...bad.bytes.keys()];
    expect(
      await dump.file(`photos/${photoId}/original`)!.async("uint8array"),
    ).toEqual(bad.bytes.get(photoId)![0]);
  });
  it("reports an inspection with a damaged updatedAt instead of hiding it", async () => {
    const { record } = await addInspection("E", [], 1);
    await db.inspections.put({
      ...record,
      updatedAt: undefined,
    } as unknown as Inspection);
    const scan = await scanStoredData();
    expect(scan.issues.some((i) => i.id === record.id)).toBe(true);
  });
  it("opens with a damaged workspace row, reports it, and quarantines it before any overwrite", async () => {
    await db.meta.put({
      key: "workspace",
      value: '{"inspector": {"name": 5}}',
    });
    expect(await loadWorkspace()).toEqual({});
    expect(
      (await scanStoredData()).issues.some((i) => i.kind === "workspace"),
    ).toBe(true);
    await saveWorkspace({ defaultProjectId: details.projectId });
    const kept = await db.meta
      .where("key")
      .startsWith("quarantine:workspace:")
      .toArray();
    expect(kept).toHaveLength(1);
    expect(kept[0].value).toBe('{"inspector": {"name": 5}}');
  });
  it("one corrupt report template does not hide the others and is never rewritten silently", async () => {
    const now = new Date().toISOString();
    const make = (name: string) =>
      reportTemplateSchema.parse({
        id: crypto.randomUUID(),
        name,
        createdAt: now,
        updatedAt: now,
        defaults: {
          supervisionTitle: "",
          commencementDate: "",
          completionDate: "",
          contractPeriod: "",
          wording: { activities: "", safety: "", instructions: "" },
          staff: [],
          workActivities: [],
          testTypes: [],
        },
      });
    const ok = make("Good");
    await storeReportTemplate(ok);
    const badId = crypto.randomUUID();
    await db.meta.put({ key: reportTemplateKey(badId), value: "{broken" });
    expect((await loadReportTemplates()).map((t) => t.name)).toEqual(["Good"]);
    const scan = await scanStoredData();
    expect(scan.issues.some((i) => i.id === reportTemplateKey(badId))).toBe(
      true,
    );
    await storeReportTemplate({ ...make("Replacement"), id: badId });
    const kept = await db.meta
      .where("key")
      .startsWith(`quarantine:${reportTemplateKey(badId)}`)
      .toArray();
    expect(kept.map((k) => k.value)).toEqual(["{broken"]);
    // The backup must still be restorable and flag the omitted item.
    await db.meta.put({
      key: reportTemplateKey(crypto.randomUUID()),
      value: "{x",
    });
    const result = await createBackupVolumes();
    expect(result.excluded.some((i) => i.kind === "report-template")).toBe(
      true,
    );
    await expect(readBackup(result.files[0].blob)).resolves.toBeDefined();
  });
});

describe("backup reminders and storage-loss hint", () => {
  const real = (id: string, updatedAt: string) => ({
    id,
    fictional: false,
    updatedAt,
  });
  const now = Date.parse("2026-11-10T00:00:00Z");
  it("ignores fictional demo data", () => {
    expect(
      backupStatus(
        [{ id: "d", fictional: true, updatedAt: "2026-01-01" }],
        undefined,
        now,
      ).state,
    ).toBe("none");
  });
  it("reminds immediately when real work has never been backed up", () => {
    expect(
      backupStatus([real("a", "2026-11-09T00:00:00Z")], undefined, now),
    ).toMatchObject({ state: "remind", unbacked: 1 });
  });
  it("stays quiet right after a backup and after unchanged data", () => {
    const log: BackupLog = {
      at: "2026-11-09T12:00:00Z",
      inspectionCount: 1,
      excludedIds: [],
    };
    expect(
      backupStatus([real("a", "2026-11-09T11:00:00Z")], log, now).state,
    ).toBe("ok");
    expect(
      backupStatus([real("a", "2026-11-09T13:00:00Z")], log, now).state,
    ).toBe("ok");
  });
  it("reminds after the interval when work changed since the last backup", () => {
    const log: BackupLog = {
      at: "2026-11-01T00:00:00Z",
      inspectionCount: 1,
      excludedIds: [],
    };
    expect(
      backupStatus([real("a", "2026-11-05T00:00:00Z")], log, now),
    ).toMatchObject({ state: "remind", unbacked: 1 });
    expect(
      backupStatus([real("a", "2026-10-30T00:00:00Z")], log, now).state,
    ).toBe("ok");
  });
  it("never counts an incompletely backed-up inspection as covered", () => {
    const log: BackupLog = {
      at: "2026-11-01T00:00:00Z",
      inspectionCount: 0,
      excludedIds: ["a"],
    };
    expect(
      backupStatus([real("a", "2026-10-01T00:00:00Z")], log, now),
    ).toMatchObject({ state: "remind", unbacked: 1 });
  });
  it("storage-loss hint needs a remembered marker AND an uninitialised database", () => {
    const marked = { getItem: () => "2026-11-01" };
    const empty = { getItem: () => null };
    expect(suspectedStorageLoss(false, marked)).toBe(true);
    expect(suspectedStorageLoss(true, marked)).toBe(false);
    expect(suspectedStorageLoss(false, empty)).toBe(false);
    expect(
      suspectedStorageLoss(false, {
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(false);
  });
});
