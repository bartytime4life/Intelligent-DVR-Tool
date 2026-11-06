# OEM field acceptance workflow verification — November 5, 2026

Base: `32d3d9262c733826c4182f4e37f2af403d1242a3` (merged #86), plus the
field-acceptance changes in this review. This records software checks, not an
OEM/device acceptance. The generated receipt binds the verifier source hash.

- Python 3.12.3 / OpenCV 4.13.0, reused existing OEM-workspace environment without
  installing or changing packages: 25 existing backup-library tests passed.
- Nine new field-byte verifier tests passed: mismatched bytes, hard links,
  changed sources, review source/runtime/artifact binding, CUDA startup evidence,
  partial coverage, empty files, receipt privacy and no overwrite.
- Existing native browser OEM workflow: one passed in installed Chrome (8.9 s
  total), using generated VP8 and synthetic CPU model. It verified copy, completed
  analysis and matching review after deleting only its generated OEM source.
- The first browser attempt could not launch because Playwright's bundled browser
  was absent. Retried with the harness's supported `DVR_BROWSER_CHANNEL=chrome`;
  no browser/package installation was performed.
- The new verifier also ran against the actual generated backup and persisted
  review from that browser test. [Receipt](generated-byte-check.json): byte match,
  review bound, reported CPU execution, completed coverage. The comparison source
  was the retained fixture video, identical to the deleted generated OEM file.
- Production build, documentation checks (1,204 local links), generated Wiki
  consistency (63 files), and whitespace checks passed. Build retains its existing
  large-chunk advisory. No visual UI changes were made.

Executed commands from the source checkout:

```bash
# PY is an existing Python 3.12 interpreter with the test dependencies.
"$PY" -m unittest discover -s tests -p test_backup_library.py
"$PY" -m unittest discover -s tests -p test_field_acceptance.py
npm run build
DVR_BROWSER_CHANNEL=chrome DVR_TEST_PYTHON="$PY" npx playwright test --config=playwright.library-native.config.mjs
python3 scripts/check-docs.py
python3 scripts/build-wiki.py --check
git diff --check
```

No new CUDA benchmark, actual OEM media, Windows host, physical camera, live DVR,
physical outage, separate-drive durability, endurance or 100-camera check ran.
Generated inference is not recognition-quality evidence. The
[operator procedure](../../oem-field-acceptance.md) identifies the missing physical
observations and leaves them NOT RUN until documented. No existing installation,
private recordings, model files, camera settings or credentials were modified.
