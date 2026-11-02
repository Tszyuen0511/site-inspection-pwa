import { z } from "zod";
import rawTemplates from "./templates.json";
import { gpsSchema, weatherSchema } from "./environment-schema";
import { dailyReportSchema } from "./daily-report";
export const fieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  unit: z.boolean().optional(),
});
export const itemSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  hint: z.string(),
  fields: z.array(fieldSchema),
  criteria: z
    .object({
      text: z.string().trim().min(1),
      documentReference: z.string().trim().min(1),
    })
    .optional(),
});
export const templateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    demo: z.boolean(),
    items: z.array(itemSchema).min(1),
  })
  .superRefine((t, ctx) => {
    if (new Set(t.items.map((i) => i.id)).size !== t.items.length)
      ctx.addIssue({
        code: "custom",
        message: "Checklist item IDs must be unique.",
      });
    for (const item of t.items)
      if (new Set(item.fields.map((f) => f.key)).size !== item.fields.length)
        ctx.addIssue({
          code: "custom",
          message: "Measurement keys must be unique within an item.",
        });
    if (["bored-pile", "pipe-pile"].includes(t.id) && !t.demo)
      ctx.addIssue({
        code: "custom",
        message:
          "Placeholder templates must be marked as demonstration content.",
      });
  });
export type Template = z.infer<typeof templateSchema>;
export const templates = z.array(templateSchema).parse(rawTemplates);
export const statuses = [
  "Pass",
  "Fail",
  "Not Applicable",
  "Not Inspected",
] as const;
export const responseSchema = z.object({
  status: z.enum(statuses),
  remarks: z.string(),
  reference: z.string(),
  values: z.record(z.string(), z.string()),
});
export type Response = z.infer<typeof responseSchema>;
const required = z.string().trim().min(1, "This field is required").max(500);
export const detailsSchema = z.object({
  projectId: required,
  projectName: required,
  projectReference: required,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date")
    .refine((v) => {
      const d = new Date(v);
      return !isNaN(d.valueOf()) && d.toISOString().startsWith(v);
    }, "Enter a valid date"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time"),
  type: required,
  element: required,
  location: required,
  inspector: required,
  role: required,
  company: z.string().trim().max(500).optional(),
  drawing: z.string().max(1000),
  remarks: z.string().max(10000),
});
export type Details = z.infer<typeof detailsSchema>;
export const inspectionSchema = detailsSchema.extend({
  id: required,
  status: z.enum(["Draft", "Completed", "Exported"]),
  /** Human-readable number, e.g. INSP-SP-001. Absent on records created before numbering. */
  inspectionNo: z.string().trim().min(1).max(50).optional(),
  createdAt: required,
  updatedAt: required,
  revision: z.number().int().min(0),
  template: templateSchema,
  responses: z.record(z.string(), responseSchema),
  fictional: z.boolean(),
  dailyReport: dailyReportSchema.optional(),
  gps: gpsSchema.optional(),
  weatherSnapshot: weatherSchema.optional(),
});
export type Inspection = z.infer<typeof inspectionSchema>;
export const inspectorProfileSchema = z.object({
  name: required,
  role: required,
  company: required,
});
export type InspectorProfile = z.infer<typeof inspectorProfileSchema>;
export const workspaceSchema = z.object({
  inspector: inspectorProfileSchema.optional(),
  defaultProjectId: z.string().max(500).optional(),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const projectSchema = z.object({
  id: required,
  name: required,
  reference: required,
  defaultLocation: z.string().max(500).optional(),
  defaultDrawing: z.string().max(1000).optional(),
  fictional: z.boolean(),
});
export type Project = z.infer<typeof projectSchema>;
export interface Photo {
  id: string;
  inspectionId: string;
  itemId: string;
  caption: string;
  order: number;
  name: string;
  original: Blob;
  compressed: Blob;
  width: number;
  height: number;
  createdAt: string;
  reportSection?: "site" | "core" | "plan";
  reportGroup?: string;
  /** Observation about this specific photograph (distinct from its caption). */
  remark?: string;
}
/** Everything about a photograph except the full-size original. */
export type PhotoMeta = Omit<Photo, "original">;
/** Used by screens: report image plus the original's size, never its bytes. */
export type PhotoView = PhotoMeta & { originalSize: number };
export type StoredPhoto = Omit<Photo, "original" | "compressed"> & {
  original: ArrayBuffer;
  compressed: ArrayBuffer;
  originalType: string;
};
export const MAX_PHOTO_SIZE = 20 * 1024 * 1024;
export const MAX_PHOTOS = 60;
export const MAX_BACKUP_SIZE = 250 * 1024 * 1024;
export function blankResponses(template: Template): Record<string, Response> {
  return Object.fromEntries(
    template.items.map((i) => [
      i.id,
      { status: "Not Inspected", remarks: "", reference: "", values: {} },
    ]),
  );
}
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function newInspection(
  details: Details,
  template: Template,
): Inspection {
  const now = new Date().toISOString();
  return {
    ...details,
    id: `INSP-${crypto.randomUUID().toUpperCase()}`,
    status: "Draft",
    createdAt: now,
    updatedAt: now,
    revision: 0,
    template: structuredClone(template),
    responses: blankResponses(template),
    fictional: false,
  };
}
/**
 * Two-to-four letter code for an inspection type, from its template name:
 * "Sheet Pile" -> "SP", "Bored Pile" -> "BP", "Pipe Pile" -> "PP".
 */
export function inspectionCode(typeName: string) {
  const words = typeName
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const code =
    words.length > 1
      ? words.map((w) => w[0]).join("")
      : (words[0] || "").slice(0, 2);
  return code.slice(0, 4) || "GEN";
}
export const formatInspectionNo = (code: string, n: number) =>
  `INSP-${code}-${String(n).padStart(3, "0")}`;
/** The number shown everywhere; older records keep showing their original ID. */
export const displayNo = (r: Pick<Inspection, "id" | "inspectionNo">) =>
  r.inspectionNo || r.id;
export function validationIssues(record: Inspection): string[] {
  const result = detailsSchema.safeParse(record);
  const issues = result.success
    ? []
    : result.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`);
  for (const [index, item] of record.template.items.entries()) {
    const r = record.responses[item.id];
    if (!r || r.status === "Not Inspected")
      issues.push(`Item ${index + 1}: select an inspection status.`);
    else if (r.status === "Fail" && !r.remarks.trim())
      issues.push(`Item ${index + 1}: a failed item needs a remark.`);
  }
  return issues;
}
export function progress(record: Inspection) {
  const done = record.template.items.filter((i) => {
    const r = record.responses[i.id];
    return (
      r &&
      r.status !== "Not Inspected" &&
      (r.status !== "Fail" || !!r.remarks.trim())
    );
  }).length;
  return {
    done,
    total: record.template.items.length,
    percent: Math.round((done / record.template.items.length) * 100),
  };
}
export function safeName(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 100) || "Inspection"
  );
}
export function packageName(r: Inspection) {
  // Uses the displayed number so file names match the report; legacy records keep their ID.
  return [
    safeName(r.projectReference).slice(0, 32),
    safeName(r.element).slice(0, 32),
    r.date,
    safeName(displayNo(r)),
  ].join("_");
}
export function photoNumber(index: number) {
  return `P${String(index + 1).padStart(2, "0")}`;
}
export function errorMessage(error: unknown) {
  if (error instanceof Error && /quota/i.test(error.name + " " + error.message))
    return "Device storage is full. Export a backup and free space before retrying.";
  return error instanceof Error
    ? error.message
    : "The operation could not be completed. Please retry.";
}
