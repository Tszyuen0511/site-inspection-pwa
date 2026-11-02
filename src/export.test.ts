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
  it("uses the inspection report structure, not the daily-report sections", async () => {
    const r = fixture();
    r.inspectionNo = "INSP-SP-007";
    const content = await (await generatePDF(r, [])).text();
    for (const heading of [
      "Detail of Inspection",
      "Inspection Item",
      "Site Photos",
      "Recorded measurements /",
      "Inspection No. INSP-SP-007",
      "\\(Project Reference: TEST-001\\)",
      "Prepared by:",
    ])
      expect(content).toContain(heading);
    for (const removed of [
      "Contract Status",
      "Work Done",
      "Daily Site Report",
      "Attention",
      "Inspection Checklist Appendix",
    ])
      expect(content).not.toContain(removed);
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
    expect(six.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(seven.match(/\/Type \/Page\b/g)).toHaveLength(3);
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

it("prints concise weather with manual precedence and preserves forecast provenance in JSON", async () => {
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
  const text = await (await generatePDF(r, [])).text();
  const pdfLines = [...text.matchAll(/\(([^\n]*?)\) Tj/g)]
    .map((m) => m[1])
    .join(" ");
  expect(pdfLines.includes("Observed drizzle on site")).toBe(true);
  expect(text.includes("MET Norway")).toBe(false);
  // GPS is no longer printed in the inspection report; it stays in the JSON export.
  expect(text.includes("22.300000")).toBe(false);
  expect(text.includes("2026-11-02T02:05:00.000Z")).toBe(false);
  r.dailyReport.weather = "";
  const compact = await (await generatePDF(r, [])).text();
  expect(compact.includes("Weather: cloudy, 25 C \\(forecast\\)")).toBe(true);
  expect(compact.includes("Forecast summary: MET Norway")).toBe(true);
  expect(compact.includes("humidity")).toBe(false);
  expect(compact.includes("retrieved:")).toBe(false);
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
  it("prints Weather directly after Location in Detail of Inspection", async () => {
    const r = fixture();
    r.dailyReport = { ...dailyReportDefaults(r), weather: "Partly cloudy" };
    const lines = await drawn(await generatePDF(r, []));
    const at = (prefix: string) => lines.findIndex((l) => l.startsWith(prefix));
    expect(at("Location: Zone A")).toBeGreaterThan(at("Element: SP-TEST"));
    expect(at("Weather: Partly cloudy")).toBe(at("Location: Zone A") + 1);
    expect(at("Inspection date / time:")).toBe(at("Weather:") + 1);
  });
  it("keeps each photograph's caption, item and remark together, after reordering", async () => {
    const r = fixture();
    const [first, second] = r.template.items;
    const photos = [
      imagePhoto(r, "a", 2, "CAP_A", first.id, "REMARK_A"),
      imagePhoto(r, "b", 0, "CAP_B", second.id, "REMARK_B"),
      imagePhoto(r, "c", 1, "CAP_C", "", undefined),
    ];
    const lines = await drawn(await generatePDF(r, photos));
    const block = (caption: string) => {
      const i = lines.findIndex((l) => l.endsWith(caption));
      return lines.slice(i, i + 3);
    };
    // Order field decides numbering: b=P01, c=P02, a=P03.
    expect(block("CAP_B")).toEqual([
      "Photo 1 (P01): CAP_B",
      `Inspection Item: 2. ${second.description}`,
      "Remark: REMARK_B",
    ]);
    expect(block("CAP_C").slice(0, 2)).toEqual([
      "Photo 2 (P02): CAP_C",
      "Inspection Item: General observation",
    ]);
    expect(block("CAP_C")[2]).not.toMatch(/^Remark:/);
    expect(block("CAP_A")).toEqual([
      "Photo 3 (P03): CAP_A",
      `Inspection Item: 1. ${first.description}`,
      "Remark: REMARK_A",
    ]);
    // Never substitutes the inspection's general remarks or checklist remarks.
    expect(lines.filter((l) => l.startsWith("Remark:"))).toHaveLength(2);
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
    expect(content).toContain("Remark: see extended caption notes.");
    expect(content).toContain("END_OF_REMARK");
  });
  it("prints recorded measurements only, in a correctly named column, with failed status", async () => {
    const r = fixture();
    r.responses["toe-level"].values = { measuredLevel: "-12.48" };
    r.responses["corner-welding"].status = "Fail";
    r.responses["corner-welding"].remarks = "Weld defect at corner";
    const lines = await drawn(await generatePDF(r, []));
    expect(lines).toContain("Measured toe level: -12.48");
    expect(lines.some((l) => l.startsWith("Specified toe level"))).toBe(false);
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
