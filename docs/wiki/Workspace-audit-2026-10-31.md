# Intelligent DVR: whole-workspace UI and navigation audit

> **Dated record.** Findings and evidence below retain their stated revision and date. Use the [visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook), [current capability register](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) and [guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) for today’s operator path.

[Current visual atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas)

![Current tested Monitor interface after the source-selection simplification.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/monitor-desktop.jpg)

*This screenshot shows an empty/opt-in browser interface, not live video or a novice-user study.*

**Audit date:** October 31, 2026 (Central)  
**Baseline:** `d1bf3e96e49be6130ca851de4c640f5eb8fbf19b` (`main`)  
**Scope:** the seven primary workspaces, their principal navigation/interaction code, responsive CSS, existing browser regression suite, and read-only GitHub Actions results.

This is a **source-backed and automated browser audit**, not proof that the complete application has been accepted by human operators on Windows/Linux cameras. Do not interpret browser fixture tests as field-device, detector-accuracy, lens-calibration, retention, or 100-camera-capacity acceptance.

## Audit journey: seven workspaces

| Step | Workspace | What to verify | Current source-level assessment |
| --- | --- | --- | --- |
| 1 | **Monitor** | Empty wall; source type dialog; webcam/DVR/public choice; connect/cancel; no automatic camera activation; return-focus | Explicit lifecycle and modal handling exist; automated source transport and browser camera suites cover controlled fixtures. Physical-device reliability is unqualified. |
| 2 | **Recognition** | Local analyzer/recorder entry; imported bundle + matching source; sample player and results; Events handoff; source deep-link | Source matching and review contracts are tested; deferred Events link had a stale effect dependency (fixed in this PR). Panel density and novice finding of primary CTA still need an observed usability study. |
| 3 | **Facility** | Map-first toolbar; 2D/3D/floors; locate/shape/camera/coverage/zones; unsaved actions; calibration | Several browser geometry/studio tests exist. Unmeasured outdoor footprints, optical assumptions, manual calibration and novice acceptance remain unqualified. |
| 4 | **Events** | Search, status/source/recording filters, keyboard decisions, notes, bulk dismiss/Undo, review export | Existing browser tests cover keyboard decisions, review continuity, CSV, filters and Undo; no independent field-audit authentication. |
| 5 | **Zones** | Camera selector; edit a region on a real still or normalized grid; rule save/export; leave/switch behavior | **Confirmed loss-of-draft path:** leave screen or change plan before Save silently discarded edits. Fix guarded in this PR. Facility zones and image rules are separate concepts, not automatically deployed live. |
| 6 | **System** | Resource planning, validation, imported host snapshot, applied browser limits vs separately exported policy | **Confirmed loss-of-draft path:** changing workspace before Apply discarded machine-planning edits. Fix guarded in this PR. Plans are not OS resource quotas or hardware benchmarks. |
| 7 | **Settings** | Shortcut links to Monitor/System/Recognition; evidence import; local video preview; reset confirmation | Explicit routes and reset dialogs exist; this audit adds whole-navigation browser checks. This page is not a running camera control panel. |

## Confirmed actionable findings and changes

### F1 — P1: Zones draft can be silently lost

**Source:** `src/App.jsx` rule form, `zone()`, `setTab()`, and the draft reset on `[tab, selected]`. The existing leave guard protected only Facility. Thus selecting another sidebar route or switching the camera plan during an unsaved rule edit could discard the draft without warning.

**Fix:** protect Zones with an explicit confirm on navigation, Back/Forward and camera-plan selection. Mark the draft visibly unsaved; block reload without warning. The saved rule remains authoritative until **Save review rule**.

**Acceptance:** cancel keeps the exact text and route; accept discards only the draft; the prior saved rule remains intact.

### F2 — P1: System planning draft can be silently lost

**Source:** `src/SystemSetup.jsx` holds `draft` and `dirty` locally; `src/App.jsx` previously had no System leave guard. The component unmounts when the workspace changes.

**Fix:** report `dirty` to the parent, confirm navigation/reload when unapplied, preserve the draft on cancel and keep existing explicit Apply behavior. No host tuning, disk modification or automatic recorder settings.

### F3 — P2: An Events deep link is not revisited when the matching results arrive

