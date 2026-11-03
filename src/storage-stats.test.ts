import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { newInspection, templates, type StoredPhoto } from "./domain";
import { details } from "./test-fixtures";
import {
  UNASSIGNED_PROJECT,
  UNLINKED_PROJECT,
  StatsAbortedError,
  binarySize,
  canRequestPersistence,
  computeStorageStats,
  formatBytes,
  readPersistenceStatus,
  readStorageEstimate,
  sortProjects,
  storageHealth,
  usageRatio,
} from "./storage-stats";
import { backupStatus } from "./storage-health";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
});

const photo = (
  inspectionId: string,
  originalBytes: number,
  compressedBytes: number,
  extra: Partial<StoredPhoto> = {},
): StoredPhoto => ({
  id: crypto.randomUUID(),
  inspectionId,
  itemId: "toe-level",
  caption: "",
  order: 0,
  name: "p.jpg",
  original: new ArrayBuffer(originalBytes),
  compressed: new ArrayBuffer(compressedBytes),
  originalType: "image/jpeg",
  width: 10,
  height: 10,
  createdAt: new Date().toISOString(),
  ...extra,
});

const inspection = (projectId: string, projectName = "Project " + projectId) =>
  newInspection({ ...details, projectId, projectName }, templates[0]);

async function snapshot() {
  const out: Record<string, unknown[]> = {};
  for (const t of db.tables) out[t.name] = await t.toArray();
  return out;
}

describe("formatBytes", () => {
  it("formats B, KB, MB and GB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(320 * 1024 * 1024)).toBe("320 MB");
    expect(formatBytes(12.34 * 1024 ** 2)).toBe("12.3 MB");
    expect(formatBytes(2.5 * 1024 ** 3)).toBe("2.50 GB");
  });
  it("reports unknown values as Unavailable", () => {
    expect(formatBytes(undefined)).toBe("Unavailable");
    expect(formatBytes(null)).toBe("Unavailable");
    expect(formatBytes(NaN)).toBe("Unavailable");
    expect(formatBytes(-1)).toBe("Unavailable");
  });
});

describe("binarySize", () => {
  it("measures ArrayBuffers, views and Blobs without reading them", () => {
    expect(binarySize(new ArrayBuffer(7))).toBe(7);
    expect(binarySize(new Uint8Array(3))).toBe(3);
    expect(binarySize(new Blob([new Uint8Array(5)]))).toBe(5);
    expect(binarySize(undefined)).toBeUndefined();
    expect(binarySize("not binary")).toBeUndefined();
  });
});

