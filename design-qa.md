# Guided facility builder — design QA

Reviewed 2026-10-27. Scope: desktop planning prototype against the selected first
concept, plus core browser interactions. This is not live-camera, tracking-model,
survey-accuracy, complete accessibility or production-capacity qualification.

The prior Monitor workspace report is preserved in
[monitor-design-qa.md](docs/qa/monitor-design-qa.md).

## Findings

No actionable P0/P1/P2 visual differences remain in the desktop scope after the
iterations below. The illustrative facility scene in the concept is intentionally
represented by editable geometry with no external imagery enabled. This follows
the owner's decision to use the first concept as layout guidance for a real
MapLibre/Three/Terra Draw editor. It is not a pixel-identical recreation of a
photorealistic scene and should not be described as one.

## Evidence and normalization

- Original source visual truth:
  `/home/bartytime/Documents/ChatGPT/Intelligent-DVR-Tool/generated_images/exec-6c8e031b-a41a-4e7c-b3c3-c9ce973b986b.png`.
  A same-dimension JPEG copy is [facility-concept.jpg](docs/qa/facility-concept.jpg).
- Browser implementation: `http://127.0.0.1:4176/#facility`.
- Final screenshot: [facility-desktop.jpg](docs/qa/facility-desktop.jpg).
- Full-view joint comparison: [facility-comparison.jpg](docs/qa/facility-comparison.jpg).
- Focused camera-form joint comparison:
  [facility-camera-detail.jpg](docs/qa/facility-camera-detail.jpg).
- CSS viewport: 1487 × 1058; observed devicePixelRatio 1.500000022.
  Source pixels: 1487 × 1058. Final screenshot pixels: 1487 × 1058.
  The browser driver already returns CSS-resolution pixels; no extra DPR scaling
  was applied. The combined full view is uniformly reduced to 2230 × 817 for
  convenient inspection; the focused regions retain their original pixel scale.
- State: dark theme, fictional North yard plan, Cameras (step 4), C-07 Dock entrance
  selected, 3D view, no unsaved changes, no external tiles, no connected cameras.
  Current sample bearing/range are 158°/55 m versus the concept's 145°/30 m; those
  editable values and the different shell positions are intentional sample data.
- The driver sometimes returned a 1487 × 769 cropped capture after reloading with
  a viewport override. Those captures were rejected. Resetting and reapplying the
  override restored the verified 1487 × 1058 capture above. Temporary viewport
  settings were reset after review.

Both full-view images were opened together, followed by the joint camera-form
crop. Findings were based on those visible comparisons, not code alone.

## Required fidelity surfaces

| Surface | Assessment |
| --- | --- |
| Fonts / typography | Concept appears to use a compact sans serif; no exact font file accompanied the image. Retained Inter/system sans family, 23 px semibold title, 13 px step names and smaller supporting copy. Labels and form text remain readable at 1:1; longer mount-height wording wraps intentionally. No clipped field values in the inspected state. |
| Spacing / layout | Preserved app rail, vertical numbered guide, center map, right camera editor, bottom status, teal selected state and amber primary action. Existing app rail is wider than the concept to preserve Monitor. Added inventory and form capabilities use bounded scrolling; Save and Back/Continue remain reachable. Advanced position controls collapse to keep the main camera inputs together. |
| Colors / tokens | Navy surfaces, muted blue-gray dividers/text, teal selections/coverage, amber confirmation/estimate copy match the selected direction. Geometry is neutral gray so coverage remains legible. This is a visual check, not a measured WCAG contrast audit. |
| Image / assets | The real editable map is a rendered model, not a decorative substitute for a supposed real satellite view. The retained generated loading-dock photo is sharp at the displayed size and explicitly labelled as a placement reference. It does not purport to show the selected camera. Phosphor icons follow the existing app; no fabricated logos or CSS illustrations replace image assets. |
| Copy / content | Six steps explain the task. “Estimated ground visibility,” excluded obstructions, fictional sample state and simulated handoffs are explicit. Camera settings describe ground-relative elevation, direction and downward tilt. No deployment, identity accuracy or active-camera claim appears. |

