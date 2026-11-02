import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  deleteInspection,
  repeatInspection,
  finalize,
  loadWorkspace,
  saveWorkspace,
} from "./db";
import { newInspection, templates, type Photo } from "./domain";
import { createBackup, importBackup } from "./backup";
import { toStoredPhoto, fromStoredPhoto } from "./photos";
import { details } from "./test-fixtures";
import { dailyReportDefaults } from "./daily-report";
beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
});
describe("local persistence", () => {
  it("saves a draft and resumes it after reopening IndexedDB", async () => {
    const r = newInspection(details, templates[0]);
    await db.inspections.add(r);
    db.close();
    await db.open();
    expect(await db.inspections.get(r.id)).toEqual(r);
  });
  it("refuses finalisation without required checklist responses", async () => {
    await expect(
      finalize(newInspection(details, templates[0])),
    ).rejects.toThrow("select");
  });
  it("round-trips a backup with image blobs and exact metadata", async () => {
    const r = newInspection(details, templates[0]);
    r.dailyReport = {
      ...dailyReportDefaults(r),
      reportNumber: "DAILY-BACKUP-001",
      activities: "Recorded site activities",
      staff: [{ occupation: "Inspector", company: "Test", people: "1" }],
    };
    r.responses["toe-level"].values = { measuredLevel: "-12.5000" };
    const p: Photo = {
      id: crypto.randomUUID(),
      inspectionId: r.id,
      itemId: "toe-level",
      caption: "Level record",
      order: 0,
      name: "level.jpg",
      original: new Blob([new Uint8Array([255, 216, 255, 217])], {
        type: "image/jpeg",
      }),
      compressed: new Blob([new Uint8Array([255, 216, 255, 217])], {
        type: "image/jpeg",
      }),
      width: 100,
      height: 50,
      createdAt: new Date().toISOString(),
      reportSection: "core",
      reportGroup: "BH-BACKUP-01",
    };
    await db.projects.add({
      id: details.projectId,
      name: details.projectName,
      reference: details.projectReference,
      fictional: false,
    });
    await db.templates.bulkAdd(templates);
    await db.inspections.add(r);
    await db.photos.add(await toStoredPhoto(p));
    const zip = await createBackup();
    await db.transaction("rw", db.tables, async () => {
      for (const t of db.tables) await t.clear();
    });
    expect(await importBackup(zip)).toBe(1);
    expect(await db.inspections.get(r.id)).toEqual(r);
    const stored = await db.photos.get(p.id);
    expect(stored?.itemId).toBe("toe-level");
    expect(stored?.reportSection).toBe("core");
    expect(stored?.reportGroup).toBe("BH-BACKUP-01");
    expect(await fromStoredPhoto(stored!).original.text()).toBe(
      await p.original.text(),
    );
    await expect(importBackup(zip)).rejects.toThrow("already exists");
    expect(await db.inspections.count()).toBe(1);
  });
  it("repeats with blank results and no photographs, preserving the source", async () => {
    const r = newInspection(details, templates[0]);
    await db.inspections.add(r);
    const id = crypto.randomUUID();
    await db.photos.add(
      await toStoredPhoto({
        id,
        inspectionId: r.id,
        itemId: "",
        caption: "",
        order: 0,
        name: "x.jpg",
        original: new Blob(["photo"]),
        compressed: new Blob(["photo"]),
        width: 1,
        height: 1,
        createdAt: r.createdAt,
      }),
    );
    r.responses["toe-level"].status = "Fail";
    r.responses["toe-level"].remarks = "Old failure";
    r.responses["toe-level"].values = { measuredLevel: "-12" };
    r.dailyReport = {
      ...dailyReportDefaults(r),
      weather: "Old weather",
      activities: "Old work",
    };
    await db.inspections.put(r);
    await saveWorkspace({
      inspector: { name: "Current Inspector", role: "ARE", company: "Test Co" },
    });
    const copy = await repeatInspection(r);
    expect(copy.responses["toe-level"]).toEqual({
      status: "Not Inspected",
      remarks: "",
      reference: "",
      values: {},
    });
    expect(copy.dailyReport).toBeUndefined();
    expect(copy.remarks).toBe("");
    expect(copy.inspector).toBe("Current Inspector");
    expect(copy.company).toBe("Test Co");
    expect(copy.date).not.toBe(r.date);
    expect(copy.id).not.toBe(r.id);
    expect(copy.template).toEqual(r.template);
    expect(await db.inspections.get(r.id)).toEqual(r);
    const photos = await db.photos
      .where("inspectionId")
      .equals(copy.id)
      .toArray();
    expect(photos).toHaveLength(0);
    await deleteInspection(r.id);
    expect(await db.photos.get(id)).toBeUndefined();
    expect(await db.inspections.get(copy.id)).toBeDefined();
  });
  it("surfaces storage write failures", async () => {
    const spy = vi
      .spyOn(db.inspections, "put")
      .mockRejectedValueOnce(
        new DOMException("Storage full", "QuotaExceededError"),
      );
    const r = newInspection(details, templates[0]);
    for (const response of Object.values(r.responses)) response.status = "Pass";
    await expect(finalize(r)).rejects.toThrow("Storage full");
    spy.mockRestore();
  });
  it("rejects invalid backup archives without modifying the database", async () => {
    await expect(importBackup(new Blob(["bad archive"]))).rejects.toThrow();
    expect(await db.inspections.count()).toBe(0);
  });
  it("restores configured templates over untouched defaults but preserves local customisations", async () => {
    const configured = structuredClone(templates[0]);
    configured.version = "1.1.0";
    configured.items[0].criteria = {
      text: "Actual project criterion supplied by the user",
      documentReference: "PROJECT-DOC-01 Rev A, clause 1",
    };
    await db.templates.add(configured);
    const backup = await createBackup();
    await db.templates.clear();
    await db.templates.bulkAdd(templates);
    await importBackup(backup);
    expect(await db.templates.get(configured.id)).toEqual(configured);
    await db.templates.put({ ...configured, version: "local-1.2.0" });
    await expect(importBackup(backup)).rejects.toThrow("template ID conflicts");
    expect((await db.templates.get(configured.id))?.version).toBe(
      "local-1.2.0",
    );
  });
});

