import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { editorTab, workspaceNav } from "./navigation";

const DB = "site-inspection-v1";
async function rawAll(page: Page, store: string) {
  return page.evaluate(
    ([name, store]) =>
      new Promise<any[]>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction(store).objectStore(store).getAll();
          req.onsuccess = () => (db.close(), resolve(req.result));
          req.onerror = () => reject(req.error);
        };
      }),
    [DB, store] as const,
  );
}
const regions = async (page: Page) =>
  (await rawAll(page, "annotations")).filter((a) => a.kind === "region");
async function openDraft(page: Page, element = "SP-002") {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: /^Inspection records/ }),
  ).toBeVisible();
  await workspaceNav(
    page,
    (page.viewportSize()?.width ?? 1280) <= 760
      ? "Records"
      : "Inspection records",
  );
  await page.getByLabel("Search inspections").fill(element);
  await page
    .getByRole("button", { name: `Open ${element}`, exact: true })
    .click();
  await expect(page.locator(".inspection-editor")).toBeVisible();
}
async function openPlans(page: Page) {
  const side = page
    .getByRole("navigation", { name: "Inspection sections" })
    .getByRole("button", { name: "Plans" });
  if (await side.isVisible()) await side.click();
  else {
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Inspection menu", exact: true })
      .getByRole("button", { name: "Plans", exact: true })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "Plans", exact: true }),
  ).toBeVisible();
}
const viewer = (page: Page) => page.locator(".plans-viewer");
const region = (page: Page) =>
  page.locator(".plans-viewer .plan-region:not(.draft) .stroke rect");
/** Drags across the viewer between two fractions of its size. */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  // Mouse events only reach what is on screen: bring the whole viewer into view.
  await viewer(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = (await viewer(page).boundingBox())!;
  await page.mouse.move(
    box.x + box.width * from[0],
    box.y + box.height * from[1],
  );
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], {
    steps: 8,
  });
  await page.mouse.up();
}
/** Drawing-relative top-left corner of the region as currently drawn. */
async function screenRel(page: Page) {
  const img = (await page.locator(".plans-image").boundingBox())!;
  const r = (await region(page).boundingBox())!;
  return { x: (r.x - img.x) / img.width, y: (r.y - img.y) / img.height };
}

