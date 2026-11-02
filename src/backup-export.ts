import { createBackupVolumes } from "./backup";
import { download } from "./export";
import { recordBackup } from "./storage-health";

export interface BackupOutcome {
  message: string;
  /** True when something could not be included and the user must be told. */
  warning: boolean;
  excluded: { kind: string; id: string; message: string }[];
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * Builds verified backup file(s), downloads them, and only then records the
 * backup so the reminder stops. Inspections that were not fully included are
 * kept in the log as uncovered, so they keep triggering the reminder.
 */
export async function exportBackupFiles(): Promise<BackupOutcome> {
  const result = await createBackupVolumes();
  for (const [i, file] of result.files.entries()) {
    if (i) await pause(700); // browsers may block simultaneous downloads
    download(file.blob, file.name);
  }
  await recordBackup({
    at: result.snapshotAt,
    inspectionCount: result.inspectionCount,
    excludedIds: result.excludedInspectionIds,
  });
  const parts = result.files.length;
  const warning = result.excluded.length > 0;
  return {
    warning,
    excluded: result.excluded,
    message:
      `Backup verified and download requested (${result.inspectionCount} inspection${result.inspectionCount === 1 ? "" : "s"}` +
      `${parts > 1 ? `, ${parts} files - keep all of them` : ""}). Check your Downloads folder: the app cannot confirm the file was saved.` +
      (warning
        ? ` ${result.excluded.length} stored item${result.excluded.length === 1 ? " was" : "s were"} NOT included - see Settings > Data integrity, and download recovery data.`
        : ""),
  };
}
