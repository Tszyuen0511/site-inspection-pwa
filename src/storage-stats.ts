import { db, type InspectionDB } from "./db";

// Read-only storage statistics for the Storage Manager. Nothing here writes to the
// database or decodes an image: sizes come from stored byte lengths only.

/** Utilization at or above this fraction of the browser quota is a warning. */
export const WARN_RATIO = 0.8;
/** Utilization at or above this fraction is critical. */
export const CRITICAL_RATIO = 0.95;

const UNITS = ["B", "KB", "MB", "GB", "TB"];
/** Formats a byte count with binary (1024) units; "Unavailable" when unknown. */
export function formatBytes(bytes: number | undefined | null) {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes))
    return "Unavailable";
  if (bytes < 0) return "Unavailable";
  let value = bytes,
    unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** Byte length of a stored binary value, or undefined when it is not binary. */
export function binarySize(value: unknown): number | undefined {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;
  return undefined;
}

const encoder = new TextEncoder();
/** UTF-8 size of a record's JSON form: an approximation of its stored size. */
function jsonSize(value: unknown) {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}

export const UNASSIGNED_PROJECT = "__unassigned__";
export const UNLINKED_PROJECT = "__unlinked__";

export interface ProjectStorage {
  /** Project id, or UNASSIGNED_PROJECT / UNLINKED_PROJECT for the fallback groups. */
  key: string;
  name: string;
  inspections: number;
  photos: number;
  drawings: number;
  photoBytes: number;
  drawingBytes: number;
  recordBytes: number;
  /** photoBytes + drawingBytes + recordBytes. */
  totalBytes: number;
}

export interface StorageStats {
  inspections: number;
  photos: number;
  drawings: number;
  projects: ProjectStorage[];
  /** Sum of stored photo bytes (originals + report copies). */
  photoBytes: number;
  drawingBytes: number;
  /** Estimated JSON size of inspection records (excludes photos and drawings). */
  recordBytes: number;
  /** Photos whose binary data could not be measured (missing or corrupted). */
  unmeasuredPhotos: number;
  unmeasuredDrawings: number;
  /** Photos whose inspection no longer exists. */
  unlinkedPhotos: number;
  /** Inspections without a project id. */
  unassignedInspections: number;
}

export class StatsAbortedError extends Error {
  name = "StatsAbortedError";
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new StatsAbortedError("Calculation cancelled.");
}

/**
 * Walks every stored row once with a cursor, so only one record (and at most one
 * photograph's bytes) is held at a time. The result holds numbers only.
 */
