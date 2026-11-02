import { beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import {
  addNumberedInspection,
  db,
  deleteInspection,
  finalize,
  repeatInspection,
} from "./db";
import {
  newInspection,
  templates,
  type Annotation,
  type Drawing,
  type Inspection,
} from "./domain";
import {
  addAnnotation,
  addDrawing,
  deleteAnnotation,
  deleteDrawing,
  reportPages,
  updateAnnotation,
} from "./drawings";
import { legendRows, markLabels, suffix } from "./plan-labels";
import { createBackupVolumes, importBackup, readBackup } from "./backup";
import { generatePackage, generatePDF } from "./export";
import { toStoredPhoto, listPhotoViews } from "./photos";
import { details } from "./test-fixtures";
import { packageName } from "./domain";
import { headerSize } from "./image-header";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const wipe = () =>
  db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
async function setup() {
  await db.projects.add({
    id: details.projectId,
    name: details.projectName,
    reference: details.projectReference,
    fictional: false,
  });
  await db.templates.bulkAdd(templates);
  return addNumberedInspection(newInspection(details, templates[0]));
}
const drawing = (r: Inspection, pages = 1, name = "plan.png") =>
  addDrawing(
    r.id,
    {
      name,
      type: pages > 1 ? "application/pdf" : "image/png",
      bytes: PNG.slice().buffer,
    },
    pages,
  );
const mark = (r: Inspection, d: Drawing, itemId: string, page = 1, x = 0.5) =>
  addAnnotation({
    inspectionId: r.id,
    drawingId: d.id,
    page,
    kind: "marker",
    itemId,
    x,
    y: 0.5,
  });
beforeEach(wipe);

describe("checklist-aligned mark labels", () => {
  it("uses the item number, with A/B/C suffixes only when an item has several marks", async () => {
    const r = await setup();
    const [i1, i2, i3] = r.template.items;
    const d1 = await drawing(r),
      d2 = await drawing(r, 3, "set.pdf");
    const a = await mark(r, d1, i1.id),
      b = await mark(r, d1, i2.id),
      c = await mark(r, d2, i1.id, 2),
      e = await mark(r, d2, i3.id, 1);
    const all = await db.annotations.toArray(),
      drawings = await db.drawings.toArray();
    const labels = markLabels(r.template.items, all, drawings);
    expect(labels.get(a.id)?.label).toBe("1A");
    expect(labels.get(c.id)?.label).toBe("1B");
    expect(labels.get(b.id)?.label).toBe("2");
    expect(labels.get(e.id)?.label).toBe("3");
    // Every complete label is unique across drawings and pages.
    const values = [...labels.values()].map((l) => l.label);
    expect(new Set(values).size).toBe(values.length);
    expect(suffix(0)).toBe("A");
    expect(suffix(25)).toBe("Z");
    expect(suffix(26)).toBe("AA");
  });
  it("follows checklist renumbering and custom items, keeping the stable item link", async () => {
    const r = await setup();
    const custom = {
      id: "custom-1",
      description: "[Custom item]",
      hint: "",
      fields: [],
    };
    const record: Inspection = {
      ...r,
      template: { ...r.template, items: [custom, ...r.template.items] },
      responses: {
        ...r.responses,
        [custom.id]: {
          status: "Fail",
          remarks: "Crack",
          reference: "",
          values: {},
        },
      },
    };
    const d = await drawing(r);
    const m = await mark(r, d, custom.id);
    const m2 = await mark(r, d, r.template.items[0].id);
    const rows = legendRows(record, await db.annotations.toArray(), [d]);
    expect(rows.map((x) => [x.label, x.item, x.status])).toEqual([
      ["1", "1. [Custom item]", "Fail"],
      ["2", `2. ${r.template.items[0].description}`, "Not Inspected"],
    ]);
    expect((await db.annotations.get(m.id))?.itemId).toBe("custom-1");
    expect(m2.itemId).toBe(r.template.items[0].id);
  });
  it("never re-attaches a mark whose item no longer exists", async () => {
    const r = await setup();
    const d = await drawing(r);
    const m = await mark(r, d, "removed-item");
    const labels = markLabels(r.template.items, [m], [d]);
    expect(labels.get(m.id)).toMatchObject({
      label: "?1",
      linked: false,
      itemId: "removed-item",
    });
    const [row] = legendRows(r, [m], [d]);
    expect(row.status).toBe("Unlinked");
    expect(row.item).toMatch(/no longer exists/);
  });
});

describe("drawing and annotation storage", () => {
  it("keeps original bytes separate and unchanged, and moves marks without changing links", async () => {
    const r = await setup();
    const d = await drawing(r);
    expect(new Uint8Array((await db.drawingFiles.get(d.id))!.bytes)).toEqual(
      PNG,
    );
    expect(Object.keys((await db.drawings.get(d.id))!)).not.toContain("bytes");
    const m = await mark(r, d, r.template.items[0].id, 1, 0.25);
    await updateAnnotation(m, { x: 0.75, y: 0.1 });
    expect(await db.annotations.get(m.id)).toMatchObject({
      x: 0.75,
      y: 0.1,
      itemId: m.itemId,
    });
    await expect(updateAnnotation(m, { x: 1.5 })).rejects.toThrow();
  });
  it("refuses edits on a completed inspection", async () => {
    const r = await setup();
    const d = await drawing(r);
    for (const i of r.template.items) r.responses[i.id].status = "Pass";
    await db.inspections.put(r);
    await finalize(r);
    await expect(mark(r, d, r.template.items[0].id)).rejects.toThrow(
      "read-only",
    );
    await expect(deleteDrawing(d)).rejects.toThrow("read-only");
    expect(await db.drawings.get(d.id)).toBeDefined();
  });
  it("deleting a mark or drawing unlinks its photos but keeps them with their item", async () => {
    const r = await setup();
    const d = await drawing(r);
    const m = await mark(r, d, "toe-level");
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
      type: "image/jpeg",
    });
    const photo = await toStoredPhoto({
      id: crypto.randomUUID(),
      inspectionId: r.id,
      itemId: "toe-level",
      markId: m.id,
      caption: "",
      order: 0,
      name: "p.jpg",
      original: jpeg,
      compressed: jpeg,
      width: 1,
      height: 1,
      createdAt: r.createdAt,
    });
    await db.photos.add(photo);
    await deleteAnnotation(m);
    const kept = await db.photos.get(photo.id);
    expect(kept?.itemId).toBe("toe-level");
    expect(kept?.markId).toBeUndefined();
    const m2 = await mark(r, d, "toe-level");
    await db.photos.update(photo.id, { markId: m2.id });
    await deleteDrawing(d);
    expect(await db.annotations.count()).toBe(0);
    expect(await db.drawingFiles.count()).toBe(0);
    expect((await db.photos.get(photo.id))?.markId).toBeUndefined();
  });
  it("deleting an inspection removes its drawings, files and annotations", async () => {
    const r = await setup();
    const d = await drawing(r);
    await mark(r, d, "toe-level");
    await deleteInspection(r.id);
    expect(await db.drawings.count()).toBe(0);
    expect(await db.drawingFiles.count()).toBe(0);
    expect(await db.annotations.count()).toBe(0);
  });
  it("a repeat inspection gets copies of the drawings and marks with new ids", async () => {
    const r = await setup();
    const d = await drawing(r);
    const m = await mark(r, d, "toe-level");
    const copy = await repeatInspection(r);
    const [d2] = await db.drawings
      .where("inspectionId")
      .equals(copy.id)
      .toArray();
    const [m2] = await db.annotations
      .where("inspectionId")
      .equals(copy.id)
      .toArray();
    expect(d2.id).not.toBe(d.id);
    expect(m2.id).not.toBe(m.id);
    expect(m2).toMatchObject({
      drawingId: d2.id,
      itemId: "toe-level",
      x: m.x,
      y: m.y,
    });
    expect(new Uint8Array((await db.drawingFiles.get(d2.id))!.bytes)).toEqual(
      PNG,
    );
    // The source is untouched.
    expect(await db.annotations.get(m.id)).toEqual(m);
  });
  it("prints every marked page, and page 1 of an unmarked drawing", async () => {
    const r = await setup();
    const a = await drawing(r, 4, "a.pdf"),
      b = await drawing(r);
    const m1 = await mark(r, a, "toe-level", 3);
    const m2 = await mark(r, a, "toe-level", 1);
    const pages = reportPages([a, b], [m1, m2] as Annotation[]);
    expect(pages.map((p) => [p.drawing.id, p.page])).toEqual([
      [a.id, 1],
      [a.id, 3],
      [b.id, 1],
    ]);
  });
});