describe("computeStorageStats", () => {
  it("handles an empty database", async () => {
    const s = await computeStorageStats();
    expect(s).toMatchObject({
      inspections: 0,
      photos: 0,
      drawings: 0,
      photoBytes: 0,
      projects: [],
    });
  });

  it("counts records and photos and groups them by project", async () => {
    await db.projects.bulkAdd([
      { id: "a", name: "Alpha", reference: "A", fictional: false },
      { id: "b", name: "Beta", reference: "B", fictional: false },
    ]);
    const a1 = inspection("a"),
      a2 = inspection("a"),
      b1 = inspection("b");
    await db.inspections.bulkAdd([a1, a2, b1]);
    await db.photos.bulkAdd([
      photo(a1.id, 1000, 100),
      photo(a2.id, 2000, 200),
      photo(b1.id, 50_000, 5_000),
    ]);
    const s = await computeStorageStats();
    expect(s.inspections).toBe(3);
    expect(s.photos).toBe(3);
    expect(s.photoBytes).toBe(58_300);
    const alpha = s.projects.find((p) => p.key === "a")!;
    const beta = s.projects.find((p) => p.key === "b")!;
    expect(alpha).toMatchObject({ name: "Alpha", inspections: 2, photos: 2 });
    expect(alpha.photoBytes).toBe(3300);
    expect(beta).toMatchObject({ name: "Beta", inspections: 1, photos: 1 });
    // Sorted by storage: Beta has the larger photographs.
    expect(s.projects.map((p) => p.key)).toEqual(["b", "a"]);
    // Totals add up, nothing counted twice.
    const sum = s.projects.reduce((n, p) => n + p.totalBytes, 0);
    expect(sum).toBe(s.photoBytes + s.drawingBytes + s.recordBytes);
    expect(s.projects.reduce((n, p) => n + p.photos, 0)).toBe(s.photos);
  });

  it("includes plan drawing files under their inspection's project", async () => {
    const r = inspection("a");
    await db.inspections.add(r);
    const id = crypto.randomUUID();
    await db.drawings.add({
      id,
      inspectionId: r.id,
      name: "d.pdf",
      title: "",
      number: "",
      revision: "",
      mimeType: "application/pdf",
      size: 4096,
      pageCount: 1,
      order: 0,
      createdAt: new Date().toISOString(),
    });
    await db.drawingFiles.add({ id, bytes: new ArrayBuffer(4096) });
    const s = await computeStorageStats();
    expect(s.drawings).toBe(1);
    expect(s.drawingBytes).toBe(4096);
    expect(s.projects[0]).toMatchObject({ key: "a", drawings: 1 });
  });

  it("falls back for missing or unknown project identifiers", async () => {
    const noProject = inspection("x");
    (noProject as { projectId: string }).projectId = "";
    const unknown = inspection("gone", "Removed project");
    await db.inspections.bulkAdd([noProject, unknown]);
    const s = await computeStorageStats();
    expect(s.unassignedInspections).toBe(1);
    expect(s.projects.find((p) => p.key === UNASSIGNED_PROJECT)).toBeTruthy();
    // A project id with no project row uses the name recorded on the inspection.
    expect(s.projects.find((p) => p.key === "gone")?.name).toBe(
      "Removed project",
    );
  });

  it("tolerates missing or corrupted photo data and orphan photos", async () => {
    const r = inspection("a");
    await db.inspections.add(r);
    const broken = photo(r.id, 0, 0);
    (broken as unknown as Record<string, unknown>).original = undefined;
    (broken as unknown as Record<string, unknown>).compressed = "garbage";
    await db.photos.bulkAdd([
      broken,
      photo(r.id, 10, 10),
      photo("no-such-inspection", 30, 3),
    ]);
    const s = await computeStorageStats();
    expect(s.photos).toBe(3);
    expect(s.unmeasuredPhotos).toBe(1);
    expect(s.unlinkedPhotos).toBe(1);
    expect(s.photoBytes).toBe(53);
    expect(s.projects.find((p) => p.key === UNLINKED_PROJECT)?.photos).toBe(1);
    const health = storageHealth({ stats: s }).map((h) => h.id);
    expect(health).toContain("unmeasured-data");
    expect(health).toContain("unlinked-photos");
  });

  it("never modifies stored data", async () => {
    await db.projects.add({
      id: "a",
      name: "Alpha",
      reference: "A",
      fictional: false,
    });
    const r = inspection("a");
    await db.inspections.add(r);
    await db.photos.add(photo(r.id, 64, 16));
    await db.meta.put({ key: "workspace", value: "{}" });
    const before = await snapshot();
    await computeStorageStats();
    expect(await snapshot()).toEqual(before);
  });

  it("handles a large photo collection", async () => {
    const r = inspection("a");
    await db.inspections.add(r);
    await db.photos.bulkAdd(
      Array.from({ length: 1500 }, () => photo(r.id, 100, 10)),
    );
    const s = await computeStorageStats();
    expect(s.photos).toBe(1500);
    expect(s.photoBytes).toBe(1500 * 110);
  });

  it("stops when cancelled", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(computeStorageStats({ signal: ac.signal })).rejects.toThrow(
      StatsAbortedError,
    );
  });

  it("leaves existing backup status logic unaffected", async () => {
    const r = inspection("a");
    await db.inspections.add(r);
    await computeStorageStats();
    expect(backupStatus([r], undefined).state).toBe("remind");
  });
});

