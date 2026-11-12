# Independent rule-time oracle

The unchanged exact-rational corpus exposes missed and duplicate class-presence
observations at ordinary fractional sampling intervals. It passes on the captured
Python rule engine and browser training counter after the bounded numerical fix.
All data are generated timestamps and known normalized detections. No footage,
models, cameras or inference were used.

| Replay | Cases | Samples | Assertions | Failures | Strict exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline Python event sample indices | 1,579 runs + 9 invalid-input cases | 54,614 | 1,597 | 822 | 1 |
| Candidate Python event sample indices | Same | Same | 1,597 | 0 | 0 |
| Baseline JavaScript observation counts | Same 1,579 valid runs | Same | 1,579 | 716 | 1 |
| Candidate JavaScript observation counts | Same | Same | 1,579 | 0 | 0 |

Python checks the sample index at which each event appears. JavaScript's public
`countObservations` API supplies only a count; it cannot expose every late event
that Python detects. Their failure totals therefore differ. The nine invalid-time
cases are Python-only and each checks rejection plus unchanged state on recovery.
These totals are distinct checks over the same corpus, not independent footage.

## Source and input binding

The baseline was captured at local revision
`9e88a57b377ca53a991519cae9bdbbcf25cb7924`, whose tree matched published
`6ce57a5180655693f7d3d6d2e91d8c68693f1961` before this fix. Candidate receipts
bind the exact source files, rather than an eventual publication revision:

| File | Baseline SHA-256 | Candidate SHA-256 |
| --- | --- | --- |
| `edge/rules.py` | `b6614c4a3a36e726beadbf5d444fbf8b78c5d40a844bc4ac77b468b6ea2a74fb` | `6151670cdf8c9837c274150b51589e44043993fdb576b9706ba1ac21d39f10da` |
| `src/training.mjs` | `c94a042c9c739cf2d4aadb2c97144d820af09f1ae137c0ca75bdb9199f072e59` | `cd1979b16c575611aa13cdbeeb3832f86094e5998e8acd4de2f16b406cfbfbdd` |

[The manifest](manifest.json) binds every packaged file, compressed and original
input bytes, checker bytes, and captured sources. The original decompressed
[corpus](inputs.json.gz) SHA-256 is
`fb6910432ee1e83a8a87a2aa971b3b51a16017f8fa2fa18c9722014ff2104a9b`.
It was frozen before the prototype and application implementations. The Python
checker remains byte-identical to its first strict baseline run:
`10dc76adb8a5a36bc3a08d144444ea10aa400220b96a48b6cef836d4baf40272`.

The supplemental [JavaScript transport](js-adapter-inputs.json.gz) copies the same
case IDs and expected event counts. Python's `float(Fraction)` converts timestamps
to correctly rounded binary64 before JSON serialization. This avoids overflowing
the denominator when transporting subnormal cases into JavaScript. The adapter
checks original input identity and expected counts before running the counter.
No expected count is recomputed from the candidate. Its decompressed SHA-256 is
`8c90905f099e3fc74c7c3eb8773976687addb6cd5d7bd799256d6f20e6c14d8d`.

## What is checked

[The independent generator](freeze_inputs.py) calculates event sample indices with
Python `Fraction`, before timestamp conversion. It implements the stated rule
contract: qualifying detections at most `max_gap` apart form one run, and dwell
emits once when the exact elapsed time reaches the boundary. It does not import
the application, its comparator, or candidate results.

The corpus includes terminating-decimal cadences from integer FPS and strides,
empty prefixes, brief misses, genuine run breaks, decimal clocks, late valid
frame indices, zero dwell, exact dyadic and subnormal intervals. Separate near
boundary cases are deliberately 0.000001 seconds above and below the limit,
more than 10,000 endpoint ULPs away in those cases. They must retain their genuine
over/under result. Coarse-clock stress uses the exact supplied finite float values
as rationals and checks that very large gaps are not forgiven. Invalid timestamps
include repeated/decreasing values, negatives, nonfinite values and wrong types.

The original [three counterexamples](initial-counterexamples.json) remain separate:

- 25 FPS, stride 5, gap 0.2, dwell 1: no event across 150 samples instead of one
  at 1 second; 54 false resets.
- 10 FPS, stride 1, gap 0.1, dwell 0.5: no event across 100 samples instead of one
  at 0.5 seconds; 44 false resets.
- 25 FPS, stride 5, gap 0.2, dwell 0.4: events at 0.4 and 1.4 seconds instead of
  one event; seven false resets across 20 samples.

For example, subtraction gives `0.8 - 0.6 = 0.20000000000000007`, which previously
split the admitted 0.2-second cadence.

## Numerical policy and limits

