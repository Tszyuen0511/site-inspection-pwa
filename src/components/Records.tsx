import { useState, type ReactNode } from "react";
import {
  Archive,
  ArrowRight,
  ClipboardList,
  Copy,
  FileText,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { displayNo, type Inspection, type Project } from "../domain";
import { Button, StatusBadge } from "./ui";
export function Records({
  banner,
  records,
  projects,
  initialFilter,
  onNew,
  onOpen,
  onReport,
  onExport,
  onRepeat,
  onDelete,
}: {
  banner?: ReactNode;
  records: Inspection[];
  projects: Project[];
  initialFilter: string;
  onNew: () => void;
  onOpen: (r: Inspection) => void;
  onReport: (r: Inspection) => void;
  onExport: (r: Inspection) => void;
  onRepeat: (r: Inspection) => void;
  onDelete: (r: Inspection) => void;
}) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(initialFilter),
    [project, setProject] = useState(""),
    [type, setType] = useState(""),
    [date, setDate] = useState("");
  const filtered = records
    .filter(
      (r) =>
        (!search ||
          [
            r.id,
            r.inspectionNo,
            r.projectName,
            r.element,
            r.inspector,
            r.location,
          ]
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (!project || r.projectId === project) &&
        (!type || r.type === type) &&
        (!date || r.date === date) &&
        (!status ||
          (status === "failed"
            ? Object.values(r.responses).some((i) => i.status === "Fail")
            : status === "finished"
              ? r.status !== "Draft"
              : r.status === status)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">YOUR LOCAL ARCHIVE</div>
          <h1>
            Inspection records{" "}
            <span className="count-pill">{records.length}</span>
          </h1>
          <p>Find, resume and export your site records.</p>
        </div>
        <Button onClick={onNew}>
          <Plus size={18} />
          New inspection
        </Button>
      </div>
      {banner}
      <div className="card records-card">
        <div className="records-filters">
          <div className="search-input">
            <Search size={18} />
            <input
              aria-label="Search inspections"
              placeholder="Search records, elements, inspectors…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter project"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter inspection type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">All types</option>
            {["Sheet Pile", "Bored Pile", "Pipe Pile"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            aria-label="Filter status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {["Draft", "Completed", "Exported"].map((s) => (
              <option key={s}>{s}</option>
            ))}
            <option value="failed">With failed items</option>
            <option value="finished">Completed & exported</option>
          </select>
          <input
            type="date"
            aria-label="Filter inspection date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {(search || status || project || type || date) && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Clear filters"
              onClick={() => {
                setSearch("");
                setStatus("");
                setProject("");
                setType("");
                setDate("");
              }}
            >
              <X size={17} />
            </Button>
          )}
        </div>
        <div className="records-count">
          {filtered.length}{" "}
          {filtered.length === 1 ? "inspection" : "inspections"}{" "}
          <span>· Fictional sample records are labelled in their details.</span>
        </div>
        <div className="records-list">
          {filtered.map((r) => (
            <article className="record-list-row" key={r.id}>
              <button className="record-main" onClick={() => onOpen(r)}>
                <span className="record-icon blue">
                  <ClipboardList size={22} />
                </span>
                <span>
                  <strong>
                    {r.element} <span className="record-type">{r.type}</span>
                  </strong>
                  <small>{r.projectName}</small>
                  <small className="mono record-id">{displayNo(r)}</small>
                </span>
              </button>
              <div className="record-metadata">
                <span>{formatDate(r.date)}</span>
                <small>{r.inspector}</small>
              </div>
              <StatusBadge status={r.status} />
              <div className="row record-actions">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Preview ${r.element} PDF`}
                  title="Preview PDF"
                  onClick={() => onReport(r)}
                >
                  <FileText size={17} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Export ${r.element} ZIP`}
                  title="Export ZIP"
                  onClick={() => onExport(r)}
                >
                  <Archive size={17} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Repeat ${r.element}`}
                  title="Repeat inspection with blank results"
                  onClick={() => onRepeat(r)}
                >
                  <Copy size={17} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${r.element}`}
                  title="Delete inspection"
                  className="text-danger"
                  onClick={() => onDelete(r)}
                >
                  <Trash2 size={17} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Open ${r.element}`}
                  onClick={() => onOpen(r)}
                >
                  <ArrowRight size={17} />
                </Button>
              </div>
            </article>
          ))}
        </div>
        {!filtered.length && (
          <div className="empty-state">
            <Search size={34} />
            <h3>No inspections found</h3>
            <p>Adjust your filters or create a new inspection.</p>
          </div>
        )}
      </div>
    </>
  );
}

export function formatDate(s: string) {
  return new Date(s + "T12:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
