import { beforeEach, it, expect } from "vitest";
import { db } from "./db";
import { fixture } from "./test-fixtures";
import { dailyReportDefaults } from "./daily-report";
import {
  makeReportTemplate,
  applyReportTemplate,
  storeReportTemplate,
  loadReportTemplates,
  reportTemplateKey,
} from "./report-templates";
import { createBackup, importBackup } from "./backup";
beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
});
function sample() {
  const r = fixture();
  r.dailyReport = {
    ...dailyReportDefaults(r),
    reportNumber: "OLD-001",
    reportPeriod: "Yesterday",
    supervisionTitle: "GI supervision",
    commencementDate: "1 Oct 2026",
    contractPeriod: "90 days",
    activities: "Old actual work",
    weather: "Old rain",
    nonCompliance: "Old failure",
    memosIssued: "3",
    staff: [{ occupation: "Engineer", company: "Test Co", people: "4" }],
    workDone: [
      {
        activity: "Drilling",
        rigs: "3",
        element: "BH1",
        commencement: "Yesterday",
        progress: "12m",
        status: "Complete",
        completion: "Today",
      },
    ],
    testing: [{ type: "SPT", completed: "9" }],
  };
  return r;
}
const choices = {
  header: true,
  contract: true,
  tables: true,
  wording: [] as Array<"activities" | "safety" | "instructions">,
};
it("saves only safe selected defaults and empty table scaffolds", () => {
  const r = sample(),
    t = makeReportTemplate(r, "GI daily", choices);
  const fresh = fixture();
  fresh.inspector = "Current Inspector";
  const d = applyReportTemplate(fresh, t);
  expect(d.supervisionTitle).toBe("GI supervision");
  expect(d.preparedBy).toBe("Current Inspector");
  expect(d.reportNumber).toBe("");
  expect(d.reportPeriod).toBe("");
  expect(d.weather).toBe("");
  expect(d.nonCompliance).toBe("");
  expect(d.activities).toBe("");
  expect(d.memosIssued).toBe("");
  expect(d.staff).toEqual([
    { occupation: "Engineer", company: "Test Co", people: "" },
  ]);
  expect(d.workDone[0]).toEqual({
    activity: "Drilling",
    rigs: "",
    element: "",
    commencement: "",
    progress: "",
    status: "",
    completion: "",
  });
  expect(d.testing).toEqual([{ type: "SPT", completed: "" }]);
  expect(r.dailyReport?.reportNumber).toBe("OLD-001");
});
it("reuses wording only when explicitly selected and preserves existing report values", () => {
  const r = sample(),
    t = makeReportTemplate(r, "Wording", {
      ...choices,
      wording: ["activities"],
    });
  expect(applyReportTemplate(fixture(), t).activities).toBe("Old actual work");
  const target = sample();
  target.dailyReport!.supervisionTitle = "Keep title";
  expect(applyReportTemplate(target, t)).toEqual(target.dailyReport);
  expect(() =>
    applyReportTemplate({ ...target, status: "Completed" }, t),
  ).toThrow("Reopen");
});
it("round-trips report templates and rejects conflicting versions atomically", async () => {
  const r = sample(),
    t = makeReportTemplate(r, "Backup template", choices);
  await storeReportTemplate(t);
  const backup = await createBackup();
  await db.meta.clear();
  await importBackup(backup);
  expect(await loadReportTemplates()).toEqual([t]);
  await storeReportTemplate({ ...t, name: "Locally edited" });
  await expect(importBackup(backup)).rejects.toThrow(
    "report template ID conflicts",
  );
  expect((await loadReportTemplates())[0].name).toBe("Locally edited");
});
it("renaming or replacing defaults leaves historical reports untouched", async () => {
  const r = sample();
  await db.inspections.add(r);
  const t = makeReportTemplate(r, "Before", choices);
  await storeReportTemplate(t);
  const changed = makeReportTemplate(
    { ...r, dailyReport: { ...r.dailyReport!, contractPeriod: "100 days" } },
    "After",
    choices,
    t,
  );
  await storeReportTemplate(changed);
  expect(await loadReportTemplates()).toHaveLength(1);
  expect(changed.id).toBe(t.id);
  expect(changed.createdAt).toBe(t.createdAt);
  expect(await db.inspections.get(r.id)).toEqual(r);
  await db.meta.delete(reportTemplateKey(t.id));
  expect(await loadReportTemplates()).toEqual([]);
  expect(await db.inspections.get(r.id)).toEqual(r);
});
