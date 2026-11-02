# Site Inspection

A working, local-first inspection PWA for fictional civil / geotechnical fieldwork. React, TypeScript, Vite, Tailwind CSS, shadcn-style Radix UI primitives, Lucide, Dexie / IndexedDB, React Hook Form / Zod, jsPDF and JSZip. No backend, account, cloud storage, analytics or telemetry. Optional, consent-based weather requests use MET Norway; all report processing and record storage remain local.

## Run locally

Requires Node.js 22.13+ in the 22.x line, or Node.js 24+ (recommended), and npm. Dependency installation initially requires internet access.

```powershell
npm ci
npm run dev
```

Open the localhost URL printed by Vite. Development serves the interface; use the **production preview** to install and verify offline functionality:

```powershell
npm run build
npm run preview -- --port 4173
```

Open http://127.0.0.1:4173. Keep the same origin and browser profile to access your stored records. `localhost`, `127.0.0.1`, different ports, different browser profiles and installed apps can have separate storage. Do not open `dist/index.html` directly.

## GitHub Pages and iPhone testing

The deployment workflow is `.github/workflows/pages.yml`. In the repository’s **Settings → Pages**, use **GitHub Actions** as the publishing source. Pushes to `main` install locked dependencies, run unit tests, build the static PWA and deploy `dist`. The workflow obtains the repository’s Pages base path automatically; asset URLs, installation scope and offline navigation all use that path. No API tokens or server credentials are required in the app or repository.

The phone testing URL is `https://tszyuen0511.github.io/site-inspection-pwa/`. Open it in Safari, then use **Share → Add to Home Screen**. Launch the installed app while online and check **Settings → Offline installation** before testing in airplane mode. Records and photos stay in that browser/app’s local storage and do not sync with your PC; use the local backup export/import to transfer them.

To reproduce the Pages build locally in PowerShell:

```powershell
$env:VITE_BASE_PATH='/site-inspection-pwa/'
npm run build
npm run preview -- --port 4173
```

Open `http://127.0.0.1:4173/site-inspection-pwa/`. Set the same environment variable when running `npm run test:e2e` to exercise the repository subfolder. Unset it for the normal root-path local build.

## Workflow

1. The first launch creates two fictional projects and six clearly labelled sample records. No actual project data or corporate assets are included.
2. Add or edit projects in **Settings**. Project changes affect future records; historical records retain their project snapshot. A project with inspection records cannot be deleted.
3. Choose **New inspection**, enter the project, element, date/time, location and inspector, then create the draft.
4. Expand each checklist item. Select Pass, Fail, N/A or Not Inspected; enter measured values, units, drawing references and remarks. Changes are saved to IndexedDB as they are made, in order. A save failure remains visible with a **Retry save** action, blocks navigation away from the draft, and prompts before closing the tab.
5. **Complete inspection** requires every item to have a status other than Not Inspected, and every failed item to have a nonblank remark. N/A is an explicit completed response. Measurement values never determine compliance automatically.
6. Add photographs using the camera or local file chooser. JPEG, PNG and WebP are accepted, up to 20 MB per image and 60 images per inspection. Convert HEIC/HEIF to JPEG first. Decode failures, oversized images (>80 megapixels) and storage errors are reported. Each batch is stored atomically after processing. Originals remain as selected; report copies are JPEG, at most 1600 pixels on the longer side, quality 0.8.
7. Add captions, associate images with checklist items, preview full-screen, move up/down, or delete with confirmation. P01/P02 numbering follows the current order; each photo also has a stable UUID. Reordering never changes its UUID or item association.
8. Completed records are read-only. Use **Reopen as revision …** to edit a new revision. This increments the revision counter on the same record; previously downloaded reports/backups provide the history. The app does not retain immutable prior revisions internally.
9. **Report** previews an A4 daily site report in the supplied reference's format: a centred project/title block, numbered sections 1-11, black bordered tables, a prepared-by footer and photo sheets. Use **Report details** to enter contract status, activities, staff / visitors, safety, weather, RFI, instructions, non-compliance, memos, work done and testing. Blank fields print as **Not recorded**, never an assumed Nil. Failed checklist observations also appear in the daily summary. The full engineering checklist, measurements, references and general remarks remain in an appendix. An Open PDF fallback is provided for mobile browsers. PDF generation is local and handles long wrapped rows and page breaks. Download PDF or Export ZIP. Exported means package generation and a browser download request succeeded; browser APIs cannot confirm the user saved the file. Draft package exports keep Draft status.
10. **Inspection records** supports searching, project/type/date/status filtering, opening, Repeat inspection (new draft with blank results and no photos), PDF preview, ZIP export and confirmed deletion.

