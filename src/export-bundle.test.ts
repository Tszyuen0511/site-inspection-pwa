import { beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import { db } from "./db";
import { newInspection, templates, type Inspection } from "./domain";
import { toStoredPhoto } from "./photos";
import { addDrawing, setLocationRegion } from "./drawings";
import { readiness, readinessFacts } from "./readiness";
import {
  bundleFolder,
  createExportBundle,
  folderName,
  planParts,
} from "./export-bundle";
import { importBackup } from "./backup";
import { details } from "./test-fixtures";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
  await db.projects.add({
    id: details.projectId,
    name: "Demo Works",
    reference: details.projectReference,
    fictional: false,
  });
});
const deps = {
  loadPlans: async () => undefined,
  loadOriginals: async () => [],
};
const image = () =>
  new Blob([readFileSync("src/test-image.jpg")], { type: "image/jpeg" });
async function inspection(
  element: string,
  project = "Demo Works",
  date = "2026-11-03",
) {
  const r = newInspection(
    { ...details, element, projectName: project, date },
    templates[0],
  );
  await db.inspections.add(r);
  return r;
}
async function addPhoto(r: Inspection, n: number) {
  await db.photos.add(
    await toStoredPhoto({
      id: crypto.randomUUID(),
      inspectionId: r.id,
      itemId: r.template.items[0].id,
      caption: "",
      order: n,
      name: `p${n}.jpg`,
      original: image(),
      compressed: image(),
      width: 1,
      height: 1,
      createdAt: r.createdAt,
    }),
  );
}
const complete = (r: Inspection) => {
  for (const i of r.template.items) {
    r.responses[i.id].status = "Pass";
    r.responses[i.id].date = "2026-11-03";
  }
  return r;
};

describe("export readiness", () => {
  it("lists what is missing, and is ready when complete", () => {
    const r = newInspection(details, templates[0]);
    const facts = { photos: 0, drawings: 0, marked: false };
    expect(readiness(r, facts).issues).toEqual([
      "7 items without a result",
      "No location plan",
      "No photographs",
    ]);
    complete(r);
    r.responses["toe-level"].status = "Fail";
    r.responses["corner-welding"].date = "";
    r.responses["trial-pit"].status = "Not Applicable";
    r.responses["trial-pit"].date = undefined; // N/A needs no date
    expect(
      readiness(r, { photos: 3, drawings: 1, marked: false }).issues,
    ).toEqual([
      "1 item missing an inspection date",
      "1 failed item without a remark",
      "Location not marked on the plan",
    ]);
    r.responses["toe-level"].remarks = "Toe 20 mm high";
    r.responses["corner-welding"].date = "2026-11-04";
    expect(readiness(r, { photos: 3, drawings: 1, marked: true })).toEqual({
      ready: true,
      issues: [],
    });
  });
  it("counts photos, drawings and markings per inspection", async () => {
    const a = await inspection("SP-001"),
      b = await inspection("SP-002");
    await addPhoto(a, 0);
    await addPhoto(a, 1);
    const d = await addDrawing(
      b.id,
      {
        name: "plan.png",
        type: "image/png",
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
      },
      1,
    );
    await setLocationRegion({
      inspectionId: b.id,
      drawingId: d.id,
      page: 1,
      a: { x: 0.1, y: 0.1 },
      b: { x: 0.2, y: 0.2 },
    });
    const facts = await readinessFacts();
    expect(facts.get(a.id)).toEqual({ photos: 2, drawings: 0, marked: false });
    expect(facts.get(b.id)).toEqual({ photos: 0, drawings: 1, marked: true });
  });
});

