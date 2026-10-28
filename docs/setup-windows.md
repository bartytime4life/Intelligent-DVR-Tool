# Run on Windows

[Hardware and storage](hardware-guide.md) · [GPU plan](gpu-planning.md) · [Resource limits](resource-controls.md) · [Linux](setup-linux.md)

Reference target: **Windows 11 Pro x86-64**, Node.js **22**, Python **3.12**, PowerShell and a WebGL-capable browser. Use a supported Windows release and qualified motherboard/NIC/HBA/GPU drivers. Microsoft's Windows 11 hardware requirements include UEFI/Secure Boot capability and TPM 2.0 [W1]. An OS license and hardware costs are separate from this project's subscription-free analysis stack.

## Prepare the machine

1. Choose the same storage/CPU/RAM/GPU budget used for Linux, then validate **Windows drivers and recovery tools** for the exact board, HBA/RAID controller and backplane.
2. Install Windows on a separate SSD. Have the storage operator provision and verify the chosen recording volume, with an explicit drive letter/mount path. A validated RAID6 controller plus NTFS is one candidate. Do not assume Linux RAIDZ2 or server-only Storage Spaces features are available as an equivalent Windows 11 client configuration.
3. Install Node.js 22 from [Node's official distribution](https://nodejs.org/en/download), Python 3.12 from [Python's official Windows downloads](https://www.python.org/downloads/windows/), and Git. Check `node --version`, then `py -3.12 --version` or the selected `python --version`.
4. Use an ordinary account and a trusted project checkout. Review OS update/reboot, sleep, BitLocker/recovery-key, UPS and backup policy with the owner. No supplied script changes execution policy, disables security software, changes power plans or installs a background service.

## Install and start

From PowerShell in the repository root:

```powershell
.\scripts\Start-IntelligentDvr.ps1 -Check
.\scripts\Start-IntelligentDvr.ps1 -Install
```

`-Check` checks prerequisites only. `-Install` runs `npm ci`, creates `.venv` if absent, installs native edge test dependencies, builds current source and runs a **127.0.0.1-only preview** on port 4173. Dependency installation uses the network. No model download, camera admission, GPU activation, disk formatting or host resource changes occur.

If your Python 3.12 executable is selected through PATH rather than the `py` launcher:

```powershell
.\scripts\Start-IntelligentDvr.ps1 -Check -Python python
.\scripts\Start-IntelligentDvr.ps1 -Install -Python python
```

A full interpreter path can be passed with `-Python`. If organizational policy blocks the script, use the individual documented npm/Python commands or have the administrator review/sign it; do not disable policy to make it run.

On subsequent runs, use `Start-IntelligentDvr.ps1` without `-Install`; `-Port 4175` chooses another loopback port. Ctrl+C stops the foreground preview. Open the printed address and choose **System → Windows**. Review the plan before applying browser limits or exporting a local policy.

Manual equivalent after prerequisites are installed:

```powershell
npm.cmd ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r edge\requirements-test.txt
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Do not run venv creation over an existing environment you intend to keep; the launcher already preserves it. Manual activation is unnecessary when using the explicit environment interpreter.

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

Paths are examples; validate the rule and ensure directories exist. The selected pretrained artifact must have the exact profile's verified hash. This example uses the default CPU route; the policy enforces OpenCV threads and decoded-frame count. It does not impose Windows CPU-rate, total-process-memory, disk-bandwidth or GPU-power limits. The [optional CUDA route](../edge/README.md#optional-explicit-cuda-backend) was qualified only on the recorded Linux owner PC; Windows CUDA remains unqualified.

## Windows containment boundary

A production local worker supervisor could apply native **Job Object** CPU-rate/memory limits before running child workers. Microsoft's Job Object APIs describe that mechanism [W2]. This repository does not yet implement such a supervisor. Changing Task Manager priority is not equivalent to a hard quota, and the System page's RAM reserve is only a planning allowance.

Keep the future recording service and the interactive review UI separate. Qualify actual Windows camera/codec compatibility, storage recovery, driver updates, power failure, long sessions and the 100-source workload before unattended use. The Windows CI matrix checks software contracts; it does not perform physical-camera or target-machine acceptance. The Linux-only bounded model-qualification worker is not a Windows feature; its platform-specific cases remain explicitly skipped there.

## Primary references

- **W1:** [Microsoft Windows 11 specifications](https://www.microsoft.com/en-us/windows/windows-11-specifications).
- **W2:** [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
- GPU and codec sources are linked in [GPU planning](gpu-planning.md).
