# Resource controls: what actually takes effect

[Guide index](README.md) · [Visual handbook](how-to.md) · [Screenshot atlas](visual-atlas.md) · [Troubleshooting](troubleshooting.md)

![Workflow diagram for resource controls.](media/guide/system.svg)

**Quick path:** Enter workload assumptions → Apply workspace limits for browser behavior → Export analyzer policy for supported offline limits → measure actual use.

![November 11 System workspace with basic recording and browser settings first. Values are editable assumptions, not detected hardware or benchmarks.](media/guided-experience-2026-11-11/06-system-after.jpg)

*PR #110 source `13355e18`, merged as `cb91fa40`; [capture provenance](media/guided-experience-2026-11-11/README.md).*

[Hardware](hardware-guide.md) · [Linux](setup-linux.md) · [Windows](setup-windows.md) · [GPU planning](gpu-planning.md)

Open **System** in the main navigation, or use `/#system`. The page combines workload planning and explicit local limits. It has no privileged host-control API.

Start with **Recording & retention** and **A quieter camera wall**. Expand
**Advanced planning details** for processing, GPU, memory, power and host-snapshot
comparison. Collapsing it keeps every entered value. **Unapplied advanced changes**
remains visible when those values differ from the applied plan, including an
empty or invalid edit. Validation warnings and save status stay outside the
disclosure; changing the disclosure does not apply any setting.

## Controls and their scope

| Setting / action | Enforced now | Limits |
| --- | --- | --- |
| Camera wall tiles: 1, 2 or 4 | Applied browser setting unmounts excess wall tiles and keeps the selected source visible | Does not connect, decode or analyze real cameras; an expanded view is separate |
| Zone overlay pixel scale: 1× or 2× | Applied setting changes the Zones editor's overlay canvas dimensions | 1× uses a quarter of the overlay pixels of 2×; source imagery is unaffected; no frame-rate claim |
| Hidden-page behavior | Camera previews and recording playback always stop/pause when the page is hidden; no pause toggle is offered | Exported policies set `pause_when_hidden` to true even for older plans that stored false; this does not stop explicitly running local backup or LAN recording jobs |
| OpenCV threads per analyzer | `edge.analyze --resource-policy FILE` calls `cv2.setNumThreads` with a value no greater than the policy cap | OpenCV's CPU pool only; other native libraries/decoders and the OS may have additional threads |
| Decoded frames per run | Analyzer stops reading at the policy ceiling and records partial state when the bound is reached | A decoded-frame count, not seconds or a memory ceiling; stride still controls analyzed samples |
| Worker slots, retained queue bytes, dispatch age | `scheduler_from_policy` constructs the bounded scheduler with these limits | No worker processes are created; it is not yet wired into live ingest or the recording analyzer |
| Worker slots × OpenCV threads budget | Validation rejects configurations whose product exceeds the entered budget | Planning/admission constraint, not an OS CPU-rate quota |
| RAM reserve, per-worker memory and VRAM allowances | Checked for consistent arithmetic and warnings | No physical RAM/VRAM is reserved; tensors, decoding and other allocations need measurement |
| GPU candidate, context/batch and power plan | Updates VRAM arithmetic and GPU watts for the selected location | Does not activate CUDA/NVDEC/NVENC, change clocks or set a power cap |
| Drive count, layout, bitrate and retention | Recomputes capacity, free reserve, read/write workload and warnings | Does not provision RAID, record footage, delete old files or measure storage speed |
| Read-only host snapshot | Explicit Python command reports selected local OS counters; browser import is local | No live dashboard, health guarantee or background polling |

## Save, import and export

**Apply workspace limits** validates the draft and applies its supported browser limits. The machine plan is then saved as plain `intelligent-dvr.setup.v1` JSON under `dvr.setup.v1`, using a shared browser save lock. Read the saving/error message: applying limits in memory does not by itself establish that the browser saved the plan. If saving fails, export the setup plan before closing; applying it again retries the save. Browsers without shared save locking keep changes in memory and report that saving is unavailable.

**Reset draft** changes only the form until Apply. **Discard draft & use applied setup** restores the currently applied plan, which may itself still need saving. The legacy sample reset is separate from the machine plan.

- **Export setup plan:** all numerical planning inputs, selected platform and browser preferences, schema `intelligent-dvr.setup.v1`. It contains no cameras, credentials or host snapshot.
- **Import setup:** bounded to 64 KiB and checked for exact fields/ranges, array consistency, thread budget and reserves. Import creates a reviewable draft; it does not immediately apply settings.
- **Export analyzer policy:** schema `intelligent-dvr.resource-policy.v1`, containing the browser limits and bounded analysis settings. GPU/RAM/power estimates are deliberately absent because they are not runtime quotas. Export uses the current valid draft; applying the browser settings is a separate action.
- **Import host snapshot:** schema `intelligent-dvr.host-snapshot.v1`, at most 64 KiB, eight selected volumes and sixteen GPU records. Extra fields, paths and serials are not retained. Snapshot state is session-only. Reported data is untrusted input, not authenticated hardware attestation.

