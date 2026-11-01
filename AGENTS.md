# Prototype Instructions

Owner selected the dark monitoring-wall concept (option 1) with additional polish on 2026-10-24. Preserve the central 2x2 camera wall, compact right review queue, bottom source strip, teal selected states and restrained amber review actions. Keep synthetic camera imagery and simulated playback explicit. Never claim live connectivity, actual recognition quality or measured latency without qualified evidence. Keep imported offline observations separate from generated sample imagery. No subscriptions or paid inference are part of this implementation.

Owner capacity decision (2026-10-27): the product must support at least 100 simultaneously active cameras. Prepare performance enhancements around that minimum, with bounded per-camera buffers, fair shared inference workers, visible drops/staleness, and a path to multiple local worker hosts. Five generated sample scenes are UI fixtures, not the product capacity target. Camera connection, recording, analytics cadence and visible browser tiles are separate workloads; qualify all required workloads at 100 cameras on the intended hardware before claiming support. Synthetic load simulations do not establish detection throughput. Do not activate cameras, monitoring or footage transmission as part of offline performance preparation.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.


Owner facility-editor decision (2026-10-27): build the recommended MapLibre + Three.js + Terra Draw guided facility builder within this workspace. Use the first facility-editor concept as layout guidance. Support editable buildings, floors/rooms, labels, camera placement and explicit estimated coverage, with a route rehearsal for proposed cross-camera handoffs. The rehearsal is simulated; do not present it as actual person tracking, identity verification or calibrated visibility. Keep external map access off by default and retain export/undo.

Owner next-work request (2026-10-27): queue easy facility creation using a location button or address/map selection, an area of interest, and an automatically drafted facility from overhead information. Explore Google Maps and subscription-free alternatives for a novice-friendly flow. See docs/easy-facility-setup.md for researched options and the proposed open-footprint-first implementation; automatic drafting is not implemented by the initial editor.

Owner measurement/shape request (2026-10-27): implement an open-map starter using optional GPS, footprint dimensions and common building shapes. Use code/industry references as labelled planning guidance, never as measurements of an unknown building or a compliance claim. Preserve source/license information, explicit review before applying map drafts, and Undo. See docs/map-measurements-and-shapes.md for the OSM simple-way adapter and its limits.

Owner machine-setup decision (2026-10-27): provide practical Linux and Windows builds for the 100-camera target, including disks/SSDs, RAM, CPU, GPUs/VRAM, power supplies, cooling and storage arithmetic. Integrate a System workspace using the existing dark/teal visual language. Browser preview limits must take effect; exported local policies must have explicit enforced scopes. Hardware and GPU presets are planning candidates, never benchmarks or activated GPU backends. Keep purchasing/installation details in documentation. No disk formatting, RAID provisioning, host tuning, driver installation, camera activation or monitoring starts from the browser.

Owner facility-reliability decision (2026-10-27): advance location-to-editable-footprint setup with submitted address search, explicit provider/privacy choices, deterministic offline extracts, safe advanced geometry and browser regressions. Preserve camera plans, source attribution, editable dimensions and Undo. Exclude unsupported holes/parts instead of inventing geometry. Report live retrieval, scripted effort, novice-user success and survey accuracy as separate evidence.

Documentation reconciliation (2026-10-28): use `docs/product-status.md` for the
published capability baseline and `docs/verification/README.md` for revision-bound
checks. The dated decisions above are historical context. PR #11 implemented
submitted address search, selectable services, offline file review and supported
outer-only OSM relations; holes/parts, live-provider/site qualification and novice
acceptance remain open. Reconcile separately reported local AI work with source
and receipts before presenting it as shipped. Retain synthetic/estimated and
100-camera qualification boundaries in documentation updates.

Facility acceptance follow-up (2026-10-28): facility v2 adds holes/base/independent
part fields; accept ordinary v1 input but never downgrade v2 geometry silently.
See docs/facility-setup-reliability.md and its dated qualification record. Native
Vite geo middleware is opt-in fixed-loopback delivery, not installed services or
Sites delivery. The original novice comparison includes unavailable imagery
assistance; the study kit must not substitute a different third flow or invent
participants. Overlapping parts and field/live/device acceptance remain open.

