import { test, expect } from "@playwright/test";
import { editorTab, workspaceNav } from "./navigation";
test("GPS consent, weather snapshots, manual observations, offline persistence and clean repeat", async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 22.30123456,
    longitude: 114.17123456,
    accuracy: 15,
  });
  let requests = 0;
  await page.route(
    "https://api.met.no/weatherapi/locationforecast/2.0/compact?**",
    async (route) => {
      requests++;
      const now = new Date().toISOString();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { Expires: new Date(Date.now() + 600000).toUTCString() },
        body: JSON.stringify({
          properties: {
            meta: {
              updated_at: now,
              units: { air_temperature: "celsius", wind_speed: "m/s" },
            },
            timeseries: [
              {
                time: now,
                data: {
                  instant: {
                    details: {
                      air_temperature: 25,
                      wind_speed: 3,
                      relative_humidity: 70,
                    },
                  },
                  next_1_hours: { summary: { symbol_code: "cloudy" } },
                },
              },
            ],
          },
        }),
      });
    },
  );
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "WSP", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New inspection", exact: true })
    .first()
    .click();
  await page.getByLabel("Element identification *").fill("PHASE2-GPS");
  await page.getByLabel("Location / chainage *").fill("Manual Zone A");
  await page.getByLabel("Inspector name *").fill("QA Inspector");
  await page
    .getByRole("button", { name: "Create inspection", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "Location and weather",
    exact: true,
  });
  await expect(
    panel.getByRole("button", { name: "Fetch weather forecast", exact: true }),
  ).toBeDisabled();
  await panel
    .getByRole("button", { name: "Get location", exact: true })
    .click();
  await expect(panel.getByText(/GPS: 22.301235/)).toBeVisible();
  expect(requests).toBe(0);
  await panel.getByRole("checkbox").check();
  await panel
    .getByRole("button", { name: "Fetch weather forecast", exact: true })
    .click();
  await expect(panel.getByText(/Stored model forecast: cloudy/)).toBeVisible();
  expect(requests).toBe(1);
  await panel
    .getByLabel("Observed site weather (manual)")
    .fill("Observed drizzle at inspection location");
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
  const records = info.project.name.startsWith("mobile")
    ? "Records"
    : "Inspection records";
  await workspaceNav(page, records);
  await page.getByLabel("Search inspections").fill("PHASE2-GPS");
  await page.getByLabel("Open PHASE2-GPS", { exact: true }).click();
  await expect(panel.getByText(/Stored model forecast: cloudy/)).toBeVisible();
  await expect(panel.getByLabel("Observed site weather (manual)")).toHaveValue(
    "Observed drizzle at inspection location",
  );
  expect(requests).toBe(1);
  await editorTab(page, "Report");
  await expect(
    page.locator('canvas[data-rendered="true"]').first(),
  ).toBeVisible();
  await workspaceNav(page, records);
  await page.getByLabel("Search inspections").fill("PHASE2-GPS");
  await page.getByLabel("Repeat PHASE2-GPS", { exact: true }).click();
  await expect(
    panel.getByText("GPS: Not recorded", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("Forecast snapshot: Not recorded", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByLabel("Observed site weather (manual)")).toHaveValue(
    "",
  );
  expect(requests).toBe(1);
});
