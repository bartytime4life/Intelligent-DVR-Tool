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