describe("multi-inspection export", () => {
  it("cleans folder names and lays out Project / Element / Date", async () => {
    expect(folderName('  A/B: "C" <D>|E?  ', "x")).toBe("A-B- -C- -D-E");
    expect(folderName(" ... ", "Fallback")).toBe("Fallback");
    const r = await inspection("SP 002", "Harbour: Phase 1", "2026-11-03");
    expect(bundleFolder(r)).toBe("Harbour- Phase 1/SP 002/2026-11-03");
  });
  it("packs every selected inspection's PDF and package into one ZIP", async () => {
    const a = complete(await inspection("SP-001"));
    const b = await inspection("SP-002", "Other Project", "2026-11-04");
    await addPhoto(a, 0);
    await addPhoto(b, 0);
    const out = await createExportBundle([a, b], deps, {
      includeBackup: false,
      now: new Date(2026, 10, 8, 9),
    });
    expect(out.files.map((f) => f.name)).toEqual([
      "Site-Inspections_2026-11-08.zip",
    ]);
    const zip = await JSZip.loadAsync(await out.files[0].blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(names.sort()).toEqual([
      "Demo Works/SP-001/2026-11-03/INSP-SP-001.pdf",
      "Demo Works/SP-001/2026-11-03/INSP-SP-001_package.zip",
      "Other Project/SP-002/2026-11-04/INSP-SP-002.pdf",
      "Other Project/SP-002/2026-11-04/INSP-SP-002_package.zip",
    ]);
    const pdf = await zip
      .file("Demo Works/SP-001/2026-11-03/INSP-SP-001.pdf")!
      .async("string");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    // The package carries the same record and its photographs.
    const pkg = await JSZip.loadAsync(
      await zip
        .file("Demo Works/SP-001/2026-11-03/INSP-SP-001_package.zip")!
        .async("uint8array"),
    );
    const dataPath = Object.keys(pkg.files).find((n) =>
      n.endsWith("Inspection_Data.json"),
    )!;
    const data = JSON.parse(await pkg.file(dataPath)!.async("string"));
    expect(data.inspection.id).toBe(a.id);
    expect(data.photos).toHaveLength(1);
    expect(out.backupLog).toBeUndefined();
  });
  it("never overwrites two inspections of one element on one date", async () => {
    const a = await inspection("SP-001"),
      b = await inspection("SP-001");
    const out = await createExportBundle([a, b], deps, {
      includeBackup: false,
    });
    const zip = await JSZip.loadAsync(await out.files[0].blob.arrayBuffer());
    expect(
      Object.keys(zip.files)
        .filter((n) => n.endsWith(".pdf"))
        .sort(),
    ).toEqual([
      "Demo Works/SP-001/2026-11-03/INSP-SP-001.pdf",
      "Demo Works/SP-001/2026-11-03/INSP-SP-001_2.pdf",
    ]);
  });
  it("splits large exports into numbered parts", async () => {
    const records = [];
    for (const n of [1, 2, 3]) {
      const r = await inspection(`SP-00${n}`);
      await addPhoto(r, 0);
      records.push(r);
    }
    const out = await createExportBundle(records, deps, {
      includeBackup: false,
      partLimit: 1, // every inspection is bigger than this
      now: new Date(2026, 10, 8, 9),
    });
    expect(out.files.map((f) => f.name)).toEqual([
      "Site-Inspections_2026-11-08_part-1-of-3.zip",
      "Site-Inspections_2026-11-08_part-2-of-3.zip",
      "Site-Inspections_2026-11-08_part-3-of-3.zip",
    ]);
    expect(
      planParts(
        [
          { item: "a", bytes: 60 },
          { item: "b", bytes: 50 },
          { item: "c", bytes: 30 },
          { item: "d", bytes: 500 },
        ],
        100,
      ),
    ).toEqual([["a"], ["b", "c"], ["d"]]);
  });
  it("adds a restorable backup that restores the records", async () => {
    const a = await inspection("SP-001");
    await addPhoto(a, 0);
    const out = await createExportBundle([a], deps, { includeBackup: true });
    expect(out.files).toHaveLength(2);
    expect(out.backupLog?.inspectionCount).toBe(1);
    expect(out.backupExcluded).toEqual([]);
    await db.transaction("rw", db.tables, async () => {
      for (const t of [db.inspections, db.photos]) await t.clear();
    });
    await importBackup(out.files[1].blob);
    expect((await db.inspections.get(a.id))?.element).toBe("SP-001");
    expect(await db.photos.where("inspectionId").equals(a.id).count()).toBe(1);
  });
  it("does not change any stored record", async () => {
    const a = await inspection("SP-001");
    await addPhoto(a, 0);
    const before = await db.inspections.toArray();
    await createExportBundle([a], deps, { includeBackup: true });
    expect(await db.inspections.toArray()).toEqual(before);
  });
  it("refuses an empty selection", async () => {
    await expect(
      createExportBundle([], deps, { includeBackup: false }),
    ).rejects.toThrow("Select at least one");
  });
});
