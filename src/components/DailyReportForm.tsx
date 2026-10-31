import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import {
  dailyReportSchema,
  dailyReportDefaults,
  type DailyReport,
} from "../daily-report";
import type { Inspection } from "../domain";
import { Button, Field } from "./ui";
export function DailyReportForm({
  record,
  onSave,
  onCancel,
}: {
  record: Inspection;
  onSave: (details: DailyReport) => Promise<boolean>;
  onCancel: () => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DailyReport>({
    resolver: zodResolver(dailyReportSchema),
    defaultValues: dailyReportDefaults(record),
  });
  const staff = useFieldArray({ control, name: "staff" }),
    work = useFieldArray({ control, name: "workDone" }),
    testing = useFieldArray({ control, name: "testing" });
  const readOnly = record.status !== "Draft";
  const simple = (
    name: keyof Pick<
      DailyReport,
      | "reportNumber"
      | "reportPeriod"
      | "supervisionTitle"
      | "preparedBy"
      | "commencementDate"
      | "completionDate"
      | "contractPeriod"
      | "timeElapsed"
      | "timeRemaining"
      | "memosIssued"
      | "memosTotal"
    >,
    label: string,
    placeholder = "",
  ) => (
    <Field key={name} label={label} error={errors[name]?.message}>
      <input
        {...register(name)}
        placeholder={placeholder}
        disabled={readOnly}
      />
    </Field>
  );
  const narrative = (
    name: keyof Pick<
      DailyReport,
      | "activities"
      | "safety"
      | "weather"
      | "rfi"
      | "instructions"
      | "nonCompliance"
    >,
    label: string,
  ) => (
    <Field key={name} label={label} error={errors[name]?.message}>
      <textarea
        {...register(name)}
        rows={3}
        disabled={readOnly}
        placeholder="Enter the recorded information, or explicitly enter Nil where appropriate."
      />
    </Field>
  );
  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        if (await onSave(data)) onCancel();
      })}
    >
      <p className="notice">
        Blank fields print as “Not recorded”. Enter Nil only when that is your
        recorded observation. This report does not represent approval or a
        digital signature.
      </p>
      {readOnly && (
        <p className="notice warning">
          This record is read-only. Reopen it as a revision from the Checklist
          to edit report details.
        </p>
      )}
      <div className="form-section-label">REPORT HEADER</div>
      <div className="form-grid">
        {simple(
          "reportNumber",
          "Daily site report number",
          "Uses the inspection ID if blank",
        )}
        {simple(
          "reportPeriod",
          "Report period",
          "Uses the inspection date if blank",
        )}
        {simple(
          "supervisionTitle",
          "Supervision title",
          "e.g. TCP T3 Site Supervisor",
        )}
        {simple("preparedBy", "Prepared by", record.inspector)}
      </div>
      <div className="form-section-label">1. CONTRACT STATUS (FIELD WORKS)</div>
      <div className="form-grid">
        {simple("commencementDate", "Commencement date", "e.g. 15 April 2026")}
        {simple(
          "completionDate",
          "Completion date",
          "e.g. 15 July 2026 (Stage 1)",
        )}
        {simple("timeElapsed", "Time elapsed", "e.g. 38 days (42.2%)")}
        {simple("timeRemaining", "Time remaining", "e.g. 52 days")}
        {simple("contractPeriod", "Contract period", "e.g. 90 calendar days")}
      </div>
      <div className="form-section-label">2. SITE ACTIVITIES</div>
      {narrative("activities", "Recorded site activities (one per line)")}
      <div className="report-form-heading">
        <div className="form-section-label">3. SITE STAFF / VISITORS</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly || staff.fields.length >= 100}
          onClick={() =>
            staff.append({ occupation: "", company: "", people: "" })
          }
        >
          <Plus size={14} />
          Add staff row
        </Button>
      </div>
      {staff.fields.map((row, i) => (
        <div className="report-entry" key={row.id}>
          <div className="form-grid">
            {(["occupation", "company", "people"] as const).map((key) => (
              <Field
                key={key}
                label={
                  key === "people"
                    ? "Number of people"
                    : key === "occupation"
                      ? "Occupation"
                      : "Company"
                }
                error={errors.staff?.[i]?.[key]?.message}
              >
                <input {...register(`staff.${i}.${key}`)} disabled={readOnly} />
              </Field>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={readOnly}
            aria-label={`Remove staff row ${i + 1}`}
            onClick={() => staff.remove(i)}
          >
            <Trash2 size={14} />
            Remove row
          </Button>
        </div>
      ))}
      <div className="form-section-label">
        4–9. SITE OBSERVATIONS & CORRESPONDENCE
      </div>
      <div className="form-grid">
        {narrative("safety", "4. Safety / fire safety / site security")}
        {narrative("weather", "5. Weather")}
        {narrative("rfi", "6. RFI received today")}
        {narrative("instructions", "7. Architect instruction")}
        {narrative("nonCompliance", "8. Non-compliance")}
        <div>
          {simple("memosIssued", "9. Memos issued during report period")}
          {simple("memosTotal", "Total memos issued")}
        </div>
      </div>
      <div className="report-form-heading">
        <div className="form-section-label">10. WORK DONE</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly || work.fields.length >= 300}
          onClick={() =>
            work.append({
              activity: "",
              rigs: "",
              element: "",
              commencement: "",
              progress: "",
              status: "",
              completion: "",
            })
          }
        >
          <Plus size={14} />
          Add work row
        </Button>
      </div>
      {work.fields.map((row, i) => (
        <div className="report-entry" key={row.id}>
          <div className="form-grid">
            {(
              [
                { key: "activity", label: "Work activity" },
                { key: "rigs", label: "Number of drilling rigs" },
                { key: "element", label: "Element / borehole number" },
                { key: "commencement", label: "Date of commencement" },
                { key: "progress", label: "Progress of work" },
                { key: "status", label: "Work status" },
                { key: "completion", label: "Date of completion" },
              ] as const
            ).map(({ key, label }) => (
              <Field
                key={key}
                label={label}
                error={errors.workDone?.[i]?.[key]?.message}
              >
                <input
                  {...register(`workDone.${i}.${key}`)}
                  disabled={readOnly}
                />
              </Field>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={readOnly}
            aria-label={`Remove work row ${i + 1}`}
            onClick={() => work.remove(i)}
          >
            <Trash2 size={14} />
            Remove row
          </Button>
        </div>
      ))}
      <div className="report-form-heading">
        <div className="form-section-label">11. TESTING</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly || testing.fields.length >= 100}
          onClick={() => testing.append({ type: "", completed: "" })}
        >
          <Plus size={14} />
          Add testing row
        </Button>
      </div>
      {testing.fields.map((row, i) => (
        <div className="report-entry" key={row.id}>
          <div className="form-grid">
            <Field
              label="Type of testing"
              error={errors.testing?.[i]?.type?.message}
            >
              <input {...register(`testing.${i}.type`)} disabled={readOnly} />
            </Field>
            <Field
              label="Completed testing"
              error={errors.testing?.[i]?.completed?.message}
            >
              <input
                {...register(`testing.${i}.completed`)}
                disabled={readOnly}
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={readOnly}
            aria-label={`Remove testing row ${i + 1}`}
            onClick={() => testing.remove(i)}
          >
            <Trash2 size={14} />
            Remove row
          </Button>
        </div>
      ))}
      <div className="form-actions">
        <Button type="button" variant="outline" onClick={onCancel}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {!readOnly && (
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? "Saving…" : "Save report details"}
          </Button>
        )}
      </div>
    </form>
  );
}
