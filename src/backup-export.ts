import { createBackupVolumes, type BackupFile } from "./backup";
import { download } from "./export";
import { recordBackup, type BackupLog } from "./storage-health";

export interface BackupOutcome {
  message: string;
  /** True when something could not be included and the user must be told. */
  warning: boolean;
  excluded: { kind: string; id: string; message: string }[];
  /**
   * Set when the backup has several files. They are NOT downloaded automatically
   * (browsers, especially iOS, block downloads that are not tied to a tap), and the
   * backup is not logged until the user has saved every part.
   */
  pending?: { files: BackupFile[]; log: BackupLog };
}
/** Records the backup once every part has been handed to the browser. */
export const completeBackup = (log: BackupLog) => recordBackup(log);
/**
 * Builds verified backup file(s). A single file is downloaded straight away; several
 * files are returned as `pending` for the user to save one by one. The backup is only
 * logged (which silences reminders) after the download was requested, and
 * inspections not fully included stay marked as uncovered.
 */
export async function exportBackupFiles(): Promise<BackupOutcome> {
  const result = await createBackupVolumes();
  const log: BackupLog = {
    at: result.snapshotAt,
    inspectionCount: result.inspectionCount,
    excludedIds: result.excludedInspectionIds,
  };
  const warning = result.excluded.length > 0;
  const tail = warning
    ? ` ${result.excluded.length} stored item${result.excluded.length === 1 ? " was" : "s were"} NOT included - see Settings > Data integrity, and download recovery data.`
    : "";
  const counted = `${result.inspectionCount} inspection${result.inspectionCount === 1 ? "" : "s"}`;
  if (result.files.length > 1)
    return {
      warning,
      excluded: result.excluded,
      pending: { files: result.files, log },
      message: `Backup verified (${counted}) in ${result.files.length} files. Save every file; the backup counts as done only when you have saved them all.${tail}`,
    };
  download(result.files[0].blob, result.files[0].name);
  await recordBackup(log);
  return {
    warning,
    excluded: result.excluded,
    message: `Backup verified and download requested (${counted}). Check your Downloads folder: the app cannot confirm the file was saved.${tail}`,
  };
}