In each photo card, choose **Report section**: Site photos, Core sample log or Site progress plan. Site and core sheets use a two-column, three-row grid (six photos for normal captions), preserving aspect ratio, numbering and checklist associations. Core photos can be grouped by element / borehole. Progress plans use a full-width image on a dedicated page. Long captions wrap; exceptionally long captions continue in full in labelled caption notes rather than being truncated. Photo numbers follow the inspection's overall photo order even when sections group them onto separate sheets. Only user-selected images are included; no drawing, original photograph, corporate logo or project content from the reference is bundled in the app.

Daily-report fields and photo section/group metadata persist with each inspection, survive backup restore, and are included in inspection-package JSON. Existing drafts and older backups remain compatible; their added fields are optional. Completed report details are read-only until the record is reopened as a new revision.

An illustrative output is at `output/pdf/daily-site-report-demo.pdf`. It contains fictional data and clearly labelled illustrations. Its source is generated by `scripts/create-demo-illustrations.py` (Pillow, using an available Arial font) and `scripts/create-report-demo.mjs`, which calls the real application PDF exporter. The supplied reference PDF remains outside the repository.

## ZIP inspection packages

Filenames include sanitised project reference, element, date and a collision-resistant UUID inspection ID:

```text
DEMO-2026-001_SP-001_2026-10-30_INSP-<uuid>/
  Inspection_Report.pdf
  Inspection_Data.json
  Photos/
    P01_<caption-or-original-name>_<photo-uuid>.jpg
```

Original PNG/WebP photos keep their corresponding extensions and MIME types. JSON preserves exact statuses, measurement strings (including precision), references, template snapshot/version, revision, created/updated timestamps and photo metadata / associations. Downloads use ordinary browser-supported Blob URLs; no arbitrary filesystem folders are created.

## Backup and restore

Use **Settings → Export local backup** for a complete backup ZIP, including original and report photo blobs, projects, templates and inspection snapshots. A report package is **not** a restore backup.

**Import backup** validates schema/version, unique IDs, project and checklist associations, photo presence, sizes and expanded archive size before a single atomic database transaction. The import limit is 250 MB compressed and expanded. Conflicting inspection IDs are rejected without partial changes. A fresh installation’s untouched fictional starter records may be replaced by a backup; user-edited records and records with photos are never silently overwritten. Export your current backup before migrating devices. Fonts and appearance settings are device preferences and are not included.

Browser storage can be evicted, manually cleared or lost with a browser profile. Private browsing may limit persistence. A persistent-storage request can reduce eviction where the browser grants it, but **regular backups are still necessary**. This app is not encrypted; anyone with access to the browser profile may access local records. Exports contain the original selected image and any embedded original metadata.

## Templates and engineering integrity

Initial templates are in `src/templates.json`. A template snapshot is stored in every inspection. Configure the local JSON in Settings and change its version for future inspections. IDs must be stable and unique. Sheet Pile includes the seven requested items. Bored Pile and Pipe Pile remain configurable, clearly marked demonstration placeholders, not approved engineering criteria.

An item may optionally include project criteria explicitly linked to documentation:

```json
"criteria": {
  "text": "Enter the actual project-approved criterion here.",
  "documentReference": "Approved document number, revision and clause"
}
```

No criteria are supplied by default. The user must verify project approval; the app only records and displays the entered criteria. It does not evaluate measurements or invent tolerances/code provisions. Completion is not formal review, approval, certification or a digital signature.

The PDF’s default font supports Latin characters. If other scripts are recorded, add a suitable licensed `.ttf` font in Settings. Use a font containing all required glyphs and inspect the preview. Without a custom font, unsupported characters cause a clear export error rather than silent corruption. JSON and backup exports always preserve Unicode. PDF text layout is intended for left-to-right engineering records; complex scripts need dedicated validation.

## Install and use offline

Initial installation normally requires **HTTPS or localhost**. A plain HTTP LAN IP on a phone is generally not a secure origin. Serve the built `dist/` on an HTTPS static host or a trusted local HTTPS server to test on a physical phone. No hosting integration is included or required.

