// Conversions between the plan viewer's screen pixels and drawing-relative
// coordinates (0..1 of the page width / height). Stored marks only ever use the
// drawing-relative form, so zoom, pan, screen size and the PDF's page layout
// never change where a region sits on the drawing.
export type Point = { x: number; y: number };
export type View = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Screen point (inside the viewer) to drawing-relative, clamped to the page. */
export const toDrawing = (p: Point, view: View, image: Size): Point => ({
  x: clamp01((p.x - view.x) / (image.width * view.scale)),
  y: clamp01((p.y - view.y) / (image.height * view.scale)),
});

/** Drawing-relative point to its current screen position. */
export const toViewer = (
  x: number,
  y: number,
  view: View,
  image: Size,
): Point => ({
  x: view.x + x * image.width * view.scale,
  y: view.y + y * image.height * view.scale,
});
