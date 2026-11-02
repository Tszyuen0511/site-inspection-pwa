import { useEffect, useState } from "react";
import { createRecoveryDump, recoveryFileName } from "../recovery";
import { download } from "../export";
import type { IntegrityIssue } from "../integrity";
import type { BackupStatus, Persistence } from "../storage-health";
import { completeBackup, type BackupOutcome } from "../backup-export";
import { Button, Dialog } from "./ui";

export function RecoveryButton({
  onResult,
}: {
  onResult?: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          download(await createRecoveryDump(), recoveryFileName());
          onResult?.("Recovery data download requested.");
        } catch (error) {
          onResult?.(
            `Recovery data failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Preparing…" : "Download recovery data"}
    </Button>
  );
}
export function IntegrityList({ issues }: { issues: IntegrityIssue[] }) {
  return (
    <ul className="small">
      {issues.map((i, n) => (
        <li key={`${i.kind}:${i.id}:${n}`}>
          <strong>{i.kind}</strong> {i.id}: {i.message}
        </li>
      ))}
    </ul>
  );
}
/** Shown on every page while stored data fails validation. Nothing is deleted. */
export function IntegrityBanner({
  issues,
  onDetails,
}: {
  issues: IntegrityIssue[];
  onDetails: () => void;
}) {
  if (!issues.length) return null;
  return (
    <div className="notice warning" role="alert" data-testid="integrity-banner">
      <p>
        <strong>
          {issues.length} stored item{issues.length === 1 ? "" : "s"} failed
          validation.
        </strong>{" "}
        They are kept unchanged on this device but hidden from the working
        lists. Download the raw recovery data and keep it safe.
      </p>
      <div className="row wrap">
        <RecoveryButton />
        <Button size="sm" variant="ghost" onClick={onDetails}>
          Show details
        </Button>
      </div>
    </div>
  );
}
export function StorageLossBanner({
  onContinue,
  onSettings,
}: {
  onContinue: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="notice warning" role="alert" data-testid="loss-banner">
      <p>
        <strong>
          This device&apos;s inspection database is empty, but this browser
          remembers earlier records.
        </strong>{" "}
        The browser may have cleared its storage. Demonstration data has NOT
        been loaded so nothing is hidden. Restore your latest backup now.
      </p>
      <div className="row wrap">
        <Button size="sm" onClick={onSettings}>
          Import backup
        </Button>
        <Button size="sm" variant="ghost" onClick={onContinue}>
          Start fresh with demonstration data
        </Button>
      </div>
    </div>
  );
}
export function BackupReminder({
  status,
  persistence,
  onBackup,
  busy,
}: {
  status: BackupStatus;
  persistence: Persistence;
  onBackup: () => void;
  busy: boolean;
}) {
  const showBackup = status.state === "remind";
  const showPersist = status.state !== "none" && persistence === "not-granted";
  if (!showBackup && !showPersist) return null;
  return (
    <div className="notice warning" data-testid="backup-reminder">
      {showBackup && (
        <p>
          <strong>
            {status.lastAt
              ? `Last backup was ${Math.floor(status.daysSince ?? 0)} day(s) ago.`
              : "You have not exported a backup yet."}
          </strong>{" "}
          {status.unbacked} inspection
          {status.unbacked === 1 ? " has" : "s have"} changes that exist only on
          this device. A saved backup file kept outside the browser is the only
          reliable protection against lost storage.
        </p>
      )}
      {showPersist && (
        <p>
          The browser has not guaranteed to keep this app&apos;s storage and may
          clear it when space is low. Backups matter even more on this device.
        </p>
      )}
      {showBackup && (
        <Button size="sm" disabled={busy} onClick={onBackup}>
          Export backup now
        </Button>
      )}
    </div>
  );
}

const NOT_DONE =
  "Backup NOT completed: not every part was saved, so it is not recorded as backed up.";
/** Lets the user save each part of a multi-file backup with its own tap. */
export function BackupPartsDialog({
  pending,
  onClose,
}: {
  pending?: BackupOutcome["pending"];
  onClose: (message: string) => void;
}) {
  // Keyed by the backup it belongs to, so tapped-part state can never leak from an
  // earlier backup into a new one.
  return pending ? (
    <PartsDialog
      key={`${pending.log.at}:${pending.files.length}`}
      pending={pending}
      onClose={onClose}
    />
  ) : null;
}
function PartsDialog({
  pending,
  onClose,
}: {
  pending: NonNullable<BackupOutcome["pending"]>;
  onClose: (message: string) => void;
}) {
  const [saved, setSaved] = useState<number[]>([]);
  const [recorded, setRecorded] = useState(false);
  const [error, setError] = useState("");
  const total = pending.files.length;
  const done = saved.length === total;
  useEffect(() => {
    if (!done) return;
    completeBackup(pending.log)
      .then(() => setRecorded(true))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [pending, done]);
  const close = () =>
    onClose(
      recorded
        ? "Backup saved: all parts downloaded."
        : done
          ? "Parts were downloaded but the backup could not be recorded, so reminders will continue."
          : NOT_DONE,
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title="Save your backup files"
      description="This backup is split into several files, each restorable on its own. Tap each button, then check your Downloads folder."
    >
      <ul className="small" data-testid="backup-parts">
        {pending.files.map((f, i) => (
          <li key={f.name} className="row wrap">
            <span>
              Part {i + 1} of {total}: {f.inspections} inspection
              {f.inspections === 1 ? "" : "s"}, {f.photos} photo
              {f.photos === 1 ? "" : "s"} ({(f.blob.size / 1048576).toFixed(1)}{" "}
              MB)
            </span>
            <Button
              size="sm"
              variant={saved.includes(i) ? "outline" : "default"}
              onClick={() => {
                download(f.blob, f.name);
                setSaved((s) => (s.includes(i) ? s : [...s, i]));
              }}
            >
              {saved.includes(i) ? "Download again" : `Download part ${i + 1}`}
            </Button>
          </li>
        ))}
      </ul>
      {done && (
        <p role="status">
          All parts requested. Keep every file together; restore with Import
          backup and select all of them.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="form-actions">
        <Button variant="outline" onClick={close}>
          {done ? "Done" : "Close"}
        </Button>
      </div>
    </Dialog>
  );
}
