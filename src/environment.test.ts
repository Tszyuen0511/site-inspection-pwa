import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  detectLocation,
  fetchWeather,
  parseForecast,
  weatherURL,
  positionTime,
} from "./environment";
import { db, repeatInspection } from "./db";
import { fixture } from "./test-fixtures";
import { createBackup, importBackup } from "./backup";
export const gps = {
  latitude: 22.30123456,
  longitude: 114.17123456,
  accuracy: 12,
  capturedAt: new Date().toISOString(),
};
function body(now = new Date()) {
  return {
    properties: {
      meta: {
        updated_at: now.toISOString(),
        units: { air_temperature: "celsius", wind_speed: "m/s" },
      },
      timeseries: [
        {
          time: now.toISOString(),
          data: {
            instant: {
              details: {
                air_temperature: 24,
                wind_speed: 3.2,
                relative_humidity: 75,
              },
            },
            next_1_hours: { summary: { symbol_code: "partlycloudy_day" } },
          },
        },
      ],
    },
  };
}
beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("truncates coordinates and parses forecast provenance and units", () => {
  expect(weatherURL(gps)).toContain("lat=22.3012&lon=114.1712");
  const now = new Date();
  const result = parseForecast(body(now), gps, now);
  expect(result).toMatchObject({
    provider: "MET Norway",
    kind: "model forecast",
    temperatureC: 24,
    windSpeedMs: 3.2,
    summary: "partlycloudy day",
    latitude: 22.3012,
    retrievedAt: now.toISOString(),
  });
  const wrong = body(now);
  wrong.properties.meta.units.wind_speed = "km/h";
  expect(() => parseForecast(wrong, gps, now)).toThrow();
  expect(() =>
    parseForecast(body(new Date(+now - 86400000 * 2)), gps, now),
  ).toThrow("No recent forecast");
});
it("reuses an unexpired location cache offline without making another request", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body()), {
      headers: { Expires: new Date(Date.now() + 600000).toUTCString() },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const first = await fetchWeather(gps);
  expect(first.cached).toBe(false);
  vi.stubGlobal("navigator", { onLine: false });
  const second = await fetchWeather(gps);
  expect(second).toEqual({ weather: first.weather, cached: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(fetchWeather({ ...gps, latitude: 40 })).rejects.toThrow(
    "Offline",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("surfaces service errors and refuses malformed weather", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("", { status: 429 })),
  );
  await expect(fetchWeather(gps)).rejects.toThrow("429");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  await expect(fetchWeather(gps)).rejects.toThrow();
  expect(await db.meta.count()).toBe(0);
});
it.each([1, 2, 3])("handles geolocation error code %s", async (code) => {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (_ok: unknown, error: (e: unknown) => void) =>
        error({ code }),
    },
  });
  await expect(detectLocation()).rejects.toThrow(
    code === 1 ? "permission denied" : code === 3 ? "timed out" : "unavailable",
  );
});
it("captures GPS accuracy and acquisition time", async () => {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (ok: (v: unknown) => void) =>
        ok({
          coords: {
            latitude: gps.latitude,
            longitude: gps.longitude,
            accuracy: 12,
          },
          timestamp: Date.parse(gps.capturedAt),
        }),
    },
  });
  expect(await detectLocation()).toMatchObject(gps);
});
it("aborts a timed-out weather request", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    ),
  );
  const request = fetchWeather(gps);
  const assertion = expect(request).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(12001);
  await assertion;
});
it("backs up GPS and weather exactly and clears them on repeat", async () => {
  const record = {
    ...fixture(),
    gps,
    weatherSnapshot: parseForecast(body(), gps),
  };
  await db.projects.add({
    id: record.projectId,
    name: record.projectName,
    reference: record.projectReference,
    fictional: false,
  });
  await db.templates.add(record.template);
  await db.inspections.add(record);
  const backup = await createBackup();
  await db.inspections.clear();
  await db.projects.clear();
  await db.templates.clear();
  await importBackup(backup);
  expect(await db.inspections.get(record.id)).toEqual(record);
  const copy = await repeatInspection(record);
  expect(copy.gps).toBeUndefined();
  expect(copy.weatherSnapshot).toBeUndefined();
  expect(await db.inspections.get(record.id)).toEqual(record);
});

it("normalizes observed WebKit microseconds without inventing acquisition times", () => {
  const now = Date.now();
  expect(positionTime(now, now)).toEqual({
    capturedAt: new Date(now).toISOString(),
    deviceTimestamp: now,
    timestampUnit: "milliseconds",
  });
  expect(positionTime(now * 1000, now)).toEqual({
    capturedAt: new Date(now).toISOString(),
    deviceTimestamp: now * 1000,
    timestampUnit: "microseconds-normalized",
  });
  expect(() => positionTime(NaN, now)).toThrow();
});
