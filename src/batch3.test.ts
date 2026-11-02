import { beforeEach, describe, expect, it } from "vitest";
import {
  db,
  findRemovableDemoData,
  removeDemoData,
  saveWorkspace,
  loadWorkspace,
  seed,
} from "./db";
import { newInspection, templates } from "./domain";
import { toStoredPhoto } from "./photos";
import { details } from "./test-fixtures";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
});

describe("removing demonstration data", () => {
  it("removes only unchanged seeded records and unused demo projects", async () => {
    await seed();
    const before = await db.inspections.count();
    expect(before).toBe(6);
    const found = await findRemovableDemoData();
    expect(found.records).toHaveLength(6);
    expect(found.projects.sort()).toEqual(["demo-geo", "demo-harbour"]);
    const result = await removeDemoData();
    expect(result).toMatchObject({ inspections: 6, projects: 2 });
    expect(result.removedIds).toHaveLength(6);
    expect(await db.inspections.count()).toBe(0);
    expect(await db.projects.count()).toBe(0);
    // Not re-seeded: the database is already initialised.
    await seed();
    expect(await db.inspections.count()).toBe(0);
  });
  it("keeps edited demo records, records with photos, and real work under a demo project", async () => {
    await seed();
    const edited = (await db.inspections.get("INSP-DEMO-0001"))!;
    await db.inspections.put({ ...edited, remarks: "I edited this" });
    const withPhoto = (await db.inspections.get("INSP-DEMO-0002"))!;
    await db.photos.add(
      await toStoredPhoto({
        id: crypto.randomUUID(),
        inspectionId: withPhoto.id,
        itemId: "",
        caption: "",
        order: 0,
        name: "x.jpg",
        original: new Blob(["a"]),
        compressed: new Blob(["a"]),
        width: 1,
        height: 1,
        createdAt: withPhoto.createdAt,
      }),
    );
    // Real work filed under the harbour demo project.
    const real = newInspection(
      { ...details, projectId: "demo-harbour" },
      templates[0],
    );
    await db.inspections.add(real);
    await saveWorkspace({ defaultProjectId: "demo-geo" });
    const result = await removeDemoData();
    expect(result.inspections).toBe(4);
    const left = (await db.inspections.toArray()).map((r) => r.id).sort();
    expect(left).toEqual(["INSP-DEMO-0001", "INSP-DEMO-0002", real.id].sort());
    // demo-geo still referenced by kept demo records; harbour by the real record.
    expect((await db.projects.toArray()).map((p) => p.id).sort()).toEqual([
      "demo-geo",
      "demo-harbour",
    ]);
    expect((await loadWorkspace()).defaultProjectId).toBe("demo-geo");
    // Once nothing keeps demo-geo, removal clears it as the default project.
    await db.inspections.delete("INSP-DEMO-0001");
    await db.inspections.delete("INSP-DEMO-0002");
    await db.photos.clear();
    await removeDemoData();
    expect((await db.projects.toArray()).map((p) => p.id)).toEqual([
      "demo-harbour",
    ]);
    expect((await loadWorkspace()).defaultProjectId).toBeUndefined();
  });
  it("does nothing once the seed fingerprints are gone (e.g. after a restore)", async () => {
    await seed();
    await db.meta.delete("seedRecords");
    await db.meta.delete("seedProjects");
    expect(await removeDemoData()).toMatchObject({
      inspections: 0,
      projects: 0,
    });
    expect(await db.inspections.count()).toBe(6);
  });
});
