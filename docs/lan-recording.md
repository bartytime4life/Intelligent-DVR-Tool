# One configured LAN camera → segments → recognition

This opt-in pilot records one authorized RTSP channel and feeds finalized segments
into the existing local CPU analyzer. It reuses the configured-source allowlist,
pinned TCP relay, OpenCV decoder, model/rule catalog, Jobs service and Recognition
review contract. It does not add FFmpeg executables, another inference server,
ONVIF discovery, camera scanning, vendor cloud access, audio or public-camera capture.
The source may be a DVR/NVR's documented RTSP channel or a standalone IP camera.

**Qualification:** controlled-source tests are engineering evidence, not physical
camera acceptance, recognition accuracy, continuous archival recording or a
100-camera capacity claim. See the [verification record](verification/lan-recorder-2026-10-30/README.md).

## Configure and start deliberately

1. Complete [PC setup and pinned model preparation](pc-testing.md). Configure an
   authorized fixed private-IPv4 RTSP channel in `local-feeds.json`, using the
   existing [feed guide](local-camera-feeds.md). Use a dedicated viewer account.
2. Copy `edge/lan-recorder.example.json` to `local-recorder.json`. Set `source`
   to exactly one ID from that local feed list, and review the retention limits.
   The recorder configuration contains no camera credentials. No source is inferred.
3. Enable the recorder using the ordinary launcher:

   ```bash
   bash scripts/run-linux.sh --analysis --recorder-config local-recorder.json
   ```

   ```powershell
   .\scripts\Start-IntelligentDvr.ps1 -Analysis -RecorderConfig .\local-recorder.json
   ```

   Custom `--recordings`/`--config` (Windows `-Recordings`/`-AnalysisConfig`)
   continue to work. Direct invocation also accepts `--recorder-config` with
   `--recordings`, `--config` and `--feeds-config`. `--check` / `-Check` validates
   configuration without connecting a camera; it does not qualify camera access,
   sustained performance or recorder storage recovery. The normal installer and
   launcher never start recording. No model download or paid inference is added.
4. Open **Recognition → Connect LAN recorder**. Select the prepared model and
   appropriate rules. Press **Start recording & analysis** only after approving
   the camera, permitted recording purpose and local retention.
5. Completed segments appear in the list. **Review segment** checks the exact
   source hash and uses the existing detection overlays and reviewed HTML/JSON/CSV
   reports. Save the recognition bundle and analyzed recording for longer retention.
   **Save timing** exports the sampled frame receive times and recording metrics.
6. Press **Stop recording & analysis** to stop capture and cancel active analysis.
   The unfinished capture is discarded. Verified queued recordings remain for an
   explicit later Start, using their originally selected model/rule IDs. Closing
   the page does not stop a session. Closing the local service does. After any
   service restart, recording and analysis remain stopped until another Start.

Only one recorder exists per service and recording directory. It claims the
existing one-job analyzer while active; separate manual jobs/imports are refused
until Stop completes. The recorder copies each successful source-matched review
into its own retained segment directory before the next analysis. Its temporary
analysis copies are then removed. Optional Linux manual last-job recovery stays
separate and is not overwritten by recorder jobs. Recorder retention/recovery
also runs on Windows; Linux-only manual `--state-dir` restrictions are unchanged.

## Bounds and retention

| Setting | Default | Allowed range / behavior |
| --- | ---: | --- |
| `segment_seconds` | 10 | 5–60 wall seconds after decoder open; one fresh connection per segment |
| `max_segments` | 20 | 2–100 retained metadata entries including failed/queued work |
| `max_storage_mib` | 1024 | 256–8192 MiB for the dedicated recorder directory |
| `retention_minutes` | 60 | 1–10080 minutes from segment attempt creation |
| `reserve_mib` | 512 | 256–16384 MiB free-space floor; checked before and during capture and before result retention |
| Native capture | 1 worker | Existing 2 GiB process bound; input at most 1080p, output at most 960px / 10 sampled fps |
| Segment | 32 MiB | Video-only VP8/WebM, fully decoded and frame-count checked before completion |
| Recognition | 1 CPU job | Existing 2 threads, stride 5, 6,000-frame / 300-second / 4 GiB limits; incomplete results are not promoted |
| Queue policy | FIFO | Oldest unprotected entries expire by age, count, byte budget or free-space reserve, including pending work |
| Reconnect | 2–60 seconds | Bounded exponential delay after failure while explicitly running; Stop cancels retries |