export async function computeStorageStats(
  options: { signal?: AbortSignal; database?: InspectionDB } = {},
): Promise<StorageStats> {
  const { signal } = options;
  const database = options.database ?? db;
  checkAbort(signal);
  const groups = new Map<string, ProjectStorage>();
  const group = (key: string, name: string) => {
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name,
        inspections: 0,
        photos: 0,
        drawings: 0,
        photoBytes: 0,
        drawingBytes: 0,
        recordBytes: 0,
        totalBytes: 0,
      };
      groups.set(key, g);
    }
    return g;
  };

  const projectNames = new Map<string, string>();
  await database.projects.each((p) => {
    if (p && typeof p.id === "string")
      projectNames.set(p.id, typeof p.name === "string" ? p.name : p.id);
  });
  checkAbort(signal);

  // inspection id -> group key
  const owner = new Map<string, string>();
  let inspections = 0,
    recordBytes = 0,
    unassignedInspections = 0;
  await database.inspections.each((r) => {
    checkAbort(signal);
    if (!r || typeof r.id !== "string" || owner.has(r.id)) return;
    const projectId =
      typeof r.projectId === "string" && r.projectId.trim() ? r.projectId : "";
    const key = projectId || UNASSIGNED_PROJECT;
    const name = projectId
      ? projectNames.get(projectId) ||
        (typeof r.projectName === "string" && r.projectName.trim()) ||
        projectId
      : "No project";
    if (!projectId) unassignedInspections++;
    const g = group(key, name);
    const size = jsonSize(r);
    g.inspections++;
    g.recordBytes += size;
    owner.set(r.id, key);
    inspections++;
    recordBytes += size;
  });

  const target = (inspectionId: unknown) => {
    const key =
      typeof inspectionId === "string" ? owner.get(inspectionId) : undefined;
    return key
      ? groups.get(key)!
      : group(UNLINKED_PROJECT, "Not linked to an inspection");
  };

  const seenPhotos = new Set<string>();
  let photos = 0,
    photoBytes = 0,
    unmeasuredPhotos = 0,
    unlinkedPhotos = 0;
  await database.photos.each((p) => {
    checkAbort(signal);
    if (!p || typeof p.id !== "string" || seenPhotos.has(p.id)) return;
    seenPhotos.add(p.id);
    const original = binarySize(p.original),
      compressed = binarySize(p.compressed);
    if (original === undefined || compressed === undefined) unmeasuredPhotos++;
    const size = (original ?? 0) + (compressed ?? 0);
    const linked =
      typeof p.inspectionId === "string" && owner.has(p.inspectionId);
    if (!linked) unlinkedPhotos++;
    const g = target(p.inspectionId);
    g.photos++;
    g.photoBytes += size;
    photos++;
    photoBytes += size;
  });

  // drawing id -> inspection id (metadata rows are small)
  const drawingOwner = new Map<string, unknown>();
  await database.drawings.each((d) => {
    if (d && typeof d.id === "string") drawingOwner.set(d.id, d.inspectionId);
  });
  checkAbort(signal);
  let drawings = 0,
    drawingBytes = 0,
    unmeasuredDrawings = 0;
  await database.drawingFiles.each((f) => {
    checkAbort(signal);
    if (!f || typeof f.id !== "string") return;
    const size = binarySize(f.bytes);
    if (size === undefined) unmeasuredDrawings++;
    const g = target(drawingOwner.get(f.id));
    g.drawings++;
    g.drawingBytes += size ?? 0;
    drawings++;
    drawingBytes += size ?? 0;
  });
  checkAbort(signal);

  const projects = [...groups.values()].map((g) => ({
    ...g,
    totalBytes: g.photoBytes + g.drawingBytes + g.recordBytes,
  }));
  return {
    inspections,
    photos,
    drawings,
    projects: sortProjects(projects, "storage"),
    photoBytes,
    drawingBytes,
    recordBytes,
    unmeasuredPhotos,
    unmeasuredDrawings,
    unlinkedPhotos,
    unassignedInspections,
  };
}

export type ProjectSort = "storage" | "inspections" | "photos";
/** Descending by the chosen measure, then by storage, then by name. */
export function sortProjects(rows: ProjectStorage[], by: ProjectSort) {
  const measure = (r: ProjectStorage) =>
    by === "inspections"
      ? r.inspections
      : by === "photos"
        ? r.photos
        : r.totalBytes;
  return [...rows].sort(
    (a, b) =>
      measure(b) - measure(a) ||
      b.totalBytes - a.totalBytes ||
      a.name.localeCompare(b.name),
  );
}

// ---- Browser storage APIs ---------------------------------------------------

export type EstimateResult =
  | { status: "ok"; usage?: number; quota?: number }
  | { status: "unsupported" }
  | { status: "error"; message: string };

type StorageApi = Partial<
  Pick<StorageManager, "estimate" | "persisted" | "persist">
>;
const browserStorage = (): StorageApi | undefined =>
  typeof navigator === "undefined" ? undefined : navigator.storage;

const finite = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;

