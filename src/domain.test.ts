import { describe, expect, it } from "vitest";
import {
  detailsSchema,
  newInspection,
  templates,
  validationIssues,
  progress,
  safeName,
} from "./domain";
import { validatePhotoFile } from "./photos";
import { details, fixture } from "./test-fixtures";
describe("inspection validation and traceability", () => {
  it("creates unique IDs with template snapshots", () => {
    const a = fixture(),
      b = fixture();
    expect(a.id).not.toBe(b.id);
    expect(a.template).toEqual(templates[0]);
    expect(a.template).not.toBe(templates[0]);
    expect(a.status).toBe("Draft");
  });
  it("rejects missing and invalid form inputs", () => {
    expect(
      detailsSchema.safeParse({ ...details, inspector: " " }).success,
    ).toBe(false);
    expect(
      detailsSchema.safeParse({ ...details, date: "2026-02-30" }).success,
    ).toBe(false);
    expect(detailsSchema.safeParse({ ...details, time: "25:00" }).success).toBe(
      false,
    );
  });
  it("requires explicit statuses and failed-item remarks", () => {
    const r = fixture();
    expect(validationIssues(r)).toHaveLength(7);
    for (const response of Object.values(r.responses))
      response.status = "Not Applicable";
    expect(validationIssues(r)).toEqual([]);
    r.responses["toe-level"].status = "Fail";
    r.responses["toe-level"].remarks = "  ";
    expect(validationIssues(r)[0]).toContain("remark");
    r.responses["toe-level"].remarks = "Recorded deviation for follow-up";
    expect(validationIssues(r)).toEqual([]);
    expect(progress(r).percent).toBe(100);
  });
  it("never infers compliance from measured values", () => {
    const r = fixture();
    r.responses["toe-level"].values = {
      specifiedLevel: "-12",
      measuredLevel: "999",
    };
    expect(r.responses["toe-level"].status).toBe("Not Inspected");
  });
  it("sanitises filenames without losing data in records", () => {
    expect(safeName("../../a:*<>?b")).toBe("a_b");
    expect(safeName("")).toBe("Inspection");
  });
  it("rejects oversized, unsupported and empty photos", () => {
    expect(() =>
      validatePhotoFile({
        name: "huge.jpg",
        type: "image/jpeg",
        size: 21 * 1024 * 1024,
      } as File),
    ).toThrow("20 MB");
    expect(() =>
      validatePhotoFile(new File(["x"], "x.heic", { type: "image/heic" })),
    ).toThrow("JPEG");
    expect(() =>
      validatePhotoFile(new File([], "x.jpg", { type: "image/jpeg" })),
    ).toThrow("empty");
  });
});