test("one location region: place, replace, zoom, pan, move, reload, remove and print", async ({
  page,
}) => {
  await openDraft(page);
  await openPlans(page);
  // There is no per-item mark selector any more.
  await expect(page.getByText("Checklist item for marks")).toHaveCount(0);
  await page
    .getByLabel("Upload drawing")
    .setInputFiles("e2e/fixtures/plan.png");
  await expect(page.locator(".plans-image")).toBeVisible();
  await page.getByRole("button", { name: "Place Region" }).click();
  await drag(page, [0.3, 0.3], [0.5, 0.55]);
  await expect(region(page)).toBeVisible();
  await expect.poll(async () => (await regions(page)).length).toBe(1);
  // Drawing again replaces the region; there is still only one.
  await page.getByRole("button", { name: "Place Region" }).click();
  await drag(page, [0.55, 0.4], [0.7, 0.6]);
  await expect
    .poll(async () => (await regions(page))[0]?.x ?? 0)
    .toBeGreaterThan(0.45);
  expect(await regions(page)).toHaveLength(1);
  await expect(region(page)).toHaveCount(1);
  const [stored] = await regions(page);
  expect(stored.itemId).toBeUndefined();
  // Zoom and pan: the region stays on the same drawing point.
  await page.getByRole("button", { name: "Navigate" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await drag(page, [0.1, 0.9], [0.2, 0.8]);
  const zoomed = await screenRel(page);
  expect(Math.abs(zoomed.x - stored.x)).toBeLessThan(0.01);
  expect(Math.abs(zoomed.y - stored.y)).toBeLessThan(0.01);
  expect(await regions(page)).toHaveLength(1);
  await page.getByRole("button", { name: "Fit drawing to view" }).click();
  // Move the region by dragging it.
  await viewer(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
  const r = (await region(page).boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 - 50, r.y + r.height / 2 + 20, {
    steps: 6,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await regions(page))[0].x)
    .toBeLessThan(stored.x - 0.02);
  const moved = (await regions(page))[0];
  expect(moved.id).toBe(stored.id);
  // Reload: the region comes back at its stored position.
  await openDraft(page);
  await openPlans(page);
  await expect(region(page)).toBeVisible();
  const reloaded = await screenRel(page);
  expect(Math.abs(reloaded.x - moved.x)).toBeLessThan(0.01);
  // The PDF report shows the plan with the region and no legend, offline.
  await page.context().setOffline(true);
  await editorTab(page, "Report");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const pdf = (await readFile((await (await pending).path())!)).toString(
    "latin1",
  );
  expect(pdf).toContain("Location Plan");
  expect(pdf).toContain("0.86 0.15 0.15 RG");
  expect(pdf).not.toContain("Legend");
  expect(pdf).not.toContain("turn the page clockwise");
  await page.context().setOffline(false);
  // Remove the region.
  await openPlans(page);
  await page.getByRole("button", { name: "Remove region" }).click();
  await page
    .getByRole("dialog", { name: "Remove the location region?" })
    .getByRole("button", { name: "Remove region", exact: true })
    .click();
  await expect.poll(async () => (await regions(page)).length).toBe(0);
  await expect(region(page)).toHaveCount(0);
});

test("multi-page PDF drawings, page selection and invalid files", async ({
  page,
}) => {
  await openDraft(page);
  await openPlans(page);
  await page.getByLabel("Upload drawing").setInputFiles("e2e/fixtures/bad.pdf");
  await expect(page.locator(".toast")).toContainText(
    "choose a PDF, JPEG, PNG or WebP",
  );
  expect(await rawAll(page, "drawings")).toHaveLength(0);
  await page
    .getByLabel("Upload drawing")
    .setInputFiles("e2e/fixtures/sheets.pdf");
  await expect(page.locator(".plans-image")).toBeVisible();
  const pageSelect = page.getByLabel("Page (of 3)");
  await pageSelect.selectOption("2");
  await expect(page.locator(".plans-viewer")).toHaveAttribute(
    "aria-label",
    /page 2 of 3/,
  );
  await page.getByRole("button", { name: "Place Region" }).click();
  await drag(page, [0.4, 0.4], [0.6, 0.6]);
  await expect(region(page)).toBeVisible();
  const [saved] = await regions(page);
  expect(saved.page).toBe(2);
  await expect(pageSelect.locator("option:checked")).toHaveText(
    /Page 2 · marked location/,
  );
  // On another page the region is not drawn, and the panel offers to show it.
  await pageSelect.selectOption("1");
  await expect(region(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Show region" }).click();
  await expect(region(page)).toBeVisible();
  // Drawing details use bracketed placeholders and save automatically.
  await page.locator(".plans-meta summary").click();
  await expect(page.getByLabel("Drawing number")).toHaveAttribute(
    "placeholder",
    "[Drawing number]",
  );
  await page.getByLabel("Drawing number").fill("DWG-TEST-01");
  await expect
    .poll(async () => (await rawAll(page, "drawings"))[0].number)
    .toBe("DWG-TEST-01");
});

test("keyboard placement, read-only records and save retry", async ({
  page,
}) => {
  await openDraft(page);
  await openPlans(page);
  await page
    .getByLabel("Upload drawing")
    .setInputFiles("e2e/fixtures/plan.png");
  await expect(page.locator(".plans-image")).toBeVisible();
  await page.getByRole("button", { name: "Place Region" }).click();
  // Storage failure: the region is not lost silently; Retry save completes it.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    (window as any).restoreAdd = () =>
      (IDBObjectStore.prototype.add = original);
    IDBObjectStore.prototype.add = function (
      ...args: Parameters<IDBObjectStore["add"]>
    ) {
      if (this.name === "annotations")
        throw new DOMException("Test storage full", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await viewer(page).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Your latest changes have not been saved."),
  ).toBeVisible();
  await page.evaluate(() => (window as any).restoreAdd());
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(region(page)).toBeVisible();
  const [saved] = await regions(page);
  expect(saved.x).toBeGreaterThan(0.2);
  expect(saved.x2).toBeLessThan(0.8);
  // Completed records are read-only until reopened.
  const record = (await rawAll(page, "inspections")).find(
    (r) => r.id === saved.inspectionId,
  );
  await page.evaluate(
    ([name, value]) =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => {
          const tx = open.result.transaction("inspections", "readwrite");
          tx.objectStore("inspections").put(value);
          tx.oncomplete = () => (open.result.close(), resolve());
        };
      }),
    [
      DB,
      { ...record, status: "Completed", updatedAt: new Date().toISOString() },
    ] as const,
  );
  await openDraft(page);
  // Completed before sign-off was removed: read-only, with a way to reopen.
  await expect(
    page.getByRole("button", { name: "Reopen to edit", exact: true }),
  ).toBeVisible();
  await openPlans(page);
  await expect(page.getByText(/Plans are read-only/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Highlight Pen" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Eraser" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Place Region" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Upload drawing" }),
  ).toHaveCount(0);
  await expect(region(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove region" })).toHaveCount(
    0,
  );
});

test("a region drag is saved even when the pointer is released before the screen updates", async ({
  page,
}) => {
  await openDraft(page);
  await openPlans(page);
  await page
    .getByLabel("Upload drawing")
    .setInputFiles("e2e/fixtures/plan.png");
  await expect(page.locator(".plans-image")).toBeVisible();
  await page.getByRole("button", { name: "Place Region" }).click();
  await drag(page, [0.35, 0.35], [0.5, 0.5]);
  await expect(region(page)).toBeVisible();
  await page.getByRole("button", { name: "Navigate" }).click();
  const [before] = await regions(page);
  // Down, move and up in one task: no React render can happen in between, as
  // on Safari when pointerup arrives before the last move has been drawn.
  await page.evaluate(() => {
    const el = document.querySelector<SVGElement>(
      ".plans-viewer .plan-region .fill rect",
    )!;
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2,
      y = r.y + r.height / 2;
    const at = (cx: number, cy: number, buttons: number) => ({
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      bubbles: true,
      clientX: cx,
      clientY: cy,
      buttons,
    });
    el.dispatchEvent(new PointerEvent("pointerdown", at(x, y, 1)));
    el.dispatchEvent(new PointerEvent("pointermove", at(x + 70, y + 30, 1)));
    el.dispatchEvent(new PointerEvent("pointerup", at(x + 70, y + 30, 0)));
  });
  await expect
    .poll(async () => (await regions(page))[0].x)
    .toBeGreaterThan(before.x + 0.02);
  const [after] = await regions(page);
  expect(after.id).toBe(before.id);
  expect(after.y).toBeGreaterThan(before.y);
});

const strokes = async (page: Page) =>
  (await rawAll(page, "annotations")).filter((a) => a.kind === "highlight");
const drawnStrokes = (page: Page) =>
  page.locator(".plans-viewer g.plan-highlight");

test("highlight pen: mouse and touch strokes, settings, zoom, reload, undo, erase, clear and print", async ({
  page,
}) => {
  await openDraft(page);
  await openPlans(page);
  await page
    .getByLabel("Upload drawing")
    .setInputFiles("e2e/fixtures/plan.png");
  await expect(page.locator(".plans-image")).toBeVisible();
  // Navigate mode never draws.
  await page.getByRole("button", { name: "Navigate" }).click();
  await drag(page, [0.3, 0.4], [0.6, 0.45]);
  expect(await strokes(page)).toHaveLength(0);
  // Mouse stroke with chosen colour, width and opacity.
  await page.getByRole("button", { name: "Highlight Pen" }).click();
  const settings = page.getByRole("group", { name: "Highlighter settings" });
  await settings.getByRole("radio", { name: "Blue" }).click();
  await settings.getByRole("radio", { name: "Large" }).click();
  await settings.locator('input[type="range"]').fill("0.45");
  await drag(page, [0.3, 0.4], [0.6, 0.45]);
  await expect.poll(async () => (await strokes(page)).length).toBe(1);
  const [first] = await strokes(page);
  expect(first).toMatchObject({ color: "blue", opacity: 0.45, width: 0.028 });
  expect(first.itemId).toBeUndefined();
  expect(first.points.length).toBeGreaterThan(3);
  // Touch stroke (finger or stylus), dispatched in one task like a fast swipe.
  await viewer(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".plans-viewer")!;
    const img = document.querySelector(".plans-image")!.getBoundingClientRect();
    const at = (u: number, v: number, buttons: number) => ({
      pointerId: 9,
      pointerType: "touch",
      isPrimary: true,
      bubbles: true,
      clientX: img.x + img.width * u,
      clientY: img.y + img.height * v,
      buttons,
    });
    el.dispatchEvent(new PointerEvent("pointerdown", at(0.2, 0.7, 1)));
    for (let i = 1; i <= 10; i++)
      el.dispatchEvent(
        new PointerEvent("pointermove", at(0.2 + i * 0.03, 0.7, 1)),
      );
    el.dispatchEvent(new PointerEvent("pointerup", at(0.5, 0.7, 0)));
  });
  await expect.poll(async () => (await strokes(page)).length).toBe(2);
  const touch = (await strokes(page)).find((s) => s.id !== first.id);
  expect(touch.points[0][0]).toBeCloseTo(0.2, 2);
  expect(touch.points[0][1]).toBeCloseTo(0.7, 2);
  await expect(drawnStrokes(page)).toHaveCount(2);
  // Zoomed in, the stroke is still drawn over the same drawing point.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  const rel = async () =>
    page.evaluate((id) => {
      const img = document
        .querySelector(".plans-image")!
        .getBoundingClientRect();
      const svg = document
        .querySelector(".plans-shapes")!
        .getBoundingClientRect();
      const [x, y] = document
        .querySelector(`[data-annotation-id="${id}"] polyline`)!
        .getAttribute("points")!
        .split(" ")[0]
        .split(",")
        .map(Number);
      return [
        (svg.x + x - img.x) / img.width,
        (svg.y + y - img.y) / img.height,
      ];
    }, touch.id);
  const [u, v] = await rel();
  expect(u).toBeCloseTo(touch.points[0][0], 3);
  expect(v).toBeCloseTo(touch.points[0][1], 3);
  await page.getByRole("button", { name: "Fit drawing to view" }).click();
  // Reload: both strokes come back.
  await openDraft(page);
  await openPlans(page);
  await expect(drawnStrokes(page)).toHaveCount(2);
  await expect(page.getByText("2 highlighter strokes")).toBeVisible();
  // Undo removes the latest stroke only.
  await page.getByRole("button", { name: "Highlight Pen" }).click();
  await page.getByRole("button", { name: "Undo stroke" }).click();
  await expect.poll(async () => (await strokes(page)).length).toBe(1);
  expect((await strokes(page))[0].id).toBe(first.id);
  // Eraser: tap a stroke to remove it.
  await page.getByRole("button", { name: "Eraser" }).click();
  await viewer(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
  const img = (await page.locator(".plans-image").boundingBox())!;
  const [px, py] = first.points[Math.floor(first.points.length / 2)];
  await page.mouse.click(img.x + img.width * px, img.y + img.height * py);
  await expect.poll(async () => (await strokes(page)).length).toBe(0);
  // Clear asks first, and keeps the region.
  await page.getByRole("button", { name: "Place Region" }).click();
  await drag(page, [0.35, 0.35], [0.5, 0.5]);
  await expect(region(page)).toBeVisible();
  await page.getByRole("button", { name: "Highlight Pen" }).click();
  await drag(page, [0.3, 0.6], [0.6, 0.62]);
  await drag(page, [0.3, 0.65], [0.6, 0.67]);
  await expect.poll(async () => (await strokes(page)).length).toBe(2);
  // The PDF plan page is landscape and carries the strokes and region.
  await editorTab(page, "Report");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const pdf = (await readFile((await (await pending).path())!)).toString(
    "latin1",
  );
  expect(pdf).toMatch(/\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/);
  expect(pdf.match(/1 J\s*1 j/g)).toHaveLength(2);
  expect(pdf).toContain("0.86 0.15 0.15 RG");
  await openPlans(page);
  await page.getByRole("button", { name: "Highlight Pen" }).click();
  await page.getByRole("button", { name: "Clear highlights" }).click();
  await page
    .getByRole("dialog", { name: "Clear all highlights?" })
    .getByRole("button", { name: "Clear highlights", exact: true })
    .click();
  await expect.poll(async () => (await strokes(page)).length).toBe(0);
  expect(await regions(page)).toHaveLength(1);
});
