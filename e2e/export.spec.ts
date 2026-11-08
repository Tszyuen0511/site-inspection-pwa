import { test, expect, type Download } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { workspaceNav } from "./navigation";

test("select several inspections, see readiness, and export one organised ZIP plus backup", async ({
  page,
}, info) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: /^Inspection records/ }),
  ).toBeVisible();
  await workspaceNav(
    page,
    info.project.name.startsWith("mobile") ? "Records" : "Inspection records",
  );
  // Demo records have no photos or plans, so each shows what is missing.
  const row = page.locator(".record-list-row", { hasText: "SP-002" });
  await expect(row.locator(".readiness")).toContainText("No photographs");
  await page.getByRole("button", { name: "Select to export" }).click();
  const toolbar = page.getByRole("toolbar", { name: "Export selection" });
  await expect(toolbar.getByRole("status")).toHaveText("0 selected");
  await page
    .getByRole("button", { name: "Select SP-002", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select SP-001", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Select SP-001", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(toolbar.getByRole("status")).toHaveText("2 selected");
  await toolbar.getByRole("button", { name: "Export 2" }).click();
  const dialog = page.getByRole("dialog", { name: "Export 2 inspections" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Prepare export" }).click();
  await expect(
    dialog.getByRole("list", { name: "Files ready to save" }),
  ).toBeVisible({ timeout: 30000 });
  // Headless browsers have no share sheet, so Download is offered.
  const downloads: Download[] = [];
  page.on("download", (d) => downloads.push(d));
  await dialog.getByRole("button", { name: "Download" }).click();
  await expect.poll(() => downloads.length).toBe(2);
  const names = downloads.map((d) => d.suggestedFilename()).sort();
  expect(names[0]).toMatch(/^Site-Inspections_\d{4}-\d{2}-\d{2}\.zip$/);
  expect(names[1]).toMatch(/backup/i);
  const bundle = downloads.find((d) =>
    d.suggestedFilename().startsWith("Site-Inspections"),
  )!;
  const zip = await JSZip.loadAsync(await readFile((await bundle.path())!));
  const files = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir)
    .sort();
  expect(files).toEqual([
    "Demo Geotechnical Works/SP-001/2026-10-30/INSP-SP-001.pdf",
    "Demo Geotechnical Works/SP-001/2026-10-30/INSP-SP-001_package.zip",
    "Demo Geotechnical Works/SP-002/2026-10-30/INSP-SP-002.pdf",
    "Demo Geotechnical Works/SP-002/2026-10-30/INSP-SP-002_package.zip",
  ]);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText(
    "Download requested for 2 inspections in 2 files.",
  );
});