Owner deployment priority (2026-10-29): advance toward real functional deployment
of AI-assisted scene, person and object recognition. Prioritize a source-matched
recording-to-human-review workflow, representative quality evaluation, explicit
single-source ingest/recording, then staged 1/5/25/50/100-camera acceptance. Scene
inventories are sampled class counts, not learned behavior or identity claims.
Preserve existing local unpublished work while implementing against current main.

Owner experience review (2026-10-29): streamline the existing dark/teal workflows
and repair review continuity. All queue entry paths must preserve decisions and
refuse overflow. Keep imported/reviewed records on sample reset, retain the
Recognition session across workspace switches, pause hidden footage, and expose
storage failures. See docs/experience-review-2026-10-29.md for verified fixes,
qualification limits and the remaining local-deployment priorities.

Owner recording-workflow request (2026-10-29): connect Recognition to a bounded
local analysis service after reconciling PR #25. Require explicit job start,
recording/model/rule selection, progress/cancel, source-matched result opening,
local-only files/inference, path/resource limits and a CPU path. Reuse analyzer
and review contracts. Distinguish this from live cameras, tracking, measured
recognition quality and 100-camera acceptance.

Owner real-feed decision (2026-10-29): remove generated/stock camera imagery and
simulated default events from the active interface. Start with honest empty
states. Provide explicit local webcam and configured LAN DVR RTSP connections,
visible errors, disconnection and bounded preview resources. Preserve reviewed
legacy records without invented evidence. Camera preview, recording analysis,
live inference, identity tracking and 100-camera qualification remain separate.
This decision supersedes the earlier synthetic camera-wall imagery preference.

Owner PC-test readiness request (2026-10-29): provide a reproducible Linux/Windows
install path, pinned isolated CPU dependencies, an honest readiness check, and a
prebuilt PC test kit with source identity. Install/check must not activate cameras
or inference. Preserve local credentials/settings on reinstall; keep physical-PC
and device acceptance separate from clean CI installation and synthetic checks.

Owner facility-workspace decision (2026-10-29): show local-plan polygon/courtyard
and route measurements directly on the map with metric/imperial display, preserve
floor elevations when adding levels, and make room copying undoable. Provide
explicit camera preview with planned FOV guides, click-to-aim/move, centering,
compass and map reset. Color-code restricted and unexpected-class zones; map
geometry and manually configured camera image regions are separate. Exported
recording rules are class-presence candidates for human review, not calibrated
visibility, learned anomaly detection, object identity or continuous live AI.

Owner floor-model follow-up (2026-10-29): support editable polygon and line
dimensions with a persistent meters/feet choice for entry and display. Model
per-level openings and fully open floors so the ceiling beneath uses the same
void. Keep walk paths on solid floor. Add editable straight-stair reservations
from modeled floor rise with sourced 2024 IBC general guidance and visible
departures; do not claim local code compliance, measured headroom or surveying
accuracy. Keep stair landings explicit and floor cutouts independently editable.

Owner public-webcam request (2026-10-29): support intentionally published internet
webcams safely, using explicit operator-approved HTTPS sources, attribution,
network and media bounds, and clear snapshot versus motion labels. Keep local
camera footage and inference local. Public visibility is not reuse permission;
do not discover exposed private cameras or bypass provider access controls.

Owner facility-library decision (2026-10-29): fresh installs must start with a
blank facility, without sample buildings, cameras, routes or fictitious site
boundaries. Support separate named facilities, browser saves, portable named
JSON files and collection backups. Preserve legacy single-facility data during
migration, add imported/example plans as new facilities, and prevent pending
edits or storage failures from silently overwriting saved work.

Owner saved-video enhancement decision (2026-10-30): add opt-in post-recording
sharpening comparisons through the existing analyzer. Preserve original footage
and original-only rule observations, record separate candidate detections and
provenance, and require independently labeled comparisons before accuracy claims.
Research Real-ESRGAN/SwinIR as optional later candidates; no automatic weights,
face restoration, camera activation or installed-service replacement.

