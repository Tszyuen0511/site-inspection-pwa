import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { errorMessage, type Inspection, type PhotoMeta } from "../domain";
import { generatePDF, loadFont } from "../export";
import { Button } from "./ui";
import { PdfPreview } from "./PdfPreview";

export function ReportDock({
  record,
  photos,
  onPreview,
  onPDF,
}: {
  record: Inspection;
  photos: PhotoMeta[];
  onPreview: () => void;
  onPDF: () => void;
}) {
  const [blob, setBlob] = useState<Blob>(),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setBlob(undefined);
    setError("");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await generatePDF(record, photos, await loadFont());
          if (!cancelled) setBlob(result);
        } catch (e) {
          if (!cancelled) setError(errorMessage(e));
        }
      })();
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [record, photos]);
  return (
    <aside className="report-dock" aria-label="Report preview panel">
      <h2 className="section-label">Report preview</h2>
      <div className="dock-page" aria-busy={!blob && !error}>
        {error ? (
          <p role="alert">{error}</p>
        ) : blob ? (
          <PdfPreview blob={blob} maxPages={1} />
        ) : (
          <div className="dock-loading">
            <FileText size={28} />
            <p>Preparing preview…</p>
          </div>
        )}
      </div>
      <p className="dock-note">
        First page · A4 printable PDF
        <br />
        All checklist items and photographs included.
      </p>
      <Button variant="outline" onClick={onPreview}>
        Preview full report
      </Button>
      <Button className="btn-accent" onClick={onPDF}>
        <Download size={18} />
        Save as PDF
      </Button>
    </aside>
  );
}