describe("plans in backups", () => {
  it("round-trips drawings, files, annotations and photo-to-mark links", async () => {
    const r = await setup();
    const d = await drawing(r, 2, "set.pdf");
    const m = await mark(r, d, "toe-level", 2);
    await addAnnotation({
      inspectionId: r.id,
      drawingId: d.id,
      page: 2,
      kind: "text",
      x: 0.1,
      y: 0.1,
      text: "Gate",
    });
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
      type: "image/jpeg",
    });
    await db.photos.add(
      await toStoredPhoto({
        id: crypto.randomUUID(),
        inspectionId: r.id,
        itemId: "toe-level",
        markId: m.id,
        caption: "At mark",
        order: 0,
        name: "p.jpg",
        original: jpeg,
        compressed: jpeg,
        width: 1,
        height: 1,
        createdAt: r.createdAt,
      }),
    );
    const before = await db.annotations.toArray();
    const { files, excluded } = await createBackupVolumes();
    expect(excluded).toEqual([]);
    await wipe();
    expect(await importBackup(files[0].blob)).toBe(1);
    expect(await db.drawings.get(d.id)).toEqual(d);
    expect(new Uint8Array((await db.drawingFiles.get(d.id))!.bytes)).toEqual(
      PNG,
    );
    expect(
      (await db.annotations.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(before.sort((a, b) => a.id.localeCompare(b.id)));
    const [photo] = await listPhotoViews(r.id);
    expect(photo.markId).toBe(m.id);
  });
  it("still restores an older backup that has no drawing data", async () => {
    const r = await setup();
    const { files } = await createBackupVolumes();
    const zip = await JSZip.loadAsync(await files[0].blob.arrayBuffer());
    const json = JSON.parse(await zip.file("backup.json")!.async("string"));
    delete json.drawings;
    delete json.annotations;
    zip.file("backup.json", JSON.stringify(json));
    const old = await zip.generateAsync({ type: "blob" });
    await wipe();
    expect(await importBackup(old)).toBe(1);
    expect(await db.inspections.get(r.id)).toBeDefined();
    expect(await db.drawings.count()).toBe(0);
  });
  it("rejects a backup whose drawing file is missing or whose annotation points nowhere", async () => {
    const r = await setup();
    const d = await drawing(r);
    await mark(r, d, "toe-level");
    const { files } = await createBackupVolumes();
    const zip = await JSZip.loadAsync(await files[0].blob.arrayBuffer());
    zip.remove(`drawings/${d.id}/original`);
    await expect(
      readBackup(await zip.generateAsync({ type: "blob" })),
    ).rejects.toThrow("missing");
    const zip2 = await JSZip.loadAsync(await files[0].blob.arrayBuffer());
    const json = JSON.parse(await zip2.file("backup.json")!.async("string"));
    json.annotations[0].drawingId = crypto.randomUUID();
    zip2.file("backup.json", JSON.stringify(json));
    await expect(
      readBackup(await zip2.generateAsync({ type: "blob" })),
    ).rejects.toThrow("annotation");
  });
});

