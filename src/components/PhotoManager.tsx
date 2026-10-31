import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  ImagePlus,
  Images,
  Trash2,
  Expand,
} from "lucide-react";
import { db } from "../db";
import {
  MAX_PHOTOS,
  photoNumber,
  type Inspection,
  type Photo,
} from "../domain";
import { orderedPhotos, preparePhoto, toStoredPhoto } from "../photos";
import { Button, Dialog, Field } from "./ui";
function useBlobURL(blob: Blob) {
  const [url, setURL] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setURL(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return url;
}
export function PhotoImage({
  photo,
  onClick,
}: {
  photo: Photo;
  onClick?: () => void;
}) {
  const url = useBlobURL(photo.compressed);
  return (
    <img
      src={url || undefined}
      alt={photo.caption || photo.name}
      onClick={onClick}
    />
  );
}
function PhotoCard({
  photo,
  index,
  total,
  record,
  onPreview,
  onMove,
  onDelete,
  onPatch,
}: {
  photo: Photo;
  index: number;
  total: number;
  record: Inspection;
  onPreview: () => void;
  onMove: (n: number) => void;
  onDelete: () => void;
  onPatch: (
    patch: Partial<
      Pick<Photo, "caption" | "itemId" | "reportSection" | "reportGroup">
    >,
  ) => void;
}) {
  const [caption, setCaption] = useState(photo.caption);
  const readonly = record.status !== "Draft";
  return (
    <article className="card photo-card">
      <div className="photo-image">
        <PhotoImage photo={photo} />
        <span className="photo-number">{photoNumber(index)}</span>
        <button
          className="photo-expand"
          aria-label={`Preview ${photoNumber(index)}`}
          onClick={onPreview}
        >
          <Expand size={17} />
        </button>
      </div>
      <div className="photo-card-body">
        <Field label="Caption">
          <input
            disabled={readonly}
            value={caption}
            onChange={(e) => {
              setCaption(e.target.value);
              onPatch({ caption: e.target.value });
            }}
            placeholder="Describe this photograph…"
          />
        </Field>
        <Field label="Report section">
          <select
            disabled={readonly}
            value={photo.reportSection || "site"}
            onChange={(e) =>
              onPatch({
                reportSection: e.target.value as Photo["reportSection"],
              })
            }
          >
            <option value="site">Site photos</option>
            <option value="core">Core sample log</option>
            <option value="plan">Site progress plan</option>
          </select>
        </Field>
        {photo.reportSection === "core" && (
          <Field label="Core log element / group">
            <input
              maxLength={500}
              disabled={readonly}
              defaultValue={photo.reportGroup || ""}
              onChange={(e) => onPatch({ reportGroup: e.target.value })}
              placeholder="e.g. BH1 or SP-001"
            />
          </Field>
        )}
        <Field label="Related checklist item">
          <select
            disabled={readonly}
            value={photo.itemId}
            onChange={(e) => onPatch({ itemId: e.target.value })}
          >
            <option value="">General observation</option>
            {record.template.items.map((item, i) => (
              <option key={item.id} value={item.id}>
                {i + 1}. {item.description}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex-between">
          <small className="muted">
            {(photo.original.size / 1024 / 1024).toFixed(1)} MB · Original
            retained
          </small>
          {!readonly && (
            <div className="row">
              <Button
                size="icon"
                variant="ghost"
                disabled={index === 0}
                aria-label={`Move ${photoNumber(index)} up`}
                onClick={() => onMove(-1)}
              >
                <ArrowUp size={16} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={index === total - 1}
                aria-label={`Move ${photoNumber(index)} down`}
                onClick={() => onMove(1)}
              >
                <ArrowDown size={16} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-danger"
                aria-label={`Delete ${photoNumber(index)}`}
                onClick={onDelete}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
export function PhotoManager({
  record,
  photos,
  defaultItem = "",
  run,
}: {
  record: Inspection;
  photos: Photo[];
  defaultItem?: string;
  run: (work: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  const files = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<string>(),
    [deleting, setDeleting] = useState<Photo>();
  const [item, setItem] = useState(defaultItem);
  const sorted = orderedPhotos(photos);
  const current = photos.find((p) => p.id === preview);
  const readonly = record.status !== "Draft";
  const editPhotos = async (work: () => Promise<unknown>) => {
    await db.transaction("rw", db.photos, db.inspections, async () => {
      const current = await db.inspections.get(record.id);
      if (!current || current.status !== "Draft")
        throw new Error(
          "Reopen this inspection as a draft before changing photos.",
        );
      await work();
      await db.inspections.update(record.id, {
        updatedAt: new Date().toISOString(),
      });
    });
  };
  const add = async (selected: FileList | null) => {
    if (!selected?.length) return;
    setBusy(true);
    await run(async () => {
      const count = await db.photos
        .where("inspectionId")
        .equals(record.id)
        .count();
      if (count + selected.length > MAX_PHOTOS)
        throw new Error(
          "A maximum of 60 photographs is supported per inspection.",
        );
      const prepared: Photo[] = [];
      const max = Math.max(-1, ...photos.map((p) => p.order));
      for (const [i, file] of Array.from(selected).entries())
        prepared.push(await preparePhoto(file, record.id, item, max + i + 1));
      const stored = await Promise.all(prepared.map(toStoredPhoto));
      await editPhotos(async () => {
        if (
          (await db.photos.where("inspectionId").equals(record.id).count()) +
            prepared.length >
          MAX_PHOTOS
        )
          throw new Error("Photo limit exceeded.");
        await db.photos.bulkAdd(stored);
      });
    }, "Photographs saved on this device.");
    setBusy(false);
    if (files.current) files.current.value = "";
    if (camera.current) camera.current.value = "";
  };
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">PHOTOGRAPHIC RECORD / {record.element}</div>
          <h1>
            Site photographs <span className="count-pill">{photos.length}</span>
          </h1>
          <p>
            A clear record of what you observed. Stored only on this device.
          </p>
        </div>
        {!readonly && (
          <Button
            className="btn-accent"
            disabled={busy}
            onClick={() => files.current?.click()}
          >
            <ImagePlus size={18} />
            {busy ? "Processing…" : "Add photos"}
          </Button>
        )}
      </div>
      <input
        ref={files}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        aria-label="Select photographs"
        onChange={(e) => void add(e.target.files)}
      />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label="Capture photograph"
        onChange={(e) => void add(e.target.files)}
      />
      {!readonly && (
        <div className="card photo-upload">
          <div className="upload-icon">
            <Images size={28} />
          </div>
          <div>
            <h3>Add site photographs</h3>
            <p>
              JPEG, PNG or WebP · up to 20 MB each · {MAX_PHOTOS} photos per
              inspection
            </p>
            <p className="small muted">
              Originals are preserved. Compressed copies are used in reports.
            </p>
          </div>
          <div className="upload-actions">
            <Field label="Associate new photos with">
              <select value={item} onChange={(e) => setItem(e.target.value)}>
                <option value="">General observation</option>
                {record.template.items.map((i, n) => (
                  <option key={i.id} value={i.id}>
                    {n + 1}. {i.description}
                  </option>
                ))}
              </select>
            </Field>
            <div className="row">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => camera.current?.click()}
              >
                <Camera size={16} />
                Use camera
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => files.current?.click()}
              >
                <ImagePlus size={16} />
                Choose files
              </Button>
            </div>
          </div>
        </div>
      )}
      {!photos.length ? (
        <div className="empty-state">
          <Images size={38} />
          <h3>No photographs yet</h3>
          <p>
            Add a photo from your camera or device to start the photographic
            record.
          </p>
        </div>
      ) : (
        <div className="photo-grid">
          {sorted.map((photo, i) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              index={i}
              total={photos.length}
              record={record}
              onPreview={() => setPreview(photo.id)}
              onDelete={() => setDeleting(photo)}
              onPatch={(patch) =>
                void run(async () => {
                  await editPhotos(() => db.photos.update(photo.id, patch));
                })
              }
              onMove={(direction) =>
                void run(async () => {
                  const reordered = [...sorted];
                  [reordered[i], reordered[i + direction]] = [
                    reordered[i + direction],
                    reordered[i],
                  ];
                  await editPhotos(() =>
                    Promise.all(
                      reordered.map((p, n) =>
                        db.photos.update(p.id, { order: n }),
                      ),
                    ),
                  );
                })
              }
            />
          ))}
        </div>
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(undefined)}
        title="Delete photograph?"
        description="This removes the original and report copy from this device. Export a backup first if you need to retain it."
      >
        <div className="form-actions">
          <Button variant="outline" onClick={() => setDeleting(undefined)}>
            Keep photo
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              void run(async () => {
                await editPhotos(() => db.photos.delete(deleting!.id));
                setDeleting(undefined);
              }, "Photograph deleted.")
            }
          >
            Delete photo
          </Button>
        </div>
      </Dialog>
      {current && (
        <Dialog
          open={!!current}
          onOpenChange={(open) => !open && setPreview(undefined)}
          title="Full-screen photograph"
          className="lightbox"
          closeLabel="Close photograph"
        >
          <PhotoImage photo={current} />
          <p>
            {photoNumber(sorted.findIndex((p) => p.id === current.id))} ·{" "}
            {current.caption || current.name}
          </p>
        </Dialog>
      )}
    </>
  );
}
