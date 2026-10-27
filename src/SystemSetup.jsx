import React, { useEffect, useRef, useState } from "react";
import { Cpu, HardDrives, Memory, Lightning, DownloadSimple, UploadSimple, Check, ArrowCounterClockwise, Desktop, WarningCircle, GraphicsCard } from "@phosphor-icons/react";
import { DEFAULT_SETUP, GPU_PRESETS, GiB, calculateSetup, parseHostSnapshot, parseSetup, resourcePolicy, validateSetup } from "./resources.mjs";
import "./system.css";

const DOCS = "https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/";
const n = (x, digits = 1) => x.toLocaleString(undefined, { maximumFractionDigits: digits });
function NumberField({ label, value, min, max, step = 1, change }) {
  return <label className="system-field"><span>{label}</span><input type="number" min={min} max={max} step={step}
    value={value} onChange={e => change(e.target.value === "" ? "" : Number(e.target.value))} /></label>;
}
function Card({ icon: Icon, title, caption, children, className = "" }) {
  return <section className={`system-card ${className}`}><header><Icon size={24} /><div><h2>{title}</h2>{caption && <p>{caption}</p>}</div></header>{children}</section>;
}
export default function SystemSetup({ setup, onApply, storageError, download }) {
  const [draft, setDraft] = useState(() => structuredClone(setup));
  const [status, setStatus] = useState("");
  const [fileError, setFileError] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [dirty, setDirty] = useState(false);
  const setupFile = useRef(), hostFile = useRef();
  useEffect(() => { setDraft(structuredClone(setup)); setDirty(false); }, [setup]);
  let result, problem = "";
  try { result = calculateSetup(draft); } catch (err) { problem = err.message; }
  function change(group, key, value) {
    setDraft(s => ({ ...s, [group]: { ...s[group], [key]: value } })); setDirty(true); setStatus(""); setFileError("");
  }
  function platform(value) { setDraft(s => ({ ...s, platform: value })); setDirty(true); setStatus(""); setFileError(""); }
  function gpuProfile(value, location = draft.gpu.location) {
    const preset = GPU_PRESETS[value];
    const different = value !== draft.gpu.profile;
    setDraft(s => ({ ...s, gpu: { ...s.gpu, profile: value, location, vramGiB: different ? preset.vramGiB : s.gpu.vramGiB,
      reserveGiB: different ? Math.min(s.gpu.reserveGiB, preset.vramGiB / 4) : s.gpu.reserveGiB },
      power: { ...s.power, gpuW: location === "same-host" ? preset.watts : 0 } }));
    setDirty(true); setStatus(""); setFileError("");
  }
  const field = (group, key, label, min, max, step = 1) => <NumberField key={key} label={label} value={draft[group][key]}
    min={min} max={max} step={step} change={v => change(group, key, v)} />;
  function apply(e) {
    e.preventDefault();
    try { onApply(validateSetup(draft)); setDirty(false); setStatus("Workspace limits applied. Export a policy to apply analyzer limits locally."); }
    catch (err) { setFileError(err.message); }
  }
  async function importFile(event, kind) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setFileError("");
    try {
      if (file.size > 65536) throw Error("Choose a JSON file no larger than 64 KiB.");
      const text = await file.text();
      if (kind === "host") { setSnapshot(parseHostSnapshot(text)); setStatus("Local snapshot loaded for comparison. No settings changed."); }
      else { setDraft(parseSetup(text)); setDirty(true); setStatus("Setup imported for review. Apply when ready."); }
    } catch (err) { setFileError(err.message); }
  }
  function useObserved() {
    setDraft(s => {
      const budget = Math.min(256, snapshot.cpu_logical);
      const threads = Math.min(s.compute.threads, budget);
      const ram = snapshot.ram_total_bytes === null ? s.compute.ramGiB : Math.floor(snapshot.ram_total_bytes / GiB);
      if (ram < 2) return s;
      return { ...s, platform: snapshot.platform, compute: { ...s.compute, ramGiB: ram,
        reserveGiB: Math.min(s.compute.reserveGiB, Math.floor(ram / 4)), threadBudget: budget, threads,
        workerSlots: Math.min(s.compute.workerSlots, Math.floor(budget / threads)) } };
    });
    setDirty(true); setStatus("Reported CPU count and RAM copied into the draft. These are not OS quotas.");
  }
  return <section className="content-page system-page">
    <div className="page-heading system-heading"><div><p className="eyebrow">SYSTEM / LOCAL MACHINE SETUP</p>
      <h1>Give every camera room to work.</h1><p>Size the recording store. Budget the workload. Keep the interface responsive.</p></div>
      <span className="mode-tag">Planning + explicit local limits</span></div>
    <form onSubmit={apply} noValidate>
      <div className="system-platform"><fieldset><legend>Target operating system</legend>
        <label className={draft.platform === "linux" ? "selected" : ""}><input type="radio" name="system-os" value="linux" checked={draft.platform === "linux"} onChange={() => platform("linux")} />Linux · Ubuntu 24.04 LTS</label>
        <label className={draft.platform === "windows" ? "selected" : ""}><input type="radio" name="system-os" value="windows" checked={draft.platform === "windows"} onChange={() => platform("windows")} />Windows 11 Pro</label>
      </fieldset><a className="text-button" href={`${DOCS}setup-${draft.platform}.md`} target="_blank" rel="noreferrer">Open {draft.platform === "linux" ? "Linux" : "Windows"} setup guide ↗</a></div>
      <div className="system-grid">
        <Card icon={HardDrives} title="Recording & retention" caption="A storage estimate from your entered bitrate. No recorder is running." className="system-storage">
          <div className="system-fields four">
            {field("workload", "cameras", "Planned cameras", 1, 10000)}
            {field("workload", "mbps", "Average Mbit/s per camera", .01, 200, .01)}
            {field("workload", "days", "Retention days", 1, 365)}
            {field("workload", "overhead", "Recording overhead (%)", 0, 50)}
          </div>
          <div className="system-array-fields system-fields">
            {field("storage", "drives", "Active HDDs (exclude spares)", 1, 64)}
            {field("storage", "driveTB", "Each HDD (decimal TB)", .1, 100, .1)}
            <label className="system-field"><span>Array layout estimate</span><select value={draft.storage.layout} onChange={e => change("storage", "layout", e.target.value)}>
              <option value="dual-parity">Two parity drives</option><option value="mirror">Mirrored pairs</option><option value="unprotected">Unprotected stripe</option></select></label>
          </div>
          {result && <>
            <div className="system-capacity" role="img" aria-label={`${n(result.neededTB)} TB needed; ${n(result.recordingBudgetTB)} TB recording budget after parity, filesystem allowance and free-space reserve.`}>
              <div className="system-capacity-label"><span>Recording need <strong>{n(result.neededTB)} TB</strong></span><span>Budget <strong>{n(result.recordingBudgetTB)} TB</strong></span></div>
              <div className="system-capacity-track"><span style={{ width: `${Math.min(100, result.neededTB / result.recordingBudgetTB * 100)}%` }} className={result.neededTB > result.recordingBudgetTB ? "over" : ""} /></div>
              <p>{n(result.rawTB)} TB raw → {n(result.protectedTB)} TB after redundancy → {n(result.recordingBudgetTB)} TB recording budget</p>
            </div>
            <div className="system-metrics"><div><small>Calculated retention</small><strong>{n(result.retentionDays)} <em>days</em></strong></div><div><small>Camera network payload</small><strong>{n(result.ingressMbps, 0)} <em>Mbit/s</em></strong></div><div><small>Recording write estimate</small><strong>{n(result.writeMBps)} <em>MB/s</em></strong></div></div>
          </>}
          <details><summary>Filesystem, free space & drive workload</summary><div className="system-fields">
            {field("storage", "fsAllowance", "Filesystem / array allowance (%)", 0, 50)}
            {field("storage", "freeReserve", "Keep free (%)", 5, 80)}
            {field("storage", "readPercent", "Playback / analysis reads (% of writes)", 0, 1000)}
            {field("storage", "workloadRating", "HDD annual workload rating (TB/year)", 1, 10000)}
          </div>{result && <p className="hint">Approx. {n(result.perDriveTBYear)} TB/year per HDD including your read allowance. Ideal sequential writes; excludes rebuilds and small-write amplification. RAID is not a backup.</p>}</details>
        </Card>
        <Card icon={Cpu} title="Processing limits" caption="Export these limits for the local analyzer and scheduler adapter.">
          <div className="system-fields">
            {field("compute", "threads", "OpenCV threads per analyzer", 1, 8)}
            {field("compute", "maxFrames", "Decoded frames per run", 1, 100000)}
            {field("compute", "workerSlots", "Scheduler worker slots", 1, 256)}
            {field("compute", "threadBudget", "Worker thread budget", 1, 256)}
            {field("compute", "bufferMiB", "Retained sample queue (MiB)", 2, 4096)}
            {field("compute", "maxAgeSeconds", "Maximum dispatch age (seconds)", .1, 3600, .1)}
          </div>
          <p className="hint">The analyzer enforces threads and frame count when given the exported policy. The scheduler adapter enforces slots, retained bytes and dispatch age. It creates no workers. These are not OS CPU/RAM or GPU power limits.</p>
        </Card>
        <Card icon={GraphicsCard} title="GPU & VRAM planning" caption="Choose a qualification candidate. The current analyzer still uses OpenCV CPU." className="system-gpu">
          <div className="system-fields"><label className="system-field"><span>GPU candidate</span><select value={draft.gpu.profile} onChange={e => gpuProfile(e.target.value)}>{Object.entries(GPU_PRESETS).map(([id, g]) => <option key={id} value={id}>{g.label}</option>)}</select></label>
            <label className="system-field"><span>GPU location</span><select value={draft.gpu.location} onChange={e => gpuProfile(draft.gpu.profile, e.target.value)}><option value="separate-host">Separate analytics host</option><option value="same-host">This recording host</option></select></label>
            {field("gpu", "vramGiB", "Usable VRAM plan (GiB)", 1, 4096, .1)}
            {field("gpu", "reserveGiB", "Display / other workloads reserve (GiB)", 0, 4095, .1)}
            {field("gpu", "sessions", "Concurrent inference contexts", 1, 256)}
            {field("gpu", "batch", "Batch size per context", 1, 256)}
          </div>{result && <p className="system-reading"><strong>{n(result.gpuEstimatedGiB)} GiB</strong> modeled VRAM / <strong>{n(result.gpuAvailableGiB)} GiB</strong> allowance after reserve.</p>}
          <details><summary>Model and scratch-memory assumptions</summary><div className="system-fields">
            {field("gpu", "modelMiB", "Model / context allocation (MiB each)", 1, 1048576)}
            {field("gpu", "workspaceMiB", "Activations / decoder scratch (MiB each)", 0, 1048576)}
          </div><p className="hint">Adds FP32 640×640 RGB input batches to your estimates per context. Measure actual model, decode surfaces, activations and temporary allocations. Camera count cannot be inferred from VRAM.</p></details>
          <p className="hint">NVIDIA NVDEC handles video decode, CUDA/Tensor cores can handle inference, and NVENC handles encoding. None is activated by this selector. GPU presets also update the power allowance for the chosen location.</p>
          <a className="text-button" href={`${DOCS}gpu-planning.md`} target="_blank" rel="noreferrer">GPU comparison & qualification path ↗</a>
        </Card>
        <Card icon={Memory} title="Memory headroom" caption="Entered allowances; actual model/decoder memory must be measured.">
          <div className="system-fields">
            {field("compute", "ramGiB", "Installed RAM plan (GiB)", 2, 16384)}
            {field("compute", "reserveGiB", "OS / other workloads allowance (GiB)", 0, 16383)}
            {field("compute", "workerMiB", "Estimated RAM per worker (MiB)", 16, 65536)}
          </div>{result && <p className="system-reading"><strong>{n(result.workingGiB)} GiB</strong> estimated workers + retained queue / <strong>{n(result.availableGiB)} GiB</strong> planning allowance.</p>}
          <p className="hint">Excludes decoder copies, model tensors, filesystem cache, UI and GPU VRAM. A reserve here does not allocate or lock physical RAM.</p>
        </Card>
        <Card icon={Desktop} title="A quieter camera wall" caption="These controls take effect in this browser when applied.">
          <label className="system-field"><span>Camera wall tiles</span><select value={draft.browser.visibleTiles} onChange={e => change("browser", "visibleTiles", Number(e.target.value))}><option value="1">1 · Focus</option><option value="2">2 · Balanced</option><option value="4">4 · Camera wall</option></select></label>
          <label className="checkbox-label"><input type="checkbox" checked={draft.browser.pauseHidden} onChange={e => change("browser", "pauseHidden", e.target.checked)} />Pause sample playback in hidden tabs</label>
          <label className="system-field system-overlay-field"><span>Camera overlay pixel scale</span><select value={draft.browser.overlayScale} onChange={e => change("browser", "overlayScale", Number(e.target.value))}><option value="1">1× · Lower canvas cost</option><option value="2">2× · Sharper overlay lines</option></select></label>
          <p className="hint">Reducing wall tiles unmounts the others; selected sources remain visible. 1× uses one quarter of the overlay pixels of 2×, without changing scene images. Expanded views are separate.</p>
        </Card>
        <Card icon={Lightning} title="Power & startup budget" caption="A simultaneous-load estimate, not a measured wall-power reading." className="system-power">
          <div className="system-fields three">
            {field("power", "cpuW", "CPU allowance (W)", 0, 2000)}
            {field("power", "gpuW", "GPU allowance (W; 0 if separate host)", 0, 4000)}
            {field("power", "hddStartupW", "Startup allowance per HDD (W)", 1, 100)}
            {field("power", "otherW", "Board, fans, SSDs, HBA (W)", 0, 4000)}
            {field("power", "psuW", "PSU nameplate output (W)", 100, 10000)}
          </div>{result && <p className="system-reading"><strong>{n(result.startupW, 0)} W</strong> simultaneous estimate · <strong>{n(Math.ceil(result.suggestedPsuW), 0)} W</strong> PSU arithmetic at 75% loading.</p>}
          <p className="hint">Verify per-rail current, native cables, spin-up, CPU boost and GPU transients. Select UPS capacity from measured AC load including camera switches.</p>
        </Card>
        <Card icon={UploadSimple} title="Compare with this machine" caption="Import an explicit read-only snapshot. This page cannot inspect your host disks." className="system-host">
          <button type="button" className="button" onClick={() => hostFile.current.click()}><UploadSimple />Import local host snapshot</button>
          <code className="system-command">{draft.platform === "windows" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python"} -m edge.host --path . --output host-snapshot.json</code>
          {snapshot ? <div className="system-snapshot"><p>{snapshot.platform} · captured {new Date(snapshot.captured_at).toLocaleString()}</p>
            <p>{snapshot.cpu_logical} reported logical CPUs · {snapshot.ram_total_bytes === null ? "RAM unknown" : `${n(snapshot.ram_total_bytes / GiB)} GiB physical RAM`}</p>
            {snapshot.volumes.map(v => <p key={v.label}>{v.label}: {n(v.free_bytes / 1e12, 2)} TB free / {n(v.total_bytes / 1e12, 2)} TB total</p>)}
            <p>{snapshot.gpus.length ? snapshot.gpus.map(g => `${g.name} · ${n(g.memory_mib / 1024)} GiB VRAM`).join("; ") : "GPU inventory unknown / not requested"}</p>
            {snapshot.gpus.length > 0 && <button type="button" className="text-button" onClick={() => { change("gpu", "vramGiB", snapshot.gpus[0].memory_mib / 1024); change("gpu", "profile", "custom"); }}>Use first GPU’s reported VRAM in draft</button>}
            <button type="button" className="text-button" onClick={useObserved}>Use reported CPU count & RAM in draft</button><button type="button" className="text-button" onClick={() => setSnapshot(null)}>Clear snapshot</button>
          </div> : <p className="hint">CPU use, disk health, temperatures, throughput and GPU capacity are unknown. Append --gpu to the command to request a read-only NVIDIA inventory. A snapshot is not a benchmark. Duplicate volume selections may describe the same disk.</p>}
        </Card>
      </div>
      {result?.warnings.length > 0 && <div className="system-warnings"><h2><WarningCircle size={20} />Review the plan</h2><ul>{result.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
      {(problem || fileError || storageError) && <p className="error" role="alert">{problem || fileError || storageError}</p>}
      <div className="system-actions"><button className="button amber" type="submit" disabled={!!problem}><Check />Apply workspace limits</button>
        <button type="button" className="button" disabled={!!problem} onClick={() => download(resourcePolicy(draft), "dvr-resource-policy.json")}><DownloadSimple />Export analyzer policy</button>
        <button type="button" className="button" disabled={!!problem} onClick={() => download(validateSetup(draft), "dvr-machine-setup.json")}><DownloadSimple />Export setup plan</button>
        <button type="button" className="text-button" onClick={() => setupFile.current.click()}><UploadSimple />Import setup</button>
        <button type="button" className="text-button" onClick={() => { setDraft(structuredClone(DEFAULT_SETUP)); setDirty(true); setFileError(""); setStatus("Defaults restored in draft. Apply when ready."); }}><ArrowCounterClockwise />Reset draft</button>
      </div><p className="system-save-state" role="status">{status || (dirty ? "Draft changed. Apply browser limits when ready; exported policies are applied separately by local tools." : "Applied setup is stored in this browser. Hardware, retention and power figures are estimates.")}</p>
    </form>
    <div className="system-docs"><div><h2>Build the machine, then prove the workload.</h2><p>The 100-camera target needs actual recording and analytics qualification. Hardware choices alone establish neither.</p></div><div><a href={`${DOCS}hardware-guide.md`} target="_blank" rel="noreferrer">Hardware & drive shortlist ↗</a><a href={`${DOCS}resource-controls.md`} target="_blank" rel="noreferrer">What each limit enforces ↗</a></div></div>
    <input ref={setupFile} type="file" accept="application/json,.json" hidden onChange={e => importFile(e, "setup")} />
    <input ref={hostFile} type="file" accept="application/json,.json" hidden onChange={e => importFile(e, "host")} />
  </section>;
}