## Comparison history and fixes

1. **P2 — initial view interrupted during startup.** Earlier capture
   `/tmp/dvr-facility-desktop.png` showed excessive empty map space after an initial
   fit animation was interrupted. Initial fitting now uses zero duration. Later
   captures show all buildings and camera points immediately.
2. **P2 — camera form density.** Earlier capture
   `/tmp/dvr-facility-desktop-2.png` pushed important settings/actions too far down.
   Compact paired fields and the advanced-position disclosure reduce the form.
   Post-fix evidence: final camera-detail comparison; Save and navigation are visible.
3. **P2 — new room lost selection.** Closing a polygon could select the building
   beneath the final click. Suppressed map selection during the draw-finish frame.
   Browser retest showed the new room form selected immediately after closing it;
   rename/save/remove completed successfully.
4. **P2 — selected-camera label overlap / weak framing.** Matched pre-fix capture
   `/tmp/dvr-facility-matched.jpg` showed C-07's name over the Warehouse label and
   an unnecessarily distant model. Changed the camera label to below its marker,
   reduced fit margins, and raised the fit zoom ceiling. Post-fix evidence: final
   desktop and joint comparison show separated Warehouse/C-07 labels and a larger
   model with all three shells and five camera positions in frame. The plan remains
   less visually dense than the source because it contains editable shells rather
   than landscaping, trucks and textured roofs; that is an expected scope difference.

## Browser and build verification

- Building rectangle creation, rename/height/floor edits, deletion and polygon
  drawing; floor selection; room drawing/selection; label edits and removal.
- Camera numeric creation, selection, bearing preview, save, removal and undo.
  Unsaved-change guard prevented navigating away; discard/save worked. Reload
  retained a committed edit. Restored the sample after test edits.
- Label containing `<b>plain text</b>` remained literal text.
- Route drawing, undo, playback and scrubbing to 30 seconds. Blind spots and
  proposed C-02 → C-07 → C-11 transitions were visible. Session-only link/separate
  actions displayed the appropriate simulated review state.
- Paste JSON import accepted a 100-camera metadata inventory; search and the
  selected-camera dropdown reached camera 99. An invalid schema was rejected and
  the existing inventory remained unchanged. Restored the sample afterward.
- Final browser console inspection: zero captured warnings or errors.
- `npm run build`: passed. The facility chunk remains about 469 KB gzip and loads
  only on opening Facility; Vite reports its large-chunk advisory.
- 23 local Node checks passed with test isolation disabled for this restricted
  executor. Existing Sites packaging checks passed; hosting/worker helpers retained.
- GitHub Actions `Pilot checks`, run 19 on implementation commit
  `781862c24dc34f9bc46b4439b0cfcc93e3aa8caf`, passed, including clean `npm ci`, build,
  frontend/Sites tests and the repository's Python edge tests. Final follow-up
  commit check status is tracked on the follow-up pull request rather than assumed here.

## Residual gaps and follow-up

- At 390 × 844 CSS px the DOM had no horizontal overflow; the selected-camera
  dropdown changed the editor to C-11. The browser driver cropped the mobile
  screenshot, so a full mobile visual pass remains unverified.
- Automated file-picker selection was blocked by the extension's file-URL access
  setting. No permission was changed. The same importer was exercised using the
  native Paste JSON dialog; normal user file selection still needs manual checking.
- No complete keyboard/screen-reader/contrast audit. Room and custom route drawing
  currently require pointer input; numeric camera/building placement and JSON
  import exist. Add a keyboard geometry editor before claiming full accessibility.
- General DOM map labels are bounded but do not have collision avoidance for every
  arbitrary imported plan. Crowded-site labeling deserves a separate density pass.
- Export download completion and the optional external OSM tile service were not
  browser-qualified in this pass. They do not gate the default offline-grid editor.