export async function readStorageEstimate(
  storage: StorageApi | undefined = browserStorage(),
): Promise<EstimateResult> {
  if (typeof storage?.estimate !== "function") return { status: "unsupported" };
  try {
    const e = await storage.estimate();
    return { status: "ok", usage: finite(e?.usage), quota: finite(e?.quota) };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Fraction of quota used, or undefined when either value is unknown. */
export function usageRatio(estimate: EstimateResult) {
  if (estimate.status !== "ok") return undefined;
  const { usage, quota } = estimate;
  if (usage === undefined || !quota) return undefined;
  return Math.min(usage / quota, 1);
}

export type PersistenceStatus =
  "granted" | "not-granted" | "unsupported" | "unknown";

export async function readPersistenceStatus(
  storage: StorageApi | undefined = browserStorage(),
): Promise<PersistenceStatus> {
  if (typeof storage?.persisted !== "function") return "unsupported";
  try {
    return (await storage.persisted()) ? "granted" : "not-granted";
  } catch {
    return "unknown";
  }
}

export const canRequestPersistence = (
  storage: StorageApi | undefined = browserStorage(),
) => typeof storage?.persist === "function";

// ---- Health -----------------------------------------------------------------

export interface HealthItem {
  id:
    | "usage-critical"
    | "usage-high"
    | "quota-unavailable"
    | "persistence-not-granted"
    | "stats-failed"
    | "unmeasured-data"
    | "unlinked-photos";
  level: "critical" | "warning" | "info";
  title: string;
  detail: string;
}

/**
 * Only evidence produces a warning: an unsupported API is not by itself a risk,
 * so it yields no item here (the overview shows "Unavailable" instead).
 */
export function storageHealth(input: {
  estimate?: EstimateResult;
  persistence?: PersistenceStatus;
  stats?: StorageStats;
  statsError?: string;
}): HealthItem[] {
  const items: HealthItem[] = [];
  const { estimate, persistence, stats, statsError } = input;
  if (statsError)
    items.push({
      id: "stats-failed",
      level: "warning",
      title: "Storage statistics could not be calculated",
      detail: `${statsError} Your records are not affected. Try refreshing.`,
    });
  const ratio = estimate ? usageRatio(estimate) : undefined;
  if (ratio !== undefined && ratio >= CRITICAL_RATIO)
    items.push({
      id: "usage-critical",
      level: "critical",
      title: "Browser storage is almost full",
      detail: `About ${Math.round(ratio * 100)}% of the browser's quota is in use. New photographs may fail to save. Export a backup now.`,
    });
  else if (ratio !== undefined && ratio >= WARN_RATIO)
    items.push({
      id: "usage-high",
      level: "warning",
      title: "High browser storage utilization",
      detail: `About ${Math.round(ratio * 100)}% of the browser's quota is in use. Export a backup and keep an eye on free space.`,
    });
  if (
    estimate?.status === "error" ||
    (estimate?.status === "ok" && !estimate.quota)
  )
    items.push({
      id: "quota-unavailable",
      level: "warning",
      title: "Storage quota unavailable",
      detail:
        estimate.status === "error"
          ? `The browser refused the storage estimate (${estimate.message}). Free space cannot be checked.`
          : "The browser did not report a storage quota. Free space cannot be checked.",
    });
  if (persistence === "not-granted")
    items.push({
      id: "persistence-not-granted",
      level: stats && (stats.inspections || stats.photos) ? "warning" : "info",
      title: "Persistent storage not granted",
      detail:
        "The browser may clear this app's data when the device is low on space. Keep regular backups outside the browser.",
    });
  if (stats && (stats.unmeasuredPhotos || stats.unmeasuredDrawings))
    items.push({
      id: "unmeasured-data",
      level: "info",
      title: "Some items could not be measured",
      detail: `${stats.unmeasuredPhotos} photograph(s) and ${stats.unmeasuredDrawings} drawing(s) have missing or unreadable data, so totals may be understated. Nothing was changed.`,
    });
  if (stats?.unlinkedPhotos)
    items.push({
      id: "unlinked-photos",
      level: "info",
      title: "Photographs without an inspection",
      detail: `${stats.unlinkedPhotos} photograph(s) are not linked to a stored inspection. They are listed separately and were not changed.`,
    });
  return items;
}
