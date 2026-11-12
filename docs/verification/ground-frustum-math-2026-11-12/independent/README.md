# Independent ground-frustum evidence

This is generated mathematical evidence for the ideal pinhole ground-visibility change. It preserves the original failing baselines, immutable inputs and strict checkers. It includes a separate assessment of the declared 256-sided range approximation; the raw ideal-circle gate remains failing on its two recorded boundary points.

See [results.json](results.json) for the final executed source hashes, check counts, retained receipts and limits. The [derivation](derivation.md) explains the model and independent reference methods. [bundle-manifest.json](bundle-manifest.json) binds every packaged artifact, including compressed and decoded bytes. No real camera, model, recording, optical calibration, hardware capacity or field performance is qualified by this record.

## Run from a fresh clone

Use the source checkout at the revision under review, Python 3.10 or newer, Node.js/npm and its pinned dependencies (`npm ci`). These checks run generated geometry only. They do not start the application server, cameras, recording or inference.

From the checkout root:

```sh
FRUSTUM_EVIDENCE=docs/verification/ground-frustum-math-2026-11-12/independent
python3 "$FRUSTUM_EVIDENCE/replay.py" verify
```

Choose a new output path for each command. The adapter writes exclusively beneath that path, expands compressed data there, and runs the unchanged original checker with its strict gate.

```sh
python3 "$FRUSTUM_EVIDENCE/replay.py" baseline31 --repo . --out /tmp/dvr-frustum-baseline31
python3 "$FRUSTUM_EVIDENCE/replay.py" candidate31 --repo . --out /tmp/dvr-frustum-candidate31
python3 "$FRUSTUM_EVIDENCE/replay.py" baseline42 --repo . --out /tmp/dvr-frustum-baseline42
python3 "$FRUSTUM_EVIDENCE/replay.py" candidate42 --repo . --out /tmp/dvr-frustum-candidate42
python3 "$FRUSTUM_EVIDENCE/replay.py" consumers42 --repo . --source-snapshot /tmp/dvr-frustum-candidate42/result/snapshot --out /tmp/dvr-frustum-consumers42
python3 "$FRUSTUM_EVIDENCE/replay.py" oracle42 --out /tmp/dvr-frustum-oracle42
```

Expected strict exits on the recorded candidate are:

| Command | Exit | Meaning |
| --- | ---: | --- |
| `baseline31` | 1 | Original radial fan disagrees with the frozen ideal projections. |
| `candidate31` | 1 | Two raw exact-circle boundary disagreements remain; no ideal expectation was removed. |
| `baseline42` | 1 | Original radial/wall model fails the frozen wall comparisons. |
| `candidate42` | 0 | The separate polygon/wall contract passes the independent area, geometry, topology and point checks. |
| `consumers42` | 0 | Actual snapshot, zone/overlap, route-gap and unavailable-result consumers pass. |
| `oracle42` | 0 | Independent ray/face and projected-mask references agree and regenerate the unchanged expected bytes. |

Each ordinary run writes its full strict receipt at `result/receipt.json`, observations beside it and a source/dependency snapshot under `result/snapshot`. `oracle42` instead writes its regenerated expected values and receipt beneath `harness`. The adapter's `replay.json` records the original checker hash, adapter hash, transport, receipt hash and observed strict exit. It does not turn an expected failing gate into success. New source bytes require a new result; the recorded candidate result does not transfer automatically. A checker’s `sourceRevision` is checkout HEAD context; executed file hashes also bind any uncommitted candidate changes and are the decisive source identity for these local runs.

## What is frozen

- [31-plan inputs](data/inputs31.json.gz) and [ideal expectations](data/expected31.json.gz) retain the original valid ordinary, horizontal, nadir-crossing and supported-extreme cases, including rotations/translations.
- [42 wall-scene inputs](data/inputs42.json.gz), [expected values](data/expected42.json.gz) and [reference receipt](data/expected42-receipt.json) are separate. They include 38,196 point queries. Eleven scenes construct valid facility building plans; short/open/thin-face scenes are explicitly labeled pure wall-face inputs, not valid standalone building footprints.
- Original checker and runner bytes are under `frozen/ideal31` and `frozen/walls42`. The arithmetic helpers use only the Python standard library. Mathematical checker hashes are distinct from the [packaging adapter](replay.py) hash.
- `retained` contains full baseline failures and observations, final candidate receipts and observations, and explicitly named earlier candidate records. The earlier 670a sensor-edge observation and c2f8 follow-up remain historical evidence; current bindings are in `results.json`.
- [preparation.tar.gz](preparation.tar.gz) retains the superseded oracle/fixture preparation and earlier review, with an index explaining each correction. These records are not the current candidate result.
- [baseline-source.tar.gz](baseline-source.tar.gz) contains only the public files actually bound by the original baseline receipt: six source modules and their public runtime package files. [Its manifest](baseline-source-manifest.json) checks every file. It is not a repository/history archive.

All gzip artifacts use an empty filename and modification time zero. Their decoded SHA256 values are recorded in the bundle manifest. Original JSON is compressed without reserializing or changing expectations. The frozen `fraction_arrangement.py` helper is stored as [fraction_arrangement.py.gz](frozen/walls42/fraction_arrangement.py.gz); the adapter expands it to the original `.py` bytes before execution. This packaging-only change preserves its original trailing whitespace and SHA256 `e78a1d84a536d51b957eb6b8cf2370fa1d9fb9b4d0c4a769674eba2af9b90cf6` without rewriting mathematical code.

## Source transport adapter

The original baselines used local Git labels that need not exist in a fresh clone. The separate adapter replaces only that transport: baseline source requests read the packaged, hash-verified public snapshot instead of `git show`, and the baseline metadata read returns the snapshot's recorded revision label. It verifies every returned source byte against the retained source manifest. Current candidate source and Git identity are read from the supplied checkout normally.

No mathematical code is patched. No input, expected result, tolerance, boundary eligibility rule or strict exit condition changes. The unchanged checker still computes and records its own hash, executed source hashes, data hashes and every failed assertion. Packaging and original mathematical identities are both retained so the transport step is reviewable.

## Interpretation limits

The source model is a centred rectilinear pinhole camera over level ground, modeled opaque vertical wall faces and the explicit facade-mount clearance policy. Lens distortion, terrain, optical focus, furniture, moving occlusion, measured mounts and physical camera calibration remain outside this evidence.

Range is a horizontal radius. The output uses an inscribed 256-gon with radial chord bound `R * (1 - cos(pi/256))`. The raw ideal-view corpus includes two points exactly on the true range circle that this polygon excludes. Those strict failures remain visible. Scalar integration can be exact for the supplied polygons while the polygons still approximate the ideal circle.

Closed regularized polygon boundaries and exact closed-face line-of-sight can disagree on measure-zero wall/shadow boundaries. The wall corpus's boundary exclusions were determined by the independent reference before executing the candidate, never by a candidate discrepancy. Maximum observed errors are finite-corpus measurements, not universal numerical error guarantees.

Primary camera-model basis: [official OpenCV projection documentation](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html). The ground and wall constructions here are independently derived from that model. Synthetic checks do not establish recognition accuracy, physical visibility, 100-camera capacity, installed behavior or user-study success.
