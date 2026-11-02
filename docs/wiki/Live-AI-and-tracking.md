# Live AI and object tracking

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Camera sources](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Camera-sources) · [Recognition](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recognition-details) · [Review and Events](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Review-and-events) · [Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status)

**Added November 1, 2026.** Two capabilities turn per-frame detections into
analysis you can watch and review:

- **Live AI on the Monitor.** Press **Start AI** on a camera tile and this computer
  runs the same pinned YOLOX-S detector used for recordings on the frames that tile
  shows. Boxes, class counts, track numbers and rule observations appear on the
  tile in real time. Nothing starts until you press the button, nothing is
  recorded, and frames go only to the local service on `127.0.0.1`.
- **Short-lived object tracks.** Recording analysis and live AI now link the same
  person or object across frames, giving numbered tracks (`person #3`), how long
  each one was seen and how long it spent in each rule zone. Recognition lists
  them and lets you jump to each track's first sample.

A track number is a continuity estimate within one camera and one run. It is
**not** an identity: numbers can switch where people cross, and someone who leaves
and returns gets a new number. Accuracy is unqualified until measured against
labeled footage (see [measure it](#measure-before-relying-on-it)).

## Use live AI

1. Start the local app (**Start-Mac.command**, or the PC launcher) with analysis
   configured. Monitor shows **Live AI · YOLOX-S · runs on this computer** when the
   model is ready. A static or hosted copy of the interface shows why AI is
   unavailable instead.
2. Connect a webcam, DVR channel or approved public webcam as usual.
3. If several rule sets exist (for example ones saved by [Guided training](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-training)
   or exported from [Zones](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Zones)), choose one in **Rules**.
4. Press **Start AI** on the tile. Teal solid boxes are tracked objects with their
   track number; dashed grey boxes are detections not yet confirmed as a track.
5. When a rule fires, an amber observation appears under the tile. **Send to
   Events** puts it in the review queue with the analyzed still frame. Nothing
   reaches Events automatically. Observations stay sendable after **Stop AI**. If
   this browser cannot store the still (private browsing, full storage), the
   observation is not sent and stays on the tile so you can retry.
6. If AI stops with an error (for example, the worker took too long), press
   **Start AI** again on the same tile; unsent observations are kept.
7. Press **Stop AI**, disconnect the camera, leave Monitor or hide the page to stop.

The tile reports what the AI is doing: counts of what it currently sees, analyzed
frames per second, the time this computer took for the last frame, still frames
skipped by the motion gate, frames dropped while busy, and tracks seen so far.

### Limits

| Limit | Value | Why |
| --- | --- | --- |
| Cameras with live AI at once | 2 | Each worker uses two CPU threads |
| Frames analyzed per camera | at most 5 per second, one in flight | No backlog; a busy worker refuses the next frame, which is counted |
| Frame size | JPEG up to 1 MiB and 1080p; the browser sends at most 960 px wide | Bounded decode and memory |
| Session | 15 minutes, then press Start AI again | Explicit, time-bounded activity |
| Lease | stops 15 s after the page stops sending frames | No orphaned work |
| Frame deadline | 6 s for transfer and reply together; a worker that stops reading is stopped | No request or session can hang |
| Worker | memory/CPU-time caps (memory cap on Linux/Windows; macOS refuses address-space limits) | Same isolation as recording jobs |
| Boxes | hidden 1.5 s after their frame | Old boxes never sit over newer video |

On the owner's Apple M4 Mac, the pinned YOLOX-S CPU model took about 80–90 ms per
frame with two threads in development checks on one 960×540 test clip. That is a
single-machine development observation, not a qualified latency or capacity figure.

## How it works

```
camera tile ──JPEG (≤960 px, ≤5/s)──▶ local service ──▶ live worker (one per camera)
     ▲                                                   1. decode, size checks
     │                                                   2. motion gate
     └──── boxes, tracks, counts, observations ◀──────── 3. YOLOX-S → NMS
                                                         4. ByteTrack-style tracker
                                                         5. rule engine (same as recordings)
```

**Detection.** The pinned OpenCV Zoo YOLOX-S model (Ge et al., 2021), trained on
the 80 COCO classes (Lin et al., 2014), runs on the CPU through OpenCV DNN with
the same preprocessing, decoding and per-class non-maximum suppression as
recording analysis. The worker verifies the model's SHA-256 against the catalog
before parsing it.

**Motion gate.** Most security-camera frames show an empty, unchanging scene.
Following the practice of running cheap motion detection before object detection
(as in the open-source Frigate NVR), the worker compares a 160-pixel-wide, blurred
grey copy of each frame with the previous one. When less than 0.2 % of pixels
change, nothing is being tracked and the detector ran within the last 2 seconds,
it skips the detector for that frame and reports "Still scene · detector resting".
Any motion or any tracked object runs the detector on every frame.

**Tracking.** Tracks follow ByteTrack (Zhang et al., 2022) on the constant-velocity
Kalman filter of SORT (Bewley et al., 2016), with the reference implementation's
noise weights:

1. Predict each track's box with a Kalman filter over centre, aspect ratio, height
   and their velocities. ByteTrack tunes noise per 30 FPS frame; sampled and live
   frames advance by the elapsed time measured in those reference frames.
2. Match confirmed and recently lost tracks to confident boxes (score ≥ 0.5) by
   IoU × score, using the Hungarian method (Kuhn, 1955) for the optimal
   assignment.
3. Match tracks still unmatched to low-score boxes (0.1–0.5) by IoU ≥ 0.5. This is
   ByteTrack's key idea: a partly hidden or blurred person keeps their track
   instead of disappearing and returning with a new number.
4. Confirm a new track when its box is matched again in the next frame (boxes on
   the very first frame are confirmed at once). Start candidates from unmatched
   boxes scoring ≥ 0.6. Drop tracks unseen for 2 seconds.

Matching is class-aware: a person box never continues a car track. A run numbers at most
2,000 tracks; later ones are still followed but unnumbered and counted as not
retained, so every number in a result has a summary. Each track
records when it was first and last seen, its scores, a path of up to 32 points,
and its time inside each rule zone of its class (centre point inside the zone,
counting gaps up to the rule's `max_gap`).

**Rules.** Observations still come from the existing class-presence rule engine,
so live and recording observations mean the same thing: a class was present in a
zone for the dwell time. Per-track zone time is reported alongside, but rule
observations are not yet triggered by individual tracks.

## In Recognition

New recording analyses add a `track` number to tracked boxes in the frame trace and
a `tracking` record (schema `intelligent-dvr.tracks.v1`) with every track and a
per-class summary. Recognition:

- labels boxes `person #3 0.91`;
- shows a **Tracks** panel with the number of tracks per class, the median and
  longest durations, and the longest tracks with their zone time; selecting a
  track opens its first sample;
- validates that every track number refers to a track of the same class that spans
  that frame, and rejects results that do not.

Results created before this change have no tracks and open as before. Receipts
carry a compact per-class track summary and the tracker's SHA-256.

## Measure before relying on it

The tracker and live path are tested with synthetic boxes, a constant-output test
model and Chromium's synthetic camera. Those tests check continuity rules,
protocol, limits and the interface, not how well real people are followed.

Before relying on track counts or dwell times at a site:

1. Record representative clips (day, night, crowds, occlusion, each camera angle).
2. Label boxes **with identities across frames** for a held-out set.
3. Report the standard multi-object tracking measures: MOTA and ID switches
   (CLEAR MOT; Bernardin and Stiefelhagen, 2008), IDF1 (Ristani et al., 2016) and
   HOTA (Luiten et al., 2021), with the sampling stride you will use.
4. Tune the thresholds above only on clips separate from the final evaluation.

The existing [offline evaluation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-evaluation) measures detection
precision/recall; tracking metrics are the next evaluation step.

## Boundaries

- Explicit only: connecting a camera never starts AI, and AI stops with the preview.
- Local only: frames go from this browser to this computer's loopback service and
  are discarded after analysis. Only stills you send to Events are kept, in this
  browser's storage.
- Not identification: tracks are not identities and are not linked across cameras.
  [Person enrollment](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Person-enrollment) remains a separate, consent-based
  suggestion feature for recordings.
- Not recording: live AI keeps no footage. Use clip capture or the
  [LAN recorder](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/LAN-recording) for evidence you can re-check.
- Not qualified: detection and tracking accuracy, latency on other hardware and
  multi-camera capacity (including the 100-camera requirement) are unqualified.
- Live observations in Events need this version of the app: an older build that
  opens a queue containing them treats the saved queue as unreadable and keeps a
  browser backup instead of loading it.

## References

- Bewley, Ge, Ott, Ramos and Upcroft. *Simple Online and Realtime Tracking.* ICIP 2016. [arXiv:1602.00763](https://arxiv.org/abs/1602.00763)
- Wojke, Bewley and Paulus. *Simple Online and Realtime Tracking with a Deep Association Metric.* ICIP 2017. [arXiv:1703.07402](https://arxiv.org/abs/1703.07402)
- Zhang et al. *ByteTrack: Multi-Object Tracking by Associating Every Detection Box.* ECCV 2022. [arXiv:2110.06864](https://arxiv.org/abs/2110.06864); [reference implementation](https://github.com/ifzhang/ByteTrack)
- Ge, Liu, Wang, Li and Sun. *YOLOX: Exceeding YOLO Series in 2021.* [arXiv:2107.08430](https://arxiv.org/abs/2107.08430)
- Lin et al. *Microsoft COCO: Common Objects in Context.* ECCV 2014. [arXiv:1405.0312](https://arxiv.org/abs/1405.0312)
- Kalman. *A New Approach to Linear Filtering and Prediction Problems.* Journal of Basic Engineering, 1960.
- Kuhn. *The Hungarian Method for the Assignment Problem.* Naval Research Logistics Quarterly, 1955; Munkres, *Algorithms for the Assignment and Transportation Problems*, 1957.
- Bernardin and Stiefelhagen. *Evaluating Multiple Object Tracking Performance: The CLEAR MOT Metrics.* EURASIP JIVP, 2008.
- Ristani, Solera, Zou, Cucchiara and Tomasi. *Performance Measures and a Data Set for Multi-Target, Multi-Camera Tracking.* ECCV Workshops 2016.
- Luiten et al. *HOTA: A Higher Order Metric for Evaluating Multi-Object Tracking.* IJCV, 2021.
- Bar-Shalom, Li and Kirubarajan. *Estimation with Applications to Tracking and Navigation.* Wiley, 2001 (Kalman filtering for tracking).
- Szeliski. *Computer Vision: Algorithms and Applications*, 2nd ed. Springer, 2022 (detection, motion and tracking background).
- Frigate NVR, motion-gated object detection and stationary-object handling: [project](https://github.com/blakeblackshear/frigate) and [release notes](https://github.com/blakeblackshear/frigate/releases/tag/v0.10.0-beta1).

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/live-detection.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