describe("sortProjects", () => {
  const row = (
    key: string,
    inspections: number,
    photos: number,
    total: number,
  ) => ({
    key,
    name: key,
    inspections,
    photos,
    drawings: 0,
    photoBytes: total,
    drawingBytes: 0,
    recordBytes: 0,
    totalBytes: total,
  });
  const rows = [row("a", 1, 50, 10), row("b", 9, 5, 500), row("c", 4, 99, 100)];
  it("sorts by storage, inspections or photos", () => {
    expect(sortProjects(rows, "storage").map((r) => r.key)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(sortProjects(rows, "inspections").map((r) => r.key)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(sortProjects(rows, "photos").map((r) => r.key)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(rows.map((r) => r.key)).toEqual(["a", "b", "c"]); // input untouched
  });
});

describe("browser storage APIs", () => {
  it("reports an unsupported estimate API", async () => {
    expect(await readStorageEstimate(undefined)).toEqual({
      status: "unsupported",
    });
    expect(await readStorageEstimate({})).toEqual({ status: "unsupported" });
  });
  it("reports a rejected estimate", async () => {
    const r = await readStorageEstimate({
      estimate: () => Promise.reject(new Error("denied")),
    });
    expect(r).toEqual({ status: "error", message: "denied" });
    expect(usageRatio(r)).toBeUndefined();
  });
  it("computes the usage ratio and ignores invalid values", async () => {
    const ok = await readStorageEstimate({
      estimate: async () => ({ usage: 50, quota: 200 }),
    });
    expect(usageRatio(ok)).toBe(0.25);
    const bad = await readStorageEstimate({
      estimate: async () => ({ usage: NaN, quota: 0 }),
    });
    expect(bad).toEqual({ status: "ok", usage: undefined, quota: 0 });
    expect(usageRatio(bad)).toBeUndefined();
  });
  it("reads every persistence state", async () => {
    expect(await readPersistenceStatus(undefined)).toBe("unsupported");
    expect(await readPersistenceStatus({ persisted: async () => true })).toBe(
      "granted",
    );
    expect(await readPersistenceStatus({ persisted: async () => false })).toBe(
      "not-granted",
    );
    expect(
      await readPersistenceStatus({
        persisted: () => Promise.reject(new Error("x")),
      }),
    ).toBe("unknown");
    expect(canRequestPersistence({})).toBe(false);
    expect(canRequestPersistence({ persist: async () => true })).toBe(true);
  });
});

describe("storageHealth", () => {
  const ids = (input: Parameters<typeof storageHealth>[0]) =>
    storageHealth(input).map((h) => h.id);
  it("raises no warnings just because APIs are unsupported", () => {
    expect(
      ids({ estimate: { status: "unsupported" }, persistence: "unsupported" }),
    ).toEqual([]);
  });
  it("warns at high and critical utilization", () => {
    expect(ids({ estimate: { status: "ok", usage: 85, quota: 100 } })).toEqual([
      "usage-high",
    ]);
    expect(ids({ estimate: { status: "ok", usage: 96, quota: 100 } })).toEqual([
      "usage-critical",
    ]);
    expect(ids({ estimate: { status: "ok", usage: 10, quota: 100 } })).toEqual(
      [],
    );
  });
  it("warns when quota is missing or the estimate failed", () => {
    expect(ids({ estimate: { status: "ok", usage: 10 } })).toEqual([
      "quota-unavailable",
    ]);
    expect(ids({ estimate: { status: "error", message: "no" } })).toEqual([
      "quota-unavailable",
    ]);
  });
  it("reports persistence not granted and calculation failure", () => {
    expect(ids({ persistence: "not-granted" })).toEqual([
      "persistence-not-granted",
    ]);
    expect(ids({ persistence: "unknown" })).toEqual([]);
    expect(ids({ statsError: "boom" })).toEqual(["stats-failed"]);
  });
});
