# Mac install, check and update

[Home](../README.md) · [Local analysis](local-analysis-service.md) · [Training](training.md) · [Person enrollment](person-enrollment.md)

Use a **source checkout on Apple silicon, macOS 14 or newer**, with Python 3.12
and Node.js 22. There is no prebuilt Mac kit. The Linux/Windows kit keeps its
existing platform-specific dependencies and qualification boundaries.

## Install

If needed, install the prerequisites with Homebrew:

```bash
brew install python@3.12 node@22
```

In the repository folder, double-click **Install-Mac.command**, or run:

```bash
bash Install-Mac.command
```

This builds the interface, creates or reuses this checkout's Python 3.12 `.venv`,
and installs the exact CPU packages in [requirements-macos.txt](../edge/requirements-macos.txt).
Every wheel must match an official PyPI SHA-256. Unsupported platforms, changed
downloads and incompatible existing environments are refused. Installation
preserves `local-analysis/` and existing camera settings. It does not download
models, start a server, connect a camera or analyze a recording.

## Prepare models once

**An existing working `local-analysis/catalog.json` needs no preparation.** Skip
to Check. Preparation deliberately refuses an existing `local-analysis/`, including
an incomplete folder; preserve and inspect it instead of deleting it to retry.

For a fresh checkout, select the exact verified YOLOX-S model described in the
[model guide](model-qualification-20261026.md). To enable person enrollment too,
select the two pinned YuNet/SFace files from the
[enrollment setup](person-enrollment.md#set-up). The explicit download links are:

- [YOLOX-S, 35,858,002 bytes](https://media.githubusercontent.com/media/opencv/opencv_zoo/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/object_detection_yolox/object_detection_yolox_2022nov.onnx)
- [YuNet, 232,589 bytes](https://media.githubusercontent.com/media/opencv/opencv_zoo/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_detection_yunet/face_detection_yunet_2023mar.onnx)
- [SFace, 38,696,353 bytes](https://media.githubusercontent.com/media/opencv/opencv_zoo/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_recognition_sface/face_recognition_sface_2021dec.onnx)

Use their actual downloaded paths, for example:

```bash
bash Start-Mac.command --prepare-analysis "$HOME/Downloads/object_detection_yolox_2022nov.onnx" \
  --face-detector "$HOME/Downloads/face_detection_yunet_2023mar.onnx" \
  --face-recognizer "$HOME/Downloads/face_recognition_sface_2021dec.onnx"
```

Omit both face options for object/person detection without enrollment. Setup
copies and verifies the selected bytes before publishing a catalog. It also
copies the verified 80-class labels, creates an empty recordings folder and a
whole-frame person-presence rule (threshold 0.5, no dwell), and records model
provenance. Review this starting rule for your camera before relying on it.
The pretrained models' upstream licenses apply; see
[third-party notices](third-party-notices.md). No recordings or templates are
included in the repository.

## Check and start

```bash
bash Check-Mac.command
bash Start-Mac.command
```

Check validates the environment, exact package versions, generated-video codec
and coverage probe, model hashes, labels, rules, source configuration and local
port. It never connects configured devices or analyzes an operator's recording.
An optional `--report /path/to/new-report.json` creates a private, redacted report
and refuses to overwrite an earlier report. With an already-running service,
`bash Check-Mac.command --skip-port-check` explicitly skips port availability.

Start opens **http://127.0.0.1:4180/** and stays in the foreground. Stop it with
**Ctrl+C** in its terminal. It refreshes dependencies after a lockfile change and
rebuilds after source, asset, build-script or hosting-input changes, including
deleted assets. A failed build never starts a service. Missing analysis setup
opens the interface only; incomplete or invalid analysis setup is an error.

With a valid catalog, recording import and guided training are enabled. The
verified `faces` catalog entry additionally enables consent-based enrollment.
Starting the app does not start a camera or an analysis job. Choose **Train →
Start session**, or **Recognition → Connect local analysis** and explicitly
select a recording, model and rules. Face enrollment requires the person's
agreement before capture. Model matches remain suggestions for human review.

If port 4180 is occupied, Start explains how to open the existing app or stop
the older DVR terminal. It never kills a process or silently chooses another
port. `--port` / `DVR_PORT` is available for deliberate separate testing; use
the same browser profile and **127.0.0.1:4180** for everyday work because browser
saves and camera permissions belong to that exact origin.

## Preserve data when updating

1. Stop recording/analysis, export any review result you need, then stop the app.
   Mac last-job results are temporary and disappear when its service stops.
2. Back up the complete private `local-analysis/` folder (models, catalog, rules,
   recordings, `trained/`, `people/` and any local evaluation folders),
   `local-feeds*.json`, and any `local-recorder*.json` / `.lan-recorder/` data
   that exists. Keep the backup outside the checkout in a private location.
3. Export browser review decisions, rules and facility plans separately through
   their existing export controls. Browser localStorage/IndexedDB is **not**
   part of a checkout or folder backup. Keep using the same browser and origin;
   do not clear site storage during the update.
4. In the same checkout, update and rerun Install, Check, then Start:

   ```bash
   git pull --ff-only origin main
   bash Install-Mac.command
   bash Check-Mac.command
   bash Start-Mac.command
   ```

If Git reports local changes or divergent history, preserve them and resolve the
update deliberately; do not reset or clean the checkout to force it. In particular,
`git clean -fdx` deletes ignored recordings, models and environments. Local runtime
data is intentionally ignored by Git and cannot be restored by pulling the repo.

When moving to a new checkout, stop both apps and copy the **whole** private
analysis folder into an absent destination; keep the old installation until the
new Check passes and saved recordings/rules/templates have been verified. Do not
copy `.venv` or `node_modules`; reinstall them for the new path. Reuse the original
browser and port to keep browser saves. An ordinary install in the same checkout
does not perform a migration or replace its catalog.

## Evidence and limits

The [Mac install workflow](../.github/workflows/mac-install.yml) exercises a fresh
source folder with spaces, a repeat install, preservation of private fixture
files, readiness, a real local analysis of generated video/ONNX, duplicate launch,
build refresh and restart. It also runs the application unit and packaging checks.
Its artifacts contain synthetic test output only; no owner recordings, templates,
credentials or pretrained weights are uploaded.

[November 1 Mac verification](verification/mac-setup-2026-11-01/README.md) separates
the local pretrained/generated-clip checks from CI and real-device evidence.
Mac workers have CPU-time and file-size limits but **no memory cap**. Native
camera compatibility, sustained operation, recognition accuracy and 100-camera
capacity still need field qualification. Linux last-job recovery and the PC
hardware probe are separate; they are not enabled by these Mac entry points.
