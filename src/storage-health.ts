import { db } from "./db";
import type { Inspection } from "./domain";

export const REMINDER_AFTER_DAYS = 3;
const MARKER_KEY = "inspection-had-user-data";
const LOG_KEY = "backup-log";

export interface BackupLog {
  /** Time the snapshot was taken (not when the file was saved). */
  at: string;
  inspectionCount: number;
  /** Inspections that could not be fully included in the backup. */
  excludedIds: string[];
}
export async function loadBackupLog(): Promise<BackupLog | undefined> {
  const row = await db.meta.get(LOG_KEY);
  if (!row) return undefined;
  try {
    const v = JSON.parse(row.value);
    return typeof v?.at === "string" && Number.isFinite(Date.parse(v.at))
      ? {
          at: v.at,
          inspectionCount: Number(v.inspectionCount) || 0,
          excludedIds: Array.isArray(v.excludedIds)
            ? v.excludedIds.map(String)
            : [],
        }
      : undefined;
  } catch {
    return undefined;
  }
}
export async function recordBackup(log: BackupLog) {
  await db.meta.put({ key: LOG_KEY, value: JSON.stringify(log) });
}
export interface BackupStatus {
  state: "none" | "ok" | "remind";
  unbacked: number;
  lastAt?: string;
  daysSince?: number;
}
/**
 * Only the user's own (non-fictional) inspections count. A reminder is due when
 * something changed since the last backup AND there has never been a backup or the
 * last one is at least REMINDER_AFTER_DAYS old.
 */
export function backupStatus(
  records: Pick<Inspection, "id" | "fictional" | "updatedAt">[],
  log: BackupLog | undefined,
  now = Date.now(),
  /** Stored inspections hidden because they fail validation: never backed up. */
  hiddenInvalid = 0,
): BackupStatus {
  const real = records.filter((r) => !r.fictional);
  if (!real.length && !hiddenInvalid)
    return { state: "none", unbacked: 0, lastAt: log?.at };
  const excluded = new Set(log?.excludedIds);
  const unbacked =
    hiddenInvalid +
    real.filter((r) => !log || r.updatedAt > log.at || excluded.has(r.id))
      .length;
  const daysSince = log ? (now - Date.parse(log.at)) / 86400000 : undefined;
  if (!unbacked) return { state: "ok", unbacked, lastAt: log?.at, daysSince };
  return {
    state: !log || daysSince! >= REMINDER_AFTER_DAYS ? "remind" : "ok",
    unbacked,
    lastAt: log?.at,
    daysSince,
  };
}

export type Persistence = "granted" | "not-granted" | "unsupported";
export async function readPersistence(): Promise<Persistence> {
  if (!navigator.storage?.persisted) return "unsupported";
  try {
    return (await navigator.storage.persisted()) ? "granted" : "not-granted";
  } catch {
    return "unsupported";
  }
}
/** Asks the browser not to evict storage. A refusal is reported, never ignored. */
export async function ensurePersistence(): Promise<Persistence> {
  const current = await readPersistence();
  if (current !== "not-granted" || !navigator.storage?.persist) return current;
  try {
    return (await navigator.storage.persist()) ? "granted" : "not-granted";
  } catch {
    return "not-granted";
  }
}

// A localStorage marker does NOT survive origin-wide eviction, so it can only
// detect a partial clear (IndexedDB wiped, localStorage kept). It is a hint, not
// a safeguard: external backups remain the recovery mechanism.
export function markUserData(storage: Pick<Storage, "setItem"> = localStorage) {
  try {
    storage.setItem(MARKER_KEY, new Date().toISOString());
  } catch {
    /* Hint only. */
  }
}
export function clearUserDataMarker(
  storage: Pick<Storage, "removeItem"> = localStorage,
) {
  try {
    storage.removeItem(MARKER_KEY);
  } catch {
    /* Hint only. */
  }
}
/** True when this browser remembers user data but the database is brand new. */
export function suspectedStorageLoss(
  databaseInitialized: boolean,
  storage: Pick<Storage, "getItem"> | undefined = safeLocalStorage(),
) {
  if (databaseInitialized) return false;
  try {
    return !!storage?.getItem(MARKER_KEY);
  } catch {
    return false;
  }
}
function safeLocalStorage() {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}
