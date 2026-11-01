# Verification index

November 1 visual documentation: [handbook, capture provenance and Wiki coverage checks](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/visual-documentation-2026-11-01/README.md).

[Current visual atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas)

![The product's source-matched review process is illustrated separately from dated test records.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/workflow.svg)

*All historical logs, measurements, source hashes and qualification limits below remain unchanged.*

[Mac setup, November 1](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/mac-setup-2026-11-01/README.md): pinned source installation,
verified model preparation, private-data preservation, readiness, duplicate launch
and generated-video analysis/restart checks. Local Mac software evidence;
physical-device, accuracy and capacity qualification remain separate.

[Stair placement, November 1](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/facility-stairs-2026-11-01/README.md): local
map and touch controls, fixed start landing, and directed v6 floor connections.

[Exterior windows, November 1](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/facility-windows-2026-11-01/README.md): unpublished
map placement, touch and pointer resize, elevation editing, and portable v5 plans.

[Shared-wall doorways, November 1](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/facility-doorways-2026-11-01/README.md): local
unpublished click/drag placement, room-edit persistence, Undo and v4 plans;
270 unit checks and 15 controlled indoor browser scenarios, with four doorway
scenarios repeated after the final input guard. Software fixtures only.

**Current interface/regression check (October 31 Central / November 1 UTC):** [PR #61](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/61) merged with **14/14 reported CI checks**; [Chromium run 41263964836](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41263964836) passed **65 general/Facility + 12 analysis + 13 feeds + 2 recorder browser scenarios**, capturing 1440px and 390px controlled UI states. [Visual manifest](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/current/manifest.json). These are software fixture tests, **not** field-camera recognition quality or 100-camera capacity.

[Review fixes, October 30](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/review-fixes-2026-10-30/README.md): PR #45/#46 on
`main`, with local Node/Python/browser runs and green Linux/Windows CI, plus the
follow-up PRs #47–#50 and the PC install kit fix in #52; synthetic fixtures only,
not physical-device or capacity acceptance.

[Recording coverage, October 30](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/media-coverage-2026-10-30/README.md):
strict decode/inventory checks, explicit early/corrupt failure and unverified
coverage; generated-media evidence, with physical-camera acceptance separate.

[Saved-recording sharpening comparison, October 30](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/enhancement-2026-10-30/README.md):
paired native pixel/model checks, source preservation, separate evaluation,
failure handling and recovery; physical-camera accuracy remains unqualified.

[One-camera LAN recorder, October 30](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/lan-recorder-2026-10-30/README.md):
controlled-source recording, native analysis and fault/recovery tests;
physical-camera and sustained deployment acceptance remain separate.


[Linux launcher recovery](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/launcher-recovery-2026-10-29/README.md) records opt-in
Start/Check, non-mutating storage inspection and extracted-kit restart testing.

[Recording analysis restart recovery, October 29](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/analysis-recovery-2026-10-29/README.md):
opt-in Linux last-job storage, native interruption and browser reopen checks;
process restart evidence, not recording or power-loss durability.

[Local feed integration, October 29](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/local-feeds-2026-10-29/README.md): webcam and
RTSP preview lifecycle; synthetic transport tests, not physical-device acceptance.


The [October 29 recording recognition check](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/recognition-2026-10-29/README.md)
adds analyzer-to-browser review contracts and two actual bounded CPU recording
runs. Recognition quality, live operation and 100-camera acceptance remain open.

[October 28 facility follow-up](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/facility-2026-10-28/README.md): polygon selection,
v2 courtyard/base geometry, bounded local delivery and novice-study preparation.
Local checks and unresolved field/human acceptance are recorded separately.


Reviewed October 28, 2026. [Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) · [Home](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Home)

## Historical audited application baseline

The merged PR #11 revision is
[`82c862c68735720b8840461fc624e8dbe148a53a`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/82c862c68735720b8840461fc624e8dbe148a53a).
Its October 27 runs passed **116 tests on Linux**, **113 on Windows with 3 skips**,
and **6 separate Chromium facility scenarios**. The
[baseline record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/facility-2026-10-27/README.md) includes exact run/job URLs,
timestamped excerpts, machine-readable counts and evidence boundaries.

“Historical audited” identifies the revision examined here. Later commits need their
own CI checks; this index does not automatically certify future source or deployments.

## Dated records

| Record | Scope and results | Interpretation |
| --- | --- | --- |
| [Disk-backed overload, October 28](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/durable-overload-2026-10-28/README.md) | Commit-cost attribution, bounded overload probe, 512-page checkpoint confirmation and legacy-reader recovery | Synthetic disk/IPC evidence; FULL retained; native CUDA admission blocked; no physical capacity claim |
| [Durable cost profiling, October 28](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/profiling-2026-10-28/README.md) | Bounded phase timings, atomic bulk acknowledgment, reproducible synthetic probes and failure regressions | Local summaries interrupted by host loss; source-bound CI and owner native replay remain separate gates |
| [Atomic journal batching, October 28](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/batching-2026-10-28/README.md) | Atomic terminal groups, unread index, repeated matched replay and native transaction exit windows | Full SQLite durability retained; consumer cadence is measured separately; no physical-camera, power-loss or exactly-once claim |
| [Local outcome journal, October 28](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/journal-2026-10-28/README.md) | Optional durable dispatch/outcome records, parent-death cleanup, explicit acknowledgment and offline native checks | Process-exit recovery and at-least-once delivery; pending samples, per-camera rules, power-loss/recording durability and physical capacity remain unqualified |
| [Linux process recovery, October 28](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/recovery-2026-10-28/README.md) | Optional spawned-process deadlines/restarts, real fault tests and offline native qualification | Explicit failed-sample accounting; polled deadlines and bounded replay do not qualify physical cameras, durable recording or an OS sandbox |
| [Bounded local workers, October 28](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/workers-2026-10-28/README.md) | Explicit 1–4 execution adapter, native parity and 100-stream replay | Offline experiments with repeated public recordings; capacity, hard native-call cancellation and live-service acceptance remain open |
| [Optional CUDA analyzer, October 28](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/cuda-2026-10-28/README.md) | Explicit backend; 86 Python passes in each CPU/GPU environment, 100-frame analyzer parity, 120-second 30-feed run and 50/100-stream replay | CPU default preserved; replay queue replacements expose unmet cadence, not qualified 100-camera capacity |
| [Owner-PC continuation, October 28](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/host-2026-10-28/README.md) | CPU/GPU parity, 5/10/25/30 public-feed experiments, 300-image person benchmark and rejected crop/confidence trials | Local experiment records; media remains private, unpublished source is not promoted, field/sustained/100-camera acceptance remains open |
| [Native execution/runtime repair, October 28](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/native-2026-10-28/README.md) | 77 Python passes with no skips; pinned pretrained probes and a 20-frame synthetic recording | Actual local CPU execution; synthetic inputs, no representative quality or owner-hardware/capacity result |
| [Merged facility baseline](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/facility-2026-10-27/README.md) | 46 frontend + 4 packaging per platform; Python 66 Linux / 63 Windows + 3 skips; 6 separate Chromium scenarios | Software and mocked-service browser checks at the recorded merge revision |
| [Machine setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/hardware-2026-10-27/README.md) | Earlier CI: 107 Linux / 104 Windows passes + 3 Windows skips | Retains its original implementation revision, local skips and target-machine limits |
| [Documentation refresh](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/README.md) | Earlier CI: 86 passes; separate local run had 8 native skips | Retains historical source/media/simulation provenance |
| [YOLOX qualification](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Model-qualification-2026-10-26) | Historical pretrained synthetic-input and generated-recording probes | Compatibility only; no representative detection-quality result |

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

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/README.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
