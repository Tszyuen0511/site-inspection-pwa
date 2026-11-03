import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  detailsSchema,
  localDate,
  type Details,
  type Project,
  type Template,
  type Workspace,
} from "../domain";
import { Button, Field } from "./ui";
export function InspectionForm({
  projects,
  templates,
  initial,
  workspace = {},
  onSubmit,
  onCancel,
}: {
  projects: Project[];
  templates: Template[];
  initial?: Details;
  workspace?: Workspace;
  onSubmit: (data: Details) => Promise<void>;
  onCancel: () => void;
}) {
  const first =
    projects.find((p) => p.id === workspace.defaultProjectId) || projects[0];
  const now = new Date();
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Details>({
    resolver: zodResolver(detailsSchema),
    defaultValues: initial || {
      projectId: first?.id || "",
      projectName: first?.name || "",
      projectReference: first?.reference || "",
      date: localDate(),
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      type: "Sheet Pile",
      element: "",
      location: first?.defaultLocation || "",
      inspector: workspace.inspector?.name || "",
      role: workspace.inspector?.role || "TCP T3",
      company: workspace.inspector?.company || "",
      drawing: first?.defaultDrawing || "",
      remarks: "",
    },
  });
  const type = watch("type");
  return (
    <form
      onSubmit={handleSubmit((data) => onSubmit(data))}
      className="inspection-form"
    >
      <div className="form-section-label">PROJECT & ELEMENT</div>
      <Field label="Project *" error={errors.projectId?.message}>
        <select
          {...register("projectId")}
          onChange={(e) => {
            const p = projects.find((p) => p.id === e.target.value);
            setValue("projectId", e.target.value, { shouldValidate: true });
            setValue("projectName", p?.name || "");
            setValue("projectReference", p?.reference || "");
            if (!initial) {
              setValue("location", p?.defaultLocation || "");
              setValue("drawing", p?.defaultDrawing || "");
            }
          }}
        >
          <option value="" disabled>
            Select a project
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      {!projects.length && (
        <p className="notice">
          Add a project in Settings before creating an inspection.
        </p>
      )}
      <div className="form-grid">
        <Field
          label="Project reference *"
          error={errors.projectReference?.message}
        >
          <input {...register("projectReference")} readOnly />
        </Field>
        <Field label="Inspection type *" error={errors.type?.message}>
          {initial ? (
            <input {...register("type")} readOnly />
          ) : (
            <select {...register("type")}>
              {templates.map((t) => (
                <option key={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {templates.find((t) => t.name === type)?.demo && (
        <p className="notice">
          Demonstration template only. These items are not approved engineering
          criteria.
        </p>
      )}
      <div className="form-grid">
        <Field label="Element identification *" error={errors.element?.message}>
          <input {...register("element")} placeholder="[Element reference]" />
        </Field>
        <Field label="Location / chainage *" error={errors.location?.message}>
          <input {...register("location")} placeholder="[Area or chainage]" />
        </Field>
      </div>
      <div className="form-section-label">INSPECTION DETAILS</div>
      <div className="form-grid">
        <Field label="Inspection date *" error={errors.date?.message}>
          <input type="date" {...register("date")} />
        </Field>
        <Field label="Inspection time *" error={errors.time?.message}>
          <input type="time" {...register("time")} />
        </Field>
        <Field label="Inspector name *" error={errors.inspector?.message}>
          <input {...register("inspector")} placeholder="[Name]" />
        </Field>
        <Field label="Inspector role *" error={errors.role?.message}>
          <input {...register("role")} list="roles" />
          <datalist id="roles">
            <option>TCP T3</option>
            <option>ARE</option>
            <option>Site Engineer</option>
            <option>Resident Engineer</option>
          </datalist>
        </Field>
      </div>
      <Field label="Inspector company" error={errors.company?.message}>
        <input
          {...register("company")}
          maxLength={500}
          placeholder="[Company]"
        />
      </Field>
      {!initial && !workspace.inspector && (
        <p className="notice">
          Set up your inspector profile in Settings to prefill your name, role
          and company next time.
        </p>
      )}
      <Field
        label="Drawing / specification reference"
        error={errors.drawing?.message}
      >
        <input
          {...register("drawing")}
          placeholder="[Drawing number and revision]"
        />
      </Field>
      <div className="form-actions">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={isSubmitting || !projects.length} type="submit">
          {isSubmitting
            ? "Saving…"
            : initial
              ? "Save details"
              : "Create inspection"}
        </Button>
      </div>
    </form>
  );
}