An imported snapshot never silently overwrites a plan. The explicit copy buttons put reported CPU/RAM or first-GPU VRAM into the draft; review and Apply. Duplicate volume selections may refer to the same filesystem and must not be summed blindly.

### Recover a machine-plan save

A clean tab can adopt a valid plan saved by another tab. Unapplied form edits stay in the form; the message explains that the applied plan changed. Discarding that draft loads the applied version. A failed save also keeps the applied plan in memory: another tab cannot silently replace it or clear its error.

1. At **Machine plan save conflict**, choose **Download this version** and **Download other version** before choosing. These downloads contain the applied plans; **Export setup plan** in System instead exports the current valid form draft. Valid plan downloads can be opened with **Import setup**, which creates a draft for review.
2. Apply or discard any unfinished System draft before choosing **Keep this tab’s version** or **Use other tab’s version**. The displaced plan must be backed up first. Storage failures or a version/draft change while the choice waits leave the choice unresolved. If the other tab removed its save, **Use default machine plan** is an explicit reset choice.
3. Each machine-plan workspace has ten saved conflict-copy slots. Existing copies are never replaced automatically. In **Saved conflict copies**, choose **Download copy**, check the file, then explicitly **Remove this copy** to free a slot. Removal becomes available after that exact copy's download starts and rechecks its stored bytes before deleting it. A valid plan copy is directly importable; a damaged copy remains an archival recovery download.

Unreadable startup data remains available through **Download unreadable machine plan**. Opening System leaves it untouched. Explicitly applying even the unchanged defaults preserves the original bytes before saving the plan; an earlier recovery copy is not silently replaced. Keep that download rather than clearing storage to force a save. Unapplied drafts and unsaved applied plans trigger the browser's unfinished-work warning on reload/close. Browser storage and its conflict copies are not a permanent filesystem backup.

## Local policy contract

The app's default export is shared with Python tests in [the contract fixture](../tests/fixtures/resource-policy.json):

```json
{
  "schema": "intelligent-dvr.resource-policy.v1",
  "platform": "linux",
  "browser": { "visible_tiles": 4, "pause_when_hidden": true, "overlay_scale": 2 },
  "analysis": {
    "opencv_threads": 1,
    "worker_slots": 8,
    "thread_budget": 16,
    "max_sample_bytes": 1228800,
    "max_buffer_bytes": 268435456,
    "max_age_seconds": 2,
    "max_frames": 6000
  }
}
```

The OS label is planning metadata; the numerical analyzer limits have the same semantics on Linux and Windows. `max_sample_bytes` describes one 640×640×3 byte RGB sample, not a float32 tensor. Retained bytes include pending and in-flight scheduler payloads; memory outside that component is separate.

```python
from edge.resources import load_policy, scheduler_from_policy
policy, policy_sha256 = load_policy('/private/dvr/dvr-resource-policy.json')
scheduler = scheduler_from_policy(['dock-01', 'gate-02'], policy)
# Caller explicitly submits samples, executes Work and completes tokens.
# No workers, camera connections or inference are started by construction.
```

For `edge.analyze`, omitted `--threads` / `--max-frames` take policy values. Explicit values can lower the caps; exceeding either fails before inference. Without a policy, legacy defaults remain one OpenCV thread and 6,000 decoded frames. Successful receipts/traces record the policy hash and actual applied analyzer limits. Other policy fields are not misreported as enforced analyzer features.

## OS hard limits and future work

The optional [Linux process adapter](performance-100-cameras.md#optional-linux-process-supervision)
is constructed explicitly by local application code. A policy-created scheduler
does not start it or choose its factory, deadlines or restart budget. The adapter
requires 1–4 scheduler slots and rejects larger counts; it does not silently
clamp an exported plan. Its polled deadlines, bounded IPC and owned-child
termination are distinct from the browser's planning fields and OS quotas.

Use the Linux/Windows guides for the distinction between cgroup/systemd properties and Windows Job Object limits. System planning does not control OS containment, filesystem quotas, GPU power, retention deletion or process priorities. The separate LAN recorder does apply its own bounded retention after explicit Start; the OEM backup library never deletes copies automatically. An admitted host-control service still needs authenticated narrow APIs, supported OS enforcement, per-process health and durable failure receipts before such controls can be presented as live.

The 100-camera requirement remains a workload qualification target. Valid policy imports, successful calculations and green unit tests do not establish sustained camera throughput or recognition quality.
