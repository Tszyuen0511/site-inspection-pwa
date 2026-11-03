import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  Info,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  CRITICAL_RATIO,
  WARN_RATIO,
  canRequestPersistence,
  computeStorageStats,
  formatBytes,
  readPersistenceStatus,
  readStorageEstimate,
  sortProjects,
  storageHealth,
  usageRatio,
  StatsAbortedError,
  type EstimateResult,
  type PersistenceStatus,
  type ProjectSort,
  type StorageStats,
} from "../storage-stats";
import { ensurePersistence, type Persistence } from "../storage-health";
import { Button } from "./ui";

const PERSISTENCE_TEXT: Record<PersistenceStatus, string> = {
  granted: "Persistent storage granted",
  "not-granted": "Persistent storage not granted",
  unsupported: "Browser does not support this feature",
  unknown: "Unable to determine persistence status",
};

export function StorageManager({
  onBack,
  onPersistence,
}: {
  onBack: () => void;
  onPersistence: (p: Persistence) => void;
}) {
  const [estimate, setEstimate] = useState<EstimateResult>(),
    [persistence, setPersistence] = useState<PersistenceStatus>(),
    [stats, setStats] = useState<StorageStats>(),
    [statsError, setStatsError] = useState(""),
    [loading, setLoading] = useState(true),
    [requesting, setRequesting] = useState(false),
    [requestNote, setRequestNote] = useState(""),
    [sort, setSort] = useState<ProjectSort>("storage"),
    [updatedAt, setUpdatedAt] = useState<Date>();
  const controller = useRef<AbortController>(undefined);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setLoading(true);
    setStatsError("");
    // The quick browser checks are shown while the database walk is running.
    const [e, p] = await Promise.all([
      readStorageEstimate(),
      readPersistenceStatus(),
    ]);
    if (ac.signal.aborted) return;
    setEstimate(e);
    setPersistence(p);
    try {
      const s = await computeStorageStats({ signal: ac.signal });
      if (ac.signal.aborted) return;
      setStats(s);
    } catch (error) {
      if (ac.signal.aborted || error instanceof StatsAbortedError) return;
      setStats(undefined);
      setStatsError(error instanceof Error ? error.message : String(error));
    }
    setUpdatedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, [refresh]);

  const ratio = estimate ? usageRatio(estimate) : undefined;
  const health = useMemo(
    () => storageHealth({ estimate, persistence, stats, statsError }),
    [estimate, persistence, stats, statsError],
  );
  const rows = useMemo(
    () => (stats ? sortProjects(stats.projects, sort) : []),
    [stats, sort],
  );
  const estimateUsage = estimate?.status === "ok" ? estimate.usage : undefined;
  const estimateQuota = estimate?.status === "ok" ? estimate.quota : undefined;
  const pending = loading && !stats;
  const level =
    ratio === undefined
      ? ""
      : ratio >= CRITICAL_RATIO
        ? "critical"
        : ratio >= WARN_RATIO
          ? "warning"
          : "";

  return (
    <div className="storage-manager">
      <div className="page-title">
        <div>
          <div className="eyebrow">SETTINGS</div>
          <h1>Storage manager</h1>
          <p>How much space records and photographs use on this device.</p>
        </div>
        <div className="row wrap">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft size={16} />
            Settings
          </Button>
          <Button
            size="sm"
            disabled={loading}
            onClick={() => void refresh()}
            aria-describedby="storage-updated"
          >
            <RefreshCw size={16} />
            {loading ? "Refreshing…" : "Refresh storage statistics"}
          </Button>
        </div>
      </div>
      <p id="storage-updated" className="small muted" role="status">
        {loading
          ? "Calculating storage statistics…"
          : updatedAt
            ? `Updated ${updatedAt.toLocaleTimeString()}. Read only: nothing is changed or deleted.`
            : ""}
      </p>

      <section className="card settings-section" aria-labelledby="so-title">
        <div className="card-header">
          <div>
            <h2 id="so-title">Storage overview</h2>
            <p>
              Browser figures cover all of this site's data (database, offline
              app files and more), not only inspection records.
            </p>
          </div>
          <Database size={21} className="text-blue" />
        </div>
        <div className="settings-body">
          <div className="progress-label">
            <span>Approximate browser storage used</span>
            <strong>
              {ratio === undefined
                ? "Unavailable"
                : `${(ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%`}
            </strong>
          </div>
          <div
            className={`progress-track storage-meter ${level}`}
            role="progressbar"
            aria-label="Approximate browser storage used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              ratio === undefined ? undefined : Math.round(ratio * 100)
            }
            aria-valuetext={
              ratio === undefined
                ? "Unavailable"
                : `About ${Math.round(ratio * 100)}% of quota`
            }
          >
            <div style={{ width: `${(ratio ?? 0) * 100}%` }} />
          </div>
          <dl className="storage-metrics">
            <Metric
              label="Browser usage (approx.)"
              value={
                estimate
                  ? formatBytes(estimateUsage)
                  : pending
                    ? "…"
                    : "Unavailable"
              }
            />
            <Metric
              label="Browser quota (approx.)"
              value={
                estimate
                  ? formatBytes(estimateQuota)
                  : pending
                    ? "…"
                    : "Unavailable"
              }
            />
            <Metric
              label="Inspection records"
              value={
                stats
                  ? String(stats.inspections)
                  : pending
                    ? "…"
                    : "Unavailable"
              }
            />
            <Metric
              label="Photographs"
              value={
                stats ? String(stats.photos) : pending ? "…" : "Unavailable"
              }
            />
            <Metric
              label="Photograph data"
              hint="Originals + report copies"
              value={
                stats
                  ? formatBytes(stats.photoBytes)
                  : pending
                    ? "…"
                    : "Unavailable"
              }
            />
            <Metric
              label="Plan drawings"
              hint={stats ? `${stats.drawings} file(s)` : undefined}
              value={
                stats
                  ? formatBytes(stats.drawingBytes)
                  : pending
                    ? "…"
                    : "Unavailable"
              }
            />
            <Metric
              label="Inspection data (est.)"
              hint="Record text, excluding files"
              value={
                stats
                  ? `≈ ${formatBytes(stats.recordBytes)}`
                  : pending
                    ? "…"
                    : "Unavailable"
              }
            />
          </dl>
          {estimate?.status === "unsupported" && (
            <p className="small muted">
              This browser does not report storage usage or quota.
            </p>
          )}
        </div>
      </section>

      <section className="card settings-section" aria-labelledby="sp-title">
        <div className="card-header">
          <div>
            <h2 id="sp-title">Storage by project</h2>
            <p>
              Measured from stored file sizes. Record text is estimated, and
              database overhead is not included.
            </p>
          </div>
          <label className="storage-sort">
            <span className="small muted">Sort by</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as ProjectSort)}
            >
              <option value="storage">Storage</option>
              <option value="inspections">Inspections</option>
              <option value="photos">Photos</option>
            </select>
          </label>
        </div>
        <div className="settings-body">
          {pending ? (
            <p className="small muted">Calculating…</p>
          ) : statsError ? (
            <p className="small muted">
              Project breakdown is unavailable. See Storage health.
            </p>
          ) : !rows.length ? (
            <p className="small muted">
              No inspection records or photographs are stored yet.
            </p>
          ) : (
            <div className="storage-table-wrap">
              <table className="storage-table">
                <caption className="sr-only">
                  Storage by project, sorted by {sort}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th
                      scope="col"
                      aria-sort={
                        sort === "inspections" ? "descending" : undefined
                      }
                    >
                      Inspections
                    </th>
                    <th
                      scope="col"
                      aria-sort={sort === "photos" ? "descending" : undefined}
                    >
                      Photos
                    </th>
                    <th
                      scope="col"
                      aria-sort={sort === "storage" ? "descending" : undefined}
                    >
                      Storage (est.)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">
                        {r.name}
                        {r.drawings > 0 && (
                          <small className="muted">
                            {" "}
                            · {r.drawings} drawing{r.drawings === 1 ? "" : "s"}
                          </small>
                        )}
                      </th>
                      <td>{r.inspections}</td>
                      <td>{r.photos}</td>
                      <td>{formatBytes(r.totalBytes)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Total</th>
                    <td>{stats!.inspections}</td>
                    <td>{stats!.photos}</td>
                    <td>
                      {formatBytes(
                        stats!.photoBytes +
                          stats!.drawingBytes +
                          stats!.recordBytes,
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="card settings-section" aria-labelledby="sh-title">
        <div className="card-header">
          <div>
            <h2 id="sh-title">Storage health</h2>
            <p>Warnings are shown only when there is evidence of a risk.</p>
          </div>
        </div>
        <div className="settings-body">
          {pending ? (
            <p className="small muted">Checking…</p>
          ) : health.length ? (
            <ul className="storage-health">
              {health.map((h) => (
                <li key={h.id} className={h.level}>
                  {h.level === "info" ? (
                    <Info size={18} aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={18} aria-hidden="true" />
                  )}
                  <div>
                    <strong>
                      <span className="sr-only">
                        {h.level === "info" ? "Note: " : "Warning: "}
                      </span>
                      {h.title}
                    </strong>
                    <p>{h.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="storage-ok">
              <CheckCircle2 size={18} aria-hidden="true" />
              No storage problems detected.
            </p>
          )}
        </div>
      </section>

      <section className="card settings-section" aria-labelledby="pe-title">
        <div className="card-header">
          <div>
            <h2 id="pe-title">Storage persistence</h2>
            <p>
              Whether the browser has agreed not to clear data automatically.
            </p>
          </div>
          <ShieldCheck size={21} className="text-blue" />
        </div>
        <div className="settings-body">
          <p role="status">
            <span
              className={`badge ${
                persistence === "granted"
                  ? "badge-green"
                  : persistence === "not-granted"
                    ? "badge-amber"
                    : "badge-neutral"
              }`}
            >
              <span className="badge-dot" />
              {persistence ? PERSISTENCE_TEXT[persistence] : "Checking…"}
            </span>
          </p>
          {persistence !== "granted" &&
            persistence !== undefined &&
            canRequestPersistence() && (
              <Button
                variant="outline"
                size="sm"
                disabled={requesting}
                onClick={() => {
                  setRequesting(true);
                  void ensurePersistence()
                    .then(async (result) => {
                      onPersistence(result);
                      setPersistence(await readPersistenceStatus());
                      setRequestNote(
                        result === "granted"
                          ? "Persistent storage granted."
                          : "The browser did not grant persistent storage. Some browsers decide automatically based on how often the app is used or whether it is installed.",
                      );
                    })
                    .finally(() => setRequesting(false));
                }}
              >
                {requesting ? "Requesting…" : "Request persistent storage"}
              </Button>
            )}
          {requestNote && (
            <p className="small muted" role="status">
              {requestNote}
            </p>
          )}
          <p className="small muted">
            Persistent storage reduces the risk of the browser clearing data
            automatically. It does not protect against manually clearing site
            data, uninstalling the browser, or device loss or failure. Export
            backups regularly.
          </p>
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        {hint && <small>{hint}</small>}
      </dd>
    </div>
  );
}
