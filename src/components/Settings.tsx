import { useRef, useState } from "react";
import {
  ArchiveRestore,
  Check,
  Download,
  FolderPlus,
  HardDrive,
  Laptop,
  Moon,
  Pencil,
  Plus,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { db, deleteProject } from "../db";
import { createBackup, importBackup } from "../backup";
import { download } from "../export";
import {
  localDate,
  projectSchema,
  templateSchema,
  type Project,
  type Template,
} from "../domain";
import { Button, Dialog, Field } from "./ui";
export function Settings({
  projects,
  templates,
  theme,
  onTheme,
  run,
  install,
  canInstall,
  offlineReady,
}: {
  projects: Project[];
  templates: Template[];
  theme: string;
  onTheme: (s: string) => void;
  run: (work: () => Promise<unknown>, success?: string) => Promise<void>;
  install: () => void;
  canInstall: boolean;
  offlineReady: boolean;
}) {
  const [project, setProject] = useState<Partial<Project>>(),
    [deleting, setDeleting] = useState<Project>(),
    [importFile, setImportFile] = useState<File>(),
    [busy, setBusy] = useState(false),
    [template, setTemplate] = useState<Template>(),
    [templateText, setTemplateText] = useState(""),
    [storage, setStorage] = useState(""),
    [fontName, setFontName] = useState("");
  const backupInput = useRef<HTMLInputElement>(null),
    fontInput = useRef<HTMLInputElement>(null);
  const job = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    await run(fn, success);
    setBusy(false);
  };
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">MAKE IT YOUR WORKSPACE</div>
          <h1>Settings</h1>
          <p>Projects, local storage and your offline setup.</p>
        </div>
        <span className="privacy-pill">
          <ShieldCheck size={15} />
          Device only
        </span>
      </div>
      <div className="settings-grid">
        <div>
          <section className="card settings-section">
            <div className="card-header">
              <div>
                <h2>Projects</h2>
                <p>Organise records by project.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setProject({ name: "", reference: "", fictional: false })
                }
              >
                <Plus size={16} />
                Add project
              </Button>
            </div>
            {projects.map((p) => (
              <div className="project-row" key={p.id}>
                <span className="record-icon blue">
                  <FolderPlus size={20} />
                </span>
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    {p.reference}
                    {p.fictional ? " · Fictional demo" : ""}
                  </small>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${p.name}`}
                  onClick={() => setProject({ ...p })}
                >
                  <Pencil size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete project ${p.name}`}
                  className="text-danger"
                  onClick={() => setDeleting(p)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
          </section>
          <section className="card settings-section">
            <div className="card-header">
              <div>
                <h2>Backup & restore</h2>
                <p>
                  A complete archive of records, templates and original photos.
                </p>
              </div>
              <HardDrive size={21} className="text-blue" />
            </div>
            <div className="settings-body">
              <div className="notice warning">
                Browser storage is not a permanent archive. The browser or
                operating system can clear it. Export backups regularly and
                store them somewhere safe.
              </div>
              <div className="row wrap">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void job(
                      async () =>
                        download(
                          await createBackup(),
                          `Site_Inspection_Backup_${localDate()}_${Date.now()}.zip`,
                        ),
                      "Local backup downloaded.",
                    )
                  }
                >
                  <Download size={16} />
                  Export local backup
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => backupInput.current?.click()}
                >
                  <ArchiveRestore size={16} />
                  Import backup
                </Button>
              </div>
              <input
                ref={backupInput}
                type="file"
                accept=".zip,application/zip"
                aria-label="Choose backup"
                hidden
                onChange={(e) => {
                  setImportFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <p className="small muted">
                Imports are validated before saving. Conflicting inspection IDs
                are rejected, preserving existing local work. Inspection
                packages are for reporting; use a Settings backup for restore.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void run(async () => {
                    if (!navigator.storage?.estimate) {
                      setStorage(
                        "Storage estimates are unavailable in this browser.",
                      );
                      return;
                    }
                    const estimate = await navigator.storage.estimate();
                    const persistent = await navigator.storage.persisted?.();
                    setStorage(
                      `${((estimate.usage || 0) / 1024 / 1024).toFixed(1)} MB used · ${((estimate.quota || 0) / 1024 / 1024).toFixed(0)} MB browser quota · ${persistent ? "persistent storage granted" : "best-effort storage"}`,
                    );
                  })
                }
              >
                Check device storage
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void run(async () => {
                    const result = await navigator.storage?.persist?.();
                    setStorage(
                      result
                        ? "Persistent storage granted. Continue to keep backups."
                        : "Persistent storage was not granted or is unsupported. Keep regular backups.",
                    );
                  })
                }
              >
                Request persistent storage
              </Button>
              {storage && (
                <p role="status" className="small muted">
                  {storage}
                </p>
              )}
            </div>
          </section>
          <section className="card settings-section">
            <div className="card-header">
              <div>
                <h2>Checklist templates</h2>
                <p>JSON-based, versioned and stored locally.</p>
              </div>
            </div>
            <div className="settings-body">
              <p className="small muted">
                Existing inspections retain an exact template snapshot. Editing
                a template applies only to new inspections. Optional criteria
                require both text and a documentReference. No criteria are
                supplied; verify project approval before entering them.
                Compliance is never calculated.
              </p>
              {templates.map((t) => (
                <div key={t.id} className="template-row">
                  <div>
                    <strong>{t.name}</strong>
                    <small>
                      {t.version} · {t.items.length} items
                      {t.demo ? " · Demonstration placeholder" : ""}
                    </small>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTemplate(t);
                      setTemplateText(JSON.stringify(t, null, 2));
                    }}
                  >
                    Configure JSON
                  </Button>
                </div>
              ))}
            </div>
          </section>
          <section className="card settings-section">
            <div className="card-header">
              <div>
                <h2>Appearance & reports</h2>
                <p>Choose your display mode and optional report font.</p>
              </div>
            </div>
            <div className="settings-body">
              <div className="theme-options">
                {[
                  { value: "light", Icon: Sun, label: "Light" },
                  { value: "dark", Icon: Moon, label: "Dark" },
                  { value: "system", Icon: Laptop, label: "System" },
                ].map(({ value, Icon, label }) => (
                  <button
                    key={value}
                    className={theme === value ? "selected" : ""}
                    aria-pressed={theme === value}
                    onClick={() => onTheme(value)}
                  >
                    <Icon size={19} />
                    {label}
                    {theme === value && <Check size={14} />}
                  </button>
                ))}
              </div>
              <div className="divider" />
              <h3>Unicode PDF font</h3>
              <p className="small muted">
                The default report font supports Latin text. For other scripts,
                add a licensed TrueType font (.ttf) containing all needed
                glyphs. The font stays on this device. Keep the font separately;
                it is not included in backups.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fontInput.current?.click()}
              >
                <Upload size={15} />
                Add local .ttf font
              </Button>{" "}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void run(async () => {
                    await db.meta.delete("reportFont");
                    setFontName("Default Latin font restored.");
                  })
                }
              >
                Use default
              </Button>
              {fontName && <p className="small muted">{fontName}</p>}
              <input
                ref={fontInput}
                hidden
                type="file"
                accept=".ttf"
                aria-label="Choose report font"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file)
                    void run(async () => {
                      if (file.size > 15 * 1024 * 1024)
                        throw new Error("Font must be smaller than 15 MB.");
                      const bytes = new Uint8Array(await file.arrayBuffer());
                      if (!(
                        (bytes[0] === 0 &&
                          bytes[1] === 1 &&
                          bytes[2] === 0 &&
                          bytes[3] === 0) ||
                        String.fromCharCode(...bytes.slice(0, 4)) === "true"
                      ))
                        throw new Error("Select a valid TrueType .ttf font.");
                      let raw = "";
                      for (let i = 0; i < bytes.length; i += 8192)
                        raw += String.fromCharCode(
                          ...bytes.subarray(i, i + 8192),
                        );
                      await db.meta.put({
                        key: "reportFont",
                        value: btoa(raw),
                      });
                      setFontName(
                        `${file.name} saved. Verify all characters in your report preview.`,
                      );
                    });
                }}
              />
            </div>
          </section>
        </div>
        <aside>
          <section className="card settings-section installation">
            <div className="settings-body">
              <span className="install-icon">
                <Smartphone size={25} />
              </span>
              <h2>Offline installation</h2>
              <p>Install the app and cache its assets before going offline.</p>
              <div className={`cache-status ${offlineReady ? "ready" : ""}`}>
                <span className="live-dot" />
                {offlineReady
                  ? "App assets cached for offline use"
                  : "Open the production build to cache assets"}
              </div>
              {canInstall && (
                <Button onClick={install} className="full-width">
                  <Download size={16} />
                  Install app
                </Button>
              )}
              <h4>iPhone · Safari</h4>
              <p>
                Open the site in Safari. Tap Share, then Add to Home Screen, and
                Add. Wait for the offline-ready message before disconnecting.
              </p>
              <h4>Android · Chrome</h4>
              <p>
                Open the browser menu and choose Install app or Add to Home
                screen.
              </p>
              <h4>Windows · Chrome / Edge</h4>
              <p>
                Use the install icon in the address bar, or the browser menu’s
                Install app option.
              </p>
              <h4>macOS · Safari / Chrome</h4>
              <p>
                In supported Safari versions choose File → Add to Dock. In
                Chrome use the address bar’s install icon.
              </p>
              <div className="divider" />
              <p className="small muted">
                Initial installation needs HTTPS or localhost. Camera access and
                sharing depend on browser support. Wait for assets to cache,
                then try a reload offline. Browser profiles and devices do not
                share records.
              </p>
            </div>
          </section>
          <div className="subtle-note">
            <ShieldCheck size={20} />
            <span>
              No accounts, cloud storage, analytics or telemetry. All processing
              happens in your browser.
            </span>
          </div>
        </aside>
      </div>
      <Dialog
        open={!!project}
        onOpenChange={(v) => !v && setProject(undefined)}
        title={project?.id ? "Edit project" : "Add project"}
        description="Project changes apply to new inspections. Existing records retain their recorded project details."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const p = projectSchema.parse({
                ...project,
                id: project?.id || crypto.randomUUID(),
              });
              await db.projects.put(p);
              setProject(undefined);
            }, "Project saved.");
          }}
        >
          <Field label="Project name *">
            <input
              required
              maxLength={500}
              value={project?.name || ""}
              onChange={(e) => setProject({ ...project, name: e.target.value })}
            />
          </Field>
          <Field label="Project reference *">
            <input
              required
              maxLength={500}
              value={project?.reference || ""}
              onChange={(e) =>
                setProject({ ...project, reference: e.target.value })
              }
            />
          </Field>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={project?.fictional || false}
              onChange={(e) =>
                setProject({ ...project, fictional: e.target.checked })
              }
            />
            Fictional demonstration project
          </label>
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setProject(undefined)}
            >
              Cancel
            </Button>
            <Button type="submit">Save project</Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(undefined)}
        title="Delete project?"
        description="Projects containing inspection records cannot be deleted."
      >
        <p>{deleting?.name}</p>
        <div className="form-actions">
          <Button variant="outline" onClick={() => setDeleting(undefined)}>
            Keep project
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              void run(async () => {
                await deleteProject(deleting!.id);
                setDeleting(undefined);
              }, "Project deleted.")
            }
          >
            Delete project
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!importFile}
        onOpenChange={(v) => !v && setImportFile(undefined)}
        title="Import local backup"
        description="This adds validated records and photos. Untouched fictional starter records may be replaced. Conflicts with your own records are rejected without partial changes."
      >
        <p>{importFile?.name}</p>
        <div className="form-actions">
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => setImportFile(undefined)}
          >
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void job(async () => {
                const n = await importBackup(importFile!);
                setImportFile(undefined);
                return n;
              }, "Backup imported successfully.")
            }
          >
            {busy ? "Validating & importing…" : "Import backup"}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!template}
        onOpenChange={(v) => !v && setTemplate(undefined)}
        title="Configure checklist JSON"
        description="Change the version when editing. Placeholder categories must remain marked as demonstration content in this demo."
        wide
      >
        <textarea
          className="json-editor mono"
          spellCheck={false}
          rows={18}
          value={templateText}
          onChange={(e) => setTemplateText(e.target.value)}
        />
        <div className="form-actions">
          <Button variant="outline" onClick={() => setTemplate(undefined)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              void run(async () => {
                const next = templateSchema.parse(JSON.parse(templateText));
                if (next.id !== template!.id || next.name !== template!.name)
                  throw new Error(
                    "Keep the existing template ID and category name.",
                  );
                if (next.version === template!.version)
                  throw new Error("Give the edited template a new version.");
                if (next.id !== "sheet-pile" && !next.demo)
                  throw new Error(
                    "Placeholder templates must remain marked as demonstration content.",
                  );
                if (
                  new Set(next.items.map((i) => i.id)).size !==
                  next.items.length
                )
                  throw new Error("Checklist item IDs must be unique.");
                for (const item of next.items)
                  if (
                    new Set(item.fields.map((f) => f.key)).size !==
                    item.fields.length
                  )
                    throw new Error(
                      "Measurement keys must be unique within each item.",
                    );
                await db.templates.put(next);
                setTemplate(undefined);
              }, "Template saved. Existing inspections keep their recorded version.")
            }
          >
            Save new version
          </Button>
        </div>
      </Dialog>
    </>
  );
}
