// Legacy plan IDs remain readable so existing rules and reviewed samples survive.
// These are not connected cameras and contain no generated imagery.
export const cameras = [
  {id:1, name:'Loading Dock'}, {id:2, name:'Front Entrance'},
  {id:3, name:'Warehouse Aisle'}, {id:4, name:'Sales Floor'}, {id:5, name:'Parking Lot'},
];
export const initialRules = cameras.map((c) => ({
  camera: c.id,
  name: c.id === 1 ? "Dock zone" : "Review zone",
  label: c.id === 1 ? "person" : "object",
  dwell: c.id === 1 ? 0 : 60,
  threshold: 0.7,
  rect: [0.12, 0.52, 0.78, 0.43],
  enabled: c.id === 1 || c.id === 3,
}));
export const initialEvents = [
  {
    id: "sample-person-1",
    camera: 1,
    title: "Person in restricted zone",
    time: "10:12:36 AM",
    score: 0.87,
    label: "person",
    status: "pending",
    mode: "sample",
    rule: "Person enters Dock zone",
    note: "",
  },
  {
    id: "sample-object-1",
    camera: 3,
    title: "Object left in zone",
    time: "09:48:21 AM",
    score: 0.76,
    label: "object",
    status: "pending",
    mode: "sample",
    rule: "Object observed in Review zone for 60 seconds",
    note: "",
  },
];
export function validateRule(r) {
  if (!r.name.trim() || r.name.length > 60)
    return "Use a zone name of 1–60 characters.";
  if (!Number.isFinite(r.dwell) || r.dwell < 0 || r.dwell > 3600)
    return "Duration must be 0–3,600 seconds.";
  if (!Number.isFinite(r.threshold) || r.threshold < 0.1 || r.threshold > 1)
    return "Model score must be 0.10–1.00.";
  const [x, y, w, h] = r.rect;
  if (
    ![x, y, w, h].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    w < 0.05 ||
    h < 0.05 ||
    x + w > 1.001 ||
    y + h > 1.001
  )
    return "Keep the entire zone inside the image.";
  return "";
}
export function parseReceipt(v) {
  if (
    v?.schema !== "intelligent-dvr.receipt.v1" ||
    v.mode !== "offline-model" ||
    !Array.isArray(v.events) ||
    v.events.length > 1000 ||
    !["partial", "completed"].includes(v.state) ||
    typeof v.model_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(v.model_sha256) ||
    typeof v.source_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(v.source_sha256)
  )
    throw Error(
      "Use an offline-model receipt from the edge tool (up to 1,000 events).",
    );
  const seen = new Set();
  return v.events.map((e) => {
    if (
      typeof e.id !== "string" ||
      !e.id ||
      e.id.length > 120 ||
      seen.has(e.id) ||
      typeof e.camera !== "string" ||
      !e.camera ||
      e.camera.length > 80 ||
      typeof e.label !== "string" ||
      !e.label ||
      e.label.length > 80 ||
      !Number.isFinite(e.score) ||
      e.score < 0 ||
      e.score > 1 ||
      !Number.isFinite(e.seconds) ||
      e.seconds < 0 ||
      typeof e.rule !== "string" ||
      e.rule.length > 200
    )
      throw Error("Receipt contains invalid or duplicate event fields.");
    seen.add(e.id);
    return {
      id: `import-${e.id}`,
      sourceId: e.id,
      camera: null,
      cameraName: e.camera,
      title: `${e.label} observed in zone`,
      label: e.label,
      time: `Clip +${e.seconds.toFixed(1)}s`,
      score: e.score,
      rule: e.rule,
      status: "pending",
      mode: "offline-model",
      note: "",
      provenance: {
        source_sha256: v.source_sha256,
        model_sha256: v.model_sha256,
        state: v.state,
      },
    };
  });
}

export function restoreSnapshot(key, value, fallback) {
  try {
    if (!Array.isArray(value) || value.length > 1000) return fallback;
    if (key === "dvr.rules.v1") {
      if (
        value.length !== cameras.length ||
        new Set(value.map((r) => r.camera)).size !== cameras.length ||
        value.some(
          (r) =>
            !cameras.some((c) => c.id === r.camera) ||
            typeof r.enabled !== "boolean" ||
            validateRule(r),
        )
      )
        return fallback;
    } else {
      if (new Set(value.map(e => e?.id)).size !== value.length) return fallback;
      if (
        value.some(
          (e) =>
            !e ||
            !["id", "title", "label", "time", "rule", "note"].every(
              (k) => typeof e[k] === "string",
            ) ||
            !e.id || e.id.length > 128 || e.title.length > 300 ||
            e.label.length > 80 || e.time.length > 100 || e.rule.length > 200 || e.note.length > 2000 ||
            (e.mode === "sample" && !cameras.some(c => c.id === e.camera)) ||
            !Number.isFinite(e.score) ||
            e.score < 0 ||
            e.score > 1 ||
            !["pending", "confirmed", "dismissed"].includes(e.status) ||
            !["sample", "offline-model"].includes(e.mode),
        )
      )
        return fallback;
      if (
        value.some(
          (e) =>
            e.mode === "offline-model" &&
            (!e.provenance ||
              !["partial", "completed"].includes(e.provenance.state) ||
              typeof e.cameraName !== "string" ||
              e.cameraName.length > 80 || e.camera !== null ||
              !["source_sha256", "model_sha256"].every(
                (k) =>
                  typeof e.provenance[k] === "string" &&
                  /^[a-f0-9]{64}$/i.test(e.provenance[k]),
              )),
        )
      )
        return fallback;
    }
    return value;
  } catch {
    return fallback;
  }
}
export function reviewEvent(events, id, status, note) {
  if (!["confirmed", "dismissed"].includes(status))
    throw Error("Invalid review action");
  return events.map((e) =>
    e.id === id
      ? {
          ...e,
          status,
          note: note.slice(0, 2000),
          reviewedAt: new Date().toISOString(),
        }
      : e,
  );
}
