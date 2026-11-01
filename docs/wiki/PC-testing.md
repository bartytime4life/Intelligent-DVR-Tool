# Install for live PC testing

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) · [Screenshot atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) · [Troubleshooting](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Troubleshooting)

![Workflow diagram for pc testing.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/start.svg)

**Quick path:** Extract the PC kit → Install → prepare verified local models → Check → Start. Camera connections and inference remain explicit.

This kit prepares an interactive **single-user local test installation** on
Ubuntu 24.04 x86-64 or Windows 11 x64. It includes the built interface and local
CPU service, including the pinned detector's candidate metadata and label order
needed to validate an owner-supplied model. Packaging tests validate that binding
from an extracted kit without borrowing files from a source checkout. Python,
trained model weights, camera credentials and recordings
are not included. This is a portable test folder, not a Windows MSI or automatically started recording service.

After preparing analysis and a LAN source, the optional [one-camera recorder](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/LAN-recording)
uses `--analysis --recorder-config local-recorder.json` on Linux or
`-Analysis -RecorderConfig .\local-recorder.json` in PowerShell. It stays stopped
until Start recording & analysis in Recognition. Its segment recovery works on
both OSes; existing Linux-only manual last-analysis recovery is unchanged.

## Get the PC kit

Open the [PC install kit workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/workflows/pc-install.yml).
Choose a successful run for the reviewed revision. Download **pc-test-kit** under
Artifacts (GitHub sign-in required), extract that download, then extract the inner
**Intelligent-DVR-PC.zip** completely into a new writable folder owned by your OS
account. Do not run from inside a ZIP or a shared/public folder.

The download includes **Intelligent-DVR-PC.zip.sha256** for checking a transferred
archive. The inner **pc-kit.json** records the exact source commit and file hashes;
Check detects missing/changed files. These are integrity checks, not signatures.
Artifacts expire after 90 days; rerun the workflow for a new copy of the reviewed
revision. Do not treat an unreviewed PR artifact as a trusted install.

## Prerequisites

- 64-bit **Python 3.12**, including pip and venv. On Ubuntu, use the supported
  python3.12 and python3.12-venv packages. On Windows, install the standard
  Python 3.12 distribution with its launcher; the embeddable ZIP is not intended.
- Full Chrome, Edge or Firefox, and a working webcam for webcam tests.
  WebGL is needed for the facility planner.
- Internet access for the initial pinned Python dependency installation.
  Local camera previews do not use cloud inference. Optional map requests are separate.
- A writable local folder and temporary disk space. Reserve 2 GiB for installation
  and several GiB more for recording analysis. Actual recording storage is separate.
  Begin with one feed. No GPU is required for these previews.

**Node.js and Git are not needed for the prebuilt kit.** A source checkout needs
Node.js 22 and npm to build the interface. Scripts do not install drivers, change
execution policy, open a firewall, provision disks, install autostart or activate cameras.

