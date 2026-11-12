# PR #119 browser header follow-up — November 12, 2026

The density table now declares its three column headers with `scope="col"`.
The strict browser role assertions remain unchanged. This is an accessibility
markup correction; the projection formula, numerical method, displayed ranges
and generated mathematical proof are unchanged. The [original record](README.md),
receipts, screenshots and source hashes remain historical evidence for their
recorded revisions.

## Hosted failure and diagnosis

[PR #119](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/119) published
head `888a435ec65c992bf6cfa8bb099cc204370a1900`.
[Workflow run 43179542098, job 131051877862](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/43179542098/job/131051877862)
checked its merge commit `031ddd66880e5a5a0e601159cbf96398f3646fa0` against
base `63b06ba2aab3adcffc38f52310b55969fb538afe`. The job used Playwright 1.56.1
and Chromium 141.0.7390.37, build 1194, on Ubuntu 24.04.

The review preflight passed **42** executions and the interrupted-review preflight
passed **10**. Step 9, the general facility browser suite, finished with **234
passed and 5 failed**. These are per-step counts, not a distinct-scenario total.
All five failures were in `tests/browser/facility-camera-planning.spec.mjs`:

- The saved-plan density table, lens preset and installer download scenario at
  line 177.
- The four projected-detail scenarios at line 210: tilt 60° or 89°, each at
  1440- or 375-pixel viewport width.

Each failed `getByRole('columnheader')` assertion expected three headers and
received zero. The uploaded Playwright ARIA snapshots show the table and correct
ground ranges, but classify the three `<thead><th>` elements as ordinary `cell`
roles. The body headers, which already declared `scope="row"`, retain their
`rowheader` roles. The pinned local probe below identifies Playwright 1.56.1's
implicit-role inference as the cause; Chromium's native accessibility tree
already recognizes the column headers. Explicit scopes make the semantics
unambiguous to both test versions, without weakening the role assertions.

The subsequent Python setup, build and five local-service/inference/RTSP/OEM
browser lanes were **skipped** after step 9 failed. This run supplies no new
qualification for those lanes. It does not invalidate the separately recorded
mathematical oracle, and it is not evidence of physical camera visibility or
recognition quality.

The [uploaded artifact](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/43179542098/artifacts/13926851962)
and decoded job log were fetched through the GitHub connector and preserved
locally under `/tmp/dvr-pr119-ci-triage/`:

| Evidence | SHA-256 |
| --- | --- |
| `hosted-job-131051877862.log`, decoded UTF-8, 340,726 bytes | `65608aca9594cc0734c5c5873a42760ac5dcbb06c0227448073d62d1f6f1e2bc` |
| `browser-artifact.zip`, artifact 13926851962, 14,885,546 bytes | `35e95e9c23fd3ce50708facf924ff836feca2f22ee8cf0186709df3ed066a20b` |

## Source binding

The checkout was clean at published head `888a435ec65c992bf6cfa8bb099cc204370a1900`
before this follow-up. The application diff adds only three `scope="col"`
attributes in [PixelDensity](../../../src/FacilityBuilder.jsx). No browser
assertions, dependencies, protected runtime sources or historical evidence
files are changed.

| File | SHA-256 |
| --- | --- |
| `src/FacilityBuilder.jsx`, failed published head | `a959fda3093704ef700e17e461bcdaca91770f9985daa9c6f57bf899d7ce5e19` |
| `src/FacilityBuilder.jsx`, this repair | `a8622cf9e6a289669a0e5e2fdef678e0bc2fa96723848e10d5556792caa388bb` |
| `src/facility-dori.mjs`, unchanged | `323cee22e78d6663198e0a77c4c8db79b6f3c722a2625f1e981eb7253af2766e` |
| `tests/browser/facility-camera-planning.spec.mjs`, unchanged | `604c33aca0675cde906eb755e8bb395af8acd16fd52b99cd1ac36027ed037b05` |

## Local checks and limits

Build ran before the test suites. The existing large-chunk build advisory remains.
All browser fixtures use generated geometry and local browser storage/export;
no camera or inference is started.

| Check | Result |
| --- | --- |
| `npm run build` | PASS; Sites build prepared |
| Initial `npm test` | 583 discovered: 581 passed, 2 optional socket tests skipped |
| `DVR_TEST_SOCKETS=1 npm test` | 583 passed, zero failed or skipped |
| `npm run test:sites` | 4 passed |
| Targeted camera-planning browser file | 12 passed, including all five hosted failure scenarios |
| Isolated Playwright 1.56.1 / Chromium 141, formerly failing scenarios | 5 passed |

Browser command:

```bash
DVR_BROWSER_CHANNEL=chrome npx playwright test \
  --config=playwright.facility.config.mjs \
  tests/browser/facility-camera-planning.spec.mjs \
  --output=test-results/pr119-dori-ci-followup
```

The first browser attempt stopped before executing tests because port 4182 was
owned by a separate verification job. Its infrastructure-only error was retained
in `planning-browser-followup.log`. After that job released the port, the command
above started its own server and passed in 31.6 seconds. No other test server was
reused. The prior local browser JSON was backed up before the new run.

The existing local environment is Node 22.13.1, Playwright 1.61.1 and installed
Chrome 157.0.8103.50. Its generated static-table probe exposes three column
headers both before and after the repair, so that environment alone cannot
reproduce the failure.

For direct verification, Playwright 1.56.1 and official Chromium
141.0.7390.37/build 1194 were installed exclusively under
`/tmp/dvr-pr119-pinned-browser-20261112/`. The default installer refused the local
Ubuntu 26.04 platform. A per-command
`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` selected the same official
Ubuntu 24.04 browser build used by CI; no system packages, project dependencies
or environment pins were changed.

The planning fixture and its helper were copied into that temporary package.
Only the fixture's source import specifiers changed to absolute paths in the
pinned project checkout. The helper is byte-identical, all `test`/`expect` imports
resolve to the isolated 1.56.1 package, and every assertion is unchanged. The
temporary config retains the serial facility settings and starts its own server
from the project checkout. The five formerly failing scenarios passed in
**12.6 seconds**; it does not claim a repeat of the entire hosted workflow.

The matching-version static probe measures zero Playwright `columnheader`
matches without scopes and three with scopes. Direct Chromium CDP
`Accessibility.getFullAXTree` reports three native column headers in both
versions of the same markup. This distinguishes the older test-role heuristic
from a native browser accessibility failure.

The isolated command was:

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 \
PLAYWRIGHT_BROWSERS_PATH=/tmp/dvr-pr119-pinned-browser-20261112/browsers \
node /tmp/dvr-pr119-pinned-browser-20261112/node_modules/playwright/cli.js test \
  --config=/tmp/dvr-pr119-pinned-browser-20261112/playwright.config.mjs \
  --grep='pixel density table|projected ground detail' \
  --output=/tmp/dvr-pr119-pinned-browser-20261112/test-results
```

| Local evidence | SHA-256 |
| --- | --- |
| Pinned static probe, including native CDP roles | `2406231d48bfce0927a26afb1332559286273e3629849f11bdd490a8eb51e9e5` |
| Pinned five-case browser JSON | `a6c63537c9ba83c3b42a5509da6718f644436cdfa44459fee871ecc86afeb8ce` |
| Pinned five-case browser log | `63d9b7b09c3fcfe8bab5e1d2ebb9dcdb9fbb27cf60791a02130183d82addbc77` |
| Temporary fixture/helper/config source-binding manifest | `3588cff13dc42c49e76a5c18615cf7827daaba363ccaeec53225f5f012aab74e` |
| Existing-environment twelve-case browser JSON | `44e9c768cb6aab15e3121b51b9d1576ba3c0f13a2c43ac93574f092844945e4b` |
| Socket-enabled full Node log | `a76211e9f35ef440b8259e88442940849939b2c3b96451c7d06f230b0e321380` |

A fresh hosted check at the follow-up head is still required to verify all CI
lanes. The original failed hosted run remains failed.

Local logs and the new browser JSON are preserved in
`/tmp/dvr-pr119-ci-triage/`; the temporary source-binding manifest is in the
isolated tool directory. No hosted rerun, commit, push, merge, application
installation or deployment is performed by these checks.