**Source:** `src/RecognitionReview.jsx` resolved `evidence` in a `useEffect` with `[evidence]` only. An Events observation could open Recognition *before* its matching review bundle existed. Loading that bundle did not trigger the link lookup again.

**Fix:** resolve on changes to `evidence`, the parsed `run` and exact-source `source`; distinguish matched result metadata from a fingerprint-verified recording. Never show source boxes without the matching bytes.

### F4 — P2: Whole-workspace browser/viewport regressions lacked a single shared journey

Existing Playwright suites richly exercise Facility, Recognition, Events and Zones in separate flows; the top-level Settings/System/Monitor navigation experience was comparatively under-tested.

**Improvement:** `tests/browser/workspace-audit.spec.mjs` visits all seven screens at **1440×1000** and **390×844**, asserts route/active nav/heading, measures document horizontal overflow, exercises browser history, the Monitor source-type dialog, Settings shortcuts, draft-cancel/accept flows and deferred recognition deep-link. Captures per-screen screenshots under `qa-local/workspace-audit/`; the GitHub Actions `facility-browser-evidence` artifact keeps them. The tests do not request camera devices or external providers.

## Design and deployment issues remaining

- **D1 — Onboarding and density (P2, usability risk):** Recognition exposes LAN recorder, local analysis, result import, timeline, scene counts and reports in one long journey. Prioritize a simple `Connect → Analyze → Review` progression with advanced settings behind disclosures; measure task completion and scroll burden before deciding layout changes.
- **D2 — Two different “zone” concepts (P2, discoverability risk):** Facility zones encode modeled space/coverage, whereas the global Zones workspace edits image-relative analyzer rules. Neither implies live inference or automatic deployment. Use explicit names and a clearly labeled review/export handoff, keeping mappings/credentials separate.
- **D3 — Mobile editing depth (P2, acceptance gap):** The responsive design stacks dense forms below the map; a 390-pixel smoke test can catch overflow, but does not verify touch-target accuracy, physical keyboard overlays, screen readers, mobile video behavior or field usability.
- **D4 — Camera/video evidence (P1 deployment gap):** One physical webcam and one approved RTSP source still need operator-led qualification for media codecs, permissions, disconnection, source hashes, recording gaps and human review. See the [field acceptance runbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance).
- **D5 — Capacity/accuracy (not a browser defect):** Simulated 100-stream exercises, DORI and projected ground-plane rulers do not establish 100 active live cameras, independent model accuracy, calibrated optics or site compliance.

## Reproduce the browser audit

From a trusted source checkout with Node 22 and `npm ci` (Playwright 1.56.1 installed for the browser job):

~~~bash
npx playwright install chromium
npx playwright test --config=playwright.facility.config.mjs workspace-audit.spec.mjs
~~~

For broader checks, run `npm test`, `npm run build`, `npm run test:sites`, the native Python suite, and all facility/analysis/feeds/recorder Playwright configurations as in `.github/workflows/`.

**Evidence location:** PR checks, browser job logs and `facility-browser-evidence` workflow artifact → `qa-local/workspace-audit`. A screenshot file is a UI-state observation only; it does not prove hidden behavior or machine compatibility. Results must be read from the specific commit's run, not inferred from earlier green builds.

## Further acceptance

1. Resolve any reproducible new browser failures before merging.
2. Inspect captured screenshots at both viewports; record any clipping, low-contrast controls or confusing task hierarchy as separate findings.
3. Have 5–8 first-time operators complete connection, import, navigation, editing and export tasks on a real PC, recording successful completions, errors, time and abandoned steps.
4. Validate an actual authorized camera and local recording path separately, and preserve the user's unchanged evidence and configuration.

## Follow-through after this audit

The confirmed draft/history/deferred-link defects were fixed and merged in [PR #59](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/59); the redundant Monitor empty-state controls and duplicate Facility top task bar were simplified in [PR #61](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/61). The latter's [controlled browser run](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41263964836) passed 92 scenarios across the app/Facility, analysis, camera feeds and recorder; all 14 reported CI checks passed. The [current visual atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) contains dated screenshots and the operator guides explain the resulting navigation. Real touch, novice and physical-camera acceptance remain separate tasks.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/workspace-ux-audit-2026-10-31.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
