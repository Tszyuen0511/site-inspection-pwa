import { expect, type Page } from "@playwright/test";

/** The compact checklist keeps navigation in its phone menu / desktop sidebar. */
export async function editorTab(page: Page, label: string) {
  await expect(page.locator(".inspection-editor")).toBeVisible();
  const button = page
    .locator(".editor-tabs")
    .getByRole("button", { name: label, exact: true });
  if (await button.isVisible()) await button.click();
  else if ((page.viewportSize()?.width ?? 1280) <= 760) {
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Inspection menu", exact: true })
      .getByRole("button", { name: label, exact: true })
      .click();
  } else if (label.startsWith("Photos"))
    await page.getByRole("button", { name: "Photo log", exact: true }).click();
  else if (label === "Report")
    await page
      .getByRole("navigation", { name: "Inspection sections" })
      .getByRole("button", { name: "Report", exact: true })
      .click();
  else
    await page
      .getByRole("navigation", { name: "Inspection sections" })
      .getByRole("button", { name: /^Checklist/ })
      .click();
}

export async function workspaceNav(page: Page, label: string) {
  const visible = page.getByRole("button", { name: label, exact: true });
  if (await visible.isVisible()) await visible.click();
  else {
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Inspection menu", exact: true })
      .getByRole("button", { name: label, exact: true })
      .click();
  }
}

export async function toggleTheme(page: Page) {
  const button = page.getByRole("button", {
    name: "Toggle dark mode",
    exact: true,
  });
  if (await button.isVisible()) await button.click();
  else {
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Inspection menu", exact: true })
      .getByRole("button", { name: "Toggle dark mode", exact: true })
      .click();
  }
}
