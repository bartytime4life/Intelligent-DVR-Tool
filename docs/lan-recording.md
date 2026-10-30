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
| Queue policy | FIFO | Oldest unprotected entries expire by age, count or byte budget, including pending work |
| Reconnect | 2–60 seconds | Bounded exponential delay after failure while explicitly running; Stop cancels retries |

Storage lives under `.lan-recorder` in the configured recordings folder. The
normal shallow recording/import catalog does not enumerate it. A dedicated
OS-released owner lock excludes another service using that directory. Linux uses
0700 owner-only directories; on Windows, use an account-private NTFS installation
folder with appropriate inherited ACLs. This does not implement an OS credential
vault or encrypt footage. Do not place it on a shared/public filesystem.

Retention runs while the recorder is explicitly active. Stopped services preserve
files; the next Start applies elapsed-age limits before processing queued work.
Active capture/analysis entries are protected until their operation ends. The
quota includes partial files, retained result JSON and the single analysis working
directory. Conservative allocation estimates include source/model/result copies
before analysis and another segment before capture. A service restart removes
recognized interrupted working files before accepting a new session. Free-space checks cannot
reserve space against other applications; external disk pressure can still cause
an explicit failure. Native encoder buffering permits a small transient overshoot,
especially on Windows, which has no per-process file-size quota. This is bounded
application storage management, not an OS disk quota or protection against a hostile OS.

Expired files are deleted. Export required evidence before retention removes it.
`dropped` counts failed/interrupted segment attempts, failed analyses and expired
queued segments; it is not a count of camera packets or lost frames. `expired`
also counts successful pairs removed by retention. Counters persist across restarts;
the list retains only the bounded most recent entries. They are unsigned local
operational metadata, not an authenticated forensic audit log.

## Timing, recovery and failure semantics

- The first implementation reconnects between segments. It is **not gapless DVR
  archival recording**. Opening/authentication/verification introduce gaps, exposed
  by `gap_before_seconds`; use the actual camera soak to assess suitability.
- Frames are sampled on local receive time, at most 10 fps. The WebM playback and
  existing analyzer use nominal CFR 10 fps. The separate fingerprint-bound timing
  file maps output frame indices to local receive offsets and records skipped
  sampling slots. Variable-rate input, buffering and network delays can make clip
  time differ from wall time. Dwell rules are evaluated in clip time. These are not
  calibrated camera timestamps or a guarantee of chronological event accuracy.
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
- Atomic metadata replacement and file sync preserve completed pairs across normal
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
