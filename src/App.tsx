import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Download,
  HardHat,
  Images,
  LayoutDashboard,
  Loader2,
  Moon,
  Menu,
  FileText,
  Plus,
  Settings2,
  ShieldCheck,
  Sun,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  db,
  deleteInspection,
  repeatInspection,
  finalize,
  seed,
  loadWorkspace,
} from "./db";
import {
  errorMessage,
  newInspection,
  packageName,
  progress,
  type Inspection,
} from "./domain";
import { Button, Dialog } from "./components/ui";
import { Dashboard } from "./components/Dashboard";
import { Records } from "./components/Records";
import { Checklist } from "./components/Checklist";
import { InspectionForm } from "./components/InspectionForm";
import { PhotoManager } from "./components/PhotoManager";
import { Settings } from "./components/Settings";
import { Report } from "./components/Report";
import { generatePackage, generatePDF, download, loadFont } from "./export";
import { wspLogo } from "./brand-assets";
import { fromStoredPhoto } from "./photos";
type Page =
  "dashboard" | "records" | "checklist" | "photos" | "report" | "settings";
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export default function App() {
  const [page, setPage] = useState<Page>("dashboard"),
    [newOpen, setNewOpen] = useState(false),
    [detailsOpen, setDetailsOpen] = useState(false),
    [menuOpen, setMenuOpen] = useState(false),
    [editorSection, setEditorSection] = useState("inspection-checklist"),
    [active, setActive] = useState<Inspection>(),
    [recordFilter, setRecordFilter] = useState(""),
    [photoItem, setPhotoItem] = useState(""),
    [deleting, setDeleting] = useState<Inspection>(),
    [notice, setNotice] = useState<{ message: string; error: boolean }>(),
    [initialized, setInitialized] = useState(false),
    [fatal, setFatal] = useState(""),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [cacheReady, setCacheReady] = useState(false),
    [saveState, setSaveState] = useState("Saved on device"),
    [theme, setTheme] = useState(() => {
      try {
        return localStorage.getItem("inspection-theme") || "light";
      } catch {
        return "light";
      }
    }),
    [installEvent, setInstallEvent] = useState<InstallEvent>();
  const activeRef = useRef<Inspection | undefined>(undefined),
    queue = useRef<Promise<unknown>>(Promise.resolve()),
    unsaved = useRef(false),
    failedSave = useRef(false),
    failedPhotos = useRef<Array<() => Promise<unknown>>>([]);
  const workspace = useLiveQuery(loadWorkspace, [], {});
  const projects = useLiveQuery(() => db.projects.toArray(), [], []),
    templates = useLiveQuery(() => db.templates.toArray(), [], []),
    records = useLiveQuery(
      () => db.inspections.orderBy("updatedAt").reverse().toArray(),
      [],
      [],
    ),
    allPhotos = useLiveQuery(
      async () =>
        active?.id
          ? (
              await db.photos.where("inspectionId").equals(active.id).toArray()
            ).map(fromStoredPhoto)
          : [],
      [active?.id],
      [],
    );
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      setNotice({
        message: "Offline setup failed: " + error.message,
        error: true,
      });
    },
  });
  const selectedPhotos = allPhotos.filter((p) => p.inspectionId === active?.id);
  // Stable dependencies prevent unrelated live-query updates from regenerating a PDF.
  const photoCache = useRef(selectedPhotos);
  if (
    photoCache.current.length !== selectedPhotos.length ||
    photoCache.current.some(
      (p, i) =>
        p.id !== selectedPhotos[i]?.id ||
        p.order !== selectedPhotos[i]?.order ||
        p.itemId !== selectedPhotos[i]?.itemId ||
        p.caption !== selectedPhotos[i]?.caption,
    )
  )
    photoCache.current = selectedPhotos;
  useEffect(() => {
    void seed()
      .then(() => setInitialized(true))
      .catch((e) => setFatal(errorMessage(e)));
  }, []);
  useEffect(() => {
    let cancelled = false;
    if ("serviceWorker" in navigator && "caches" in window)
      void navigator.serviceWorker.ready
        .then(async (registration) => {
          const shell = await caches.match(
            new URL(import.meta.env.BASE_URL + "index.html", location.origin)
              .href,
            { ignoreSearch: true },
          );
          if (!cancelled && registration.active && shell) setCacheReady(true);
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const handle = () => setOnline(navigator.onLine);
    window.addEventListener("online", handle);
    window.addEventListener("offline", handle);
    const install = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", install);
    const unload = (e: BeforeUnloadEvent) => {
      if (unsaved.current || failedPhotos.current.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("online", handle);
      window.removeEventListener("offline", handle);
      window.removeEventListener("beforeinstallprompt", install);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  useEffect(() => {
    const match = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && match.matches),
      );
    apply();
    match.addEventListener("change", apply);
    try {
      localStorage.setItem("inspection-theme", theme);
    } catch {
      /* Appearance can remain session-only. */
    }
    return () => match.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(undefined), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const run = async (work: () => Promise<unknown>, success?: string) => {
    try {
      await work();
      if (success) setNotice({ message: success, error: false });
    } catch (error) {
      setNotice({ message: errorMessage(error), error: true });
    }
  };
  const flush = async () => {
    let pending;
    do {
      pending = queue.current;
      await pending;
    } while (pending !== queue.current);
    if (unsaved.current || failedPhotos.current.length) {
      setNotice({
        message:
          "Changes are not saved. Use Retry save before leaving this inspection.",
        error: true,
      });
      return false;
    }
    return true;
  };
  const activate = (record: Inspection) => {
    activeRef.current = record;
    setActive(record);
    setSaveState("Saved on device");
  };
  const save = (record: Inspection) => {
    const snapshot = { ...record, updatedAt: new Date().toISOString() };
    activeRef.current = snapshot;
    setActive(snapshot);
    unsaved.current = true;
    setSaveState("Saving…");
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          await db.inspections.put(snapshot);
          failedSave.current = false;
          if (activeRef.current === snapshot) {
            unsaved.current = false;
            setSaveState(
              failedPhotos.current.length ? "Save failed" : "Saved on device",
            );
          }
        } catch (error) {
          failedSave.current = true;
          setSaveState("Save failed");
          setNotice({ message: errorMessage(error), error: true });
        }
      });
  };
  // Inline photo edits share the save queue so navigation and PDF export wait
  // for the last caption or upload, including a click immediately after typing.
  const runPhoto = async (work: () => Promise<unknown>, success?: string) => {
    setSaveState("Saving…");
    const pending = queue.current
      .catch(() => {})
      .then(async () => {
        if (failedSave.current || failedPhotos.current.length)
          throw Object.assign(
            new Error(
              "Retry saving the inspection before changing photographs.",
            ),
            { retryablePhotoWrite: true },
          );
        await work();
      });
    const tracked = pending.then(
      () => {
        if (
          queue.current === tracked &&
          !unsaved.current &&
          !failedPhotos.current.length
        )
          setSaveState("Saved on device");
      },
      (error) => {
        if (error?.retryablePhotoWrite) failedPhotos.current.push(work);
        setSaveState(
          unsaved.current || failedPhotos.current.length
            ? "Save failed"
            : "Saved on device",
        );
      },
    );
    queue.current = tracked;
    await run(() => pending, success);
  };
  const navigate = async (next: Page) => {
    if (!(await flush())) return;
    if (
      (next === "checklist" || next === "photos" || next === "report") &&
      !activeRef.current
    ) {
      const first = records[0];
      if (first) activate(first);
    }
    setPhotoItem("");
    setPage(next);
    window.scrollTo({ top: 0 });
  };
  const open = async (record: Inspection, next: Page = "checklist") => {
    if (!(await flush())) return;
    activate(record);
    setPage(next);
    window.scrollTo({ top: 0 });
  };
  const exportZIP = async (record: Inspection) => {
    if (!(await flush())) return;
    setBusy(true);
    await run(async () => {
      const effective =
        record.id === activeRef.current?.id ? activeRef.current : record;
      const photos = await db.photos
        .where("inspectionId")
        .equals(effective.id)
        .toArray();
      download(
        await generatePackage(
          effective,
          photos.map(fromStoredPhoto),
          await loadFont(),
        ),
        packageName(effective) + ".zip",
      );
      if (effective.status !== "Draft") {
        const exported = {
          ...effective,
          status: "Exported" as const,
          updatedAt: new Date().toISOString(),
        };
        await db.inspections.put(exported);
        if (activeRef.current?.id === effective.id) activate(exported);
      }
    }, "ZIP package generated and download requested.");
    setBusy(false);
  };
  const exportPDF = async () => {
    if (!(await flush()) || !activeRef.current) return;
    setBusy(true);
    await run(async () => {
      const record = activeRef.current!;
      const photos = (
        await db.photos.where("inspectionId").equals(record.id).toArray()
      ).map(fromStoredPhoto);
      download(
        await generatePDF(record, photos, await loadFont()),
        packageName(record) + ".pdf",
      );
    }, "PDF generated and download requested.");
    setBusy(false);
  };
  useEffect(() => {
    const current = activeRef.current;
    const stored = records.find((r) => r.id === current?.id);
    if (
      stored &&
      current &&
      !unsaved.current &&
      stored.updatedAt > current.updatedAt
    ) {
      activeRef.current = stored;
      setActive(stored);
    }
  }, [records]);
  const nav = [
    { id: "dashboard" as Page, label: "Overview", Icon: LayoutDashboard },
    { id: "records" as Page, label: "Inspection records", Icon: ClipboardList },
    { id: "photos" as Page, label: "Photographs", Icon: Images },
    { id: "report" as Page, label: "Reports & exports", Icon: Archive },
  ];
  const isEditor =
    page === "checklist" || page === "photos" || page === "report";
  const jumpTo = async (id: string) => {
    setMenuOpen(false);
    if (!(await flush())) return;
    setEditorSection(id);
    if (page !== "checklist") await navigate("checklist");
    window.setTimeout(
      () => document.getElementById(id)?.scrollIntoView({ block: "start" }),
      80,
    );
  };
  return (
    <div
      className={`app-shell ${isEditor && active ? "inspection-editor" : ""} ${page === "checklist" ? "checklist-screen" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            void navigate("dashboard");
          }}
        >
          <span className="brand-mark">
            <HardHat size={25} />
          </span>
          <span>
            Site Inspection<small>Local inspection records</small>
          </span>
        </a>
        <div className="workspace-label">
          WORKSPACE<span>LOCAL</span>
        </div>
        {isEditor && active && (
          <nav className="editor-section-nav" aria-label="Inspection sections">
            <button
              className={
                page === "checklist" && editorSection === "project-details"
                  ? "active"
                  : ""
              }
              onClick={() => void jumpTo("project-details")}
            >
              <FileText size={19} />
              Project details
            </button>
            <button
              className={
                page === "checklist" && editorSection === "inspection-checklist"
                  ? "active"
                  : ""
              }
              onClick={() => void jumpTo("inspection-checklist")}
            >
              <ClipboardCheck size={19} />
              Checklist ({progress(active).done}/{progress(active).total})
            </button>
            <button
              className={page === "photos" ? "active" : ""}
              onClick={() => void navigate("photos")}
            >
              <Images size={19} />
              Photo log
            </button>
            <button
              className={
                page === "checklist" && editorSection === "sign-off"
                  ? "active"
                  : ""
              }
              onClick={() => void jumpTo("sign-off")}
            >
              <CheckCircle2 size={19} />
              Sign-off
            </button>
          </nav>
        )}
        <nav
          aria-label="Main navigation"
          className={isEditor ? "workspace-navigation" : ""}
        >
          {(isEditor ? nav.slice(0, 2) : nav).map(({ id, label, Icon }) => (
            <button
              key={id}
              className={
                page === id ||
                (id === "records" && page === "checklist" && !isEditor)
                  ? "active"
                  : ""
              }
              aria-current={
                page === id ||
                (id === "records" && page === "checklist" && !isEditor)
                  ? "page"
                  : undefined
              }
              onClick={() => void navigate(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "records" && (
                <span className="nav-count" aria-hidden="true">
                  {records.length}
                </span>
              )}
            </button>
          ))}
        </nav>
        {!isEditor && (
          <Button
            className="sidebar-new"
            variant="outline"
            onClick={() =>
              void run(async () => {
                if (await flush()) setNewOpen(true);
              })
            }
          >
            <Plus size={17} />
            New inspection
          </Button>
        )}
        <div className="sidebar-bottom">
          <div className="device-private">
            <span>
              <ShieldCheck size={18} />
            </span>
            <strong>Stored on this device</strong>
            <p>Export a backup regularly.</p>
          </div>
          <button
            className={
              page === "settings" ? "sidebar-setting active" : "sidebar-setting"
            }
            onClick={() => void navigate("settings")}
          >
            <Settings2 size={19} />
            Settings
          </button>
          <div className="sidebar-profile">
            <ShieldCheck size={20} className="muted" />
            <div>
              <strong>Local workspace</strong>
              <small>No account required</small>
            </div>
            <span className="profile-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="header-identity">
            <strong>
              <img src={wspLogo} alt="WSP" className="wsp-logo" /> Site
              Inspection
            </strong>
            <span role="status" aria-live="polite">
              {isEditor && active
                ? active.status !== "Draft"
                  ? `${active.status} · Revision ${active.revision}`
                  : saveState === "Saved on device"
                    ? "Draft saved on this device"
                    : saveState
                : "Local inspection records"}
            </span>
          </div>
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span>/</span>
            <strong>
              {page === "dashboard"
                ? "Overview"
                : page === "records"
                  ? "Inspection records"
                  : page === "checklist"
                    ? "Inspection checklist"
                    : page === "photos"
                      ? "Photographs"
                      : page === "report"
                        ? "Report preview"
                        : "Settings"}
            </strong>
          </div>
          <div className="topbar-actions">
            <Button
              className="header-new"
              variant="outline"
              onClick={() =>
                void run(async () => {
                  if (await flush()) setNewOpen(true);
                })
              }
            >
              <Plus size={17} />
              New inspection
            </Button>
            <span
              className={`connection ${!online ? "is-offline" : ""}`}
              role="status"
              aria-label="Connection status"
              aria-live="polite"
              title="Records are saved locally on this device."
            >
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>{online ? "Online" : "Offline"}</span>
              <span className="connection-dot" />
            </span>
            <span className="topbar-divider" />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle dark mode"
              onClick={() =>
                setTheme(
                  document.documentElement.classList.contains("dark")
                    ? "light"
                    : "dark",
                )
              }
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </Button>
            <Button
              className="header-menu"
              variant="ghost"
              size="icon"
              aria-label="Open menu"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={22} />
            </Button>
          </div>
        </header>
        {needRefresh && (
          <div className="update-banner">
            A new app version is available.
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void run(async () => {
                  if (await flush()) await updateServiceWorker(true);
                })
              }
            >
              Save & update
            </Button>
          </div>
        )}
        {(unsaved.current || failedPhotos.current.length > 0) &&
          saveState === "Save failed" && (
            <div className="error-banner">
              Your latest changes have not been saved.
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void run(async () => {
                    if (unsaved.current && activeRef.current) {
                      save(activeRef.current);
                      await queue.current;
                    }
                    const retry = failedPhotos.current.splice(0);
                    for (const work of retry) await runPhoto(work);
                  })
                }
              >
                Retry save
              </Button>
            </div>
          )}
        <main id="main-content" tabIndex={-1}>
          {fatal ? (
            <div className="empty-state">
              <HardHat size={35} />
              <h1>Local storage unavailable</h1>
              <p role="alert">{fatal}</p>
              <p>
                Allow browser storage and reload. Records cannot be saved until
                storage is available.
              </p>
              <Button onClick={() => window.location.reload()}>Retry</Button>
            </div>
          ) : !initialized ? (
            <div className="empty-state">
              <Loader2 className="animate-spin" />
              <p>Opening your local workspace…</p>
            </div>
          ) : (
            <>
              {isEditor && active && (
                <div className="editor-navigation">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void navigate("records")}
                  >
                    <ArrowLeft size={15} />
                    All inspections
                  </Button>
                  <div className="editor-tabs">
                    {[
                      { id: "checklist", label: "Checklist" },
                      {
                        id: "photos",
                        label: `Photos (${selectedPhotos.length})`,
                      },
                      { id: "report", label: "Report" },
                    ].map((t) => (
                      <button
                        key={t.id}
                        className={page === t.id ? "active" : ""}
                        onClick={() => void navigate(t.id as Page)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <select
                    aria-label="Select inspection"
                    value={active.id}
                    onChange={(e) => {
                      const r = records.find((r) => r.id === e.target.value);
                      if (r) void open(r, page);
                    }}
                  >
                    {records.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.element} · {r.type} · {r.id.slice(-8)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {page === "dashboard" && (
                <Dashboard
                  records={records}
                  projects={projects}
                  onNew={() => setNewOpen(true)}
                  onOpen={(r) => void open(r)}
                  onRecords={(filter) => {
                    setRecordFilter(filter || "");
                    void navigate("records");
                  }}
                  onSettings={() => void navigate("settings")}
                />
              )}
              {page === "records" && (
                <Records
                  key={recordFilter}
                  records={records}
                  projects={projects}
                  initialFilter={recordFilter}
                  onNew={() => setNewOpen(true)}
                  onOpen={(r) => void open(r)}
                  onReport={(r) => void open(r, "report")}
                  onExport={(r) => void exportZIP(r)}
                  onDelete={setDeleting}
                  onRepeat={(r) =>
                    void run(async () => {
                      if (!(await flush())) return;
                      activate(await repeatInspection(r));
                      setPage("checklist");
                    }, "New repeat draft created. Previous results, photographs and report content were cleared.")
                  }
                />
              )}
              {page === "checklist" && active && (
                <Checklist
                  record={active}
                  photos={photoCache.current}
                  onChange={save}
                  run={runPhoto}
                  onPreview={() => void navigate("report")}
                  onPDF={() => void exportPDF()}
                  onDetails={() => setDetailsOpen(true)}
                  onPhotos={(item) =>
                    void run(async () => {
                      if (await flush()) {
                        setPhotoItem(item);
                        setPage("photos");
                      }
                    })
                  }
                  onComplete={() =>
                    void run(async () => {
                      if (!(await flush())) return;
                      activate(await finalize(activeRef.current!));
                    }, "Inspection completed. This does not represent formal approval.")
                  }
                  onReopen={() =>
                    save({
                      ...active,
                      status: "Draft",
                      revision: active.revision + 1,
                    })
                  }
                />
              )}
              {page === "photos" && active && (
                <PhotoManager
                  key={active.id + photoItem}
                  record={active}
                  photos={selectedPhotos}
                  defaultItem={photoItem}
                  run={run}
                />
              )}
              {page === "report" && active && (
                <Report
                  record={active}
                  photos={photoCache.current}
                  onExport={() => void exportZIP(active)}
                  onSaveDetails={async (dailyReport) => {
                    save({ ...activeRef.current!, dailyReport });
                    return flush();
                  }}
                />
              )}
              {isEditor && !active && (
                <div className="empty-state">
                  <ClipboardCheck size={36} />
                  <h2>Create an inspection first</h2>
                  <p>Photos and reports belong to an inspection record.</p>
                  <Button onClick={() => setNewOpen(true)}>
                    <Plus size={16} />
                    New inspection
                  </Button>
                </div>
              )}
              {page === "settings" && (
                <Settings
                  projects={projects}
                  templates={templates}
                  theme={theme}
                  onTheme={setTheme}
                  run={run}
                  offlineReady={offlineReady || cacheReady}
                  canInstall={!!installEvent}
                  install={() =>
                    void run(async () => {
                      await installEvent?.prompt();
                      await installEvent?.userChoice;
                      setInstallEvent(undefined);
                    })
                  }
                />
              )}
            </>
          )}
          <footer className="app-footer">
            <span>
              SITE INSPECTION{" "}
              <span className="footer-version">/ v1.0 demo</span>
            </span>
            <span>
              <ShieldCheck size={12} />
              Local storage · Keep regular backups
            </span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {[
          { id: "dashboard", label: "Overview", Icon: LayoutDashboard },
          { id: "records", label: "Records", Icon: ClipboardList },
          { id: "new", label: "New", Icon: Plus },
          { id: "photos", label: "Photos", Icon: Images },
          { id: "settings", label: "Settings", Icon: Settings2 },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            className={
              (page === id ? "active " : "") +
              (id === "new" ? "mobile-add" : "")
            }
            aria-current={
              page === id || (id === "records" && page === "checklist")
                ? "page"
                : undefined
            }
            onClick={() =>
              id === "new"
                ? void run(async () => {
                    if (await flush()) setNewOpen(true);
                  })
                : void navigate(id as Page)
            }
          >
            <span>
              <Icon size={21} />
            </span>
            <small>{label}</small>
          </button>
        ))}
      </nav>
      <Dialog
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title="Inspection menu"
      >
        <nav className="inspection-menu" aria-label="Inspection menu">
          {isEditor && active && (
            <>
              <Button
                variant="ghost"
                onClick={() => void jumpTo("project-details")}
              >
                Project details
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setMenuOpen(false);
                  void navigate("checklist");
                }}
              >
                Checklist
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setMenuOpen(false);
                  void navigate("photos");
                }}
              >
                Photos ({selectedPhotos.length})
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setMenuOpen(false);
                  void navigate("report");
                }}
              >
                Report
              </Button>
              <Button variant="ghost" onClick={() => void jumpTo("sign-off")}>
                Sign-off
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setMenuOpen(false);
              void navigate("dashboard");
            }}
          >
            Overview
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setMenuOpen(false);
              void navigate("records");
            }}
          >
            Records
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setMenuOpen(false);
              void navigate("settings");
            }}
          >
            Settings
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setMenuOpen(false);
              void run(async () => {
                if (await flush()) setNewOpen(true);
              });
            }}
          >
            New inspection
          </Button>
          <Button
            variant="ghost"
            aria-label="Toggle dark mode"
            onClick={() => {
              setTheme(theme === "dark" ? "light" : "dark");
              setMenuOpen(false);
            }}
          >
            Switch to {theme === "dark" ? "light" : "dark"} mode
          </Button>
        </nav>
      </Dialog>
      <Dialog
        open={newOpen}
        onOpenChange={setNewOpen}
        title="New inspection"
        description="Set up your field record. You can save and resume the checklist at any time."
        wide
      >
        <InspectionForm
          projects={projects}
          templates={templates}
          workspace={workspace}
          onCancel={() => setNewOpen(false)}
          onSubmit={async (details) => {
            await run(async () => {
              const t = templates.find((t) => t.name === details.type);
              if (!t) throw new Error("Select a valid template.");
              const p = projects.find((p) => p.id === details.projectId)!;
              const r = {
                ...newInspection(details, t),
                fictional: p.fictional,
              };
              await db.inspections.add(r);
              activate(r);
              setPage("checklist");
              setNewOpen(false);
            }, "Inspection draft created.");
          }}
        />
      </Dialog>
      <Dialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title="Inspection details"
        description={
          active?.status === "Draft"
            ? "Update the draft’s recorded details."
            : "Reopen the inspection as a new revision to edit its details."
        }
        wide
      >
        {active?.status === "Draft" ? (
          <InspectionForm
            projects={projects}
            templates={templates}
            initial={active}
            onCancel={() => setDetailsOpen(false)}
            onSubmit={async (details) => {
              save({
                ...activeRef.current!,
                ...details,
                fictional:
                  projects.find((p) => p.id === details.projectId)?.fictional ||
                  false,
              });
              if (await flush()) setDetailsOpen(false);
            }}
          />
        ) : (
          active && (
            <dl className="detail-list">
              {[
                ["Project", active.projectName],
                ["Reference", active.projectReference],
                ["Inspector", active.inspector],
                ["Role", active.role],
                ["Location", active.location],
                ["Date / time", active.date + " / " + active.time],
                ["Drawing", active.drawing],
                ["General remarks", active.remarks],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v || "Not recorded"}</dd>
                </div>
              ))}
            </dl>
          )
        )}
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(undefined)}
        title="Delete inspection?"
        description="This permanently removes the inspection and all its photographs from this device. Export a backup before deleting records you need to retain."
      >
        <p>
          <strong>{deleting?.element}</strong> · {deleting?.projectName}
        </p>
        <div className="form-actions">
          <Button variant="outline" onClick={() => setDeleting(undefined)}>
            Keep inspection
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              void run(async () => {
                await deleteInspection(deleting!.id);
                if (active?.id === deleting!.id) {
                  setActive(undefined);
                  activeRef.current = undefined;
                }
                setDeleting(undefined);
              }, "Inspection and its photographs deleted.")
            }
          >
            Delete inspection
          </Button>
        </div>
      </Dialog>
      {notice && (
        <div
          className={`toast ${notice.error ? "toast-error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? (
            <CircleAlert size={20} />
          ) : (
            <CheckCircle2 size={20} />
          )}
          <span>{notice.message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice(undefined)}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-overlay" role="status">
          <Loader2 size={25} className="animate-spin" />
          Preparing your inspection export…
        </div>
      )}
    </div>
  );
}
