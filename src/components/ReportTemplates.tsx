import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { errorMessage, type Inspection } from "../domain";
import {
  applyReportTemplate,
  loadReportTemplates,
  makeReportTemplate,
  storeReportTemplate,
  reportTemplateKey,
  type TemplateChoices,
} from "../report-templates";
import type { DailyReport } from "../daily-report";
import { Button, Dialog, Field } from "./ui";
export function ReportTemplates({
  record,
  onApply,
}: {
  record?: Inspection;
  onApply?: (data: DailyReport) => Promise<boolean>;
}) {
  const templates = useLiveQuery(loadReportTemplates, [], []);
  const [selected, setSelected] = useState(""),
    [saving, setSaving] = useState(false),
    [name, setName] = useState(""),
    [replace, setReplace] = useState(false),
    [deleting, setDeleting] = useState(false),
    [renaming, setRenaming] = useState(false),
    [applying, setApplying] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [choices, setChoices] = useState<TemplateChoices>({
    header: true,
    contract: true,
    tables: true,
    wording: [],
  });
  const current = templates.find((t) => t.id === selected);
  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card template-panel" aria-label="Report templates">
      <div className="card-header">
        <div>
          <h2>Report templates</h2>
          <p>
            Reusable report defaults, stored on this device and included in
            backups.
          </p>
        </div>
      </div>
      <div className="settings-body">
        <Field label="Saved report template">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select a template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.id.slice(0, 6)}
              </option>
            ))}
          </select>
        </Field>
        <div className="row wrap">
          {record && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setMessage("");
                setName("");
                setReplace(false);
                setSaving(true);
              }}
            >
              Save as template
            </Button>
          )}
          {record && (
            <Button
              disabled={!current || busy || record.status !== "Draft"}
              onClick={() => {
                setMessage("");
                setApplying(true);
              }}
            >
              Use template
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={!current || busy}
            onClick={() => {
              setMessage("");
              setName(current?.name || "");
              setRenaming(true);
            }}
          >
            Rename template
          </Button>
          <Button
            variant="ghost"
            disabled={!current || busy}
            onClick={() => setDeleting(true)}
          >
            Delete template
          </Button>
        </div>
        <p className="small muted">
          Templates keep selected defaults and empty table structures.
          Inspection date, report number, people counts, progress, results,
          photos, GPS, weather and signatures are never copied. Apply fills
          empty fields only.
        </p>
        {current && (
          <details className="template-contents">
            <summary>View template contents</summary>
            <dl>
              <dt>Title</dt>
              <dd>{current.defaults.supervisionTitle || "Not set"}</dd>
              <dt>Contract</dt>
              <dd>
                {[
                  current.defaults.commencementDate,
                  current.defaults.completionDate,
                  current.defaults.contractPeriod,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Not set"}
              </dd>
              <dt>Empty table rows</dt>
              <dd>
                {current.defaults.staff.length} staff ·{" "}
                {current.defaults.workActivities.length} work ·{" "}
                {current.defaults.testTypes.length} testing
              </dd>
              <dt>Reusable wording</dt>
              <dd>
                {Object.entries(current.defaults.wording)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <p key={k}>
                      <strong>{k}:</strong> {v}
                    </p>
                  ))}
              </dd>
            </dl>
          </details>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
      </div>
      <Dialog
        open={saving}
        onOpenChange={setSaving}
        title="Save report template"
        description="Choose reusable content from this saved report. Actual results and evidence are excluded."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!record) return;
            void run(async () => {
              const t = makeReportTemplate(
                record,
                name,
                choices,
                replace ? current : undefined,
              );
              await storeReportTemplate(t);
              setSelected(t.id);
              setSaving(false);
            }, "Report template saved.");
          }}
        >
          {message && (
            <p role="alert" className="notice">
              {message}
            </p>
          )}
          <Field label="Report template name">
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {(
            [
              ["header", "Supervision title"],
              ["contract", "Contract dates and period"],
              ["tables", "Staff roles/companies and empty work/testing rows"],
            ] as const
          ).map(([key, label]) => (
            <label className="checkbox-label" key={key}>
              <input
                type="checkbox"
                checked={choices[key]}
                onChange={(e) =>
                  setChoices({ ...choices, [key]: e.target.checked })
                }
              />
              {label}
            </label>
          ))}
          <p className="small muted">
            Optional wording: only select text intended for reuse. Review it
            before each inspection.
          </p>
          {(["activities", "safety", "instructions"] as const).map((key) => (
            <label className="checkbox-label" key={key}>
              <input
                type="checkbox"
                checked={choices.wording.includes(key)}
                onChange={(e) =>
                  setChoices({
                    ...choices,
                    wording: e.target.checked
                      ? [...choices.wording, key]
                      : choices.wording.filter((v) => v !== key),
                  })
                }
              />
              Reusable {key} wording
            </label>
          ))}
          {current && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => {
                  setReplace(e.target.checked);
                  if (e.target.checked) setName(current.name);
                }}
              />
              Replace selected template: {current.name}. Existing reports stay
              unchanged.
            </label>
          )}
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSaving(false)}
            >
              Cancel
            </Button>
            <Button disabled={busy} type="submit">
              Save template
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={applying}
        onOpenChange={setApplying}
        title="Apply report template"
        description="Fills empty header, contract and selected wording fields. Existing report values and tables are preserved. Review all defaults before completing the report."
      >
        {message && (
          <p role="alert" className="notice">
            {message}
          </p>
        )}
        <p>{current?.name}</p>
        <div className="form-actions">
          <Button variant="outline" onClick={() => setApplying(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              if (record && current && onApply)
                void run(async () => {
                  if (!(await onApply(applyReportTemplate(record, current))))
                    throw new Error(
                      "Template was not saved. Retry after resolving the save error.",
                    );
                  setApplying(false);
                }, "Template applied to empty fields. Review the report details.");
            }}
          >
            Apply template
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename report template"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (current)
              void run(async () => {
                await storeReportTemplate({
                  ...current,
                  name,
                  updatedAt: new Date().toISOString(),
                });
                setRenaming(false);
              }, "Template renamed.");
          }}
        >
          {message && (
            <p role="alert" className="notice">
              {message}
            </p>
          )}
          <Field label="New template name">
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenaming(false)}
            >
              Cancel
            </Button>
            <Button disabled={busy} type="submit">
              Rename
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete report template?"
        description="Deletes only this reusable template. Existing inspections and reports are unchanged."
      >
        {message && (
          <p role="alert" className="notice">
            {message}
          </p>
        )}
        <p>{current?.name}</p>
        <div className="form-actions">
          <Button variant="outline" onClick={() => setDeleting(false)}>
            Keep template
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (current)
                void run(async () => {
                  await db.meta.delete(reportTemplateKey(current.id));
                  setSelected("");
                  setDeleting(false);
                }, "Template deleted.");
            }}
          >
            Delete template permanently
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
