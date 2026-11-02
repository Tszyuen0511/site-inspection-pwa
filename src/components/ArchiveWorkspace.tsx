import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import type { Inspection, Project, StoredPhoto } from "../domain";
import { Button, Field, StatusBadge } from "./ui";
import { ReportTemplates } from "./ReportTemplates";
function Thumb({ photo, onOpen }: { photo: StoredPhoto; onOpen: () => void }) {
  const [url, setURL] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(
      new Blob([photo.compressed], { type: "image/jpeg" }),
    );
    setURL(url);
    return () => URL.revokeObjectURL(url);
  }, [photo.compressed]);
  return (
    <button className="library-thumb" onClick={onOpen}>
      {url && (
        <img src={url} loading="lazy" alt={photo.caption || photo.name} />
      )}
      <strong>{photo.caption || photo.name}</strong>
      <small>Added {new Date(photo.createdAt).toLocaleString("en-GB")}</small>
    </button>
  );
}
function Gallery({
  record,
  open,
  onOpen,
}: {
  record: Inspection;
  open: boolean;
  onOpen: () => void;
}) {
  const photos = useLiveQuery(
    () =>
      open
        ? db.photos.where("inspectionId").equals(record.id).sortBy("order")
        : Promise.resolve([] as StoredPhoto[]),
    [record.id, open],
    [] as StoredPhoto[],
  );
  const [caption, setCaption] = useState("");
  const matching = photos.filter((p) =>
    [p.caption, p.name, p.reportGroup || ""]
      .join(" ")
      .toLowerCase()
      .includes(caption.toLowerCase()),
  );
  return (
    <div className="library-gallery-wrap">
      <Field label={`Search captions for ${record.element}`}>
        <input
          type="search"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption, filename or borehole group"
        />
      </Field>
      <div className="library-gallery">
        {matching.slice(0, 12).map((p) => (
          <Thumb key={p.id} photo={p} onOpen={onOpen} />
        ))}
      </div>
      <p className="small muted">
        {matching.length
          ? `Showing ${Math.min(12, matching.length)} of ${matching.length} matching photos. Open photo log to manage all.`
          : "No matching photos. Open photo log to add photographs."}
      </p>
    </div>
  );
}
function ArchiveCard({
  record,
  count,
  mode,
  onOpenPhotos,
  onOpenReport,
  onPDF,
  onZIP,
}: {
  record: Inspection;
  count: number;
  mode: string;
  onOpenPhotos: () => void;
  onOpenReport: () => void;
  onPDF: () => void;
  onZIP: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article
      className="card library-record"
      aria-label={`${record.date} ${record.element}`}
    >
      <div className="library-record-heading">
        <div>
          <h3>
            {record.element} <span className="muted">· {record.type}</span>
          </h3>
          <p>
            {record.date} · {count} photos · Report No.{" "}
            {record.dailyReport?.reportNumber || "Not assigned"}
          </p>
          <small className="library-id">{record.id}</small>
        </div>
        <StatusBadge status={record.status} />
      </div>
      <div className="row wrap">
        {mode === "photos" ? (
          <Button variant="outline" onClick={onOpenPhotos}>
            Open photo log
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onOpenReport}>
              Preview / edit report
            </Button>
            <Button onClick={onPDF}>Download PDF</Button>
            <Button variant="outline" onClick={onZIP}>
              Inspection ZIP
            </Button>
          </>
        )}
      </div>
      {mode === "photos" && (
        <details onToggle={(e) => setExpanded(e.currentTarget.open)}>
          <summary>View photographs ({count})</summary>
          {expanded && (
            <Gallery record={record} open={expanded} onOpen={onOpenPhotos} />
          )}
        </details>
      )}
    </article>
  );
}
export function ArchiveWorkspace({
  mode,
  records,
  projects,
  onOpenPhotos,
  onOpenReport,
  onPDF,
  onZIP,
  onBackup,
  onSettings,
}: {
  mode: "photos" | "reports" | "exports";
  records: Inspection[];
  projects: Project[];
  onOpenPhotos: (r: Inspection) => void;
  onOpenReport: (r: Inspection) => void;
  onPDF: (r: Inspection) => void;
  onZIP: (r: Inspection) => void;
  onBackup: () => void;
  onSettings: () => void;
}) {
  const [project, setProject] = useState(""),
    [date, setDate] = useState(""),
    [status, setStatus] = useState(""),
    [type, setType] = useState(""),
    [search, setSearch] = useState("");
  // Read indexed keys only: never load original image buffers to count photos.
  const photoCounts = useLiveQuery(
    async () => {
      const keys = await db.photos.orderBy("inspectionId").keys();
      const counts: Record<string, number> = {};
      for (const key of keys)
        counts[String(key)] = (counts[String(key)] || 0) + 1;
      return counts;
    },
    [],
    {} as Record<string, number>,
  );
  const filtered = records
    .filter(
      (r) =>
        (!project || r.projectId === project) &&
        (!date || r.date === date) &&
        (!status || r.status === status) &&
        (!type || r.type === type) &&
        [
          r.projectName,
          r.projectReference,
          r.element,
          r.id,
          r.inspector,
          r.dailyReport?.reportNumber || "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt),
    );
  const groups = new Map<string, Inspection[]>();
  for (const r of filtered) {
    const key = JSON.stringify([r.projectId, r.date]);
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">PROJECT / DATE / INSPECTION</div>
          <h1>
            {mode === "photos"
              ? "Photographs"
              : mode === "reports"
                ? "Reports"
                : "Exports"}
          </h1>
          <p>
            {mode === "photos"
              ? "Find photos by project and inspection. Expand an inspection to search its captions."
              : mode === "reports"
                ? "Find, preview and download reports, or manage reusable report defaults."
                : "Choose the right export for reporting or restoring your workspace."}
          </p>
        </div>
      </div>
      {mode === "exports" && (
        <div className="export-choices">
          <section className="card">
            <h2>PDF report</h2>
            <p>
              A printable report for one inspection, including its photographs.
            </p>
            <small>Select an inspection below and choose Download PDF.</small>
          </section>
          <section className="card">
            <h2>Inspection ZIP</h2>
            <p>One inspection's PDF, JSON data and original photographs.</p>
            <small>Reporting package; use a complete backup for restore.</small>
          </section>
          <section className="card">
            <h2>Complete backup</h2>
            <p>
              All projects, inspections, original photos, checklists, report
              templates and saved profile/defaults. Filters below do not limit
              this backup.
            </p>
            <div className="row wrap">
              <Button onClick={onBackup}>Download complete backup</Button>
              <Button variant="outline" onClick={onSettings}>
                Restore / storage settings
              </Button>
            </div>
          </section>
        </div>
      )}
      <section className="card library-filters" aria-label="Library filters">
        <Field label="Filter library project">
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Filter library date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Filter library status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {["Draft", "Completed", "Exported"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Filter library type">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All inspection types</option>
            {[...new Set(records.map((r) => r.type))].sort().map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Search library inspections">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Element, project, inspector or report number"
          />
        </Field>
        <Button
          variant="ghost"
          onClick={() => {
            setProject("");
            setDate("");
            setStatus("");
            setType("");
            setSearch("");
          }}
        >
          Clear library filters
        </Button>
      </section>
      <p className="small muted" role="status">
        {filtered.length} inspections
      </p>
      {[...groups.entries()].map(([key, rows]) => (
        <section
          className="library-group"
          key={key}
          aria-label={`${rows[0].projectName} ${rows[0].date}`}
        >
          <h2>
            {rows[0].projectName}{" "}
            <span className="muted">· {rows[0].date}</span>
          </h2>
          {rows.map((r) => (
            <ArchiveCard
              key={r.id + mode}
              mode={mode}
              record={r}
              count={photoCounts[r.id] || 0}
              onOpenPhotos={() => onOpenPhotos(r)}
              onOpenReport={() => onOpenReport(r)}
              onPDF={() => onPDF(r)}
              onZIP={() => onZIP(r)}
            />
          ))}
        </section>
      ))}
      {!filtered.length && (
        <div className="empty-state">
          <h2>No matching inspections</h2>
          <p>Change the project, date or search filters.</p>
        </div>
      )}
      {mode === "reports" && <ReportTemplates />}
    </>
  );
}
