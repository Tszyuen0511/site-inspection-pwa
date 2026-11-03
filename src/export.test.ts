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
  it("generates an A4 PDF with each item's status and inspection date", async () => {
    const r = fixture();
    r.company = "WSP Test Company";
    // Measurement values from earlier versions are kept but no longer printed.
    r.responses["toe-level"].values = {
      measuredLevel: "-12.5000",
      specifiedLevel: "-12.0000",
      units: "m",
    };
    r.responses["toe-level"].status = "Fail";
    r.responses["toe-level"].date = "2026-11-03";
    r.responses["toe-level"].remarks = "Observed and recorded";
    const pdf = await generatePDF(r, []);
    const content = await pdf.text();
    expect(content.startsWith("%PDF-")).toBe(true);
    expect(content).not.toContain("-12.5000");
    expect(content).toContain("2026/11/03");
    expect(content).toContain("Fail");
    // Company stays in the record but is not part of Inspection Information.
    expect(content).not.toContain("Company:");
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
    // General remarks are kept in the record but no longer printed.
    expect(content).not.toContain("END_OF_GENERAL");
    expect(content).not.toContain("General remarks");
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
  it("uses the simplified inspection report structure", async () => {
    const r = fixture();
    r.element = "SP-007";
    // A stored sequence number is not what the report shows.
    r.inspectionNo = "INSP-SP-099";
    r.fictional = true;
    const content = await (await generatePDF(r, [])).text();
    for (const heading of [
      "1.   Inspection Information",
      "2.   Inspection Checklist",
      "Photographic Records",
      "Inspection Date",
      "Inspection No. INSP-SP-007",
      "TCP Grade: TCP T3",
      "Element Name: SP-007",
      "\\(Project Reference: TEST-001\\)",
      "Prepared by:",
    ])
      expect(content).toContain(heading);
    for (const removed of [
      "INSP-SP-099",
      "Contract Status",
      "Work Done",
      "Daily Site Report",
      "Attention",
      "Inspection Checklist Appendix",
      "FICTIONAL DEMONSTRATION RECORD",
      "Statuses and measurements are recorded",
      "Recorded measurements",
      "Drawing / specification",
      "Location: Zone A",
      "Inspection Number:",
      "Sign-off",
      "Signature",
      "Inspection date / time",
      "General remarks",
      "Weather",
    ])
      expect(content).not.toContain(removed);
    expect(content).not.toContain("(Nil)");
  });
  it("never prints the demonstration note saved in a demo record's remarks", async () => {
    const r = fixture();
    r.remarks =
      "Fictional demonstration record. Observations and statuses are illustrative only.";
    const content = await (await generatePDF(r, [])).text();
    expect(content).not.toContain("Fictional demonstration record");
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
    expect(six.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(seven.match(/\/Type \/Page\b/g)).toHaveLength(3);
    expect(seven).toContain("Photo 7 \\(P07\\)");
  });
  it("keeps core logs, progress plans and long remarks with their photo references", async () => {
    const r = fixture();
    const core = photoFixture(r, 0, "core"),
      plan = photoFixture(r, 1, "plan");
    core.remark = "Recorded remark text. ".repeat(200) + "END_OF_REMARK";
    const content = await (await generatePDF(r, [core, plan])).text();
    expect(content).toContain("Core Sample Log - BH-TEST");
    expect(content).toContain("Site Progress Plan");
    expect(content).toContain("Extended photographic captions");
    expect(content).toContain("END_OF_REMARK");
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

it("prints no weather, but keeps saved weather and GPS data in the JSON export", async () => {
  const r = fixture();
  r.gps = {
    latitude: 22.3,
    longitude: 114.17,
    accuracy: 10,
    capturedAt: "2026-11-02T02:00:00.000Z",
  };
  r.weatherSnapshot = {
    provider: "MET Norway",
    kind: "model forecast",
    latitude: 22.3,
    longitude: 114.17,
    validAt: "2026-11-02T02:00:00.000Z",
    issuedAt: "2026-11-02T01:00:00.000Z",
    retrievedAt: "2026-11-02T02:05:00.000Z",
    temperatureC: 25,
    windSpeedMs: 3,
    summary: "cloudy",
  };
  r.dailyReport = {
    ...dailyReportDefaults(r),
    weather: "Observed drizzle on site",
  };
  for (const observed of ["Observed drizzle on site", ""]) {
    r.dailyReport.weather = observed;
    const text = await (await generatePDF(r, [])).text();
    for (const absent of [
      "Weather",
      "drizzle",
      "cloudy",
      "MET Norway",
      "Forecast",
      "CC BY",
      "22.300000",
    ])
      expect(text).not.toContain(absent);
  }
  const zip = await JSZip.loadAsync(
    await (await generatePackage(r, [])).arrayBuffer(),
  );
  const data = JSON.parse(
    await zip.file(packageName(r) + "/Inspection_Data.json")!.async("string"),
  );
  expect(data.inspection.weatherSnapshot).toEqual(r.weatherSnapshot);
  expect(data.inspection.gps).toEqual(r.gps);
});

// Text drawing operations in page order, for layout-order assertions.
const drawn = async (blob: Blob) =>
  [...(await blob.text()).matchAll(/\(([^\n]*?)\) Tj/g)].map((m) =>
    m[1].replace(/\\([()\\])/g, "$1"),
  );
const imagePhoto = (
  r: ReturnType<typeof fixture>,
  id: string,
  order: number,
  caption: string,
  itemId: string,
  remark?: string,
): Photo => ({ ...photoFixture(r, order), id, order, caption, itemId, remark });

describe("inspection report layout", () => {
  it("prints only identification fields in Inspection Information", async () => {
    const r = fixture();
    r.company = "Test Co";
    const lines = await drawn(await generatePDF(r, []));
    const start = lines.indexOf("1.   Inspection Information"),
      end = lines.indexOf("2.   Inspection Checklist");
    expect(lines.slice(start + 1, end)).toEqual([
      "Project: Test Project (TEST-001)",
      "Element Name: SP-TEST",
      "Inspection Type: Sheet Pile",
      "Inspector: Test Inspector",
      "TCP Grade: TCP T3",
      "Drawing Reference: TEST-DWG-01",
    ]);
    // The inspection number appears once: in the heading, not in the footer.
    expect(lines.filter((l) => l.includes("INSP-SP-TEST"))).toEqual([
      "Inspection No. INSP-SP-TEST",
    ]);
  });
  it("captions each photo with its item description, own remark, item number and item date", async () => {
    const r = fixture();
    const items = r.template.items;
    const [first, , , fourth] = items;
    r.responses[first.id].date = "2026-11-03";
    r.responses[first.id].remarks = "CHECKLIST_REMARK";
    r.responses[fourth.id].date = "2026-11-04";
    // Several photos on one item, one on another, one general; order decides numbers.
    const photos = [
      imagePhoto(r, "a", 3, "CAP_A", first.id, "REMARK_A"),
      imagePhoto(r, "b", 0, "CAP_B", fourth.id, "REMARK_B"),
      imagePhoto(r, "c", 1, "CAP_C", "", undefined),
      imagePhoto(r, "d", 2, "CAP_D", fourth.id, "REMARK_D"),
    ];
    const lines = await drawn(await generatePDF(r, photos));
    const block = (label: string) => {
      const i = lines.findIndex((l) => l.startsWith(label));
      return lines.slice(i, i + 4);
    };
    expect(block("Photo 1 (P01)")).toEqual([
      `Photo 1 (P01): ${fourth.description}.`,
      "Remarks: REMARK_B",
      "Inspection Item: 4",
      "Inspection Date: 2026/11/04",
    ]);
    // No remark: no Remarks line at all, not even a placeholder.
    expect(block("Photo 2 (P02)").slice(0, 3)).toEqual([
      "Photo 2 (P02): CAP_C.",
      "Inspection Item: General",
      "Inspection Date: Not recorded",
    ]);
    expect(lines.some((l) => /^Remarks:s*(Not recorded)?$/.test(l))).toBe(
      false,
    );
    expect(block("Photo 3 (P03)")).toEqual([
      `Photo 3 (P03): ${fourth.description}.`,
      "Remarks: REMARK_D",
      "Inspection Item: 4",
      "Inspection Date: 2026/11/04",
    ]);
    expect(block("Photo 4 (P04)")).toEqual([
      `Photo 4 (P04): ${first.description}.`,
      "Remarks: REMARK_A",
      "Inspection Item: 1",
      "Inspection Date: 2026/11/03",
    ]);
    // Each reference is printed exactly once; checklist remarks never leak in.
    for (const n of ["P01", "P02", "P03", "P04"])
      expect(lines.filter((l) => l.includes(`(${n})`))).toHaveLength(1);
    expect(lines.filter((l) => l.includes("CHECKLIST_REMARK"))).toHaveLength(1);
    expect(lines.some((l) => l.startsWith("Remarks: CHECKLIST_REMARK"))).toBe(
      false,
    );
  });
  it("never uses the upload, capture or report date as an inspection date", async () => {
    const r = fixture();
    const p = imagePhoto(r, "a", 0, "CAP", r.template.items[0].id);
    p.createdAt = "2026-01-15T08:00:00.000Z";
    const lines = await drawn(await generatePDF(r, [p]));
    expect(lines).toContain("Inspection Date: Not recorded");
    expect(lines.some((l) => l.includes("2026/01/15"))).toBe(false);
    // Only the footer's generation date may show today's date.
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "/");
    expect(
      lines.some((l) => l.includes(today) && !l.startsWith("Generated:")),
    ).toBe(false);
  });
  it("draws no empty neighbouring cell for a lone photograph", async () => {
    const r = fixture();
    const rects = async (n: number) =>
      (
        (
          await (
            await generatePDF(
              r,
              Array.from({ length: n }, (_, i) =>
                imagePhoto(r, `p${i}`, i, `C${i}`, ""),
              ),
            )
          ).text()
        ).match(/ re\n/g) || []
      ).length;
    const none = await rects(0),
      one = await rects(1),
      two = await rects(2),
      three = await rects(3);
    expect(one - none).toBe(1);
    expect(two - none).toBe(2);
    expect(three - none).toBe(3);
  });
  it("includes each photo's remark in the ZIP photo data", async () => {
    const r = fixture();
    const zip = await JSZip.loadAsync(
      await (
        await generatePackage(r, [
          imagePhoto(r, "a", 0, "CAP_A", "", "REMARK_A"),
          imagePhoto(r, "b", 1, "CAP_B", ""),
        ])
      ).arrayBuffer(),
    );
    const data = JSON.parse(
      await zip.file(packageName(r) + "/Inspection_Data.json")!.async("string"),
    );
    expect(
      data.photos.map((p: { id: string; remark: string }) => [p.id, p.remark]),
    ).toEqual([
      ["a", "REMARK_A"],
      ["b", ""],
    ]);
  });
  it("moves an over-long photo remark to the extended notes without losing it", async () => {
    const r = fixture();
    const long = "Long photo remark. ".repeat(60) + "END_OF_REMARK";
    const content = await (
      await generatePDF(r, [imagePhoto(r, "x", 0, "CAP", "", long)])
    ).text();
    expect(content).toContain("Remarks: see extended caption notes.");
    expect(content).toContain("END_OF_REMARK");
  });
  it("prints each item's own date, Not recorded when missing, and failed results in bold", async () => {
    const r = fixture();
    const ids = r.template.items.map((i) => i.id);
    r.responses[ids[0]].date = "2026-11-03";
    r.responses[ids[1]].date = "2026-11-04";
    r.responses["toe-level"].values = { measuredLevel: "-12.48" };
    r.responses["corner-welding"].status = "Fail";
    r.responses["corner-welding"].remarks = "Weld defect at corner";
    r.responses[ids[0]].status = "Pass";
    const lines = await drawn(await generatePDF(r, []));
    expect(lines).toContain("2026/11/03");
    expect(lines).toContain("2026/11/04");
    expect(lines.filter((l) => l === "Not recorded").length).toBe(
      ids.length - 2,
    );
    expect(lines.some((l) => l.includes("-12.48"))).toBe(false);
    expect(lines).toContain("Weld defect at corner");
    // "Fail" is drawn with the bold font.
    const raw = await (await generatePDF(r, [])).text();
    const boldObj =
      /(\d+) 0 obj\s*<<\s*\/Type \/Font\s*\/BaseFont \/Times-Bold/.exec(
        raw,
      )![1];
    const boldName = new RegExp(`/(F\\d+) ${boldObj} 0 R`).exec(raw)![1];
    const before = raw.slice(0, raw.indexOf("(Fail) Tj"));
    const fonts = [...before.matchAll(/\/(F\d+) [\d.]+ Tf/g)];
    expect(fonts.at(-1)![1]).toBe(boldName);
    const pass = raw.slice(0, raw.indexOf("(Pass) Tj"));
    expect([...pass.matchAll(/\/(F\d+) [\d.]+ Tf/g)].at(-1)![1]).not.toBe(
      boldName,
    );
  });
});
