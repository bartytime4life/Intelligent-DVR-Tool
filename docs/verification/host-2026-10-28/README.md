# Owner-PC qualification after PR #14

Recorded **2026-10-28**. This report covers the local continuation after
[PR #14](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/14), through
the GPU/load experiments and three person-reference subsets. Earlier product
work remains in the [product status](../../product-status.md) and
[verification index](../README.md).

**Measured:** an isolated CUDA candidate preserved detector outputs within
declared tolerances and substantially reduced inference backlog. A separate
short run decoded and saved fragments from **30 distinct public feeds**. Person
quality was measured against published boxes on **300 distinct images**; small
people remained a weakness. Two attempted quality improvements failed their
declared gates and were rejected.

**Not established:** production GPU integration, representative facility/video
accuracy, false alerts per hour, sustained full-HD recording, complete ingest
and recovery services, or the owner's **100-camera requirement**. No model,
confidence, event or host default was promoted by these experiments.

## Evidence and source boundaries

The merged PR #14 revision is
`f2d4ed075903d6a2a83b1820d6120f640491b7d5`; its exact pre-merge head was
`506df8e24cdd142d80fc13ac656e36770626e295`. That published source was separately
checked on this PC. The working local prototype was a different, dirty checkout:
HEAD `2b6290ee0529eca1d4f4578634e28d8f58cc6709`, branch
`codex/open-map-facility-starter`, with substantial pre-existing unfinished work.
Local fixes and UI additions described below are **not shipped by this
documentation-only change**.

Original source bytes, hashes, isolated environments, failures, receipts and
rollback patches were retained in the owner's existing ignored `qa-local/`
lane. Public material here is an allowlisted export of numeric outcomes, source
bindings and public dataset-selection metadata. It includes no recording/image
bytes, raw model responses or reasoning, signed URLs/headers, credentials,
private filesystem names, host identifiers or browser state. Source media and
the local image-by-image error viewer remain on the PC.

| Published record | Purpose |
| --- | --- |
| [Results](results.json) | Hardware/runtime identities, scoped AI outcomes, CPU/GPU/load and reference metrics |
| [Image selection](image-selection.json) | Exact 300 public image IDs, source hashes, license/source links and subset membership; no image bytes or person identities |
| [Source bindings](source-bindings.json) | Hashes of tested local source and private experiment harnesses; identifies unpublished implementation explicitly |
| [Check summary](checks.json) | Separate local Python/frontend/packaging counts and hashes of retained logs |

These are unsigned records exported by the implementation agent. Hashes support
integrity comparisons, not authenticated provenance or independent replication.
Private harnesses/raw traces are not included in this PR; the protocol and
source hashes describe them without claiming the public checkout alone
reproduces every local experiment.

## Hardware and runtime inspection

| Component | Observed |
| --- | --- |
| CPU | AMD Ryzen 9 9950X, 16 physical cores / 32 logical processors |
| OS-usable RAM | 130,149,392,384 bytes, about 121.21 GiB |
| GPU | NVIDIA GeForce RTX 5080; 16,303 MiB total VRAM reported |
| Driver / OS | NVIDIA 580.178.04; Linux x86_64 7.0.0-38-generic |
| Shared-host context | Around 6–7 GiB available RAM; 8 GiB swap effectively full during inspection; other desktop workloads remained running |
| Disk | About 1.5 TB free on the working filesystem; no disks/RAID provisioned |

The qualified native environment used Python 3.12.3 and:

```text
opencv-python-headless==4.13.0.92
numpy==2.5.4
onnx==1.23.2
ml_dtypes==0.6.0
protobuf==7.36.2
typing_extensions==4.16.0
```

Its ordinary OpenCV wheel exposed no CUDA DNN targets. The existing analyzer
explicitly selected CPU; installed hardware alone was not treated as proof of
acceleration. A separate GPU environment reproduced these pins and added
ONNX Runtime GPU 1.31.1 and vendor runtime wheels. The existing CPU environment
and host driver/configuration were preserved. Installed CUDA-related wheels
included CUDA runtime/NVRTC 13.4.92, cuDNN 9.27.0.42 and cuBLAS 13.8.2.12;
actual execution below, rather than package presence alone, establishes use.

The model was the exact **35,858,002-byte FP32 YOLOX-S** artifact:

```text
Model SHA-256:  c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063
Labels SHA-256: 76ce1473f01bd271bab54429737358a97160629cf970c5ec8384c2777dd0bae9
Profile:       opencv-zoo-yolox-s-2022nov
```

Preparation kept RGB FP32 input, unnormalized 0–255 values, 640×640 top-left
letterboxing, original class order, YOLOX head decoding and class-aware NMS.
No weights, quantization or input contract were changed.

## Source and offline qualification checks

On the exact PR #14 source, this PC passed 77 Python tests without skips,
46 frontend tests, a fresh build and four packaging tests. Documentation checks
covered 271 local links and 14 media hashes; 17 wiki mirrors matched. These PC
runs are separate from the [earlier cloud/native record](../native-2026-10-28/README.md)
and PR #14's hosted Linux/Windows/Chromium workflows.

The pinned detector passed bounded black/gray/seeded-noise probes, then both
the PR #14 and newer local analyzers read all 20 frames of a generated
320×240, 5 FPS MJPEG recording. The browser-prepared job completed preflight,
model/frame probing, execution and receipt/trace validation. Synthetic inputs
proved execution and contracts, not real recognition quality. The 100-source
virtual scheduler runs likewise remained simulations with assumed service cost.

The first newer-local Python run found one failure among 134 cases: JSON depth
depended on interpreter recursion behavior, and exponent overflow could decode
to infinity. The local adapter was corrected to reject more than 64 nested
containers and nonfinite floats. Boundary regression tests were added; that
stage passed 135 tests. A later completion-diagnostic regression brought the
local Python suite to **136 passes, zero skips**.

Detector/test commands used a Linux seccomp guard denying IPv4/IPv6 socket
creation, inherited by descendants. Network access for explicitly authorized
package/source downloads and public HLS capture was separate. Local AI calls
used the fixed loopback Ollama endpoint. “Offline inference” does not describe
the network-fed HLS parent, nor constitute a filesystem/media-parser sandbox.

## Local vision diagnosis and browser handoff

The installed `qwen3-vl:4b` tag resolved to a thinking variant. One bounded
synthetic-image request at 4096 context / 512 output tokens, temperature 0 and
thinking requested off returned `done_reason:length`, 512 generated tokens,
2,076 reasoning characters and **zero final-content characters**. Reasoning
text remains private. This was not presented as a successful answer or
silently retried with another model.

The explicitly selected, already installed **`qwen3.5:4b`** completed the same
image/schema/baseline-profile job in 2,954 ms, including 2,449.01 ms model load,
with 62 output tokens. A later actual person-frame advisory also completed:
4,706 ms including 3,635 ms load, 69 output tokens, broad `person` output and
uncertain visibility/detail. Its digest was
`d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04`;
Ollama reported 0.35.1. These are advisory execution receipts, not detector
accuracy, steady-state GPU timing or concurrent model-residency evidence.

The local adapter now distinguishes wrong-model, incomplete, output-limit,
thinking-only and unsupported-completion failures while rejecting incomplete
results without fallback. Errors do not echo arbitrary model content.

The local UI gained an explicit “Use this model and token limits” action plus
a selectable/copyable fixed command. It accepts only allowlisted model/profile
tuples, preserves image kind separately and does not execute inference. Actual
browser checks covered a real receipt import, explicit reuse/focus, clipboard
paste, stale feedback, preserved image kind, invalid-schema rejection and
390px DOM layout fit. Clipboard API readback alone was inconclusive; actual
browser keyboard paste verified the command. Mobile screenshot cropping/scaling
limited pixel-level acceptance. No standalone browser suite, full accessibility,
deployment or all-device acceptance follows.

After this UI change, **106 frontend tests, a fresh build and four packaging
tests passed**. The 136 Python run belongs to the preceding unchanged backend
stage; it is not another combined-platform CI count. The existing Vite large
facility-bundle warning remained. Narrow source changes were confined to local
`edge/local_ai.py`, `tests/test_local_ai.py`, `docs/local-ai.md`,
`src/local-ai.mjs`, `src/LocalAIReview.jsx`, `src/local-ai.css` and
`tests/local-ai.test.mjs`; staged inventories/backups preserved other work.

## Public-media pilot and label limits

No suitable recording/label pair was found in the bounded local search. The
owner then authorized online examples and public live feeds. Only public
examples were used; no private camera, microphone or owner recording was
activated. No recording was uploaded for analysis.

| Example | Actual result | Boundary |
| --- | --- | --- |
| Official NPS Yellowstone webcam excerpt | Two normally delivered media segments retained locally; all 360 frames decoded, about 12.012 seconds, 1920×1080 | Playback/capture check only; no ground truth or absence/accuracy claim |
| MEVA school vehicle clip | 20 seconds, 600 decoded frames, 40 samples; car/truck detections | Timestamp anomalies prevented qualified event-time/accuracy claims; annotations were not complete |
| MEVA person entry | A derived 10-second clip, 300 frames; 60 samples, 38 with a person prediction ≥0.5; one pending two-second class-presence observation | Sample-frame counts are not recall, unique people or reviewed events |
| MEVA example boxes | 56 publisher person boxes mapped by source-frame offset | Activity-centered, partial annotations; semantic/time alignment remained unqualified; no video precision/recall fabricated |

The NPS direct unsigned request initially returned 403. The ordinary official
player subsequently delivered video; there was no fabricated signature or
access-control bypass. The webcam was paused/closed after bounded capture.
An attempted MP4 remux failed and its partial file was rejected; the original
TS capture was used. The local decoder found strictly increasing PTS in that
capture within a small nominal-rate clock tolerance, not proof of exact CFR.

MEVA sources are licensed CC BY 4.0 with Kitware/IARPA attribution; original
sources, annotations, transformations and hashes remain local. NPS general
government-content guidance was checked, but no separate per-livestream CC
grant is asserted. WiseNET's attractive CC0 annotated archive was unavailable
in bounded download attempts and was **not used**. The successful reference
benchmark below closes an image-metric gap, not those MEVA video-label gaps.

Primary source/terms records: [MEVA data guide](https://mevadata.org/resources/README-meva-kf1-data.html),
[MEVA license](https://mevadata.org/resources/MEVA-data-license.txt),
[official Yellowstone webcams](https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm)
and [NPS content guidance](https://www.nps.gov/aboutus/disclaimer.htm).

## CPU settings and isolated GPU agreement

The same 40 vehicle samples were run with 1, 2 and 4 OpenCV CPU threads:

| Threads | Median processing ms | p95 ms | Command wall seconds |
| ---: | ---: | ---: | ---: |
| 1 | 280.29 | 460.64 | 13.5467 |
| 2 | 160.84 | 166.67 | 7.5836 |
| 4 | 96.86 | 102.50 | 5.0278 |

Every ordered class, score and box matched across those runs. Earlier spoken
claims that the faster setting increased false alarms were unsupported and
are corrected here. The one-thread run overlapped other local extraction work;
these one-run timings are not statistical or sustained benchmarks. An earlier
two-thread process under a 3 GiB virtual-address limit segfaulted. Decoder
threads and allocator settings were subsequently bounded; the unique cause
was not established and no upstream defect was asserted.

The GPU candidate disabled TF32 and CPU graph/runtime fallback. Its CUDA arena
was limited to 1 GiB, with heuristic convolution search and restricted workspace;
total device memory can exceed that arena. The documented
[runtime preload/options](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)
and [CPU graph-fallback option](https://github.com/microsoft/onnxruntime/blob/main/include/onnxruntime/core/session/onnxruntime_session_options_config_keys.h)
were used. Actual profiles contained CUDA node events only.

One initial harness assertion rejected ORT's registered CPU provider list
before inference. Registration is distinct from graph execution; the corrected
check verifies disabled fallback and actual node events. An emitted plugin
device-discovery warning did not negate the later CUDA execution proof.

Acceptance was declared before inference: 40 vehicle + 60 person frames, same
input-tensor hashes, matching labels/counts at decoder confidence 0.1,
one-to-one IoU ≥0.99, score difference ≤0.001, and matching class counts at
confidence 0.5. **All 100 passed.** Minimum matched IoU was 0.99999569 and the
largest score difference 0.0000036442. Raw outputs were close, not bit-identical.

Median prepare/inference/decode cost was **101.98 ms CPU versus 11.47 ms GPU**;
p95 was 111.99 versus 15.03 ms. Three warmups per backend were excluded and
execution order alternated per frame. This comparison includes hashing/output
transfer and profiling overhead, but excludes recording decoding. It is one
shared-desktop run, not universal equivalence or a capacity extrapolation.

## Distinct live-internet feeds: CPU and GPU

The official [Iowa DOT data-feed service](https://iowadot.gov/travel-tools/iowa-511/511-data-feeds)
and [camera catalog](https://data.iowadot.gov/datasets/IowaDOT::traffic-cameras-3/about)
supplied unauthenticated public HLS URLs. The catalog declared CC BY 4.0;
additional linked GIS terms returned 403. No broader per-stream license or
redistribution grant is inferred. Source inventories/URLs stayed local.

Each stage measured about **12 seconds after startup**, with real concurrent
decoding, original-fragment saving/fsync and one shared detector. Frames were
paced by relative media timestamps; at most two samples/s/source were offered
to the existing latest-pending-per-camera scheduler. Frame quantization means
actual offered counts are authoritative. Source dimensions were 480×270,
768×432 or 800×450, mostly around 15 FPS, with variations recorded. This was
not 30 full-HD streams or a complete product recording/ingest service.

| CPU requested | Active peak | Completed / offered | Results/s | Replaced pending | Pending at stop |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 5 | 112 / 115 | 9.31 | 1 | 2 |
| 10 | 10 | 120 / 230 | 9.97 | 103 | 7 |
| 25 | 24 | 117 / 553 | 9.74 | 414 | 22 |
| 30 | 28 | 117 / 644 | 9.73 | 501 | 26 |

CPU 25-source camera 13 (publisher 59644941) timed out. CPU 30-source cameras
13 and 30 (59645007) returned **HTTP404**, not two timeouts. Those failures
were not counted as connected sources.

| GPU attempt | Active peak / sources without errors | Completed / offered | Results/s | Replaced / pending |
| --- | ---: | ---: | ---: | ---: |
| 5 | 5 / 5 | 115 / 115 | 9.58 | 0 / 0 |
| 10 | 10 / 10 | 230 / 230 | 19.16 | 0 / 0 |
| 25 | 25 / 24 | 555 / 558 | 46.23 | 0 / 3 |
| 30, original lineup | 29 / 29 | 655 / 667 | 54.55 | 4 / 8 |
| 30, one catalogued alternate | 30 / 30 | 679 / 691 | 56.53 | 3 / 9 |

GPU camera 17 (59645492) returned 404 after decoding 80 frames in the 25-source
run. Original camera 30 returned 404 before decoding. A separate inventory
explicitly replaced it with publisher **59644911**; all 30 then decoded and
saved fragments without source errors, totaling **5,636 frames**. Original
failures and unsuccessful alternate preflights were retained. A concurrent
high-water mark and exit 0 alone do not mean every source stayed healthy.

The clean-source GPU run had median/p95 worker cost **10.15 / 11.03 ms**.
The original 25/30 GPU stages sampled worker device memory at a maximum
**722 MiB**; host RSS is separate. All reported fragment hashes/byte counts,
trace totals and queue-accounting identities were checked. No stale/budget
drops occurred; intentional pending replacements and stop-boundary pending
samples remain separate. Three replacements/nine pending still preclude a
zero-loss required-cadence claim.

CPU and GPU live scenes/provider conditions differed; GPU warmups were also
excluded before its window. Use frozen frames for paired speed comparison.
Local completion age excludes upstream camera/CDN/HLS delay. Retained bytes
include startup/prefetch and whole fragments, so bytes/window is not measured
wire bitrate or sustained disk throughput. RAM sampling/floors and bounded
process/request timeouts protected these short experiments, not a hardened
production service. No 30→100 linear extrapolation is supported.

## Person-reference benchmark and rejected improvements

The official [COCO validation reference](https://cocodataset.org/#download)
provides image-ID-aligned boxes, avoiding uncertain video timestamps.
[Annotations are CC BY 4.0](https://cocodataset.org/#termsofuse); only images
declared CC BY 2.0 by the publisher were selected. Image/Flickr source links and
licenses are retained in [selection metadata](image-selection.json). These
declarations are not an independent rights audit. Media bytes remain local.

The official annotation archive was fetched from its public S3 bucket with
valid TLS after the custom image hostname failed certificate validation:
`https://s3.amazonaws.com/images.cocodataset.org/annotations/annotations_trainval2017.zip`.
SHA-256: `113a836d90195ee1f884e704da6304dfaaecff1f023f49b6ca93c4aaae470268`.
Certificate verification was not disabled. Transient image-download connection
resets were retried for the same selected files; no success-based replacements.

Selection was fixed before each inference trial: license ID 4, exclude any
image with person crowd annotations, stratify by presence of published person
boxes, sort each stratum by
`SHA256("dvr-person-qualification-v1|" + decimal_image_id)`. Take positions
0–49, 50–99 and 100–149 for the three successive subsets. Each has 50 positive
and 50 no-annotated-person images. All **300 IDs and exact image hashes are
disjoint**. Their semantic scene/source independence and independence from
upstream model development are not proven; these are COCO validation images
related to the model's training domain, not a new facility-held-out dataset.

JPEG dimensions had to match reference metadata. Original pixel boxes were
normalized by those dimensions and scored using the existing score-descending,
same-class, one-to-one IoU matcher. IoU was fixed at **0.5**. An unmatched
prediction can be a duplicate or localization error; it is not necessarily an
invented person. A mismatch can produce both FP and FN. No AP/mAP, event,
identity or unique-person metric is implied.

| Subset / route | Published boxes | Matched / unmatched predictions / missed | Precision | Recall |
| --- | ---: | ---: | ---: | ---: |
| Original 100, confidence 0.5 | 142 | 95 / 10 / 47 | 90.48% | 66.90% |
| Crop subset, full-frame 0.5 | 164 | 111 / 7 / 53 | 94.07% | 67.68% |
| Crop subset, full frame + four crops | 164 | 113 / 118 / 51 | 48.92% | 68.90% |
| Confidence subset, baseline 0.5 | 143 | 82 / 5 / 61 | 94.25% | 57.34% |
| Confidence subset, candidate 0.3 | 143 | 97 / 17 / 46 | 85.09% | 67.83% |

Across all three subsets, the unchanged **0.5 baseline** matched **288 of 449**
reference boxes, with **22 unmatched predictions and 161 misses**:
**92.90% precision / 64.14% recall**. Those pooled figures describe this
balanced, stratified 300-image benchmark only. CPU/GPU per-image TP/FP/FN
counts matched on all 100 images in the original reference subset.

Using published segmentation area (<32², 32²–96², ≥96² original pixels), pooled
baseline recall was **34/139 small, 115/154 medium and 139/156 large**.
Small-person sensitivity is a measured weakness, not a proven single cause.
Partial bodies, dim figures and distant pedestrians were inspected as examples
without relabeling the reference. Published annotations may be imperfect.

**Crop candidate rejected.** A fixed full-frame pass plus four overlapping
60%-width/height corner crops used the same model/threshold and global IoU
0.45 NMS. The declared gate allowed no more than five percentage points of
precision loss while improving recall. It failed badly: only two additional
matches, 111 additional unmatched predictions and median cost **10.18→51.42 ms**
(p95 10.92→54.23 ms). The global merge did not deliver acceptable quality.
The tile timing counts the reused full pass once, excludes image decode and
may reflect cache/order effects; it is not sustained camera throughput.

**Lower-confidence candidate also rejected for automatic use.** Confidence
0.3 was declared for a separate third reserved subset, with a gate of at least
five percentage points more recall and at most five points of precision loss.
It added 15 matches and 12 unmatched predictions: **+10.49 recall points,
−9.17 precision points**, failing the precision limit. It requires no extra
model pass, but review/event workload was not measured. On that subset,
image-presence hits changed 41/50→45/50 and negative-image false positives
1/50→3/50. Default confidence remains unchanged.

The original subset's 0/50 negative-image false positives never established
zero false alerts. Across all three baseline subsets, 2/150 no-annotated-person
images produced a person prediction. No time-based false-alert rate or video
event recall can be derived from these still images. The complete local error
viewer compares reference/detector boxes and exposes misses/unmatched cases;
it does not turn experimental predictions into reviewed observations.

## Decisions, next evidence and rollback

1. Preserve the CPU baseline and tested source. GPU execution is a promising
   isolated candidate; production adapter integration and equivalent tests are
   still separate implementation work.
2. Preserve both failed quality trials. Do not lower automatic event confidence
   or enable five-pass crops on the strength of a recall-only gain.
3. Prioritize small-person quality with an independently reserved, representative
   facility recording set, complete labels and explicit review/error budgets.
   Image metrics do not settle MEVA video alignment or event behavior.
4. Define codec/resolution/FPS, recording/retention policy, analysis cadence,
   local age limits, source-health budgets and worker placement before sustained
   replay/soak and 50/100-camera qualification. The existing workload preflight
   still had 21 unset/open decisions; no owner acceptance was invented.
5. Measure recording continuity, reconnection, storage recovery, inference/vision
   co-residency and browser load separately. The current experiments do not
   authorize a field deployment, merge, release or publication of media.

Local implementation changes have per-stage source backups and reverse-patch
checks; restore only the intended change after checking for later edits.
Generated trial folders/environments can be removed after preserving desired
evidence. No host driver, power, disk/RAID, monitoring or production default
needs rollback because none was changed. This documentation-only PR can be
reverted independently and does not erase the local recordings or experiments.

## Validate this documentation

From this documentation revision:

```bash
python3 scripts/check-docs.py
python3 scripts/build-wiki.py --check
python3 docs/verification/host-2026-10-28/verify-results.py
git diff --check
```

These checks validate links/media mirrors, sanitized receipt consistency and
publication boundaries. They do not rerun the private experiments, confer an
independent review, or turn earlier local application tests into exact-head CI
for a different revision. Wiki mirrors are source files; native Wiki publication,
main-branch merge and deployment remain separate actions.
