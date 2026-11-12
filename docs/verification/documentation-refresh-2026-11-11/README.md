# Documentation reconciliation — November 11, 2026

This documentation pass starts from merged PR #110 commit
`cb91fa40d9d388faacca0785075c8b1986b33773`. Its complete tree
`3d25c1c73575e2f4e6dcd1f1cc926540c372dac5` matches final tested head
`13355e18fbac15553bc9092dbadb11bb1deab979`.
The [live-read CI snapshot](baseline-ci.json) records all four successful PR
workflows. The earlier [guided-experience verification](../guided-experience-2026-11-11/README.md)
keeps its local counts, initial failures and passing targeted resolutions.
Those application checks were not rerun merely to edit guides.

## What changed

- Entry guides now lead with the actual Monitor goals and System disclosure.
  Four byte-identical November 11 screenshots are published as a
  [separate provenance collection](../../media/guided-experience-2026-11-11/README.md);
  November 1 and PR #61 captures keep their dates and hashes.
- Guided source setup explicitly requires the PC DVR Companion or an
  analysis-enabled service. Preview-only Start does not provide the required
  library connection. Copy-only companion use requires no detector model.
- Architecture, pilot scope, hardware and status now distinguish delivered
  previews, two-camera live AI, one sampled LAN recorder and OEM copies from the
  unqualified 100-camera target. The direct analyzer's CPU default stays
  separate from the service's GPU preference and visible CPU fallback.
- Review guides explain cancellation, newer intent, preserved observations and
  explicit retries. Field/setup instructions use current task labels and keep
  device activation and native environment preparation explicit.
- Developer recipes identify build/native prerequisites, keep stdlib capacity
  checks scoped to that component, and pin Playwright separately rather than
  claiming it is in the application lockfile. Security guidance reflects the
  implemented geometry and bundled font.

## Coverage and preservation

The [documentation inventory](inventory.json) distinguishes changed canonical
guides, reviewed guides requiring no edit, generated Wiki pages, dated evidence,
fixtures and separately licensed vendor material. Historical receipts, original
media manifests and their image bytes remain unchanged. A page that is already
accurate is retained rather than rewritten to imply a new result.

The Wiki is a separate repository. Generated pages and referenced public media
are staged from an exact published source commit; source PR status and Wiki
publication status must be reported separately. No private runtime data belongs
in that write set. See [Wiki procedure](../../wiki/README.md).

## Validation

Run from the repository root, using the existing Python environment:

```bash
python3 scripts/build-wiki.py
python3 scripts/build-wiki.py --check
python3 scripts/build-guide-graphics.py --check
python3 scripts/check-docs.py
python3 -m unittest discover -s tests -p test_wiki_docs.py
git diff --check
```

The documentation validator checks local paths/anchors, dated media integrity,
new screenshot provenance/copy parity/budget, generated graphics and historical
receipt counts. Wiki tests check source pinning, media routing, separate-remote
validation, traversal/symlink rejection and preservation of unknown pages.
Final executed results are recorded in `validation.json` in this directory.
These are documentation checks, not new camera, GPU, accuracy or capacity tests.
