import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Share2 } from "lucide-react";
import { displayNo, errorMessage, type Inspection } from "../domain";
import {
  canShareFiles,
  createExportBundle,
  shareFiles,
  type BundleResult,
} from "../export-bundle";
import { download, loadFont } from "../export";
import { loadDrawingOriginals, loadReportPlans } from "../plan-render";
import { recordBackup } from "../storage-health";
import { formatBytes } from "../storage-stats";
import { Button, Dialog } from "./ui";

type Phase = "options" | "working" | "ready";

/**
 * Exports several inspections in one go: one ZIP laid out as
 * Project / Element / Date with each PDF and package, plus an optional
 * restorable backup. Preparing and sharing are separate taps because phones
 * only open the share sheet straight from a tap.
 */
export function ExportSelected({
  records,
  onClose,
  prepare,
  onMessage,
}: {
  records: Inspection[];
  onClose: () => void;
  /** Waits for pending saves; false when something is still unsaved. */
  prepare: () => Promise<boolean>;
  onMessage: (message: string, error?: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("options"),
    [includeBackup, setIncludeBackup] = useState(true),
    [progress, setProgress] = useState(""),
    [result, setResult] = useState<BundleResult>(),
    [error, setError] = useState("");
  // Ignore results that arrive after the dialog has closed. Set on every
  // mount, not only initially: React may mount, unmount and mount again.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const total = result?.files.reduce((n, f) => n + f.blob.size, 0) ?? 0;
  const shareable = !!result && canShareFiles(result.files);

  const build = async () => {
    setError("");
    if (!(await prepare())) return;
    setPhase("working");
    try {
      const bundle = await createExportBundle(
        records,
        {
          loadPlans: loadReportPlans,
          loadOriginals: loadDrawingOriginals,
          font: await loadFont(),
        },
        {
          includeBackup,
          onProgress: (m) => live.current && setProgress(m),
        },
      );
      if (!live.current) return;
      setResult(bundle);
      setPhase("ready");
    } catch (e) {
      if (!live.current) return;
      setError(errorMessage(e));
      setPhase("options");
    }
  };
  // The backup only counts once its files have been handed over.
  const finish = async (how: string) => {
    if (result?.backupLog) await recordBackup(result.backupLog);
    const skipped = result?.backupExcluded.length
      ? ` ${result.backupExcluded.length} stored item(s) could not be included in the backup; see Settings > Data integrity.`
      : "";
    onMessage(
      `${how} ${result!.inspections} inspection${result!.inspections === 1 ? "" : "s"} in ${result!.files.length} file${result!.files.length === 1 ? "" : "s"}.${skipped}`,
      !!skipped,
    );
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && phase !== "working" && onClose()}
      title={`Export ${records.length} inspection${records.length === 1 ? "" : "s"}`}
      description="One ZIP organised by Project / Element / Date, with each inspection's PDF report and package (data, photos and drawings)."
    >
      <ul className="export-list">
        {records.map((r) => (
          <li key={r.id}>
            <strong>{r.element}</strong> · {displayNo(r)} ·{" "}
            <span className="muted">{r.projectName}</span>
          </li>
        ))}
      </ul>
      {phase === "options" && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeBackup}
              onChange={(e) => setIncludeBackup(e.target.checked)}
            />
            Include a restorable backup of all records (larger, but lets you
            restore everything on another device)
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void build()}>Prepare export</Button>
          </div>
        </>
      )}
      {phase === "working" && (
        <p className="export-progress" role="status">
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          {progress || "Preparing…"} Keep this screen open.
        </p>
      )}
      {phase === "ready" && result && (
        <>
          <ul className="export-files" aria-label="Files ready to save">
            {result.files.map((f) => (
              <li key={f.name}>
                <span>{f.name}</span>
                <span className="muted">{formatBytes(f.blob.size)}</span>
              </li>
            ))}
          </ul>
          <p className="small muted">
            Total {formatBytes(total)}.{" "}
            {shareable
              ? "Share opens your phone's options: Save to Files, OneDrive, Google Drive, AirDrop or Nearby Share. Files this large usually cannot be emailed."
              : "Download saves the files to your Downloads folder."}
          </p>
          <div className="form-actions">
            <Button
              variant={shareable ? "outline" : "default"}
              onClick={() => {
                result.files.forEach((f, i) =>
                  // Spaced out: browsers may drop rapid consecutive downloads.
                  setTimeout(() => download(f.blob, f.name), i * 400),
                );
                void finish("Download requested for");
              }}
            >
              <Download size={16} />
              Download
            </Button>
            {shareable && (
              <Button
                onClick={() =>
                  void shareFiles(result.files, "Site inspections")
                    .then(async (shared) => {
                      if (shared) await finish("Shared");
                    })
                    .catch((e) => setError(errorMessage(e)))
                }
              >
                <Share2 size={16} />
                Share
              </Button>
            )}
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
