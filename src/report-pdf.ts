import { wspLogo, wspLogoRatio } from "./brand-assets";
import { jsPDF } from "jspdf";
import { dailyReportDefaults, reportDate } from "./daily-report";
import {
  HIGHLIGHT_RGB,
  displayDate,
  displayNo,
  highlightColor,
  highlightOpacity,
  highlightWidth,
  localDate,
  photoNumber,
  type Inspection,
  type Photo,
  type PhotoMeta,
  type ReportPlans,
} from "./domain";
import { orderedPhotos } from "./photos";
import { statusText } from "./plan-labels";
import { highlightStrokes, locationRegion } from "./drawings";

/** A photo remark worth printing: not blank and not a filler placeholder. */
export const realRemark = (remark: string | undefined) => {
  const value = remark?.trim() ?? "";
  return !!value && !/^(not recorded|n\/a|-)$/i.test(value);
};

// A4 site inspection report: 1. Inspection Information, 2. Inspection
// Checklist, 3. Location Plan (when drawings exist), then Photographic Records,
// core logs and progress plans when present. Daily-report data is kept in the
// record and exports but is not printed here.
export async function renderInspectionReport(
  record: Inspection,
  photos: PhotoMeta[],
  fontBase64?: string,
  plans?: ReportPlans,
): Promise<Blob> {
  const daily = dailyReportDefaults(record),
    doc = new jsPDF({ unit: "mm", format: "a4" });
  const left = 24,
    width = 166,
    right = left + width,
    bottom = 270;
  // Date only, from the device's local calendar (never shifted by UTC).
  const generated = displayDate(localDate(new Date()));
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
  const brand = (x = left) => {
    doc.setFont(
      fontBase64 ? "Report" : "helvetica",
      fontBase64 ? "normal" : "bold",
    );
    doc.setFontSize(13);
    doc.setTextColor(45, 45, 45);
    doc.addImage(
      wspLogo,
      "PNG",
      x,
      7,
      18,
      18 / wspLogoRatio,
      "wsp-logo",
      "FAST",
    );
    doc.text("SITE INSPECTION", x + 24, 13);
  };
  const newPage = (title = `Inspection No. ${number} - continued`) => {
    // Explicitly portrait: jsPDF otherwise keeps the orientation of the last
    // (possibly landscape plan) page for every later page.
    doc.addPage("a4", "portrait");
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

  // 1. Inspection Information: identification only. The inspection number is
  // printed once, in the heading above. Location, overall date/time, weather,
  // company and general remarks are kept in the record but not printed; each
  // checklist item carries its own inspection date.
  heading(1, "Inspection Information", 30);
  for (const line of [
    `Project: ${record.projectName} (${record.projectReference})`,
    `Element Name: ${record.element}`,
    `Inspection Type: ${record.type}`,
    `Inspector: ${record.inspector}`,
    `TCP Grade: ${record.role}`,
    `Drawing Reference: ${record.drawing || "Not recorded"}`,
  ])
    paragraph(line, { size: 9, gap: 0.4 });
  y += 3;

  // 2. Inspection Checklist: result, the item's own inspection date and its
  // remarks. Measurement/reference values from earlier versions are not printed.
  heading(2, "Inspection Checklist", 22);
  const checklist = record.template.items.map((item, index) => {
    const r = record.responses[item.id];
    return [
      String(index + 1),
      item.description +
        (item.criteria
          ? `\nConfigured criteria: ${item.criteria.text}\nCriteria document: ${item.criteria.documentReference}`
          : ""),
      statusText(r?.status),
      displayDate(r?.date),
      r?.remarks?.trim() || "-",
    ];
  });
  table(
    ["No.", "Inspection item", "Result", "Inspection Date", "Remarks"],
    checklist,
    [9, 68, 20, 24, 45],
    7.8,
    // Failed items stay identifiable: their result is printed in bold.
    (row, column) => column === 2 && row[2] === "Fail",
  );

  const sorted = orderedPhotos(photos),
    numbers = new Map(sorted.map((photo, index) => [photo.id, index]));
  const captionNotes: { label: string; caption: string }[] = [];
  /**
   * Everything printed for a photograph comes from that photo and the checklist
   * item it is assigned to: the item's description as the title, the photo's own
   * remark, the item number and the item's inspection date (never the upload,
   * capture or report date).
   */
  const photoText = (p: PhotoMeta) => {
    const index = numbers.get(p.id)!;
    const itemIndex = record.template.items.findIndex((i) => i.id === p.itemId);
    const item = itemIndex < 0 ? undefined : record.template.items[itemIndex];
    const title = (
      item?.description ||
      p.caption.trim() ||
      "General observation"
    ).trim();
    return {
      label: `Photo ${index + 1} (${photoNumber(index)})`,
      title: /[.!?]$/.test(title) ? title : `${title}.`,
      // Only a real remark is printed: empty ones and the "Not recorded" style
      // placeholders some earlier records hold produce no line at all.
      remark: realRemark(p.remark) ? `Remarks: ${p.remark!.trim()}` : "",
      item: `Inspection Item: ${itemIndex < 0 ? "General" : itemIndex + 1}`,
      date: `Inspection Date: ${displayDate(item && record.responses[item.id]?.date)}`,
    };
  };
  const MAX_LINES = 8;
  const photoBlock = (p: PhotoMeta, cellWidth: number) => {
    const t = photoText(p);
    let caption = wrap(`${t.label}: ${t.title}`, cellWidth - 8, 8, true);
    if (caption.length > MAX_LINES) {
      captionNotes.push({ label: t.label, caption: t.title });
      caption = wrap(
        `${t.label}: see extended caption notes.`,
        cellWidth - 8,
        8,
        true,
      );
    }
    let remark = t.remark ? wrap(t.remark, cellWidth - 8, 7.2) : [];
    if (remark.length > MAX_LINES) {
      captionNotes.push({
        label: `${t.label} remarks`,
        caption: p.remark!.trim(),
      });
      remark = wrap("Remarks: see extended caption notes.", cellWidth - 8, 7.2);
    }
    const item = [
      ...wrap(t.item, cellWidth - 8, 7.2),
      ...wrap(t.date, cellWidth - 8, 7.2),
    ];
    const textHeight =
      caption.length * 3.2 + 1 + (remark.length + item.length) * 3.1;
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
        for (const line of [...block.remark, ...block.item]) {
          text(line, x + 4, lineY, 7.2);
          lineY += 3.1;
        }
      }
      y += height;
    }
  };
  // 3. Location Plan: one A4 landscape page per printed drawing page. The page
  // itself is landscape (the drawing is never rotated on it); the whole drawing
  // is scaled to fit with its aspect ratio kept. Highlighter strokes and the
  // location region are drawn as vectors at their drawing-relative positions.
  // No legend or instructions.
  const RED: [number, number, number] = [220, 38, 38];
  async function planPages(plans: ReportPlans, section: number) {
    const order = [...plans.drawings].sort(
      (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
    );
    const region = locationRegion(plans.annotations);
    const strokes = highlightStrokes(plans.annotations);
    for (const [n, pg] of plans.pages.entries()) {
      const d = pg.drawing,
        drawingNo = order.findIndex((x) => x.id === d.id) + 1;
      const info = `Drawing ${drawingNo}: ${d.title || "[Drawing title]"}  |  Drawing No. ${d.number || "[Drawing number]"}  |  Rev. ${d.revision || "[Rev.]"}${d.pageCount > 1 ? `  |  Page ${pg.page} of ${d.pageCount}` : ""}`;
      doc.addPage("a4", "landscape");
      const W = doc.internal.pageSize.getWidth(),
        H = doc.internal.pageSize.getHeight(),
        L = 14,
        R = W - L;
      const top = 24 + 4.6 + wrap(info, R - L, 8.5).length * 3.8 + 1;
      // Fill the area between the heading and the footer rule (H - 18).
      const k = Math.min((R - L) / pg.width, (H - 20 - top) / pg.height);
      brand(L);
      let ty = 24;
      text(
        `${section}.   Location Plan${n ? " (continued)" : ""}`,
        L,
        ty,
        9.5,
        true,
      );
      ty += 4.6;
      for (const line of wrap(info, R - L, 8.5)) {
        text(line, L, ty, 8.5);
        ty += 3.8;
      }
      const w = pg.width * k,
        h = pg.height * k,
        x0 = L + (R - L - w) / 2,
        y0 = top;
      doc.addImage(pg.jpeg, "JPEG", x0, y0, w, h, undefined, "FAST");
      doc.setDrawColor(0);
      doc.setLineWidth(0.25);
      doc.rect(x0, y0, w, h);
      // Highlighter strokes: one round-capped path each, so overlapping
      // segments of a stroke do not darken; the drawing stays visible beneath.
      for (const s of strokes.filter(
        (a) => a.drawingId === d.id && a.page === pg.page,
      )) {
        const pts = s.points!.map(([u, v]) => [x0 + u * w, y0 + v * h]);
        try {
          doc.saveGraphicsState();
          doc.setGState(doc.GState({ "stroke-opacity": highlightOpacity(s) }));
          doc.setDrawColor(...HIGHLIGHT_RGB[highlightColor(s)]);
          doc.setLineWidth(highlightWidth(s) * w);
          doc.setLineCap("round");
          doc.setLineJoin("round");
          doc.lines(
            pts.slice(1).map(([x, yy], i) => [x - pts[i][0], yy - pts[i][1]]),
            pts[0][0],
            pts[0][1],
            [1, 1],
            "S",
          );
          doc.restoreGraphicsState();
        } catch {
          /* A stroke that cannot be drawn never blocks the report. */
        }
      }
      doc.setLineCap("butt");
      doc.setLineJoin("miter");
      if (region && region.drawingId === d.id && region.page === pg.page) {
        const rx = x0 + Math.min(region.x, region.x2 ?? region.x) * w,
          ry = y0 + Math.min(region.y, region.y2 ?? region.y) * h,
          rw = Math.abs((region.x2 ?? region.x) - region.x) * w,
          rh = Math.abs((region.y2 ?? region.y) - region.y) * h;
        // Light transparent fill where supported, then a white halo and a red
        // outline so the region reads on any drawing.
        try {
          doc.saveGraphicsState();
          doc.setGState(doc.GState({ opacity: 0.15 }));
          doc.setFillColor(...RED);
          doc.rect(rx, ry, rw, rh, "F");
          doc.restoreGraphicsState();
        } catch {
          /* The outline alone still identifies the region. */
        }
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(1.2);
        doc.rect(rx, ry, rw, rh);
        doc.setDrawColor(...RED);
        doc.setLineWidth(0.6);
        doc.rect(rx, ry, rw, rh);
      }
      doc.setDrawColor(0);
    }
  }
  let section = 3;
  if (plans?.pages.length) {
    await planPages(plans, section);
    section++;
  }
  await photoGrid(
    sorted.filter((p) => !p.reportSection || p.reportSection === "site"),
    section,
    "Photographic Records",
  );
  let nextSection = section + 1;
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
  const progressPlans = sorted.filter((p) => p.reportSection === "plan");
  if (progressPlans.length) {
    for (const p of progressPlans) {
      newPage(
        `${nextSection}.   Site Progress Plan (updated to ${reportDate(record.date)})`,
      );
      const index = numbers.get(p.id)!;
      const t = photoText(p);
      const label = t.label;
      const body = [t.title, t.remark, t.item, t.date]
        .filter(Boolean)
        .join("\n");
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
    // Footer positions follow each page's own size (plan pages may be landscape).
    const W = doc.internal.pageSize.getWidth(),
      H = doc.internal.pageSize.getHeight(),
      fl = W > H ? 14 : left,
      fr = W > H ? W - 14 : right,
      fy = H - 297;
    doc.setDrawColor(0);
    doc.setLineWidth(0.18);
    doc.line(fl, 279 + fy, fr - 7, 279 + fy);
    const prepared = wrap(
      `Prepared by: ${daily.preparedBy || record.inspector} (${record.role})`,
      width - 16,
      7,
    );
    prepared
      .slice(0, 2)
      .forEach((line, i) => text(line, fl, 282 + fy + i * 2.8, 7));
    text(String(page), fr, 282 + fy, 8, false, "right");
    text(
      `Generated: ${generated} | Page ${page} of ${doc.getNumberOfPages()}`,
      fl,
      289 + fy,
      6.2,
    );
  }
  return doc.output("blob");
}
