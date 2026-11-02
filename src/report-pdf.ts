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
  type ReportPlans,
} from "./domain";
import { orderedPhotos } from "./photos";
import { legendRows, markLabels } from "./plan-labels";

// A4 site inspection report: 1. Detail of Inspection, 2. Inspection Item,
// 3. Location Plan (when drawings exist), then Site Photos, core logs and
// progress plans when present. Daily-report
// data is kept in the record and exports but is not printed here.
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
  const labels = markLabels(
    record.template.items,
    plans?.annotations ?? [],
    plans?.drawings ?? [],
  );
  const itemLabel = (p: PhotoMeta) => {
    const index = record.template.items.findIndex((i) => i.id === p.itemId);
    const location = p.markId && labels.get(p.markId);
    return (
      (index < 0
        ? "Inspection Item: General observation"
        : `Inspection Item: ${index + 1}. ${record.template.items[index].description}`) +
      (location ? ` | Plan location ${location.label}` : "")
    );
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
  // Location plans: one page per marked drawing page, oriented to suit the
  // drawing, whole drawing shown (never cropped), marks drawn as vectors at their
  // drawing-relative positions, and the checklist-aligned legend underneath or,
  // when it would squeeze the drawing, on the following page(s).
  const NAVY: [number, number, number] = [23, 33, 43];
  async function planPages(plans: ReportPlans, section: number) {
    const order = [...plans.drawings].sort(
      (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
    );
    for (const [n, pg] of plans.pages.entries()) {
      const d = pg.drawing,
        drawingNo = order.findIndex((x) => x.id === d.id) + 1;
      // Plan pages stay portrait like the rest of the report. A landscape drawing
      // is turned 90 degrees when that makes it larger (read by turning the
      // page clockwise), instead of shrinking it onto a landscape page.
      doc.addPage("a4", "portrait");
      const H = doc.internal.pageSize.getHeight(),
        L = left,
        R = right;
      brand(L);
      let ty = 24;
      const heading = `${section}.   Location Plan${n ? " (continued)" : ""}`;
      text(heading, L, ty, 9.5, true);
      ty += 4.6;
      const info = `Drawing ${drawingNo}: ${d.title || "[Drawing title]"}  |  Drawing No. ${d.number || "[Drawing number]"}  |  Rev. ${d.revision || "[Rev.]"}  |  Source page ${pg.page} of ${d.pageCount}`;
      for (const line of wrap(info, R - L, 8.5)) {
        text(line, L, ty, 8.5);
        ty += 3.8;
      }
      const rows = legendRows(record, plans.annotations, plans.drawings, {
        drawingId: d.id,
        page: pg.page,
      });
      const cols = [16, R - L - 16 - 28, 28];
      const rowLines = rows.map((r) => wrap(r.item, cols[1] - 2, 7.5));
      const legendH = rows.length
        ? 9 + rowLines.reduce((h, l) => h + l.length * 3.3 + 1.6, 0)
        : 0;
      const mayTurn = pg.width > pg.height;
      const top = ty + 1,
        floor = H - 21 - (mayTurn ? 4.5 : 0),
        full = floor - top;
      const inline = rows.length > 0 && full - legendH >= full * 0.6;
      const areaH = full - (inline ? legendH : 0);
      const straight = Math.min((R - L) / pg.width, areaH / pg.height),
        turnedK = Math.min((R - L) / pg.height, areaH / pg.width);
      const turned = mayTurn && turnedK > straight * 1.05;
      const k = turned ? turnedK : straight;
      // w x h: the drawing's own size; bw x bh: the box it occupies on the page.
      const w = pg.width * k,
        h = pg.height * k,
        bw = turned ? h : w,
        bh = turned ? w : h,
        x0 = L + (R - L - bw) / 2,
        y0 = top;
      if (turned)
        // jsPDF turns the image 90 degrees anticlockwise about its bottom-left
        // corner; this origin places the turned image exactly in the box.
        doc.addImage(
          pg.jpeg,
          "JPEG",
          x0 + h,
          y0 + w - h,
          w,
          h,
          undefined,
          "FAST",
          90,
        );
      else doc.addImage(pg.jpeg, "JPEG", x0, y0, w, h, undefined, "FAST");
      doc.setDrawColor(0);
      doc.setLineWidth(0.25);
      doc.rect(x0, y0, bw, bh);
      // Drawing-relative (u, v) to page position; after the anticlockwise turn
      // the point lands at (v, 1 - u) within the box.
      const P = (u: number, v: number): [number, number] =>
        turned ? [x0 + v * bw, y0 + (1 - u) * bh] : [x0 + u * bw, y0 + v * bh];
      const marks = plans.annotations.filter(
        (a) => a.drawingId === d.id && a.page === pg.page,
      );
      const stroke = (draw: () => void) => {
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(1.3);
        draw();
        doc.setDrawColor(...NAVY);
        doc.setLineWidth(0.55);
        draw();
      };
      for (const a of marks) {
        const [x1, y1] = P(a.x, a.y),
          [x2, y2] = P(a.x2 ?? a.x, a.y2 ?? a.y);
        if (a.kind === "rect")
          stroke(() =>
            doc.rect(
              Math.min(x1, x2),
              Math.min(y1, y2),
              Math.abs(x2 - x1),
              Math.abs(y2 - y1),
            ),
          );
        else if (a.kind === "circle")
          stroke(() =>
            doc.ellipse(
              (x1 + x2) / 2,
              (y1 + y2) / 2,
              Math.abs(x2 - x1) / 2,
              Math.abs(y2 - y1) / 2,
              "S",
            ),
          );
        else if (a.kind === "arrow") {
          const ang = Math.atan2(y2 - y1, x2 - x1),
            head = 3;
          stroke(() => {
            doc.line(x1, y1, x2, y2);
            doc.line(
              x2,
              y2,
              x2 - head * Math.cos(ang - 0.45),
              y2 - head * Math.sin(ang - 0.45),
            );
            doc.line(
              x2,
              y2,
              x2 - head * Math.cos(ang + 0.45),
              y2 - head * Math.sin(ang + 0.45),
            );
          });
        } else if (a.kind === "text" && a.text) {
          setFont(7, true);
          const tw = Math.min(doc.getTextWidth(a.text) + 3, bw);
          const bx = Math.min(x1, x0 + bw - tw);
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(...NAVY);
          doc.setLineWidth(0.35);
          doc.rect(bx, y1 - 2.6, tw, 5.2, "FD");
          doc.setTextColor(...NAVY);
          doc.text(a.text, bx + 1.5, y1 + 1, { maxWidth: tw - 2 });
        }
      }
      for (const a of marks.filter((m) => m.kind === "marker")) {
        const l = labels.get(a.id);
        const label = l?.label ?? "?";
        setFont(7.5, true);
        const pill = Math.max(5.8, doc.getTextWidth(label) + 2.6),
          [cx, cy] = P(a.x, a.y);
        // White halo then navy disc keeps the label readable on any drawing.
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(
          cx - pill / 2 - 0.7,
          cy - 3.6,
          pill + 1.4,
          7.2,
          3.6,
          3.6,
          "F",
        );
        doc.setFillColor(
          ...(l?.linked ? NAVY : ([255, 255, 255] as [number, number, number])),
        );
        doc.setDrawColor(...NAVY);
        doc.setLineWidth(0.35);
        doc.roundedRect(cx - pill / 2, cy - 2.9, pill, 5.8, 2.9, 2.9, "FD");
        doc.setTextColor(
          ...(l?.linked ? ([255, 255, 255] as [number, number, number]) : NAVY),
        );
        doc.text(label, cx, cy + 1, { align: "center" });
      }
      doc.setTextColor(0, 0, 0);
      let below = y0 + bh + 4;
      if (turned) {
        text(
          "Drawing turned 90 degrees to use the full page: turn the page clockwise to read it.",
          L,
          below,
          7.5,
        );
        below += 4.5;
      }
      if (!rows.length) {
        text("No marked locations on this page.", L, below, 7.5);
        continue;
      }
      const legendTitle = `Legend - Drawing ${drawingNo}, page ${pg.page}`;
      if (inline) {
        let ly = below;
        text(legendTitle, L, ly, 8, true);
        ly += 1.5;
        const cell = (x: number, cw: number, rh: number) => {
          doc.setDrawColor(0);
          doc.setLineWidth(0.15);
          doc.rect(x, ly, cw, rh);
        };
        const xs = [L, L + cols[0], L + cols[0] + cols[1]];
        ["Mark", "Checklist item", "Status"].forEach((t, i) => {
          cell(xs[i], cols[i], 4.4);
          text(t, xs[i] + 1.2, ly + 3.1, 7.5, true);
        });
        ly += 4.4;
        rows.forEach((r, i) => {
          const rh = rowLines[i].length * 3.3 + 1.6;
          cols.forEach((cw, c) => cell(xs[c], cw, rh));
          text(r.label, xs[0] + 1.2, ly + 3, 7.5, true);
          rowLines[i].forEach((line, j) =>
            text(line, xs[1] + 1.2, ly + 3 + j * 3.3, 7.5),
          );
          text(r.status, xs[2] + 1.2, ly + 3, 7.5, r.status === "Fail");
          ly += rh;
        });
      } else {
        text("Legend continues on the next page.", L, below, 7.5, true);
        newPage(`${section}.   ${legendTitle}`);
        table(
          ["Mark", "Checklist item", "Status"],
          rows.map((r) => [r.label, r.item, r.status]),
          [18, 118, 30],
          8,
          (row, column) => column === 2 && row[2] === "Fail",
        );
      }
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
    "Site Photos",
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
    if (page === 1 && record.weatherSnapshot && !observed) {
      setFont(6.2);
      doc.textWithLink("Forecast summary: MET Norway", fl, 286 + fy, {
        url: "https://www.met.no/",
      });
      doc.textWithLink("CC BY 4.0", fl + 36, 286 + fy, {
        url: "https://creativecommons.org/licenses/by/4.0/",
      });
    }
    text(
      `${number} | Rev. ${record.revision} | ${record.status}`,
      fl,
      289 + fy,
      6.2,
    );
    text(
      `Generated ${generated} | Page ${page} of ${doc.getNumberOfPages()}`,
      fl,
      292 + fy,
      6.2,
    );
  }
  return doc.output("blob");
}
