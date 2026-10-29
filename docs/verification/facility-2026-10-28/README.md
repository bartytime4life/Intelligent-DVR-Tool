# Facility setup follow-up — October 28, 2026

Base commit: `50349bc758dedb6363c728e4893bedcedafc3808` (merged PR #20).
The upstream files were copied from existing local sources only after their Git
blob hashes matched the fetched main tree. The existing dirty facility workspace,
recordings, models and host settings were left intact.

## Local checks

[Per-file results](local-tests.json) and [raw TAP](local-tests.log) record **66
passes, zero failures, one skip**: 62 frontend cases and four packaging cases.
The skipped case is actual listening-socket delivery; the shell denies loopback
`listen` with EPERM. Files were run directly because this managed runner's
`node --test` output summarizes child files instead of exposing individual cases.

[Production build](build.log) passed, retaining the Sites layout. The existing
large facility bundle still triggers Vite's chunk-size warning. Browser runtime
performance is not qualified by this build. The [source hashes](source-hashes.json) bind the final local implementation and tests.
The source adds four Chromium
regressions to the existing six: v2 apply/edit/Undo, numeric polygon invalidation,
pointer AOI/pin suggestions and missing-WebGL recovery. On initial candidate `84c74116526d56b70cc121b0bd78f011025c90f9`,
[Chromium run 40814353292](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40814353292)
passed all 10 scenarios. Subsequent changes add a cross-import overlapping-part
validation guard and hide inactive rectangle fields in polygon mode; their exact-head
CI links are recorded on PR #21. Local preview start was
attempted at `127.0.0.1:4182` and failed with EPERM; browser acceptance needs CI.
The native middleware has five mocked protocol tests; CI enables its sixth test,
a real HTTP round trip against temporary synthetic provider servers, on Linux and
Windows. This does not qualify installed Photon/Overpass or regional datasets.

The empty novice-study record was summarized with zero participants, null metrics,
comparison incomplete and exit code 3, as designed. No synthetic study data is
presented as actual user evidence. Documentation links/media, generated wiki and
whitespace checks are required before submission.

## Scope and unresolved acceptance

Implemented: map-pin suggestion, pointer and keyboard-editable polygon selection,
v2 courtyard/raised-base contract through import/export/transforms/rooms/rendering/
coverage, bounded independent parts, opt-in loopback native delivery and the
original three-flow novice study recorder.

Still open: overlapping part/envelope decomposition and arbitrary complex building
relations; successful live public retrieval; actual installed local services and
regional data on Linux/Windows; real-device GPS/permissions; representative current
sites, correction burden and field/survey accuracy; 5–8 actual novices. Original
flow B requires unavailable licensed imagery assistance, so its comparison remains
blocked rather than being replaced with another address/offline route. Additional
footprint/CAD/BIM adapters remain conditional on demonstrated coverage gaps.

Schema v2 deliberately prevents older software from silently dropping geometry.
Ordinary v1 input upgrades without altering shapes. Export before reverting to
older code. No service installation, camera activation, model/inference change,
merge, deployment or native Wiki publication is part of this increment.

## Follow-through

Candidate `51e9145b707e8e7b12ece47ee9306af5dc46fdcf` passed
[Linux/Windows run 40814586136](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40814586136)
and [all 10 Chromium scenarios](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40814586134).
Linux/Windows each passed 63 frontend cases including actual loopback HTTP and
four packaging cases. The unchanged Python suite passed 125 on Linux and 91 with
34 Linux-only skips on Windows. These counts do not count skips as passes.
Final presentation changes label raised floors by their base, call the measured
perimeter exterior-only, and omit fictional rooftop decorations from imported
OSM/courtyard shells. Final source hashes include these changes; exact-head CI
links are recorded on PR #21. None of these runs tested real GPS, installed regional
services, live public retrieval, field accuracy or novice users.
