import { test, expect } from "@playwright/test";
import { editorTab, workspaceNav } from "./navigation";

test("profile and project defaults persist; repeat clears results offline", async ({
  page,
  context,
}, info) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await workspaceNav(page, "Settings");
  await page.getByLabel("Profile inspector name *").fill("Phase One Inspector");
  await page.getByLabel("Profile inspector role *").fill("ARE");
  await page.getByLabel("Profile inspector company *").fill("Test Company");
  await page
    .getByLabel("Default project", { exact: true })
    .selectOption("demo-harbour");
  await page
    .getByRole("button", { name: "Save profile & defaults", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText(
    "Inspector profile and project default saved.",
  );
  await page
    .getByLabel("Edit Demo Harbour Improvement", { exact: true })
    .click();
  await page
    .getByLabel("Default location / chainage", { exact: true })
    .fill("Default Zone");
  await page
    .getByLabel("Default drawing / specification reference", { exact: true })
    .fill("DWG-PHASE1");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit project", exact: true }),
  ).not.toBeVisible();
  await page.reload();
  await workspaceNav(page, "Settings");
  await expect(page.getByLabel("Profile inspector name *")).toHaveValue(
    "Phase One Inspector",
  );
  await page
    .getByRole("button", { name: "New inspection", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Project *", { exact: true })).toHaveValue(
    "demo-harbour",
  );
  await expect(
    page.getByLabel("Inspector name *", { exact: true }),
  ).toHaveValue("Phase One Inspector");
  await expect(
    page.getByLabel("Inspector role *", { exact: true }),
  ).toHaveValue("ARE");
  await expect(
    page.getByLabel("Inspector company", { exact: true }),
  ).toHaveValue("Test Company");
  await expect(
    page.getByLabel("Location / chainage *", { exact: true }),
  ).toHaveValue("Default Zone");
  await expect(
    page.getByLabel("Drawing / specification reference", { exact: true }),
  ).toHaveValue("DWG-PHASE1");
  await page.getByLabel("Element identification *").fill("PHASE1-REPEAT");
  await page
    .getByLabel("General remarks", { exact: true })
    .fill("Old remarks to clear");
  await page
    .getByRole("button", { name: "Create inspection", exact: true })
    .click();
  await page
    .locator(".checklist-item")
    .first()
    .getByRole("button", { name: "Pass", exact: true })
    .click();
  await editorTab(page, "Photos (0)");
  await page
    .getByLabel("Select photographs")
    .setInputFiles("public/icons/icon-192.png");
  await expect(page.locator(".photo-card")).toHaveCount(1);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await workspaceNav(
    page,
    info.project.name.startsWith("mobile") ? "Records" : "Inspection records",
  );
  await page.getByLabel("Search inspections").fill("PHASE1-REPEAT");
  await page.getByLabel("Repeat PHASE1-REPEAT", { exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Checklist · 0 of 7 items",
      exact: true,
    }),
  ).toBeVisible();
  await editorTab(page, "Photos (0)");
  await expect(page.locator(".photo-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.getByLabel("General remarks", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByLabel("Inspector company", { exact: true }),
  ).toHaveValue("Test Company");
});