- **iPhone Safari:** Share → Add to Home Screen → Add. Launch the home-screen app and allow its assets to cache.
- **Android Chrome:** browser menu → Install app / Add to Home screen, or Settings’ Install app button when available.
- **Windows Chrome / Edge:** use the address-bar install icon or browser menu → Install app.
- **macOS Safari:** in supported Safari versions, File → Add to Dock. **Chrome:** address-bar install icon / browser menu install option.

Wait for Settings to show **App assets cached for offline use**. The production service worker caches HTML, scripts (including PDF/ZIP dependencies), styles and icons. Disconnect and reload to verify. Creation, checklist edits, local file selection, IndexedDB persistence, PDF generation and ZIP downloads then operate without network access. Native camera capture and download handling vary by device/browser. On iOS use the browser’s PDF/file preview and Save to Files if a direct download is presented that way. Reconnect to fetch app updates; the app asks before applying a new cached version and flushes draft saves first.

## Tests

```powershell
npm test
npx playwright install chromium webkit
npm run build
npm run test:e2e
```

Vitest uses `fake-indexeddb` for domain validation, draft reloads, image bytes, clean repeat/deletion, backup import/export, template restoration, missing photos, input/file errors, simulated storage failures, PDF text/page generation and ZIP integrity. Playwright starts the production preview and exercises desktop Chromium, mobile Chromium and mobile WebKit layouts, drafting/resume, validation, photos, downloads, theme persistence and **offline reload / creation / photo storage / PDF rendering / ZIP**. It verifies original image bytes inside exported packages, backup restoration in a fresh browser profile, and recovery from a simulated storage-full error. Screenshots and failure traces go to `test-results/`.

Photographs are persisted in IndexedDB as byte arrays plus MIME metadata, then materialised as Blobs for viewing and export. This avoids differences in browser File/Blob persistence and preserves the exact selected original bytes.

Mobile Chromium and WebKit emulation are not physical iOS Safari or Android camera testing. Native install prompts, iOS Add to Home Screen, actual camera permissions and OS download/share behaviour need manual device verification. Basic photo annotation is optional and not implemented. Reports use in-memory export and are intended for demonstration-sized packages; very large originals can exceed a mobile browser’s available memory. The in-app PDF preview uses locally bundled PDF.js and a cached worker; pages render as you scroll.

## Source layout

The current interface follows the supplied **navy ink and safety orange** form reference. `src/inspection.css` applies the requested colours, typography, 48 px inputs and status buttons, 72 px photo tiles, and 52 px PDF actions over the shared layout styles in `src/cobalt.css`. Selected Pass / Fail / N/A controls all use the same dark fill and expose their selected state to assistive technology. At 390 px the form scrolls in one column with a menu and pinned Preview / Save as PDF bar. At 1280 px it uses a 240 px section sidebar, four project fields in one row, checklist rows, and a 340 px panel showing the actual first PDF page. Other workspace screens retain mobile bottom navigation.

Photographs can be captured or uploaded in batches directly within an item, then selected and captioned without leaving the form. Choose photos opens the library/file picker; Add uses the rear-camera input on phones. Manage photos opens the full log for reordering, deletion and report grouping. Originals, compression, the 60-photo limit and report association rules are preserved. Inline photo edits share the inspection save queue: export and navigation wait for uploads and captions, and failed writes expose Retry save. Add inspection item changes only the current record’s template snapshot. Blank fields use bracketed placeholders; existing fictional demonstration records remain explicitly labelled. See `docs/INSPECTION_DESIGN_AUDIT.md` for the current audit. The previous Cobalt audit is retained as historical documentation.

```text
src/App.tsx                   Navigation, autosave queue, PWA lifecycle
src/domain.ts                 Types, Zod schemas and inspection rules
src/db.ts                     Dexie schema, seed data and record operations
src/templates.json            Initial versioned checklist definitions
src/photos.ts                 Local image validation and compression
src/export.ts                 A4 PDF and inspection ZIP generation
src/report-pdf.ts             Reference-style daily report and photo page layout
src/daily-report.ts            Optional daily report schemas and defaults
src/backup.ts                 Atomic backup export/import
src/components/               Reusable form, checklist, photos, reports and UI
src/styles.css                Tailwind entry and theme imports
src/cobalt.css                Shared workspace component and layout foundation
src/inspection.css            Current navy/orange tokens and responsive form layouts
src/components/ItemPhotos.tsx Inline camera, uploads, thumbnails and captions
src/components/ReportDock.tsx Live first-page PDF preview for desktop
e2e/                          Production browser workflow tests
scripts/generate-icons.mjs    Reproducible local PWA icon generator
```

