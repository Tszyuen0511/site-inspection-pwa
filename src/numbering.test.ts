import { beforeEach, describe, expect, it } from "vitest";
import {
  addNumberedInspection,
  db,
  numberForProject,
  repeatInspection,
  seed,
} from "./db";
import {
  displayNo,
  inspectionCode,
  newInspection,
  packageName,
  templates,
  type Inspection,
} from "./domain";
import {
  createBackupVolumes,
  importBackup,
  importBackupDetailed,
} from "./backup";
import { toStoredPhoto, listPhotoViews } from "./photos";
import { details } from "./test-fixtures";

const tpl = (name: string) => templates.find((t) => t.name === name)!;
const make = (type: string, projectId = details.projectId, element = "E") =>
  newInspection({ ...details, projectId, type, element }, tpl(type));
beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
});

describe("inspection numbers", () => {
  it("derives the prefix from the inspection type", () => {
    expect(inspectionCode("Sheet Pile")).toBe("SP");
    expect(inspectionCode("Bored Pile")).toBe("BP");
    expect(inspectionCode("Pipe Pile")).toBe("PP");
    expect(inspectionCode("Excavation")).toBe("EX");
    expect(inspectionCode("")).toBe("GEN");
  });
  it("numbers sequentially per project and type", async () => {
    const sp1 = await addNumberedInspection(make("Sheet Pile", "A", "SP01"));
    const sp2 = await addNumberedInspection(make("Sheet Pile", "A", "SP02"));
    const bp1 = await addNumberedInspection(make("Bored Pile", "A", "BP01"));
    const pp1 = await addNumberedInspection(make("Pipe Pile", "A", "PP01"));
    const otherProject = await addNumberedInspection(make("Sheet Pile", "B"));
    expect(
      [sp1, sp2, bp1, pp1, otherProject].map((r) => r.inspectionNo),
    ).toEqual([
      "INSP-SP-001",
      "INSP-SP-002",
      "INSP-BP-001",
      "INSP-PP-001",
      "INSP-SP-001",
    ]);
    // Internal UUID ids are unchanged and remain the database key.
    expect(sp1.id).toMatch(/^INSP-[0-9A-F-]{36}$/);
    expect((await db.inspections.get(sp1.id))?.inspectionNo).toBe(
      "INSP-SP-001",
    );
  });
  it("never hands out the same number to simultaneous creations", async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, () =>
        addNumberedInspection(make("Sheet Pile")),
      ),
    );
    const numbers = created.map((r) => r.inspectionNo).sort();
    expect(new Set(numbers).size).toBe(8);
    expect(numbers[7]).toBe("INSP-SP-008");
  });
  it("continues after the highest number and never reuses a deleted one's gap backwards", async () => {
    await addNumberedInspection(make("Sheet Pile"));
    const second = await addNumberedInspection(make("Sheet Pile"));
    await addNumberedInspection(make("Sheet Pile"));
    await db.inspections.delete(second.id);
    expect((await addNumberedInspection(make("Sheet Pile"))).inspectionNo).toBe(
      "INSP-SP-004",
    );
  });
  it("never reissues the number of a deleted newest record", async () => {
    await addNumberedInspection(make("Sheet Pile"));
    const newest = await addNumberedInspection(make("Sheet Pile"));
    expect(newest.inspectionNo).toBe("INSP-SP-002");
    await db.inspections.delete(newest.id);
    expect((await addNumberedInspection(make("Sheet Pile"))).inspectionNo).toBe(
      "INSP-SP-003",
    );
  });
  it("gives a draft moved to another project the next number there", async () => {
    await addNumberedInspection(make("Sheet Pile", "A"));
    const b = await addNumberedInspection(make("Sheet Pile", "B"));
    expect(b.inspectionNo).toBe("INSP-SP-001");
    expect(await numberForProject(b, "A")).toBe("INSP-SP-002");
    expect(
      (await addNumberedInspection(make("Sheet Pile", "A"))).inspectionNo,
    ).toBe("INSP-SP-003");
  });
  it("strips accents when deriving a code", () => {
    expect(inspectionCode("Décapage Pile")).toBe("DP");
  });
  it("leaves older records without a number untouched and shows their original id", async () => {
    const legacy = make("Sheet Pile");
    await db.inspections.add(legacy);
    const next = await addNumberedInspection(make("Sheet Pile"));
    expect(next.inspectionNo).toBe("INSP-SP-001");
    expect(await db.inspections.get(legacy.id)).toEqual(legacy);
    expect(displayNo(legacy)).toBe(legacy.id);
    expect(packageName(legacy)).toContain(legacy.id);
    expect(packageName(next)).toContain("INSP-SP-001");
  });
  it("gives a repeated inspection a new number and keeps the source's number", async () => {
    const source = await addNumberedInspection(make("Sheet Pile"));
    const copy = await repeatInspection(source);
    expect(copy.inspectionNo).toBe("INSP-SP-002");
    expect((await db.inspections.get(source.id))?.inspectionNo).toBe(
      "INSP-SP-001",
    );
  });
  it("numbers the demonstration records per project and type", async () => {
    await seed();
    const rows = await db.inspections.toArray();
    const keys = rows.map((r) => `${r.projectId}:${r.inspectionNo}`);
    expect(new Set(keys).size).toBe(rows.length);
    expect(rows.find((r) => r.element === "SP-001")?.inspectionNo).toBe(
      "INSP-SP-001",
    );
    expect(rows.find((r) => r.element === "BP-012")?.inspectionNo).toBe(
      "INSP-BP-001",
    );
  });
  it("keeps numbers and photo remarks through backup and restore", async () => {
    await db.projects.add({
      id: details.projectId,
      name: details.projectName,
      reference: details.projectReference,
      fictional: false,
    });
    await db.templates.bulkAdd(templates);
    const r: Inspection = await addNumberedInspection(make("Sheet Pile"));
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    await db.photos.add(
      await toStoredPhoto({
        id: crypto.randomUUID(),
        inspectionId: r.id,
        itemId: "toe-level",
        caption: "Toe level survey",
        remark: "Level checked against drawing",
        order: 0,
        name: "x.jpg",
        original: new Blob([jpeg], { type: "image/jpeg" }),
        compressed: new Blob([jpeg], { type: "image/jpeg" }),
        width: 1,
        height: 1,
        createdAt: r.createdAt,
      }),
    );
    const { files } = await createBackupVolumes();
    await db.transaction("rw", db.tables, async () => {
      for (const t of db.tables) await t.clear();
    });
    await importBackup(files[0].blob);
    expect((await db.inspections.get(r.id))?.inspectionNo).toBe("INSP-SP-001");
    const [photo] = await listPhotoViews(r.id);
    expect(photo.remark).toBe("Level checked against drawing");
    expect(photo.caption).toBe("Toe level survey");
  });
  it("reports, but never renumbers, an imported number already used locally", async () => {
    await db.projects.add({
      id: details.projectId,
      name: details.projectName,
      reference: details.projectReference,
      fictional: false,
    });
    await db.templates.bulkAdd(templates);
    const theirs = await addNumberedInspection(make("Sheet Pile"));
    const { files } = await createBackupVolumes();
    await db.inspections.clear();
    await db.meta.clear();
    const mine = await addNumberedInspection(make("Sheet Pile"));
    expect(mine.inspectionNo).toBe(theirs.inspectionNo);
    const result = await importBackupDetailed(files[0].blob);
    expect(result.numberConflicts).toEqual(["INSP-SP-001"]);
    expect((await db.inspections.get(theirs.id))?.inspectionNo).toBe(
      "INSP-SP-001",
    );
    expect((await db.inspections.get(mine.id))?.inspectionNo).toBe(
      "INSP-SP-001",
    );
  });
});
