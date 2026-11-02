import { z } from "zod";
import { db } from "./db";
import { dailyReportDefaults, type DailyReport } from "./daily-report";
import type { Inspection } from "./domain";
const short = z.string().max(500);
export const reportTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  defaults: z.object({
    supervisionTitle: short,
    commencementDate: short,
    completionDate: short,
    contractPeriod: short,
    wording: z.object({
      activities: z.string().max(10000),
      safety: z.string().max(10000),
      instructions: z.string().max(10000),
    }),
    staff: z.array(z.object({ occupation: short, company: short })).max(100),
    workActivities: z.array(short).max(300),
    testTypes: z.array(short).max(100),
  }),
});
export type ReportTemplate = z.infer<typeof reportTemplateSchema>;
export type TemplateChoices = {
  header: boolean;
  contract: boolean;
  tables: boolean;
  wording: Array<"activities" | "safety" | "instructions">;
};
export function makeReportTemplate(
  record: Inspection,
  name: string,
  choices: TemplateChoices,
  previous?: ReportTemplate,
): ReportTemplate {
  const d = dailyReportDefaults(record),
    now = new Date().toISOString();
  return reportTemplateSchema.parse({
    id: previous?.id || crypto.randomUUID(),
    name,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    defaults: {
      supervisionTitle: choices.header ? d.supervisionTitle : "",
      commencementDate: choices.contract ? d.commencementDate : "",
      completionDate: choices.contract ? d.completionDate : "",
      contractPeriod: choices.contract ? d.contractPeriod : "",
      wording: Object.fromEntries(
        (["activities", "safety", "instructions"] as const).map((k) => [
          k,
          choices.wording.includes(k) ? d[k] : "",
        ]),
      ),
      staff: choices.tables
        ? d.staff.map(({ occupation, company }) => ({ occupation, company }))
        : [],
      workActivities: choices.tables ? d.workDone.map((r) => r.activity) : [],
      testTypes: choices.tables ? d.testing.map((r) => r.type) : [],
    },
  });
}
export function applyReportTemplate(
  record: Inspection,
  template: ReportTemplate,
): DailyReport {
  if (record.status !== "Draft")
    throw new Error(
      "Reopen the inspection as a revision before applying a report template.",
    );
  const t = reportTemplateSchema.parse(template).defaults;
  const result = structuredClone(dailyReportDefaults(record));
  if (!record.dailyReport) result.supervisionTitle = "";
  for (const key of [
    "supervisionTitle",
    "commencementDate",
    "completionDate",
    "contractPeriod",
  ] as const)
    if (!result[key].trim()) result[key] = t[key];
  for (const key of ["activities", "safety", "instructions"] as const)
    if (!result[key].trim()) result[key] = t.wording[key];
  if (!result.supervisionTitle)
    result.supervisionTitle = dailyReportDefaults({
      ...record,
      dailyReport: undefined,
    }).supervisionTitle;
  if (!result.staff.length)
    result.staff = t.staff.map((r) => ({ ...r, people: "" }));
  if (!result.workDone.length)
    result.workDone = t.workActivities.map((activity) => ({
      activity,
      rigs: "",
      element: "",
      commencement: "",
      progress: "",
      status: "",
      completion: "",
    }));
  if (!result.testing.length)
    result.testing = t.testTypes.map((type) => ({ type, completed: "" }));
  return result;
}
export const reportTemplateKey = (id: string) => `report-template:${id}`;
export async function loadReportTemplates(): Promise<ReportTemplate[]> {
  const rows = await db.meta
    .where("key")
    .startsWith("report-template:")
    .toArray();
  return rows
    .map((r) => reportTemplateSchema.parse(JSON.parse(r.value)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function storeReportTemplate(template: ReportTemplate) {
  const valid = reportTemplateSchema.parse(template);
  await db.transaction("rw", db.meta, async () => {
    if (
      !(await db.meta.get(reportTemplateKey(valid.id))) &&
      (await db.meta.where("key").startsWith("report-template:").count()) >= 200
    )
      throw new Error(
        "Maximum 200 report templates. Remove unused templates first.",
      );
    await db.meta.put({
      key: reportTemplateKey(valid.id),
      value: JSON.stringify(valid),
    });
  });
}