Recording-coverage follow-up (2026-10-30): a failed frame read must not by itself
produce completed coverage. Bind new results to bounded strict decode/inventory
checks; reject early/corrupt decoding, label unknown completeness separately from
intentional limits, and retain historical results as explicitly unverified.
Preserve source bytes, existing worker bounds, recovery and explicit activation.

Owner review follow-up (2026-10-31): implement the October 30 review's missed
opportunities as four separate PRs — review workflow, zones on real camera
stills, camera planning metrics and local service robustness (see
docs/review-2026-10-30.md). Observation thumbnails and zone stills may be stored
in this browser's IndexedDB only, drawn from verified local recordings or explicit
captures, removed with their records and never uploaded. LAN-recorder segment
observations reach Events only through an explicit per-segment Send to Events;
never queue them automatically. Keep edge/inference.py, journal.py,
supervision.py, scheduler.py and profiling.py byte-identical while the
durable-overload evidence pins their hashes.

Owner rule-gap decision (2026-10-31): a presence run continues across sampled
frames without a qualifying detection while matches stay within the rule's
max_gap, so brief occlusion or motion blur does not emit a second observation.
Webcam testing split two real visits into five observations under the previous
reset-on-any-miss behavior. A gap longer than max_gap still starts a new run.
Rule-engine hashes changed; re-analyze traces before evaluating them.

Owner training decision (2026-11-01): training must be easy for a novice without
navigation confusion. Each session either improves overall recognition or sets a
baseline for an individual. Guided detection training lives in the Train
workspace: one page with a camera check, an on-screen scripted recording that
pauses while the window is hidden, automatic local import and analysis, plain-
language per-prompt results and a recommended threshold. Applying it saves a new
rule set through the narrow --allow-training write path (fixed fields, exclusive
create, at most 50). Results describe the session, never qualification. Person
enrollment follows separately: consent-based face templates kept on this computer,
deletable, and shown only as "possible match" suggestions for human review; this
supersedes the earlier "no face identification" statement once implemented.

Owner enrollment decision (2026-11-01): Train enrolls consenting people for a
face baseline. Consent (name plus explicit agreement) comes before any capture;
pinned OpenCV Zoo YuNet (MIT) and SFace (Apache-2.0) run only in a bounded local
worker; templates are private files beside the catalog, never sent to the browser,
deletable, at most 50 people. A baseline check reports recognized views and
refines the template. Matches are suggestions for human review only, never
identification or access decisions. Off unless --allow-face-enrollment.
Possible-match suggestions (2026-11-01): Recognition offers "Check for enrolled
people" on results from this computer's own jobs. The face worker looks only inside
the analyzer's person boxes; the browser gets names, boxes and similarity, never
embeddings. Confirm adds that view to the template; "Not this person" only hides it.
Suggestions never reach Events or exports automatically.

Owner building-workflow preference (2026-11-01): make facility creation approachable
for a first-time planner. Surface visual footprints, clear placement previews and
quick ways to position or repeat buildings. Keep exact dimension entry and Undo.

Owner indoor-workflow preference (2026-11-01): make indoor planning usable with
few inputs. Start from the selected floor, preview rooms and halls as they are
drawn, offer exact dimensions when needed, and preserve existing rooms, stairs,
floor openings, and Undo. Proposed partitions do not establish actual walls.

Owner doorway-workflow preference (2026-11-01): place doorways by clicking shared
room walls and drag them along the wall. Keep dimensions editable, previews
explicit, and saving/Undo dependable through room edits and portable plans.

Owner window-workflow preference (2026-11-01): click an outside wall to place
a planned window; move and resize it directly on the wall. Keep widths, sill
heights and elevations editable and preserve windows in saved facility plans.

Owner stair-workflow preference (2026-11-01): click the start landing on the
active floor, choose the destination level, and drag or rotate the whole stair
around that start. Keep exact sizing, explicit floor openings and one-step Undo.

Owner Mac-update preference (2026-11-01): reconcile working local setup with the
repository so future installs and updates preserve models, recordings, settings,
tuned rules, enrollment templates and browser work. Keep private runtime data out
of Git; document folder backups and browser exports separately. Maintain repeatable
Mac Install / Check / Start and regression checks for data preservation, model
verification, stale builds and duplicate launches. Do not promote synthetic setup
checks into camera, recognition-quality or capacity claims.
