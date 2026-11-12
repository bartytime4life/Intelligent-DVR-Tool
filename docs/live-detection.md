# Live AI and object tracking

Saved recording traces can be compared with independent anonymous object labels
using the [offline tracking evaluator](tracking-evaluation.md): identity switches,
misses, false tracks, MOTA, IDF1 and HOTA. Synthetic evaluator validation does not
establish physical-camera tracking accuracy.

[Guide index](README.md) · [Camera sources](local-camera-feeds.md) · [Recognition](recording-recognition.md) · [Review and Events](review-and-events.md) · [Product status](product-status.md)

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
   configured. Starting the app does not start inference.
2. Connect a webcam, DVR channel or approved public webcam as usual. Live AI
   settings list the configured model and rules; that availability check is not
   proof of model execution. A static or hosted copy explains why local AI is
   unavailable. The running tile reports the actual backend after explicit Start.
3. If several rule sets exist (for example ones saved by [Guided training](training.md)
   or exported from [Zones](zones.md)), choose one in **Rules**.
4. Press **Start AI** on the tile. Teal solid boxes are tracked objects with their
   track number; dashed grey boxes are detections not yet confirmed as a track.
5. When a rule fires, an amber observation appears under the tile. **Send to
   Events** puts it in the review queue with the analyzed still frame. Nothing
   reaches Events automatically. Observations stay sendable after **Stop AI** or
   disconnecting the preview. A disconnected source with unsent observations stays
   on the wall and in **Camera sources** as a temporary review card, without a
   camera image or active analysis. If
   this browser cannot store the still (private browsing, full storage), the
   observation is not sent and stays on the tile so you can retry.
6. If AI stops with an error (for example, the worker took too long), press
   **Start AI** again on the same tile; unsent observations are kept.
   If the local service restarted and the session expired, choose **Check again**
   in Live AI settings first, then explicitly **Start AI**. Rechecking preserves
   the camera preview and unsent observations; it does not start inference.
7. Press **Stop AI**, disconnect the camera, leave Monitor or hide the page to stop.

The tile reports class counts from its most recent analyzed frame, analyzed
frames per second, the time this computer took for the last frame, still frames
skipped by the motion gate, frames dropped while busy, rejected frames, and tracks
seen so far. Before the first result it says it is waiting; a missing reply is
never labeled as an empty scene. Counts and boxes both disappear when that
frame is more than 1.5 seconds old, and return with a fresh reply.

Each tile keeps at most 20 recent observations in memory. New observations can
replace older ones; a visible counter reports how many **unsent** observations
were replaced, including across AI restarts on that tile. Copies already sent to
Events do not count as lost. Send important observations to Events promptly.
Up to four sources can hold unsent live review at once (at most 80 unsent
observations). Starting or running AI reserves a slot before its first result.
When slots are full, another source can still connect for preview, but its
**Start AI** waits until you stop a source's AI and send or dismiss its unsent
observations. Empty disconnected cards disappear and release their stills;
successfully sent stills also leave the tile's memory.

**Stop AI**, **Disconnect**, **Disconnect all** and hiding the page keep the
temporary review available in Monitor and stop camera/AI activity immediately in
this page. Returning to the page never reconnects or starts AI automatically.
Leaving Monitor warns before discarding unsent observations; closing or reloading
the tab requests the browser's leave warning. Confirming departure clears the
temporary list and its replacement counter. Events retains only the observations
you explicitly sent. This temporary review does not survive a reload or app restart.

Only one live still is saved to Events at a time. While **Saving still…** appears,
other Send buttons and that observation's Dismiss button wait; camera Stop and
Disconnect remain available. A submitted Send can finish even after you confirm
leaving Monitor. If another live still is still saving when you return, wait for
it to finish before retrying Send. A failed save leaves the observation unsent.

Each browser image operation has a five-second budget for opening storage and
finishing its transaction together. If it cannot finish, **Saving still…** ends,
Send and Dismiss become available again, and the observation stays unsent. Free
browser storage, close other app tabs or check private-browsing restrictions,
then retry. A late completion cannot send it automatically. If the browser is
still finishing an old database open, retries fail promptly until that open ends;
they do not pile up more requests. Camera Stop and Disconnect stay available.
Browser suspension can delay timer delivery until the page runs again.