Storage lives under `.lan-recorder` in the configured recordings folder. The
normal shallow recording/import catalog does not enumerate it. A dedicated
OS-released owner lock excludes another service using that directory. Linux uses
0700 owner-only directories; on Windows, use an account-private NTFS installation
folder with appropriate inherited ACLs. This does not implement an OS credential
vault or encrypt footage. Do not place it on a shared/public filesystem.

Retention runs while the recorder is explicitly active. Stopped services preserve
files; the next Start applies elapsed-age limits before processing queued work.
Active capture/analysis entries, and entries being downloaded, are protected until
their operation ends. The quota includes partial files, retained result JSON and the
single analysis working directory, which counts once against the running analysis
reservation. Conservative allocation estimates include source/model/result copies
before analysis and another segment before capture. A service restart removes
recognized interrupted working files before accepting a new session. When other
data drops free space below `reserve_mib`, the oldest unprotected entries are
expired only if removing them restores the reserve; otherwise the recorder reports
`disk_pressure` and keeps them. Free-space checks cannot reserve space against other
applications, so external disk pressure can still cause an explicit failure. A
segment whose worker already finished is accepted on its integrity checks even if
the supervisor observes it late. Native encoder buffering permits a small transient overshoot,
especially on Windows, which has no per-process file-size quota. This is bounded
application storage management, not an OS disk quota or protection against a hostile OS.

Expired files are deleted. Export required evidence before retention removes it.
`dropped` counts failed/interrupted segment attempts, failed analyses and expired
queued segments; it is not a count of camera packets or lost frames. `expired`
is the total number of entries removed by retention, including successful pairs.
Each removal is also counted by reason:

| Counter | Removal reason |
| --- | --- |
| `expired_age` | Older than `retention_minutes` |
| `evicted_space` | This store's `max_segments` or `max_storage_mib` budget needed room |
| `evicted_disk` | The volume's free space fell below `reserve_mib` and removing entries restored it |

Stores created before this split keep their earlier removals in `expired` only,
with the three reason counters starting at zero. Counters persist across restarts.
The list keeps only a bounded number of recent entries. These counters are unsigned
local operating data, not an authenticated audit log.

## Status fields and failure causes

`GET /api/recorder/status` also reports:

- `supervisor: {alive, last_tick_age_seconds}` — whether the supervision thread is
  running and how long ago it last finished a tick. If the thread has stopped, or
  the tick age keeps growing, nothing records, analyzes or expires.
- On each row, `cause` is a fixed code that refines `error`. It is never a path,
  URL, address or credential. For `ANALYSIS_FAILED`, it is the analysis job's
  code. Examples: `NO_FRAMES`, `VIDEO_OPEN_FAILED`, `MODEL_LOAD_FAILED`,
  `STRIDE_EXCEEDS_GAP`, `MEDIA_INCOMPLETE`, `TIME_LIMIT`, `CPU_LIMIT` (SIGXCPU),
  `MEMORY_LIMIT`, `WORKER_KILLED`. When a later step fails, the cause names that
  step: `RESULT_PARTIAL`, `INTEGRITY_FAILED`, `RESULT_STORAGE_PRESSURE`,
  `RESULT_MISMATCH` or `RESULT_WRITE_FAILED`. For `CONNECTION_OR_ENCODER_FAILED`,
  the cause comes from the capture worker: `STREAM_OPEN_FAILED`,
  `STREAM_INTERRUPTED`, `UPSTREAM_UNREACHABLE`, `RTSP_UNAUTHORIZED`,
  `RTSP_NOT_FOUND`, `RTSP_STATUS_4XX`/`5XX`, `REDIRECT_REFUSED`,
  `RTSP_RESPONSE_INVALID`, `DIMENSIONS_UNSUPPORTED`, `ENCODER_UNAVAILABLE`,
  `CAPTURE_DEADLINE`, `SEGMENT_LIMIT` or `SEGMENT_VERIFY_FAILED`. A signal exit
  without a code is also classified. The cause is `null` when nothing more
  specific is known.
