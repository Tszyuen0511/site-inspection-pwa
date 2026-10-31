import {
  ArrowDownToLine,
  ArrowRight,
  ClipboardCheck,
  ClipboardList,
  FileClock,
  FolderOpen,
  Plus,
  TriangleAlert,
} from "lucide-react";
import type { Inspection, Project } from "../domain";
import { progress } from "../domain";
import { Button, StatusBadge } from "./ui";
export function Dashboard({
  records,
  projects,
  onNew,
  onOpen,
  onRecords,
  onSettings,
}: {
  records: Inspection[];
  projects: Project[];
  onNew: () => void;
  onOpen: (r: Inspection) => void;
  onRecords: (filter?: string) => void;
  onSettings: () => void;
}) {
  const drafts = records.filter((r) => r.status === "Draft"),
    failed = records.filter((r) =>
      Object.values(r.responses).some((r) => r.status === "Fail"),
    );
  const recent = [...records]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  const stats = [
    {
      label: "Total inspections",
      value: records.length,
      caption: `Across ${projects.length} projects`,
      Icon: ClipboardList,
      tone: "blue",
      filter: "",
    },
    {
      label: "Draft inspections",
      value: drafts.length,
      caption: "In progress",
      Icon: FileClock,
      tone: "amber",
      filter: "Draft",
    },
    {
      label: "Completed",
      value: records.filter((r) => r.status !== "Draft").length,
      caption: "Completed or exported",
      Icon: ClipboardCheck,
      tone: "green",
      filter: "finished",
    },
    {
      label: "With failed items",
      value: failed.length,
      caption: "Observations to follow up",
      Icon: TriangleAlert,
      tone: "red",
      filter: "failed",
    },
  ];
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">INSPECTIONS</div>
          <h1>Overview</h1>
          <p>Review site records or continue an inspection.</p>
        </div>
        <Button onClick={onNew}>
          <Plus size={18} />
          New inspection
        </Button>
      </div>
      <div className="stats-grid">
        {stats.map(({ label, value, caption, Icon, tone, filter }) => (
          <button
            key={label}
            className="card stat-card"
            onClick={() => onRecords(filter)}
          >
            <div className="flex-between">
              <span>{label}</span>
              <span className={`stat-icon ${tone}`}>
                <Icon size={19} />
              </span>
            </div>
            <strong>{String(value).padStart(2, "0")}</strong>
            <small>{caption}</small>
          </button>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="card recent-card">
          <div className="card-header">
            <div>
              <h2>Recent inspections</h2>
              <p>Your latest site records, at a glance.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onRecords()}>
              View all
              <ArrowRight size={15} />
            </Button>
          </div>
          <div className="recent-table">
            <div className="recent-table-head">
              <span>INSPECTION / ELEMENT</span>
              <span>DATE</span>
              <span>STATUS</span>
              <span />
            </div>
            {recent.map((r) => (
              <button
                key={r.id}
                className="recent-row"
                onClick={() => onOpen(r)}
              >
                <span className="record-name">
                  <span
                    className={`record-icon ${r.type === "Sheet Pile" ? "blue" : "neutral"}`}
                  >
                    <ClipboardCheck size={19} />
                  </span>
                  <span>
                    <strong>
                      {r.element}
                      <span className="record-type">{r.type}</span>
                    </strong>
                    <small>{r.projectName}</small>
                  </span>
                </span>
                <span className="record-date">{formatDate(r.date)}</span>
                <StatusBadge status={r.status} />
                <ArrowRight size={16} className="muted" />
              </button>
            ))}
          </div>
          {!recent.length && (
            <div className="empty-state">
              <ClipboardList />
              <h3>Your first inspection starts here</h3>
              <p>Create an inspection to build your local field record.</p>
            </div>
          )}
          <div className="table-footer">
            <span className="live-dot" />
            All records stored locally on this device
            <span className="fictional-label">Fictional demo data</span>
          </div>
        </section>
        <aside className="dashboard-aside">
          <section className="card continue-card">
            <div className="card-kicker">SAVED DRAFT</div>
            <div className="flex-between">
              <h3>In progress</h3>
              <FileClock size={20} className="muted" />
            </div>
            {drafts[0] ? (
              <>
                <div className="draft-element">
                  {drafts[0].element}
                  <StatusBadge status="Draft" />
                </div>
                <p>{drafts[0].type} inspection</p>
                <small className="muted">{drafts[0].location}</small>
                <div className="progress-label">
                  <span>Checklist completion</span>
                  <strong>
                    {progress(drafts[0]).done}/{progress(drafts[0]).total}
                  </strong>
                </div>
                <div className="progress-track">
                  <div style={{ width: progress(drafts[0]).percent + "%" }} />
                </div>
                <Button
                  variant="outline"
                  className="full-width"
                  onClick={() => onOpen(drafts[0])}
                >
                  Continue inspection
                  <ArrowRight size={15} />
                </Button>
              </>
            ) : (
              <p>No drafts waiting. You’re up to date.</p>
            )}
          </section>
        </aside>
      </div>
      <section className="bottom-reminder">
        <span className="reminder-icon">
          <FolderOpen size={20} />
        </span>
        <div>
          <strong>Back up inspection records</strong>
          <p>
            Browser storage can be cleared. Export a backup regularly.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onSettings}>
          <ArrowDownToLine size={16} />
          Backup & storage
        </Button>
      </section>
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
