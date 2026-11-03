import { useEffect, useState } from "react";
import { Check, Download, FileText, Plus, RotateCcw } from "lucide-react";
import {
  displayDate,
  progress,
  type Inspection,
  type PhotoView,
  type Response,
} from "../domain";
import { Button, Dialog, Field, StatusBadge } from "./ui";
import { ItemPhotos } from "./ItemPhotos";

export function Checklist({
  record,
  photos,
  onChange,
  onPhotos,
  onDetails,
  onReopen,
  onPreview,
  onPDF,
  run,
}: {
  record: Inspection;
  photos: PhotoView[];
  onChange: (r: Inspection) => void;
  onPhotos: (item: string) => void;
  onDetails: () => void;
  onReopen: () => void;
  onPreview: () => void;
  onPDF: () => void;
  run: (work: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false),
    [itemName, setItemName] = useState("");
  const p = progress(record),
    readOnly = record.status !== "Draft";
  const change = (id: string, patch: Partial<Response>) =>
    onChange({
      ...record,
      responses: {
        ...record.responses,
        [id]: { ...record.responses[id], ...patch },
      },
    });
  const detail = (
    key: "projectName" | "location" | "date" | "inspector",
    value: string,
  ) => onChange({ ...record, [key]: value });
  return (
    <div className="inspection-workspace">
      <div className="inspection-column">
        <div className="page-title inspection-title">
          <div>
            <h1>Inspection checklist</h1>
            <p>
              {record.element} · {record.type}
            </p>
          </div>
          <StatusBadge status={record.status} />
        </div>
        {readOnly && (
          // Inspections completed before sign-off was removed stay read-only
          // until reopened; the reopened copy is a new revision.
          <div className="notice reopen-notice" role="status">
            <span>
              This inspection is {record.status.toLowerCase()} and read-only.
            </span>
            <Button variant="outline" size="sm" onClick={onReopen}>
              Reopen to edit
            </Button>
          </div>
        )}
        {record.fictional && (
          <div className="notice">
            Fictional demonstration record. No project approval is represented.
          </div>
        )}
        {record.template.demo && (
          <div className="notice warning">
            Demonstration checklist. Configure approved project content in
            Settings.
          </div>
        )}
        <section
          id="project-details"
          className="inspection-section"
          aria-labelledby="project-details-title"
        >
          <div className="section-heading">
            <h2 id="project-details-title" className="section-label">
              Project details
            </h2>
            <Button variant="ghost" size="sm" onClick={onDetails}>
              <FileText size={15} />
              Details
            </Button>
          </div>
          <div className="card project-details-card">
            <Field
              label="Project name"
              error={
                !record.projectName.trim()
                  ? "Project name is required."
                  : undefined
              }
            >
              <input
                placeholder="[Project name]"
                value={record.projectName}
                maxLength={500}
                disabled={readOnly}
                onChange={(e) => detail("projectName", e.target.value)}
              />
            </Field>
            <Field
              label="Location / zone"
              error={
                !record.location.trim() ? "Location is required." : undefined
              }
            >
              <input
                placeholder="[Area or chainage]"
                value={record.location}
                maxLength={500}
                disabled={readOnly}
                onChange={(e) => detail("location", e.target.value)}
              />
            </Field>
            <Field
              label="Date"
              error={!record.date ? "Date is required." : undefined}
            >
              <input
                type="date"
                value={record.date}
                disabled={readOnly}
                onChange={(e) => detail("date", e.target.value)}
              />
            </Field>
            <Field
              label="Inspector"
              error={
                !record.inspector.trim() ? "Inspector is required." : undefined
              }
            >
              <input
                placeholder="[Name]"
                value={record.inspector}
                maxLength={500}
                disabled={readOnly}
                onChange={(e) => detail("inspector", e.target.value)}
              />
            </Field>
          </div>
        </section>
        <section
          id="inspection-checklist"
          className="inspection-section"
          aria-labelledby="checklist-title"
        >
          <div className="section-heading">
            <h2 id="checklist-title" className="section-label">
              Checklist · {p.done} of {p.total} items
            </h2>
            <span className="section-helper">{photos.length} photos</span>
          </div>
          <div className="checklist-items">
            {record.template.items.map((item, index) => {
              const r = record.responses[item.id],
                count = photos.filter((p) => p.itemId === item.id).length;
              return (
                <section
                  className="card checklist-item"
                  key={item.id}
                  aria-labelledby={`item-${item.id}`}
                >
                  <div className="item-heading">
                    <h3 id={`item-${item.id}`}>
                      {index + 1}. {item.description}
                    </h3>
                    <span>
                      {count} {count === 1 ? "photo" : "photos"}
                    </span>
                  </div>
                  <div className="item-status-cell">
                    <div
                      className="status-options"
                      role="group"
                      aria-label={`${item.description} status`}
                    >
                      {(["Pass", "Fail", "Not Applicable"] as const).map(
                        (status) => (
                          <button
                            type="button"
                            key={status}
                            className={`status-option ${r.status === status ? "selected" : ""}`}
                            data-status={status}
                            aria-pressed={r.status === status}
                            disabled={readOnly}
                            onClick={() => change(item.id, { status })}
                          >
                            {r.status === status && (
                              <Check size={15} aria-hidden="true" />
                            )}
                            {status === "Not Applicable" ? "N/A" : status}
                          </button>
                        ),
                      )}
                    </div>
                    <button
                      type="button"
                      className="clear-status"
                      disabled={readOnly || r.status === "Not Inspected"}
                      onClick={() =>
                        change(item.id, { status: "Not Inspected" })
                      }
                    >
                      <RotateCcw size={13} />
                      {r.status === "Not Inspected"
                        ? "Not inspected"
                        : "Clear status"}
                    </button>
                  </div>
                  <div className="item-date-cell">
                    <Field
                      label="Inspection date"
                      hint={r.date ? displayDate(r.date) : "Not recorded"}
                    >
                      <input
                        type="date"
                        value={r.date || ""}
                        disabled={readOnly}
                        aria-label={`Inspection date, item ${index + 1}`}
                        onChange={(e) =>
                          change(item.id, { date: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <div className="item-remarks-cell">
                    <Field
                      label={
                        r.status === "Fail"
                          ? "Remarks * (required for failed items)"
                          : "Remarks"
                      }
                      error={
                        r.status === "Fail" && !r.remarks.trim()
                          ? "Add a remark describing the failure."
                          : undefined
                      }
                    >
                      <textarea
                        rows={2}
                        value={r.remarks}
                        disabled={readOnly}
                        placeholder="[Remarks]"
                        onChange={(e) =>
                          change(item.id, { remarks: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <ItemPhotos
                    record={record}
                    itemId={item.id}
                    photos={photos}
                    run={run}
                    onManage={() => onPhotos(item.id)}
                  />
                </section>
              );
            })}
          </div>
          {!readOnly && (
            <Button
              variant="outline"
              className="add-inspection-item"
              onClick={() => setAdding(true)}
            >
              <Plus size={18} />
              Add inspection item
            </Button>
          )}
        </section>
      </div>
      <div className="inspection-pdf-bar">
        <Button variant="outline" onClick={onPreview}>
          Preview
        </Button>
        <Button className="btn-accent" onClick={onPDF}>
          <Download size={18} />
          Save as PDF
        </Button>
      </div>
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Add inspection item"
        description="Adds an item to this inspection’s checklist. The saved project template is unchanged."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!itemName.trim()) return;
            const id = `custom-${crypto.randomUUID()}`;
            onChange({
              ...record,
              template: {
                ...record.template,
                items: [
                  ...record.template.items,
                  { id, description: itemName.trim(), hint: "", fields: [] },
                ],
              },
              responses: {
                ...record.responses,
                [id]: {
                  status: "Not Inspected",
                  remarks: "",
                  reference: "",
                  values: {},
                },
              },
            });
            setItemName("");
            setAdding(false);
          }}
        >
          <Field label="Item name">
            <input
              required
              autoFocus
              maxLength={500}
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="[Inspection item]"
            />
          </Field>
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!itemName.trim()}>
              Add item
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
