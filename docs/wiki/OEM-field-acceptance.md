# Accept one completed OEM recording

[OEM backup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/OEM-backup) · [GPU setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Live-GPU) · [General field runbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance)

Use this procedure on **one explicitly approved, completed recording**, first with
generated input and then with the owner's permitted OEM export. No camera or DVR
connection is required. Do not select a live recording directory: the folder
watcher scans files, not just the one you intend. Use an otherwise empty staging
folder holding a copy of the approved completed export. Preserve the OEM original.
Record privately how the staged file maps to the original and compare their hashes.
A quiet file for 60 seconds does not prove that the OEM has closed it.

## 1. Prepare an isolated acceptance installation

Use Ubuntu 24.04 x86-64 or Windows 11 x64, Python 3.12, an unprivileged account,
and a separate copy of the reviewed PC kit. For source builds also install Git
and Node.js 22, then run `npm ci` and `npm run build` from the checkout. Record
`git rev-parse HEAD` and `git status --short`, or the kit's `pc-kit.json` revision.
Use a fresh browser profile so testing cannot replace existing browser work.
Stop another app instance using port 4298; do not kill an unidentified process.
Keep model, source, backup, receipts and test installation in separate private
folders outside Git. Do not alter the installed OEM program or its environment.

Linux, from the acceptance copy:

```bash
bash scripts/run-linux.sh --install
bash scripts/run-linux.sh --prepare-analysis /absolute/path/to/yolox-s.onnx
bash scripts/run-linux.sh --check --analysis --report /absolute/private/readiness.json
bash Start-DVR-Companion-Linux.sh
```

Windows PowerShell, from the acceptance copy:

```powershell
.\scripts\Start-IntelligentDvr.ps1 -Install
.\scripts\Start-IntelligentDvr.ps1 -PrepareAnalysis 'C:\Models\yolox-s.onnx'
.\scripts\Start-IntelligentDvr.ps1 -Check -Analysis -Report 'D:\Private\readiness.json'
.\Start-DVR-Companion-Windows.cmd
```

For a **copy-only** preliminary trial after installation, the companion no longer
requires model preparation. Run `bash scripts/run-linux.sh --companion --check`
(or PowerShell `-Companion -Check`) and then the companion shortcut. It remains
paused with automatic analysis disabled. Choose only generated input under the
current authorization. The analysis commands above remain optional and require
separately approved prerequisites.

