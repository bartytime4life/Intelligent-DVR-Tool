# Offline qualification and local evidence checklist

[Current visual atlas](visual-atlas.md) · [Product status](product-status.md) · [Provenance](media/current/README.md)

![Input provenance and storage boundaries for offline qualification.](media/current/data-boundary.svg)

*A local evidence collector does not certify inference quality or authenticity.*

This workflow works with explicit local files. It does not depend on a browser,
an Ollama portal, camera credentials, paid services or access to another machine.
It does not run inference, inventoried source files, tests or network requests. The collector
uses fixed read-only Git metadata commands when Git is available.

[Product status](product-status.md) · [Evaluation](offline-evaluation.md) ·
[100-camera plan](performance-100-cameras.md)

## 1. Preserve the local source and test evidence

Use the Python environment from the [Linux](setup-linux.md) or
[Windows](setup-windows.md) setup guide. From the actual project worktree:

```bash
python -m edge.qualification collect --project . --output local-evidence.json
```

To include existing test logs or JSON receipts, add one `--artifact` per relative
path inside that project. These must be files that already exist; the collector
does not execute commands from them:

```bash
python -m edge.qualification collect --project . --artifact qa-local/python-tests.log --output local-evidence-with-tests.json
```

Use a new output name every time. The bundle records:

- SHA-256, Git blob hash, relative name and byte count for selected source files.
- Git commit and clean/dirty/unknown state, plus installed package versions.
- Hashes of explicitly selected artifacts and separate recognized unittest/TAP
  summaries, retaining failures, skips, cancellations and TODOs.
- Omitted source files and partial inventory state.

Default source roots are `src`, `edge`, `tests`, `scripts`, `docs` and `.github`,
plus selected root documentation/package files. Hidden files, model/recording
folders, dependencies, build output and binary media are excluded. Symlinks are
not followed. At most 4,000 source files/directories, 8 MiB per source file,
64 MiB total source bytes, and 16 explicit artifacts of 1 MiB each are accepted.
An unreadable, changing, linked or oversized source makes collection partial.

No source/log contents, Git remotes, absolute project path, host or user name are
included. Relative filenames and hashes may still describe private work. Keep
these bundles local and out of Git until reviewed; there is no automatic upload.
Unrecognized logs keep their file hash but have no inferred test total.

**A log is an unsigned claim.** Matching hashes or a clean worktree do not prove
that a log was produced from that source, or that a claimed test actually ran.
Record the exact test command, source revision and environment when running
future tests; keep each job's log separate.

## 2. Check for later changes

```bash
python -m edge.qualification verify --project . --bundle local-evidence-with-tests.json --output local-evidence-verification.json
```

This compares listed source/artifact bytes with their recorded hashes. Changed,
missing, linked or unreadable files produce `state: mismatch`. It does not
discover newly added files or certify log authenticity; collect a fresh inventory
after changes. A source record marked dirty stays attributable to its file
inventory, not to an assumption that HEAD contains those edits.

When reconciling the separately reported local AI work, locate its actual adapter,
runner, studies, profile/dependency records and original test logs. Compare their
file hashes and diffs with the intended Git commit. Do not infer that code exists
from a remembered filename or promote an earlier test count to current evidence.

## 3. Agree the qualification workload

Copy [qualification-plan.example.json](../edge/qualification-plan.example.json)
to a local planning file. Its nulls and false declarations are intentional:
codec, resolution/source FPS, analytics cadence, delay/drop limits, recording,
retention, test duration, host/worker budget, model classes and quality thresholds
need explicit decisions. `gpu_label` can explicitly say `CPU-only`. Model classes
must come from the selected compatible model, not sample UI categories.

```bash
python -m edge.qualification plan --plan edge/qualification-plan.example.json --output qualification-preflight.json
```

The unfilled example produces `state: blocked` and a list of missing decisions.
It exits with code **3**, which is an expected blocked result, not a completed
qualification. Exit **2** means invalid input or an existing output path. Exit
**0** means collection/verification succeeded within scope, or a completed plan
is `ready-for-offline-trial`. Every report retains unqualified operational claims.

Plan fields are declarations, including permission/review/workload acceptance.
The tool does not grant permissions or authenticate those declarations.
Completing the form does not execute or pass a benchmark.

## 4. Collect the measurements

1. Use approved recordings, independently reviewed labels and held-out scenes.
   Follow the existing [offline evaluation guide](offline-evaluation.md).
2. Record per-class precision/recall and reviewed false alerts with complete
   coverage. Keep model/profile/source/rule hashes and undefined metrics explicit.
3. Measure the intended host through 1/5/25/50/100+ sources, retaining each
   source's analytics cadence, drops/staleness, delay, resources and duration.
   Virtual-time scheduler examples and sequential recordings are not this test.
4. Test recording continuity, retention and recovery when recording is required.
   Keep these distinct from analytics drops and visible browser tiles.
5. Perform separate physical-camera and operational acceptance before claiming
   live support. No step here activates cameras, learns weights or changes
   operational thresholds.

The collector/preflight is preparation for these gates. It does not measure
representative accuracy, GPU performance or 100-camera operating capacity.
