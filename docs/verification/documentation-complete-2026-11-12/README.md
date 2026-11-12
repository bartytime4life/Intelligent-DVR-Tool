# Complete documentation follow-up — November 12, 2026

This pass documents merged source `cd6d15666beb55a9641068398d82a3d02eaa7769`
([PR #112](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/112)). Its tree
`660af95b0d8607b4f881f24c2b67d0c41a7d1655` matches tested head `ba735298`.
The [CI snapshot](baseline-ci.json) records three successful workflows and the
still-running browser workflow at the stated UTC read time. The algorithm
[local verification](../science-math-2026-11-11/README.md) and earlier
[documentation reconciliation](../documentation-refresh-2026-11-11/README.md)
keep their original counts, source identities and scope.

## Corrected operating and development instructions

- PC updates now preserve the complete default private `local-analysis/`,
  separate backup settings, source/recorder configuration and the OEM copy tree.
  They distinguish browser exports and Linux last-job recovery from those files.
- Manual source setup checks for an existing `local-feeds.json` before creating
  one. Copy-only/preview use needs no model. Linux already supports explicit
  foreground single-channel recording; no background service is installed.
- CPU memory policy distinguishes 3 GiB live AI from 4 GiB recorded analysis on
  Linux/Windows and the absence of a Mac memory cap. Service control limits
  include the 8 KiB library-configuration exception, and enabled API families
  share the per-service token.
- Current status, roadmap and edge CLI name the merged v3 algorithm. Troubleshooting
  covers exact empirical cutoffs, old tracking traces, saved-evidence regressions,
  library errors and assistant recovery. No pending route/evaluation patch is
  described as merged behavior.
- Architecture and security explain browser-to-local-Ollama summaries, checked
  answers, distinct Lab receipts and separately controlled runtime behavior.
  Model-reported residency and assistant response timings are not detector proof.
- [Development](../../development.md) and [contribution](../../../CONTRIBUTING.md)
  guides index source/contracts, prepared environments, build prerequisites,
  socket opt-in, browser suites, documentation checks and evidence reporting.

## Coverage and retained history

The [inventory](inventory.json) lists repository Markdown paths and SHA-256s at
this documentation revision. Categories distinguish canonical guides, generated
Wiki companions, dated evidence/media, project instructions, fixtures and vendor
material. An unchanged page is retained; its inventory presence is not a claim of
a new runtime test. Local path/anchor validation covers retained guides too.
This verification directory is excluded from its own hash inventory to avoid
self-references.

Historical receipt/log bytes, screenshot/media bytes, private runtime files,
application sources, dependency pins and protected hosting/runtime files are
unchanged. The only edited executable source is the Wiki generator’s page and
navigation mapping for the two new guides. Source documentation and generated
companions are reviewable together; no application behavior is changed here.

Two independent read-only reviews checked the operator corrections and developer
instructions against the source. They did not run cameras, models or inference.
The pending route-coverage and evaluation-input worktrees remain preserved
separately and are outside this merged baseline.

## Validation and Wiki staging

Executed documentation results and preservation checks are recorded in
[validation.json](validation.json). Reproduce them from the repository root:

```bash
python3 scripts/build-guide-graphics.py --check
python3 scripts/build-wiki.py
python3 scripts/build-wiki.py --check
python3 scripts/check-docs.py
python3 -m unittest discover -s tests -p test_wiki_docs.py
git diff --check
```

The application build and full native/browser suites are not rerun for prose and
Wiki-navigation changes. Their source-bound evidence remains in the algorithm
record and CI snapshot above. Documentation checks are not installed-machine,
camera, CUDA, recognition-quality or capacity qualification.

Generated Wiki pages are source artifacts. The Wiki has a separate repository;
[publication instructions](../../wiki/README.md) require a published source SHA,
reviewed public assets and a separate commit/readback. Updating these files alone
does not establish published Wiki state.
