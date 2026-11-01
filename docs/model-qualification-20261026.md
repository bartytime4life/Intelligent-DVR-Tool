# Free local detector qualification — 2026-10-26

> **Dated record.** Findings and evidence below retain their stated revision and date. Use the [visual handbook](how-to.md), [current capability register](product-status.md) and [guide index](README.md) for today’s operator path.

## Decision and current evidence

**Use the exact OpenCV Zoo FP32 YOLOX-S 2022nov artifact for the first offline
qualification candidate.** Its directory explicitly licenses all files under
Apache-2.0, its ONNX weights are published with a content hash, and its raw head
can reuse our rule engine after a small, explicit preprocessing/decoder change.
This is an engineering recommendation for the next evaluation, not a conclusion
that it recognizes the owner's target scenes well enough. [S1–S4]

The downloaded 35,858,002-byte model matched the upstream Git LFS SHA-256. Its
279-node, opset-11 graph loaded in OpenCV. Three offline probes (black, gray,
seeded noise) produced finite float32 `[1,8400,85]` outputs and passed decoding.
See [machine-readable evidence](model-qualification/yolox-s-synthetic-20261026.json).
The same pinned trained model also completed the recording CLI on a temporary,
generated 10-frame MJPG clip (two analyzed frames, zero observations), with
[a separate explicitly synthetic receipt](model-qualification/yolox-s-recording-smoke-20261026.json).
No scene accuracy, camera compatibility or real-time performance was measured.
No trained weights, recordings, credentials or private observations are committed.

