# Local recording analysis

[Guide index](README.md) · [Visual handbook](how-to.md) · [Screenshot atlas](visual-atlas.md) · [Troubleshooting](troubleshooting.md)

![Workflow diagram for local analysis service.](media/guide/start.svg)

**Quick path:** Prepare a compatible model/catalog → start the local service → Connect local analysis → select a recording, model and rules → Analyze recording.

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
without `..`, absolute paths or symlinks inside that directory. Each model has an explicit SHA-256,
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

macOS (Apple silicon, macOS 14+ source checkout): follow
[Mac Install / Check / Start](setup-macos.md). The Mac installer uses its own
exact, hash-checked Python 3.12 CPU runtime. Preparation copies explicitly
selected pinned models into a fresh private `local-analysis/`; existing catalogs,
recordings, tuned rules and templates are preserved on reinstall. Start opens
`http://127.0.0.1:4180/` with import and training enabled when configured, and
enrollment when its pinned face models are configured. Missing analysis setup
serves the interface only; incomplete or invalid setup is reported as an error.
The [update guide](setup-macos.md#preserve-data-when-updating) covers private data,
temporary results and browser exports separately.

`--allow-training` (Linux `--allow-training`, Windows `-AllowTraining`) lets
[guided training](training.md) save tuned rule sets in `trained/` beside the
catalog. Saved sets load at startup and appear with the configured ones; files are
created exclusively, never overwritten, and limited to 50.

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

Completed analysis now requires [recording coverage validation](recording-coverage.md).
The current runtime includes PyAV; strict decode/inventory checks share the job
deadline. Missing inventory metadata stays explicitly unverified/partial, and
early or corrupt decoding publishes no result. Reopened legacy results are
labeled unverified instead of being retroactively validated.

| Boundary | Enforced behavior |
| --- | --- |
| Access | Exact IPv4 loopback Host; same-origin browser requests; per-service random token for job/result/source APIs; on Linux, API sockets must belong to the service's OS account (Windows and macOS: trust other local accounts); a `localhost` page load is redirected to the exact `127.0.0.1` origin and the API never answers on `localhost`; no CORS; same-computer recording import is bounded and off unless explicitly enabled |
| Paths | Direct children of one explicit recording folder; opaque IDs; no client paths or commands; regular files; configured folders are resolved once (system links above them, such as Silverblue's `/home`, are accepted) and no symlink is followed at or beneath them |
| Catalog | First 1,000 directory entries considered; at most 200 supported recordings listed; refresh explicitly after changing files |
| Inputs | Nonempty MP4/MOV, WebM/MKV or AVI container header; 512 MiB recording/model; 64 KiB labels/rules; models hash checked before execution |
| Jobs | One active job, no pending queue, five-minute wall deadline including preparation; cancel wins publication races |
| CPU | Two OpenCV inference and two FFmpeg decoder threads requested; 6,000 decoded frames; sample every five; 4 GiB Linux virtual-address or Windows process-commit limit (macOS refuses address-space limits, so its worker has **no memory cap**); Linux and macOS file-size cap and a summed CPU-time backstop (1,260 s: four threads for the full wall deadline) |
| Results | Existing 1,000-observation, 100,000-detection, 32 MiB review contract; browser validates full contract before attaching exact source |
| HTTP | 2 KiB JSON controls; optional explicit same-computer binary import up to 64 MiB; at most 16 concurrent connections (extra ones are closed), five-second socket timeout, 30-second import loop deadline; chunked output; downloads stream outside service locks |
| Retention | Default: one private temporary recording/result snapshot until the next explicit job or graceful shutdown. Opt-in Linux storage retains the last job across service restarts; model/config snapshots are removed after processing |

The retained result can be reopened with **Open results again**. Reloading the
browser and reconnecting recovers the service's current job/result without
starting another analysis. A lost start/cancel response disables new starts until
you reconnect; it never asserts cancellation without confirmation. Invalid files,
changed models, process failures, time limits and disk/access errors leave controls
available for another explicit attempt. A previous loaded review is retained if
a new job fails validation. A frame-budget stop is marked **PARTIAL**, not complete
coverage of the recording. A time-limit stop produces no review result.

A failed job's `error.code` names the cause when the worker or OS reports one.
The worker writes a bounded `failure.json` with one fixed code, and the service
parses it strictly. Codes include the coverage codes (`MEDIA_*`),
`VIDEO_OPEN_FAILED`, `FRAME_RATE_INVALID`, `STRIDE_EXCEEDS_GAP`,
`MODEL_LOAD_FAILED`, `MODEL_OUTPUT_INVALID`, `INFERENCE_FAILED`,
`FRAME_TOO_LARGE`, `NO_FRAMES`, `DETECTION_LIMIT`, `RESULT_LIMIT`,
`INPUT_CHANGED`, `DEPENDENCY_MISSING` and `MEMORY_LIMIT`. Exits without a code
are classified as `CPU_LIMIT` (SIGXCPU), `FILE_SIZE_LIMIT` (SIGXFSZ),
`WORKER_KILLED` (SIGKILL, for example the kernel's out-of-memory killer),
`WORKER_CRASHED`, or Windows `MEMORY_LIMIT` (STATUS_NO_MEMORY or
STATUS_COMMITMENT_LIMIT). Everything else stays `PROCESS_FAILED`. Messages are
fixed text. Codes never include paths or native output.

In the default temporary mode, stopping the service cancels its active job and deletes its temporary inputs.
A service restart does not resume or replay a job. Abrupt host/process termination
can leave an `intelligent-dvr-job-*` private directory in the OS temporary folder;
without `--state-dir`, no persistent journal or cross-restart recovery is used.
Delete such a directory only after confirming its service/worker has stopped.
Original recordings are never altered. This is a single-user local application,
not a multi-user or remotely exposed server or a sandbox for hostile models.

### Optional Linux restart recovery

Add `--state-dir /absolute/path/to/private-analysis-state` to the normal Linux
`bash scripts/run-linux.sh --analysis` command above, or to the direct service
command. The same option works with `--check`; see the
[PC installation guide](pc-testing.md#optional-linux-analysis-recovery) for Check,
Start and disabling recovery. The parent folder must already
exist. Use a dedicated empty folder on local storage; a new folder is created
with mode 0700. Existing folders/files must belong to the current OS user and
must not be symlinks or shared with another service. Do not place originals or
other data inside this store. Existing directories need owner read/write/search
permissions and no group/other permissions (0700). Check validates the same
store schema, ownership, path, locking, hashes and source binding without creating
a store, pruning files or changing an interrupted job's status. It reports free
bytes without reserving space; service startup revalidates and acquires the lock.

The store retains **one last job**, not a recording library or review database.
A completed job keeps its frozen recording (up to 512 MiB), review bundle (up
to 32 MiB) and bounded metadata. A new explicit job replaces that job and its
snapshot. During analysis a temporary model copy adds up to 512 MiB plus small
configuration files. This is an application size bound, not a disk quota or
free-space reservation. No model, source or metadata is uploaded.

After restart, Connect local analysis recovers the job with a fresh API token.
Completed files are checked by SHA-256 and the existing source-binding contract
before serving; the browser still validates the full review contract and exact
recording fingerprint. Original files may have changed or disappeared; the
retained frozen bytes remain the result's source. No inference is rerun or
automatically resumed. Graceful shutdown cancels an active job; an abrupt service
exit becomes SERVICE_INTERRUPTED on restart, with no partial success exposed.
The Linux analysis worker arms the existing parent-death SIGKILL mechanism before
native work and verifies the expected parent, preventing an orphan from continuing
analysis after its service dies.

An exclusive file lock refuses a competing service owner. A successful completed
state is published only after syncing the two retained files and atomically
replacing metadata. Write/rename/sync failures stop new dispatch and do not open
a live result. A commit whose final sync failed can remain uncertain: restart
revalidates whatever complete state reached disk instead of inventing success
or failure. These checks establish tested process-restart behavior, **not
power-loss durability**, authentication of editable local records, or hostile-OS
isolation. Checksums cannot prevent an OS owner from coherently editing files.

Corrupt metadata, unknown files, missing committed metadata with retained files,
wrong source bindings, unsafe paths or changed completed files refuse startup
and preserve the affected files for inspection. An interrupted running record
retains its explicit failure status and discards its incomplete working copies.
Stop all service instances before repairing or moving a store aside. Omit
`--state-dir` (and clear `DVR_STATE_DIR`), or use the Linux launcher's `--temporary`
override to return to temporary mode. Temporary operation does not open, delete
or modify the saved store. Preserve/export needed reviews and
the private store first. Windows persistent-storage permission/locking semantics
are not qualified by this implementation; Windows retains the default temporary
workflow and explicitly rejects this opt-in option.

The same opt-in store holds the service's
[diagnostic log](../SECURITY.md#worker-failure-codes-and-the-diagnostic-log):
`diagnostics/service.log`, rotated at 1 MiB across three 0600 files. It records
event codes, job/segment/session IDs and numbers only, such as `JOB_FINISHED` with
the terminal state and error code. Store inspection accepts only those three file
names. Without `--state-dir` there is no log.

Human review decisions remain in browser storage and exports; this store does
not persist those decisions, capture live cameras, record continuous footage,
qualify recognition accuracy, or establish 100-camera operation.

### Explicit recording import and reports

`--allow-recording-import` enables the authenticated same-origin recording-copy
endpoint, on the direct service or Linux launcher. Windows uses
`-AllowRecordingImport`. It requires an analysis configuration and is off by
default. Imported files are retained separately from last-job recovery until
manually moved/deleted; they are not deleted when a job is replaced. See the
[workflow and exact storage bounds](recording-workflow.md).

Recognition now exports printable HTML, report JSON, observation CSV, the original
recognition bundle and the matching analyzed recording. Reports incorporate the
current browser review decisions only when observation identities and evidence
match. Display thresholds do not rewrite rule outcomes. Imports of invalid
recognition bundles preserve the previous loaded review.

CPU is the service's default and available fallback path; CUDA remains an explicit
separate CLI backend with its existing no-silent-fallback policy. This service does
not automatically switch GPU/CPU or claim GPU job qualification. Native decoder
network protocols are restricted to local files. Map-provider choices elsewhere in
the app remain optional and separate; the analysis service makes no cloud calls.

Browser source matching keeps the 512 MiB ceiling. It hashes the file in 4 MiB
`Blob.slice` chunks with a pure-JS SHA-256 in a module Web Worker. If a worker is
unavailable it runs on the page and yields between chunks. It never holds the whole
recording in one buffer and does not need WebCrypto's secure context. An
`AbortSignal` passed in options stops the hash early. Throughput is lower than native
WebCrypto: about 215 MiB/s in Node 22 on the 2026-10-31 measurement host, or about
2.4 s for a 512 MiB file. This workflow does not establish
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
