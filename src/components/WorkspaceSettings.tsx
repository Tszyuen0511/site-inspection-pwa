import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { loadWorkspace, saveWorkspace } from "../db";
import {
  inspectorProfileSchema,
  type Project,
  type Workspace,
} from "../domain";
import { Button, Field } from "./ui";

function ProfileForm({
  initial,
  projects,
  run,
}: {
  initial: Workspace;
  projects: Project[];
  run: (work: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial.inspector?.name || "");
  const [role, setRole] = useState(initial.inspector?.role || "TCP T3");
  const [company, setCompany] = useState(initial.inspector?.company || "");
  const [projectId, setProjectId] = useState(initial.defaultProjectId || "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="settings-body"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void run(async () => {
          const inspector = inspectorProfileSchema.parse({
            name,
            role,
            company,
          });
          await saveWorkspace({
            inspector,
            defaultProjectId: projectId || undefined,
          });
        }, "Inspector profile and project default saved.").finally(() =>
          setBusy(false),
        );
      }}
    >
      <p className="small muted">
        Set up once on this device. New inspections use these details; existing
        records keep their recorded inspector and project details. No account is
        created.
      </p>
      <div className="form-grid">
        <Field label="Profile inspector name *">
          <input
            required
            maxLength={500}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </Field>
        <Field label="Profile inspector role *">
          <input
            required
            maxLength={500}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </Field>
        <Field label="Profile inspector company *">
          <input
            required
            maxLength={500}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            autoComplete="organization"
          />
        </Field>
        <Field label="Default project">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">No preference (first available project)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Button disabled={busy} type="submit">
        {busy ? "Saving…" : "Save profile & defaults"}
      </Button>
    </form>
  );
}
export function WorkspaceSettings({
  projects,
  run,
}: {
  projects: Project[];
  run: (work: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  const workspace = useLiveQuery(loadWorkspace);
  return (
    <section className="card settings-section">
      <div className="card-header">
        <div>
          <h2>Inspector profile & defaults</h2>
          <p>Your reusable details, stored on this device.</p>
        </div>
      </div>
      {workspace ? (
        <ProfileForm
          key={JSON.stringify(workspace)}
          initial={workspace}
          projects={projects}
          run={run}
        />
      ) : (
        <p className="settings-body">Loading profile…</p>
      )}
    </section>
  );
}
