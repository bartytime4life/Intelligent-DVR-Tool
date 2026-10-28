# Merged facility baseline: October 27, 2026

Inspected October 28, 2026 (America/Chicago). This record documents existing CI;
it does not claim those jobs were rerun on the inspection date.

Source commit:
[`82c862c68735720b8840461fc624e8dbe148a53a`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/82c862c68735720b8840461fc624e8dbe148a53a).
Both runs started at 23:41:07 UTC on October 27 (6:41:07 p.m. America/Chicago).

[Verification index](../README.md) · [Product status](../../product-status.md) ·
[Machine-readable receipt](ci-results.json) · [Timestamped excerpts](ci-test-excerpts.log)

## Cross-platform results

[Run 40603794970](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40603794970)
completed successfully at that source commit.

| Check | Linux | Windows |
| --- | --- | --- |
| Frontend | 46 passed; 0 failed/skipped | 46 passed; 0 failed/skipped |
| Packaging | 4 passed; 0 failed/skipped | 4 passed; 0 failed/skipped |
| Python | 66 passed; 0 failed/skipped | 66 discovered: 63 passed, 0 failed, 3 Linux-only skips |
| Total passed | **116** | **113**, plus **3 skips** |
| Production build | Passed | Passed |
| Docs integrity / wiki mirror drift | Passed | Passed |
| Appropriate launcher prerequisites | Passed | Passed |

[Linux job](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40603794970/job/122538171805) ·
[Windows job](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40603794970/job/122538171432).

The native cases use synthetic recordings/ONNX fixtures. Skips are not passes.
Launcher checks cover prerequisites, not full installation/start on the intended
machine. The documentation checker reported 183 local links, 14 media hashes,
2,381,700 media bytes and 15 wiki mirrors for that revision.

## Separate browser results

[Run 40603794987](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40603794987)
passed all **6 Chromium scenarios** in
[job 122538171745](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40603794987/job/122538171745).
Recorded OSM extracts and mocked Photon/Overpass responses exercise keyboard
search, map readiness, review/apply guards, file/paste fallback, preservation,
edits, Undo, cancellation and a narrow viewport.

The main-run attachment reports **3.666 seconds** for one scripted draft/apply
flow and **1.216 seconds** for one prescribed height correction/save. Earlier
[facility receipts](../../facility-setup-reliability.md#completed-ci-receipt) report
5.926/1.944 seconds for another run; those observations keep their own attribution.
Startup, data acquisition, human review and field verification are excluded.
Neither timing pair measures novice completion, actual correction burden, live
provider speed or surveyed accuracy.

## Boundaries and reproduction

These runs do not qualify actual camera connectivity, representative recognition
accuracy, live map-provider availability, local-service installation, target-host
GPU/storage behavior or 100-camera operation. No new deployment or footage
collection follows from this record.

Check out the recorded revision, use Node 22/Python 3.12 and follow the
[CI workflow](../../../.github/workflows/ci.yml) and
[browser workflow](../../../.github/workflows/facility-browser.yml). Install native
test dependencies explicitly and report any skips. Reproductions must have their
own timestamps and environment; do not overwrite the historical receipts.
