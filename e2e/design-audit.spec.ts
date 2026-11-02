import { editorTab, workspaceNav, toggleTheme } from "./navigation";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function audit(page: Page, screen: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
    `${screen} accessibility audit`,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    `${screen} fits the viewport`,
  ).toBe(true);
}
test("navy and orange design audit: contrast, touch targets, keyboard, forms and offline feedback", async ({
  page,
  context,
}, testInfo) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: /^Inspection records/ }),
  ).toBeVisible();
  if (testInfo.project.name === "mobile-webkit") {
    // iOS/WebKit keyboard link traversal depends on the device's Full Keyboard
    // Access preference; verify activation with explicit focus on this engine.
    await page.getByRole("link", { name: "Skip to content" }).focus();
  } else await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await audit(page, "Light overview");
  await page.screenshot({
    path: `test-results/ink-${testInfo.project.name}-overview.png`,
    fullPage: true,
  });
  await toggleTheme(page);
  await audit(page, "Dark overview");
  await toggleTheme(page);
  await page.getByRole("button", { name: "Open SP-002", exact: true }).click();
  for (const name of ["Pass", "Fail", "N/A"]) {
    const button = page
      .locator(".checklist-item")
      .first()
      .getByRole("button", { name, exact: true });
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(48);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  await audit(page, "Light checklist");
  await page.screenshot({
    path: `test-results/ink-${testInfo.project.name}-checklist.png`,
    fullPage: true,
  });
  await page.locator(".status-options").first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/ink-${testInfo.project.name}-controls.png`,
  });
  await page
    .locator(".checklist-item")
    .first()
    .getByRole("button", { name: "Fail", exact: true })
    .click();
  const remarks = page.getByLabel("Remarks * (required for failed items)");
  await expect(remarks).toHaveAttribute("aria-invalid", "true");
  await expect(remarks).toHaveAttribute("aria-describedby", /error/);
  await audit(page, "Failed item validation");
  await remarks.fill("Recorded observation needs follow-up.");
  await expect(
    page.getByText("Draft saved on this device", { exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByRole("status", { name: "Connection status" }),
  ).toHaveText("Offline");
  await audit(page, "Offline checklist");
  await toggleTheme(page);
  await audit(page, "Dark offline checklist");
  await page.screenshot({
    path: `test-results/ink-${testInfo.project.name}-checklist-dark.png`,
    fullPage: true,
  });
  await page.locator(".status-options").first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/ink-${testInfo.project.name}-controls-dark.png`,
  });
  await context.setOffline(false);
  await toggleTheme(page);
  await workspaceNav(
    page,
    testInfo.project.name.startsWith("mobile")
      ? "Records"
      : "Inspection records",
  );
  await audit(page, "Records");
  await page
    .getByRole("button", { name: "New inspection", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Create inspection", exact: true })
    .click();
  await expect(page.getByLabel("Element identification *")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await audit(page, "New inspection form with errors");
  await page.getByLabel("Close dialog", { exact: true }).click();
  await page.getByRole("button", { name: "Open SP-002", exact: true }).click();
  await editorTab(page, "Photos (0)");
  await page
    .getByLabel("Select photographs")
    .setInputFiles("public/icons/icon-192.png");
  await expect(page.locator(".photo-card")).toHaveCount(1);
  await audit(page, "Photos");
  await page.getByRole("button", { name: "Preview P01", exact: true }).click();
  await audit(page, "Full-screen photo dialog");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Close photograph", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Full-screen photograph" }),
  ).not.toBeVisible();
  await editorTab(page, "Report");
  await expect(
    page.locator('canvas[data-rendered="true"]').first(),
  ).toBeVisible();
  await audit(page, "Report preview");
  await workspaceNav(page, "Settings");
  await audit(page, "Settings");
  if (testInfo.project.name.startsWith("mobile")) {
    await page.setViewportSize({ width: 320, height: 740 });
    await audit(page, "320px settings");
    await page.getByRole("button", { name: "Records", exact: true }).click();
    await page
      .getByRole("button", { name: "Open SP-002", exact: true })
      .click();
    await audit(page, "320px checklist");
    for (const name of ["Pass", "Fail", "N/A"]) {
      const box = await page
        .locator(".checklist-item")
        .first()
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(48);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
  }
});
