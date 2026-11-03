import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { addNumberedInspection, db } from "./db";
import {
  HIGHLIGHT_WIDTHS,
  newInspection,
  templates,
  type Drawing,
  type Inspection,
  type Photo,
} from "./domain";
import {
  addDrawing,
  addHighlight,
  clearHighlights,
  highlightStrokes,
  locationRegion,
  markingPage,
  reportPages,
  setLocationRegion,
  undoHighlight,
} from "./drawings";
import { createBackupVolumes, importBackup } from "./backup";
import { generatePDF } from "./export";
import { realRemark } from "./report-pdf";
import { details } from "./test-fixtures";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const wipe = () =>
  db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
beforeEach(wipe);
afterEach(() => vi.useRealTimers());

async function setup() {
  await db.projects.add({
    id: details.projectId,
    name: details.projectName,
    reference: details.projectReference,
    fictional: false,
  });
  return addNumberedInspection(newInspection(details, templates[0]));
}
const drawing = (r: Inspection, pages = 1) =>
  addDrawing(
    r.id,
    {
      name: pages > 1 ? "set.pdf" : "plan.png",
      type: pages > 1 ? "application/pdf" : "image/png",
      bytes: PNG.slice().buffer,
    },
    pages,
  );
const stroke = (
  r: Inspection,
  d: Drawing,
  points: [number, number][] = [
    [0.2, 0.3],
    [0.4, 0.35],
    [0.6, 0.3],
  ],
  page = 1,
) =>
  addHighlight({
    inspectionId: r.id,
    drawingId: d.id,
    page,
    points,
    color: "yellow",
    opacity: 0.3,
    width: HIGHLIGHT_WIDTHS.medium,
  });
const jpeg = () => new Uint8Array(readFileSync("src/test-image.jpg"));
const plansOf = async (width = 1600, height = 1000) => {
  const drawings = await db.drawings.toArray(),
    annotations = await db.annotations.toArray();
  return {
    drawings,
    annotations,
    pages: reportPages(drawings, annotations).map(({ drawing, page }) => ({
      drawing,
      page,
      jpeg: jpeg(),
      width,
      height,
    })),
  };
};

describe("highlighter strokes", () => {
  it("stores drawing-relative points and style, and keeps them after reopening", async () => {
    const r = await setup();
    const d = await drawing(r);
    const s = await stroke(r, d);
    expect(s).toMatchObject({
      kind: "highlight",
      points: [
        [0.2, 0.3],
        [0.4, 0.35],
        [0.6, 0.3],
      ],
      color: "yellow",
      opacity: 0.3,
      width: HIGHLIGHT_WIDTHS.medium,
    });
    expect(s.itemId).toBeUndefined();
    db.close();
    await db.open();
    expect(await db.annotations.get(s.id)).toEqual(s);
  });
  it("allows several strokes, undoes the latest and clears only highlights", async () => {
    const r = await setup();
    const d = await drawing(r);
    const region = await setLocationRegion({
      inspectionId: r.id,
      drawingId: d.id,
      page: 1,
      a: { x: 0.1, y: 0.1 },
      b: { x: 0.3, y: 0.3 },
    });
    const first = await stroke(r, d);
    await new Promise((ok) => setTimeout(ok, 5));
    const second = await stroke(r, d, [
      [0.5, 0.5],
      [0.7, 0.6],
    ]);
    expect(highlightStrokes(await db.annotations.toArray())).toHaveLength(2);
    expect((await undoHighlight(r.id))?.id).toBe(second.id);
    expect(
      highlightStrokes(await db.annotations.toArray()).map((s) => s.id),
    ).toEqual([first.id]);
    await stroke(r, d);
    expect(await clearHighlights(r.id)).toBe(2);
    const left = await db.annotations.toArray();
    expect(highlightStrokes(left)).toEqual([]);
    expect(locationRegion(left)).toEqual(region);
  });
  it("keeps every marking of the element on one drawing page", async () => {
    const r = await setup();
    const d = await drawing(r, 3);
    await stroke(r, d, undefined, 2);
    await expect(stroke(r, d, undefined, 3)).rejects.toThrow(
      "another drawing page",
    );
    await expect(
      setLocationRegion({
        inspectionId: r.id,
        drawingId: d.id,
        page: 1,
        a: { x: 0.1, y: 0.1 },
        b: { x: 0.2, y: 0.2 },
      }),
    ).rejects.toThrow("another drawing page");
    // The same page is fine, and the report prints that page.
    await setLocationRegion({
      inspectionId: r.id,
      drawingId: d.id,
      page: 2,
      a: { x: 0.1, y: 0.1 },
      b: { x: 0.2, y: 0.2 },
    });
    const all = await db.annotations.toArray();
    expect(markingPage(all)).toEqual({ drawingId: d.id, page: 2 });
    expect(reportPages([d], all).map((p) => p.page)).toEqual([2]);
  });
  it("prints the page that only has highlights", async () => {
    const r = await setup();
    const d = await drawing(r, 3);
    await stroke(r, d, undefined, 3);
    expect(
      reportPages([d], await db.annotations.toArray()).map((p) => p.page),
    ).toEqual([3]);
  });
  it("refuses strokes on a completed inspection", async () => {
    const r = await setup();
    const d = await drawing(r);
    await db.inspections.update(r.id, { status: "Completed" });
    await expect(stroke(r, d)).rejects.toThrow("read-only");
  });
  it("rejects invalid strokes", async () => {
    const r = await setup();
    const d = await drawing(r);
    await expect(stroke(r, d, [[0.2, 0.2]])).rejects.toThrow();
    await expect(
      stroke(r, d, [
        [0.2, 0.2],
        [1.4, 0.2],
      ]),
    ).rejects.toThrow();
  });
  it("round-trips strokes through backup and restore", async () => {
    const r = await setup();
    const d = await drawing(r);
    const s = await stroke(r, d);
    const { files } = await createBackupVolumes();
    await wipe();
    await importBackup(files[0].blob);
    expect(await db.annotations.get(s.id)).toEqual(s);
  });
});