For a nearest-rounded binary64 value, half an ULP bounds representation error.
The difference of two rounded timestamps adds the endpoint errors and the
subtraction's rounding error. A rounded decimal rule boundary adds another term.
The implementation uses the conservative full-ULP sum

```text
elapsed = now - then
roundoff = ((ulp(now) + ulp(then)) + ulp(boundary)) + ulp(elapsed)
```

It coalesces a comparison to equality only when the boundary is positive, the
absolute comparison difference is at most `roundoff`, and
`roundoff <= boundary * 2**-26`. Python and JavaScript use the same left-associated
operations. Full ULPs also leave slack for rounding the positive sum. This is a
bounded numerical policy: a forgiven difference is at most about 1.49e-8 of the
configured interval. The half-significand resolution guard is an explicit policy
choice, not a theorem establishing clock accuracy. Exact equality still compares
equal. Zero boundaries and underresolved clocks retain strict comparisons.
There is no fixed millisecond grace period or decimal rounding of timestamps.

The corpus also preserves an unavoidable ambiguity diagnostic. At `2**54`, the
real pairs `(2**54 + 1.9, 2**54 + 2.1)` and `(2**54, 2**54 + 4)` round to the
same pair of binary64 timestamps. Their real gaps are respectively 0.2 and
4 seconds. A float-only API cannot recover which clock history occurred. This
diagnostic is not a physical-clock pass/fail assertion; the coarse-clock tests
require the documented strict fallback. Transporting exact frame indices and FPS
would be a separate future contract, not a capability of this fix.

These checks do not establish actual clock uncertainty, variable-frame-rate
presentation timing, observation accuracy, object identity, continuous visual
coverage, physical-camera acceptance or capacity. Existing constant-FPS report
limits and rule-engine source fingerprints remain relevant.

## Replay

Run from the repository root with Python 3.9+ and a project-supported Node version.
Only standard libraries are used; these checks do not install dependencies or
start the application. Outputs go to a temporary directory.

```bash
rule_time_evidence=docs/verification/rule-time-boundaries-2026-11-12/independent
rule_time_replay_dir=$(mktemp -d)
python3 -B "$rule_time_evidence/verify_artifacts.py" --check-current-source
python3 -B "$rule_time_evidence/check_rule_times.py" \
  --rules edge/rules.py --output "$rule_time_replay_dir/candidate-python.json" --require-pass
node "$rule_time_evidence/check_training_count.mjs" \
  --training src/training.mjs --output "$rule_time_replay_dir/candidate-js.json" --require-pass
```

Both candidate commands must exit 0 on the captured source hashes. If the
application source has subsequently changed, the archived
[candidate Python](candidate-rules.py) and [candidate JavaScript](candidate-training.mjs)
snapshots can replay this historical record instead. The verifier without
`--check-current-source` checks only the archived package.

Replay the original failures with the unchanged checkers. Each command below is
expected to write its receipt and **exit 1** because `--require-pass` is enabled;
run them separately if your shell stops on failure.

```bash
python3 -B "$rule_time_evidence/check_rule_times.py" \
  --rules "$rule_time_evidence/baseline-rules.py" \
  --output "$rule_time_replay_dir/baseline-python.json" --require-pass
node "$rule_time_evidence/check_training_count.mjs" \
  --training "$rule_time_evidence/baseline-training.mjs" \
  --output "$rule_time_replay_dir/baseline-js.json" --require-pass
```

The stored receipts are [baseline Python](baseline-receipt.json.gz),
[baseline JavaScript](baseline-js-receipt.json.gz),
[candidate Python](candidate-python-receipt.json) and
[candidate JavaScript](candidate-js-receipt.json). Every failed baseline case is
retained. Receipt JSON can be compared byte for byte after decompressing the
stored baseline receipts; the checkers include no clock readings or local paths.

To regenerate the exact input bytes, copy the generator into the temporary
directory so it cannot overwrite the evidence. Then regenerate the JavaScript
transport from those same bytes:

```bash
cp "$rule_time_evidence/freeze_inputs.py" "$rule_time_replay_dir/freeze_inputs.py"
python3 -B "$rule_time_replay_dir/freeze_inputs.py"
cmp "$rule_time_replay_dir/inputs.json.gz" "$rule_time_evidence/inputs.json.gz"
python3 -B "$rule_time_evidence/build_js_adapter_inputs.py" \
  --inputs "$rule_time_replay_dir/inputs.json.gz" \
  --output "$rule_time_replay_dir/js-adapter-inputs.json.gz"
cmp "$rule_time_replay_dir/js-adapter-inputs.json.gz" "$rule_time_evidence/js-adapter-inputs.json.gz"
```
