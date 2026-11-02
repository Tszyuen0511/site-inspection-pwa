import { useRef, useState } from "react";
import { Camera, Expand, ImagePlus, Loader2 } from "lucide-react";
import { db } from "../db";
import {
  MAX_PHOTOS,
  photoNumber,
  type Inspection,
  type Photo,
  type PhotoView,
} from "../domain";
import { orderedPhotos, preparePhoto, toStoredPhoto } from "../photos";
import { Button, Dialog, Field } from "./ui";
import { PhotoImage } from "./PhotoManager";

export function ItemPhotos({
  record,
  itemId,
  photos,
  run,
  onManage,
}: {
  record: Inspection;
  itemId: string;
  photos: PhotoView[];
  run: (work: () => Promise<unknown>, success?: string) => Promise<void>;
  onManage: () => void;
}) {
  const camera = useRef<HTMLInputElement>(null),
    files = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [preview, setPreview] = useState(false);
  const sorted = orderedPhotos(photos),
    attached = sorted.filter((p) => p.itemId === itemId);
  const current = attached.find((p) => p.id === selected) || attached.at(-1);
  const readOnly = record.status !== "Draft";
  const edit = async (work: () => Promise<unknown>) => {
    await db
      .transaction("rw", db.photos, db.inspections, async () => {
        const stored = await db.inspections.get(record.id);
        if (!stored || stored.status !== "Draft")
          throw new Error("Reopen this inspection before editing photos.");
        await work();
        await db.inspections.update(record.id, {
          updatedAt: new Date().toISOString(),
        });
      })
      .catch((error) => {
        // Retain failed storage writes for retry, not rejected input files or limits.
        if (error && typeof error === "object" && error.name !== "Error")
          Object.assign(error, { retryablePhotoWrite: true });
        throw error;
      });
  };
  const add = async (list: FileList | null) => {
    if (!list?.length || busy) return;
    const chosen = Array.from(list);
    setBusy(true);
    try {
      await run(async () => {
        if (photos.length + chosen.length > MAX_PHOTOS)
          throw new Error(
            "A maximum of 60 photographs is supported per inspection.",
          );
        const next: Photo[] = [];
        for (const [i, file] of chosen.entries())
          next.push(await preparePhoto(file, record.id, itemId, i));
        const prepared = await Promise.all(next.map(toStoredPhoto));
        await edit(async () => {
          const existing = await db.photos
            .where("inspectionId")
            .equals(record.id)
            .toArray();
          if (existing.length + prepared.length > MAX_PHOTOS)
            throw new Error("Photo limit exceeded.");
          const order = Math.max(-1, ...existing.map((p) => p.order)) + 1;
          await db.photos.bulkAdd(
            prepared.map((p, i) => ({ ...p, order: order + i })),
          );
        });
        setSelected(next.at(-1)!.id);
      }, "Photographs saved on this device.");
    } finally {
      setBusy(false);
      if (camera.current) camera.current.value = "";
      if (files.current) files.current.value = "";
    }
  };
  return (
    <div className="inline-photos">
      <input
        ref={camera}
        hidden
        type="file"
        accept="image/*"
        capture="environment"
        aria-label={`Capture photo for ${itemId}`}
        onChange={(e) => void add(e.target.files)}
      />
      <input
        ref={files}
        hidden
        multiple
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={`Upload photos for ${itemId}`}
        onChange={(e) => void add(e.target.files)}
      />
      <div className="item-photo-row">
        <div className="item-photo-strip" aria-label="Item photographs">
          {attached.map((photo) => (
            <button
              key={photo.id}
              type="button"
              className={`item-thumb ${current?.id === photo.id ? "is-selected" : ""}`}
              aria-label={`Select ${photoNumber(sorted.indexOf(photo))}`}
              aria-pressed={current?.id === photo.id}
              onClick={() => setSelected(photo.id)}
            >
              <PhotoImage photo={photo} />
              <span>{photoNumber(sorted.indexOf(photo))}</span>
            </button>
          ))}
        </div>
        {!readOnly && (
          <button
            type="button"
            className="photo-add-tile"
            disabled={busy}
            onClick={() =>
              window.matchMedia("(max-width: 760px)").matches
                ? camera.current?.click()
                : files.current?.click()
            }
            aria-label={`Add photos to ${itemId}`}
          >
            {busy ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Camera size={20} />
            )}
            <span className="phone-label">Add</span>
            <span className="desktop-label">Upload</span>
          </button>
        )}
      </div>
      <div className="inline-photo-tools">
        {!readOnly && (
          <button
            type="button"
            disabled={busy}
            onClick={() => files.current?.click()}
          >
            <ImagePlus size={16} />
            Choose photos
          </button>
        )}
        {attached.length > 0 && (
          <button type="button" onClick={onManage}>
            Manage photos
          </button>
        )}
      </div>
      {current && (
        <div className="inline-caption">
          <Field label={`Caption for ${photoNumber(sorted.indexOf(current))}`}>
            <input
              key={current.id}
              defaultValue={current.caption}
              disabled={readOnly}
              maxLength={2000}
              placeholder="[Photo caption]"
              onChange={(e) => {
                const caption = e.target.value;
                void run(() =>
                  edit(() => db.photos.update(current.id, { caption })),
                );
              }}
            />
          </Field>
          <Button
            variant="outline"
            size="icon"
            aria-label={`View ${photoNumber(sorted.indexOf(current))}`}
            onClick={() => setPreview(true)}
          >
            <Expand size={17} />
          </Button>
        </div>
      )}
      {current && (
        <div className="inline-caption inline-remark">
          <Field
            label={`Photo remark for ${photoNumber(sorted.indexOf(current))}`}
          >
            <input
              key={current.id}
              defaultValue={current.remark || ""}
              disabled={readOnly}
              maxLength={5000}
              placeholder="[Observation about this photograph]"
              onChange={(e) => {
                const remark = e.target.value;
                void run(() =>
                  edit(() => db.photos.update(current.id, { remark })),
                );
              }}
            />
          </Field>
        </div>
      )}
      {current && (
        <Dialog
          open={preview}
          onOpenChange={setPreview}
          title="Full-screen photograph"
          className="lightbox"
          closeLabel="Close photograph"
        >
          <PhotoImage photo={current} />
          <p>{current.caption || current.name}</p>
        </Dialog>
      )}
    </div>
  );
}