describe("highlighter strokes in the PDF", () => {
  // Path start and points in PDF points, plus the drawing's border box.
  const parse = (pdf: string) => {
    const plan = pdf.slice(pdf.indexOf("Location Plan"));
    const box = /0\.70866\d* w\s*([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re/
      .exec(plan)!
      .slice(1, 5)
      .map(Number);
    const path =
      /RG\s*([\d.]+) w\s*1 J\s*1 j\s*([\d.]+) ([\d.]+) m\s*((?:[\d.]+ [\d.]+ l\s*)+)S/.exec(
        plan,
      )!;
    const points = [
      [Number(path[2]), Number(path[3])],
      ...[...path[4].matchAll(/([\d.]+) ([\d.]+) l/g)].map((m) => [
        Number(m[1]),
        Number(m[2]),
      ]),
    ];
    return { box, width: Number(path[1]), points };
  };
  it("draws each stroke at its drawing position with its width and opacity", async () => {
    for (const [w, h] of [
      [1600, 1000],
      [1000, 1600],
    ]) {
      await wipe();
      const r = await setup();
      const d = await drawing(r);
      await stroke(r, d);
      const pdf = await (
        await generatePDF(r, [], undefined, await plansOf(w, h))
      ).text();
      expect(pdf).toContain("/CA 0.3");
      expect(pdf).toContain("0.98 0.8 0.08 RG");
      const { box, width, points } = parse(pdf);
      const rel = points.map(([x, y]) => [
        (x - box[0]) / box[2],
        (box[1] - y) / -box[3],
      ]);
      [
        [0.2, 0.3],
        [0.4, 0.35],
        [0.6, 0.3],
      ].forEach(([u, v], i) => {
        expect(rel[i][0]).toBeCloseTo(u, 3);
        expect(rel[i][1]).toBeCloseTo(v, 3);
      });
      // Width is a fraction of the printed drawing's width.
      expect(width / box[2]).toBeCloseTo(HIGHLIGHT_WIDTHS.medium, 4);
    }
  });
  it("prints strokes under the region, both on the landscape plan page", async () => {
    const r = await setup();
    const d = await drawing(r);
    await stroke(r, d);
    await stroke(r, d, [
      [0.3, 0.6],
      [0.5, 0.65],
    ]);
    await setLocationRegion({
      inspectionId: r.id,
      drawingId: d.id,
      page: 1,
      a: { x: 0.15, y: 0.2 },
      b: { x: 0.65, y: 0.7 },
    });
    const pdf = await (
      await generatePDF(r, [], undefined, await plansOf())
    ).text();
    const plan = pdf.slice(pdf.indexOf("Location Plan"));
    expect(plan.match(/1 J\s*1 j/g)).toHaveLength(2);
    expect(plan.indexOf("1 J")).toBeLessThan(plan.indexOf("0.86 0.15 0.15 RG"));
    const boxes = [
      ...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g),
    ].map((m) => (Number(m[1]) > Number(m[2]) ? "L" : "P"));
    expect(boxes).toEqual(["P", "L", "P"]);
  });
});

describe("report footer and photo remarks", () => {
  const footer = async (when: Date) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(when);
    const r = await setup();
    const text = await (await generatePDF(r, [])).text();
    vi.useRealTimers();
    return [...text.matchAll(/\((Generated[^)]*)\) Tj/g)].map((m) => m[1]);
  };
  it("prints the local generation date only, never shifted by UTC", async () => {
    // Late evening and just after midnight, in local time.
    expect(await footer(new Date(2026, 10, 3, 23, 50))).toEqual([
      "Generated: 2026/11/03 | Page 1 of 2",
      "Generated: 2026/11/03 | Page 2 of 2",
    ]);
    await wipe();
    expect((await footer(new Date(2026, 10, 4, 0, 10)))[0]).toBe(
      "Generated: 2026/11/04 | Page 1 of 2",
    );
  });
  it("numbers pages across mixed orientations", async () => {
    const r = await setup();
    const d = await drawing(r);
    await stroke(r, d);
    const image = new Blob([jpeg()], { type: "image/jpeg" });
    const photos: Photo[] = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      inspectionId: r.id,
      itemId: r.template.items[i % 3].id,
      caption: "",
      order: i,
      name: `p${i}.jpg`,
      original: image,
      compressed: image,
      width: i % 2 ? 3 : 4,
      height: i % 2 ? 4 : 3,
      createdAt: r.createdAt,
      remark: i === 2 ? "Real remark" : undefined,
    }));
    const pdf = await (
      await generatePDF(r, photos, undefined, await plansOf())
    ).text();
    const boxes = [
      ...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g),
    ].map((m) => (Number(m[1]) > Number(m[2]) ? "L" : "P"));
    expect(boxes).toEqual(["P", "L", "P", "P"]);
    const pages = [...pdf.matchAll(/Page (\d+) of (\d+)\) Tj/g)].map(
      (m) => `${m[1]}/${m[2]}`,
    );
    expect(pages).toEqual(["1/4", "2/4", "3/4", "4/4"]);
    expect(pdf).not.toMatch(/Generated[^)]*T\d\d:/);
  });
  it("treats blank and placeholder remarks as empty, keeping real ones", () => {
    for (const empty of [undefined, "", "   ", "Not recorded", " n/a ", "-"])
      expect(realRemark(empty)).toBe(false);
    for (const real of ["None found", "Not recorded at pile 3", "OK"])
      expect(realRemark(real)).toBe(true);
  });
});
