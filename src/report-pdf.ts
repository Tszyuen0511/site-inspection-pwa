import { wspLogo, wspLogoRatio } from "./brand-assets";
import { gpsText } from "./environment";
import { jsPDF } from "jspdf";
import { dailyReportDefaults, reportDate } from "./daily-report";
import {
  photoNumber,
  type Inspection,
  type Photo,
  type PhotoMeta,
} from "./domain";
import { orderedPhotos } from "./photos";

// A4 daily-site-report layout. The reference is a layout guide only: no project,
// corporate marks, personnel, photographs, criteria or approvals are copied.
export async function renderInspectionReport(
  record: Inspection,
  photos: PhotoMeta[],
  fontBase64?: string,
): Promise<Blob> {
  const daily = dailyReportDefaults(record),
    doc = new jsPDF({ unit: "mm", format: "a4" });
  const left = 24,
    width = 166,
    right = left + width,
    bottom = 270;
  const generated = new Date().toISOString();
  let y = 12;
  const font = fontBase64 ? "Report" : "times";
  if (fontBase64) {
    doc.addFileToVFS("Report.ttf", fontBase64);
    doc.addFont("Report.ttf", "Report", "normal");
  }
  doc.setProperties({
    title: `Daily Site Report - ${daily.reportNumber || record.id}`,
    subject: `${record.type} inspection / ${record.element}`,
    author: daily.preparedBy || record.inspector,
    creator: "Site Inspection (local browser)",
  });
  const setFont = (size = 9, bold = false) => {
    doc.setFont(font, fontBase64 ? "normal" : bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(0, 0, 0);
  };
  const text = (
    value: string,
    x: number,
    pos: number,
    size = 9,
    bold = false,
    align: "left" | "center" | "right" = "left",
  ) => {
    setFont(size, bold);
    doc.text(value, x, pos, { align });
  };
  const wrap = (
    value: string,
    cellWidth: number,
    size = 9,
    bold = false,
  ): string[] => {
    setFont(size, bold);
    return doc.splitTextToSize(value || "Not recorded", cellWidth) as string[];
  };
  const brand = () => {
    doc.setFont(
      fontBase64 ? "Report" : "helvetica",
      fontBase64 ? "normal" : "bold",
    );
    doc.setFontSize(13);
    doc.setTextColor(45, 45, 45);
    doc.addImage(
      wspLogo,
      "PNG",
      left,
      7,
      18,
      18 / wspLogoRatio,
      "wsp-logo",
      "FAST",
    );
    doc.text("SITE INSPECTION", left + 24, 13);
  };
  const newPage = (title = "Daily Site Report - continued") => {
    doc.addPage();
    brand();
    y = 24;
    const lines = wrap(title, width, 9, true);
    for (const line of lines) {
      text(line, left, y, 9, true);
      y += 4;
    }
    y += 3;
  };
  const ensure = (height: number) => {
    if (y + height > bottom) newPage();
  };
  const paragraph = (
    value: string,
    options: {
      x?: number;
      width?: number;
      size?: number;
      bold?: boolean;
      gap?: number;
    } = {},
  ) => {
    const {
      x = left + 6,
      width: available = width - 6,
      size = 9,
      bold = false,
      gap = 2,
    } = options;
    const lineHeight = Math.max(3.7, size * 0.43);
    for (const line of wrap(value, available, size, bold)) {
      ensure(lineHeight);
      text(line, x, y, size, bold);
      y += lineHeight;
    }
    y += gap;
  };
  const heading = (number: number, title: string, contentHeight = 9) => {
    const lines = wrap(`${number}.   ${title}`, width, 9.5, true);
    ensure(lines.length * 4 + contentHeight + 3);
    y += 2;
    for (const line of lines) {
      text(line, left, y, 9.5, true);
      y += 4.3;
    }
    y += 0.7;
  };
  const numbered = (number: number, value: string) => {
    const entries = value.trim() ? value.split("\n") : ["Not recorded"];
    entries.forEach((entry, i) =>
      paragraph(`${number}.${i + 1}   ${entry || " "}`),
    );
  };
  const table = (
    headers: string[],
    rows: string[][],
    widths: number[],
    size = 8,
  ) => {
    const lineHeight = Math.max(3.2, size * 0.42),
      padding = 1.3;
    const tableHead = () => {
      const lines = headers.map((h, i) =>
        wrap(h, widths[i] - padding * 2, size, true),
      );
      const height =
        Math.max(...lines.map((l) => l.length)) * lineHeight + padding * 2;
      ensure(height + 6);
      let x = left;
      for (let i = 0; i < headers.length; i++) {
        doc.setDrawColor(0);
        doc.setLineWidth(0.18);
        doc.rect(x, y, widths[i], height);
        lines[i].forEach((line, n) =>
          text(
            line,
            x + widths[i] / 2,
            y + padding + size * 0.3528 + n * lineHeight,
            size,
            true,
            "center",
          ),
        );
        x += widths[i];
      }
      y += height;
    };
    tableHead();
    for (const row of rows) {
      const lines = row.map((value, i) =>
        wrap(value || "-", widths[i] - padding * 2, size),
      );
      const total = Math.max(...lines.map((l) => l.length));
      let offset = 0;
      const fullHeight = total * lineHeight + padding * 2;
      if (fullHeight <= bottom - 38 && y + fullHeight > bottom) {
        newPage();
        tableHead();
      }
      while (offset < total) {
        if (y + lineHeight + padding * 2 > bottom) {
          newPage();
          tableHead();
        }
        const count = Math.min(
          total - offset,
          Math.max(1, Math.floor((bottom - y - padding * 2) / lineHeight)),
        );
        const height = count * lineHeight + padding * 2;
        let x = left;
        for (let i = 0; i < widths.length; i++) {
          doc.setDrawColor(0);
          doc.setLineWidth(0.18);
          doc.rect(x, y, widths[i], height);
          lines[i]
            .slice(offset, offset + count)
            .forEach((line, n) =>
              text(
                line,
                x + padding,
                y + padding + size * 0.3528 + n * lineHeight,
                size,
              ),
            );
          x += widths[i];
        }
        y += height;
        offset += count;
        if (offset < total) {
          newPage();
          tableHead();
        }
      }
    }
    y += 3;
  };
  const paired = (
    a: { number: number; title: string; body: string },
    b: { number: number; title: string; body: string },
  ) => {
    const gap = 8,
      col = (width - gap) / 2;
    const titleA = wrap(`${a.number}.   ${a.title}`, col, 9.2, true),
      titleB = wrap(`${b.number}.   ${b.title}`, col, 9.2, true);
    const bodyA = wrap(a.body || "Not recorded", col - 6, 8.7),
      bodyB = wrap(b.body || "Not recorded", col - 6, 8.7);
    const titleHeight = Math.max(titleA.length, titleB.length) * 3.9,
      availableLines = Math.max(
        1,
        Math.floor((bottom - 40 - titleHeight) / 3.7),
      );
    let offset = 0,
      total = Math.max(bodyA.length, bodyB.length);
    while (offset < total) {
      const count = Math.min(total - offset, availableLines);
      ensure(titleHeight + count * 3.7 + 5);
      y += 2;
      for (const [index, lines] of [titleA, titleB].entries())
        lines.forEach((line, n) =>
          text(line, left + index * (col + gap), y + n * 3.9, 9.2, true),
        );
      y += titleHeight;
      [bodyA, bodyB].forEach((lines, index) =>
        lines
          .slice(offset, offset + count)
          .forEach((line, n) =>
            text(line, left + 6 + index * (col + gap), y + n * 3.7, 8.7),
          ),
      );
      y += count * 3.7 + 3;
      offset += count;
      if (offset < total) newPage();
    }
  };

  brand();
  y = 27;
  // Centred, compact title block, matching the daily-report reference hierarchy.
  const centred = (value: string, size: number, bold = false) => {
    const lineHeight = Math.max(3.8, size * 0.43);
    for (const line of wrap(value, width, size, bold)) {
      text(line, 105, y, size, bold, "center");
      y += lineHeight;
    }
  };
  centred(record.projectName, 11, true);
  centred(
    daily.supervisionTitle || `${record.role} Site Supervisor`,
    10.5,
    true,
  );
  centred(`Daily Site Report No. ${daily.reportNumber || record.id}`, 10, true);
  centred(
    `(Report Period: ${daily.reportPeriod || reportDate(record.date)})`,
    10,
    true,
  );
  y += 2;
  text(reportDate(record.date), right, y, 9.5, true, "right");
  y += 5;
  if (record.fictional) {
    text("FICTIONAL DEMONSTRATION RECORD", 105, y, 7, true, "center");
    y += 4;
  }
  if (record.template.demo) {
    text(
      "Demonstration checklist - not approved engineering criteria",
      105,
      y,
      7,
      false,
      "center",
    );
    y += 4;
  }

  heading(1, "Contract Status (for Field Works only)", 18);
  const contractLeft = [
    `1.1   Time elapsed: ${daily.timeElapsed || "Not recorded"}`,
    `1.2   Time remaining: ${daily.timeRemaining || "Not recorded"}`,
    `Contract period: ${daily.contractPeriod || "Not recorded"}`,
  ].join("\n");
  const contractRight = [
    `Commencement date: ${daily.commencementDate || "Not recorded"}`,
    `Completion date: ${daily.completionDate || "Not recorded"}`,
  ].join("\n");
  // These entries are recorded text, not calculated contract or engineering decisions.
  const contractA = wrap(contractLeft, 76, 8.5),
    contractB = wrap(contractRight, 76, 8.5);
  const contractHeight = Math.max(contractA.length, contractB.length) * 3.6;
  ensure(contractHeight + 3);
  contractA.forEach((line, i) => text(line, left + 6, y + i * 3.6, 8.5));
  contractB.forEach((line, i) => text(line, left + 88, y + i * 3.6, 8.5));
  y += contractHeight + 3;
  heading(2, "Site Activities");
  numbered(2, daily.activities);
  heading(3, "Site Staff / Visitors", 18);
  paragraph("3.1   Site staff and workers (by observation)", {
    size: 8.7,
    gap: 1,
  });
  const staff = daily.staff.filter((r) =>
    Object.values(r).some((v) => v.trim()),
  );
  table(
    ["Occupation", "Company", "Number of people"],
    staff.length
      ? staff.map((r) => [r.occupation, r.company, r.people])
      : [["Not recorded", "-", "-"]],
    [58, 56, 52],
    8.5,
  );
  paired(
    {
      number: 4,
      title: "Safety / Fire Safety / Site Security",
      body: `4.1   ${daily.safety || "Not recorded"}`,
    },
    {
      number: 5,
      title: "Weather",
      body: `5.1   ${daily.weather.trim() || (record.weatherSnapshot ? `${record.weatherSnapshot.summary}, ${record.weatherSnapshot.temperatureC} C` : "Not recorded")}`,
    },
  );
  paired(
    {
      number: 6,
      title: "RFI Received Today",
      body: `6.1   ${daily.rfi || "Not recorded"}`,
    },
    {
      number: 7,
      title: "Architect Instruction",
      body: `7.1   ${daily.instructions || "Not recorded"}`,
    },
  );
  const failed = record.template.items
    .map((item, i) => ({
      item,
      index: i + 1,
      response: record.responses[item.id],
    }))
    .filter((i) => i.response?.status === "Fail");
  // Explicit checklist failures are reflected in the daily summary; never replace them with Nil.
  const failedText = failed.length
    ? "\nRecorded failed checklist items:\n" +
      failed
        .map(
          (f) =>
            `${f.index}. ${f.item.description}: ${f.response.remarks || "Remark not recorded"}`,
        )
        .join("\n")
    : "";
  paired(
    {
      number: 8,
      title: "Non-compliance",
      body: `8.1   ${daily.nonCompliance || "Not recorded"}${failedText}`,
    },
    {
      number: 9,
      title: "Site Memo Issued to Contractor Today",
      body: `9.1   Issued during report period: ${daily.memosIssued || "Not recorded"}\n9.2   Total issued: ${daily.memosTotal || "Not recorded"}`,
    },
  );
  heading(10, "Work Done", 20);
  const works = daily.workDone.filter((r) =>
    Object.values(r).some((v) => v.trim()),
  );
  table(
    [
      "Work activity",
      "No. of rigs",
      "Element / borehole no.",
      "Date of commencement",
      "Progress of work",
      "Work status",
      "Date of completion",
    ],
    works.length
      ? works.map((r) => [
          r.activity,
          r.rigs,
          r.element,
          r.commencement,
          r.progress,
          r.status,
          r.completion,
        ])
      : [["Not recorded", "-", "-", "-", "-", "-", "-"]],
    [22, 12, 21, 23, 34, 28, 26],
    7.8,
  );
  heading(11, "Testing", 17);
  const tests = daily.testing.filter((r) =>
    Object.values(r).some((v) => v.trim()),
  );
  table(
    ["Type of testing", "Completed testing"],
    tests.length
      ? tests.map((r) => [r.type, r.completed])
      : [["Not recorded", "-"]],
    [66, 100],
    8.7,
  );

  const sorted = orderedPhotos(photos),
    numbers = new Map(sorted.map((photo, index) => [photo.id, index]));
  const captionNotes: { label: string; caption: string }[] = [];
  const photoGrid = async (
    images: PhotoMeta[],
    number: number,
    title: string,
  ) => {
    const start = () => {
      newPage(`${number}.   ${title}`);
    };
    start();
    if (!images.length) {
      paragraph("No photographs are attached to this section.");
      return;
    }
    for (let i = 0; i < images.length; i += 2) {
      const pair = images.slice(i, i + 2);
      const col = width / 2;
      const captions = pair.map((p) => {
        const index = numbers.get(p.id)!;
        const label = `Photo ${index + 1} (${photoNumber(index)})`;
        const full = `${label}: ${p.caption || "No caption recorded."}`;
        const lines = wrap(full, col - 8, 8, true);
        if (lines.length > 8) {
          captionNotes.push({ label, caption: p.caption });
          return wrap(
            `${label}: see extended caption notes.`,
            col - 8,
            8,
            true,
          );
        }
        return lines;
      });
      const associations = pair.map((p) => {
        const item = record.template.items.find((i) => i.id === p.itemId);
        return wrap(
          item ? `Related item: ${item.description}` : "General observation",
          col - 8,
          7.2,
        );
      });
      const captionHeight = Math.max(
        ...captions.map(
          (l, index) => l.length * 3.2 + associations[index].length * 3.1,
        ),
      );
      const height = Math.max(78, 61 + captionHeight + 4);
      if (y + height > bottom) start();
      for (let c = 0; c < 2; c++) {
        const x = left + c * col;
        doc.setLineWidth(0.18);
        doc.setDrawColor(0);
        doc.rect(x, y, col, height);
        const p = pair[c];
        if (!p) continue;
        const scale = Math.min((col - 8) / p.width, 54 / p.height);
        const w = p.width * scale,
          h = p.height * scale;
        doc.addImage(
          new Uint8Array(await p.compressed.arrayBuffer()),
          "JPEG",
          x + (col - w) / 2,
          y + 4 + (54 - h) / 2,
          w,
          h,
        );
        let captionY = y + 61;
        for (const line of captions[c]) {
          text(line, x + col / 2, captionY, 8, true, "center");
          setFont(8, true);
          const length = Math.min(col - 8, doc.getTextWidth(line));
          doc.setLineWidth(0.15);
          doc.line(
            x + (col - length) / 2,
            captionY + 0.6,
            x + (col + length) / 2,
            captionY + 0.6,
          );
          captionY += 3.2;
        }
        associations[c].forEach((line, n) =>
          text(line, x + col / 2, captionY + 1 + n * 3.1, 7.2, false, "center"),
        );
      }
      y += height;
    }
  };
  await photoGrid(
    sorted.filter((p) => !p.reportSection || p.reportSection === "site"),
    12,
    "Site Photos",
  );
  let nextSection = 13;
  const cores = sorted.filter((p) => p.reportSection === "core");
  if (cores.length) {
    const groups = new Map<string, PhotoMeta[]>();
    for (const p of cores) {
      const key = p.reportGroup?.trim() || "Unspecified element";
      groups.set(key, [...(groups.get(key) || []), p]);
    }
    for (const [group, list] of groups)
      await photoGrid(list, nextSection, `Core Sample Log - ${group}`);
    nextSection++;
  }
  const plans = sorted.filter((p) => p.reportSection === "plan");
  if (plans.length) {
    for (const p of plans) {
      newPage(
        `${nextSection}.   Site Progress Plan (updated to ${reportDate(record.date)})`,
      );
      const index = numbers.get(p.id)!;
      const caption = `Photo ${index + 1} (${photoNumber(index)}): ${p.caption || "No caption recorded."}`;
      const lines = wrap(caption, width - 4, 8.5);
      const captionHeight = Math.min(lines.length, 8) * 3.7 + 8;
      const scale = Math.min(
          (width - 4) / p.width,
          (bottom - y - captionHeight - 4) / p.height,
        ),
        w = p.width * scale,
        h = p.height * scale;
      doc.setLineWidth(0.18);
      doc.rect(left, y, width, h + 4);
      doc.addImage(
        new Uint8Array(await p.compressed.arrayBuffer()),
        "JPEG",
        left + (width - w) / 2,
        y + 2,
        w,
        h,
      );
      y += h + 9;
      if (lines.length > 8) {
        captionNotes.push({ label: photoNumber(index), caption: p.caption });
        paragraph(`${photoNumber(index)}: see extended caption notes.`);
      } else paragraph(caption, { x: left, width, size: 8.5 });
    }
    nextSection++;
  }
  if (captionNotes.length) {
    newPage("Extended photographic captions");
    for (const note of captionNotes)
      paragraph(`${note.label}: ${note.caption}`, {
        x: left,
        width,
        size: 9,
        gap: 5,
      });
  }

  newPage(`${nextSection}.   Inspection Checklist Appendix`);
  paragraph(
    `${record.type} / Element: ${record.element} / Location: ${record.location}`,
    { x: left, width, size: 9, bold: true },
  );
  paragraph(
    `Inspection date / time: ${record.date} / ${record.time} (recorded local time)\nInspector: ${record.inspector} / ${record.role}${record.company ? `\nCompany: ${record.company}` : ""}\nPrepared by: ${daily.preparedBy || record.inspector}\nProject reference: ${record.projectReference}\nDrawing reference: ${record.drawing || "Not recorded"}\nTemplate: ${record.template.id} / version ${record.template.version}\nCreated: ${record.createdAt}\nUpdated: ${record.updatedAt}`,
    { x: left, width, size: 8.5 },
  );
  paragraph(gpsText(record.gps), { x: left, width, size: 8.5 });
  const checklist = record.template.items.map((item, index) => {
    const r = record.responses[item.id];
    const known = new Set(item.fields.flatMap((f) => [f.key, f.key + "Unit"]));
    const measurements = item.fields.map(
      (f) =>
        `${f.label}: ${r?.values[f.key] || "-"}${f.unit && r?.values[f.key + "Unit"] ? " " + r.values[f.key + "Unit"] : ""}`,
    );
    for (const [key, value] of Object.entries(r?.values || {}))
      if (!known.has(key)) measurements.push(`${key}: ${value}`);
    return [
      String(index + 1),
      item.description +
        (item.criteria ? "\nConfigured criteria: " + item.criteria.text : ""),
      r?.status || "Not Inspected",
      measurements.join("\n") || "-",
      r?.remarks || "-",
      (r?.reference || "-") +
        (item.criteria
          ? "\nCriteria document: " + item.criteria.documentReference
          : ""),
    ];
  });
  table(
    [
      "No.",
      "Inspection item",
      "Status",
      "Measurements / data",
      "Remarks",
      "Drawing / specification",
    ],
    checklist,
    [7, 40, 22, 32, 39, 26],
    7.8,
  );
  heading(nextSection + 1, "General Remarks");
  paragraph(record.remarks || "No general remarks recorded.", {
    x: left,
    width,
  });
  paragraph(
    "Statuses and measurements are recorded by the inspector. Completion is not formal review, approval or a digital signature. No compliance decision is calculated by this application.",
    { x: left, width, size: 7.5 },
  );
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page);
    doc.setDrawColor(0);
    doc.setLineWidth(0.18);
    doc.line(left, 279, right - 7, 279);
    const prepared = wrap(
      `Prepared by: ${daily.preparedBy || record.inspector} (${record.role})`,
      width - 16,
      7,
    );
    prepared
      .slice(0, 2)
      .forEach((line, i) => text(line, left, 282 + i * 2.8, 7));
    text(String(page), right, 282, 8, false, "right");
    if (page === 1 && record.weatherSnapshot && !daily.weather.trim()) {
      setFont(6.2);
      doc.textWithLink("Forecast summary: MET Norway", left, 286, {
        url: "https://www.met.no/",
      });
      doc.textWithLink("CC BY 4.0", left + 36, 286, {
        url: "https://creativecommons.org/licenses/by/4.0/",
      });
    }
    text(
      `${record.id} | Rev. ${record.revision} | ${record.status}`,
      left,
      289,
      6.2,
    );
    text(
      `Generated ${generated} | Page ${page} of ${doc.getNumberOfPages()}`,
      left,
      292,
      6.2,
    );
  }
  return doc.output("blob");
}
