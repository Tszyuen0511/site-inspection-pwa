import { beforeEach, describe, expect, it } from "vitest";
import { db, saveIfUnchanged, inspectionContentKey } from "./db";
import {
  displayDate,
  displayNo,
  elementInspectionNo,
  inspectionSchema,
  newInspection,
  templates,
  validationIssues,
  type Inspection,
} from "./domain";
import { createBackupVolumes, importBackup } from "./backup";
import { toStoredPhoto, listPhotoViews } from "./photos";
import { details } from "./test-fixtures";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
  await db.projects.add({
    id: details.projectId,
    name: details.projectName,
    reference: details.projectReference,
    fictional: false,
  });
});
const make = (element = "SP-001") =>
  newInspection({ ...details, element }, templates[0]);
const setDate = (r: Inspection, itemId: string, date: string): Inspection => ({
  ...r,
  responses: { ...r.responses, [itemId]: { ...r.responses[itemId], date } },
});

describe("checklist item inspection dates", () => {
  it("keeps an independent date for each item", () => {
    const r = make();
    const [a, b, c] = r.template.items.map((i) => i.id);
    const edited = setDate(setDate(r, a, "2026-11-03"), b, "2025-02-14");
    expect(edited.responses[a].date).toBe("2026-11-03");
    expect(edited.responses[b].date).toBe("2025-02-14");
    expect(edited.responses[c].date).toBeUndefined();
    // Changing one item's date leaves the others alone.
    const changed = setDate(edited, a, "2026-11-05");
    expect(changed.responses[b].date).toBe("2025-02-14");
    expect(r.responses[a].date).toBeUndefined();
  });
  it("persists dates through autosave and reopening", async () => {
    const r = make();
    await db.inspections.add(r);
    const [a, b] = r.template.items.map((i) => i.id);
    const edited = setDate(setDate(r, a, "2026-11-03"), b, "2026-11-04");
    await saveIfUnchanged(edited, inspectionContentKey(r));
    db.close();
    await db.open();
    const reopened = (await db.inspections.get(r.id))!;
    expect(reopened.responses[a].date).toBe("2026-11-03");
    expect(reopened.responses[b].date).toBe("2026-11-04");
  });
  it("persists dates through backup and restore", async () => {
    const r = setDate(make(), templates[0].items[2].id, "2024-12-31");
    await db.inspections.add(r);
    const { files } = await createBackupVolumes();
    await db.inspections.clear();
    await importBackup(files[0].blob);
    expect(
      (await db.inspections.get(r.id))!.responses[templates[0].items[2].id]
        .date,
    ).toBe("2024-12-31");
  });
  it("loads historical records without dates, measurements intact", async () => {
    const legacy = make();
    legacy.responses["toe-level"].values = { measuredLevel: "-12.48" };
    legacy.responses["toe-level"].reference = "DWG-1";
    for (const resp of Object.values(legacy.responses)) delete resp.date;
    expect(inspectionSchema.safeParse(legacy).success).toBe(true);
    await db.inspections.add(legacy);
    const stored = (await db.inspections.get(legacy.id))!;
    expect(stored.responses["toe-level"].values).toEqual({
      measuredLevel: "-12.48",
    });
    expect(stored.responses["toe-level"].reference).toBe("DWG-1");
    expect(displayDate(stored.responses["toe-level"].date)).toBe(
      "Not recorded",
    );
  });
  it("accepts empty or real calendar dates only, and does not require them", () => {
    const r = make();
    const id = r.template.items[0].id;
    for (const ok of ["", "2026-11-03", "1999-01-01"])
      expect(inspectionSchema.safeParse(setDate(r, id, ok)).success).toBe(true);
    for (const bad of ["2026/11/03", "2026-02-30", "03-11-2026", "today"])
      expect(inspectionSchema.safeParse(setDate(r, id, bad)).success).toBe(
        false,
      );
    for (const item of r.template.items) r.responses[item.id].status = "Pass";
    expect(validationIssues(r)).toEqual([]);
  });
  it("displays dates as YYYY/MM/DD", () => {
    expect(displayDate("2026-11-03")).toBe("2026/11/03");
    expect(displayDate("")).toBe("Not recorded");
    expect(displayDate(undefined)).toBe("Not recorded");
  });
});

describe("inspection number from the element name", () => {
  it.each([
    ["SP-001", "INSP-SP-001"],
    ["SP-002", "INSP-SP-002"],
    ["SP-015", "INSP-SP-015"],
    ["sp-015", "INSP-SP-015"],
    ["  SP 015  ", "INSP-SP-015"],
    ["SP/015:A", "INSP-SP-015-A"],
    ["INSP-SP-001", "INSP-SP-001"],
    ["insp-insp-SP-001", "INSP-SP-001"],
    ["Pilé Nº 3", "INSP-PILE-NO-3"],
    ["", ""],
    [" -- ", ""],
    ["INSP", ""],
  ])("%j -> %j", (element, expected) => {
    expect(elementInspectionNo(element)).toBe(expected);
  });
  it("follows element name changes without touching ids or photo links", async () => {
    const r = make("SP-001");
    await db.inspections.add(r);
    await db.photos.add(
      await toStoredPhoto({
        id: "photo-1",
        inspectionId: r.id,
        itemId: "toe-level",
        caption: "",
        order: 0,
        name: "p.jpg",
        original: new Blob([new Uint8Array([1])], { type: "image/jpeg" }),
        compressed: new Blob([new Uint8Array([1])], { type: "image/jpeg" }),
        width: 1,
        height: 1,
        createdAt: r.createdAt,
      }),
    );
    expect(displayNo(r)).toBe("INSP-SP-001");
    const renamed = { ...r, element: "SP-002" };
    await db.inspections.put(renamed);
    expect(displayNo(renamed)).toBe("INSP-SP-002");
    expect(renamed.id).toBe(r.id);
    const photos = await listPhotoViews(r.id);
    expect(photos.map((p) => [p.id, p.itemId])).toEqual([
      ["photo-1", "toe-level"],
    ]);
  });
});
