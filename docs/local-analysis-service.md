# Local recording analysis

Recognition can select a recording from an explicitly configured folder, start
CPU analysis, show frame progress, cancel and open the verified result in the same
application. The service calls the existing `edge.analyze` implementation and the
browser reuses `parseRecognition` and `matchRecording`. PR #25's retained sessions,
review decisions, queue limits, export and Undo remain in place.

## Start the local application

Install the existing [Linux](setup-linux.md) or [Windows](setup-windows.md) local
requirements. Obtain and verify your own supported model as described in
[model qualification](model-qualification-20261026.md). No weights are downloaded
by the service. The example catalog is `edge/local-analysis.example.json`: place
the pinned YOLOX model at `edge/models/yolox-s.onnx`, or create your own catalog.
Model paths, labels and rule paths must be relative to the catalog directory,
without `..`, absolute paths or symlinks. Each model has an explicit SHA-256,
profile and labels; rules use the existing rule JSON contract. Review zone
rectangles, labels, thresholds, dwell and max-gap before analysis. Add up to 16
models and 16 rule sets. Only compatible model/rule labels can start a job.

Linux, after the existing optional environment installation:

```bash
DVR_RECORDINGS=/absolute/path/to/approved-recordings \
DVR_ANALYSIS_CONFIG="$PWD/edge/local-analysis.example.json" \
bash scripts/run-linux.sh --analysis
```

Windows PowerShell:

```powershell
./scripts/Start-IntelligentDvr.ps1 -Analysis `
  -Recordings 'D:\ApprovedRecordings' `
  -AnalysisConfig "$PWD\edge\local-analysis.example.json"
```

The equivalent direct command, after `npm run build`, using the Python environment
with the edge dependencies installed, is:

```bash
python -m edge.local_service --recordings /absolute/path/to/approved-recordings --config edge/local-analysis.example.json
```

Open `http://127.0.0.1:4173/#recognition`. Use the exact address printed by the
service. It intentionally does not accept alternate hosts, remote access or
hosted-site calls. Starting the service does **not** start inference. In Recognition:

1. Press **Connect local analysis** and select an explicit recording, model and rules.
2. Press **Analyze recording**. Read the preparation/analysis/verification phase,
   sampled-frame count and decoded-frame budget; these are not a guessed percent
   of the entire recording. Cancel whenever processing is active.
3. Successful results open automatically after bundle validation and SHA-256
   matching of the service's frozen recording snapshot. Review paused sample
   boxes, classes and scores; send observations to Events for a human decision.

Source playback requires a browser-supported codec. If decoding succeeds in
OpenCV but the browser cannot play the file, Recognition explains that limitation;
convert a **copy** to a supported format and analyze that new file. Different
encoded bytes must never inherit another recording's boxes.

## Limits and recovery

| Boundary | Enforced behavior |
| --- | --- |
| Access | Exact IPv4 loopback Host; same-origin browser requests; per-service random token for job/result/source APIs; no CORS or uploads |
| Paths | Direct children of one explicit recording folder; opaque IDs; no client paths or commands; regular files and no symlink components |
| Catalog | First 1,000 directory entries considered; at most 200 supported recordings listed; refresh explicitly after changing files |
| Inputs | Nonempty MP4/MOV, WebM/MKV or AVI container header; 512 MiB recording/model; 64 KiB labels/rules; models hash checked before execution |
| Jobs | One active job, no pending queue, five-minute wall deadline including preparation; cancel wins publication races |
| CPU | Two OpenCV/native worker threads requested; 6,000 decoded frames; sample every five; 4 GiB Linux virtual-address or Windows process-commit limit; Linux CPU-time/file-size caps |
| Results | Existing 1,000-observation, 100,000-detection, 32 MiB review contract; browser validates full contract before attaching exact source |
| HTTP | 2 KiB JSON request; no raw footage upload; one request at a time with five-second socket timeout; output sent in fixed-size chunks |
| Retention | One private temporary recording/result snapshot until the next explicit job or graceful shutdown; model/config snapshots removed after processing |

The retained result can be reopened with **Open results again**. Reloading the
browser and reconnecting recovers the service's current job/result without
starting another analysis. A lost start/cancel response disables new starts until
you reconnect; it never asserts cancellation without confirmation. Invalid files,
changed models, process failures, time limits and disk/access errors leave controls
available for another explicit attempt. A previous loaded review is retained if
a new job fails validation. A frame-budget stop is marked **PARTIAL**, not complete
coverage of the recording. A time-limit stop produces no review result.

Stopping the service cancels its active job and deletes its temporary inputs.
A service restart does not resume or replay a job. Abrupt host/process termination
can leave an `intelligent-dvr-job-*` private directory in the OS temporary folder;
there is no persistent journal or cross-restart recovery in this first service.
Delete such a directory only after confirming its service/worker has stopped.
Original recordings are never altered. This is a single-user local application,
not a multi-user or remotely exposed server or a sandbox for hostile models.

CPU is the service's default and available fallback path; CUDA remains an explicit
separate CLI backend with its existing no-silent-fallback policy. This service does
not automatically switch GPU/CPU or claim GPU job qualification. Native decoder
network protocols are restricted to local files. Map-provider choices elsewhere in
the app remain optional and separate; the analysis service makes no cloud calls.

Browser source matching retains the existing 512 MiB ceiling and full-buffer hash.
It is not a streaming-memory optimization. This workflow does not establish
live-camera ingest/recording, person identity tracking, learned behavior,
independently measured recognition quality or sustained 100-camera capacity.

## Design decision

**Status:** Implemented for review, October 29, 2026.

A single Python loopback server serves the built app and manages one isolated CPU
worker. The worker calls the existing analyzer with a progress callback; no new
inference engine or competing receipt schema is introduced. Read-only folder
selection avoids browser footage uploads and ambiguous arbitrary-path execution.
Serving the app on the same origin avoids a remote-site-to-local-agent bridge.

A Vite-only API would couple operation to the development server. A remotely
reachable service would require a different authentication, authorization and
transport design. A durable multiworker daemon would introduce scheduling and
restart semantics beyond this one-recording acceptance step. Those alternatives
remain separate work. This implementation deliberately pays for frozen input
copies so source verification is meaningful even when originals later change.

## Verification

See [the dated evidence](verification/local-analysis-2026-10-29/README.md).
The new Chromium suite runs against this actual HTTP service with generated video
and a synthetic constant-output ONNX model. Transport-fault scenarios are labelled
separately from real native processing. No private recordings or trained model
weights are uploaded to CI.
