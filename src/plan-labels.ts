import type { Annotation, Drawing, Inspection } from "./domain";

export interface MarkLabel {
  label: string;
  /** Zero-based checklist position, or -1 when the linked item no longer exists. */
  itemIndex: number;
  itemId?: string;
  description?: string;
  linked: boolean;
}
export const suffix = (n: number): string =>
  (n >= 26 ? suffix(Math.floor(n / 26) - 1) : "") +
  String.fromCharCode(65 + (n % 26));

/** Deterministic order of marks across all drawings and pages of an inspection. */
export function orderMarks(annotations: Annotation[], drawings: Drawing[]) {
  const position = new Map(
    [...drawings]
      .sort(
        (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
      )
      .map((d, i) => [d.id, i]),
  );
  return annotations
    .filter((a) => a.kind === "marker")
    .sort(
      (a, b) =>
        (position.get(a.drawingId) ?? 1e9) -
          (position.get(b.drawingId) ?? 1e9) ||
        a.page - b.page ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Labels follow the checklist: item 3 with one mark is "3"; with several marks they
 * are "3A", "3B", ... in drawing/page/creation order. Labels are computed, never
 * stored, so they follow renumbering while the stored link stays the item's id.
 * Marks whose item no longer exists are never re-attached: they become "?1", "?2".
 */
export function markLabels(
  items: Inspection["template"]["items"],
  annotations: Annotation[],
  drawings: Drawing[],
): Map<string, MarkLabel> {
  const index = new Map(items.map((item, i) => [item.id, i]));
  const groups = new Map<string, Annotation[]>();
  const orphans: Annotation[] = [];
  for (const mark of orderMarks(annotations, drawings)) {
    if (mark.itemId && index.has(mark.itemId))
      groups.set(mark.itemId, [...(groups.get(mark.itemId) || []), mark]);
    else orphans.push(mark);
  }
  const labels = new Map<string, MarkLabel>();
  for (const [itemId, marks] of groups) {
    const i = index.get(itemId)!;
    marks.forEach((mark, n) =>
      labels.set(mark.id, {
        label: `${i + 1}${marks.length > 1 ? suffix(n) : ""}`,
        itemIndex: i,
        itemId,
        description: items[i].description,
        linked: true,
      }),
    );
  }
  orphans.forEach((mark, n) =>
    labels.set(mark.id, {
      label: `?${n + 1}`,
      itemIndex: -1,
      itemId: mark.itemId,
      linked: false,
    }),
  );
  return labels;
}

export const statusText = (status?: string) =>
  status === "Not Applicable" ? "N/A" : status || "Not Inspected";

export interface LegendRow {
  annotationId: string;
  drawingId: string;
  page: number;
  label: string;
  item: string;
  status: string;
  linked: boolean;
}
/** Legend generated from the checklist; optionally limited to one drawing page. */
export function legendRows(
  record: Pick<Inspection, "template" | "responses">,
  annotations: Annotation[],
  drawings: Drawing[],
  only?: { drawingId: string; page: number },
): LegendRow[] {
  const labels = markLabels(record.template.items, annotations, drawings);
  const ordered = orderMarks(annotations, drawings);
  const position = new Map(ordered.map((a, i) => [a.id, i]));
  return ordered
    .filter(
      (a) => !only || (a.drawingId === only.drawingId && a.page === only.page),
    )
    .map((a) => {
      const l = labels.get(a.id)!;
      return {
        annotationId: a.id,
        drawingId: a.drawingId,
        page: a.page,
        label: l.label,
        linked: l.linked,
        item: l.linked
          ? `${l.itemIndex + 1}. ${l.description}`
          : "Linked checklist item no longer exists - relink or delete this mark",
        status: l.linked
          ? statusText(record.responses[l.itemId!]?.status)
          : "Unlinked",
      };
    })
    .sort((a, b) => {
      const ai = labels.get(a.annotationId)!.itemIndex,
        bi = labels.get(b.annotationId)!.itemIndex;
      // Within an item, keep mark order (A, B, ... Z, AA), not text order.
      return (
        (ai < 0 ? 1e9 : ai) - (bi < 0 ? 1e9 : bi) ||
        position.get(a.annotationId)! - position.get(b.annotationId)!
      );
    });
}
