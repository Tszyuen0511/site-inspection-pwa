import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import AxeBuilder from "@axe-core/playwright";
import { editorTab, workspaceNav } from "./navigation";

test("inline batch photos, native capture, caption saving, custom items and printable PDF offline", async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (testInfo.project.name === "desktop-chromium")
    await page.setViewportSize({ width: 1280, height: 900 });
  else await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.locator(".recent-row").filter({ hasText: "SP-002" }).click();
  await page.getByLabel("Project name", { exact: true }).fill("[Project name]");
  await page
    .getByLabel("Location / zone", { exact: true })
    .fill("[Area or chainage]");
  await page.getByLabel("Inspector", { exact: true }).fill("[Name]");
  const first = page.locator(".checklist-item").first();
  await first
    .getByLabel("Upload photos for setting-out-trench", { exact: true })
    .setInputFiles({
      name: "invalid.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("invalid"),
    });
  await expect(page.getByRole("alert")).toContainText(
    "choose a JPEG, PNG or WebP image",
  );
  await expect(
    page.getByText("Draft saved on this device", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry save", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Dismiss notification").click();
  await first
    .getByLabel("Upload photos for setting-out-trench", { exact: true })
    .setInputFiles([
      "public/icons/icon-192.png",
      "public/icons/icon-512.png",
      "src/test-image.jpg",
    ]);
  await expect(first.locator(".item-thumb")).toHaveCount(3);
  await first
    .getByLabel("Caption for P03", { exact: true })
    .fill("[Photo caption]");
  // Export immediately after typing: the caption transaction must finish first.
  const firstPDF = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save as PDF", exact: true }).click();
  const pdf = await firstPDF;
  await pdf.saveAs(testInfo.outputPath("inline-report.pdf"));
  expect((await readFile((await pdf.path())!)).subarray(0, 5).toString()).toBe(
    "%PDF-",
  );
  const chooserEvent = page.waitForEvent("filechooser");
  await first
    .getByRole("button", {
      name: "Add photos to setting-out-trench",
      exact: true,
    })
    .click();
  const chooser = await chooserEvent;
  if (testInfo.project.name.startsWith("mobile"))
    expect(await chooser.element().getAttribute("capture")).toBe("environment");
  else expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles("src/test-image.jpg");
  await expect(first.locator(".item-thumb")).toHaveCount(4);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restorePhotoPut: () => void }).restorePhotoPut =
      () => {
        IDBObjectStore.prototype.put = original;
      };
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "photos")
        throw new DOMException("Test photo storage full", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await first
    .getByLabel("Caption for P04", { exact: true })
    .fill("CAPTION_SAVED_BEFORE_NAVIGATION");
  await expect(
    page.getByText("Your latest changes have not been saved."),
  ).toBeVisible();
  await editorTab(page, "Report");
  await expect(
    page.getByRole("heading", { name: "Project details", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { restorePhotoPut: () => void }).restorePhotoPut(),
  );
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(
    page.getByText("Draft saved on this device", { exact: true }),
  ).toBeVisible();
  await first.getByRole("button", { name: "N/A", exact: true }).click();
  await expect(
    first.getByRole("button", { name: "N/A", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await first.getByRole("button", { name: "Select P03", exact: true }).click();
  await expect(
    first.getByLabel("Caption for P03", { exact: true }),
  ).toHaveValue("[Photo caption]");
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    a11y.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await first.getByRole("button", { name: "View P03", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Full-screen photograph" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Add inspection item", exact: true })
    .click();
  await page
    .getByLabel("Item name", { exact: true })
    .fill("[Additional inspection item]");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(page.locator(".checklist-item")).toHaveCount(8);
  await page
    .locator(".checklist-item")
    .last()
    .getByRole("button", { name: "Pass", exact: true })
    .click();
  await expect(
    page.getByText("Draft saved on this device", { exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await workspaceNav(
    page,
    testInfo.project.name.startsWith("mobile")
      ? "Records"
      : "Inspection records",
  );
  await page.getByRole("button", { name: "Open SP-002", exact: true }).click();
  await expect(first.locator(".item-thumb")).toHaveCount(4);
  await expect(
    first.getByLabel("Caption for P04", { exact: true }),
  ).toHaveValue("CAPTION_SAVED_BEFORE_NAVIGATION");
  await expect(page.locator(".checklist-item")).toHaveCount(8);
  // The photo strip scrolls internally, while the page stays inside the viewport.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const controls = await first
    .getByRole("button", { name: "N/A", exact: true })
    .boundingBox();
  expect(controls!.height).toBeGreaterThanOrEqual(48);
  if (testInfo.project.name === "desktop-chromium") {
    await expect(
      page.locator(".report-dock canvas[data-rendered=true]"),
    ).toBeVisible();
    const sidebar = await page.locator(".sidebar").boundingBox(),
      dock = await page.locator(".report-dock").boundingBox();
    expect(sidebar!.width).toBe(240);
    expect(dock!.width).toBe(340);
    const captionBox = await first
      .getByLabel("Caption for P04", { exact: true })
      .boundingBox();
    expect(captionBox!.width).toBeGreaterThan(300);
  }
  const addBox = await first
    .getByRole("button", {
      name: "Add photos to setting-out-trench",
      exact: true,
    })
    .boundingBox();
  expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.screenshot({
    path: `test-results/ink-${testInfo.project.name}-form.png`,
  });
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/ink-${testInfo.project.name}-photos.png`,
  });
  await editorTab(page, "Report");
  await expect(
    page.locator('canvas[data-rendered="true"]').first(),
  ).toBeVisible();
  const zipEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP", exact: true }).click();
  const zipDownload = await zipEvent;
  const zip = await JSZip.loadAsync(
    await readFile((await zipDownload.path())!),
  );
  const dataPath = Object.keys(zip.files).find((p) =>
    p.endsWith("/Inspection_Data.json"),
  )!;
  const data = JSON.parse(await zip.file(dataPath)!.async("string"));
  expect(data.photos).toHaveLength(4);
  expect(data.photos[3].caption).toBe("CAPTION_SAVED_BEFORE_NAVIGATION");
  expect(
    data.photos.every(
      (p: { itemId: string }) => p.itemId === "setting-out-trench",
    ),
  ).toBe(true);
  expect(data.inspection.responses["setting-out-trench"].status).toBe(
    "Not Applicable",
  );
  expect(data.inspection.template.items.at(-1).description).toBe(
    "[Additional inspection item]",
  );
  expect(
    data.inspection.responses[data.inspection.template.items.at(-1).id].status,
  ).toBe("Pass");
  expect(errors).toEqual([]);
});
