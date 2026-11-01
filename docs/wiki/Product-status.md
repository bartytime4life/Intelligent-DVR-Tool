# Product status and evidence

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) · [Screenshot atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) · [Verification](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation)

![Conceptual overview of local camera, recording, review and facility planning.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/overview.jpg)

**Software baseline verified November 1, 2026 (America/Chicago):** [`main` at `2566d845`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/2566d845fbbc7b9f54f98441009a604f2fa513ce), through [PR #71](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/71). Its final tested head `89bf2fca` passed 16 checks, including [Mac installation](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41346718983), [Linux/Windows validation](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41346718991), [browser regression](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41346718947) and [PC install kit](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41346719085). These are software checks, not physical-camera, biometric-accuracy or 100-camera qualification. [Mac source/setup evidence](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/mac-setup-2026-11-01/README.md).

| Recent merged work | Operator-visible change | Boundary |
| --- | --- | --- |
| [#63](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/63) | Presence observations continue across brief missed samples within `max_gap` | Re-analyze old traces before comparing rule behavior |
| [#64](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/64), [#65](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/65), [#71](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/71) | [Mac Install / Check / Start](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup), pinned CPU environment, verified models, preserved settings and same-port launch checks | Apple silicon source delivery; Mac worker has no address-space memory cap; physical-device acceptance remains separate |
| [#66](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/66) | [Train](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-training) guides a webcam session and optionally saves a tuned rule threshold | Session-specific tuning, not model retraining or independent accuracy measurement |
| [#67](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/67), [#68](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/68) | [Consent-based enrollment and possible matches](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Person-enrollment) in local-job Recognition | Local templates; human review; no verified identity/access decision or automatic Events/export handoff |
| [#70](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/70) | [Visual building placement, room sketching, wall edits, doorways, windows and stairs](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning) | Editable planning geometry and visibility estimates; no survey or building-code certification |

**Visual baseline:** the [new atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) shows the merged `2566d845` interface in a clean local browser session. Recognition, Events and Zones examples use generated flat-color video and a constant-output test model. The hero is conceptual ImageGen artwork; ten SVGs explain operator steps. [Capture and generation provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-provenance). The five PR #61 screenshots and October 27 generated tour remain preserved as dated collections. Wiki publication has its own history; repository mirrors alone do not publish it.

**Field-testing guidance (October 31, 2026):** use the [field-acceptance runbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance) with the [PC kit](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing) to verify real webcam, RTSP, recording, review and interruption behavior. CI, simulated feeds and generated recordings below are not field acceptance.

**Merged facility work (November 1, 2026; PR #70):** visual building placement,
indoor room sketching and shared-wall edits now include click-to-place, draggable
doorways and exterior windows. Doorways cut planned room walls and affect
estimated visibility. Windows can be resized on the map and adjusted in elevation;
glazing remains opaque to the estimator. Both survive floor copying/save/export/Undo.
Stairs can start on the map and be moved or rotated around the clicked landing.
Their destination can be above or below; floor cutouts remain separate.
See the [facility builder guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning).

October 30 [full review](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Review-2026-10-30): 61 verified defects across the
browser workspaces, facility editor and local service were fixed in PR #45, and
the Windows launchers' line endings in PR #46. Highlights: unreadable saved data
is backed up instead of overwritten, other tabs' saves are adopted, unsaved
facility edits prompt before leaving, facade-mounted cameras keep coverage,
Windows file-sharing and non-ASCII path failures are handled, the local service
handles requests concurrently, and on Linux it refuses other accounts on the same
computer. The interface font is now bundled. [Test evidence](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/review-fixes-2026-10-30/README.md).
Four follow-up pull requests merged on October 31 (#47–#50): local observation
stills and keyboard review with filters, CSV and bulk dismiss; zones drawn on a
camera still with an analyzer-ready rule export; pixel-density and coverage
planning estimates with an installer sheet; and specific failure causes, a
local diagnostic log, model reuse and hash-pinned installs. They are tested with
synthetic fixtures and CI only; see the [roadmap](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Roadmap#review-follow-up--october-30-2026)
for what each still needs before you rely on it.

[Recording coverage validation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-coverage) now checks alleged EOF
before publishing completion, rejects early/corrupt decoding, and distinguishes
unknown coverage from intentional limits. Legacy results remain unverified.
The PC runtime adds pinned PyAV for this bounded local validation pass.

Optional saved-recording [sharpening comparison](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Enhancement-comparison) reuses
the existing detector on paired original and mildly sharpened samples, with
separate review overlays, reports and labeled evaluation. Original-only rule
observations and unchanged source recordings are preserved. This non-learned
experimental control does not install Real-ESRGAN/SwinIR or qualify accuracy.

October 30 LAN-recorder follow-up: [one configured RTSP channel](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/LAN-recording)
now supports explicit sampled segment capture, bounded retention, reconnects,
restart recovery and the existing local analysis/review path. It is a one-camera
pilot with visible gaps/drops, not gapless recording or multi-camera qualification.
See its [separate evidence](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/lan-recorder-2026-10-30/README.md).

October 30 recording-workflow baseline: explicit browser-webcam clips, opt-in
same-computer recording import, pinned local model preparation, and printable
HTML/JSON/CSV reporting now join preview to human review. See the
[workflow and storage limits](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-workflow). Native local checks include
the actual pinned pretrained model on generated video; physical-camera accuracy,
continuous recording/live AI and 100-camera acceptance remain unqualified.

[PC test installation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing) provides a prebuilt kit, pinned isolated CPU dependencies,
readiness diagnostics and separate Install/Check/Start actions. CI installation
checks do not establish compatibility with a particular physical PC or camera.

The current Monitor starts empty and supports explicit browser webcam and bounded
local RTSP previews. Generated camera images/default events are removed. See
[connections, limits and device qualification](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Camera-sources).
Owner-approved direct HTTPS JPEG/MJPEG public webcams now use the same bounded
preview lifecycle, with attribution, retrieval age and snapshot labels. See the
[public-webcam boundary](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Public-webcams). External-provider availability and
capture freshness remain unqualified; no public source is enabled by default.

Local recording analysis now has a bounded same-origin CPU job service and
Recognition controls for explicit selection, progress, cancellation and automatic
source matching. See [setup, resource limits and recovery](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Local-analysis-service).
This is a recording workflow; live cameras, tracking, representative accuracy and
100-camera acceptance remain separate gates.

**Historical audited application baseline (October 27–28, 2026; not the current HEAD):**
[`82c862c68735720b8840461fc624e8dbe148a53a`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/82c862c68735720b8840461fc624e8dbe148a53a)
(the merged PR #11 revision). Later native-runtime and optional-CUDA work has
its own dated evidence in the verification index below.

[Home](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Home) · [Verification index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation) · [Roadmap](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Roadmap)

Intelligent DVR is a local camera-analysis and human-review prototype with an
editable facility planner and System resource-planning workspace. At least **100
simultaneously active cameras** is the owner's requirement. Sustained multi-camera ingest/recording, representative field/event accuracy,
cross-platform GPU deployment and actual 100-camera capacity remain unqualified.
The one-camera LAN recorder has separate controlled-source test evidence, not
physical-device acceptance. The optional CUDA route has bounded
owner-PC execution evidence in its dated record.

The [facility follow-up](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/facility-2026-10-28/README.md) records the
newer source/check scope separately from the historical baseline counts below.

The facility workspace starts blank on new installs and supports independent named
facilities, browser saves and portable JSON backups. Examples are opt-in; legacy
saves migrate without deleting the original. See [saved facilities](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Saved-facilities).

## Capability register

| Capability | Implemented baseline and source | Evidence and next gate |
| --- | --- | --- |
| Monitor/review | Real-source chooser, explicit webcam/local RTSP/approved public preview, queue, notes, history, zones and exports; [workspace source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/App.jsx) | Starts with no camera images; no automatic activation or live AI. [Current screenshot](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/monitor.jpg) and [feed guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Camera-sources). Physical-device compatibility and sustained operation remain unqualified. |
| Local video and receipts | Explicit video preview and receipt import; [offline CLI](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Edge-CLI) | Preview does not analyze. Imported events do not borrow sample images. |
| Recording recognition | Explicit local CPU jobs with recording/model/rule selection, progress/cancel and automatic source-matched review; optional CLI bundle import, paused sample overlays, class counts and Event handoff; [guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Local-analysis-service) | HTTP/native/browser job qualification in the [service record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/local-analysis-2026-10-29/README.md); earlier CPU/contract checks in the [recognition record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/recognition-2026-10-29/README.md). Scene counts are sampled detections, not learned scene interpretation, identity or tracking. Live deployment/accuracy remain unqualified. |
| Guided training | Webcam prompts, local analysis, threshold comparison and opt-in saved rule set; [guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-training) | Tunes existing detector rules for the session; no model retraining or held-out quality claim |
| Enrolled-person suggestions | Consent-gated local templates, baseline checks, explicit matching within a local job's person boxes, Confirm and Not this person; [guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Person-enrollment) | Templates stay in the local service; no face embeddings in the browser, automatic identity decisions or automatic Events/export handoff; accuracy and anti-spoofing remain unqualified |
| Facility planning | Map-first task selector, buildings/floors/rooms/labels, camera aim/coverage/rehearsal, local image diagnostics, experimental ground-plane calibration, export and Undo; [guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning) | Current [interface screenshot](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/facility.jpg), [pixel limits](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Image-diagnostics) and [calibration constraints](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Planar-calibration). Coverage and distances require real marker/optical qualification; simulated handoffs remain unverified. |
| Find and draft a site | Submitted Photon search, GPS/numeric origin, map-pin suggestion, rectangular/custom polygon area, selectable services, offline JSON file/paste; [service source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/facility-services.mjs) | [Six Chromium scenarios](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/facility-2026-10-27/README.md) use recorded geometry/mocked services. External availability, real GPS and novice completion remain unqualified. |
| OSM geometry | Facility v2, complete simple ways and supported outer/inner relations, raised bases and independent parts; [adapter](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/facility-starter.mjs) | Review and provenance survive apply/export. Courtyards/bases survive edits, rendering and coverage. Overlapping parts/envelopes and invalid/incomplete geometry remain excluded. [Limits](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-setup-reliability). |
| System controls | Planning arithmetic, applied browser limits, setup/policy exports and host-snapshot import; [control contract](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Resource-controls) | Browser controls and analyzer thread/frame caps have explicit scopes. RAM/VRAM/power/storage estimates are not OS quotas or activated hardware. |
| Offline detection | One local recording per run, default OpenCV CPU and explicit pinned YOLOX-S CUDA option, bounded rule receipts/traces with backend metadata; [analyzer](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/analyze.py) | [CUDA qualification](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/cuda-2026-10-28/README.md) covers the owner PC and bounded inputs. Field/event accuracy, sustained capacity and other GPU/OS combinations remain unqualified. No detector weights are bundled. |
| Evaluation | Annotation matching, precision/recall, timing distributions and reviewed false alerts; [guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-evaluation) | Synthetic fixtures verify calculation/evidence plumbing. Approved representative labels and held-out quality measurement remain required. |
| Scale preparation | Bounded fair scheduler, explicit 1–4 thread processors, optional Linux process supervision/local outcome journal and virtual-time 100/125-source tests; [guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/100-camera-plan) | [Thread trials](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/workers-2026-10-28/README.md), [process recovery](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/recovery-2026-10-28/README.md) and [parent-crash journal](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/journal-2026-10-28/README.md) use bounded offline inputs. The [batching record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/batching-2026-10-28/README.md) separates atomic commits/index changes from consumer acknowledgment timing. Durable dispatched outcomes are optional; the scale subsystem is not integrated with multi-camera live ingest/recording, per-camera rule state or distributed services; physical/sustained 100-camera operation remains unqualified. |
| Linux/Windows delivery | Pinned isolated install, prebuilt PC kit, integrity/readiness checks and foreground loopback service; [PC guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing) | Fresh extracted-kit installation, repeated install/settings preservation and HTTP startup are checked on Linux/Windows CI. Physical-device/target-PC and unattended service acceptance remain separate. |
| macOS source delivery | Repeatable Apple silicon Install/Check/Start, exact wheel hashes, pinned model preparation and update preservation; [setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup) | Mac CI checks installation/readiness, repeat installation and preservation. Local setup receipts remain separate from camera/accuracy qualification. No Mac worker address-space memory cap. |

## Read the status labels

- **Implemented** means source exists at the stated baseline.
- **Verified** requires a linked revision, environment and bounded check.
- **Historical** evidence keeps its original revision/date and limitations.
- **Estimated/simulated** results do not establish field accuracy or capacity.
- **Required/proposed** work has not passed its delivery and acceptance gates.
- **Reported local work** needs a matching source revision and receipt before it
  can be described as shipped.

The **historical October 27 audited baseline**, not the latest `main`, has 46 frontend + 4 packaging passes per platform,
66 Python passes on Linux, and 63 Python passes/3 skips on Windows. Six browser
scenarios ran separately. See the [exact record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/facility-2026-10-27/README.md).

Later [October 28 native execution](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/native-2026-10-28/README.md)
ran all 77 Python cases without skips, the actual pinned pretrained model, and
a 20-frame synthetic recording on an isolated cloud CPU. Its repaired package
pins, measured timings and failures are recorded separately. It does not measure
representative accuracy, owner-hardware performance or 100-camera operation.

## Reconciliation and operational gates

The later [offline evidence checklist](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-qualification) provides a local
source/log collector, listed-file integrity verification and a workload-plan
preflight. These preparation tools do not run inference or qualify any operating
capacity; their tests belong to their own revision, not the baseline counts above.

The [owner-PC continuation](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/host-2026-10-28/README.md) now records local AI execution, isolated GPU output agreement, short public-feed loads and fixed person-image metrics with source hashes and sanitized receipts. The local adapter/UI changes and private GPU harness are not included in this published implementation baseline. Production integration, representative video/event accuracy, sustained recording and 100-camera acceptance remain unqualified.

[Issue #6](https://github.com/bartytime4life/Intelligent-DVR-Tool/issues/6) retains
overlapping-part decomposition, installed/live-service delivery, real-site checks
and the novice study. The proposed 80% unaided completion and median under three
minutes with 5–8 novices have not been measured.

The [capacity target](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/capacity-target.json) still needs accepted codec,
resolution/source FPS, analysis cadence, delay, retention and hardware/worker
values. Qualification must distinguish recording, analytics and browser workloads.

The [current visual atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) distinguishes actual controlled-browser UI from illustrative diagrams and the archived fictional-camera tour. New screenshots are traceable to merged source `2566d845` and the documented clean local capture procedure; older CI captures retain their original GitHub Actions job. Neither collection qualifies a physical camera.

The hosted app and published wiki require their own revision/publication checks.
A repository merge or green CI run does not establish deployed-version parity.
No GitHub release was present at the October 28 audit.

No subscription, paid inference or paid trial is required by this implementation.
Local hardware/storage still consume resources. The repository currently assigns
no software license; third-party licenses remain separate. See
[project terms](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Home#checks-and-project-terms) and [security boundaries](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Security-boundary).

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/product-status.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
