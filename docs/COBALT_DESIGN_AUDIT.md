# Cobalt visual and accessibility audit

Historical review: the later navy/orange form reference supersedes this visual system. See [the current inspection audit](INSPECTION_DESIGN_AUDIT.md). The values and test counts below describe the earlier Cobalt implementation.

Date: 31 October 2026

Hallmark was not installed in the available skills. The Cobalt direction was implemented manually from the requested Modern Minimal brief. This is a manual design review with automated accessibility checks, not an official Hallmark skill audit.

## Visual system

| Area           | Implementation                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Primary accent | Cobalt `#2456DC` with white foreground; pale blue selection surfaces                              |
| Light surfaces | White cards, `#F5F7FA` workspace, neutral grey borders                                            |
| Dark surfaces  | `#101827` workspace, `#192436` cards, pale blue primary actions                                   |
| Typography     | Local system fonts; 14–16 px working text and labels; 16 px mobile inputs                         |
| Targets        | 64 px-high Pass / Fail / N/A buttons, at least 44 px icon and navigation controls                 |
| Forms          | One column on phones; aligned two-column groups where desktop width permits                       |
| Navigation     | Desktop sidebar and mobile bottom navigation, with current-page states                            |
| Feedback       | Text and icons for save state, inline associated validation errors, labelled online/offline state |
| Motion         | Only functional loading indicators; reduced-motion preference respected                           |

The promotional banner, illustration, gradients, glass effects and redundant offline dashboard card were removed. The dashboard retains the four requested record counts, recent records, draft resume and backup access. Existing PDF report layout, data models, IndexedDB storage, backup semantics and service-worker caching are preserved.

Failed items use a failure icon and label rather than a green completed tick. Missing failed-item remarks remain visible. Selected checklist statuses expose `aria-pressed`; navigation exposes `aria-current`; progress and save/connection status have accessible semantics. Form errors expose `aria-invalid` and `aria-describedby`. The photo viewer now uses the existing Radix dialog primitive for focus containment and Escape dismissal. A keyboard skip link leads to the main content.

## Verification

- Production TypeScript/Vite/PWA build passes.
- 22 domain, storage and export tests pass.
- 15 Playwright tests pass across desktop Chromium, mobile Chromium and mobile WebKit, including the design audit and existing workflows.
- axe-core detects no WCAG A/AA violations in the audited screens and states: light/dark overview, checklist, failed-item validation, offline checklist, records, invalid new-inspection form, photos, photo dialog, PDF preview, daily report form and settings.
- Phone checks also cover 320 px settings and checklist layouts, viewport overflow and Pass / Fail / N/A target sizes.
- Keyboard checks cover the skip link and photo dialog focus containment / Escape dismissal. WebKit skip-link activation uses explicit focus because native link traversal depends on the device's Full Keyboard Access preference.
- Functional regression coverage includes creating/resuming drafts, photo persistence, required failed-item remarks, report details, PDF/ZIP generation offline, exact exported image bytes, backup restoration and recovery from a storage-full error.

Automated checks and browser emulation do not replace physical-device, screen-reader or usability testing. No full accessibility certification is implied.

## Reproduce

```powershell
npm ci
npx playwright install chromium webkit
npm run build
npm test
npm run test:e2e
```

Run only the visual/accessibility checks:

```powershell
npm run test:e2e -- --grep "manual Cobalt"
```

Tokens and component layouts are maintained in `src/cobalt.css`; Tailwind entry points remain in `src/styles.css`. Audit checks live in `e2e/design-audit.spec.ts`. Reviewed screenshots are saved under `output/design/`.
