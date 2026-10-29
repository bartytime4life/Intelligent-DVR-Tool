# Verification index

[Local feed integration, October 29](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/local-feeds-2026-10-29/README.md): webcam and
RTSP preview lifecycle; synthetic transport tests, not physical-device acceptance.


The [October 29 recording recognition check](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/recognition-2026-10-29/README.md)
adds analyzer-to-browser review contracts and two actual bounded CPU recording
runs. Recognition quality, live operation and 100-camera acceptance remain open.

[October 28 facility follow-up](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/facility-2026-10-28/README.md): polygon selection,
v2 courtyard/base geometry, bounded local delivery and novice-study preparation.
Local checks and unresolved field/human acceptance are recorded separately.


Reviewed October 28, 2026. [Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) · [Home](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Home)

## Latest audited application baseline

The merged PR #11 revision is
[`82c862c68735720b8840461fc624e8dbe148a53a`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/82c862c68735720b8840461fc624e8dbe148a53a).
Its October 27 runs passed **116 tests on Linux**, **113 on Windows with 3 skips**,
and **6 separate Chromium facility scenarios**. The
[baseline record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/facility-2026-10-27/README.md) includes exact run/job URLs,
timestamped excerpts, machine-readable counts and evidence boundaries.

“Latest audited” identifies the revision examined here. Later commits need their
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
| [YOLOX qualification](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/model-qualification-20261026.md) | Historical pretrained synthetic-input and generated-recording probes | Compatibility only; no representative detection-quality result |

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

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/README.md) · Documentation refresh: October 29, 2026.
