import { z } from "zod";
import type { Inspection } from "./domain";
const short = z.string().max(500);
const narrative = z.string().max(10000);
export const dailyReportSchema = z.object({
  reportNumber: short,
  reportPeriod: short,
  supervisionTitle: short,
  preparedBy: short,
  commencementDate: short,
  completionDate: short,
  contractPeriod: short,
  timeElapsed: short,
  timeRemaining: short,
  activities: narrative,
  safety: narrative,
  weather: narrative,
  rfi: narrative,
  instructions: narrative,
  nonCompliance: narrative,
  memosIssued: short,
  memosTotal: short,
  staff: z
    .array(z.object({ occupation: short, company: short, people: short }))
    .max(100),
  workDone: z
    .array(
      z.object({
        activity: short,
        rigs: short,
        element: short,
        commencement: short,
        progress: short,
        status: short,
        completion: short,
      }),
    )
    .max(300),
  testing: z.array(z.object({ type: short, completed: short })).max(100),
});
export type DailyReport = z.infer<typeof dailyReportSchema>;
export function dailyReportDefaults(
  record: Pick<Inspection, "dailyReport" | "inspector" | "role">,
): DailyReport {
  return (
    record.dailyReport || {
      reportNumber: "",
      reportPeriod: "",
      supervisionTitle: record.role
        ? `${record.role} Site Supervisor`
        : "Site Supervisor",
      preparedBy: record.inspector,
      commencementDate: "",
      completionDate: "",
      contractPeriod: "",
      timeElapsed: "",
      timeRemaining: "",
      activities: "",
      safety: "",
      weather: "",
      rfi: "",
      instructions: "",
      nonCompliance: "",
      memosIssued: "",
      memosTotal: "",
      staff: [],
      workDone: [],
      testing: [],
    }
  );
}
export function reportDate(date: string) {
  return new Date(date + "T12:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
