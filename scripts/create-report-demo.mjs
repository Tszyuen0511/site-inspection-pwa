import { createServer } from "vite";
import { readFile, mkdir, writeFile } from "node:fs/promises";
// Uses the application's real export function, never the supplied project PDF.
const server = await createServer({
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: "custom",
});
try {
  const { newInspection, templates } =
    await server.ssrLoadModule("/src/domain.ts");
  const { dailyReportDefaults } = await server.ssrLoadModule(
    "/src/daily-report.ts",
  );
  const { generatePDF } = await server.ssrLoadModule("/src/export.ts");
  const r = newInspection(
    {
      projectId: "format-demo",
      projectName:
        "Demo Geotechnical Works - Ground Investigation and Temporary Retaining Works (Fictional Project)",
      projectReference: "DEMO-2026-001",
      date: "2026-10-31",
      time: "09:30",
      type: "Sheet Pile",
      element: "SP-DEMO-001",
      location: "Demo Zone A / CH 0+120",
      inspector: "Demo Inspector",
      role: "TCP T3",
      drawing: "DEMO-SP-101 Rev A",
      remarks:
        "Fictional demonstration of the revised report layout. All values, descriptions and illustrations are examples only. Follow up the recorded corner weld observation against the project documentation.",
    },
    templates[0],
  );
  r.id = "INSP-FORMAT-DEMO-0001";
  r.fictional = true;
  r.status = "Completed";
  for (const [i, item] of r.template.items.entries()) {
    r.responses[item.id].status = "Pass";
    r.responses[item.id].reference = r.drawing;
    if (i === 0)
      r.responses[item.id].remarks =
        "Fictional setting-out observation recorded.";
  }
  r.responses["corner-welding"].status = "Fail";
  r.responses["corner-welding"].remarks =
    "Fictional observation: corner weld detail requires follow-up against the referenced drawing.";
  r.responses["toe-level"].values = {
    specifiedLevel: "-12.5000",
    measuredLevel: "-12.4800",
    units: "m",
    datum: "Demo datum",
  };
  r.responses["trial-pit"].values = { depth: "1.500", depthUnit: "m" };
  r.dailyReport = {
    ...dailyReportDefaults(r),
    reportNumber: "DEMO-SSP-001",
    reportPeriod: "31 October 2026",
    commencementDate: "1 October 2026",
    completionDate: "29 December 2026 (demo)",
    contractPeriod: "90 calendar days (recorded example)",
    timeElapsed: "31 days (recorded example)",
    timeRemaining: "59 days (recorded example)",
    activities:
      "Sheet pile setting-out observations at Demo Zone A.\nTrial pit depth records and sheet pile toe level measurements.\nPhotographic record of work areas and demonstration sample boxes.",
    staff: [
      {
        occupation: "TCP T3 Site Supervisor",
        company: "Demo Supervision",
        people: "1",
      },
      { occupation: "Site Engineer", company: "Demo Contractor", people: "1" },
      { occupation: "Workers", company: "Demo Contractor", people: "6" },
    ],
    safety: "Fictional example: access routes and work areas observed.",
    weather: "Fictional example: sunny conditions.",
    rfi: "Nil (fictional example)",
    instructions: "Nil (fictional example)",
    nonCompliance: "Refer to the recorded checklist observations.",
    memosIssued: "1 (demo)",
    memosTotal: "3 (demo)",
    workDone: [
      {
        activity: "Sheet pile works",
        rigs: "1",
        element: "SP-DEMO-001",
        commencement: "30/10/2026",
        progress: "Setting out recorded",
        status: "In progress (demo)",
        completion: "-",
      },
      {
        activity: "Trial pit",
        rigs: "-",
        element: "TP-DEMO-01",
        commencement: "31/10/2026",
        progress: "Depth recorded: 1.500 m",
        status: "Recorded (demo)",
        completion: "31/10/2026",
      },
      {
        activity: "Sample record",
        rigs: "-",
        element: "BH-DEMO-01",
        commencement: "31/10/2026",
        progress: "Two sample box illustrations",
        status: "Demo content",
        completion: "-",
      },
    ],
    testing: [
      {
        type: "Weld test records",
        completed:
          "See checklist and drawing reference; no acceptance inferred",
      },
      { type: "Other testing", completed: "Not recorded" },
    ],
  };
  const captions = [
    "Demonstration work area - overview",
    "Demonstration setting-out reference",
    "Demonstration trial pit arrangement",
    "Demonstration sheet pile alignment",
    "Demonstration toe level record",
    "Demonstration corner connection",
    "Demonstration sample box 1 of 2",
    "Demonstration sample box 2 of 2",
    "Demonstration site progress plan - fictional geometry",
  ];
  const items = [
    "setting-out-trench",
    "setting-out-piles",
    "trial-pit",
    "pile-type",
    "toe-level",
    "corner-welding",
  ];
  const photos = [];
  for (let i = 0; i < 9; i++) {
    const bytes = await readFile(`tmp/pdfs/demo-image-${i + 1}.jpg`);
    const image = new Blob([bytes], { type: "image/jpeg" });
    photos.push({
      id: `demo-photo-${i + 1}`,
      inspectionId: r.id,
      itemId: i < 6 ? items[i] : "",
      caption: captions[i],
      order: i,
      name: `demo-${i + 1}.jpg`,
      original: image,
      compressed: image,
      width: 1200,
      height: 800,
      createdAt: r.createdAt,
      reportSection: i < 6 ? "site" : i < 8 ? "core" : "plan",
      reportGroup: i >= 6 && i < 8 ? "BH-DEMO-01" : "",
    });
  }
  await mkdir("output/pdf", { recursive: true });
  const pdf = await generatePDF(r, photos);
  await writeFile(
    "output/pdf/daily-site-report-demo.pdf",
    Buffer.from(await pdf.arrayBuffer()),
  );
  console.log("Created output/pdf/daily-site-report-demo.pdf");
} finally {
  await server.close();
}
