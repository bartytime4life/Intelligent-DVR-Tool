# Saved-recording sharpening comparison

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) · [Screenshot atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) · [Troubleshooting](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Troubleshooting)

![Workflow diagram for enhancement comparison.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/recording.svg)

**Quick path:** Connect local analysis → select a recording → enable the optional comparison → inspect original and candidate results separately.

Recognition has an **optional, experimental mild-sharpening comparison**. It
reuses the configured detector on the exact same decoded samples. The original
recording stays unchanged. Original detections remain the source of rule
observations, decisions and Events. Sharpened detections are separate comparison
data. This transform uses OpenCV without neural weights, downloads or GPU setup.
Recording analysis also requires [coverage validation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-coverage),
which adds the optional PyAV dependency. It does not implement Real-ESRGAN/SwinIR, increase resolution, restore
faces or identities, or establish better detection accuracy.

## Use in Recognition

Connect local analysis, select a saved recording, model and rules, then select
**Compare mild sharpening (experimental)** before pressing **Analyze recording**.
The option starts unchecked. Camera previews and the LAN recorder do not enable
it. For a recorder-owned segment, save its analyzed recording and import that
local file for an explicit comparison.

Results initially show original detections. **Detection input** switches boxes
and scene counts between original and sharpened inputs. The player always shows
the hash-matched **original footage**, not enhanced pixels. Selecting a rule
observation returns to original detections. Source matching, paused-sample timing
and geometry checks still gate overlays.

Reports include separate repeated detection counts and processing times. JSON
and printable HTML retain the profile, parameters and implementation hash.
**Download sharpening CSV** exports per-sample counts, timings and pixel hashes.
The existing observations CSV continues to describe original-only rules. Save
recognition results plus the exact source to reopen a comparison.

## Transform, provenance and bounds

`mild-unsharp-v1` blurs uint8 BGR pixels with a 5×5 Gaussian kernel, sigma 1.0
and reflect-101 borders. Saturating `1.5 × original − 0.5 × blurred` supplies the
sharpened value. Each channel keeps its original value when the absolute
original/blurred difference is below 3. Scale is 1; dimensions/timestamps stay
unchanged. Flat regions and tiny differences may remain unchanged; clipping and
noise amplification remain possible. This is a conventional unsharp-mask control.

Receipt and trace share `intelligent-dvr.enhancement-comparison.v1` metadata under
`enhancement_comparison`: profile, exact parameters, SHA-256 of
`edge/enhancement.py`, `qualification: unqualified`, and
`rule_observations: original-only`. Each sampled frame adds `comparison` with
candidate detections, processing durations and SHA-256 values over original and
enhanced **row-major uint8 BGR pixel bytes**. Frame dimensions specify geometry.
Source/model/label/rule/runtime provenance remains in the existing trace.

Fingerprints detect mismatches; they are not signatures or proof of authenticity.
No enhanced video, image cache or thumbnails are written. Unknown profiles,
missing samples, invalid hashes/boxes or exceeded bounds fail instead of silently
publishing a baseline-only success. Service/evaluator require the current
implementation hash. The browser can inspect older declared implementations of
the known profile; it validates bindings, not unsigned declarations' truth.

The service retains its five-minute wall deadline, 4 GiB process-memory bound,
6,000 decoded frames, stride 5, two CPU threads and 32 MiB review bound. CLI
resource/frame controls still apply. Both detection inventories share the
100,000-detection trace limit and at most 10,000 sampled frames. Failures stop
publication; frame/event limits still mark coverage partial. No extra storage
quota or concurrency is introduced. Extra inference cost may require shorter
recordings. Linux last-job recovery preserves the paired result without rerunning
analysis; Windows temporary-result behavior remains unchanged.

Original runs first on each sample, then the same detector processes its
sharpened counterpart. Processing timings include preprocessing, inference and
decode/NMS; the candidate also includes sharpening. They exclude media reads,
pixel hashing, reports and review. Warmup/cache/order can bias the comparison:
these are sequential measurements, not randomized benchmarks, end-to-end camera
lag or sustained throughput.

## CLI and labeled evaluation

Use new output filenames in an existing private local directory:

```bash
python3 -m edge.analyze \
  --video /private/pilot/clip.avi \
  --model /private/models/object_detection_yolox_2022nov.onnx \
  --labels edge/labels/coco80.json --profile opencv-zoo-yolox-s-2022nov \
  --rules /private/pilot/rules.json --camera pilot-01 \
  --compare-enhancement mild-unsharp-v1 \
  --output /private/pilot/receipt.json \
  --trace-output /private/pilot/trace.json \
  --review-output /private/pilot/review.json
```

The existing [offline evaluator](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-evaluation) evaluates both inventories
against the same exhaustive labels, sampled frames, classes and thresholds.
Ordinary quality/alert fields remain original-only. `enhancement_comparison`
contains independent candidate TP/FP/FN, precision/recall, source/frame/hash error
evidence and separate processing-time distributions. Every pooled clip must have
the same comparison declaration. Undefined metrics stay null; warmup exclusions
affect timings only. More detections do not establish better accuracy.

The current evaluator requires verified constant-frame-rate source coverage.
Variable-rate or recorder wall-clock timing needs separate qualification; this
feature does not infer or repair missing timestamps.

## Candidate research and reference use

Selected upstream sections were reviewed October 30, 2026 local time:

| Source/section | Concrete effect | Remaining evidence |
| --- | --- | --- |
| [Real-ESRGAN general-image model zoo](https://github.com/xinntao/Real-ESRGAN/blob/master/docs/model_zoo.md) and [inference options](https://github.com/xinntao/Real-ESRGAN/blob/master/inference_realesrgan.py) | Keep x2 restoration and bounded tiles as candidates, with explicit precision/profile and no automatic downloads. | No artifact/runtime/VRAM or detection improvement qualified here. |
| [SwinIR README](https://github.com/JingyunLiang/SwinIR), tasks/license | Consider denoising and compression-artifact removal separately from upscaling. | Weight-specific rights, runtime and camera-domain quality checks remain. |
| [GFPGAN model comparison](https://github.com/TencentARC/GFPGAN#model-zoo), identity-change weakness; [CodeFormer license](https://github.com/sczhou/CodeFormer/blob/master/LICENSE) | Keep face synthesis out of this comparison; CodeFormer's published license restricts use to noncommercial purposes. | No identity restoration/recognition added. |
| [Cui et al., ECCV 2022](https://arxiv.org/abs/2208.03062), abstract/introduction | Require labeled paired results because restoration/degradation mismatch can impair detection. | Published results do not measure this DVR. |

The local camera-compatibility branch's `docs/offline-evaluation.md` reference
register at revision `a6c4ae52e11a329722d30cb2d65ca50afb56bb76` was consulted:
Bishop, *Pattern Recognition and Machine Learning*, §1.3 (PDF 51–52 /
printed 32–33), and *AI Concepts Using Python*, §§11.2.3–11.2.4 (PDF 278–280).
This reuses the recorded selected-section review, not a new complete-book reading.
It informs separate development/final-test scenes and detection/tracking limits.
Reference files stay read-only; they are not training data or copied code.

Before admitting a neural profile, check weight/license provenance and hash,
runtime numerical agreement, geometry, bounded memory/tiles, failure behavior
and actual timing. The detector's 640-pixel input makes full-frame upscale then
downscale an uncertain benefit. Compare tiles/crops as a distinct experiment,
including missed-object and negative regions rather than only baseline findings.
VRAM must be measured for the selected model, resolution, precision and tile size;
no fixed 2–4 GB promise is made.

Synthetic checks establish arithmetic, pixel/source preservation, native handoff,
failure handling and recovery. They do not establish camera accuracy. Next use
approved, independently labeled recordings with people, vehicles, negatives,
small/distant objects, noise, compression, motion and varied lighting. Select
settings on development scenes, freeze them, then test separate recordings or
cameras. Report per-class misses, false detections, precision/recall, sample sizes
and resource costs, including regressions. Keep original detection available;
do not automatically promote candidates. Physical-camera, Windows runtime/install,
sustained recording and 100-camera acceptance remain separate checks.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/enhancement-comparison.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