The current main branch inspected was
`e14270c63f31d562d4ff16564e4f70c29e56f2c6` (PR #1). Its sole inference profile
required RGB /255, centered 640px letterboxing and `[1,4+C,N]` decoded pixel boxes.
**None of the permissive candidates below is a drop-in replacement for that
contract.** Matching dimensions alone cannot prove input/output semantics.

## Commercial-use and integration comparison

“Free” below means no third-party subscription, trial or paid inference needed
for local operation. Hardware, electricity and engineering remain costs.
Repository code, a particular checkpoint, pretrained backbones, datasets and
deployment dependencies need separate provenance; a YOLO name confers no license.

| Candidate and pretrained artifact | Verifiable terms | Current adapter | Decision |
| --- | --- | --- | --- |
| OpenCV Zoo YOLOX-S `object_detection_yolox_2022nov.onnx` | Directory expressly covers **all files** with Apache-2.0; exact artifact and license pinned. Commercial use and private modifications permitted subject to the license. [S1,S4] | Needs raw YOLOX decoder and different preprocessing; implemented here as an opt-in hash-bound profile | **First practical candidate; actual offline contract smoke passed** |
| OpenCV Zoo NanoDet-Plus-m-1.5x 416 `object_detection_nanodet_2022nov.onnx` | Its directory also expressly applies Apache-2.0 to all files, including the published artifact. [S6] | Different resolution, normalization and multi-head distribution decoder | **Best lightweight follow-up** if YOLOX CPU cost is too high; not tested here |
| RF-DETR Nano / Small, current core checkpoints | Official model docs explicitly put core Nano through Large under Apache-2.0. No account or hosted service needed for the local core workflow. XL/2XL use different terms and are excluded. [S8,S9] | Transformer architecture, normalization, named boxes/logits outputs, sparse COCO-ID mapping | **Strong modern comparison candidate**, more integration work; no export tested here |
| Official RT-DETRv2-S, COCO R18 checkpoint | Official repository uses Apache-2.0 and publishes checkpoints. The reviewed pages do not separately spell out an artifact-specific weight grant as explicitly as Zoo/RF-DETR. Preserve that distinction; do not mark this exact checkpoint commercially cleared solely from code licensing. [S11,S12] | Second input plus multiple outputs and transformer operators | **Conditional research candidate**; checkpoint terms and runtime support remain gates |
| RTMDet-tiny, official MMDetection COCO checkpoint | MMDetection code is Apache-2.0; checkpoint licensing clarification remains unanswered in the reviewed issue. Do not infer permission for that binary from the library license. [S14,S15] | CSPNeXt network; new export/runtime and decoder path | **Hold for explicit checkpoint-license evidence** |
| Ultralytics YOLOv8 | Free AGPL route has source-sharing obligations; vendor offers a paid Enterprise alternative for private integrations. Commercial use itself is not forbidden by AGPL. This repository has no owner-selected AGPL release policy. [S16] | A suitably configured raw 640 export is the closest existing tensor contract | **Do not adopt by default** or purchase a license; an AGPL decision would materially change product licensing |
| YOLO-NAS official pretrained weights | Separate weight terms prohibit commercial/production use absent a separate agreement, despite the surrounding SuperGradients library's permissive code license. [S17] | Different export/decoder path anyway | **Excluded** |

Apache-2.0 allows commercial use, modification and redistribution. When
redistributing covered files, retain the license, relevant attribution and any
applicable NOTICE content; identify modified files. Its patent grant has
termination conditions; it does not provide trademark rights or warranties.
The preserved upstream license governs, not this summary. No choice of the
repository's own license is made here. [S4]

## Exact technical contracts

| Model | Architecture and trained targets | Preprocessing and ONNX output | Hardware and integration work |
| --- | --- | --- | --- |
| **Pinned Zoo YOLOX-S** | Anchor-free CNN with decoupled detection head; 9.0M parameters / 26.8 GFLOPs at 640 in the upstream table; 80 COCO classes. [S1,S5] | float32 NCHW `[1,3,640,640]`; **RGB 0–255**, no mean/std; aspect-preserving floor resize, image at top-left, padding 114. One raw `[1,8400,85]` tensor: four grid/log-size fields, objectness, 80 class scores. Strides 8/16/32; `xy=(offset+grid)*stride`, `wh=exp(raw)*stride`, score=`objectness*class`. No embedded NMS. [S2,S3] | Runs in existing OpenCV CPU backend; no Torch at inference. 35.9 MB artifact, actual probe peak RSS about 340 MiB. New explicit profile, verified labels and pin checks implemented. GPU acceleration requires a separately qualified runtime/build. |
| **Zoo NanoDet-Plus-m-1.5x 416** | Lightweight FCOS-style CNN / Generalized Focal Loss and Ghost-PAN; upstream 2.44M parameters / 2.97 GFLOPs at 416. Standard 80 COCO targets. [S7] | Zoo wrapper uses 416 input and BGR normalization: means `[103.53,116.28,123.675]`, std `[57.375,57.12,58.395]`. Its artifact wrapper consumes alternating classification/distribution outputs over strides 8/16/32/64; 8-bin softmax expectation (`reg_max=7`) becomes four distances from points. Multiple output heads, point-grid generation and box mapping required. A fresh upstream export can have a different layout: inspect it. [S6] | Smallest permissive CNN alternative in this shortlist; suitable for a CPU-first comparison, without promising local FPS. New input-size support, head enumeration, distribution decoder, preprocessing/geometry tests and parity run needed. |
| **RF-DETR Nano / Small** | DINOv2 vision-transformer backbone plus detection transformer; official core COCO checkpoints. Nano 30.5M parameters at 384, Small 32.1M at 512 in current docs. [S8] | RGB /255, resize to variant square, ImageNet mean `[.485,.456,.406]` / std `[.229,.224,.225]`. Named `dets` = normalized cxcywh; `labels` = raw logits, not label IDs. Apply sigmoid, map checkpoint class slots, scale boxes to original frame; use checkpoint-aware query/class ranking. Official COCO checkpoints retain sparse category-ID slots, not the 80 contiguous YOLO labels. [S9,S10] | Larger weight/activation footprint than YOLOX-S; optimized GPU timings from the vendor are not OpenCV CPU measurements. Add named multi-output runtime, variant input dimensions, category mapping and geometry; qualify GridSample/attention operators or use a local ONNX Runtime backend. No runtime dependency added here. |
| **RT-DETRv2-S official COCO** | ResNet-18 backbone, hybrid encoder and transformer decoder; 20M parameters / 60 GFLOPs, 640 input. COCO 80-class trained target set. [S11,S12] | Official export accepts `images` and `orig_target_sizes`; returns `labels`, `boxes`, `scores` with postprocessing in the graph (no ordinary YOLO NMS). Demo resizes RGB to 640 and converts to /255 tensor. Must verify size-axis ordering on a non-square parity fixture: the demo passes `[w,h]`; do not infer a universal contract from that alone. [S13] | At least a new multi-input/multi-output runtime path; more demanding operators and no current adapter support. Compare a frozen ONNX export against the original model before any score claims. Weight-specific permission remains unresolved here. |

RTMDet-tiny is a fully convolutional CSPNeXt-based alternative (4.8M parameters,
8.1 GFLOPs at 640). MMDeploy documents the ONNX conversion route, but export
configuration controls postprocessing, operators and input normalization. It
must get a checkpoint-specific license record and frozen deploy config before
spending integration effort. It is not a raw YOLOv8 tensor substitute. [S14,S15,S18]

The COCO targets include person, vehicles, common animals and everyday objects.
They do **not** include a generic “out of place” category, authorization, intent,
most industrial equipment, or identity. The exact 80-class order for the pinned
YOLOX model is [coco80.json](../edge/labels/coco80.json), transcribed from its demo.
A detected `person` is not a named person. Existing class/zone/dwell rules and
human review retain their meaning and limitations.

## What changed in this repository

- `edge/model_profiles.py` defines opt-in preprocessing and YOLOX grid decoding.
  The default YOLOv8 behavior remains available. There is no automatic model
  detection, guessed transpose, color conversion choice or model download.
- The YOLOX profile accepts **only** the pinned FP32 model hash and exact verified
  COCO80 label order. Its generic name is not permission to substitute arbitrary
  YOLOX weights. INT8, embedded decode/NMS, 416px, legacy-normalized and Megvii
  BGR exports need their own evidence and profile.
- `edge.analyze` can use this profile on a deliberately selected local recording;
  receipts now identify the profile and labels hash. Events still require review.
- `edge.qualify` inspects a static ONNX contract and runs three deterministic
  synthetic inputs in a child process. The default 45-second wall deadline,
  2 GiB address-space ceiling and one CPU thread bound this smoke test on Linux.
  It rejects custom operator domains, embedded NMS and external-data initializers.
  These controls are **not** a network/filesystem sandbox. Use a separate isolated
  environment for untrusted models. The recording analyzer itself retains its
  existing frame/event bounds, not this qualification process deadline.
- The report is separate from event receipts and cannot be mistaken for a real
  observation import. Output paths cannot overwrite prior evidence. Tests use
  generated tensors and constant-output ONNX fixtures, never camera footage.

Validation of this change: 16 Python tests, six Node domain tests, four retained
packaging tests and the production build passed. Python checks cover both input
profiles, all three grid strides, objectness scoring, cross-class NMS, malformed
outputs, hash/label mismatches, subprocess execution, timeout handling and
non-overwriting reports. No model download is added to CI.

The adapter deliberately keeps its existing one-best-class-per-anchor, class-aware
NMS with score floor 0.1 / IoU 0.45. Zoo's demo defaults differ. This is documented
adapter behavior, **not** a claim of parity with the demo's default thresholds
or COCO benchmark. Rule thresholds still filter the resulting observations.

## Reproduce the bounded test

Use an isolated Linux environment, Python 3.12, and the repository root. Installation
and the explicit download below need a network once; qualification itself is local.
No account, API key, cloud inference or paid service is involved.

```bash
python3 -m venv .venv
.venv/bin/pip install -r edge/requirements-qualification.txt
mkdir -p models receipts
```

Explicitly fetch and verify the candidate; this is never run by the application:

```bash
.venv/bin/python - <<'PY'
import hashlib, json, pathlib, urllib.request
c = json.loads(pathlib.Path('edge/candidates/opencv-zoo-yolox-s-2022nov.json').read_text())
p = pathlib.Path('models/object_detection_yolox_2022nov.onnx')
if p.exists() or p.is_symlink():
    raise SystemExit('Use a new download path; existing files are never replaced')
created = False
try:
    with p.open('xb') as dst:
        created = True
        with urllib.request.urlopen(c['download_url'], timeout=30) as src:
            total = 0
            while chunk := src.read(1024 * 1024):
                total += len(chunk)
                if total > c['model_bytes']:
                    raise ValueError('Download exceeds expected size')
                dst.write(chunk)
    if p.stat().st_size != c['model_bytes'] or hashlib.sha256(p.read_bytes()).hexdigest() != c['model_sha256']:
        raise ValueError('Artifact identity mismatch')
except BaseException:
    if created:
        p.unlink(missing_ok=True)
    raise
print('Verified candidate; no footage processed')
PY
```

Run the offline compatibility test and regression suite:

```bash
.venv/bin/python -m edge.qualify \
  --model models/object_detection_yolox_2022nov.onnx \
  --labels edge/labels/coco80.json \
  --profile opencv-zoo-yolox-s-2022nov \
  --timeout-seconds 45 --memory-mib 2048 --threads 1 \
  --output receipts/yolox-s-compatibility.json
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

Expected success state: `contract-smoke-passed`, **not** “accuracy passed”. The
runner emits nonzero on failure/timeout. For an independently licensed existing
YOLOv8 export, the default profile can smoke-test a static graph, but that does
not attach any commercial permission to its weights. Neither CLI downloads
models, probes cameras or opens devices.

### Recorded result and its limits

| Measurement | Observed on this execution host |
| --- | --- |
| Artifact SHA-256 | `c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063` |
| Runtime | Python 3.12.14, OpenCV 4.14.0, NumPy 2.5.4, ONNX 1.23.2; Linux x86_64 CPU, one OpenCV thread |
| Contract | float32 `[1,3,640,640]` → `[1,8400,85]`; opset 11; finite outputs on all probes |
| Inference + decoding | Black ~788 ms, gray ~573 ms, seeded noise ~574 ms; first call includes cold-start effects |
| Peak worker RSS | 347,868 KiB (~340 MiB), including libraries and graph inspection |
| Probe observations | Zero at adapter floor 0.1 on these three synthetic inputs |
| Recognition / operational status | Unmeasured / not qualified |

These three samples are not a latency distribution, a false-positive study or
an accuracy benchmark. There was no GPU, host-camera access, field video or
five-camera load. Do not compare this CPU result directly with upstream V100,
T4 TensorRT FP16, OpenVINO or mobile-ncnn timing tables. Standard opencv-python
wheels are CPU-only; a CUDA GPU in the machine does not automatically accelerate
them. [S19] For planning only, required analyzer throughput is cameras × analyzed
frames/second; actual capacity needs a sustained measured test on the target host.

## Gates before a pilot can rely on detections

1. **Freeze provenance.** Archive upstream revision, exact weights/labels hashes,
   license text and relevant notices. Keep a separate entry for every backbone,
   fine-tune, quantization and conversion. Record export command, package versions
   and changes; requalify after any artifact/profile/runtime change.
2. **Define target classes and event rules.** Decide actual tasks, zones, permitted
   times and review actions using the pilot scope. Do not relabel a broad COCO
   class as an unsupported task. Unsupported equipment needs authorized labeled
   training data and a separately licensed fine-tune, not a UI label edit.
3. **Build the authorized evaluation set.** Use representative recordings with
   documented permission, provenance, retention and access limits. Separate tuning
   clips from held-out cameras/days. Include empty scenes, night/IR, low light,
   weather, backlight, small/distant targets, occlusion, compression and motion.
   Record source hashes and label guidelines; review labels for consistency.
4. **Measure frame and event quality separately.** Report per-class precision and
   recall at stated IoU/score thresholds and counts, misses and false alerts per
   camera-hour. Evaluate zone geometry and dwell events against independently
   labeled events. Continuous class presence is not same-object tracking. Tune
   on the tuning split, then freeze thresholds before held-out evaluation.
   Set acceptance thresholds with the operator; none are invented here.
5. **Measure the intended edge deployment.** Record CPU/GPU/runtime, memory,
   thermals, codec/resolution, sampling and dropped work. Measure p50/p95 processing
   and capture-to-review delay at one source and five sources only when camera
   connectivity has been separately authorized. CPU smoke timings do not fulfill
   this gate. Verify variable-frame-rate timestamps and gaps explicitly.
6. **Retain human control.** Keep observations review-required; no identity,
   authorization or enforcement decisions. Keep source recordings and secrets
   local, import only intended metadata, and apply retention/deletion and access
   controls. Camera adapters and continuous capture remain a separate task.

The immediate next supported step is an approved labeled **offline** recording
set and a documented target hardware configuration. Those facts cannot be inferred
from the synthetic prototype. The present work stops at reproducible compatibility
evidence and a candidate path; it activates no surveillance.

## Primary sources checked 2026-10-26

S1. [OpenCV Zoo YOLOX README, pinned revision](https://github.com/opencv/opencv_zoo/blob/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/object_detection_yolox/README.md) — artifact, architecture and explicit directory license.

S2. [Pinned Zoo demo](https://github.com/opencv/opencv_zoo/blob/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/object_detection_yolox/demo.py) — RGB conversion, top-left letterbox, exact class order.

S3. [Pinned Zoo YOLOX wrapper](https://github.com/opencv/opencv_zoo/blob/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/object_detection_yolox/yolox.py) and [LFS pointer](https://github.com/opencv/opencv_zoo/blob/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/object_detection_yolox/object_detection_yolox_2022nov.onnx) — raw decoder, size and SHA-256.

S4. [Pinned model-directory Apache license](https://github.com/opencv/opencv_zoo/blob/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/object_detection_yolox/LICENSE), also preserved locally beside the test evidence.

S5. [Megvii YOLOX model table](https://github.com/Megvii-BaseDetection/YOLOX), [ONNX export guide](https://github.com/Megvii-BaseDetection/YOLOX/blob/main/demo/ONNXRuntime/README.md), [export flags](https://github.com/Megvii-BaseDetection/YOLOX/blob/main/tools/export_onnx.py), [preprocessing](https://github.com/Megvii-BaseDetection/YOLOX/blob/main/yolox/data/data_augment.py). Official path: `python tools/export_onnx.py --output-name yolox_s.onnx -n yolox-s -c yolox_s.pth`; `--decode_in_inference` changes the box contract. **This command does not reproduce the pinned Zoo binary**; validate any newly exported file independently.

S6. [Pinned Zoo NanoDet README](https://github.com/opencv/opencv_zoo/blob/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/object_detection_nanodet/README.md), [wrapper](https://github.com/opencv/opencv_zoo/blob/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/object_detection_nanodet/nanodet.py) — artifact license, preprocessing and heads.

S7. [NanoDet upstream](https://github.com/RangiLyu/nanodet) and [ONNX exporter](https://github.com/RangiLyu/nanodet/blob/main/tools/export_onnx.py) — architecture/model table and flags `--cfg_path`, `--model_path`, `--out_path`, `--input_shape 416,416`; freeze configuration and inspect outputs.

S8. [RF-DETR detection model table](https://rfdetr.roboflow.com/latest/learn/run/detection/) — core-model licenses, pretrained sizes and classes.

S9. [RF-DETR ONNX contract](https://rfdetr.roboflow.com/latest/exports/onnx/) — input normalization, named outputs, logits and sparse COCO slots.

S10. [RF-DETR export basics](https://rfdetr.roboflow.com/latest/exports/basics/) and [FAQ](https://rfdetr.roboflow.com/latest/faq/) — local export with `rfdetr[onnx]`, an explicit local `pretrain_weights` path and `model.export()`; no hosted inference required.

S11. [RT-DETR official source](https://github.com/lyuwenyu/RT-DETR) and [license](https://github.com/lyuwenyu/RT-DETR/blob/main/LICENSE).

S12. [RT-DETRv2 model zoo/export guide](https://github.com/lyuwenyu/RT-DETR/blob/main/rtdetrv2_pytorch/README.md) — `python tools/export_onnx.py -c path/to/config -r path/to/checkpoint --check` in its frozen environment.

S13. [RT-DETRv2 exporter](https://github.com/lyuwenyu/RT-DETR/blob/main/rtdetrv2_pytorch/tools/export_onnx.py) and [ONNX inference demo](https://github.com/lyuwenyu/RT-DETR/blob/main/rtdetrv2_pytorch/references/deploy/rtdetrv2_onnxruntime.py) — actual two-input, three-output graph and preprocessing.

S14. [MMDetection license](https://github.com/open-mmlab/mmdetection) and [RTMDet model zoo](https://github.com/open-mmlab/mmdetection/blob/main/configs/rtmdet/README.md).

S15. [Checkpoint-license clarification issue #11484](https://github.com/open-mmlab/mmdetection/issues/11484) — requests are evidence of an unresolved question, not a licensing grant.

S16. [Ultralytics licensing statement](https://www.ultralytics.com/license) — AGPL option and paid alternative; no paid license is proposed here.

S17. [YOLO-NAS weight license](https://github.com/Deci-AI/super-gradients/blob/master/LICENSE.YOLONAS.md) — separate commercial-use restrictions.

S18. [MMDeploy ONNX deployment documentation](https://mmdeploy.readthedocs.io/en/latest/04-supported-codebases/mmdet.html) — versioned model/backend deploy configurations are required.

S19. [opencv-python build/package documentation](https://github.com/opencv/opencv-python) — CPU wheels and custom build options.