- Completed rows have `observations`, the number of events in that segment's
  retained review receipt. Rows completed before this field existed are filled in
  at the next service start.
- Recorded rows have `timing_drift_seconds` = `missed_sample_slots` × 0.1. Clip
  time runs behind local receive time by this amount at the end of the segment.

A worker reports its code through a bounded `failure.json` file, which the parent
parses strictly. This file is an expected artifact in segment and analysis working
folders and never blocks storage inspection. With `--state-dir`, the same codes and
row/job IDs go to the [diagnostic log](../SECURITY.md#worker-failure-codes-and-the-diagnostic-log).

## Per-segment analysis cost

Each Start verifies the selected model once. The first segment job copies it into
the recorder's private `work/model.onnx` and checks the copy against the pinned
SHA-256. Later segment jobs in the same session reuse that copy while its file
signature (device, inode, size, modification time) is unchanged. Otherwise the
next job copies and verifies it again. Stop removes the copy, and a restart clears
`work/`. The analyzer now hashes the model once. The CPU backend checks the parsed
bytes against that hash, and the hash is bound into the receipt. The service still
compares the receipt's model hash with the pinned value, so a copy that changed
without a signature change is refused (`MODEL_LOAD_FAILED` or `RESULT_MISMATCH`).
The cached copy counts toward `max_storage_mib` and toward the running analysis
reservation.

Measured on 2026-10-31 (AMD Ryzen 9 9950X, Linux, Python 3.12), using the synthetic
fixture: a 10-second, 99-frame 640×480 segment, with 21 segment jobs per row after
the first. These are plumbing timings, not camera or model performance:

| Fixture model | Version | Parent preparation | Worker run | Job wall time |
| --- | --- | ---: | ---: | ---: |
| 393 B constant ONNX | before | 0.9 ms | 146 ms | 0.203 s |
| 393 B constant ONNX | after | 0.7 ms | 144 ms | 0.203 s |
| 36 MiB (padded constant ONNX) | before | 23.7 ms | 251 ms | 0.327 s |
| 36 MiB (padded constant ONNX) | after | 0.9 ms | 211 ms | 0.303 s |

With the tiny CI model the change is within noise. With a model about the size of
YOLOX-S, segments after the first save about 23 ms of copy and hash work in the
parent and about 40 ms of duplicate hashing in the worker. The first segment after
each Start costs the same as before. The parent checks the worker every 0.1 s, so
job wall times fall into 0.1 s steps. That polling, plus starting the worker
process and loading the model for every segment, is now the larger fixed cost.

Each segment still runs in its own analysis process. The per-process `RLIMIT_CPU`
backstop adds up over the process's lifetime, so a persistent worker would need a
different CPU budget model. That is a separate follow-up, together with waiting on
the process instead of polling.

## Timing, recovery and failure semantics

- The first implementation reconnects between segments. It is **not gapless DVR
  archival recording**. Opening/authentication/verification introduce gaps, exposed
  by `gap_before_seconds`; use the actual camera soak to assess suitability.
- Frames are sampled on local receive time, at most 10 fps. The WebM playback and
  existing analyzer use nominal CFR 10 fps. The separate fingerprint-bound timing
  file maps output frame indices to local receive offsets and records skipped
  sampling slots. Variable-rate input, buffering and network delays can make clip
  time differ from wall time. `timing_drift_seconds` (skipped slots × 0.1 s) shows
  how far clip time lags receive time at the end of a segment. Dwell rules are still
  evaluated in clip time. The constant-frame-rate contract is shared by the
  analyzer, the evaluator, the browser review and the segment binding check, so
  this release does not change it. These are not calibrated camera timestamps or
  a guarantee of chronological event accuracy.
- Completion lag measures acceptance after the final sampled frame's local receive
  time. Analysis lag measures retained-result completion after that receive time.
  Queue age, time since last completed segment, capture CPU time and peak RSS are
  visible. CPU seconds/peak RSS are per capture worker, not whole-machine utilization;
  analysis elapsed time is separate. Target-PC aggregate CPU/GPU/RAM/disk telemetry
  and percentiles must be measured during acceptance.
- A disconnect, native crash, timeout, dimension change, corrupt output or Stop
  never publishes the unfinished capture. A final marker is accepted only after
  worker exit and source/timing fingerprint checks. The analyzer snapshots the
  source with the expected hash; results must match that hash, camera, frame count,
  nominal FPS and completed state. Downloads verify the retained pair again.
- Atomic metadata replacement, file sync and (on Linux) segment-folder sync before
  each state commit preserve completed pairs across normal
  process restarts. Restart marks capture intent `SERVICE_INTERRUPTED`; it never
  promotes leftover bytes or resumes capture. Interrupted analysis of an intact
  completed segment returns to `queued`, requiring explicit Start. Corrupt committed
  media/results become `INTEGRITY_FAILED`. Unknown files or malformed journals
  refuse service startup for inspection. Power-loss and filesystem durability still
  require target-disk testing; checksums do not establish authenticity.
- The capture worker reads credentials through a private pipe, with no URL in argv,
  browser state, artifacts or logs. Pipe closure terminates an orphan on Linux and
  Windows. Windows analysis workers use the same parent pipe; Linux retains its
  existing parent-death signal. The reused relay pins the configured RFC1918 address/port and rejects
  redirects. Management remains `127.0.0.1`, exact Host/origin guarded and token
  protected. RTSP itself has no TLS in this path; use the trusted camera LAN.

## One-camera acceptance before expansion

Record the exact reviewed revision, OS/runtime, CPU/RAM/GPU/disk, camera or DVR
model/firmware, codec, dimensions, stream FPS/bitrate, approved channel, model/rule
hashes and retention policy. Keep credentials and footage out of GitHub evidence.

| Required physical test | Concrete acceptance evidence |
| --- | --- |
| First camera connection | Explicit Start, correct channel, no audio, playable WebM and independently matched source/result/timing hashes |
| At least 24-hour soak | Completed/failed/dropped counts; queue and gap/lag distributions; CPU/RAM/disk peaks; limits never silently exceeded; agree workload-specific budgets before the run |
| Disconnect/reconnect | Unplug approved camera/network, restore it, verify visible interruption/backoff, discard of incomplete recording and successful subsequent review |
| Stop/restart | Stop during capture and inference, terminate service during both, restart; no automatic camera contact; intact prior pairs remain reviewable |
| Disk pressure/retention | Use an isolated quota/test volume, verify pause/failure/recovery, count/age/byte cleanup and preservation of exported evidence; never fill the user's system disk |
| Codec and time alignment | Qualify actual H.264/H.265/substream and VP8 runtime on each target OS; compare visible clock events with receive offsets and rule timing |
| Recognition effectiveness | Independently label representative daylight/night/occlusion recordings; measure precision/recall, false alerts/hour and missed events separately from plumbing tests |
| Operator workflow | Reopen an exact segment, inspect detections, record a human decision, export/reopen the report/source pair and verify retention expectations |

Do not claim a reliable operational installation until those gates pass on the
intended PC and camera with agreed budgets. Next engineering requirements include
measured gap reduction or continuous stream segmentation, durable authenticated
review history, camera-time calibration and integrated aggregate resource telemetry.
Only then stage 5/25/50/100 cameras, separating connections, recording throughput,
analysis cadence and visible tiles. Existing scheduler/GPU foundations remain
available for that later integration; this pilot adds no multi-camera claim.
