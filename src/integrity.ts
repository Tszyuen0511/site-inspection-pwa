import type { ZodError } from "zod";
import { db } from "./db";
import {
  inspectionSchema,
  projectSchema,
  templateSchema,
  workspaceSchema,
  type Inspection,
  type Project,
  type Template,
  type Workspace,
} from "./domain";
import { reportTemplateSchema, type ReportTemplate } from "./report-templates";

export type IssueKind =
  | "inspection"
  | "project"
  | "template"
  | "workspace"
  | "report-template"
  | "photo"
  | "drawing"
  | "annotation";
export interface IntegrityIssue {
  kind: IssueKind;
  id: string;
  message: string;
}
export interface StoredScan {
  inspections: Inspection[];
  projects: Project[];
  templates: Template[];
  workspace: Workspace;
  reportTemplates: ReportTemplate[];
  issues: IntegrityIssue[];
}
export const EMPTY_SCAN: StoredScan = {
  inspections: [],
  projects: [],
  templates: [],
  workspace: {},
  reportTemplates: [],
  issues: [],
};
export function describeZod(error: ZodError, max = 3) {
  const lines = error.issues
    .slice(0, max)
    .map((i) => `${i.path.join(".") || "(record)"}: ${i.message}`);
  const more = error.issues.length - max;
  return lines.join("; ") + (more > 0 ? `; +${more} more` : "");
}
// Validation verdicts are cached by id + updatedAt so autosaves do not re-parse
// every stored inspection. The stored rows themselves are never rewritten.
const verdicts = new Map<string, { stamp: string; issue?: string }>();
function inspectionIssue(row: Inspection): string | undefined {
  const stamp = `${row.updatedAt}|${row.revision}|${row.status}`;
  const cached = verdicts.get(row.id);
  if (cached?.stamp === stamp) return cached.issue;
  const parsed = inspectionSchema.safeParse(row);
  const issue = parsed.success ? undefined : describeZod(parsed.error);
  verdicts.set(row.id, { stamp, issue });
  return issue;
}
function rawIssue<T>(
  schema: {
    safeParse: (v: unknown) => { success: boolean; data?: T; error?: ZodError };
  },
  value: unknown,
) {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { data: parsed.data as T }
    : { issue: describeZod(parsed.error!) };
}
function parseJson(raw: string) {
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return { issue: "Stored value is not valid JSON." };
  }
}
/**
 * Reads every table once and separates valid rows from rows that fail today's
 * schemas. Invalid rows are reported, never modified, and never deleted.
 */
export async function scanStoredData(): Promise<StoredScan> {
  return db.transaction(
    "r",
    [db.projects, db.inspections, db.templates, db.meta, db.photos],
    async () => {
      const scan: StoredScan = {
        inspections: [],
        projects: [],
        templates: [],
        workspace: {},
        reportTemplates: [],
        issues: [],
      };
      const issues = scan.issues;
      // toArray (not an index scan) so rows with a damaged updatedAt are still seen.
      const all = (await db.inspections.toArray()).sort((a, b) =>
        String(b?.updatedAt ?? "").localeCompare(String(a?.updatedAt ?? "")),
      );
      const allIds = new Set(all.map((r) => r.id));
      scan.inspections = all.filter((r) => {
        const issue = inspectionIssue(r);
        if (issue)
          issues.push({
            kind: "inspection",
            id: String(r?.id),
            message: issue,
          });
        return !issue;
      });
      scan.projects = (await db.projects.toArray()).filter((p) => {
        const { issue } = rawIssue(projectSchema, p);
        if (issue)
          issues.push({ kind: "project", id: String(p?.id), message: issue });
        return !issue;
      });
      scan.templates = (await db.templates.toArray()).filter((t) => {
        const { issue } = rawIssue(templateSchema, t);
        if (issue)
          issues.push({ kind: "template", id: String(t?.id), message: issue });
        return !issue;
      });
      const workspace = await db.meta.get("workspace");
      if (workspace) {
        const json = parseJson(workspace.value);
        const result =
          "issue" in json
            ? { issue: json.issue }
            : rawIssue(workspaceSchema, json.value);
        if ("data" in result && result.data) scan.workspace = result.data;
        else
          issues.push({
            kind: "workspace",
            id: "workspace",
            message: result.issue ?? "Invalid workspace settings.",
          });
      }
      const rows = await db.meta
        .where("key")
        .startsWith("report-template:")
        .toArray();
      for (const row of rows) {
        const json = parseJson(row.value);
        const result =
          "issue" in json
            ? { issue: json.issue }
            : rawIssue(reportTemplateSchema, json.value);
        if ("data" in result && result.data)
          scan.reportTemplates.push(result.data);
        else
          issues.push({
            kind: "report-template",
            id: row.key,
            message: result.issue ?? "Invalid report template.",
          });
      }
      scan.reportTemplates.sort((a, b) => a.name.localeCompare(b.name));
      // Index keys only: photo image data is not read here.
      for (const key of await db.photos.orderBy("inspectionId").uniqueKeys())
        if (!allIds.has(String(key)))
          issues.push({
            kind: "photo",
            id: String(key),
            message:
              "Photographs exist for an inspection record that is not stored on this device.",
          });
      return scan;
    },
  );
}
