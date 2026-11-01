# Intelligent DVR design QA

> **Historical design record:** this sample-wall comparison predates the explicit real-source interface. Use the [current visual handbook](../how-to.md), [atlas](../visual-atlas.md) and [status](../product-status.md) for the present behavior. Original findings below retain their original scope.

final result: passed

## Comparison target and browser evidence

- Source visual truth: `docs/design/watchfloor-reference.webp` (1487 × 1058 px), the owner's selected option 1 refined for additional polish.
- Browser-rendered implementation: `http://terminal.local:4173/`, Monitor, clean initial sample state, dark theme; desktop iframe 1487 × 1058 CSS px.
- Full-view comparison: the source and live rendered implementation were placed side by side in one comparison page and captured together in the cloud browser. Both were normalized to 650 × 463 display regions, with the implementation rendered at the source's original CSS viewport before scaling.
- Focused comparison: source and rendered review queue were displayed together at 1:1 scale in 600 × 600 crops of the same desktop state.
- Implementation screenshots: captured inline in the cloud-browser tool results for the side-by-side comparison, focused queue, full workspace, and 390 × 844 CSS-pixel responsive view. Screenshot bytes were not exported to a repository file; the images remain in the conversation's browser evidence. The temporary comparison harness is `qa-local/compare.html` in the working checkout and is deliberately not shipped.
- Additional native browser viewport: 1363 × 936 CSS px, full workspace visible with no page overflow.
- Mobile: 390 × 844 CSS px iframe (375 px content width after scrollbar); document scrollWidth equals clientWidth. Monitor stacks cameras vertically; source strip scrolls within its own region. Zone controls stack below the scene without horizontal overflow.

## Findings and comparison history

1. Initial full and focused comparison found P2 density drift in the right review queue: text and evidence previews were too small, and the queue was narrower than the reference. Fixed desktop queue width to 450 px, evidence preview to 125 px, and increased event and source typography. A fresh combined browser capture shows the corrected queue proportions and readable actions.
2. P2 sample overlays did not align with the newly generated camera scenes. Corrected source-normalized sample boxes and projected geometry through the same cover/crop transform as the image. Removed artificial box drift over static imagery. Rechecked full-view and mobile scenes.
3. P1 interaction failure: simulated event generation used secure-context-only randomUUID on the HTTP preview. Replaced the sample-only identifier path and generated the ID before the React state updater. Retested save rule → try simulated event → queue count increase, followed by reset.
4. P2 desktop height regression after enlarging queue content: footer could move below a 936 px viewport. Fixed desktop monitor height to available viewport space and gave only the queue its own overflow, retaining normal page scrolling on phones. Rechecked full-view desktop with the footer in view.
5. Post-fix comparison: no actionable P0/P1/P2 visual or interaction findings remain in the tested core flows.

## Required fidelity surfaces

- **Fonts and typography:** Inter with Arial/system fallback, clean sans hierarchy, compact but readable UI text. Larger event typography corrects initial drift. Display/header weight and tracking preserve the selected design. Small metadata is intentionally subordinate.
- **Spacing and layout:** preserved left rail, central 2×2 camera wall, right queue and five-source strip. Consistent panel gaps, restrained radii, thin dividers and unobstructed actions. Mobile stacks without document overflow.
- **Colors and tokens:** graphite/navy surfaces, teal selection/focus, amber review actions, muted blue-gray supporting text. No decorative gradients or extra brand panels.
- **Images and assets:** five individually generated synthetic scenes, consistent elevated camera perspective, sharp WebP assets. Evidence crops are enlarged for inspection. Assets differ from the mock's exact fictional workplace as expected; they preserve scene purpose and art direction. Actual camera imagery is never implied. Phosphor library icons replace no custom visual assets. Canvas is used only for functional zone/detection geometry.
- **Copy and content:** explicit sample, no-camera and human-review labels. Scores are model outputs, not risk probabilities. Imported observations have no borrowed sample imagery and retain source/model hashes and partial/completed receipt state. Simulated timeline limitations are disclosed.

## Primary interactions verified in browser

- Camera source selection, including camera 5 replacing the selected wall slot; expanded camera dialog and modal close.
- Review observation → note → confirm; queue decrement and confirmed history.
- Dismiss observation and record dismissal feedback.
- Event status filter, search and no-results state.
- Zone editor, keyboard numeric fields, rule name/duration save and persistence after reload.
- Simulated event action and queue update after the HTTP-preview fix.
- Reset sample workspace confirmation and restored initial data.
- Mobile Zones navigation, layout and visible form control widths.
- Asset loading: all five scenes render successfully.

Browser console checks identified and resolved the sample-ID exception. The fresh final tab was checked after restart; extension-generated metadata messages are environmental and are not application errors.

## Validation and limits

- 10 Node tests pass, including receipt/schema/provenance, invalid browser-state recovery, review isolation, zone bounds and retained Sites Worker packaging.
- 8 Python tests pass with OpenCV 4.14.0, NumPy 2.5.4 and ONNX 1.23.2, including a temporary synthetic ONNX + AVI pipeline and no-overwrite output check.
- Production build passes with Vite 6.4.5. npm audit reports zero findings after dependency updates.
- Actual trained-model recognition, camera protocols, real-time performance, five-camera hardware load and deployment remain unqualified.
- Local video/file chooser transfer and receipt upload were not exercised end-to-end in the cloud browser. Receipt parsing is unit-tested and recording analysis is integration-tested independently. Native browser codec support varies.

## Follow-up polish

P3: add optional density controls for very large monitoring displays after pilot feedback. No remaining P3 item blocks the selected core layout.

## Implementation checklist

- [x] Preserve selected composition and polish typography and event hierarchy.
- [x] Use generated camera assets and library icons.
- [x] Verify core review, rule, camera and reset flows in browser.
- [x] Compare source and implementation together, fix issues, capture again.
- [x] Run domain, packaging, edge integration and build checks.
- [ ] Qualify real model and camera hardware in a separately scoped pilot.

CI follow-up: the initial packaging check ran before build output existed on a clean runner. Domain and packaging test commands are now separate; CI builds before the packaging check.
