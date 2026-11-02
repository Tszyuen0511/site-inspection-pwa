import { beforeEach, describe, expect, it, vi } from "vitest";

const download = vi.fn();
vi.mock("./export", () => ({ download: (...a: unknown[]) => download(...a) }));
const volumes = vi.fn();
vi.mock("./backup", () => ({ createBackupVolumes: () => volumes() }));

import { db } from "./db";
import { completeBackup, exportBackupFiles } from "./backup-export";
import { loadBackupLog } from "./storage-health";

const file = (n: number) => ({
  name: `part-${n}.zip`,
  blob: new Blob(["x"]),
  inspections: 1,
  photos: 0,
});
const result = (
  files: ReturnType<typeof file>[],
  excluded: unknown[] = [],
) => ({
  files,
  excluded,
  excludedInspectionIds: excluded.length ? ["INSP-X"] : [],
  snapshotAt: "2026-11-02T00:00:00.000Z",
  inspectionCount: files.length,
});
beforeEach(async () => {
  download.mockClear();
  await db.meta.clear();
});

describe("backup export hand-off", () => {
  it("downloads a single file immediately and records the backup", async () => {
    volumes.mockResolvedValue(result([file(1)]));
    const out = await exportBackupFiles();
    expect(download).toHaveBeenCalledTimes(1);
    expect(out.pending).toBeUndefined();
    expect((await loadBackupLog())?.at).toBe("2026-11-02T00:00:00.000Z");
  });
  it("does not download or record a multi-file backup until the user saves every part", async () => {
    volumes.mockResolvedValue(result([file(1), file(2)]));
    const out = await exportBackupFiles();
    expect(download).not.toHaveBeenCalled();
    expect(out.pending?.files).toHaveLength(2);
    expect(await loadBackupLog()).toBeUndefined();
    await completeBackup(out.pending!.log);
    expect((await loadBackupLog())?.inspectionCount).toBe(2);
  });
  it("keeps excluded inspections marked as uncovered in the log", async () => {
    volumes.mockResolvedValue(
      result([file(1)], [{ kind: "inspection", id: "INSP-X", message: "no" }]),
    );
    const out = await exportBackupFiles();
    expect(out.warning).toBe(true);
    expect((await loadBackupLog())?.excludedIds).toEqual(["INSP-X"]);
  });
});