- P3: align camera-photo/secondary field spacing further after the location-import
  workflow is evaluated. Keep the generated-reference label visible with the photo.

## Implementation checklist

- [x] Correct the startup fit, compact the camera form and preserve room selection.
- [x] Correct selected-camera label placement and compare the final rendered state.
- [x] Verify editing, persistence, guards, import failure and rehearsal behavior.
- [x] Save desktop source/rendered/joint evidence and document verification limits.
- [x] Record the next location/AOI workflow in `docs/easy-facility-setup.md` and issue #6.

final result: passed

## Location shortcut follow-up

Added an optional one-shot location suggestion to the existing Locate site form.
Browser inspection at 2004 × 1036 CSS px confirmed the new button, disclosure,
manual fields and Save site remain readable and reachable; captured at
`/tmp/dvr-location-form.jpg`. No new console warnings/errors were captured.
Build and the same 23 checks passed. Real location permission/success/denial and
timeout callbacks were not exercised in the user's browser, to avoid requesting
their precise location during QA. Cancellation and stale-result guards were
reviewed in source. This check does not qualify the automatic building importer.

## Open-map dimensions and shapes follow-up

The Buildings state now adds common shapes and dimension summaries; Locate site
adds bounded area selection and reviewed OSM simple-way drafts. Source truth for
the shared composition remains `docs/qa/facility-concept.jpg` (1487 × 1058).
Final Buildings evidence: `docs/qa/starter-shapes.jpg` (1487 × 1058), at the same
1487 × 1058 CSS viewport, DPR 1, with no density scaling. The original source
shows the Cameras step; this is a deliberate new Buildings state, so content and
photorealistic imagery differences are not treated as pixel-fidelity defects.

Joint full-view comparison was opened at `/tmp/dvr-starter-comparison.jpg`, with
an original-scale right-panel comparison at `/tmp/dvr-starter-focus.jpg`. These
show retained typography, dark navy surfaces, teal selection, amber actions,
numbered guide and editor/map proportions. Actual editable shells remain the
expected alternative to the concept's illustrative photograph. Long dimension
copy wraps inside the property panel; actions remain reachable in its scroll
region. New copy distinguishes measured footprint estimates, enclosing spans,
code guidance, source tags and placeholders. No new decorative assets replace
source imagery or icons. There is no separate visual source for the added forms.

Findings and fixes during this iteration:
- P1: attribution methods assumed an API the renderer does not provide, causing
  a blank editor. Replaced with supported attribution control replacement; source
  import and removal were retested successfully with visible OSM credit.
- P1: switching camera → Buildings briefly rendered the previous camera draft as
  a footprint. Gates now require matching selected/draft IDs. Retested navigation,
  shape addition and building property editing without exceptions.
- P2: expanded shape creation pushed selected properties down. Picker now starts
  collapsed and collapses after successful addition. Final screenshot shows the
  compact editor with dimensions and Save reachable. Axis-aligned resize fields
  are labelled east-west/north-south spans to distinguish them from oriented size.

Browser verification used a deliberately synthetic offline OSM-shaped extract:
reviewed dimensions, unchecked it (Apply disabled), rechecked, applied additively,
and observed the sourced shell plus attribution. A rotated L wing was added.
A feet-input U wing at 120 × 160 ft with 20 ft wings produced 8,000 ft² of polygon
area, not its full enclosing rectangle. Building translation/save and restoration
of sample data were exercised. No real device-location permission was requested.
Initial public Overpass attempts returned 502/timeouts, so live retrieval is not
qualified by the successful offline fixture; that external-service gap is retained
explicitly. Local build and all 30 frontend/Sites checks passed. No fresh application
console warnings/errors appeared in the post-fix drawing check. Mobile, full
accessibility, actual GPS and complex building geometry remain outside this pass.

Desktop drawing/offline-review visual result: passed. Live-service qualification
remains pending; do not describe automatic loading as verified in this environment.
