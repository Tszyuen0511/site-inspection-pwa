import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { generatePDF, generatePackage } from "./export";
import { fixture } from "./test-fixtures";
import { packageName, type Photo } from "./domain";
import { dailyReportDefaults } from "./daily-report";
import { readFileSync } from "node:fs";
function photoFixture(
  record: ReturnType<typeof fixture>,
  index: number,
  reportSection: Photo["reportSection"] = "site",
): Photo {
  const image = new Blob([readFileSync("src/test-image.jpg")], {
    type: "image/jpeg",
  });
  return {
    id: `test-photo-${index}`,
    inspectionId: record.id,
    itemId: "toe-level",
    name: `test-${index}.jpg`,
    caption: `CAPTION_${index}`,
    order: index,
    original: image,
    compressed: image,
    width: 1,
    height: 1,
    createdAt: record.createdAt,
    reportSection,
    reportGroup: reportSection === "core" ? "BH-TEST" : "",
  };
}
describe("local reports and export", () => {
  it("generates an A4 PDF with exact recorded measurements and status", async () => {
    const r = fixture();
    r.company = "WSP Test Company";
    r.responses["toe-level"].values = {
      measuredLevel: "-12.5000",
      specifiedLevel: "-12.0000",
      units: "m",
    };
    r.responses["toe-level"].status = "Fail";
    r.responses["toe-level"].remarks = "Observed and recorded";
    const pdf = await generatePDF(r, []);
    const content = await pdf.text();
    expect(content.startsWith("%PDF-")).toBe(true);
    expect(content).toContain("-12.5000");
    expect(content).toContain("Fail");
    expect(content).toContain("Company: WSP Test Company");
    const box = content.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!;
    expect(Number(box[1])).toBeCloseTo(595.28, 2);
    expect(Number(box[2])).toBeCloseTo(841.89, 2);
  });
  it("paginates long remarks without dropping their final text", async () => {
    const r = fixture();
    r.responses["trial-pit"].remarks =
      "A long recorded observation. ".repeat(400) + "END_OF_REMARK";
    r.remarks = "General observation. ".repeat(400) + "END_OF_GENERAL";
    const content = await (await generatePDF(r, [])).text();
    expect(content).toContain("END_OF_REMARK");
    expect(content).toContain("END_OF_GENERAL");
    expect(content.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(3);
  });
  it("creates a ZIP package with reproducible record JSON and PDF", async () => {
    const r = fixture();
    const blob = await generatePackage(r, []);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const root = packageName(r);
    expect(zip.file(root + "/Inspection_Report.pdf")).not.toBeNull();
    const json = JSON.parse(
      await zip.file(root + "/Inspection_Data.json")!.async("string"),
    );
    expect(json.inspection).toEqual(r);
    expect(json.photos).toEqual([]);
  });
  it("fails visibly for missing photo images", async () => {
    const r = fixture();
    const p = {
      id: "photo",
      inspectionId: r.id,
      itemId: "toe-level",
      name: "missing.jpg",
      original: new Blob([]),
      compressed: new Blob([]),
    } as Photo;
    await expect(generatePDF(r, [p])).rejects.toThrow("missing");
  });
  it("refuses to silently corrupt unsupported PDF characters", async () => {
    const r = fixture();
    r.remarks = "工地";
    await expect(generatePDF(r, [])).rejects.toThrow("Unicode");
  });
  it("uses the numbered daily-report structure without inventing Nil entries", async () => {
    const r = fixture();
    const content = await (await generatePDF(r, [])).text();
    for (const heading of [
      "Contract Status",
      "Site Activities",
      "Site Staff / Visitors",
      "Work Done",
      "Testing",
      "Site Photos",
      "Inspection Checklist Appendix",
      "Prepared by:",
    ])
      expect(content).toContain(heading);
    expect(content).toContain("Not recorded");
    expect(content).not.toContain("(Nil)");
  });
  it("places six site photos on one sheet and carries the seventh onto another", async () => {
    const r = fixture();
    const six = await (
      await generatePDF(
        r,
        Array.from({ length: 6 }, (_, i) => photoFixture(r, i)),
      )
    ).text();
    const seven = await (
      await generatePDF(
        r,
        Array.from({ length: 7 }, (_, i) => photoFixture(r, i)),
      )
    ).text();
    expect(six.match(/\/Type \/Page\b/g)).toHaveLength(3);
    expect(seven.match(/\/Type \/Page\b/g)).toHaveLength(4);
    expect(seven).toContain("CAPTION_6");
  });
  it("keeps core logs, progress plans and long captions with their photo references", async () => {
    const r = fixture();
    const core = photoFixture(r, 0, "core"),
      plan = photoFixture(r, 1, "plan");
    core.caption = "Recorded caption text. ".repeat(200) + "END_OF_CAPTION";
    const content = await (await generatePDF(r, [core, plan])).text();
    expect(content).toContain("Core Sample Log - BH-TEST");
    expect(content).toContain("Site Progress Plan");
    expect(content).toContain("Extended photographic captions");
    expect(content).toContain("END_OF_CAPTION");
  });
  it("preserves daily-report values in the inspection package", async () => {
    const r = fixture();
    r.dailyReport = {
      ...dailyReportDefaults(r),
      reportNumber: "DAILY-001",
      weather: "Recorded weather",
      workDone: [
        {
          activity: "Piling",
          rigs: "1",
          element: "SP-01",
          commencement: "30/10/2026",
          progress: "1.2500 m",
          status: "Recorded",
          completion: "-",
        },
      ],
    };
    const zip = await JSZip.loadAsync(
      await (await generatePackage(r, [])).arrayBuffer(),
    );
    const data = JSON.parse(
      await zip.file(packageName(r) + "/Inspection_Data.json")!.async("string"),
    );
    expect(data.inspection.dailyReport).toEqual(r.dailyReport);
  });
});
