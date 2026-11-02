import { test, expect, type Page } from "@playwright/test";
import JSZip from "jszip";
import { editorTab, workspaceNav } from "./navigation";
import { readFile } from "node:fs/promises";

const DB = "site-inspection-v1";
// Raw IndexedDB access so the tests can create states the UI cannot.
async function rawPut(page: Page, store: string, value: unknown) {
  await page.evaluate(
    ([name, store, value]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).put(value);
          tx.oncomplete = () => (db.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
      }),
    [DB, store, value] as const,
  );
}
async function rawGetAll(page: Page, store: string) {
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
const overview = (page: Page) =>
  expect(
    page.getByRole("heading", { name: /^Inspection records/ }),
  ).toBeVisible();

test("a damaged record is reported, kept unchanged, and the app still opens", async ({
  page,
}, info) => {
  await page.goto("./");
  await overview(page);
  const [demo] = await rawGetAll(page, "inspections");
  const damaged = { ...demo, id: "INSP-DAMAGED", template: null };
  await rawPut(page, "inspections", damaged);
  await page.reload();
  await overview(page);
  await expect(page.getByTestId("integrity-banner")).toContainText(
    "failed validation",
  );
  const pending = page.waitForEvent("download");
  await page
    .getByTestId("integrity-banner")
    .getByRole("button", { name: "Download recovery data" })
    .click();
  const path = testPath(info, "recovery.zip");
  await (await pending).saveAs(path);
  const zip = await JSZip.loadAsync(await readFile(path));
  const raw = JSON.parse(
    await zip.file("raw/inspections.json")!.async("string"),
  );
  expect(raw.find((r: { id: string }) => r.id === "INSP-DAMAGED")).toEqual(
    damaged,
  );
  const stored = await rawGetAll(page, "inspections");
  expect(stored.find((r) => r.id === "INSP-DAMAGED")).toEqual(damaged);
});
const testPath = (info: { outputPath: (n: string) => string }, n: string) =>
  info.outputPath(n);

test("suspected storage loss does not hide itself behind demo data", async ({
  page,
}) => {
  await page.goto("./");
  await overview(page);
  await page.evaluate(() =>
    localStorage.setItem("inspection-had-user-data", new Date().toISOString()),
  );
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
    DB,
  );
  await page.reload();
  await expect(page.getByTestId("loss-banner")).toBeVisible();
  await expect(page.getByText("No inspections found")).toBeVisible();
  await expect(page.getByText("SP-001")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Start fresh with demonstration data" })
    .click();
  await expect(page.getByTestId("loss-banner")).toHaveCount(0);
  await expect(page.getByText("SP-001").first()).toBeVisible();
});

test("backup reminder appears for unbacked real work and clears after a verified export", async ({
  page,
}, info) => {
  await page.goto("./");
  await overview(page);
  await expect(page.getByTestId("backup-reminder")).toHaveCount(0);
  const [demo] = await rawGetAll(page, "inspections");
  await rawPut(page, "inspections", {
    ...demo,
    id: "INSP-REAL-1",
    fictional: false,
    updatedAt: new Date().toISOString(),
  });
  await page.reload();
  await overview(page);
  const reminder = page.getByTestId("backup-reminder");
  await expect(reminder).toContainText("not exported a backup yet");
  const pending = page.waitForEvent("download");
  await reminder.getByRole("button", { name: "Export backup now" }).click();
  const path = testPath(info, "backup.zip");
  await (await pending).saveAs(path);
  const zip = await JSZip.loadAsync(await readFile(path));
  const backup = JSON.parse(await zip.file("backup.json")!.async("string"));
  expect(
    backup.inspections.some((r: { id: string }) => r.id === "INSP-REAL-1"),
  ).toBe(true);
  await expect(page.locator(".toast")).toContainText("Backup verified");
  // The persistence note may remain (headless Chromium does not grant it);
  // the backup prompt itself must be gone.
  await expect(page.getByText("not exported a backup yet")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Export backup now" }),
  ).toHaveCount(0);
});

test("another tab's edit is never lost when two tabs edit one inspection", async ({
  page,
  context,
}, info) => {
  await page.goto("./");
  await overview(page);
  await page
    .getByRole("button", { name: "New inspection", exact: true })
    .first()
    .click();
  await page.getByLabel("Element identification *").fill("SP-CONFLICT");
  await page.getByLabel("Location / chainage *").fill("Conflict zone");
  await page.getByLabel("Inspector name *").fill("QA Inspector");
  await page
    .getByRole("button", { name: "Create inspection", exact: true })
    .click();
  const items = page.locator(".checklist-item");
  await expect(items.first()).toBeVisible();
  // Tab B opens the same record and records item 1.
  const other = await context.newPage();
  await other.goto("./");
  await overview(other);
  await workspaceNav(
    other,
    info.project.name.startsWith("mobile") ? "Records" : "Inspection records",
  );
  await other.getByLabel("Search inspections").fill("SP-CONFLICT");
  await other
    .getByRole("button", { name: "Open SP-CONFLICT", exact: true })
    .click();
  await other
    .locator(".checklist-item")
    .first()
    .getByRole("button", { name: "Pass", exact: true })
    .click();
  await expect(
    other.getByText("Draft saved on this device", { exact: true }),
  ).toBeVisible();
  // Tab A still holds the old copy and edits item 2.
  await items.nth(1).getByRole("button", { name: "Pass", exact: true }).click();
  // Either the stale tab already picked up B's edit through the live query and
  // merges cleanly, or it is blocked with a banner. In every case B's edit survives.
  await page.waitForTimeout(1500);
  const banner = page.getByTestId("conflict-banner");
  const readStatuses = async () => {
    const stored = (await rawGetAll(page, "inspections")).find(
      (r) => r.element === "SP-CONFLICT",
    );
    return stored.template.items.map(
      (i: { id: string }) => stored.responses[i.id].status,
    );
  };
  const statuses = await readStatuses();
  expect(statuses[0]).toBe("Pass");
  if (await banner.isVisible()) {
    await expect(banner).toContainText("Nothing has been overwritten");
    expect(statuses[1]).toBe("Not Inspected");
    await page
      .getByRole("button", {
        name: "Load the other version (discard my edits)",
      })
      .click();
    await expect(banner).toHaveCount(0);
  } else expect(statuses[1]).toBe("Pass");
});

test("a save is blocked, not silently overwritten, when the stored record changed behind the editor", async ({
  page,
}) => {
  await page.goto("./");
  await overview(page);
  await page
    .getByRole("button", { name: "New inspection", exact: true })
    .first()
    .click();
  await page.getByLabel("Element identification *").fill("SP-BLOCK");
  await page.getByLabel("Location / chainage *").fill("Block zone");
  await page.getByLabel("Inspector name *").fill("QA Inspector");
  await page
    .getByRole("button", { name: "Create inspection", exact: true })
    .click();
  const items = page.locator(".checklist-item");
  await expect(items.first()).toBeVisible();
  const find = async () =>
    (await rawGetAll(page, "inspections")).find(
      (r) => r.element === "SP-BLOCK",
    );
  const status = (r: any, n: number) =>
    r.responses[r.template.items[n].id].status;
  // Another writer changes the stored record. Raw IndexedDB writes are not seen by
  // the live query, so this editor is genuinely stale.
  const other = await find();
  other.responses[other.template.items[0].id].status = "Pass";
  other.updatedAt = new Date().toISOString();
  await rawPut(page, "inspections", other);
  await items.nth(1).getByRole("button", { name: "Pass", exact: true }).click();
  const banner = page.getByTestId("conflict-banner");
  await expect(banner).toContainText("Nothing has been overwritten");
  const blocked = await find();
  expect(status(blocked, 0)).toBe("Pass");
  expect(status(blocked, 1)).toBe("Not Inspected");
  await page
    .getByRole("button", { name: "Keep my version (overwrite the other)" })
    .click();
  await expect(banner).toHaveCount(0);
  await expect.poll(async () => status(await find(), 1)).toBe("Pass");
});

test("Exported status is only set after the user confirms the file was saved", async ({
  page,
}, info) => {
  await page.goto("./");
  await overview(page);
  await workspaceNav(
    page,
    info.project.name.startsWith("mobile") ? "Records" : "Inspection records",
  );
  await page.getByLabel("Search inspections").fill("SP-001");
  await page.getByRole("button", { name: "Open SP-001", exact: true }).click();
  const status = async () =>
    (await rawGetAll(page, "inspections")).find(
      (r) => r.id === "INSP-DEMO-0001",
    ).status;
  expect(await status()).toBe("Completed");
  await editorTab(page, "Report");
  for (const choice of ["Not yet", "Mark as Exported"]) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export ZIP", exact: true }).click();
    await pending;
    const dialog = page.getByRole("dialog", {
      name: "Was the ZIP package saved?",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: choice, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (choice === "Not yet") expect(await status()).toBe("Completed");
  }
  await expect.poll(status).toBe("Exported");
});

test("demonstration data can be removed without touching anything else", async ({
  page,
}) => {
  await page.goto("./");
  await overview(page);
  await workspaceNav(page, "Settings");
  await page
    .getByRole("button", { name: "Remove demonstration data", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Remove demonstration data?",
  });
  await dialog
    .getByRole("button", { name: "Remove demonstration data" })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await rawGetAll(page, "inspections")).length)
    .toBe(0);
  await expect(page.locator("#demo-data")).toHaveCount(0);
  await page.reload();
  await overview(page);
  expect((await rawGetAll(page, "inspections")).length).toBe(0); // not re-seeded
});