Official references: [Python on Windows](https://docs.python.org/3.12/using/windows.html),
[virtual environments](https://docs.python.org/3.12/library/venv.html),
[Node for source builds](https://nodejs.org/en/download).

## Windows: Install, Check, Start

Inside the extracted **Intelligent-DVR-PC** folder:

1. Double-click **Install-Windows.cmd**. It installs pinned CPU dependencies into
   this folder's .venv, creates an empty local-feeds.json if absent, then exits.
2. Double-click **Check-Windows.cmd**. Continue when it says
   **READY for explicit PC testing**. Recording analysis may say NOT_CONFIGURED;
   that is expected for webcam/DVR preview tests.
3. Double-click **Start-Windows.cmd**. Keep its terminal open. It opens
   **http://127.0.0.1:4173/** in your browser. Stop with Ctrl+C.

If Windows or organizational policy blocks the download, have the operator
review/approve it normally. Do not disable protections. The .cmd entry points do
not require changing PowerShell execution policy.

PowerShell alternatives, also supported in a source checkout:

~~~powershell
.\scripts\Start-IntelligentDvr.ps1 -Install
.\scripts\Start-IntelligentDvr.ps1 -Check
.\scripts\Start-IntelligentDvr.ps1
~~~

Add **-Python python** or a full Python 3.12 path when the py launcher does not
select it. **-NoBrowser** suppresses browser opening.

## Linux: Install, Check, Start

Open a terminal inside the extracted folder:

~~~bash
bash scripts/run-linux.sh --install
bash scripts/run-linux.sh --check
bash scripts/run-linux.sh
~~~

The last command opens **http://127.0.0.1:4173/**. Keep its terminal open and stop
with Ctrl+C. **DVR_PYTHON=/path/to/python3.12** selects an interpreter;
**--no-browser** suppresses browser opening.

Install runs pip with --only-binary and --require-hashes, so every pinned wheel
must match a PyPI-published SHA-256 for CPython 3.12 on Linux x86-64 or Windows
amd64. A changed or unexpected download stops the install. Other platforms or
Python versions are not covered by these hashes.

An incompatible existing .venv is refused and retained. Install in a fresh folder
instead of deleting an environment you may need. Reinstall preserves
local-feeds.json. After updating a source checkout, rerun Install to rebuild it.

## macOS: source checkout

There is no prebuilt Mac kit. On an Apple silicon Mac, follow the
[Mac Install / Check / Start guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup), including pinned dependencies,
verified model preparation and backups before updates. **Install-Mac.command**
preserves private data; **Check-Mac.command** tests software readiness without
contacting devices; **Start-Mac.command** serves **http://127.0.0.1:4180/**.
The worker has CPU-time and file-size limits but no memory cap on macOS.
Physical camera/DVR compatibility, the one-camera LAN recorder and the hardware
probe retain their separate platform and field-acceptance boundaries.

## First real-device test

1. **Webcam first:** Monitor → Connect source → This computer's webcam → Connect
   webcam. Grant permission for this local app. No microphone is requested.
   Verify moving frames, disconnect and reconnect. Leave Monitor or hide the
   page and confirm capture stops.
2. **DVR/IP camera:** stop the app and edit local-feeds.json using
   edge/local-feeds.example.json as the shape. Enter the device's actual private
   IPv4, RTSP/TCP port, exact substream path and viewer account locally. Restrict
   this plaintext credentials file to your OS account (on Linux:
   **chmod 600 local-feeds.json**). Check reports **WARN: dvr_config_permissions**,
   and Start prints a warning, while group or other accounts can read it. Run Check, Start, then
   Set up local DVR → Load configured DVR sources → select channel → Connect DVR channel.
3. **Recovery:** disconnect. Try an incorrect channel in a disposable test
   configuration, observe the error, restore the settings, restart and reconnect.
   Changing the source catalog requires restarting.
4. **Short soak:** watch one source for several minutes and note freezes/errors.
   DVR previews deliberately end after 15 minutes; reconnect explicitly. Test
   1/2/4 visible tiles. The service has a four-preview cap; 100 configured choices
   do not establish 100 active-source capacity.

Check never contacts camera endpoints. Passing proves software setup, not device
availability, firmware/codec compatibility or latency. Use a <=1080p substream.
ONVIF discovery, vendor cloud accounts, RTSPS, public addresses, hostnames, IPv6
and RTSP/UDP are not supported by this bridge. See the
[camera guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/local-camera-feeds.md).

## Optional local map services

The prebuilt camera kit supports the local facility planner and its existing
explicit public-provider/offline-file choices. Operator-hosted Local Photon and
Local Overpass routes require a **source checkout with Node.js 22**. The existing
DVR_GEO_LOCAL=1 launcher opt-in selects that source Vite preview; --facility /
-Facility can select it explicitly. For the camera/analysis kit, clear that
environment flag. The Python camera service does not proxy map-provider routes.
See [native local map delivery](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/facility-local-delivery.md).

## Optional public internet webcams

The kit includes `edge/public-webcams.example.json` as a disabled configuration
shape. Merge only provider-permitted direct HTTPS JPEG/MJPEG sources into your
local source list, retain attribution and restart. Monitor → Public webcams
loads the approved list without contacting providers; Connect makes the external
request. See the [public-webcam guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/public-webcams.md).
Snapshots show retrieval age, not verified capture time. Local footage is not
uploaded. Public providers, logins, HTML players and HLS formats are not bundled.

## Optional recording recognition

Previews do **not** record or run live AI. Recognition analyzes a deliberately
selected existing recording. Bring your own verified compatible model; no weights
are downloaded by the installer. Configure paths, labels and rules with
edge/local-analysis.example.json and the
[analysis guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/local-analysis-service.md).

Linux:

~~~bash
DVR_RECORDINGS=/absolute/path/to/approved-recordings \
DVR_ANALYSIS_CONFIG="$PWD/edge/local-analysis.example.json" \
bash scripts/run-linux.sh --check

DVR_RECORDINGS=/absolute/path/to/approved-recordings \
DVR_ANALYSIS_CONFIG="$PWD/edge/local-analysis.example.json" \
bash scripts/run-linux.sh --analysis
~~~

Windows:

~~~powershell
.\scripts\Start-IntelligentDvr.ps1 -Check -Recordings 'D:\ApprovedRecordings' -AnalysisConfig "$PWD\edge\local-analysis.example.json"
.\scripts\Start-IntelligentDvr.ps1 -Analysis -Recordings 'D:\ApprovedRecordings' -AnalysisConfig "$PWD\edge\local-analysis.example.json"
~~~

Check validates the catalog and model hashes without inference. In Recognition,
connect, select recording/model/rules, analyze, cancel one attempt and retry.
Confirm source-matched results open. CPU jobs do not establish detection accuracy,
identity tracking or live-camera analysis.

## Reports and recovery

### Optional Linux analysis recovery

After installing, use **--state-dir** with the same recording folder and analysis
catalog used for Recognition. This is explicitly enabled each launch; no extra
service command or storage setup is required. Choose a dedicated local folder
outside the extracted app so a future kit can use it. Its parent must already
exist, with write/search access. A missing final folder is created only by Start,
owned by your OS account with mode 0700. Existing folders must already be 0700,
owner-owned, not symlinks themselves and without unrelated files (system links above
them, such as Silverblue's `/home`, are fine). The launcher never
changes permissions/ownership or deletes questionable files to make them pass.

~~~bash
bash scripts/run-linux.sh --check --recordings /path/to/approved-recordings --config /path/to/catalog.json --state-dir "$HOME/DVR-analysis-state"
bash scripts/run-linux.sh --analysis --recordings /path/to/approved-recordings --config /path/to/catalog.json --state-dir "$HOME/DVR-analysis-state"
~~~

Substitute your real absolute paths. Add **--port 4175** to both commands if
needed; existing **DVR_PORT**, **DVR_RECORDINGS** and **DVR_ANALYSIS_CONFIG**
settings still work. **DVR_STATE_DIR** is an optional environment equivalent;
an explicit --state-dir takes precedence. Relative paths are relative to the
app folder, so absolute paths are recommended for portable upgrades.

Check reports **analysis_persistence**, recovery status and free bytes. It checks
the existing store without creating or changing retained state, contacting a
camera, or running the model. Stop another service using this store before
checking it. A completed result is verified before availability; an interrupted
job is reported as **SERVICE_INTERRUPTED on start**, then marked failed when
Start opens the store. No analysis resumes automatically. Starting the app also
does not connect a camera or start a new job.

Only the last explicit analysis job is retained, including its frozen recording
and review. A new explicit job replaces the previous one. Reserve room for up to
512 MiB each for recording and model, 32 MiB for the review, plus temporary/update
overhead. The free-space report is not a quota, reservation or power-loss guarantee.
See [storage contracts](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/local-analysis-service.md#optional-linux-restart-recovery).

To disable, omit --state-dir and clear DVR_STATE_DIR, or add **--temporary** to
Start/Check to override that environment setting. Temporary operation leaves
the saved store intact; use the same --state-dir again to recover it. Install
ignores inherited DVR_STATE_DIR and preserves saved data. An explicit
--install --state-dir is refused: enable it with Check/Start after installation.
Export browser review decisions separately; they are not saved in this store.

Windows retains temporary operation. Its installation and launch commands are
unchanged; Linux recovery is refused if requested on Windows. Keep your store
and browser exports before moving/upgrading/uninstalling an app.

### Readiness reports

Create a new report with Linux **--check --report readiness-001.json** or PowerShell
**-Check -Report readiness-001.json**. Reports contain check statuses, runtime
versions and source revision for a kit. They omit camera names, credentials,
endpoints, hostnames and recording paths. Review before sharing; never share
local-feeds.json or private recordings as diagnostics.

| Failure | Recovery |
| --- | --- |
| Python missing/wrong version | Install/select 64-bit Python 3.12 with pip/venv |
| Installation fails | Check network/free space and rerun Install; existing settings remain |
| Kit missing/changed files | Extract a fresh complete kit; copy settings only after review |
| Port occupied | Close the other app or choose --port 4175 / -Port 4175 |
| Runtime probe fails | Rerun Install; use a fresh folder if the environment conflicts |
| Config fails | Validate against examples; use only owner-approved private LAN endpoints |
| Camera permission denied | Adjust permission for this local origin, then explicitly reconnect |
| RTSP fails | Verify power/LAN, port/path, viewer credentials and <=1080p substream; the preview's cause (for example RTSP_UNAUTHORIZED or RTSP_NOT_FOUND) narrows it down |
| WARN: dvr_config_permissions | Other accounts can read local-feeds.json; run chmod 600 local-feeds.json (readiness still passes) |
| Browser cannot play analyzed video | Convert a copy to a supported codec, then analyze that copy |

Use the same browser profile and exact **http://127.0.0.1:4173** origin for
continuity. A changed port/origin has separate browser storage. Export reviews,
rules and facility plans before updates; browser storage is not a backup.

Stop before updating. Extract a new kit into a new folder, install its own
environment and copy only reviewed settings. Keep footage/models outside the app
folder. To uninstall, stop, export browser work and remove the extracted folder
after preserving anything you added. No system service or machine-wide uninstall
step is installed.

## Acceptance boundary

This is packaging for PC testing, not unattended DVR deployment. Record OS, kit
revision, browser, device/firmware, codec/resolution and outcomes locally.
Physical-device compatibility, sustained operation, recording/retention, live AI,
tracking, independent detection quality and 100-camera capacity remain separate work.
## Prepare recording recognition

After installation, select your already downloaded, pinned OpenCV Zoo YOLOX-S
ONNX file. Setup verifies its exact size and SHA-256, copies it into a new private
`local-analysis` folder, installs the 80-class labels and whole-frame person
presence rules, and creates a recording inbox. No download, camera connection or
inference starts. Existing analysis folders are preserved and never overwritten.

Linux:

```bash
bash scripts/run-linux.sh --prepare-analysis /absolute/path/to/yolox-s.onnx
bash scripts/run-linux.sh --analysis --allow-recording-import
```

Windows PowerShell:

```powershell
.\scripts\Start-IntelligentDvr.ps1 -PrepareAnalysis 'C:\Models\yolox-s.onnx'
.\scripts\Start-IntelligentDvr.ps1 -Analysis -AllowRecordingImport
```

Use `--check --analysis` / `-Check -Analysis` to validate the prepared catalog.
Explicit `--recordings` and `--config` / `-Recordings` and `-AnalysisConfig`
continue to support custom configurations. Recovery remains opt-in on Linux;
add its existing `--state-dir` option when wanted. See
[capture, analysis, reporting and retention](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-workflow). The pinned
model source and license are recorded in
[`edge/candidates/opencv-zoo-yolox-s-2022nov.json`](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/candidates/opencv-zoo-yolox-s-2022nov.json).

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/pc-testing.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
