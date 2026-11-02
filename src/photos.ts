import { db } from "./db";
import {
  MAX_PHOTO_SIZE,
  type Photo,
  type PhotoView,
  type StoredPhoto,
} from "./domain";
/**
 * Lists an inspection's photographs for display, reading one stored row at a time
 * and keeping only the report image and the original's size. Full-size originals
 * are never held in memory together; export and backup read them separately.
 */
export async function listPhotoViews(
  inspectionId: string,
): Promise<PhotoView[]> {
  const views: PhotoView[] = [];
  await db.photos
    .where("inspectionId")
    .equals(inspectionId)
    .each((row) => {
      const { original, compressed, originalType: _type, ...meta } = row;
      void _type;
      views.push({
        ...meta,
        originalSize: original?.byteLength ?? 0,
        compressed: new Blob([compressed], { type: "image/jpeg" }),
      });
    });
  return views;
}
export async function toStoredPhoto(photo: Photo): Promise<StoredPhoto> {
  const { original, compressed, ...metadata } = photo;
  return {
    ...metadata,
    original: await original.arrayBuffer(),
    compressed: await compressed.arrayBuffer(),
    originalType: original.type,
  };
}
export function fromStoredPhoto(photo: StoredPhoto): Photo {
  const { original, compressed, originalType, ...metadata } = photo;
  return {
    ...metadata,
    original: new Blob([original], { type: originalType }),
    compressed: new Blob([compressed], { type: "image/jpeg" }),
  };
}
export function validatePhotoFile(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      `${file.name}: choose a JPEG, PNG or WebP image. Export HEIC/HEIF as JPEG first.`,
    );
  if (!file.size) throw new Error(`${file.name}: the image is empty.`);
  if (file.size > MAX_PHOTO_SIZE)
    throw new Error(`${file.name}: the maximum photo size is 20 MB.`);
}
export async function preparePhoto(
  file: File,
  inspectionId: string,
  itemId: string,
  order: number,
): Promise<Photo> {
  validatePhotoFile(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () =>
        reject(new Error(`${file.name}: this image could not be decoded.`));
      i.src = url;
    });
    if (img.width * img.height > 80000000)
      throw new Error(
        `${file.name}: image exceeds the 80 megapixel processing limit.`,
      );
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error("Image processing is unavailable in this browser.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(
                new Error(
                  "Image compression failed. Please select a different image.",
                ),
              ),
        "image/jpeg",
        0.8,
      ),
    );
    return {
      id: crypto.randomUUID(),
      inspectionId,
      itemId,
      caption: "",
      order,
      name: file.name,
      original: file,
      compressed,
      width: canvas.width,
      height: canvas.height,
      createdAt: new Date().toISOString(),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function orderedPhotos<T extends { order: number; id: string }>(
  photos: T[],
) {
  return [...photos].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
}
