// Deterministic setup arithmetic. Values are plans, never hardware measurements.
export const SETUP_SCHEMA = "intelligent-dvr.setup.v1";
export const POLICY_SCHEMA = "intelligent-dvr.resource-policy.v1";
export const HOST_SCHEMA = "intelligent-dvr.host-snapshot.v1";
export const MiB = 1024 ** 2;
export const GiB = 1024 ** 3;
export const GPU_PRESETS = {
  rtx5080: { label: "GeForce RTX 5080 · 16 GB", vramGiB: 16, watts: 360 },
  pro4000: { label: "RTX PRO 4000 Blackwell · 24 GB", vramGiB: 24, watts: 140 },
  pro5000: { label: "RTX PRO 5000 Blackwell · 48 GB variant", vramGiB: 48, watts: 300 },
  rtx5090: { label: "GeForce RTX 5090 · 32 GB", vramGiB: 32, watts: 575 },
  custom: { label: "Other GPU · enter measured usable VRAM", vramGiB: 16, watts: 360 },
};
export const DEFAULT_SETUP = {
  schema: SETUP_SCHEMA, platform: "linux",
  workload: { cameras: 100, mbps: 4, days: 30, overhead: 10 },
  storage: { drives: 12, driveTB: 24, layout: "dual-parity", fsAllowance: 5, freeReserve: 20, readPercent: 50, workloadRating: 550 },
  compute: { ramGiB: 128, reserveGiB: 32, workerMiB: 512, workerSlots: 8, threads: 1, threadBudget: 16, bufferMiB: 256, maxAgeSeconds: 2, maxFrames: 6000 },
  power: { cpuW: 170, gpuW: 0, otherW: 100, hddStartupW: 30, psuW: 1000 },
  gpu: { profile: "rtx5080", location: "separate-host", vramGiB: 16, reserveGiB: 4, sessions: 2, batch: 4, modelMiB: 512, workspaceMiB: 2048 },
  browser: { visibleTiles: 4, pauseHidden: true, overlayScale: 2 },
};

