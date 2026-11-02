import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { workspaceNav, editorTab } from "./navigation";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
async function create(
  page: import("@playwright/test").Page,
  element: string,
  template = false,
) {
  await page
    .getByRole("button", { name: "New inspection", exact: true })
    .first()
    .click();
  await page.getByLabel("Element identification *").fill(element);
  await page.getByLabel("Location / chainage *").fill("QA Zone");
  await page.getByLabel("Inspector name *").fill("Template Inspector");
  if (template)
    await page
      .getByLabel("Report template (optional)", { exact: true })
      .selectOption({ label: "GI daily defaults" });
  await page
    .getByRole("button", { name: "Create inspection", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Project details", exact: true }),
  ).toBeVisible();
}
test("report templates save safe defaults, apply to new inspections and remain available offline", async ({
  page,
  context,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await create(page, "TEMPLATE-SOURCE");
  await editorTab(page, "Report");
  await page
    .getByRole("button", { name: "Report details", exact: true })
    .click();
  await page
    .getByLabel("Supervision title", { exact: true })
    .fill("GI Supervision");
  await page.getByLabel("Contract period", { exact: true }).fill("90 days");
  await page
    .getByLabel("Daily site report number", { exact: true })
    .fill("OLD-REPORT-1");
  await page.getByLabel("5. Weather", { exact: true }).fill("Old site rain");
  await page
    .getByRole("button", { name: "Add staff row", exact: true })
    .click();
  await page.getByLabel("Occupation", { exact: true }).fill("Engineer");
  await page.getByLabel("Company", { exact: true }).fill("Test Company");
  await page.getByLabel("Number of people", { exact: true }).fill("4");
  await page
    .getByRole("button", { name: "Save report details", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "Daily site report details",
      exact: true,
    }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Save as template", exact: true })
    .click();
  await page
    .getByLabel("Report template name", { exact: true })
    .fill("GI daily defaults");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Save report template", exact: true }),
  ).not.toBeVisible();
  await workspaceNav(page, "Overview");
  await create(page, "TEMPLATE-TARGET", true);
  await editorTab(page, "Report");
  await page
    .getByRole("button", { name: "Report details", exact: true })
    .click();
  await expect(
    page.getByLabel("Supervision title", { exact: true }),
  ).toHaveValue("GI Supervision");
  await expect(page.getByLabel("Contract period", { exact: true })).toHaveValue(
    "90 days",
  );
  await expect(
    page.getByLabel("Daily site report number", { exact: true }),
  ).toHaveValue("");
  await expect(page.getByLabel("5. Weather", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Occupation", { exact: true })).toHaveValue(
    "Engineer",
  );
  await expect(
    page.getByLabel("Number of people", { exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("button", { name: "Save report details", exact: true })
    .click();
  await workspaceNav(page, "Exports");
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download complete backup", exact: true })
    .click();
  const zip = await JSZip.loadAsync(
    await readFile((await (await pending).path())!),
  );
  const backup = JSON.parse(await zip.file("backup.json")!.async("string"));
  expect(backup.version).toBe(4);
  expect(backup.reportTemplates[0].name).toBe("GI daily defaults");
  expect(backup.reportTemplates[0].defaults.staff[0]).toEqual({
    occupation: "Engineer",
    company: "Test Company",
  });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await workspaceNav(page, "Reports");
  await page
    .getByLabel("Saved report template", { exact: true })
    .selectOption(backup.reportTemplates[0].id);
  await expect(
    page.getByRole("button", { name: "Rename template", exact: true }),
  ).toBeEnabled();
  await workspaceNav(page, "Overview");
  await create(page, "TEMPLATE-OFFLINE", true);
  await editorTab(page, "Report");
  await expect(
    page.locator('canvas[data-rendered="true"]').first(),
  ).toBeVisible();
});
test("photo and report libraries group records, search captions and offer distinct exports", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await create(page, "LIBRARY-QA");
  await editorTab(page, "Photos (0)");
  await page
    .getByLabel("Select photographs")
    .setInputFiles("public/icons/icon-192.png");
  await expect(page.locator(".photo-card")).toHaveCount(1);
  await page
    .getByLabel("Caption", { exact: true })
    .fill("QA excavation photograph");
  await workspaceNav(page, "Photographs");
  await expect(
    page.getByRole("heading", { name: "Photographs", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Filter library project", { exact: true })
    .selectOption("demo-geo");
  await page
    .getByLabel("Search library inspections", { exact: true })
    .fill("LIBRARY-QA");
  await expect(page.locator(".library-record")).toHaveCount(1);
  await page.getByText("View photographs (1)", { exact: true }).click();
  await expect(
    page.getByRole("img", { name: "QA excavation photograph", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Search captions for LIBRARY-QA", { exact: true })
    .fill("no-match");
  await expect(page.locator(".library-thumb")).toHaveCount(0);
  await page
    .getByLabel("Search captions for LIBRARY-QA", { exact: true })
    .fill("excavation");
  await expect(page.locator(".library-thumb")).toHaveCount(1);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await workspaceNav(page, "Reports");
  await expect(
    page.getByRole("heading", { name: "Reports", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Search library inspections", { exact: true })
    .fill("LIBRARY-QA");
  const pdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/);
  await workspaceNav(page, "Exports");
  await expect(
    page.getByRole("heading", { name: "Complete backup", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Search library inspections", { exact: true })
    .fill("LIBRARY-QA");
  const zip = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Inspection ZIP", exact: true })
    .click();
  expect((await zip).suggestedFilename()).toMatch(/\.zip$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
});
