# Documentation alignment — November 12, 2026

This focused follow-up starts from merged source
`66e6dd1cde9913e6c4f03fb94733e83dc3070c93`
([PR #114](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/114)), after
the route upgrade in [PR #115](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/115) and
the [197-path documentation audit](../documentation-complete-2026-11-12/README.md)
merged in [PR #113](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/113).
It aligns current guides and status with the merged route calculation and
evaluation input binding; it does
not replace that earlier inventory or its dated CI snapshot.

## Rehearsal correction and retained route evidence

The earlier [route receipt](../route-coverage-math-2026-11-12/README.md) describes
the separate rehearsal as fixed at 61 positions and 30 seconds. That wording is
incorrect for the source it records. Its original bytes, source hashes, test
counts and geometry results are retained; this paragraph is the correction.

[The geometry source](../../../src/facility.mjs) defines the UI's default:

```text
position count     = max(2, min(601, ceil(route_length_metres) + 1))
simulated seconds  = route_length_metres / 1.4
```

Positions are spaced equally along the planned route. The generic `rehearse`
helper accepts an explicit sample-count override; the UI does not supply one.
[The playback UI](../../../src/FacilityBuilder.jsx) uses the integer multiplier
`max(1, ceil(simulated_seconds / 60))`, shown beside the timeline. Long simulations
therefore play faster, while the scrubber still uses simulated seconds. This is
an assumed walking pace, not measured movement or actual tracking.

Current [facility instructions](../../facility-builder.md) and the
[science guide](../../science-and-algorithms.md#measure-the-route-by-covered-distance)
now distinguish three calculations: outdoor zones use a bounded grid; route
coverage/overlap use distance inside drawn positive-area fans; rehearsal uses
sampled camera-transition proposals. Route metrics include uncovered distance
and the longest continuous blind stretch. All remain ground-plane planning
estimates requiring physical qualification.

The [architecture guide](../../architecture.md#visibility-is-geometry) also
corrects its omission list: modeled room doorway gaps and opaque lintels already
affect wall-ray intersections through `wallObstacles` and `roomWallPieces`.
Exterior glazing remains opaque. Floor/roof slabs, furniture, terrain, lighting,
lens distortion and recognition quality remain outside the visibility estimate;
pixel density is a separate planning calculation.

The [PC copy-only instructions](../../pc-testing.md#oem-backups-without-a-recognition-model)
also remove an unsupported empty-source requirement. `validate_config` in
[the backup library](../../../edge/backup_library.py) accepts an existing approved
source directory, including completed recordings; source and backup paths must
remain separate, with neither containing the other. Generated-input-first
qualification and explicit backup start remain required by the guide.

## Current baseline and scope

README, product status, roadmap and the science guide now point to merged
PR #114's bounded JSON input binding and PR #115's route calculation, with
[source-bound geometry checks](../route-coverage-math-2026-11-12/validation.json)
and [evaluation proof](../evaluation-binding-2026-11-11/README.md).
Earlier PR #112 algorithm counts and PR #113 documentation checks remain dated
history. Local Chrome checks are separate from hosted browser CI; this follow-up
does not assert that every PR #115 workflow passed.

The first local documentation checkpoint used `2cac2173`; PR #114 merged while
this follow-up was being prepared, so its current guides and generated Wiki
pages were integrated before publication. Its production code is part of the
merged baseline, not a change made by this documentation pass.
Application sources, tests, dependencies, private files, media and historical
receipts are unchanged. Wiki companions are regenerated from canonical guides;
that does not publish the separate GitHub Wiki. This pass performs documentation
checks, not a new application build, browser run, camera test or field acceptance.

## Inventory and documentation validation

The [current Markdown inventory](inventory.json) records paths, categories and
SHA-256s, excluding this verification directory to avoid self-referential hashes.
The earlier audit's retained entries are not new application test claims.
[Validation and preservation checks](validation.json) record the current link,
graphics, Wiki and source-preservation results. The [hosted baseline snapshot](baseline-ci.json)
records all four successful PR #113 workflows. PR #114 and PR #115 each have
three successful workflows and a browser workflow still running at the stated
read time.
Regenerated Wiki source is reviewable here. Separate Wiki publication remains
unperformed because terminal Git authentication is unavailable.

## Documentation checks

The Wiki generator produced 68 pages/navigation files. Local link/evidence checks,
the Wiki drift check, all eight Wiki documentation tests and `git diff --check`
passed. The parent documentation pass records the final inventory and validation
snapshot separately; these checks do not rerun the historical runtime experiments.