const ranges = {
  workload: { cameras: [1, 10000, true], mbps: [.01, 200], days: [1, 365, true], overhead: [0, 50] },
  storage: { drives: [1, 64, true], driveTB: [.1, 100], fsAllowance: [0, 50], freeReserve: [5, 80], readPercent: [0, 1000], workloadRating: [1, 10000] },
  compute: { ramGiB: [2, 16384], reserveGiB: [0, 16383], workerMiB: [16, 65536], workerSlots: [1, 256, true], threads: [1, 8, true], threadBudget: [1, 256, true], bufferMiB: [2, 4096, true], maxAgeSeconds: [.1, 3600], maxFrames: [1, 100000, true] },
  power: { cpuW: [0, 2000], gpuW: [0, 4000], otherW: [0, 4000], hddStartupW: [1, 100], psuW: [100, 10000] },
  gpu: { vramGiB: [1, 4096], reserveGiB: [0, 4095], sessions: [1, 256, true], batch: [1, 256, true], modelMiB: [1, 1048576], workspaceMiB: [0, 1048576] },
};
const finite = (x) => typeof x === "number" && Number.isFinite(x);
function keys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== expected.length || expected.some(k => !Object.hasOwn(value, k)))
    throw Error(`${label}: use the declared fields only.`);
}
function number(value, range, label) {
  const [lo, hi, integer] = range;
  if (!finite(value) || value < lo || value > hi || (integer && !Number.isInteger(value)))
    throw Error(`${label}: use ${integer ? "a whole number" : "a number"} from ${lo} to ${hi}.`);
}
export function validateSetup(input) {
  keys(input, Object.keys(DEFAULT_SETUP), "Setup");
  if (input.schema !== SETUP_SCHEMA || !["linux", "windows"].includes(input.platform)) throw Error("Unsupported setup version or platform.");
  for (const [group, fields] of Object.entries(ranges)) {
    keys(input[group], Object.keys(DEFAULT_SETUP[group]), group);
    for (const [key, range] of Object.entries(fields)) number(input[group][key], range, key);
  }
  if (!["dual-parity", "mirror", "unprotected"].includes(input.storage.layout)) throw Error("Choose a supported storage layout.");
  if (input.storage.layout === "dual-parity" && input.storage.drives < 4) throw Error("Dual parity needs at least four active drives.");
  if (input.storage.layout === "mirror" && input.storage.drives % 2) throw Error("Mirrored pairs need an even active-drive count.");
  if (input.compute.reserveGiB >= input.compute.ramGiB) throw Error("Leave some RAM after the operating-system reserve.");
  if (!Object.hasOwn(GPU_PRESETS, input.gpu.profile) || !["same-host", "separate-host"].includes(input.gpu.location)) throw Error("Choose a supported GPU profile and location.");
  if (input.gpu.reserveGiB >= input.gpu.vramGiB) throw Error("GPU reserve must leave usable VRAM.");
  if (input.compute.workerSlots * input.compute.threads > input.compute.threadBudget) throw Error("Worker slots × threads exceeds the worker thread budget.");
  keys(input.browser, ["visibleTiles", "pauseHidden", "overlayScale"], "Browser settings");
  if (![1, 2, 4].includes(input.browser.visibleTiles) || typeof input.browser.pauseHidden !== "boolean" || ![1, 2].includes(input.browser.overlayScale)) throw Error("Choose valid tile, pause and overlay-scale settings.");
  return structuredClone(input);
}
export function parseSetup(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > 65536) throw Error("Setup exceeds the 64 KiB limit.");
  return validateSetup(JSON.parse(text));
}
export function calculateSetup(input) {
  const s = validateSetup(input), { workload: w, storage: d, compute: c, power: p, gpu: g } = s;
  const dataDrives = d.layout === "dual-parity" ? d.drives - 2 : d.layout === "mirror" ? d.drives / 2 : d.drives;
  const ingressMbps = w.cameras * w.mbps;
  const videoTBPerDay = ingressMbps * 1e6 / 8 * 86400 / 1e12;
  const storedTBPerDay = videoTBPerDay * (1 + w.overhead / 100);
  const protectedTB = dataDrives * d.driveTB;
  const formattedTB = protectedTB * (1 - d.fsAllowance / 100);
  const recordingBudgetTB = formattedTB * (1 - d.freeReserve / 100);
  const neededTB = storedTBPerDay * w.days;
  const requiredProtectedTB = neededTB / ((1 - d.fsAllowance / 100) * (1 - d.freeReserve / 100));
  // Ideal sequential full-stripe writes / mirrored pairs. Rebuilds and small writes are excluded.
  const perDriveTBYear = storedTBPerDay * 365 / dataDrives * (1 + d.readPercent / 100);
  const bufferGiB = c.bufferMiB / 1024;
  const workingGiB = c.workerSlots * c.workerMiB / 1024 + bufferGiB;
  const pendingAndInflightMiB = (w.cameras + c.workerSlots) * 640 * 640 * 3 / MiB;
  const startupW = p.cpuW + p.gpuW + p.otherW + d.drives * p.hddStartupW;
  const gpuEstimatedGiB = g.sessions * (g.modelMiB + g.workspaceMiB + g.batch * 640 * 640 * 3 * 4 / MiB) / 1024;
  const gpuAvailableGiB = g.vramGiB - g.reserveGiB;
  return { dataDrives, rawTB: d.drives * d.driveTB, protectedTB, formattedTB, recordingBudgetTB,
    ingressMbps, writeMBps: storedTBPerDay * 1e12 / 86400 / 1e6, videoTBPerDay, storedTBPerDay,
    neededTB, requiredProtectedTB, retentionDays: recordingBudgetTB / storedTBPerDay, perDriveTBYear,
    workingGiB, availableGiB: c.ramGiB - c.reserveGiB, pendingAndInflightMiB,
    startupW, suggestedPsuW: startupW / .75, gpuEstimatedGiB, gpuAvailableGiB,
    warnings: [
      ...(recordingBudgetTB < neededTB ? ["The planned array does not meet the requested retention."] : []),
      ...(d.layout === "unprotected" ? ["This storage layout has no drive-failure redundancy."] : []),
      ...(perDriveTBYear > d.workloadRating ? ["Modeled reads + writes exceed the entered per-drive annual workload rating."] : []),
      ...(workingGiB > c.ramGiB - c.reserveGiB ? ["Estimated workers and queue exceed the RAM planning allowance."] : []),
      ...(gpuEstimatedGiB > gpuAvailableGiB ? ["Estimated GPU contexts, workspace and batch tensors exceed the entered VRAM allowance."] : []),
      ...(g.location === "same-host" && p.gpuW === 0 ? ["The GPU is on this host but the GPU power allowance is zero."] : []),
      ...(pendingAndInflightMiB > c.bufferMiB ? ["The queue budget cannot retain one 640×640 RGB sample per camera plus every worker; admission can reject samples."] : []),
      ...(startupW > p.psuW * .75 ? ["The simultaneous-start estimate exceeds 75% of the entered PSU rating; review rails, startup and GPU transients."] : []),
    ],
  };
}
export function resourcePolicy(input) {
  const s = validateSetup(input), c = s.compute;
  return { schema: POLICY_SCHEMA, platform: s.platform,
    browser: { visible_tiles: s.browser.visibleTiles, pause_when_hidden: s.browser.pauseHidden, overlay_scale: s.browser.overlayScale },
    analysis: { opencv_threads: c.threads, worker_slots: c.workerSlots, thread_budget: c.threadBudget,
      max_sample_bytes: 640 * 640 * 3, max_buffer_bytes: c.bufferMiB * MiB,
      max_age_seconds: c.maxAgeSeconds, max_frames: c.maxFrames } };
}
export function visibleCameraSlots(slots, selected, count) {
  const result = slots.slice(0, count);
  if (!result.includes(selected)) result[0] = selected;
  return result;
}
export function sampleShouldRun(playing, hidden, pauseHidden) {
  return !!playing && !(hidden && pauseHidden);
}
export function parseHostSnapshot(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > 65536) throw Error("Snapshot exceeds the 64 KiB limit.");
  const s = JSON.parse(text);
  if (s?.schema !== HOST_SCHEMA || !["linux", "windows"].includes(s.platform) ||
      typeof s.captured_at !== "string" || !Number.isFinite(Date.parse(s.captured_at)) || s.captured_at.length > 40)
    throw Error("Choose a supported local host snapshot.");
  number(s.cpu_logical, [1, 65536, true], "Reported CPUs");
  if (s.ram_total_bytes !== null) number(s.ram_total_bytes, [GiB, 16384 * GiB], "Reported RAM");
  if (!Array.isArray(s.volumes) || s.volumes.length > 8 || !Array.isArray(s.gpus) || s.gpus.length > 16) throw Error("Invalid host inventory bounds.");
  const volumes = s.volumes.map((v, i) => {
    number(v.total_bytes, [1, 1e18], "Disk total"); number(v.free_bytes, [0, v.total_bytes], "Disk free");
    return { label: `Selected volume ${i + 1}`, total_bytes: v.total_bytes, free_bytes: v.free_bytes };
  });
  const gpus = s.gpus.map(g => {
    if (typeof g.name !== "string" || g.name.length > 120) throw Error("Invalid GPU name.");
    number(g.memory_mib, [1, 1048576], "GPU memory");
    return { name: g.name, memory_mib: g.memory_mib };
  });
  return { schema: HOST_SCHEMA, platform: s.platform, captured_at: s.captured_at,
    cpu_logical: s.cpu_logical, ram_total_bytes: s.ram_total_bytes, volumes, gpus };
}
