# Documentation status — November 12, 2026

This documentation-only follow-up starts from merged source
[`63b06ba2aab3adcffc38f52310b55969fb538afe`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/63b06ba2aab3adcffc38f52310b55969fb538afe)
([PR #116](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/116)).
It completes the current status readback after the
[comprehensive audit](../documentation-complete-2026-11-12/README.md) and
[source-alignment corrections](../documentation-alignment-2026-11-12/README.md).

## Current source and hosted checks

The [fresh CI snapshot](ci-snapshot.json) records all four workflows successful
on each final head of PRs #114, #115 and #116: cross-platform checks, PC install
kit, Mac source install and Facility browser regression. The older receipts
correctly retain their previously pending browser runs; their bytes are not
rewritten by this follow-up. These are source/CI results, separate from owner
installation, camera quality, endurance and 100-camera qualification.

[PR #117](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/117) is a
separate draft at the snapshot's read time. It proposes a v2 planar solver, with
generated proof and branch-local documentation. The current calibration guide
now discloses reproduced v1 rejection and collapsed-plane cases, rather than
implying the proposed rank/scale safeguards already ship. Its review and CI state
are captured separately from the merged baseline.

## Documentation coverage

The [inventory](inventory.json) covers every repository Markdown path except
this record's own directory, preventing self-referential hashes. It includes
operator workflows, Linux/Windows/Mac setup, developer/API/CLI guidance,
architecture, security, mathematics, roadmap, image provenance, historical
evidence and generated Wiki companions. Existing accurate pages remain
unchanged; historical records keep their original revisions and results.

README, guide index, product status, roadmap, the current calibration guide and
verification index now lead to this source-bound status. Wiki companions are
regenerated from those canonical guides. [Validation](validation.json) records
the current link, media/graphics, Wiki freshness, Wiki test, inventory and
preservation checks.

Application code, tests, dependencies, media and existing verification records
are unchanged. No new application build, browser scenario, native suite, camera,
detector or installed-service test is claimed by this prose-only pass.

## Wiki publication

Generated Wiki source is included and checked. The separate Wiki was not pushed;
terminal Git authentication was unavailable in the preceding staging attempt.
Its earlier staged commit is not a publication result for this newer source.
The [publication guide](../../wiki/README.md) describes source-pinned staging,
public image copying and published readback. Repository documentation and a
separate Wiki publication remain independently verifiable outputs.
