# Machine setup verification · October 27, 2026

This record covers the System workspace, resource policy, read-only host probe,
Linux/Windows launchers and hardware/GPU documentation. It does not qualify
recording, GPU acceleration, detection quality or 100-camera operation.

## Local checks

Node.js 22.13.1 and Python 3.12.3 were used for the fresh checks.

| Check | Result | Scope |
| --- | --- | --- |
| `npm test` | 37 passed, no skips | Existing domain contracts plus 10 setup/arithmetic/import/preview-limit cases |
| `npm run test:sites` | 4 passed | Packaging/worker contracts |
| Python unittest discovery | 66 run: 58 passed, 8 skipped | Native OpenCV/NumPy/ONNX dependencies unavailable locally; CI must run those cases |
| `npm run build` | Completed | Production package; existing large facility chunk warning remains |
| Linux launcher | Bash syntax and actual `--check` passed | Node/Python prerequisites; no install or service started |

The [JavaScript](node-tests.log), [packaging](sites-tests.log) and
[Python](python-tests.log) logs are retained. The shared
[policy fixture](../../../tests/fixtures/resource-policy.json) is asserted against
both the actual JS exporter and Python validator. Tests exercise scheduler byte,
slot and dispatch-age enforcement, strict bounds and exact policy-file hashes.
The synthetic ONNX integration additionally checks a policy-driven 10-frame
ceiling and rejects a thread override above its cap; it is not a trained detector.

## Browser checks

Actual Chrome interactions against the fresh production build verified:

- Linux/Windows selection changes the corresponding setup-guide link.
- Bitrate/drive-count changes produce a retention shortfall warning.
- GPU selection changes VRAM and the shared-host power allowance. Deliberately
  excessive context counts produce a VRAM warning.
- Applying one camera-wall tile leaves one rendered camera overlay canvas;
  the selected Parking Lot source remains visible. At 1×, the observed canvas
  backing width and CSS width were both 1437 pixels. The tile choice survives reload.
- Exporting Windows, two OpenCV threads and a 120-frame ceiling downloaded an
  actual 385-byte JSON file. `edge.resources.load_policy` validated it with
  SHA-256 `7e228e7c6e07900951efc21b5321e03738959806a1e489b310db900e84684655`.
- Default Linux/four-tile/2× settings were restored and applied before the
  [System](../../media/system-setup.webp) and [GPU](../../media/gpu-setup.webp) captures.

Browser testing found and fixed native form step validation rejecting the default
4 Mbit/s input. Custom strict validation now governs Apply, which was retested.
Background-pause behavior has a deterministic predicate test; actual hidden-tab
scheduling and mobile layout were not separately measured in this pass.

File chooser import testing was attempted but blocked by the Chrome extension's
file-access setting. No browser security setting was changed. Setup/snapshot
parsers are covered by automated tests; the browser file-import path remains
unverified in this environment.

## Read-only host reporting

The actual Linux probe ran against one selected local volume, with the optional
fixed NVIDIA inventory query. CPU/RAM/capacity values were reported; the GPU query
failed and was correctly marked **unknown**. No GPU capacity or throughput was
inferred. Host reports are not committed. Windows CI additionally exercises the
actual Windows memory/capacity probe; it cannot prove target-machine storage or
GPU-driver behavior.

## Platform and deployment limits

The cross-platform CI matrix runs Ubuntu and Windows with Python 3.12 and native
test dependencies, builds the app, checks docs/wiki drift and checks each OS
launcher's prerequisite path. The Linux-only bounded qualification subprocess
has three explicit Windows skips. Native tests use synthetic fixtures, not
physical cameras or representative recordings. See the CI follow-through below
for results rather than assuming a green run.

The launchers' full dependency-install/start paths have not been exercised on
fresh physical Windows/Linux machines. They bind the foreground preview to
loopback, preserve an existing venv, and do no OS tuning or storage provisioning.
The current analyzer remains CPU-only. Retention, RAM, VRAM and PSU figures are
entered planning calculations. The suggested components are supported by linked
manufacturer specifications, not a comparative reliability or performance test.

## CI follow-through

Initial commit `e847d629adeb588754283d62d7e5c20802f8960b` passed all 107 tests on
Ubuntu. Windows ran 66 Python cases with three Linux-only skips but failed two
fixture-integrity checks: automatic CRLF conversion changed hash-bound source
bytes. The follow-up pins text checkout to LF and makes fixture generation write
explicit UTF-8/LF on either platform. It also checks oversized integer policy
values before floating-point conversion. The matrix is rerun for these fixes;
final results will be recorded here.
