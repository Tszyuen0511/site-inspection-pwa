# Navy ink and safety orange inspection form

31 October 2026. Implemented manually from the supplied phone reference and desktop dimensions. The React, TypeScript, Tailwind, Radix/shadcn-style primitives, Dexie storage and offline PWA architecture are retained.

## Design review

| Area         | Implementation                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Palette      | Navy `#17212B`, page `#F4F5F6`, white cards with `#D5DAE0` borders and 12 px corners; controls `#AEB6BF`; helpers `#5B6672`                                    |
| Accent       | `#C2410C` for inline photo actions and filled PDF/photo buttons                                                                                                |
| Typography   | Local system-ui sans serif, 16 px inputs/body, 14 px bold field labels, 13 px uppercase section headings                                                       |
| Status       | Three equal 48 px controls; every selected status has the same dark fill, label, and `aria-pressed` state                                                      |
| Phone        | One column; project/location full width, date/inspector paired; 72 px thumbnail strip; camera Add tile; pinned 52 px Preview/PDF buttons and safe-area padding |
| Desktop      | 240 px sidebar, project fields in one row, checklist rows, 340 px live PDF panel at 1280 px                                                                    |
| Dense fields | Measurements and document references remain in each item’s expandable details; no engineering fields removed                                                   |
| Photos       | Inline camera/library inputs, multiple-file upload, selection, caption, full-screen viewer; full log retains grouping/reorder/delete                           |
| Navigation   | Phone inspection menu; desktop section sidebar; workspace screens retain their existing navigation                                                             |
| Feedback     | Draft saved / saving / save failed subtitle; offline text and icon; associated field errors; retry banner for failed checklist and inline photo writes         |
| PDF          | Actual locally generated A4 report, not a static mockup; first-page dock and full report preview; original reference-style report layout preserved             |

No decorative gradients, glass effects, remote fonts or remote photo services were introduced. Existing fictional starter records remain labelled; new form placeholders use bracketed labels. Custom items extend the current inspection snapshot without changing its stored project template. Dark mode remains available, with adjusted neutral colours and readable orange photo outlines.

## Verification scope

Final result: production build passed, 22 unit tests passed, and all 18 browser tests passed across desktop Chromium, mobile Chromium and mobile WebKit. The audited A/AA states reported no axe-core violations. A fresh development-server launch was also verified after clearing a stale hot-reload session.

- TypeScript/Vite/service-worker production build and domain/storage/export unit checks.
- Browser workflows in desktop Chromium, mobile Chromium and iPhone-sized WebKit: draft editing/resume, required remarks, photo log, report details, PDF/ZIP, backup and storage failure recovery.
- New inline-photo workflow: batch upload, native camera input wiring, caption selection/persistence, immediate PDF export, failed caption write and retry, custom items, reload and offline PDF/ZIP generation.
- Layout checks at 390 px and 1280 px, 240/340 px desktop panel dimensions, 48 px status controls, 320 px overflow checks and horizontal photo strips.
- axe-core A/AA checks on light/dark overview/checklist, failed validation, offline checklist, records, new-inspection errors, inline photographs, photo dialog, PDF preview, daily report form and settings.
- Keyboard skip link and dialog focus/Escape behavior.

Run `npm run build`, `npm test`, and `npm run test:e2e`. For the visual/accessibility checks alone, run `npm run test:e2e -- --grep "navy and orange"`; for inline photos, use `--grep "inline batch"`.

Browser emulation checks the camera input and file chooser, not physical camera operation, OS photo permissions or iPhone download/share behavior. Screen-reader and physical-device testing remain manual. The provided input border colour is preserved; focused controls use a strong visible outline. Automated accessibility checks are limited to the screens and states exercised, and do not constitute accessibility certification.

The phone and desktop images under `output/design/navy-*.png` use an isolated screenshot fixture with bracketed field values, the supplied Excavation / Rebar placement example labels and neutral photo placeholders. The application’s stored templates and seed records are unchanged by that fixture. Desktop captions span the row, and the camera/upload tile remains outside the scrolling thumbnail strip.
