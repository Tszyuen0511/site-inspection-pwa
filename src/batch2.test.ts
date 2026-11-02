import { beforeEach, describe, expect, it } from "vitest";
import {
  db,
  inspectionContentKey,
  SaveConflictError,
  saveIfUnchanged,
} from "./db";
import { newInspection, templates } from "./domain";
import { finalize } from "./db";
import { listPhotoViews, toStoredPhoto } from "./photos";
import { details } from "./test-fixtures";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
});

describe("write-conflict protection", () => {
  it("lets the only writer save repeatedly", async () => {
    const r = newInspection(details, templates[0]);
    await db.inspections.add(r);
    let base = inspectionContentKey(r);
    for (const remarks of ["a", "b", "c"]) {
      const next = { ...r, remarks, updatedAt: new Date().toISOString() };
      await saveIfUnchanged(next, base);
      base = inspectionContentKey(next);
    }
    expect((await db.inspections.get(r.id))?.remarks).toBe("c");
  });
  it("refuses to overwrite another tab's edit and writes nothing", async () => {
    const r = newInspection(details, templates[0]);
    await db.inspections.add(r);
    const base = inspectionContentKey(r);
    // Tab B saves first.
    const tabB = {
      ...r,
      remarks: "from tab B",
      updatedAt: "2099-01-01T00:00:00.000Z",
    };
    await saveIfUnchanged(tabB, base);
    // Tab A still holds the original base and tries to save.
    const tabA = {
      ...r,
      remarks: "from tab A",
      updatedAt: "2099-02-01T00:00:00.000Z",
    };
    await expect(saveIfUnchanged(tabA, base)).rejects.toBeInstanceOf(
      SaveConflictError,
    );
    expect(await db.inspections.get(r.id)).toEqual(tabB);
  });
  it("ignores updatedAt-only changes such as photo edits", async () => {
    const r = newInspection(details, templates[0]);
    await db.inspections.add(r);
    const base = inspectionContentKey(r);
    await db.inspections.update(r.id, {
      updatedAt: "2099-01-01T00:00:00.000Z",
    });
    const mine = {
      ...r,
      remarks: "mine",
      updatedAt: "2099-02-01T00:00:00.000Z",
    };
    await expect(saveIfUnchanged(mine, base)).resolves.toBeUndefined();
    expect((await db.inspections.get(r.id))?.remarks).toBe("mine");
  });
  it("treats a deleted record as a conflict instead of recreating it", async () => {
    const r = newInspection(details, templates[0]);
    await db.inspections.add(r);
    const base = inspectionContentKey(r);
    await db.inspections.delete(r.id);
    await expect(
      saveIfUnchanged({ ...r, remarks: "x" }, base),
    ).rejects.toBeInstanceOf(SaveConflictError);
    expect(await db.inspections.get(r.id)).toBeUndefined();
  });
  it("finalize respects the conflict check", async () => {
    const r = newInspection(details, templates[0]);
    for (const item of r.template.items) r.responses[item.id].status = "Pass";
    await db.inspections.add(r);
    const base = inspectionContentKey(r);
    await db.inspections.update(r.id, { remarks: "changed elsewhere" });
    await expect(finalize(r, base)).rejects.toBeInstanceOf(SaveConflictError);
    expect((await db.inspections.get(r.id))?.status).toBe("Draft");
    expect((await finalize(r)).status).toBe("Completed");
  });
  it("does not depend on property order or undefined fields", () => {
    const r = newInspection(details, templates[0]);
    const reordered = Object.fromEntries(
      Object.entries(r).reverse(),
    ) as typeof r;
    expect(inspectionContentKey({ ...reordered, gps: undefined })).toBe(
      inspectionContentKey(r),
    );
  });
});

describe("photo list for screens", () => {
  it("returns report images and original sizes, never the original bytes", async () => {
    const r = newInspection(details, templates[0]);
    await db.inspections.add(r);
    const id = crypto.randomUUID();
    await db.photos.add(
      await toStoredPhoto({
        id,
        inspectionId: r.id,
        itemId: "",
        caption: "c",
        order: 0,
        name: "x.jpg",
        original: new Blob([new Uint8Array(5000)], { type: "image/jpeg" }),
        compressed: new Blob([new Uint8Array(700)], { type: "image/jpeg" }),
        width: 10,
        height: 10,
        createdAt: r.createdAt,
      }),
    );
    const [view] = await listPhotoViews(r.id);
    expect(view.originalSize).toBe(5000);
    expect(view.compressed.size).toBe(700);
    expect("original" in view).toBe(false);
    expect(await db.photos.get(id)).toBeDefined();
    expect(await listPhotoViews("other")).toEqual([]);
  });
});
