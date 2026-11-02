import { z } from "zod";
export const gpsSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().nonnegative(),
  capturedAt: z.string().datetime(),
});
export const weatherSchema = z.object({
  provider: z.literal("MET Norway"),
  kind: z.literal("model forecast"),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  validAt: z.string().datetime(),
  issuedAt: z.string().datetime(),
  retrievedAt: z.string().datetime(),
  temperatureC: z.number().finite(),
  windSpeedMs: z.number().finite().nonnegative(),
  humidityPercent: z.number().finite().min(0).max(100).optional(),
  summary: z.string().max(200),
});
export type GPS = z.infer<typeof gpsSchema>;
export type Weather = z.infer<typeof weatherSchema>;
