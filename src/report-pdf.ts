import { wspLogo, wspLogoRatio } from "./brand-assets";
import { jsPDF } from "jspdf";
import { dailyReportDefaults, reportDate } from "./daily-report";
import {
  displayNo,
  localDate,
  photoNumber,
  type Inspection,
  type Photo,
  type PhotoMeta,
} from "./domain";
import { orderedPhotos } from "./photos";

// A4 site inspection report: 1. Detail of Inspection, 2. Inspection Item,
// 3. Site Photos (then core logs / progress plans when present). Daily-report
// data is kept in the record and exports but is not printed here.
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
  const number = displayNo(record);
  let y = 12;
  const font = fontBase64 ? "Report" : "times";
  if (fontBase64) {
    doc.addFileToVFS("Report.ttf", fontBase64);
    doc.addFont("Report.ttf", "Report", "normal");
  }
  doc.setProperties({
    title: `Site Inspection Report - ${number}`,
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
  const newPage = (title = `Inspection No. ${number} - continued`) => {
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
  const table = (
    headers: string[],
    rows: string[][],
    widths: number[],
    size = 8,
    emphasis?: (row: string[], column: number) => boolean,
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
      const bold = row.map((_, i) => !!emphasis?.(row, i));
      const lines = row.map((value, i) =>
        wrap(value || "-", widths[i] - padding * 2, size, bold[i]),
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
                bold[i],
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

  brand();
  y = 27;
  const centred = (value: string, size: number, bold = false) => {
    const lineHeight = Math.max(3.8, size * 0.43);
    for (const line of wrap(value, width, size, bold)) {
      text(line, 105, y, size, bold, "center");
      y += lineHeight;
    }
  };
  centred(record.projectName, 11, true);
  centred(`(Project Reference: ${record.projectReference})`, 9);
  centred(`Inspection No. ${number}`, 9);
  y += 3;
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

  // 1. Detail of Inspection. Weather sits directly after Location. A weather
  // observation recorded by the inspector takes precedence over the saved forecast.
  const stamp = (iso: string) => {
    const d = new Date(iso);
    return isNaN(+d)
      ? iso
      : `${localDate(d)} / ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const observed = daily.weather.trim();
  const weather =
    observed ||
    (record.weatherSnapshot
      ? `${record.weatherSnapshot.summary}, ${record.weatherSnapshot.temperatureC} C (forecast)`
      : "Not recorded");
  heading(1, "Detail of Inspection", 36);
  for (const line of [
    `Type: ${record.type}`,
    `Element: ${record.element}`,
    `Location: ${record.location}`,
    `Weather: ${weather}`,
    `Inspection date / time: ${record.date} / ${record.time}`,
    `Inspector: ${record.inspector} / ${record.role}`,
    ...(record.company ? [`Company: ${record.company}`] : []),
    `Drawing reference: ${record.drawing || "Not recorded"}`,
    `Created: ${stamp(record.createdAt)}`,
    `Updated: ${stamp(record.updatedAt)}`,
  ])
    paragraph(line, { size: 9, gap: 0.4 });
  y += 3;

  // 2. Inspection Item. The fourth column only ever holds values recorded against
  // the item's measurement fields, so it is headed as such.
  heading(2, "Inspection Item", 22);
  const checklist = record.template.items.map((item, index) => {
    const r = record.responses[item.id];
    const values = r?.values || {};
    const known = new Set(item.fields.flatMap((f) => [f.key, f.key + "Unit"]));
    const measurements = item.fields
      .filter((f) => values[f.key]?.trim())
      .map(
        (f) =>
          `${f.label}: ${values[f.key]}${f.unit && values[f.key + "Unit"] ? " " + values[f.key + "Unit"] : ""}`,
      );
    for (const [key, value] of Object.entries(values))
      if (!known.has(key) && value.trim())
        measurements.push(`${key}: ${value}`);
    return [
      String(index + 1),
      item.description +
        (item.criteria ? "\nConfigured criteria: " + item.criteria.text : ""),
      r?.status || "Not Inspected",
      measurements.join("\n") || (item.fields.length ? "Not recorded" : "-"),
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
      "Recorded measurements / data",
      "Remarks",
      "Drawing / specification",
    ],
    checklist,
    [7, 40, 20, 34, 39, 26],
    7.8,
    // Failed items stay identifiable: their status is printed in bold.
    (row, column) => column === 2 && row[2] === "Fail",
  );
  y += 2;
  if (record.remarks.trim()) {
    paragraph("General remarks", {
      x: left,
      width,
      size: 9,
      bold: true,
      gap: 0.6,
    });
    paragraph(record.remarks, { x: left, width, size: 8.5 });
  }
  paragraph(
    "Statuses and measurements are recorded by the inspector. Completion is not formal review, approval or a digital signature. No compliance decision is calculated by this application.",
    { x: left, width, size: 7.5 },
  );

  const sorted = orderedPhotos(photos),
    numbers = new Map(sorted.map((photo, index) => [photo.id, index]));
  const captionNotes: { label: string; caption: string }[] = [];
  const itemLabel = (p: PhotoMeta) => {
    const index = record.template.items.findIndex((i) => i.id === p.itemId);
    return index < 0
      ? "Inspection Item: General observation"
      : `Inspection Item: ${index + 1}. ${record.template.items[index].description}`;
  };
  // Everything printed in a cell is derived from that one photo object, so a
  // caption, item or remark can never come from a neighbouring photograph.
  const MAX_LINES = 8;
  const photoBlock = (p: PhotoMeta, cellWidth: number) => {
    const index = numbers.get(p.id)!;
    const label = `Photo ${index + 1} (${photoNumber(index)})`;
    let caption = wrap(
      `${label}: ${p.caption || "No caption recorded."}`,
      cellWidth - 8,
      8,
      true,
    );
    if (caption.length > MAX_LINES) {
      captionNotes.push({ label, caption: p.caption });
      caption = wrap(
        `${label}: see extended caption notes.`,
        cellWidth - 8,
        8,
        true,
      );
    }
    let item = wrap(itemLabel(p), cellWidth - 8, 7.2);
    if (item.length > 4) {
      captionNotes.push({
        label: `${label} inspection item`,
        caption: itemLabel(p),
      });
      item = wrap(
        "Inspection Item: see extended caption notes.",
        cellWidth - 8,
        7.2,
      );
    }
    let remark = p.remark?.trim()
      ? wrap(`Remark: ${p.remark.trim()}`, cellWidth - 8, 7.2)
      : [];
    if (remark.length > MAX_LINES) {
      captionNotes.push({
        label: `${label} remark`,
        caption: p.remark!.trim(),
      });
      remark = wrap("Remark: see extended caption notes.", cellWidth - 8, 7.2);
    }
    const textHeight =
      caption.length * 3.2 + 1 + (item.length + remark.length) * 3.1;
    return {
      p,
      caption,
      item,
      remark,
      height: Math.max(78, 61 + textHeight + 4),
    };
  };
  const photoGrid = async (
    images: PhotoMeta[],
    number: number,
    title: string,
  ) => {
    const heading = `${number}.   ${title}`;
    newPage(heading);
    if (!images.length) {
      paragraph("No photographs are attached to this section.");
      return;
    }
    const col = width / 2;
    for (let i = 0; i < images.length; i += 2) {
      const row = images.slice(i, i + 2).map((p) => photoBlock(p, col));
      const height = Math.max(...row.map((b) => b.height));
      // A photograph and its text always stay together on one page.
      if (y + height > bottom) newPage(`${heading} (continued)`);
      // A lone photograph is centred; no empty neighbouring cell is drawn.
      const startX = row.length === 1 ? left + col / 2 : left;
      for (const [c, block] of row.entries()) {
        const x = startX + c * col,
          p = block.p;
        doc.setLineWidth(0.18);
        doc.setDrawColor(0);
        doc.rect(x, y, col, height);
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
        let lineY = y + 61;
        for (const line of block.caption) {
          text(line, x + col / 2, lineY, 8, true, "center");
          setFont(8, true);
          const length = Math.min(col - 8, doc.getTextWidth(line));
          doc.setLineWidth(0.15);
          doc.line(
            x + (col - length) / 2,
            lineY + 0.6,
            x + (col + length) / 2,
            lineY + 0.6,
          );
          lineY += 3.2;
        }
        lineY += 1;
        for (const line of [...block.item, ...block.remark]) {
          text(line, x + 4, lineY, 7.2);
          lineY += 3.1;
        }
      }
      y += height;
    }
  };
  await photoGrid(
    sorted.filter((p) => !p.reportSection || p.reportSection === "site"),
    3,
    "Site Photos",
  );
  let nextSection = 4;
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
      const label = `Photo ${index + 1} (${photoNumber(index)})`;
      const body = `${p.caption || "No caption recorded."}\n${itemLabel(p)}${p.remark?.trim() ? `\nRemark: ${p.remark.trim()}` : ""}`;
      const caption = `${label}: ${body}`;
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
        captionNotes.push({ label, caption: body });
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
    if (page === 1 && record.weatherSnapshot && !observed) {
      setFont(6.2);
      doc.textWithLink("Forecast summary: MET Norway", left, 286, {
        url: "https://www.met.no/",
      });
      doc.textWithLink("CC BY 4.0", left + 36, 286, {
        url: "https://creativecommons.org/licenses/by/4.0/",
      });
    }
    text(
      `${number} | Rev. ${record.revision} | ${record.status}`,
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
