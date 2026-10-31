# Recording recognition pilot

The local application now offers an explicit recording-to-analysis workflow with
progress, cancellation and automatic source-matched result opening. See
[local analysis setup and limits](local-analysis-service.md). The command-line
workflow below remains available for existing receipt users.

[Home](../README.md) · [Analyzer](../edge/README.md) · [Deployment path](roadmap.md#recognition-deployment-path--october-29-2026)

The implemented local milestone is a bounded **one-recording recognition and human
review workflow**. The analyzer runs the selected local model; the Recognition
workspace displays its actual sampled detections against the matching recording.
The Monitor workspace still contains generated samples.

## Run one approved recording

Use the existing CPU environment, hash-bound YOLOX-S artifact and exact COCO80
labels described in the [model qualification guide](model-qualification-20261026.md).
No model is downloaded by this command. Review the recording and rules first.
The following full-frame rule file is a starting point for presence observations,
not a calibrated site alarm configuration:

```json
[
  {"name":"Visible person","label":"person","rect":[0,0,1,1],"dwell":0,"threshold":0.5,"max_gap":2},
  {"name":"Visible car","label":"car","rect":[0,0,1,1],"dwell":0,"threshold":0.5,"max_gap":2}
]
```

Save reviewed rules locally. Create the output directory, then use new output
filenames for each run:

```bash
.venv/bin/python -m edge.analyze \
  --video recordings/approved-clip.mp4 \
  --model models/yolox-s.onnx --labels edge/labels/coco80.json \
  --profile opencv-zoo-yolox-s-2022nov --backend opencv-cpu \
  --rules receipts/reviewed-rules.json --camera pilot-01 \
  --threads 4 --stride 5 --max-frames 6000 \
  --output receipts/pilot-01-receipt.json \
  --review-output receipts/pilot-01-review.json
```

The optional CUDA backend remains an explicit selection in its separately
qualified environment, with no automatic fallback. The local application job
service uses CPU; its model/rule selectors do not select a CUDA backend. A trace can still be requested independently with
`--trace-output`; review output contains its own trace without needing that flag.

## Review what the detector observed

1. Open **Recognition** (or the local application's `/#recognition` route).
2. Choose the generated `pilot-01-review.json`.
3. Choose the **original** recording. The browser computes its SHA-256 and
   requires an exact match before attaching footage or boxes.
4. Use Previous/Next sample or the sample slider. Boxes and class/score labels
   appear only while paused on the corresponding sampled frame. Playback hides
   boxes; stale detections are never projected onto intervening video frames.
5. Inspect person/object counts, labels and scores. The display threshold changes
   only what is shown. Counts are per sampled frame, not unique objects or people.
6. Select an observation to inspect its frame. **Send observations to Events**,
   then confirm/dismiss and export review decisions using the existing controls.
   Reimporting the same observations preserves decisions/notes. An import that
   would exceed 1,000 events is refused instead of silently dropping records.

The video and loaded review bundle stay transient in the browser. Navigating
between workspaces retains them and pauses hidden playback; page reload/close
releases the browser session. Reconnecting to a running local service can reopen
its retained result. Imported event decisions use existing localStorage and need
explicit export for a backup. The optional local job API requires explicit start;
there is no footage upload, camera connection or installed background service.
Existing optional fonts/maps retain their documented destinations.

## Contract and bounds

`intelligent-dvr.recognition-review.v1` contains an unchanged v1 receipt and its
frame trace. The parser checks source/model/labels/rules hashes, camera/profile,
sampling/state agreement, event agreement, frame ordering/times/dimensions and
normalized detections. Observations must point to analyzed frames. The analyzer
checks source/model/labels/rules hashes again before publishing a review run.
This catches persistent input changes, not hostile mutation-and-restoration.

- Review file: 32 MiB; at most 10,000 sampled frames and 100,000 detections.
- Original recording in the browser: 512 MiB. Hashing uses a bounded full-file
  buffer and requires a secure context (localhost or HTTPS). Split larger sources
  before analysis. Outputs hold metadata only; recordings/models are not copied.
- Rendered boxes/score rows: first 200 per selected frame; a visible notice
  reports truncation while counts include all detections above the display score.
- Outputs are exclusively created and cleaned up after a normal write failure.
  They are not an atomic, crash-durable multi-file transaction or signed evidence.
- Browser codec support varies. A converted recording has different bytes and
  must be analyzed again; never attach detections by filename alone.

## What this milestone establishes

Person and other trained-class detection, simple sampled scene inventories,
configured class-presence/dwell observations, and human inspection of matching
source frames form one usable offline workflow. **Learned scene interpretation,
behavior/anomaly classification, identity, within-camera tracking and cross-camera
association are not implemented by it.** Scores are model outputs, not calibrated
probabilities or findings of fact.

A `partial` run remains prominently partial. Even `completed` means only that
the analyzer stopped without hitting its explicit limits: OpenCV read failure is
not distinguishable from EOF here. Constant-frame-rate timing and browser seek
behavior need qualification for the intended codec. Unsupported/unmatched frames
hide boxes. Ground-truth labels, representative quality, live recording durability,
operator acceptance and the 100-camera target remain separate gates.

[Dated local evidence](verification/recognition-2026-10-29/README.md) separates
actual model execution from synthetic contract/browser checks.


## Review continuity and recovery

Recognition keeps the chosen recording, sample position and display threshold in
memory while you switch workspaces. Playback pauses when you leave Recognition
or hide the browser tab. Returning does not resume playback automatically.
Reloading or closing the page releases this session; footage is never saved to
browser storage or uploaded.

Sending observations opens Events with filters cleared. Receipt imports and
recognition imports preserve existing decisions and notes for matching evidence.
A reused ID with different source/model/observation fields is rejected. Queue
capacity is 1,000 records across model and sample observations. Every insertion
refuses overflow without truncating older records.

## Zones from camera images

Zones can be drawn on a real still instead of the planning grid. Use
**Use for zones** on a live Monitor preview, **Use this frame for zones** under a
matched Recognition sample, or **Choose image file** in Zones. A captured still
waits until you choose **Use for Plan N**; it is re-encoded as JPEG (dropping
file metadata) and kept in this browser's IndexedDB for that plan. With a still,
the editor takes the image's aspect ratio and rectangles use normalized
full-frame coordinates, the same convention as `edge/rules.py` and the analyzer's
detection boxes.

Pick the model class to observe from the bundled COCO labels and set the allowed
gap between sightings. **Export analyzer rules** writes a bare JSON list of
`{name, label, rect, dwell, threshold, max_gap}` that `edge/rules.py` loads
unchanged; list the file in the local analysis configuration to use it. Rules
still saved with the legacy `object` label load, but must choose a model class
before export. **Back up browser rules** keeps the browser's own format and is not
an analyzer file. A still from a different resolution or framing than the
recordings you analyze will misplace the zone; capture it from the same camera
stream.

## Faster review

- **Keyboard review.** In the review dialog, **C** confirms, **D** dismisses and
  **J/K** (or the arrow keys) move between observations awaiting review. Keys are
  ignored while you type a note. After a decision the dialog opens the next
  observation awaiting review in the order Events is showing, with "N of M".
- **Filters and order.** Filter by camera or source and by recording (the first
  eight characters of its SHA-256), as well as status, kind and search text.
  Sort by newest added, highest score or clip time.
- **Bulk dismissal.** **Dismiss N shown awaiting review** applies to the current
  filters only, after a confirmation. Undo lasts until the page closes and keeps
  any decision you made afterwards.
- **CSV export.** **Export shown as CSV** downloads the shown rows with status,
  source, clip time, scores, hashes and notes. Cells that a spreadsheet would
  treat as formulas are neutralized.
- **Stills.** Sending observations from a matched recording, or with
  **Send to Events** on a completed LAN segment, keeps one small JPEG still
  (160 px wide) per observation in this browser's IndexedDB. Stills are drawn
  from the verified local recording, are never uploaded, and are removed when
  their observations leave the queue; they stay while **Undo clear** can restore
  them. A still is a visual reminder, not evidence: open the recording in
  Recognition to verify.
- **LAN segments.** Each completed segment shows its observation count when the
  service reports it. **Only segments with observations** narrows the list,
  and a badge counts completed segments you have not reviewed or sent yet in this
  page. **Send to Events** is explicit per segment and leaves the current review
  open; nothing enters the queue automatically. A warning appears when sampled
  times may lag real time by more than 0.5 s.

Events includes source/status/search filters, queue counts, review export and an
explicit **Clear queue** dialog. Export first to retain decisions outside the
browser. Clear leaves an actually empty queue, allowing a full 1,000-observation
run. **Undo clear** lasts until reload/close and merges with current decisions;
it refuses overflow or conflicting evidence. Clearing again explicitly replaces
the previous undo copy; the dialog offers its export first. Import a review export
to restore decisions after a reload. Review file imports are bounded to 8 MiB.

Sample reset keeps imported observations and all reviewed samples. Save failures
produce a persistent banner with export actions. Success toasts say “updated”
rather than claiming durable storage. Workspace URLs support bookmarks and browser
Back/Forward; recognition metadata and footage are not encoded in URLs.
