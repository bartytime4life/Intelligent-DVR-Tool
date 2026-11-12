# Develop and verify Intelligent DVR

[Guide index](README.md) · [Architecture](architecture.md) · [Science and algorithms](science-and-algorithms.md) · [Security boundary](../SECURITY.md)

Use an isolated checkout for changes. Keep recordings, credentials, model weights,
face templates and private service stores outside the public change set. Read
[AGENTS.md](../AGENTS.md) before editing; it records the owner’s design decisions
and protected runtime/hosting files. Installation, browser behavior, CI and
physical-device acceptance have different checks.

## Prepare the right environment

Use Node.js 22 and `npm ci` for the application. The
[lockfile](../package-lock.json) pins its JavaScript dependencies. The
[source-only preview](../README.md#run-the-source-only-ui-preview) provides the
interface; use a [platform launcher](pc-testing.md) for local service features.

Python 3.12 is used in CI. Use an isolated environment prepared for the intended
platform, rather than an unrelated system Python:

| Purpose | Dependency source | Scope |
| --- | --- | --- |
| General CPU source development | [requirements.txt](../edge/requirements.txt) | Supported version ranges; not an exact qualification environment |
| Linux x86-64 / Windows amd64 CPU checks | [requirements-qualification.txt](../edge/requirements-qualification.txt) | Exact hash-pinned runtime, including ONNX fixtures and PyAV |
| Apple silicon source install | [Mac setup](setup-macos.md), [requirements-macos.txt](../edge/requirements-macos.txt) | Separate pinned Mac runtime; use its installer/checker |
| Optional CUDA investigation | [GPU guide](live-gpu.md), [requirements-gpu-qualification.txt](../edge/requirements-gpu-qualification.txt) | Separate environment and host qualification; CPU CI does not prove CUDA execution |

For a fresh Linux/Windows test environment, use Python 3.12 to create a virtual
environment, activate it, then run `python -m pip install --require-hashes -r
edge/requirements-qualification.txt`. Keep the existing environment until the new
one passes its checks. Model weights are separate from these requirements.

## Run the checks that cover the change

Run from the repository root after activating the prepared Python environment.
Build before suites that launch the native HTTP service or inspect build output:

```bash
npm ci
npm run build
npm test
npm run test:sites
python -m unittest discover -s tests -p 'test_*.py'
```

The ordinary commands above may skip optional socket or native-runtime cases.
To include the controlled loopback fixtures on Bash:

```bash
DVR_TEST_SOCKETS=1 npm test
DVR_TEST_SOCKETS=1 python -m unittest discover -s tests -p 'test_*.py'
```

In PowerShell, set `$env:DVR_TEST_SOCKETS='1'` before running those two commands.
These fixtures use generated inputs and local test servers. Report pass, failure
and skip counts separately; a skipped native check is not a successful execution.
Platform-specific skips remain possible. [CI configuration](../.github/workflows/ci.yml)
is the authoritative recipe for the current Linux/Windows jobs.

For a focused fix, select the relevant test file first. For example:

```bash
node --test tests/training.test.mjs tests/training-library.test.mjs
python -m unittest discover -s tests -p 'test_tracking.py'
```

## Browser regressions

Playwright is installed separately in CI; it is not an application dependency in
`package-lock.json`. The [browser workflow](../.github/workflows/facility-browser.yml)
currently pins `@playwright/test@1.56.1` on Ubuntu 24.04. In a disposable development
checkout, reproduce that setup with:

```bash
npm install --no-save --package-lock=false @playwright/test@1.56.1
npx playwright install chromium
npx playwright test --config=playwright.facility.config.mjs
```

On Linux, the browser may also require OS libraries; the CI workflow installs
them with `--with-deps`. An already installed compatible Chrome can be selected
with `DVR_BROWSER_CHANNEL=chrome`; record that browser/tool version as a distinct
local environment. The general suite starts its own fixed-port Vite server and
refuses to reuse another server.

| Suite configuration | What it exercises |
| --- | --- |
| [facility](../playwright.facility.config.mjs) | General interface, review, Train, System and facility behavior |
| [analysis](../playwright.analysis.config.mjs) | Native local service with generated media/model, result opening and recovery |
| [feeds](../playwright.feeds.config.mjs) | Controlled webcam/RTSP preview and live-AI integration |
| [recorder](../playwright.recorder.config.mjs) | Controlled one-camera recording, analysis and review |
| [library](../playwright.library.config.mjs) | Backup setup, transport errors and review recovery |
| [library native](../playwright.library-native.config.mjs) | Copied generated recording through real local CPU analysis |

Run each with `npx playwright test --config=CONFIG_FILE`, replacing the placeholder
with the linked filename. Native suites require the built app and their fixture
dependencies: NumPy, OpenCV, PyAV and ONNX. The Linux/Windows qualification
requirements supply those; the installed Mac CPU runtime alone does not include
ONNX. Use the CI-supported development environment for generated-model browser
fixtures. Check each configuration for its fixed port and fixture setup.
Screenshots/traces under `test-results/` and JSON under `qa-local/` are local
outputs; publish only reviewed, source-bound documentation assets.

## Find the implementation and data contract

| Change | Start here | Contract / guide |
| --- | --- | --- |
| Tasks, navigation and review | [App.jsx](../src/App.jsx), [review-transfer.mjs](../src/review-transfer.mjs) | [Human review and browser saves](review-and-events.md) |
| Recording jobs and access checks | [local_service.py](../edge/local_service.py), [analysis_worker.py](../edge/analysis_worker.py) | [Service limits and recovery](local-analysis-service.md#limits-and-recovery) |
| Detection and rule observations | [analyze.py](../edge/analyze.py), [rules.py](../edge/rules.py) | [Edge CLI](../edge/README.md), [coverage](recording-coverage.md) |
| Track association and continuity | [tracking.py](../edge/tracking.py) (`assign`, `assign_gated`, `Tracker`) | [Mathematics](science-and-algorithms.md), [tracking evaluation](tracking-evaluation.md) |
| Recognition file import | [recognition.mjs](../src/recognition.mjs) | `intelligent-dvr.recognition-review.v1`; [exact source matching](recording-recognition.md) |
| Evaluation | [evaluation.py](../edge/evaluation.py), [tracking_evaluation.py](../edge/tracking_evaluation.py) | [Detection manifest/labels](offline-evaluation.md), [anonymous track labels](tracking-evaluation.md) |
| Guided threshold tuning | [training.mjs](../src/training.mjs), [training-library.mjs](../src/training-library.mjs) | [Calibration, fresh checks and saving](training.md) |
| Local assistant and Lab receipt | [ollama.mjs](../src/ollama.mjs), [lab-receipt.mjs](../src/lab-receipt.mjs) | [Optional assistant](training.md#ask-the-local-training-assistant); Lab receipt is distinct from analyzer receipts |
| Facility validation | [facility.mjs](../src/facility.mjs) | [Facility guide](facility-builder.md), [portable plans](saved-facilities.md) |
| Visible ground and metrics | [facility-visibility.mjs](../src/facility-visibility.mjs), [facility-visibility-protocol.mjs](../src/facility-visibility-protocol.mjs), [use-facility-visibility.mjs](../src/use-facility-visibility.mjs), [facility-coverage.mjs](../src/facility-coverage.mjs) | [Projection mathematics](science-and-algorithms.md#project-the-visible-ground-footprint), [replayable geometry record](verification/ground-frustum-math-2026-11-12/README.md) |
| Planar calibration and exact boundary | [facility-calibration.mjs](../src/facility-calibration.mjs), [planar-predicates.mjs](../src/planar-predicates.mjs) | [Calibration contract](facility-calibration.md), [current integration checks](verification/coordinate-integrity-math-2026-11-12/README.md) |
| Browser still storage | [image-database.mjs](../src/image-database.mjs), [local-images.mjs](../src/local-images.mjs) | [Storage boundaries](architecture.md#where-data-goes) |

The analyzer’s receipt, frame trace and browser review bundle serve different
purposes. Do not substitute one for another or reuse a result after changing its
recording/model/labels/rules or required implementation fingerprint. Current
tracker method is `bytetrack-style-iou-kalman-v3`; historical v1/v2 review imports
remain readable, while current tracking evaluation requires re-analysis with the
current source. See [metric provenance](tracking-evaluation.md#metric-provenance-and-reproducibility).

## Verify ground visibility changes

The visibility protocol binds one immutable snapshot to the exact plan object.
A structurally identical clone is a different plan revision. Keep full
MultiPolygon topology and distinct camera IDs through every consumer; never
replace missing geometry with an empty footprint or legacy radial-fan fallback.
The direct point-ray diagnostic and closed polygon boundary policy have different
boundary semantics, documented in the [science guide](science-and-algorithms.md#project-the-visible-ground-footprint).

For focused generated checks:

```bash
node --test tests/facility-visibility.test.mjs tests/facility-visibility-integration.test.mjs tests/facility-visibility-task.test.mjs tests/facility-visibility-presentation.test.mjs tests/facility-coverage-task.test.mjs
npx playwright test --config=playwright.facility.config.mjs tests/browser/facility-visibility.spec.mjs tests/browser/facility-camera-planning.spec.mjs
```

The [verification record](verification/ground-frustum-math-2026-11-12/README.md)
provides frozen independent inputs, replay instructions, numerical limits and
raw failures. Retain its ideal-circle boundary disagreements when comparing the
inscribed range polygon with an exact circle. Tests of generated geometry and
worker recovery do not qualify optics, installed services or camera throughput.

## Verify coordinate changes

Use focused unit and browser checks before the broader suites:

```bash
node --test tests/planar-predicates.test.mjs tests/facility-calibration.test.mjs tests/facility-reorigin.test.mjs
npx playwright test --config=playwright.facility.config.mjs tests/browser/facility-studio.spec.mjs tests/browser/facility-reorigin.spec.mjs
```

The [integration record](verification/coordinate-integrity-math-2026-11-12/README.md)
links portable frozen exact-rational oracles and baseline/candidate receipts.
Hash imported predicate dependencies as well as the calibration module; old
single-file receipts cannot establish which new helper bytes were executed.
Keep old method-v2 records unchanged and record v3 replays separately. Boundary
membership is exact for represented coordinates, while projection residuals
retain explicit numerical tolerances. Save-site verification also checks refusal,
Undo, reload and shared-room containment rather than only coordinate equality.

## Keep documentation and evidence current

Edit canonical guides before regenerating their Wiki companions:

```bash
python scripts/build-guide-graphics.py --check
python scripts/build-wiki.py
python scripts/build-wiki.py --check
python scripts/check-docs.py
python -m unittest discover -s tests -p test_wiki_docs.py
git diff --check
```

Map a new guide in both `PAGES` and `GROUPS` in
[build-wiki.py](../scripts/build-wiki.py). Keep dated receipts, original screenshots
and third-party notices intact. A new check belongs in a new dated verification
record with its revision, environment, fixture scope and actual outcomes.
The [Wiki procedure](wiki/README.md) covers staging/publication in its separate
repository. Regeneration does not publish it.

For a review, state the problem, changed behavior, checks actually run and any
remaining limits. Distinguish a source change, local pass, hosted CI, merge,
installed-machine check and field acceptance. Generated pixels/boxes can reproduce
a bug; they cannot qualify real-camera accuracy, endurance or capacity.
