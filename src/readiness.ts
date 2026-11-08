import { db } from "./db";
import { isIsoDate, type Inspection } from "./domain";

/** Per-inspection facts that live outside the inspection record itself. */
export interface ReadinessFacts {
  photos: number;
  drawings: number;
  /** A location region or highlighter stroke has been placed. */
  marked: boolean;
}
export interface Readiness {
  ready: boolean;
  /** Short, user-facing reasons it is not ready yet (empty when ready). */
  issues: string[];
}

const plural = (n: number, one: string, many = one + "s") =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Whether an inspection looks complete enough to export. It only informs the
 * user; exporting is never blocked. N/A items need no inspection date.
 */
export function readiness(
  record: Pick<Inspection, "template" | "responses">,
  facts: ReadinessFacts = { photos: 0, drawings: 0, marked: false },
): Readiness {
  const issues: string[] = [];
  const items = record.template.items.map((i) => record.responses[i.id]);
  const noResult = items.filter((r) => !r || r.status === "Not Inspected");
  const noDate = items.filter(
    (r) =>
      r &&
      (r.status === "Pass" || r.status === "Fail") &&
      !(r.date && isIsoDate(r.date)),
  );
  const failNoRemark = items.filter(
    (r) => r?.status === "Fail" && !r.remarks.trim(),
  );
  if (noResult.length)
    issues.push(`${plural(noResult.length, "item")} without a result`);
  if (noDate.length)
    issues.push(`${plural(noDate.length, "item")} missing an inspection date`);
  if (failNoRemark.length)
    issues.push(
      `${plural(failNoRemark.length, "failed item")} without a remark`,
    );
  if (!facts.drawings) issues.push("No location plan");
  else if (!facts.marked) issues.push("Location not marked on the plan");
  if (!facts.photos) issues.push("No photographs");
  return { ready: !issues.length, issues };
}

/**
 * Photo and drawing counts plus marking state for every inspection. Counts
 * come from index keys only, so no photograph or drawing bytes are loaded.
 */
export async function readinessFacts(): Promise<Map<string, ReadinessFacts>> {
  const facts = new Map<string, ReadinessFacts>();
  const of = (id: string) => {
    let f = facts.get(id);
    if (!f) facts.set(id, (f = { photos: 0, drawings: 0, marked: false }));
    return f;
  };
  const [photoKeys, drawingKeys] = await Promise.all([
    db.photos.orderBy("inspectionId").keys(),
    db.drawings.orderBy("inspectionId").keys(),
  ]);
  for (const id of photoKeys) of(String(id)).photos++;
  for (const id of drawingKeys) of(String(id)).drawings++;
  await db.annotations.each((a) => {
    if (a.kind === "region" || (a.kind === "highlight" && a.points?.length))
      of(a.inspectionId).marked = true;
  });
  return facts;
}
