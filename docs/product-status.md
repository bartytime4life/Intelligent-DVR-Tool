# Product status and evidence

Local recording analysis now has a bounded same-origin CPU job service and
Recognition controls for explicit selection, progress, cancellation and automatic
source matching. See [setup, resource limits and recovery](local-analysis-service.md).
This is a recording workflow; live cameras, tracking, representative accuracy and
100-camera acceptance remain separate gates.

Updated October 28, 2026. Audited application baseline:
[`82c862c68735720b8840461fc624e8dbe148a53a`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/82c862c68735720b8840461fc624e8dbe148a53a)
(the merged PR #11 revision). Later native-runtime and optional-CUDA work has
its own dated evidence in the verification index below.

[Home](../README.md) · [Verification index](verification/README.md) · [Roadmap](roadmap.md)

Intelligent DVR is a local camera-analysis and human-review prototype with an
editable facility planner and System resource-planning workspace. At least **100
simultaneously active cameras** is the owner's requirement. Live ingest/recording,
representative field/event accuracy, cross-platform GPU deployment and actual
100-camera capacity remain unqualified. The optional CUDA route has bounded
owner-PC execution evidence in its dated record.

The [facility follow-up](verification/facility-2026-10-28/README.md) records the
newer source/check scope separately from the historical baseline counts below.

## Capability register

| Capability | Implemented baseline and source | Evidence and next gate |
| --- | --- | --- |
| Monitor/review | Wall, queue, notes, history, zones and exports; [workspace source](../src/App.jsx) | Five generated scenes and playback are fixtures. No connected cameras. [Visual tour](visual-tour.md). |
| Local video and receipts | Explicit video preview and receipt import; [offline CLI](../edge/README.md) | Preview does not analyze. Imported events do not borrow sample images. |
| Recording recognition | Optional analyzer review bundle; Recognition workspace with source-hash matching, paused sample overlays, class counts and Event review handoff; [guide](recording-recognition.md) | Actual CPU runs and bounded contract checks in the [dated record](verification/recognition-2026-10-29/README.md). Scene counts are sampled detections, not learned scene interpretation, identity or tracking. Live deployment/accuracy remain unqualified. |
| Facility planning | Buildings/floors/rooms/labels, cameras, seven shapes, coverage estimates, route rehearsal, export and Undo; [guide](facility-builder.md) | Coverage is approximate geometry; handoffs are simulated. Survey/optical qualification remains open. |
| Find and draft a site | Submitted Photon search, GPS/numeric origin, map-pin suggestion, rectangular/custom polygon area, selectable services, offline JSON file/paste; [service source](../src/facility-services.mjs) | [Six Chromium scenarios](verification/facility-2026-10-27/README.md) use recorded geometry/mocked services. External availability, real GPS and novice completion remain unqualified. |
| OSM geometry | Facility v2, complete simple ways and supported outer/inner relations, raised bases and independent parts; [adapter](../src/facility-starter.mjs) | Review and provenance survive apply/export. Courtyards/bases survive edits, rendering and coverage. Overlapping parts/envelopes and invalid/incomplete geometry remain excluded. [Limits](facility-setup-reliability.md). |
| System controls | Planning arithmetic, applied browser limits, setup/policy exports and host-snapshot import; [control contract](resource-controls.md) | Browser controls and analyzer thread/frame caps have explicit scopes. RAM/VRAM/power/storage estimates are not OS quotas or activated hardware. |
| Offline detection | One local recording per run, default OpenCV CPU and explicit pinned YOLOX-S CUDA option, bounded rule receipts/traces with backend metadata; [analyzer](../edge/analyze.py) | [CUDA qualification](verification/cuda-2026-10-28/README.md) covers the owner PC and bounded inputs. Field/event accuracy, sustained capacity and other GPU/OS combinations remain unqualified. No detector weights are bundled. |
| Evaluation | Annotation matching, precision/recall, timing distributions and reviewed false alerts; [guide](offline-evaluation.md) | Synthetic fixtures verify calculation/evidence plumbing. Approved representative labels and held-out quality measurement remain required. |
| Scale preparation | Bounded fair scheduler, explicit 1–4 thread processors, optional Linux process supervision/local outcome journal and virtual-time 100/125-source tests; [guide](performance-100-cameras.md) | [Thread trials](verification/workers-2026-10-28/README.md), [process recovery](verification/recovery-2026-10-28/README.md) and [parent-crash journal](verification/journal-2026-10-28/README.md) use bounded offline inputs. The [batching record](verification/batching-2026-10-28/README.md) separates atomic commits/index changes from consumer acknowledgment timing. Durable dispatched outcomes are optional; no distributed service, live ingest, rule-state or recording integration; physical/sustained 100-camera operation remains unqualified. |
| Linux/Windows delivery | Launch helpers, build and cross-platform CI; [verification](verification/README.md) | Opt-in fixed-loopback geo middleware is implemented for native dev/preview; actual service installation, intended hardware and deployed-version acceptance remain separate. |

## Read the status labels

- **Implemented** means source exists at the stated baseline.
- **Verified** requires a linked revision, environment and bounded check.
- **Historical** evidence keeps its original revision/date and limitations.
- **Estimated/simulated** results do not establish field accuracy or capacity.
- **Required/proposed** work has not passed its delivery and acceptance gates.
- **Reported local work** needs a matching source revision and receipt before it
  can be described as shipped.

The latest audited baseline has 46 frontend + 4 packaging passes per platform,
66 Python passes on Linux, and 63 Python passes/3 skips on Windows. Six browser
scenarios ran separately. See the [exact record](verification/facility-2026-10-27/README.md).

Later [October 28 native execution](verification/native-2026-10-28/README.md)
ran all 77 Python cases without skips, the actual pinned pretrained model, and
a 20-frame synthetic recording on an isolated cloud CPU. Its repaired package
pins, measured timings and failures are recorded separately. It does not measure
representative accuracy, owner-hardware performance or 100-camera operation.

## Reconciliation and operational gates

The later [offline evidence checklist](offline-qualification.md) provides a local
source/log collector, listed-file integrity verification and a workload-plan
preflight. These preparation tools do not run inference or qualify any operating
capacity; their tests belong to their own revision, not the baseline counts above.

The [owner-PC continuation](verification/host-2026-10-28/README.md) now records local AI execution, isolated GPU output agreement, short public-feed loads and fixed person-image metrics with source hashes and sanitized receipts. The local adapter/UI changes and private GPU harness are not included in this published implementation baseline. Production integration, representative video/event accuracy, sustained recording and 100-camera acceptance remain unqualified.

[Issue #6](https://github.com/bartytime4life/Intelligent-DVR-Tool/issues/6) retains
overlapping-part decomposition, installed/live-service delivery, real-site checks
and the novice study. The proposed 80% unaided completion and median under three
minutes with 5–8 novices have not been measured.

The [capacity target](../edge/capacity-target.json) still needs accepted codec,
resolution/source FPS, analysis cadence, delay, retention and hardware/worker
values. Qualification must distinguish recording, analytics and browser workloads.

The hosted app and published wiki require their own revision/publication checks.
A repository merge or green CI run does not establish deployed-version parity.
No GitHub release was present at the October 28 audit.

No subscription, paid inference or paid trial is required by this implementation.
Local hardware/storage still consume resources. The repository currently assigns
no software license; third-party licenses remain separate. See
[project terms](../README.md#checks-and-project-terms) and [security boundaries](../SECURITY.md).
