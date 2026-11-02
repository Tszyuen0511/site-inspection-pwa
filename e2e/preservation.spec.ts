import { test, expect, type Page } from "@playwright/test";
import JSZip from "jszip";
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
    page.getByRole("heading", { name: "Overview", exact: true }),
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
  await expect(
    page.getByText("Your first inspection starts here"),
  ).toBeVisible();
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