Analysis preparation requires the already obtained exact model documented in
[PC setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing#prepare-recording-recognition); it does not download weights.
Open `http://127.0.0.1:4298/`. Record OS, browser, Python, app revision, model hash,
OEM/version, export/container/codec, duration, dimensions and frame rate privately.
A missing model means **copy-only**; an unsupported proprietary video means **BLOCKED** for analysis,
not permission to download or convert the original. Export a standard video using
the OEM; label the export as a new source with a new hash.

The default installer is CPU-only. CUDA needs the separate environment described
in [GPU setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Live-GPU), the pinned YOLOX-S FP32 model, a compatible NVIDIA
driver, ONNX Runtime GPU and its CUDA/cuDNN libraries; Windows additionally needs
the compatible DLLs and Visual C++ runtime. Record actual versions. Do not change
an existing environment or install both CPU and GPU ONNX Runtime packages together.
A listed provider, GPU name or `nvidia-smi` result is not execution evidence.

## 2. Preliminary checks with generated input only

From a **source checkout**, reuse the existing integration harness. Its additional
developer dependencies are `edge/requirements-test.txt` and Playwright/browser
packages from `package-lock.json`. Install those only into a disposable Python
3.12 environment. The fixture creates a synthetic ONNX model and VP8 video; no
external model or camera is needed for its CPU path.

Linux:

```bash
.venv/bin/python -m pip install -r edge/requirements-test.txt
npx playwright install chromium
npm run build
DVR_TEST_PYTHON="$PWD/.venv/bin/python" npx playwright test --config=playwright.library-native.config.mjs
.venv/bin/python -m unittest discover -s tests -p test_backup_library.py
.venv/bin/python -m unittest discover -s tests -p test_field_acceptance.py
```

Windows PowerShell:

```powershell
.venv\Scripts\python.exe -m pip install -r edge/requirements-test.txt
npx playwright install chromium
npm run build
$env:DVR_TEST_PYTHON = (Resolve-Path '.venv\Scripts\python.exe').Path
npx playwright test --config=playwright.library-native.config.mjs
.venv\Scripts\python.exe -m unittest discover -s tests -p test_backup_library.py
.venv\Scripts\python.exe -m unittest discover -s tests -p test_field_acceptance.py
```

Use a checkout path without spaces for this developer harness's server command.
Leave `DVR_LIBRARY_CATALOG` unset for the generated CPU-model test. It serves only
loopback port 4199, accelerates settling only inside its fixture, and **recreates
`qa-local/library-native` and deletes its generated original**. Never put real
footage there. Keep `qa-local/library-native-browser-results.json` and generated
receipts locally. This reuses the existing copy → analysis → source-matched browser
review test and backup recovery regressions, rather than inventing another pipeline.

With the separately prepared CUDA environment and pinned model, also run:

```bash
.venv/bin/python -m edge.live_benchmark --model /absolute/path/to/yolox-s.onnx --frames 12 --output /absolute/private/generated-backends.json
```

On Windows replace the interpreter with `.venv\Scripts\python.exe` and use Windows
paths. This is a generated-frame CPU/CUDA execution and fallback check. Inspect
which backends actually ran and whether agreement passed. Empty detections on
these generated frames are not an accuracy result. Missing CUDA leaves GPU
acceptance **BLOCKED**, even if CPU fallback works. No new model downloads occur.

## 3. Copy the approved completed export

1. Record owner approval, scope and completed-file evidence in the private worksheet
   below. Copy only that file into the empty staging folder; verify its hash against
   the retained OEM original. No approval for cameras, webcam capture or LAN discovery
   follows from approval to read this recording.
2. Open **Recognition → Use my existing DVR** and **Connect to this computer**.
   Select the staging folder and a new, separate backup folder. Neither may contain
   the other. Record physical storage locations privately: separate folders or
   different volume identifiers do not establish separate physical disks.
3. Keep defaults: **100 GiB budget, 2 GiB free-space reserve, 60-second settling**.
   Disable recursive scanning for the one-file trial. Save settings, leave automatic
   analysis off, then explicitly choose **Start backup**. Allow repeated scans and
   the full settling interval. Expect exactly one saved item; then **Stop backup**.
4. Find `BACKUP/Intelligent-DVR-Backup/ITEM/source.EXT` and its `receipt.json`.
   Run the verifier below against the retained original and saved file. It rejects
   the same file/hard links, mismatched bytes, changed files and non-regular files.
   Retain the SQLite index and private file receipt; they contain private paths.

Linux example (replace paths and revision):

```bash
.venv/bin/python -m edge.field_acceptance --source /private/original.mp4 --backup /private/backup/Intelligent-DVR-Backup/ITEM/source.mp4 --approved-completed-recording --input-kind oem --revision COMMIT --output /private/receipts/before.json
```

Windows PowerShell example:

```powershell
.venv\Scripts\python.exe -m edge.field_acceptance --source 'D:\Private\original.mp4' --backup 'E:\Backup\Intelligent-DVR-Backup\ITEM\source.mp4' --approved-completed-recording --input-kind oem --revision COMMIT --output 'D:\Private\receipts\before.json'
```

The utility is read-only except for creating a new receipt (never overwrites).
It exports hashes, sizes and limited metadata, not input paths, filenames or frames.
Use an existing account-private receipt folder; on Windows its ACL controls privacy.
`--input-kind generated` must label any generated-file comparison. Exit 0 means
byte checks passed, exit 1 means failed checks, and exit 2 means a command or output error.
The revision must be the exact 40-character lowercase commit from Git or
`pc-kit.json`; names, paths and descriptive notes are refused. Output failures
explain how to choose a new receipt without printing private paths.
Receipts explicitly leave field acceptance unestablished. They are editable local
records, not signed attestations; even hashes may identify known footage.

### Read byte-check receipts in the app

Open **Recognition → Use my existing DVR → Check backup receipts**. Choose the
current verifier receipt and optionally its earlier receipt. The browser checks
record shape, source/backup correspondence and compatible revision, verifier and
input kind. It fingerprints the selected JSON files and checks an included
previous-receipt link against the exact earlier file. It never opens video or
contacts the local service for this view; files are held in memory until cleared
or the page closes. A failed import preserves the last loaded receipt visibly.

Read each decision separately: reported byte matching, review correspondence,
coverage and backend. Partial coverage stays partial. CPU is not a CUDA result;
reported CUDA metadata still needs independent execution evidence. Generated
input remains labeled. No field, accuracy, separate-disk or capacity acceptance
is assigned. These unsigned records can be edited. The view does not rehash
recordings or authenticate the operator's labels. Use the terminal verifier above
to produce the receipts; a recognition-review JSON is a different file type.

## 4. Decode, analyze and review the same source on CPU and CUDA

For each backend use a **fresh test backup folder**, so existing completed/deduplicated
items do not masquerade as a new execution. Stop the service between backend runs.
Use the prepared analysis configuration from step 1:

```bash
bash scripts/run-linux.sh --analysis --analysis-backend opencv-cpu
# After CPU run and explicit service stop:
bash scripts/run-linux.sh --analysis --analysis-backend cuda-preferred
```

```powershell
.\scripts\Start-IntelligentDvr.ps1 -Analysis -AnalysisBackend opencv-cpu
# After CPU run and explicit service stop:
.\scripts\Start-IntelligentDvr.ps1 -Analysis -AnalysisBackend cuda-preferred
```

Configure the same one-file staging source, select the prepared model/rules, enable
**Analyze copied videos automatically**, explicitly start backup and wait. Save
status/coverage before Stop. Open **Saved videos → Review backup**. Observe matching
fingerprint, actual playable video and correct time span. Inspect beginning, middle
and end; a supported extension alone does not establish decoder/browser support.
Export the review and analyzed recording with the existing Recognition controls.

Run the byte verifier again with `--review /private/ITEM/review.json` and a new
output receipt. Preserve the raw review privately: receipt and trace must bind to
the source hash and agree on runtime. CPU must report `opencv-cpu`. CUDA must report
`onnxruntime-cuda` with positive **CUDAExecutionProvider-only** startup node counts.
The verifier checks those reported fields; it does not independently run inference
or authenticate an edited review. Keep the generated backend check, service run
observation and raw artifacts together. A CPU fallback is a valid fallback result,
**not** a CUDA pass. Compare model, labels, rules and source hashes across both runs.

Analysis eligibility: MP4/M4V/MOV/AVI/MKV/WebM, at most 512 MiB, 6,000 decoded
frames and a five-minute worker budget. Other supported OEM extensions are backup
only; copies over 64 GiB are rejected. Mark partial coverage **PARTIAL**, never a
full decode pass. Video decoding remains CPU-based; CUDA accelerates inference.
Record observed classes/boxes and misses without assigning an accuracy percentage.
Use independent held-out annotations via [offline evaluation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-evaluation)
for recognition quality; one clip cannot establish general accuracy or tracking.

## 5. Controlled interruption and persistence checks

Use only the acceptance instance and its disposable copy of the approved export.
Never interrupt OEM recording, unplug its disk, fill a real disk, delete originals
or edit the production SQLite database. A test too short to interrupt is **NOT RUN**.

| Check | Action and expected observation | Evidence to retain |
| --- | --- | --- |
| Graceful restart | Stop backup, close service with Ctrl+C, relaunch same config. Backup remains paused; one saved item and review persist. | Before/after item IDs, hashes, status and review |
| Interrupted analysis | In a fresh test library, stop service during analysis; relaunch. Inspect visible interrupted/queued state, no automatic analysis; explicitly retry and verify source binding. | Phase at interruption, restart state, retry result |
| Abrupt process exit | Only after approval for interrupting the isolated service, terminate its identified process during copy; restart same state. Incomplete artifacts must not appear as verified completed copies. Valid published receipts may rebuild index rows. Explicitly start and check for a single valid saved item. | Exit method, item/artifact counts, hashes, error and recovery state |
| Source unavailable | Stop service; rename only the disposable staging directory. Relaunch: paused/unavailable setup; saved backup review must remain usable. Restore staging and explicitly resume. | Status and independently rechecked saved file/review |
| Backup unavailable | Stop service; rename only disposable backup root. Relaunch: paused error, no silently recreated root or lost settings. Stop, restore root, restart and verify saved item. | Root existence, status and matching receipt |
| Storage pressure | Reuse automated quota/reserve regressions above. A physical drill requires a separately approved disposable volume; never fill a production disk. | Test output or physical observation marked separately |

Repeat independent original/backup hashing after the drills into `after.json`,
adding `--previous /absolute/private/receipts/before.json` to the verifier command.
This checks that the original hash and byte count are unchanged from the earlier
passing receipt, even if both current files have been replaced with the same new
bytes. The input kind, operator-supplied revision and verifier source hash must
also match. Missing, failed, changed, oversized or incompatible earlier receipts
fail the check. Keep the earlier receipt immutable and choose a new output name.
A reported `previous_binding: MATCHED` compares unsigned local records; it does
not authenticate them or establish physical recovery. Check review fingerprint, coverage,
backend, item ID and count after restart: SQLite persistence is observed through
retained items, not merely the presence of `library.sqlite3`. Keep the whole backup
tree together. Stop service before copying the index and SQLite sidecars. Browser
decisions need separate export; OEM library persistence is cross-platform while
manual `--state-dir` last-job persistence is Linux-only. Power-loss durability,
network-share reconnect behavior and unattended endurance remain unqualified.

## 6. Exportable closeout worksheet

Copy this table into a private text file alongside readiness, before/after byte
receipts, CPU/CUDA raw reviews, generated benchmark and browser exports. Each row
needs PASS / FAIL / BLOCKED / PARTIAL / NOT RUN, UTC time, observer, evidence filename
and SHA-256, plus the actual observation. Do not publish raw reviews, footage,
paths, credentials, host identifiers or model assets. Review a redacted summary
before sharing. Hash files with `sha256sum` on Linux or `Get-FileHash -Algorithm
SHA256` in PowerShell. Preserve receipts outside the installation being tested.

| ID | Required observation | Initial status |
| --- | --- | --- |
| F01 | Owner approval; one closed OEM export; OEM/version and original identity | NOT RUN |
| F02 | Revision, clean/modified checkout, OS/runtime, readiness and private storage | NOT RUN |
| F03 | Generated copy/analysis/browser preliminary check | NOT RUN |
| F04 | Original equals staged file and independently stored backup | NOT RUN |
| F05 | Actual full video decode, browser playback and source-matched review | NOT RUN |
| F06 | Actual recorded CPU execution and completed coverage | NOT RUN |
| F07 | Actual recorded CUDA execution; driver/runtime; fallback separately | NOT RUN |
| F08 | SQLite item/review survives restart; remains paused | NOT RUN |
| F09 | Interrupted copy/analysis and missing-folder recovery | NOT RUN |
| F10 | Original unchanged after all drills; exports reopen correctly | NOT RUN |
| F11 | Independent recognition quality assessment | NOT RUN |

A field pass covers only the tested OEM export, host, codec, backend and drills.
No representative recording or device permission was supplied with this workflow:
physical OEM closure/format compatibility, owner-host decoding, Windows CUDA,
actual interruptions, separate-disk resilience and prolonged recovery require
operator observations. Webcam and live DVR acceptance require separate explicit
authorization and the [field runbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance). No conclusion about
100-camera capacity follows; use the staged [capacity plan](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/100-camera-plan).

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/oem-field-acceptance.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
