# Verification index

Reviewed October 28, 2026. [Product status](../product-status.md) · [Home](../../README.md)

## Latest audited application baseline

The merged PR #11 revision is
[`82c862c68735720b8840461fc624e8dbe148a53a`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/82c862c68735720b8840461fc624e8dbe148a53a).
Its October 27 runs passed **116 tests on Linux**, **113 on Windows with 3 skips**,
and **6 separate Chromium facility scenarios**. The
[baseline record](facility-2026-10-27/README.md) includes exact run/job URLs,
timestamped excerpts, machine-readable counts and evidence boundaries.

“Latest audited” identifies the revision examined here. Later commits need their
own CI checks; this index does not automatically certify future source or deployments.

## Dated records

| Record | Scope and results | Interpretation |
| --- | --- | --- |
| [Optional CUDA analyzer, October 28](cuda-2026-10-28/README.md) | Explicit backend; 86 Python passes in each CPU/GPU environment, 100-frame analyzer parity, 120-second 30-feed run and 50/100-stream replay | CPU default preserved; replay queue replacements expose unmet cadence, not qualified 100-camera capacity |
| [Owner-PC continuation, October 28](host-2026-10-28/README.md) | CPU/GPU parity, 5/10/25/30 public-feed experiments, 300-image person benchmark and rejected crop/confidence trials | Local experiment records; media remains private, unpublished source is not promoted, field/sustained/100-camera acceptance remains open |
| [Native execution/runtime repair, October 28](native-2026-10-28/README.md) | 77 Python passes with no skips; pinned pretrained probes and a 20-frame synthetic recording | Actual local CPU execution; synthetic inputs, no representative quality or owner-hardware/capacity result |
| [Merged facility baseline](facility-2026-10-27/README.md) | 46 frontend + 4 packaging per platform; Python 66 Linux / 63 Windows + 3 skips; 6 separate Chromium scenarios | Software and mocked-service browser checks at the recorded merge revision |
| [Machine setup](hardware-2026-10-27/README.md) | Earlier CI: 107 Linux / 104 Windows passes + 3 Windows skips | Retains its original implementation revision, local skips and target-machine limits |
| [Documentation refresh](2026-10-27/README.md) | Earlier CI: 86 passes; separate local run had 8 native skips | Retains historical source/media/simulation provenance |
| [YOLOX qualification](../model-qualification-20261026.md) | Historical pretrained synthetic-input and generated-recording probes | Compatibility only; no representative detection-quality result |

Local and CI environments can differ. Always retain discovered, passed, failed
and skipped counts separately. Do not add browser results into a platform total
without explaining that they come from a distinct job.

## Reproduce and extend

Run the commands in the dated record against its recorded source revision.
For a documentation update, run `python3 scripts/check-docs.py` and
`python3 scripts/build-wiki.py --check`. The wiki generator only writes repository
mirrors; publication uses the separate wiki history.

For new application work, retain build, frontend, packaging, native Python and
browser results with the exact tested SHA and environment. Representative
recognition quality, target-host sustained performance, live-provider/local
deployment and 100-camera operation each need their own acceptance evidence.
