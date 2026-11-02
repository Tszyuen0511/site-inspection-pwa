import { useEffect, useState } from "react";
import {
  Archive,
  Download,
  ExternalLink,
  FileText,
  RefreshCw,
  Settings2,
} from "lucide-react";
import {
  errorMessage,
  packageName,
  type Inspection,
  type PhotoMeta,
} from "../domain";
import { Button, Dialog, StatusBadge } from "./ui";
import { download, generatePDF, loadFont } from "../export";
import { PdfPreview } from "./PdfPreview";
import { ReportTemplates } from "./ReportTemplates";
import { DailyReportForm } from "./DailyReportForm";
import type { DailyReport } from "../daily-report";
export function Report({
  record,
  photos,
  onExport,
  onSaveDetails,
}: {
  record: Inspection;
  photos: PhotoMeta[];
  onExport: () => void;
  onSaveDetails: (details: DailyReport) => Promise<boolean>;
}) {
  const [url, setURL] = useState(""),
    [blob, setBlob] = useState<Blob>(),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    let cancelled = false,
      objectURL = "";
    setError("");
    setURL("");
    setBlob(undefined);
    (async () => {
      try {
        const blob = await generatePDF(record, photos, await loadFont());
        if (cancelled) return;
        objectURL = URL.createObjectURL(blob);
        setBlob(blob);
        setURL(objectURL);
      } catch (error) {
        if (!cancelled) setError(errorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [record, photos, refresh]);
  return (
    <>
      <div className="page-title report-page-title">
        <div>
          <div className="eyebrow">REPORT / {record.element}</div>
          <h1>Report preview</h1>
          <p>
            A daily site report with numbered sections, photo sheets and a
            checklist appendix.
          </p>
        </div>
        <div className="title-actions">
          <Button variant="outline" onClick={() => setDetailsOpen(true)}>
            <Settings2 size={17} />
            Report details
          </Button>
          <Button variant="outline" onClick={onExport}>
            <Archive size={17} />
            Export ZIP
          </Button>
          <Button
            className="btn-accent"
            disabled={!blob}
            onClick={() => blob && download(blob, packageName(record) + ".pdf")}
          >
            <Download size={17} />
            Download PDF
          </Button>
        </div>
      </div>
      <div className="card report-toolbar">
        <div className="row">
          <FileText size={20} className="text-blue" />
          <strong>
            {record.element} · {record.type}
          </strong>
          <StatusBadge status={record.status} />
        </div>
        <span className="muted small">
          Rev. {record.revision} · Template {record.template.version} ·{" "}
          {photos.length} photos
        </span>
      </div>
      <ReportTemplates record={record} onApply={onSaveDetails} />
      <div className="report-canvas">
        {error ? (
          <div className="empty-state">
            <FileText size={34} />
            <h3>Report could not be generated</h3>
            <p role="alert">{error}</p>
            <Button variant="outline" onClick={() => setRefresh((v) => v + 1)}>
              <RefreshCw size={16} />
              Retry
            </Button>
          </div>
        ) : !url ? (
          <div className="empty-state">
            <span className="spinner" />
            <p>Preparing your inspection report…</p>
          </div>
        ) : (
          <>
            <div className="pdf-mobile-fallback">
              <p>
                For a full-size report, open the PDF in your browser’s viewer.
              </p>
              <Button asChild variant="outline">
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} />
                  Open PDF
                </a>
              </Button>
            </div>
            {blob && <PdfPreview blob={blob} />}
          </>
        )}
      </div>
      <p className="small muted report-note">
        Recorded observations only. Completion does not represent formal review,
        signature or approval.
      </p>
      <Dialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title="Daily site report details"
        description="Fill the front-page sections, staff, work done and testing tables. Details are saved locally with this inspection."
        wide
      >
        <DailyReportForm
          record={record}
          onSave={onSaveDetails}
          onCancel={() => setDetailsOpen(false)}
        />
      </Dialog>
    </>
  );
}
