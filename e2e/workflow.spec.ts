import { editorTab, workspaceNav, toggleTheme } from "./navigation";
import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
test("create, autosave, resume, validate, photos, PDF, ZIP and offline", async ({
  page,
  context,
}, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (e) => runtimeErrors.push(e.message));
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New inspection", exact: true })
    .first()
    .click();
  await page.getByLabel("Element identification *").fill("SP-E2E");
  await page.getByLabel("Location / chainage *").fill("Test zone");
  await page.getByLabel("Inspector name *").fill("QA Inspector");
  await page
    .getByRole("button", { name: "Create inspection", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Project details", exact: true }),
  ).toBeVisible();
  await page
    .locator(".checklist-item")
    .first()
    .getByRole("button", { name: "Pass", exact: true })
    .click();
  await expect(
    page.getByText("Draft saved on this device", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await workspaceNav(
    page,
    testInfo.project.name.startsWith("mobile")
      ? "Records"
      : "Inspection records",
  );
  await page.getByLabel("Search inspections").fill("SP-E2E");
  await page.getByRole("button", { name: "Open SP-E2E", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Checklist · 1 of 7 items",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page
    .getByLabel("General remarks", { exact: true })
    .fill("Updated details are retained.");
  await page.getByRole("button", { name: "Save details", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Inspection details", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Complete inspection", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "select an inspection status",
  );
  await page.getByLabel("Dismiss notification").click();
  for (let index = 1; index < 7; index++) {
    const section = page.locator(".checklist-item").nth(index);
    await section
      .getByRole("button", { name: index === 6 ? "Fail" : "Pass", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Complete inspection", exact: true })
    .click();
  await expect(page.locator(".toast-error")).toContainText("remark");
  await page.getByLabel("Dismiss notification").click();
  await page
    .getByLabel("Remarks * (required for failed items)")
    .fill("Recorded observation requires follow-up.");
  await editorTab(page, "Photos (0)");
  await page
    .getByLabel("Select photographs")
    .setInputFiles("public/icons/icon-192.png");
  await expect(page.locator(".photo-card")).toHaveCount(1);
  await page.getByLabel("Caption", { exact: true }).fill("Local test photo");
  await page.getByLabel("Related checklist item").selectOption("toe-level");
  await page.getByRole("button", { name: "Preview P01" }).click();
  await expect(
    page.getByRole("dialog", { name: "Full-screen photograph" }),
  ).toBeVisible();
  await page.getByLabel("Close photograph").click();
  await page
    .getByRole("combobox", { name: "Report section", exact: true })
    .selectOption("core");
  await page
    .getByLabel("Core log element / group", { exact: true })
    .fill("BH-E2E");
  await editorTab(page, "Report");
  await page
    .getByRole("button", { name: "Report details", exact: true })
    .click();
  await page
    .getByLabel("Daily site report number", { exact: true })
    .fill("DAILY-E2E-001");
  await page
    .getByLabel("5. Weather", { exact: true })
    .fill("Recorded sunny conditions");
  await page
    .getByRole("button", { name: "Add staff row", exact: true })
    .click();
  await page.getByLabel("Occupation", { exact: true }).fill("Site Engineer");
  await page.getByLabel("Company", { exact: true }).fill("Demo Supervision");
  await page.getByLabel("Number of people", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Add work row", exact: true }).click();
  await page.getByLabel("Work activity", { exact: true }).fill("Piling");
  await page
    .getByLabel("Element / borehole number", { exact: true })
    .fill("SP-E2E");
  await page
    .getByLabel("Progress of work", { exact: true })
    .fill("1.2500 m recorded");
  await page
    .getByRole("button", { name: "Save report details", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "Daily site report details",
      exact: true,
    }),
  ).not.toBeVisible();
  await editorTab(page, "Checklist");
  await page
    .getByRole("button", { name: "Complete inspection", exact: true })
    .click();
  await expect(
    page.locator(".header-identity").getByRole("status"),
  ).toContainText("Completed");
  await editorTab(page, "Report");
  await expect(
    page.getByRole("region", { name: "Inspection PDF preview" }),
  ).toBeVisible();
  await expect(
    page.locator('canvas[data-rendered="true"]').first(),
  ).toBeVisible();
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  expect((await pdfDownload).suggestedFilename()).toMatch(/\.pdf$/);
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP", exact: true }).click();
  const inspectionDownload = await zipDownload;
  expect(inspectionDownload.suggestedFilename()).toMatch(/\.zip$/);
  const packageZIP = await JSZip.loadAsync(
    await readFile((await inspectionDownload.path())!),
  );
  const dataFile = Object.keys(packageZIP.files).find((p) =>
    p.endsWith("/Inspection_Data.json"),
  )!;
  const data = JSON.parse(await packageZIP.file(dataFile)!.async("string"));
  expect(data.inspection.responses["corner-welding"].status).toBe("Fail");
  expect(data.photos[0].caption).toBe("Local test photo");
  expect(data.photos[0].itemId).toBe("toe-level");
  expect(data.photos[0].reportSection).toBe("core");
  expect(data.photos[0].reportGroup).toBe("BH-E2E");
  expect(data.inspection.dailyReport.reportNumber).toBe("DAILY-E2E-001");
  expect(data.inspection.dailyReport.workDone[0].progress).toBe(
    "1.2500 m recorded",
  );
  const photoPath = dataFile.replace(
    "Inspection_Data.json",
    data.photos[0].path,
  );
  expect(await packageZIP.file(photoPath)!.async("nodebuffer")).toEqual(
    await readFile("public/icons/icon-192.png"),
  );
  await expect(
    page.getByText("Preparing your inspection export…"),
  ).not.toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New inspection", exact: true })
    .first()
    .click();
  await page.getByLabel("Element identification *").fill("SP-OFFLINE");
  await page.getByLabel("Location / chainage *").fill("Offline zone");
  await page.getByLabel("Inspector name *").fill("Offline Inspector");
  await page
    .getByRole("button", { name: "Create inspection", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Project details", exact: true }),
  ).toBeVisible();
  await editorTab(page, "Photos (0)");
  await page
    .getByLabel("Select photographs")
    .setInputFiles("public/icons/icon-192.png");
  await expect(page.locator(".photo-card")).toHaveCount(1);
  await editorTab(page, "Report");
  await expect(
    page.getByRole("region", { name: "Inspection PDF preview" }),
  ).toBeVisible();
  await expect(
    page.locator('canvas[data-rendered="true"]').first(),
  ).toBeVisible();
  const offlineZip = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP", exact: true }).click();
  expect((await offlineZip).suggestedFilename()).toContain("SP-OFFLINE");
  await page.locator(".pdf-page").last().scrollIntoViewIfNeeded();
  await expect(
    page.locator(".pdf-page").last().locator("canvas"),
  ).toHaveAttribute("data-rendered", "true");
  if (await page.getByLabel("Dismiss notification").isVisible())
    await page.getByLabel("Dismiss notification").click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-report.png`,
    fullPage: true,
  });
  expect(runtimeErrors).toEqual([]);
});
test("backup restores records and photographs into a fresh browser profile", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("./");
  await page
    .getByRole("button", { name: "New inspection", exact: true })
    .first()
    .click();
  await page.getByLabel("Element identification *").fill("SP-BACKUP");
  await page.getByLabel("Location / chainage *").fill("Restore test zone");
  await page.getByLabel("Inspector name *").fill("Backup Inspector");
  await page
    .getByRole("button", { name: "Create inspection", exact: true })
    .click();
  await editorTab(page, "Photos (0)");
  await page
    .getByLabel("Select photographs")
    .setInputFiles("public/icons/icon-192.png");
  await expect(page.locator(".photo-card")).toHaveCount(1);
  await page
    .getByLabel("Caption", { exact: true })
    .fill("Preserved backup photo");
  await workspaceNav(page, "Settings");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export local backup", exact: true })
    .click();
  const backupPath = testInfo.outputPath("backup.zip");
  await (await downloadPromise).saveAs(backupPath);
  const fresh = await browser.newContext({
    baseURL: `http://127.0.0.1:4173${process.env.VITE_BASE_PATH || "/"}`,
    viewport: page.viewportSize()!,
  });
  const restored = await fresh.newPage();
  await restored.goto("./");
  await expect(
    restored.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await workspaceNav(restored, "Settings");
  await restored.getByLabel("Choose backup").setInputFiles(backupPath);
  await restored
    .getByRole("button", { name: "Import backup", exact: true })
    .last()
    .click();
  await expect(restored.locator(".toast")).toContainText(
    "Backup imported successfully",
  );
  await restored
    .getByRole("button", {
      name: testInfo.project.name.startsWith("mobile")
        ? "Records"
        : "Inspection records",
      exact: true,
    })
    .click();
  await restored.getByLabel("Search inspections").fill("SP-BACKUP");
  await restored
    .getByRole("button", { name: "Open SP-BACKUP", exact: true })
    .click();
  await editorTab(restored, "Photos (1)");
  await expect(restored.getByLabel("Caption", { exact: true })).toHaveValue(
    "Preserved backup photo",
  );
  await expect(restored.locator(".photo-image img")).toBeVisible();
  await fresh.close();
});

test("save failures block navigation until a successful retry", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator(".recent-row").filter({ hasText: "SP-002" }).click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "inspections")
        throw new DOMException("Test storage full", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  const item = page.locator(".checklist-item").nth(3);
  await item.getByRole("button", { name: "Pass", exact: true }).click();
  await expect(
    page.getByText("Your latest changes have not been saved."),
  ).toBeVisible();
  await workspaceNav(
    page,
    testInfo.project.name.startsWith("mobile")
      ? "Records"
      : "Inspection records",
  );
  await expect(
    page.getByRole("heading", { name: "Project details", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { restorePut: () => void }).restorePut(),
  );
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(
    page.getByText("Draft saved on this device", { exact: true }),
  ).toBeVisible();
  await workspaceNav(
    page,
    testInfo.project.name.startsWith("mobile")
      ? "Records"
      : "Inspection records",
  );
  await expect(
    page.getByRole("heading", { name: "Inspection records", exact: false }),
  ).toBeVisible();
});
test("responsive overview and dark mode", async ({ page }, testInfo) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-overview.png`,
    fullPage: true,
  });
  await toggleTheme(page);
  await expect(page.locator("html")).toHaveClass("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveClass("dark");
});
