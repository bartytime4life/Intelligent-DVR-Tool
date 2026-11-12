# Fractional presence-rule boundaries — November 12, 2026

Ordinary fractional sample times could break a continuous presence run or delay
dwell. The Python engine and browser training counter now share a bounded
binary64 comparison. This record also closes the accompanying operator/developer
documentation audit. This is proposed source under review, separate from merged
main, installed services, published Wiki and physical-device acceptance.

The published base is `6ce57a5180655693f7d3d6d2e91d8c68693f1961`, tree
`fbc90736780b89e3ef6f736dd55d4e5f3992f15c`. Local timing checkpoint
`7df51f3` and readout checkpoint `747fb3c` were integrated as `7f92e70` before
the final documentation/test-harness corrections. Those checkpoints are context;
[source-manifest.json](source-manifest.json) binds the exact final files and
[documentation-inventory.json](documentation-inventory.json) binds the guides.

## Reproduced behavior

At 25 FPS, stride 5, maximum gap 0.2 seconds and dwell 1 second, 150 generated
matching samples previously produced no observation instead of one at 1 second.
Subtraction such as `0.8 - 0.6 = 0.20000000000000007` falsely exceeded the gap.
Other cases duplicated an observation or delayed dwell by a sample. The
[independent package](independent/README.md) preserves exact-rational expectations,
all failed baseline cases and unchanged checkers.

| Independent replay | Assertions | Baseline failures | Candidate failures |
| --- | ---: | ---: | ---: |
| Python event sample indices plus invalid-input/recovery checks | 1,597 | 822 | 0 |
| JavaScript observation counts on the same valid runs | 1,579 | 716 | 0 |

The corpus has 1,579 valid runs/54,614 samples and nine Python-only invalid-input
cases. Counts and sample indices are different API checks over shared generated
inputs, not independent recordings. The [root replay](root-replay.json) reproduces
all four archived receipts byte for byte, including strict exit 1 for both
baselines. No expectation was derived from the candidate.

## Numerical policy

The two implementations calculate the same left-associated sum:

```text
elapsed = now - then
roundoff = ((ulp(now) + ulp(then)) + ulp(boundary)) + ulp(elapsed)
```

They compare equal when exact equality holds, or when a positive boundary has
`abs(elapsed-boundary) <= roundoff` and `roundoff <= boundary * 2**-26`.
The latter guard is an explicit numerical-resolution policy, about half a
binary64 significand, rather than a physical-clock error bound. Zero, underflowed
caps and coarse clocks retain strict comparisons. Real gaps and under-dwell
samples outside that small budget preserve their original result. Timestamps are
not rounded to decimal places and no fixed time grace period is added.

