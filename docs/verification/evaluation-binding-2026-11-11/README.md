# Evaluation input binding — November 11, 2026

This generated regression record compares the historical main baseline
`c517b438789efbe81d410f23f2a0a173ed72c86c` with the corrected evaluator. It tests
metadata-only input replacement, not detection quality, physical cameras, model
execution or capacity. The original [November 11 proof](proof.json) binds the
baseline and candidate evaluator source hashes and remains unchanged. No
recordings, pixels, weights, credentials or private labels are used by that proof.

On November 12, the preserved patch was merged locally with main
`cd6d15666beb55a9641068398d82a3d02eaa7769` at integration checkpoint
`b8fce70c558feec08ab13d6867996e13189b67e9`. There were no conflicts; the shared
tracking guide merged automatically. The evaluator and its tests did not change.
The [integrated validation receipt](integrated-validation.json) binds that source
checkpoint, records a byte-identical proof replay and reports the build and
native test results separately from the historical baseline.

## Confirmed defect and correction

The baseline parsed JSON and hashed its path in separate operations. A valid
replacement between them could bind a report to different bytes from the ones
evaluated. The [reproducer](reproduce.py) loads that public baseline from Git in a
temporary directory and injects replacements at those boundaries.

| Input replaced | Baseline outcome | Corrected outcome |
| --- | --- | --- |
| Manifest | Original annotations scored, replacement manifest hash reported | Captured annotations and their own hash remain paired |
| Trace | Replacement detections scored, original trace hash reported | Captured detections and their own hash remain paired |
| Labels | Correct captured labels rejected against a later replacement's hash | Captured label bytes bind trace validation and report |
| Reviews | Original decisions counted, replacement review hash reported | Captured decisions and their own hash remain paired |

[The JSON reader](../../../edge/evaluation.py) now parses and hashes one bounded
UTF-8 capture. It reads at most the configured limit plus one byte and rejects
oversized input before parsing, including a stream that grows after a size
inspection. Existing duplicate-key, nonfinite-number and path/symlink refusals
remain. UTF-16/32 input is not silently accepted.

Reports identify captured JSON snapshots in `input_binding`; they do not promise
that a path still contains those bytes afterward or store a copy of the inputs.
Keep the original bytes for reproduction. Source media retains a streamed
SHA-256 check at validation without a media copy or decode. A generated source
changed before that check remains rejected.

[Tracking evaluation](../../../edge/tracking_evaluation.py) captures its manifest
and trace JSON again and compares those exact second-stage hashes with shared
detection validation. Changes between stages fail. Changes after the second
capture cannot replace its parsed data or its reported hash.

## Reproduce

Use an existing Python environment with the project's tracking qualification
dependencies for the tracking tests; no installation or inference is part of
this record. From the repository root:

```bash
python -m unittest discover -s tests -p test_evaluation.py
python -m unittest discover -s tests -p test_tracking_evaluation.py
python docs/verification/evaluation-binding-2026-11-11/reproduce.py \
  --output /tmp/new-dvr-input-binding-proof.json
git diff --check
```

The proof output must be new. The baseline Git object must be available locally.
Temporary generated inputs and the baseline module are removed on completion.
The checked-in proof was produced by that command against the original candidate.
The integrated source reproduced exactly the same proof bytes. Its main revision
is the integration base above, not the historical baseline used to reproduce the
defect.

Executed checks: **30 detection/parser tests and 23 tracking tests passed**.
They include all four JSON replacement cases, exact UTF-8/CRLF byte hashes,
actual bounded reads, changed-source rejection, cross-stage tracking refusals and
post-capture tracking replacements. The proof also verifies that the five
protected runtime sources are byte-identical to the baseline. Existing CLI
tests retain exclusive output creation and leave inputs unchanged.

The November 12 integration also passed `npm run build`, followed by
`python -m unittest discover -s tests -p 'test_*.py'`: **567 discovered cases,
554 passed and 13 skipped**.
All 13 skips were generated loopback checks requiring `DVR_TEST_SOCKETS=1`.
Running precisely those 13 cases with that opt-in passed with no skips; the
receipt lists their names and original skip reasons. All 567 discovered native
cases therefore executed successfully across the full run and this separate
rerun. The 53 targeted tests passed separately. Tests used the existing isolated
Python 3.12.3 environment and the existing Node dependencies with a matching lockfile;
no packages were installed. The build retained its large-chunk advisory. These
checks use generated fixtures, including generated media in the full native
suite; they do not exercise private footage or physical cameras.

The local source integration and generated checks do not establish publication,
an installed-service change, execution of the pinned production detector,
recognition quality or field acceptance.
