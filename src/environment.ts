import { z } from "zod";
import { db } from "./db";
import {
  gpsSchema,
  weatherSchema,
  type GPS,
  type Weather,
} from "./environment-schema";
export const WEATHER_CREDIT =
  "Weather data: MET Norway (CC BY 4.0). Selected forecast fields; not a site observation. https://creativecommons.org/licenses/by/4.0/";
export const coordinate = (value: number) => Math.trunc(value * 10000) / 10000;
export function weatherURL(gps: GPS) {
  gpsSchema.parse(gps);
  return `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${coordinate(gps.latitude)}&lon=${coordinate(gps.longitude)}`;
}
export function detectLocation(): Promise<GPS> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(
        new Error(
          "Location is unavailable. Enter location / chainage manually.",
        ),
      );
    navigator.geolocation.getCurrentPosition(
      (p) => {
        try {
          resolve(
            gpsSchema.parse({
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
              accuracy: p.coords.accuracy,
              capturedAt: new Date(p.timestamp).toISOString(),
            }),
          );
        } catch {
          reject(
            new Error(
              "The device returned an invalid location. Please retry or enter location manually.",
            ),
          );
        }
      },
      (e) =>
        reject(
          new Error(
            e.code === 1
              ? "Location permission denied. You can continue with manual location / chainage."
              : e.code === 3
                ? "Location timed out. Please retry or enter location manually."
                : "Location unavailable. Please retry or enter location manually.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}
const instant = z.object({
  air_temperature: z.number().finite(),
  wind_speed: z.number().finite().nonnegative(),
  relative_humidity: z.number().min(0).max(100).optional(),
});
const forecastSchema = z.object({
  properties: z.object({
    meta: z.object({
      updated_at: z.string().datetime(),
      units: z.object({
        air_temperature: z.literal("celsius"),
        wind_speed: z.literal("m/s"),
      }),
    }),
    timeseries: z
      .array(
        z.object({
          time: z.string().datetime(),
          data: z.object({
            instant: z.object({ details: instant }),
            next_1_hours: z
              .object({
                summary: z.object({ symbol_code: z.string().max(200) }),
              })
              .optional(),
          }),
        }),
      )
      .min(1),
  }),
});
export function parseForecast(
  body: unknown,
  gps: GPS,
  now = new Date(),
): Weather {
  const data = forecastSchema.parse(body).properties;
  const entry = [...data.timeseries].sort(
    (a, b) =>
      Math.abs(Date.parse(a.time) - +now) - Math.abs(Date.parse(b.time) - +now),
  )[0];
  if (
    Math.abs(Date.parse(entry.time) - +now) > 90 * 60000 ||
    +now - Date.parse(data.meta.updated_at) > 24 * 3600000 ||
    Date.parse(data.meta.updated_at) > +now + 60000
  )
    throw new Error(
      "No recent forecast is available. Existing snapshot retained; enter site observations manually.",
    );
  return weatherSchema.parse({
    provider: "MET Norway",
    kind: "model forecast",
    latitude: coordinate(gps.latitude),
    longitude: coordinate(gps.longitude),
    validAt: entry.time,
    issuedAt: data.meta.updated_at,
    retrievedAt: now.toISOString(),
    temperatureC: entry.data.instant.details.air_temperature,
    windSpeedMs: entry.data.instant.details.wind_speed,
    humidityPercent: entry.data.instant.details.relative_humidity,
    summary:
      entry.data.next_1_hours?.summary.symbol_code.replace(/_/g, " ") ||
      "Conditions not supplied",
  });
}
export async function fetchWeather(
  gps: GPS,
): Promise<{ weather: Weather; cached: boolean }> {
  const url = weatherURL(gps),
    key = "weather-cache:" + url;
  const cached = await db.meta.get(key);
  if (cached) {
    try {
      const row = JSON.parse(cached.value);
      if (Date.parse(row.expiresAt) > Date.now()) {
        const weather = weatherSchema.parse(row.weather);
        if (Math.abs(Date.parse(weather.validAt) - Date.now()) <= 90 * 60000)
          return { weather, cached: true };
      }
    } catch {
      /* Invalid caches do not affect saved inspection snapshots. */
    }
  }
  if (!navigator.onLine)
    throw new Error(
      "Offline: no fresh cached forecast for this location. Existing snapshot retained; enter site observations manually.",
    );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    // Simple CORS request: the browser supplies Origin; do not send custom headers.
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: "omit",
    });
    if (response.status === 203)
      throw new Error(
        "Weather API version deprecated. Use manual observations until the app is updated.",
      );
    if (!response.ok)
      throw new Error(
        `Weather service unavailable (${response.status}). Existing snapshot retained; use manual observations.`,
      );
    const weather = parseForecast(await response.json(), gps);
    const expiresAt = new Date(
      Math.max(
        Date.now() + 60000,
        Date.parse(response.headers.get("Expires") || "") ||
          Date.now() + 300000,
      ),
    ).toISOString();
    try {
      await db.transaction("rw", db.meta, async () => {
        const rows = await db.meta
          .where("key")
          .startsWith("weather-cache:")
          .toArray();
        rows.sort((a, b) =>
          JSON.parse(b.value).weather.retrievedAt.localeCompare(
            JSON.parse(a.value).weather.retrievedAt,
          ),
        );
        await db.meta.bulkDelete(
          rows
            .filter((r) => r.key !== key)
            .slice(9)
            .map((r) => r.key),
        );
        await db.meta.put({
          key,
          value: JSON.stringify({ weather, expiresAt }),
        });
      });
    } catch {
      /* Cache is optional. The caller still autosaves the inspection snapshot. */
    }
    return { weather, cached: false };
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        "Weather request timed out. Existing snapshot retained; use manual observations.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export function gpsText(gps?: GPS) {
  return gps
    ? `GPS: ${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}; device accuracy +/- ${gps.accuracy.toFixed(0)} m; acquired ${gps.capturedAt}`
    : "GPS: Not recorded";
}
export function weatherText(weather?: Weather) {
  return weather
    ? `Stored model forecast: ${weather.summary} (next-hour conditions); ${weather.temperatureC} C; wind ${weather.windSpeedMs} m/s${weather.humidityPercent === undefined ? "" : `; humidity ${weather.humidityPercent}%`}\nForecast location: ${weather.latitude}, ${weather.longitude}\nValid at: ${weather.validAt}; issued: ${weather.issuedAt}; retrieved: ${weather.retrievedAt}\n${WEATHER_CREDIT}`
    : "Forecast snapshot: Not recorded";
}