The [Python floating-point guide](https://docs.python.org/3.12/tutorial/floatingpoint.html)
describes representation and operation rounding;
[`math.ulp`](https://docs.python.org/3.12/library/math.html#math.ulp)
defines the spacing used by the Python implementation. The bound and resolution
guard here are this project's derived policy. The independent package includes
an ambiguity example: different real gaps can round to identical coarse float
timestamps, so this API cannot reconstruct a physical history from those floats.

The fix changes neither detector scores, per-frame training find/flag definitions,
rule schemas, tracker arithmetic, nor controls. Live and recording observations
remain class presence, without identity or continuous visibility between samples.

## Normal generated CPU path and result compatibility

The new native test creates a temporary 60-frame, 25 FPS MJPG recording and a
constant-output ONNX fixture, then explicitly runs the normal analyzer on
`opencv-cpu` with stride 5, dwell 1 and gap 0.2. It checks one event at 1 second,
receipt/trace/review consistency, current-source fingerprint and evaluator
admission. Substituting the former rule-engine fingerprint is refused.
The unchanged test against the original source fails because its event list is
empty; the candidate passes. This executes generated CPU inference, not a trained
recognition model or physical camera. No model is downloaded.

The rule-engine source SHA changes from
`b6614c4a3a36e726beadbf5d444fbf8b78c5d40a844bc4ac77b468b6ea2a74fb` to
`6151670cdf8c9837c274150b51589e44043993fdb576b9706ba1ac21d39f10da`.
Browser counter SHA changes from
`c94a042c9c739cf2d4aadb2c97144d820af09f1ae137c0ca75bdb9199f072e59` to
`cd1979b16c575611aa13cdbeeb3832f86094e5998e8acd4de2f16b406cfbfbdd`.
The [independent manifest](independent/manifest.json) binds captured sources.
Earlier results remain historical review material; current detection/tracking
evaluation requires re-analysis into new outputs. Never relabel an old trace hash.

The current synthetic evaluation fixture was regenerated with its existing
generator into a fresh directory. Only the trace's rule-engine hash and dependent
review trace hashes changed; detections, times, event IDs and expected metrics
are byte-equivalent. [Fixture differences](fixture-refresh.json) are recorded.
Historical evidence was not regenerated.

## Verification and documentation

The original focused baseline has seven failed assertions in eight tests.
The candidate passes those eight and the optional generated native integration
test: nine tests, zero skips in the pinned Linux CPU environment. The first broad
Python run retained one failure and one error because its current fixture still
bound the former rule-engine source; the reviewed refresh above resolves both.
The first Node run passed 682 and explicitly skipped two opt-in socket cases.
[Log provenance](log-provenance.json) retains these runs and the strict native
baseline failure. [Combined validation](validation.json) keeps subsequent runs
separate from them.

The latest parent `6ce57a5` hosted CI has successful cross-platform, PC-kit and
Mac workflows. Its browser workflow passed 258 cases and failed one transient
pending-status assertion; subsequent native browser steps were skipped. The
[original CI excerpt](parent-browser-ci-excerpt.log) is retained. A new local
passing run cannot relabel that parent workflow as successful.

The coverage test now holds real worker requests until explicitly released,
checks the queued camera bearing and removes requests on termination. It retains
pending-state, stale-number, overlay, supersession and navigation assertions.
No application geometry is faked and no loading assertion depends on a timer.

The broad local general-browser run passed 262 cases and failed one map-draft
navigation case, with zero skips. Its [original failure context](map-draft-initial-error.txt)
and [screenshot](map-draft-initial-failure.png) are retained. Three unchanged
focused executions on both the original parent and candidate each produced one
pass/two failures. Trace inspection showed the child draft notice disappearing
while the parent's Saved facility control was still disabled; the next task
selection therefore correctly encountered the still-active parent guard.
The test now observes that control becoming enabled, as the file's earlier case
already did, before its unchanged strict navigation assertion. This is a
test-readiness correction, with no application-source change. The corrected case
passes all three parent executions. Results for the candidate's entire corrected
map-draft file are also passing: all seven cases repeated three times, 21 passes
and zero skips. Repetitions are not independent scenes. Together these runs cover
263 distinct general scenarios, but the initial full run must not be described
as a clean 263-case pass. [Captured run statistics](validation.json) and compressed
reports retain each result separately.

| Combined-source check | Result |
| --- | --- |
| Build and Sites packaging | Pass; existing large-chunk warning retained |
| Socket-enabled Node suite | 692 passed, zero failed/skipped |
| Pinned Linux CPU Python suite after reviewed fixture refresh | 579 passed, zero failed/skipped |
| Sites tests | 4 passed, zero failed/skipped |
| General browser run | 262 passed, one map-draft readiness assertion failed, zero skips |
| Corrected map-draft file | 21 passes over seven cases repeated three times, zero skips |
| Corrected map case on unchanged parent | 3 passed, zero failed/skipped |
| Independent rule-time receipts | All four reproduce byte-identically; both baseline strict failures retained |
| Readout package | 57 artifacts/24 sources/eight unchanged model files verified; portable replay passes |

Canonical guides now explain observation timing, trace compatibility and visible
recovery. Generated Wiki source follows those guides; it does not publish the
separate GitHub Wiki. The adjacent [planning-readout record](../planning-readouts-2026-11-12/README.md)
covers small positive resource/geometry values and honest coverage endpoints.
The audit covers every public Markdown/reStructuredText path, with separate
current-guide, generated-Wiki and dated-evidence entries. Unaffected setup,
security, licensing and field-acceptance material was checked and retained.
The final inventory, documentation/graphics checks and generated Wiki counts are
recorded in [validation.json](validation.json). [Preservation](preservation.json)
confirms 618 earlier evidence/media/protected files unchanged from the published
base, including all nine protected runtime/hosting files. The separate
[remote readback](remote-state.json) retains main and draft PR identity and parent
workflow results.
Earlier screenshots, receipts and protected runtime/hosting sources remain
unchanged. Installation, field clocks, variable-rate recording timing, real
recognition quality, GPU execution and sustained 100-camera acceptance require
their own evidence.

## Reproduce

Use Node.js 22 and a project-supported Python. The independent package needs
only standard libraries; the native integration requires the existing pinned
CPU fixture dependencies. From the repository root:

```bash
python3 -B docs/verification/rule-time-boundaries-2026-11-12/independent/verify_artifacts.py --check-current-source
node --test tests/training.test.mjs
python -m unittest discover -s tests -p 'test_rule_time_boundaries.py'
python -m unittest discover -s tests -p 'test_evaluation.py'
python3 -B docs/verification/rule-time-boundaries-2026-11-12/verify-record.py --check-current
```

Follow the independent README to replay both strict failures and candidate
passes. Use the [development guide](../../development.md) for build-before-test,
socket-enabled suites, browser fixtures and documentation checks.
The read-only verifier checks [artifact hashes](artifact-manifest.json); with
`--check-current` it also checks current source, documentation and preserved
files. Omit that flag to verify this historical package after source changes.
These unsigned hashes establish byte consistency, not authenticity or physical
qualification.