If Monitor says **Live AI setup needs attention**, camera preview stays available
and **Start AI** remains disabled. Run the platform's **Check** command, restart
the local app if needed, then choose **Check again** in Monitor. A successful
check restores the listed model and rules without reconnecting the camera or
starting analysis. If restarting the local service ended a network preview,
reconnect that source separately. Replies from replaced checks cannot replace
newer choices.

If a tile reports **Local AI sent an invalid or mismatched reply**, only that
AI run stops in this page. The camera preview and earlier unsent observations
remain available. Run the platform's **Check** command, restart the local service
if needed, then press **Start AI** explicitly to retry. You can still send an
earlier observation to Events; an invalid reply never replaces its analyzed still.
Monitor requests Stop for the accepted AI session, and an unconfirmed local
session expires after its existing 15-second lease.

Startup and frame replies are validated before displaying metadata, boxes,
counts or new observations. Frames must belong to the accepted camera, session
and model fingerprint, with the same model/rule selections when supplied.
Malformed, oversized or duplicate observation data rejects the whole reply.
This checks consistency of local service data; it does not establish recognition
accuracy or authenticate a physical camera.

### Limits

| Limit | Value | Why |
| --- | --- | --- |
| Cameras with live AI at once | 2 total, at most 1 optional GPU worker | Two threads per worker; GPU activation is explicit |
| Frames analyzed per camera | at most 5 per second, one in flight | No backlog; a busy worker refuses the next frame, which is counted |
| Frame size | JPEG up to 1 MiB and 1080p; the browser sends at most 960 px wide | Bounded decode and memory |
| Session | 15 minutes, then press Start AI again | Explicit, time-bounded activity |
| Lease | stops 15 s after the page stops sending frames | No orphaned work |
| Frame deadline | 6 s for transfer and reply together; a worker that stops reading is stopped | No request or session can hang |
| Worker | CPU memory/CPU-time caps; optional CUDA has a separate bounded policy | See [GPU resource policy](live-gpu.md#resource-policy-and-limits); macOS has no memory cap |
| Boxes | hidden 1.5 s after their frame | Old boxes never sit over newer video |
| Temporary live review | 4 sources × 20 observations, plus at most 1 submitted still save | Full review slots refuse another AI start; preview and Stop remain available |

On the owner's Apple M4 Mac, the pinned YOLOX-S CPU model took about 80–90 ms per
frame with two threads in development checks on one 960×540 test clip. That is a
single-machine development observation, not a qualified latency or capacity figure.

## Optional GPU execution

The local service defaults to a GPU-first preference. On Windows/Linux, an
eligible YOLOX-S session tries the pinned ONNX Runtime CUDA backend; macOS and
unsupported profiles use CPU. GPU startup must
prove actual CUDA-only execution; a failed attempt starts a fresh CPU worker.
Use `--live-backend opencv-cpu` to select CPU explicitly. The tile shows its
actual backend and fallback reason; a preference or available provider is not
execution evidence. See [setup, recovery and
resource limits](live-gpu.md) and the [November 2 measurement record](verification/live-gpu-2026-11-02/README.md).

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
the 80 COCO classes (Lin et al., 2014), runs through OpenCV DNN on CPU or the
verified CUDA path according to the selected service preference, with
the same preprocessing, decoding and per-class non-maximum suppression as
recording analysis. The worker verifies the model's SHA-256 against the catalog
before parsing it.

**Motion gate.** Most security-camera frames show an empty, unchanging scene.
Following the practice of running cheap motion detection before object detection
(as in the open-source Frigate NVR), the worker compares a 160-pixel-wide, blurred
grey copy of each frame with the previous one. When less than 0.2 % of pixels
change, no unexpired tentative/tracked/lost association needs a sample, and the detector ran within the last 2 seconds,
it skips the detector for that frame and reports "Still scene · detector resting".
Any motion or unexpired association runs the detector on every frame. Pending
confirmations and recovery attempts therefore keep receiving samples, even when
the numbered-summary cap hides a track from the public list. Once the existing
lost window expires, a still scene can rest again. This may add detector calls
during recovery; the empty-scene keyframe policy is unchanged.

**Tracking.** Tracks follow the two-stage association approach of ByteTrack
(Zhang et al., 2022) on a constant-velocity Kalman filter as in SORT (Bewley et al.,
2016). Tracker method `bytetrack-style-iou-kalman-v3` adapts the reference noise
weights as continuous diffusion rates for irregular sample intervals; it is not
an exact reproduction of the reference per-frame filter:

1. Predict each track's box with a Kalman filter over centre, aspect ratio, height
   and their velocities. ByteTrack tunes noise per 30 FPS frame; sampled and live
   frames advance by the elapsed time measured in those reference frames. Integrate
   velocity noise into position uncertainty over that interval, and use the Joseph
   covariance update to reduce cancellation error. Noise rates stay fixed at the
   predicted interval's starting height.
   Normalized detections use the first accepted frame's dimensions as fixed
   tracking units throughout the run. Resizing a later image therefore does not
   change stored coordinates, motion uncertainty or normalized track boxes.
   Actual incoming dimensions remain validated. This preserves coordinates under
   resizing; it does not compensate for a cropped, rotated or changed camera view.
2. Match confirmed and recently lost tracks to confident boxes (score ≥ 0.5) by
   IoU × score, using the Hungarian method (Kuhn, 1955) for the optimal
   assignment. Classes form independent assignment groups, so no cross-class
   matrix entries need to be computed. This preserves the optimal feasible match
   count and cost. Within a sparse class graph, disconnected feasible groups
   are solved independently, without removing any permitted edge. Dense graphs
   retain the original Hungarian solve; all IoU matrices still have their original
   dimensions. Tied optimal assignments can select different valid pairs.
3. Match tracks still unmatched to low-score boxes (0.1–0.5) by IoU ≥ 0.5. This is
   ByteTrack's key idea: a partly hidden or blurred person keeps their track
   instead of disappearing and returning with a new number.
4. Confirm a new track when its box is matched again in the next frame (boxes on
   the very first frame are confirmed at once). Start candidates from unmatched
   boxes scoring ≥ 0.6. Retire tracks unseen for more than 2 seconds **before**
   matching the next frame, including after a sampling pause. A returning box must
   establish a new track; the exact 2-second boundary remains eligible.

Matching is class-aware: a person box never continues a car track. A run numbers at most
2,000 tracks; later ones are still followed but unnumbered and counted as not
retained, so every number in a result has a summary. Each track
records when it was first and last seen, its scores, a path of up to 32 points,
and its time inside each rule zone of its class (centre point inside the zone,
counting gaps up to the rule's `max_gap`).

Long paths retain at most 2,000 regularly spaced hits plus the latest observed
point. When full, the tracker keeps every other stored hit and doubles the sample
stride. The reported path includes both observed endpoints and spans the whole
run. It is a coarse history of sampled detections, not an exact route or evidence
of movement between samples. Median duration averages the middle two durations
when the class has an even number of tracks.

The schema remains `intelligent-dvr.tracks.v1`; the method version and tracker
SHA-256 distinguish the changed algorithm. Existing results remain readable,
but current-version tracking evaluation requires re-analysis with this source.
See [algorithm checks and formulas](verification/tracking-algorithms-2026-11-11/README.md)
for generated comparisons and qualification limits.

**Rules.** Observations still come from the existing class-presence rule engine,
so live and recording observations mean the same thing: a class was present in a
zone for the dwell time. Per-track zone time is reported alongside, but rule
observations are not yet triggered by individual tracks.

A qualifying sample at the maximum-gap boundary continues the presence run;
reaching dwell emits once. Live and recording rules now share a bounded binary64
comparison with the browser training counter, preventing ordinary fractional
timestamps from falsely breaking a run. Real gaps still reset it. The
[timing record](verification/rule-time-boundaries-2026-11-12/README.md) separates
numerical resolution from physical-clock or tracking accuracy. The change is in
the presence rule engine; per-track zone-duration arithmetic is unchanged.

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

The existing [offline evaluation](offline-evaluation.md) measures detection
precision/recall; tracking metrics are the next evaluation step.

## Boundaries

- Explicit only: connecting a camera never starts AI, and AI stops with the preview.
- Local only: frames go from this browser to this computer's loopback service and
  are discarded after analysis. Only stills you send to Events are kept, in this
  browser's storage.
- Not identification: tracks are not identities and are not linked across cameras.
  [Person enrollment](person-enrollment.md) remains a separate, consent-based
  suggestion feature for recordings.
- Not recording: live AI keeps no footage. Use clip capture or the
  [LAN recorder](lan-recording.md) for evidence you can re-check.
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
