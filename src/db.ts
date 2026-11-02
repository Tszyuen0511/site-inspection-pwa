import Dexie, { type Table } from "dexie";
import {
  blankResponses,
  newInspection,
  templates,
  validationIssues,
  type Inspection,
  type StoredPhoto,
  type Project,
  type Template,
  localDate,
  workspaceSchema,
  type Workspace,
} from "./domain";
export class InspectionDB extends Dexie {
  projects!: Table<Project, string>;
  inspections!: Table<Inspection, string>;
  photos!: Table<StoredPhoto, string>;
  templates!: Table<Template, string>;
  meta!: Table<{ key: string; value: string }, string>;
  constructor(name = "site-inspection-v1") {
    super(name);
    this.version(1).stores({
      projects: "id,name",
      inspections: "id,projectId,date,status,updatedAt",
      photos: "id,inspectionId,itemId",
      templates: "id",
      meta: "key",
    });
  }
}
export const db = new InspectionDB();
export async function seed() {
  await db.transaction(
    "rw",
    [db.projects, db.inspections, db.templates, db.meta],
    async () => {
      if (await db.meta.get("initialized")) return;
      const projects: Project[] = [
        {
          id: "demo-geo",
          name: "Demo Geotechnical Works",
          reference: "DEMO-2026-001",
          fictional: true,
        },
        {
          id: "demo-harbour",
          name: "Demo Harbour Improvement",
          reference: "DEMO-2026-002",
          fictional: true,
        },
      ];
      await db.projects.bulkAdd(projects);
      await db.templates.bulkAdd(templates);
      const specs = [
        ["SP-001", "Sheet Pile", "Completed", "2026-10-30"],
        ["SP-002", "Sheet Pile", "Draft", "2026-10-30"],
        ["SP-003", "Sheet Pile", "Completed", "2026-10-29"],
        ["BP-012", "Bored Pile", "Draft", "2026-10-29"],
        ["SP-004", "Sheet Pile", "Exported", "2026-10-28"],
        ["PP-006", "Pipe Pile", "Draft", "2026-10-28"],
      ] as const;
      const fingerprints: Record<string, string> = {};
      for (const [n, spec] of specs.entries()) {
        const [element, type, status, date] = spec,
          project = projects[n === 4 ? 1 : 0],
          template = templates.find((t) => t.name === type)!;
        const record = newInspection(
          {
            projectId: project.id,
            projectName: project.name,
            projectReference: project.reference,
            date,
            time: "09:30",
            type,
            element,
            location:
              n === 4
                ? "Harbour works · Zone B"
                : "North retaining wall · CH 0+120",
            inspector: "Demo Inspector",
            role: "TCP T3",
            drawing: "DEMO-GEO-SP-101 Rev. B",
            remarks:
              "Fictional demonstration record. Observations and statuses are illustrative only.",
          },
          template,
        );
        record.id = `INSP-DEMO-${String(n + 1).padStart(4, "0")}`;
        record.status = status;
        record.fictional = true;
        record.updatedAt = `${date}T09:30:00.000Z`;
        if (status !== "Draft")
          template.items.forEach((i) => {
            record.responses[i.id].status = "Pass";
            record.responses[i.id].reference = record.drawing;
          });
        if (n === 1) {
          record.responses[template.items[0].id].status = "Pass";
          record.responses[template.items[1].id].status = "Pass";
          record.responses[template.items[2].id].status = "Pass";
        }
        if (n === 2) {
          record.responses["corner-welding"].status = "Fail";
          record.responses["corner-welding"].remarks =
            "Fictional observation: corner weld detail requires follow-up against the referenced drawing.";
        }
        if (type === "Sheet Pile")
          record.responses["toe-level"].values = {
            specifiedLevel: "-12.50",
            measuredLevel: status === "Draft" ? "" : "-12.48",
            datum: "mPD (demo)",
            units: "m",
          };
        await db.inspections.add(record);
        fingerprints[record.id] = JSON.stringify(record);
      }
      await db.meta.add({
        key: "seedRecords",
        value: JSON.stringify(fingerprints),
      });
      await db.meta.add({
        key: "seedProjects",
        value: JSON.stringify(
          Object.fromEntries(projects.map((p) => [p.id, JSON.stringify(p)])),
        ),
      });
      await db.meta.add({ key: "initialized", value: "1" });
    },
  );
}
export async function deleteInspection(id: string) {
  await db.transaction("rw", db.inspections, db.photos, async () => {
    await db.photos.where("inspectionId").equals(id).delete();
    await db.inspections.delete(id);
  });
}
// Repeat deliberately builds a new record from an allowlist; no result data is copied.
export async function repeatInspection(source: Inspection) {
  const workspace = await loadWorkspace();
  const now = new Date();
  const record = newInspection(
    {
      projectId: source.projectId,
      projectName: source.projectName,
      projectReference: source.projectReference,
      type: source.type,
      element: source.element,
      location: source.location,
      drawing: source.drawing,
      date: localDate(now),
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      inspector: workspace.inspector?.name || source.inspector,
      role: workspace.inspector?.role || source.role,
      company: workspace.inspector?.company || source.company,
      remarks: "",
    },
    source.template,
  );
  record.fictional = source.fictional;
  await db.inspections.add(record);
  return record;
}
// Never throws on a damaged workspace row: the app must still open so the user can
// recover. The row itself is left untouched and reported by scanStoredData().
export async function loadWorkspace(): Promise<Workspace> {
  const row = await db.meta.get("workspace");
  if (!row) return {};
  try {
    return workspaceSchema.parse(JSON.parse(row.value));
  } catch {
    return {};
  }
}
export const quarantineKey = (key: string, at = new Date()) =>
  `quarantine:${key}:${at.toISOString()}`;