The shadcn-style Button and Dialog primitives are in `src/components/ui.tsx`, using Radix, CVA, clsx and tailwind-merge. No remotely loaded fonts or images are used. Production is a static `dist/` directory. The Vite dev/preview server only serves application files; inspection data stays in the client’s IndexedDB.

Technical references: [Vite PWA update behaviour](https://vite-pwa-org.netlify.app/guide/auto-update), [Dexie transactions](<https://dexie.org/docs/Dexie/Dexie.transaction()>), [browser persistent-storage requests](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).

## Phase 1: profiles, defaults and clean repeat

In Settings, save your inspector name, role, company and default project once per browser profile. Projects also support default location and drawing reference. New inspections prefill these values and store their own snapshots; changing settings never rewrites historical inspection details. Inspector company appears in the PDF checklist appendix when recorded. Legacy records do not acquire company details automatically.

Use Repeat inspection on a record to create a new draft with the same project, element, location, drawing and exact checklist snapshot. Results, measurements, remarks, photos and all daily-report content are cleared. Date/time and UUID are new. The current inspector profile is used when configured; otherwise the source inspector details are retained. Signatures and GPS/weather retrieval are not Phase 1 features.

Phase 1 backups use version 2 and include inspector/default-project settings and project defaults. Version 1 backups remain importable. Restore only fills workspace settings when none exist on this device; it never overwrites an existing profile/default choice. Inspection/project/template conflict checks remain atomic. Keep using the same deployed origin and browser profile to access existing records. No database reset or destructive migration is performed.

## Phase 2: GPS, weather snapshots and WSP logo

The inspection checklist includes Location & weather. Get location requests browser permission once per action, storing latitude/longitude, device accuracy and acquisition time without replacing manual location/chainage. Permission denial, unavailable positioning and timeout do not block inspections. Reacquiring or clearing GPS clears the previous forecast.

After checking the disclosure checkbox, Fetch weather forecast sends coordinates truncated to four decimal places to api.met.no. MET Norway also receives the user's IP address and browser Origin. No inspection details, names or photos are transmitted. The low-volume simple CORS integration follows https://api.met.no/doc/TermsOfService and https://api.met.no/doc/locationforecast/HowTO (reviewed 2026-11-02); data is attributed under CC BY 4.0. A high-volume deployment would require a caching proxy. No API keys or company servers are required.

This is model forecast data, not measured local weather. The saved snapshot includes forecast coordinates, valid time, provider issue time, original retrieval time, Celsius temperature, wind speed in m/s, optional relative humidity and the provider's next-hour condition summary. Live retrieval is limited to today's inspections; historical inspections support manual observations. Stored snapshots are always labelled and never refreshed on opening an inspection or report. Compare their valid time against the inspection date/time. The manual weather field is the same field used in Daily report details and stays independent of forecasts.

Location-specific caches are bounded to ten entries and obey exposed Expires headers (five-minute fallback). Matching unexpired snapshots can be reused offline while retaining their original retrieval timestamps. Cache failure does not prevent recording a successful snapshot. Requests timeout after 12 seconds; errors preserve the prior inspection snapshot. Core record, photo, report and backup workflows remain offline.

Backup version 3 and inspection-package schema version 2 preserve GPS/weather fields. Backup versions 1 and 2 remain readable; existing records are not backfilled. Repeat uses an explicit allowlist and copies neither GPS nor forecast nor manual weather. Completed records remain read-only. PDF generation requires no weather network requests.

The unmodified official red WSP PNG is embedded locally in src/brand-assets.ts for the interface and PDF. Source: https://www.wsp.com/en-nz/legal/wsp-logo and https://www.wsp.com/-/media/who-we-are/global/image/wsp-logo/img-png-wsp-red.png . The logo remains WSP's trademark; colour, components and aspect ratio are preserved.

The GPS snapshot also preserves the raw device timestamp and interpreted units. The observed WebKit microsecond timestamp anomaly is normalized only if division by 1000 places the sample within five minutes of the current clock; invalid values are rejected rather than replaced with the current time. Normalized samples are explicitly labelled.
