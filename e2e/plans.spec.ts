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
async function place(page: Page, fx: number, fy: number) {
  const box = (await viewer(page).boundingBox())!;
  await viewer(page).click({
    position: { x: box.width * fx, y: box.height * fy },
  });
}
async function chooseItem(page: Page, n: number) {
  const select = page.locator(".plans-item-select select");
  const value = await select
    .locator("option")
    .nth(n - 1)
    .getAttribute("value");
  await select.selectOption(value!);
}
/** Drawing-relative position of a marker as currently drawn on screen. */
async function screenRel(page: Page, label: string) {
  const img = (await page.locator(".plans-image").boundingBox())!;
  const m = (await page
    .locator(`.plan-marker[aria-label^="Mark ${label}:"]`)
    .boundingBox())!;
  return {
    x: (m.x + m.width / 2 - img.x) / img.width,
    y: (m.y + m.height / 2 - img.y) / img.height,
  };
}
const marker = (page: Page, label: string) =>
  page.locator(`.plans-viewer .plan-marker[aria-label^="Mark ${label}:"]`);

test("marks follow the checklist, survive zoom, pan, move and reload, and print in the report", async ({
  page,
}) => {
  await openDraft(page);
  await openPlans(page);
  await page
    .getByLabel("Upload drawing")
    .setInputFiles("e2e/fixtures/plan.png");
  await expect(page.locator(".plans-image")).toBeVisible();
  await page.getByRole("button", { name: "Place mark" }).click();
  await chooseItem(page, 1);
  await place(page, 0.35, 0.4);
  await expect(marker(page, "1")).toBeVisible();
  await place(page, 0.6, 0.6);
  await chooseItem(page, 2);
  await place(page, 0.5, 0.3);
  // A second mark for item 1 turns its labels into 1A and 1B; item 2 stays "2".
  await expect(marker(page, "1A")).toBeVisible();
  await expect(marker(page, "1B")).toBeVisible();
  await expect(marker(page, "2")).toBeVisible();
  await expect
    .poll(async () => (await rawAll(page, "annotations")).length)
    .toBe(3);
  const stored = async (label: string) => {
    const rel = await screenRel(page, label);
    const all = await rawAll(page, "annotations");
    return all.reduce((best, a) =>
      Math.hypot(a.x - rel.x, a.y - rel.y) <
      Math.hypot(best.x - rel.x, best.y - rel.y)
        ? a
        : best,
    );
  };
  const a1 = await stored("1A");
  const before = await screenRel(page, "1A");
  expect(Math.abs(before.x - a1.x)).toBeLessThan(0.01);
  // Zoom and pan in navigation mode: the mark stays on the same drawing point.
  await page.getByRole("button", { name: "Navigate" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  const box = (await viewer(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.85, {
    steps: 5,
  });
  await page.mouse.up();
  const zoomed = await screenRel(page, "1A");
  expect(Math.abs(zoomed.x - a1.x)).toBeLessThan(0.01);
  expect(Math.abs(zoomed.y - a1.y)).toBeLessThan(0.01);
  // Panning in navigation mode never placed a mark.
  expect((await rawAll(page, "annotations")).length).toBe(3);
  await page.getByRole("button", { name: "Fit drawing to view" }).click();
  // Move mark 2 by dragging it.
  // Bring the mark to the middle of the screen first: on short phone screens it
  // can otherwise sit under the fixed header, which then receives the press.
  await marker(page, "2").evaluate((el) =>
    el.scrollIntoView({ block: "center", inline: "center" }),
  );
  const m2 = (await marker(page, "2").boundingBox())!;
  const before2 = await stored("2");
  await page.mouse.move(m2.x + m2.width / 2, m2.y + m2.height / 2);
  await page.mouse.down();
  await page.mouse.move(m2.x + m2.width / 2 + 60, m2.y + m2.height / 2 + 30, {
    steps: 6,
  });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await rawAll(page, "annotations")).find((a) => a.id === before2.id).x,
    )
    .toBeGreaterThan(before2.x + 0.02);
  const moved = (await rawAll(page, "annotations")).find(
    (a) => a.id === before2.id,
  );
  expect(moved.itemId).toBe(before2.itemId);
  // Reload: marks come back at their stored positions.
  await openDraft(page);
  await openPlans(page);
  await expect(marker(page, "1A")).toBeVisible();
  const reloaded = await screenRel(page, "2");
  expect(Math.abs(reloaded.x - moved.x)).toBeLessThan(0.01);
  // Delete mark 1B: the remaining item 1 mark is relabelled "1".
  await marker(page, "1B").click();
  const details =
    (page.viewportSize()?.width ?? 1280) < 1100
      ? page.getByRole("dialog")
      : page.locator(".plans-side");
  await details.getByRole("button", { name: "Delete mark" }).click();
  await page
    .getByRole("dialog", { name: "Delete this annotation?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(marker(page, "1")).toBeVisible();
  await expect(marker(page, "2")).toBeVisible();
  await expect(page.locator(".plans-viewer .plan-marker")).toHaveCount(2);
  // The PDF report has the plan page with both labels and the legend, offline.
  await page.context().setOffline(true);
  await editorTab(page, "Report");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const pdf = (await readFile((await (await pending).path())!)).toString(
    "latin1",
  );
  expect(pdf).toContain("Location Plan");
  expect(pdf).toContain("Legend - Drawing 1, page 1");
  expect(pdf).toContain("(1) Tj");
  expect(pdf).toContain("(2) Tj");
  expect(pdf).not.toContain("(1B) Tj");
  await page.context().setOffline(false);
});

test("multi-page PDF drawings, page selection, invalid files and photos taken at a mark", async ({
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
  await page.getByRole("button", { name: "Place mark" }).click();
  await chooseItem(page, 3);
  await place(page, 0.5, 0.5);
  await expect(marker(page, "3")).toBeVisible();
  const [mark] = await rawAll(page, "annotations");
  expect(mark.page).toBe(2);
  await expect(pageSelect.locator("option:checked")).toHaveText(
    /Page 2 · 1 annotation/,
  );
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
  // Photo from the selected mark links to its item and the mark.
  await page.getByRole("button", { name: "Navigate" }).click();
  await marker(page, "3").click();
  const scope =
    (page.viewportSize()?.width ?? 1280) < 1100
      ? page.getByRole("dialog")
      : page.locator(".plans-side");
  await scope
    .getByLabel("Add photographs for mark 3")
    .setInputFiles("src/test-image.jpg");
  await expect.poll(async () => (await rawAll(page, "photos")).length).toBe(1);
  const [photo] = await rawAll(page, "photos");
  expect(photo.markId).toBe(mark.id);
  expect(photo.itemId).toBe(mark.itemId);
  await expect(scope.getByText("1 at this mark")).toBeVisible();
});

test("keyboard placement, custom items, read-only records and save retry", async ({
  page,
}) => {
  await openDraft(page);
  // A custom checklist item becomes markable with its own number.
  await page
    .getByRole("button", { name: "Add inspection item", exact: true })
    .click();
  await page.getByLabel("Item name", { exact: true }).fill("[Custom item]");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(page.locator(".checklist-item")).toHaveCount(8);
  await openPlans(page);
  await page
    .getByLabel("Upload drawing")
    .setInputFiles("e2e/fixtures/plan.png");
  await expect(page.locator(".plans-image")).toBeVisible();
  await page.getByRole("button", { name: "Place mark" }).click();
  await chooseItem(page, 8);
  // Storage failure: the mark is not lost silently; Retry save completes it.
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
  await expect(marker(page, "8")).toBeVisible();
  const [mark] = await rawAll(page, "annotations");
  expect(mark.x).toBeGreaterThan(0.3);
  expect(mark.x).toBeLessThan(0.7);
  // Completed records are read-only until reopened.
  const record = (await rawAll(page, "inspections")).find(
    (r) => r.id === mark.inspectionId,
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
  await openPlans(page);
  await expect(page.getByText(/Plans are read-only/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Place mark" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Upload drawing" }),
  ).toHaveCount(0);
  await marker(page, "8").click();
  const scope =
    (page.viewportSize()?.width ?? 1280) < 1100
      ? page.getByRole("dialog")
      : page.locator(".plans-side");
  await expect(scope.getByText("Item 8: [Custom item]")).toBeVisible();
  await expect(scope.getByRole("button", { name: "Delete mark" })).toHaveCount(
    0,
  );
  if ((page.viewportSize()?.width ?? 1280) < 1100) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("a mark drag is saved even when the pointer is released before the screen updates", async ({
  page,
}) => {
  await openDraft(page);
  await openPlans(page);
  await page
    .getByLabel("Upload drawing")
    .setInputFiles("e2e/fixtures/plan.png");
  await expect(page.locator(".plans-image")).toBeVisible();
  await page.getByRole("button", { name: "Place mark" }).click();
  await chooseItem(page, 1);
  await place(page, 0.4, 0.5);
  await expect(marker(page, "1")).toBeVisible();
  await page.getByRole("button", { name: "Navigate" }).click();
  const [before] = await rawAll(page, "annotations");
  // Down, move and up in one task: no React render can happen in between, as
  // on Safari when pointerup arrives before the last move has been drawn.
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(
      '.plans-viewer .plan-marker[aria-label^="Mark 1:"]',
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
    .poll(async () => (await rawAll(page, "annotations"))[0].x)
    .toBeGreaterThan(before.x + 0.02);
  const [after] = await rawAll(page, "annotations");
  expect(after.itemId).toBe(before.itemId);
  expect(after.y).toBeGreaterThan(before.y);
});
