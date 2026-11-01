# Field deployment and acceptance runbook

[Current visual atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) · [Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) · [Provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/current/README.md)

![Evidence-producing acceptance sequence from authorized source to reviewed result.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/workflow.svg)

*Physical measurements must be recorded separately from software/fixture tests.*

[Home](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Home) · [PC installation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing) · [Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) · [Verification evidence](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation)

This guide turns the local prototype into a **reproducible, operator-approved PC test**. It is not production certification. Keep the exact revision, physical devices, observed behavior and limits with each result. Passing CI or running generated footage does not establish detection accuracy or 100-camera operation.

## Know which workload you are testing

| Workload | Available today | Not demonstrated |
| --- | --- | --- |
| Browser webcam | Explicit live preview and user-triggered clip capture, with a requested 60-second stop and 64 MiB maximum | All camera drivers, precise timing, unattended background capture |
| DVR/IP camera preview | Private-IPv4 RTSP/TCP and bounded CPU decoding; up to four active previews | ONVIF discovery, public endpoints, RTSP/UDP, RTSPS, long-running capacity |
| LAN recording | One configured RTSP channel with explicit Start/Stop, verified sampled segments and bounded retention | Gapless archive, parallel channel recording, sustained physical-device acceptance |
| Local Recognition | Selected recording, pinned compatible model, bounded CPU inference, human-reviewed source-matched reports | Identity recognition, tracking, continuous live inference, independently measured accuracy |
| Facility and scale preparation | Planned FOV/coverage estimates, offline scheduler/CUDA experiments | Actual person handoffs, surveyed geometry or 100 active live cameras |

The CPU service does **not** silently substitute a GPU backend. Optional CUDA is an explicit offline CLI route with its own qualification record. [Camera limits](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Camera-sources) · [Analysis contract](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/local-analysis-service.md) · [One-camera recorder](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/lan-recording.md).

## 1. Install a reviewed revision

