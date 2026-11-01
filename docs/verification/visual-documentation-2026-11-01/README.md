# Visual documentation refresh — November 1, 2026

[Verification index](../README.md) · [Visual handbook](../../how-to.md) · [Asset provenance](../../media/guide/README.md) · [Coverage audit](coverage.json)

The application source baseline is merged PR #71, `2566d845fbbc7b9f54f98441009a604f2fa513ce`.
This change updates documentation, public visual assets, documentation tools and
their publication tests. It changes no application source, native inference,
models, private runtime data, stored plans or enrollment templates.

## What was reconciled

- Every top-level canonical guide has a Wiki companion. Active task guides gain
  a relevant workflow graphic and a short entry path; dated reports retain their
  stated findings and source revision with a link to the present guide.
- README and the documentation index route readers by outcome. The handbook
  covers Monitor, Recognition, Train, Facility, Events, Zones and System.
- Status now includes merged facility editing in PR #70 and repeatable Mac setup
  in PR #71, with exact earlier CI links. It no longer labels those changes as
  unpublished or claims there is no Mac installation CI.
- The atlas and guides use twelve actual captures from a clean local browser,
  ten deterministic SVG workflow illustrations and one conceptual ImageGen hero.
  The [manifest](../../media/guide/manifest.json) binds their bytes and dimensions.
- Wiki staging keeps the existing separate Git history, unknown pages and assets.
  It copies only referenced public documentation images and pins canonical file
  links to a chosen source commit. Publishing is a separate explicit Git action.

## Local verification

[Documentation check log](checks.log) records complete Markdown link/heading
checks, historical/new media integrity and budgets, deterministic SVG generation,
Wiki mirror drift and seven publication-boundary tests. The tests exercise wrong
repositories, private media, symlinks/traversal, read-only checking, preserved
unknown pages, complete guide mapping and rewritten links/source references.

The unchanged frontend also built successfully before capture. The new diagrams
were visually inspected in the browser, and captures were checked against the
controls pictured. This is documentation validation, not an exhaustive application
regression run. Existing CI runs the broader application suites for the PR.

## Capture limits

The user's normal DVR service and private data were kept separate. A disposable
loopback service used a generated 30-frame flat-color recording and a synthetic
constant-output ONNX model. The fixture produced six sampled boxes and one
observation; no person appears in the clip. Events and Zones use the same explicit
example. Facility uses an opt-in fictional built-in plan with external maps off.
Train stops before any real camera connection or enrollment consent/capture.

The screenshot revision identifies what rendered, not recognition accuracy.
System numbers are editable estimates. The original PR #61 and October 27 media
hashes and dated verification records remain intact. Physical devices, consented
biometric quality, sustained operation and 100-camera capacity stay unqualified.

## Publication record

Repository and Wiki commits have separate histories. The actual Wiki's published
commit can be checked through its normal Git history; it is not inferred from
these generated mirrors or from a green repository CI status. The coverage audit
lists the complete canonical-to-Wiki map for reproduction.
