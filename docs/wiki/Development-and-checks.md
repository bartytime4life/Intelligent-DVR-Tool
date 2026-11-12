# Develop and verify Intelligent DVR

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Architecture](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data) · [Science and algorithms](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Science-and-algorithms) · [Security boundary](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Security-boundary)

Use an isolated checkout for changes. Keep recordings, credentials, model weights,
face templates and private service stores outside the public change set. Read
[AGENTS.md](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/AGENTS.md) before editing; it records the owner’s design decisions
and protected runtime/hosting files. Installation, browser behavior, CI and
physical-device acceptance have different checks.

## Prepare the right environment

Use Node.js 22 and `npm ci` for the application. The
[lockfile](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/package-lock.json) pins its JavaScript dependencies. The
[source-only preview](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Home#run-the-source-only-ui-preview) provides the
interface; use a [platform launcher](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing) for local service features.

Python 3.12 is used in CI. Use an isolated environment prepared for the intended
platform, rather than an unrelated system Python:

| Purpose | Dependency source | Scope |
| --- | --- | --- |
| General CPU source development | [requirements.txt](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/requirements.txt) | Supported version ranges; not an exact qualification environment |
| Linux x86-64 / Windows amd64 CPU checks | [requirements-qualification.txt](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/requirements-qualification.txt) | Exact hash-pinned runtime, including ONNX fixtures and PyAV |
| Apple silicon source install | [Mac setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup), [requirements-macos.txt](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/requirements-macos.txt) | Separate pinned Mac runtime; use its installer/checker |
| Optional CUDA investigation | [GPU guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Live-GPU), [requirements-gpu-qualification.txt](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/requirements-gpu-qualification.txt) | Separate environment and host qualification; CPU CI does not prove CUDA execution |

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
Platform-specific skips remain possible. [CI configuration](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/.github/workflows/ci.yml)
is the authoritative recipe for the current Linux/Windows jobs.

For a focused fix, select the relevant test file first. For example:

```bash
node --test tests/training.test.mjs tests/training-library.test.mjs
python -m unittest discover -s tests -p 'test_tracking.py'
```

## Browser regressions

Playwright is installed separately in CI; it is not an application dependency in
`package-lock.json`. The [browser workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/.github/workflows/facility-browser.yml)
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
| [facility](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/playwright.facility.config.mjs) | General interface, review, Train, System and facility behavior |
| [analysis](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/playwright.analysis.config.mjs) | Native local service with generated media/model, result opening and recovery |
| [feeds](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/playwright.feeds.config.mjs) | Controlled webcam/RTSP preview and live-AI integration |
| [recorder](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/playwright.recorder.config.mjs) | Controlled one-camera recording, analysis and review |
| [library](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/playwright.library.config.mjs) | Backup setup, transport errors and review recovery |
| [library native](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/playwright.library-native.config.mjs) | Copied generated recording through real local CPU analysis |

Run each with `npx playwright test --config=CONFIG_FILE`, replacing the placeholder
with the linked filename. Native suites require the built app and their fixture
dependencies: NumPy, OpenCV, PyAV and ONNX. The Linux/Windows qualification
requirements supply those; the installed Mac CPU runtime alone does not include
ONNX. Use the CI-supported development environment for generated-model browser
fixtures. Check each configuration for its fixed port and fixture setup.
Screenshots/traces under `test-results/` and JSON under `qa-local/` are local
outputs; publish only reviewed, source-bound documentation assets.

Make asynchronous browser checks wait for observable readiness. A transient
loading status needs a controlled request gate, rather than a delay that can
expire before the assertion. After discarding a child draft, wait for the parent
navigation guard's disabled controls to become ready before changing tasks.
The [boundary verification record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/rule-time-boundaries-2026-11-12/README.md)
retains the original failures and strict checks; it does not replace them with
retries, arbitrary sleeps or alternative acceptable outcomes.

## Find the implementation and data contract

| Change | Start here | Contract / guide |
| --- | --- | --- |
| Tasks, navigation and review | [App.jsx](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/App.jsx), [review-transfer.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/review-transfer.mjs) | [Human review and browser saves](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Review-and-events) |
| Recording jobs and access checks | [local_service.py](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/local_service.py), [analysis_worker.py](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/analysis_worker.py) | [Service limits and recovery](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Local-analysis-service#limits-and-recovery) |
| Detection and rule observations | [analyze.py](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/analyze.py), [rules.py](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/rules.py) | [Edge CLI](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Edge-CLI), [coverage](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-coverage) |
| Track association and continuity | [tracking.py](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/tracking.py) (`assign`, `assign_gated`, `Tracker`) | [Mathematics](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Science-and-algorithms), [tracking evaluation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Tracking-evaluation) |
| Recognition file import | [recognition.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/recognition.mjs) | `intelligent-dvr.recognition-review.v1`; [exact source matching](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recognition-details) |
| Evaluation | [evaluation.py](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/evaluation.py), [tracking_evaluation.py](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/tracking_evaluation.py) | [Detection manifest/labels](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-evaluation), [anonymous track labels](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Tracking-evaluation) |
| Guided threshold tuning | [training.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/training.mjs), [training-library.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/training-library.mjs) | [Calibration, fresh checks and saving](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-training) |
| Local assistant and Lab receipt | [ollama.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/ollama.mjs), [lab-receipt.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/lab-receipt.mjs) | [Optional assistant](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-training#ask-the-local-training-assistant); Lab receipt is distinct from analyzer receipts |
| Facility validation | [facility.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/facility.mjs) | [Facility guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning), [portable plans](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Saved-facilities) |
| Visible ground and metrics | [facility-visibility.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/facility-visibility.mjs), [facility-visibility-protocol.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/facility-visibility-protocol.mjs), [use-facility-visibility.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/use-facility-visibility.mjs), [facility-coverage.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/facility-coverage.mjs) | [Projection mathematics](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Science-and-algorithms#project-the-visible-ground-footprint), [replayable geometry record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/ground-frustum-math-2026-11-12/README.md) |
| Planar calibration and exact boundary | [facility-calibration.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/facility-calibration.mjs), [planar-predicates.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/planar-predicates.mjs) | [Calibration contract](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Planar-calibration), [current integration checks](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/coordinate-integrity-math-2026-11-12/README.md) |
| Browser still storage | [image-database.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/image-database.mjs), [local-images.mjs](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/src/local-images.mjs) | [Storage boundaries](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data#where-data-goes) |

The analyzer’s receipt, frame trace and browser review bundle serve different
purposes. Do not substitute one for another or reuse a result after changing its
recording/model/labels/rules or required implementation fingerprint. Current
tracker method is `bytetrack-style-iou-kalman-v3`; historical v1/v2 review imports
remain readable, while current tracking evaluation requires re-analysis with the
current source. See [metric provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Tracking-evaluation#metric-provenance-and-reproducibility).

## Verify rule-time changes

The Python presence engine and browser training counter must preserve the same
dwell/gap policy. Start with the focused generated cases:

```bash
node --test tests/training.test.mjs
python -m unittest discover -s tests -p 'test_rule_time_boundaries.py'
python -m unittest discover -s tests -p 'test_evaluation.py'
```

The first eight timing tests use only the standard library. The ninth runs a
generated constant-model CPU recording through the normal analyzer, trace, review
and evaluator; it skips explicitly without the native fixture dependencies.
It also checks refusal of the previous rule-engine fingerprint. These tests do
not open cameras or download models. The [independent package](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/rule-time-boundaries-2026-11-12/independent/README.md)
supplies frozen rational inputs, unchanged Python/JavaScript checkers, source
snapshots and strict baseline failures without requiring a native environment.

The committed evaluation corpus is a current generated test fixture, separate
from historical verification receipts. After a deliberate rule-engine change,
generate a fresh corpus with the existing generator into a new directory and
review the byte differences. For this change only the rule-engine fingerprint
and dependent review trace hashes differ; detections, event IDs, timestamps and
expected metrics are unchanged. Preserve historical records and never update a
real trace's fingerprint to bypass current-source validation.

## Verify ground visibility changes

The visibility protocol binds one immutable snapshot to the exact plan object.
A structurally identical clone is a different plan revision. Keep full
MultiPolygon topology and distinct camera IDs through every consumer; never
replace missing geometry with an empty footprint or legacy radial-fan fallback.
The direct point-ray diagnostic and closed polygon boundary policy have different
boundary semantics, documented in the [science guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Science-and-algorithms#project-the-visible-ground-footprint).

For focused generated checks:

```bash
node --test tests/facility-visibility.test.mjs tests/facility-visibility-integration.test.mjs tests/facility-visibility-task.test.mjs tests/facility-visibility-presentation.test.mjs tests/facility-coverage-task.test.mjs
npx playwright test --config=playwright.facility.config.mjs tests/browser/facility-visibility.spec.mjs tests/browser/facility-camera-planning.spec.mjs
```

The [verification record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/ground-frustum-math-2026-11-12/README.md)
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

The [integration record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/coordinate-integrity-math-2026-11-12/README.md)
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
[build-wiki.py](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/scripts/build-wiki.py). Keep dated receipts, original screenshots
and third-party notices intact. A new check belongs in a new dated verification
record with its revision, environment, fixture scope and actual outcomes.
The [Wiki procedure](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Wiki-publication) covers staging/publication in its separate
repository. Regeneration does not publish it.

For a review, state the problem, changed behavior, checks actually run and any
remaining limits. Distinguish a source change, local pass, hosted CI, merge,
installed-machine check and field acceptance. Generated pixels/boxes can reproduce
a bug; they cannot qualify real-camera accuracy, endurance or capacity.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/development.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