Get the [PC test kit](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing#get-the-pc-kit) for the intended commit. It supports Ubuntu 24.04 x86-64 and Windows 11 x64 with **Python 3.12**; Node.js 22 and Git are needed for source builds, **not** the prebuilt kit. The kit does not include trained detector weights, camera passwords or recordings. Select a trusted model and permitted media. Use an unprivileged account, keep recordings/models off the install folder and restrict the local configuration file to that account.

From the extracted PC kit use one platform:

~~~bash
# Ubuntu / Linux
bash scripts/run-linux.sh --install
bash scripts/run-linux.sh --check --report readiness-001.json
bash scripts/run-linux.sh
~~~

~~~powershell
# Windows (the Install/Check/Start .cmd launchers are alternatives)
.\scripts\Start-IntelligentDvr.ps1 -Install
.\scripts\Start-IntelligentDvr.ps1 -Check -Report readiness-001.json
.\scripts\Start-IntelligentDvr.ps1
~~~

Start opens `http://127.0.0.1:4173/`. Stop with Ctrl+C. Install/Check must not contact cameras or start inference. A READY result is software readiness, **not** device acceptance. Readiness JSON excludes camera credentials/endpoints; inspect before sharing. If the port is busy, use `--port 4175` on Linux or `-Port 4175` on Windows. Browser localStorage is origin-specific; export reviews, rules and facility plans before changing ports, browser profile or kit.

## 2. Prove a real webcam-to-human-review workflow

1. In **Monitor**, explicitly choose **This computer's webcam**, permit camera access and confirm actual moving frames, status, disconnect, and permission/reconnection behavior. No microphone is requested.
2. Choose **Record webcam clip**, then **Stop recording**; open the retained clip in **Recognition**. Unexported/unimported clips can disappear on reload.
3. Follow [Prepare recording recognition](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing#prepare-recording-recognition) to use a locally held, exact-hash-matched YOLOX-S ONNX model. Enable `--analysis --allow-recording-import` (Windows: `-Analysis -AllowRecordingImport`) using the normal launcher, then **Connect local analysis**.
4. Import the actual clip or select an approved video file. **Import does not start inference.** Choose the verified model and reviewed rule set; explicitly press **Analyze recording**. Observe progress, cancellation, final status and strict [recording coverage](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/recording-coverage.md).
5. Inspect the matching source SHA-256, sampled boxes/classes and human decisions. Explicitly **Send observations to Events** where appropriate; export the printable report, JSON, CSV, recognition bundle and saved analyzed recording. Save the original privately for comparison.

A sampled detection count does **not** mean unique people, a verified identity, tracked movement, continuous occupancy or a calibrated probability. Independent human annotations and false-alert measurements are required before accuracy claims. A source hash proves byte matching, not authenticity.

## 3. Prove an authorized local RTSP preview and one-camera recorder

1. Obtain camera-owner approval, document permitted recording and retention, and configure one fixed private IPv4 DVR/IP camera channel using [`edge/local-feeds.example.json`](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/local-feeds.example.json). Supply the exact RTSP/TCP substream path and a dedicated viewer account **on the PC**, never in a public issue. On Linux run `chmod 600 local-feeds.json`.
2. Restart the service, then **Monitor → Set up local DVR → Load configured DVR sources → Connect DVR channel**. Verify frames and age. Deliberately test an invalid substream in a disposable config, then restore. Causes such as `RTSP_UNAUTHORIZED` and `RTSP_NOT_FOUND` support authorized troubleshooting, not scanning or bypasses.
3. For opt-in recording, copy [`edge/lan-recorder.example.json`](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/lan-recorder.example.json) to `local-recorder.json`. Set its `source` to exactly one configured feed ID. Prepare the analysis model/rules. Launch with `bash scripts/run-linux.sh --analysis --recorder-config local-recorder.json` (Windows: `.\scripts\Start-IntelligentDvr.ps1 -Analysis -RecorderConfig .\local-recorder.json`).
4. In **Recognition**, choose **Connect LAN recorder**, the model and rules, then **Start recording & analysis**. Check a completed segment with its source hash, review and export the pair, inspect retention/dropped counters and failure `cause`, then **Stop recording & analysis**. Restart must leave recording and analysis **off** until another explicit Start.

The pilot's default 10-second segments reconnect between captures. It is not gapless footage or a multi-camera DVR. The browser's webcam clip action does not record RTSP preview frames. [Recorder bounds and recovery](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/lan-recording.md).

## 4. Record evidence and exercise failures

For each case record **PASS / FAIL / BLOCKED / NOT RUN**, UTC time, app commit/`pc-kit.json`, OS/browser, approved camera make/firmware/codec, applied settings (redact secrets), actual outcome, local receipt/export hash and operator sign-off.

| ID | Real-device acceptance check | Evidence |
| --- | --- | --- |
| A1 | Install, readiness and loopback Start/Stop | Source revision, readiness JSON, OS/runtime |
| A2 | Physical webcam connect/disconnect, permission handling, moving video | Device/codec and observation notes |
| A3 | Explicit captured/approved clip, completed source-matched analysis and strict media coverage | Original media, source hash, receipt, exported review |
| A4 | Authorized DVR preview; bad path/credentials fail clearly without connecting another device | Redacted feed status/error cause |
| A5 | Explicit recorder Start/Stop, complete reviewed segment, bounded retention and visible gaps | Segment/status/counters, saved analyzed pair |
| A6 | Abrupt service interruption then restart without autonomous camera/inference restart | Before/after status, failure/recovery notes |
| A7 | Config privacy, low-disk response, export/restore of browser reviews | Redacted settings and recovery checklist |
| A8 | Independent annotations on representative, permitted footage with misses and false alerts | [Evaluation report](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/offline-evaluation.md) and review notes |

Treat missing evidence, incomplete media presented as complete, silent source changes, spontaneous camera restart and exposed credentials as **FAIL**. Do not mark tests PASS on the basis of a mocked/virtual feed. Preserve originals; exports and local SQLite/browser data are not immutable independent audit records.

### Troubleshooting quick map

| Signal | Safe next step |
| --- | --- |
| `NOT_CONFIGURED` | Expected for preview-only use; prepare the pinned local model/catalog before analysis |
| `dvr_config_permissions` | Restrict `local-feeds.json` to this OS account |
| `RTSP_UNAUTHORIZED` / `RTSP_NOT_FOUND` | Verify authorized viewer credentials and exact channel path |
| `STREAM_INTERRUPTED` / `UPSTREAM_UNREACHABLE` | Inspect device power/LAN, permitted substream and timeouts |
| `MEDIA_INCOMPLETE` / `NO_FRAMES` / `VIDEO_OPEN_FAILED` | Check source, decoder and coverage; never approve a partial result |
| `MODEL_LOAD_FAILED` / `INPUT_CHANGED` | Recheck exact model bytes and selected recording; no silent fallback |
| `RESULT_STORAGE_PRESSURE` / `disk_pressure` | Preserve needed exported segments, then inspect retention and free space |
| `SERVICE_INTERRUPTED` | Inspect retained state and explicitly approve any retry; nothing resumes automatically |

On Linux, opt-in `--state-dir` retains the last analysis job and writes rotated, private `diagnostics/service.log` with bounded codes/IDs/numbers. It does **not** preserve browser decisions or guarantee power-loss durability; Windows does not support this manual last-job persistence option. The LAN recorder has separate restart behavior on both operating systems. [Service recovery](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/local-analysis-service.md) · [Security](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/SECURITY.md).

## 5. Progress from one source toward 100 without claiming success early

Use the [1 → 5 → 25 → 50 → 100 acceptance ladder](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/performance-100-cameras.md) on **real intended cameras and hardware**, with objectives fixed before each run. Measure unique connected sources, preview tiles **separately** from recorded channels, recording gaps, offered/analyzed/replaced/dropped samples, p50/p95 latency, RAM/VRAM, GPU/CPU, network, sustained disk writes, retention and recovery. Include night/day and representative detection/false-alert cases where permitted. Repeat the outage, disk-pressure and restart drills at each approved stage.

Virtual sources, repeated recordings, synthetic CUDA loads and passing GitHub checks remain engineering tests, **not** physical 100-camera qualification. Do not declare deployment-ready until the exact hardware/driver/codec matrix, prolonged uptime, permission/retention controls, independent labels, failure recovery and evidence receipts pass. [Verification index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation) · [Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status).

**Closeout:** explicitly stop the foreground process, export browser work and saved reviewed media, preserve the source revision and approved local configuration, and do not upload sensitive logs/footage. The installer does not configure autostart, the firewall, recording arrays or camera activation.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/field-acceptance.md) · Generated from the checked documentation source; historical and schematic images are labeled.