describe("plans in the PDF report and ZIP", () => {
  const plansFor = async (r: Inspection, landscape = true) => {
    const drawings = await db.drawings.toArray(),
      annotations = await db.annotations.toArray();
    const jpeg = new Uint8Array(readFileSync("src/test-image.jpg"));
    return {
      drawings,
      annotations,
      pages: reportPages(drawings, annotations).map(({ drawing, page }) => ({
        drawing,
        page,
        jpeg,
        width: landscape ? 1600 : 1000,
        height: landscape ? 1000 : 1600,
      })),
    };
  };
  it("adds a landscape plan page with marks, drawing details and the legend", async () => {
    const r = await setup();
    const d = await drawing(r, 3, "set.pdf");
    await db.drawings.update(d.id, {
      title: "Site layout",
      number: "DWG-101",
      revision: "B",
    });
    const [i1, i2] = r.template.items;
    await mark(r, d, i1.id, 2, 0.2);
    await mark(r, d, i1.id, 2, 0.4);
    await mark(r, d, i2.id, 2, 0.6);
    r.responses[i2.id].status = "Fail";
    r.responses[i2.id].remarks = "Defect";
    const pdf = await (
      await generatePDF(r, [], undefined, await plansFor(r))
    ).text();
    expect(pdf).toMatch(/\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/);
    for (const t of [
      "Location Plan",
      "Site layout",
      "DWG-101",
      "Rev. B",
      "Source page 2 of 3",
      "(1A)",
      "(1B)",
      "(2)",
      "Legend - Drawing 1, page 2",
      "Fail",
    ])
      expect(pdf).toContain(t);
    expect(pdf).toContain("4.   Site Photos");
  });
  it("uses bracketed placeholders for missing drawing details and keeps the report valid without plans", async () => {
    const r = await setup();
    await drawing(r);
    const pdf = await (
      await generatePDF(r, [], undefined, await plansFor(r, false))
    ).text();
    expect(pdf).toContain("[Drawing title]");
    expect(pdf).toContain("No marked locations on this page.");
    const plain = await (await generatePDF(r, [])).text();
    expect(plain).not.toContain("Location Plan");
    expect(plain).toContain("3.   Site Photos");
  });
  it("puts a long legend on its own page instead of shrinking the drawing", async () => {
    const r = await setup();
    const d = await drawing(r);
    for (let n = 0; n < 40; n++)
      await mark(r, d, r.template.items[n % 7].id, 1, (n + 1) / 42);
    const pdf = await (
      await generatePDF(r, [], undefined, await plansFor(r))
    ).text();
    expect(pdf).toContain("Legend continues on the next page.");
    expect(pdf).toContain("(1F)");
    expect(pdf).toContain("(7E)");
  });
  it("includes original drawings and labelled annotations in the inspection ZIP", async () => {
    const r = await setup();
    const d = await drawing(r);
    const m = await mark(r, d, "toe-level");
    const plans = await plansFor(r);
    const zip = await JSZip.loadAsync(
      await (
        await generatePackage(r, [], undefined, plans, [
          { drawing: d, bytes: PNG.slice().buffer },
        ])
      ).arrayBuffer(),
    );
    const base = packageName(r);
    const data = JSON.parse(
      await zip.file(`${base}/Inspection_Data.json`)!.async("string"),
    );
    expect(data.drawings[0].path).toMatch(/^Drawings\/D1_/);
    expect(
      new Uint8Array(
        await zip.file(`${base}/${data.drawings[0].path}`)!.async("uint8array"),
      ),
    ).toEqual(PNG);
    const index = r.template.items.findIndex((i) => i.id === "toe-level") + 1;
    expect(data.annotations).toEqual([{ ...m, label: String(index) }]);
  });
});