it("round-trips profiles and project defaults without overwriting local settings", async () => {
  const project = {
    id: "p",
    name: "Project",
    reference: "P1",
    fictional: false,
    defaultLocation: "Zone B",
    defaultDrawing: "DWG-2",
  };
  await db.projects.add(project);
  const workspace = {
    inspector: { name: "Larry", role: "TCP T3", company: "WSP" },
    defaultProjectId: "p",
  };
  await saveWorkspace(workspace);
  db.close();
  await db.open();
  expect(await loadWorkspace()).toEqual(workspace);
  const backup = await createBackup();
  await db.projects.clear();
  await db.meta.clear();
  await importBackup(backup);
  expect(await loadWorkspace()).toEqual(workspace);
  expect(await db.projects.get("p")).toEqual(project);
  const current = {
    inspector: { name: "Another Inspector", role: "ARE", company: "Other" },
  };
  await saveWorkspace(current);
  await importBackup(backup);
  expect(await loadWorkspace()).toEqual(current);
});

it.each([1, 2, 3])(
  "imports legacy v%s backups without adding company to old inspections",
  async (version) => {
    const { default: JSZip } = await import("jszip");
    const record = newInspection(details, templates[0]);
    const zip = new JSZip();
    zip.file(
      "backup.json",
      JSON.stringify({
        format: "site-inspection-backup",
        version,
        exportedAt: new Date().toISOString(),
        projects: [
          {
            id: details.projectId,
            name: details.projectName,
            reference: details.projectReference,
            fictional: false,
          },
        ],
        inspections: [record],
        templates,
        photos: [],
      }),
    );
    await saveWorkspace({
      inspector: { name: "New Name", role: "ARE", company: "WSP" },
    });
    await importBackup(
      new Blob([await zip.generateAsync({ type: "arraybuffer" })]),
    );
    expect(await db.inspections.get(record.id)).toEqual(record);
    expect((await db.inspections.get(record.id))?.company).toBeUndefined();
    expect((await loadWorkspace()).inspector?.name).toBe("New Name");
  },
);
