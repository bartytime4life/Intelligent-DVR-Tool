# Run on Windows

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) · [Screenshot atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) · [Troubleshooting](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Troubleshooting)

![Workflow diagram for setup windows.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/start.svg)

**Quick path:** Install prerequisites and the isolated PC runtime → prepare local models → run Check → Start the foreground loopback service.

[Hardware and storage](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Hardware-guide) · [GPU plan](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/GPU-planning) · [Resource limits](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Resource-controls) · [Linux](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Linux-setup)

Reference target: **Windows 11 Pro x86-64**, Node.js **22**, Python **3.12**, PowerShell and a WebGL-capable browser. Use a supported Windows release and qualified motherboard/NIC/HBA/GPU drivers. Microsoft's Windows 11 hardware requirements include UEFI/Secure Boot capability and TPM 2.0 [W1]. An OS license and hardware costs are separate from this project's subscription-free analysis stack.

## Prepare the machine

1. Choose the same storage/CPU/RAM/GPU budget used for Linux, then validate **Windows drivers and recovery tools** for the exact board, HBA/RAID controller and backplane.
2. Install Windows on a separate SSD. Have the storage operator provision and verify the chosen recording volume, with an explicit drive letter/mount path. A validated RAID6 controller plus NTFS is one candidate. Do not assume Linux RAIDZ2 or server-only Storage Spaces features are available as an equivalent Windows 11 client configuration.
3. Install 64-bit Python 3.12 from [Python's official Windows downloads](https://www.python.org/downloads/windows/). A source checkout additionally needs Node.js 22 and Git; the prebuilt kit does not. Check `py -3.12 --version` or the selected `python --version`.
4. Use an ordinary account and a trusted project checkout. Review OS update/reboot, sleep, BitLocker/recovery-key, UPS and backup policy with the owner. No supplied script changes execution policy, disables security software, changes power plans or installs a background service.

## Install and start for PC testing

Use the [PC test kit and first-device checklist](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing). Extract the
complete kit into a writable folder, then double-click Install-Windows.cmd,
Check-Windows.cmd and Start-Windows.cmd in that order. The prebuilt kit needs
Python 3.12; Node/Git are only needed to build a source checkout.

PowerShell alternatives:

~~~powershell
.\scripts\Start-IntelligentDvr.ps1 -Install
.\scripts\Start-IntelligentDvr.ps1 -Check
.\scripts\Start-IntelligentDvr.ps1
~~~

Install uses edge/requirements-qualification.txt in an isolated .venv, creates an
empty local-feeds.json if absent and exits. Check tests package integrity, pinned
native libraries, local video/JPEG decoding, temporary storage, config and port
availability. Start opens the actual local service at http://127.0.0.1:4173.
No camera or inference job starts automatically. Ctrl+C stops the foreground app.

Use -Python python or an explicit Python 3.12 path when needed; -NoBrowser avoids
browser opening, and -Port changes the loopback port. Keep the same origin for
saved reviews. Reinstall preserves settings and refuses incompatible environments.
If scripts/downloads are blocked, use the normal operator review/signing process;
do not disable execution policy or other protections.

Manual Python entry points (same installer/check/launcher):

~~~powershell
py -3.12 -m edge.pc_setup --install
py -3.12 -m edge.pc_setup --check
py -3.12 -m edge.pc_setup
~~~

## Read-only inventory and local policy

Choose an existing path on the intended recording volume and a new output filename:

```powershell
.\.venv\Scripts\python.exe -m edge.host --path 'R:\Recordings' --gpu --output "$env:TEMP\dvr-host-001.json"
.\.venv\Scripts\python.exe -m edge.resources --policy 'C:\PrivateDvr\dvr-resource-policy.json'
```

The first command queries only selected volume capacity, OS CPU/RAM totals and the opt-in fixed NVIDIA name/VRAM query. Import its JSON locally in System. The second validates the exported policy only. Neither starts analysis, tunes the OS, creates an array or installs drivers.

For an explicitly approved recording/model and new output files:

```powershell
.\.venv\Scripts\python.exe -m edge.analyze `
  --video 'R:\ApprovedPilot\dock.avi' `
  --model 'C:\PrivateDvr\object_detection_yolox_2022nov.onnx' `
  --labels edge\labels\coco80.json --profile opencv-zoo-yolox-s-2022nov `
  --rules edge\rules.example.json --camera dock-01 --stride 5 `
  --resource-policy 'C:\PrivateDvr\dvr-resource-policy.json' `
  --output 'R:\ApprovedPilot\receipt-001.json' `
  --trace-output 'R:\ApprovedPilot\trace-001.json'
```

Paths are examples; validate the rule and ensure directories exist. The selected pretrained artifact must have the exact profile's verified hash. This example uses the default CPU route; the policy enforces OpenCV threads and decoded-frame count. It does not impose Windows CPU-rate, total-process-memory, disk-bandwidth or GPU-power limits. The [optional CUDA route](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Edge-CLI#optional-explicit-cuda-backend) was qualified only on the recorded Linux owner PC; Windows CUDA remains unqualified.

## Windows containment boundary

The local analysis and DVR preview workers apply Windows **Job Object** process-memory limits and kill-on-close containment [W2]. They do not implement Windows CPU-rate quotas. Changing Task Manager priority is not equivalent to a hard quota; the System page's RAM reserve remains a planning allowance.

Keep the future recording service and the interactive review UI separate. Qualify actual Windows camera/codec compatibility, storage recovery, driver updates, power failure, long sessions and the 100-source workload before unattended use. The Windows CI matrix checks software contracts; it does not perform physical-camera or target-machine acceptance. The Linux-only bounded model-qualification worker is not a Windows feature; its platform-specific cases remain explicitly skipped there.

## Primary references

- **W1:** [Microsoft Windows 11 specifications](https://www.microsoft.com/en-us/windows/windows-11-specifications).
- **W2:** [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
- GPU and codec sources are linked in [GPU planning](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/GPU-planning).

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/setup-windows.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