describe("review regressions", () => {
  it("returns to portrait pages after a landscape plan page", async () => {
    const r = await setup();
    const d = await drawing(r);
    for (let n = 0; n < 40; n++)
      await mark(r, d, r.template.items[n % 7].id, 1, (n + 1) / 42);
    const drawings = await db.drawings.toArray(),
      annotations = await db.annotations.toArray();
    const jpeg = new Uint8Array(readFileSync("src/test-image.jpg"));
    const pdf = await (
      await generatePDF(r, [], undefined, {
        drawings,
        annotations,
        pages: [{ drawing: d, page: 1, jpeg, width: 1600, height: 1000 }],
      })
    ).text();
    const boxes = [
      ...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g),
    ].map((m) => (Number(m[1]) > Number(m[2]) ? "L" : "P"));
    // Only the plan page is landscape; the legend pages and Site Photos that
    // follow it are portrait again.
    expect(boxes[1]).toBe("L");
    expect(boxes.filter((b) => b === "L")).toHaveLength(1);
    expect(boxes.length).toBeGreaterThanOrEqual(4);
  });
  it("does not let an unprinted non-Latin file name block the PDF", async () => {
    const r = await setup();
    const d = await drawing(r, 1, "图纸.png");
    const jpeg = new Uint8Array(readFileSync("src/test-image.jpg"));
    await expect(
      generatePDF(r, [], undefined, {
        drawings: [d],
        annotations: [],
        pages: [{ drawing: d, page: 1, jpeg, width: 10, height: 10 }],
      }),
    ).resolves.toBeInstanceOf(Blob);
  });
  it("orders legend suffixes A..Z then AA", async () => {
    const r = await setup();
    const d = await drawing(r);
    for (let n = 0; n < 28; n++)
      await mark(r, d, r.template.items[0].id, 1, (n + 1) / 30);
    const labels = legendRows(r, await db.annotations.toArray(), [d]).map(
      (x) => x.label,
    );
    expect(labels.slice(24)).toEqual(["1Y", "1Z", "1AA", "1AB"]);
  });
  it("does not mark validation errors as retryable storage failures", async () => {
    const r = await setup();
    const d = await drawing(r);
    const m = await mark(r, d, "toe-level");
    const error = await updateAnnotation(m, { x: 7 }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.retryablePhotoWrite).toBeUndefined();
  });
  it("reads image dimensions from file headers before decoding", () => {
    const read = (p: string) => new Uint8Array(readFileSync(p));
    expect(headerSize(read("e2e/fixtures/plan.png"), "image/png")).toEqual({
      w: 1600,
      h: 1000,
    });
    expect(headerSize(read("e2e/fixtures/plan.webp"), "image/webp")).toEqual({
      w: 1600,
      h: 1000,
    });
    expect(headerSize(read("src/test-image.jpg"), "image/jpeg")).toEqual({
      w: 1,
      h: 1,
    });
  });
});