// Call inside a read-write meta transaction before replacing a row that no longer
// validates, so the raw value is never destroyed by a normal save.
export async function preserveIfInvalid(
  key: string,
  isValid: (raw: string) => boolean,
) {
  const existing = await db.meta.get(key);
  if (existing && !isValid(existing.value))
    await db.meta.put({ key: quarantineKey(key), value: existing.value });
}
const validWorkspace = (raw: string) => {
  try {
    workspaceSchema.parse(JSON.parse(raw));
    return true;
  } catch {
    return false;
  }
};
export async function saveWorkspace(value: Workspace) {
  const parsed = workspaceSchema.parse(value);
  await db.transaction("rw", db.meta, async () => {
    await preserveIfInvalid("workspace", validWorkspace);
    await db.meta.put({ key: "workspace", value: JSON.stringify(parsed) });
  });
}
// Order-independent fingerprint of an inspection, ignoring updatedAt. Photo edits
// only bump updatedAt, so they never look like a competing edit.
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}
export const inspectionContentKey = (record: Inspection) => {
  const { updatedAt: _updatedAt, ...rest } = record;
  void _updatedAt;
  return JSON.stringify(stable(rest));
};
export class SaveConflictError extends Error {
  name = "SaveConflictError";
}
/**
 * Saves only if the stored inspection still has the content this editor last saw
 * or loaded. Otherwise nothing is written, so another tab's edits are never
 * silently overwritten.
 */
export async function saveIfUnchanged(snapshot: Inspection, baseKey: string) {
  await db.transaction("rw", db.inspections, async () => {
    const current = await db.inspections.get(snapshot.id);
    if (!current || inspectionContentKey(current) !== baseKey)
      throw new SaveConflictError(
        "This inspection was changed or deleted in another tab or window.",
      );
    await db.inspections.put(snapshot);
  });
}
export async function finalize(record: Inspection, baseKey?: string) {
  const issues = validationIssues(record);
  if (issues.length) throw new Error(issues.join("\n"));
  const completed = {
    ...record,
    status: "Completed" as const,
    updatedAt: new Date().toISOString(),
  };
  if (baseKey === undefined) await db.inspections.put(completed);
  else await saveIfUnchanged(completed, baseKey);
  return completed;
}
export async function deleteProject(id: string) {
  await db.transaction("rw", db.projects, db.inspections, db.meta, async () => {
    if (await db.inspections.where("projectId").equals(id).count())
      throw new Error(
        "This project has inspection records. Move or delete those records before deleting the project.",
      );
    await db.projects.delete(id);
    const workspace = await loadWorkspace();
    if (workspace.defaultProjectId === id) {
      delete workspace.defaultProjectId;
      await saveWorkspace(workspace);
    }
  });
}
export { blankResponses };
