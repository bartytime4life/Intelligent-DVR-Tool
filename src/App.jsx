import React, { useEffect, useRef, useState } from "react";
import {
  Monitor,
  ListBullets,
  Selection,
  GearSix,
  CaretDown,
  CaretRight,
  Play,
  Pause,
  Eye,
  EyeSlash,
  ArrowsOutSimple,
  X,
  Info,
  Cube,
  User,
  Question,
  Check,
  ArrowCounterClockwise,
  UploadSimple,
  DownloadSimple,
  MagnifyingGlass,
  ShieldCheck,
  Camera,
  WarningCircle,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import {
  cameras,
  initialEvents,
  initialRules,
  validateRule,
  parseReceipt,
  reviewEvent,
  restoreSnapshot,
} from "./data.mjs";
const cameraOf = (e) => cameras.find((c) => c.id === e.camera);
function download(data, name) {
  const u = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function useStored(key, initial) {
  const [v, set] = useState(() => {
    try {
      const x = JSON.parse(localStorage.getItem(key));
      return restoreSnapshot(key, x, initial);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {}
  }, [key, v]);
  return [v, set];
}
function Modal({ title, close, children, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const before = document.activeElement;
    ref.current.showModal();
    return () => before?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-heading">
        <div>
          <p className="eyebrow">INTELLIGENT DVR</p>
          <h2>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function project(w, h) {
  const scale = Math.max(w / 1536, h / 1024),
    iw = 1536 * scale,
    ih = 1024 * scale;
  return { iw, ih, ox: (w - iw) / 2, oy: (h - ih) / 2 };
}
function Overlay({
  camera,
  rule,
  visible = true,
  edit = false,
  onRect,
  time = 0,
}) {
  const ref = useRef(),
    start = useRef();
  useEffect(() => {
    const el = ref.current,
      ctx = el.getContext("2d");
    function draw() {
      const w = el.clientWidth,
        h = el.clientHeight;
      el.width = w * 2;
      el.height = h * 2;
      ctx.scale(2, 2);
      ctx.clearRect(0, 0, w, h);
      if (!visible) return;
      const { iw, ih, ox, oy } = project(w, h);
      if (rule?.enabled || edit) {
        const [x, y, rw, rh] = rule.rect;
        ctx.strokeStyle = "#ffbc3c";
        ctx.fillStyle = "#ffbc3c12";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([7, 5]);
        ctx.fillRect(x * iw + ox, y * ih + oy, rw * iw, rh * ih);
        ctx.strokeRect(x * iw + ox, y * ih + oy, rw * iw, rh * ih);
        ctx.setLineDash([]);
      }
      if (camera?.box && !edit) {
        const [x, y, bw, bh] = camera.box;
        ctx.strokeStyle = "#ffbc3c";
        ctx.lineWidth = 1.6;
        ctx.strokeRect(x * iw + ox, y * ih + oy, bw * iw, bh * ih);
      }
    }
    draw();
    const o = new ResizeObserver(draw);
    o.observe(el);
    return () => o.disconnect();
  }, [camera, rule, visible, edit, time]);
  function point(e) {
    const r = e.currentTarget.getBoundingClientRect(),
      { iw, ih, ox, oy } = project(r.width, r.height);
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left - ox) / iw)),
      Math.max(0, Math.min(1, (e.clientY - r.top - oy) / ih)),
    ];
  }
  return (
    <canvas
      ref={ref}
      className={`overlays ${edit ? "editable" : ""}`}
      aria-label={
        edit
          ? "Drag to define zone; keyboard controls below"
          : "Simulated detection and review zone"
      }
      onPointerDown={
        edit
          ? (e) => {
              start.current = point(e);
              e.currentTarget.setPointerCapture(e.pointerId);
            }
          : undefined
      }
      onPointerUp={
        edit
          ? (e) => {
              if (!start.current) return;
              const p = point(e),
                s = start.current;
              start.current = null;
              const r = [
                Math.min(p[0], s[0]),
                Math.min(p[1], s[1]),
                Math.abs(p[0] - s[0]),
                Math.abs(p[1] - s[1]),
              ];
              if (r[2] >= 0.05 && r[3] >= 0.05) onRect(r);
            }
          : undefined
      }
    />
  );
}
function CameraTile({ camera, selected, select, expand, rule, large = false }) {
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [overlays, setOverlays] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setTime((t) => (t >= 20 ? 0 : t + 0.25)), 250);
    return () => clearInterval(id);
  }, [playing]);
  return (
    <article
      className={`camera-tile ${selected ? "selected" : ""} ${large ? "large" : ""}`}
    >
      <div className="camera-picture" onClick={() => select?.(camera.id)}>
        <img
          src={camera.image}
          alt={`Synthetic sample scene: ${camera.name}`}
        />
        <Overlay camera={camera} rule={rule} visible={overlays} time={time} />
        <div className="camera-title">
          Cam {camera.id}
          <span>—</span>
          {camera.name}
        </div>
        <span className="sample-badge">SAMPLE</span>
        {overlays && rule?.enabled && (
          <span className="zone-caption">
            {rule.name} <span>· configured</span>
          </span>
        )}
      </div>
      <div className="playback">
        <button
          className="icon-button"
          aria-label={`${playing ? "Pause" : "Play"} sample for ${camera.name}`}
          title="Simulated playback of a still image"
          onClick={() => setPlaying((x) => !x)}
        >
          {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
        </button>
        <span className="playback-time">
          00:{String(Math.floor(time)).padStart(2, "0")}
          <span> / 00:20</span>
        </span>
        <input
          aria-label={`Sample position for ${camera.name}`}
          type="range"
          min="0"
          max="20"
          step=".25"
          value={time}
          onChange={(e) => setTime(+e.target.value)}
        />
        <button
          className="icon-button"
          aria-label={`${overlays ? "Hide" : "Show"} overlays for ${camera.name}`}
          onClick={() => setOverlays((x) => !x)}
        >
          {overlays ? <Eye /> : <EyeSlash />}
        </button>
        {!large && (
          <button
            className="icon-button"
            aria-label={`Expand ${camera.name}`}
            onClick={() => expand(camera)}
          >
            <ArrowsOutSimple />
          </button>
        )}
      </div>
    </article>
  );
}
function EventRow({ event, review, zone }) {
  const c = cameraOf(event);
  return (
    <article className="event-card">
      <div className="event-preview">
        {c ? (
          <img src={c.image} alt={`Generated sample evidence at ${c.name}`} />
        ) : (
          <Camera size={35} />
        )}
        <span className="sample-badge">
          {event.mode === "sample" ? "SAMPLE" : "OFFLINE"}
        </span>
      </div>
      <div className="event-content">
        <time>{event.time}</time>
        <p className="event-source">
          {c ? `Cam ${c.id} · ${c.name}` : event.cameraName}
        </p>
        <div className="event-description">
          {event.label === "person" ? <User size={23} /> : <Cube size={23} />}
          <div>
            <h3>{event.title}</h3>
            <p>
              Model score <strong>{event.score.toFixed(2)}</strong>
            </p>
          </div>
        </div>
        <button className="button amber" onClick={() => review(event)}>
          Review event
          <CaretRight size={17} />
        </button>
        {c && event.label === "object" && (
          <button
            className="text-button event-zone"
            onClick={() => zone(event.camera)}
          >
            Edit review zone
            <CaretRight size={13} />
          </button>
        )}
      </div>
    </article>
  );
}
export function App() {
  const [tab, setTab] = useState("Monitor"),
    [selected, setSelected] = useState(1),
    [slots, setSlots] = useState([1, 2, 3, 4]),
    [events, setEvents] = useStored("dvr.events.v1", initialEvents),
    [rules, setRules] = useStored("dvr.rules.v1", initialRules),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [draft, setDraft] = useState(initialRules[0]),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [video, setVideo] = useState(null);
  const importRef = useRef(),
    videoRef = useRef(),
    pending = events.filter((e) => e.status === "pending");
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(
    () => () => {
      if (video) URL.revokeObjectURL(video.url);
    },
    [video],
  );
  function zone(id = selected) {
    setSelected(id);
    const r = rules.find((r) => r.camera === id);
    setDraft({ ...r, rect: [...r.rect] });
    setError("");
    setTab("Zones");
  }
  function selectCamera(id) {
    setSlots((s) =>
      s.includes(id)
        ? s
        : s.map((v, i) =>
            v === selected || (!s.includes(selected) && i === 0) ? id : v,
          ),
    );
    setSelected(id);
  }
  function review(e) {
    setNote(e.note || "");
    setModal({ type: "review", event: e });
  }
  function decide(status) {
    setEvents((es) => reviewEvent(es, modal.event.id, status, note));
    setModal(null);
    setToast(
      `${status === "confirmed" ? "Observation confirmed" : "Event dismissed"}. Review saved in this browser.`,
    );
  }
  function saveRule(e) {
    e.preventDefault();
    const problem = validateRule(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setRules((rs) => rs.map((r) => (r.camera === selected ? draft : r)));
    setError("");
    setToast("Review rule saved in this browser.");
  }
  function tryRule() {
    const problem = validateRule(draft);
    if (problem) {
      setError(problem);
      return;
    }
    if (!draft.enabled) {
      setToast("Enable this rule to try a sample.");
      return;
    }
    const score = draft.label === "person" ? 0.87 : 0.76;
    if (score < draft.threshold) {
      setToast("Sample score is below the threshold. No event created.");
      return;
    }
    const sampleId = `sample-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    setEvents((es) =>
      [
        {
          id: sampleId,
          camera: selected,
          title: `${draft.label === "person" ? "Person" : "Object"} in ${draft.name}`,
          time: "10:12:36 AM",
          score,
          label: draft.label,
          status: "pending",
          mode: "sample",
          rule: `${draft.label} observed in ${draft.name} for ${draft.dwell} seconds (simulated test)`,
          note: "",
        },
        ...es,
      ].slice(0, 1000),
    );
    setToast("Simulated rule event added to the review queue.");
  }
  async function importReceipt(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 1024 * 1024)
        throw Error("Receipt exceeds the 1 MB limit.");
      const added = parseReceipt(JSON.parse(await file.text()));
      setEvents((es) =>
        [
          ...added,
          ...es.filter((x) => !added.some((a) => a.id === x.id)),
        ].slice(0, 1000),
      );
      setTab("Events");
      setToast(
        `Imported ${added.length} offline observations. No video was uploaded.`,
      );
    } catch (err) {
      setToast(err.message);
    }
  }
  function openVideo(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      setToast("Choose a supported video file.");
      return;
    }
    setVideo({ url: URL.createObjectURL(f), name: f.name });
    setModal({ type: "video" });
  }
  const visible = events.filter(
    (e) =>
      (filter === "all" || e.status === filter) &&
      `${e.title} ${cameraOf(e)?.name || e.cameraName} ${e.rule}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="topbar">
        <div className="brand-mark">
          <Monitor size={27} />
        </div>
        <div className="wordmark">Intelligent DVR</div>
        <span className="header-divider" />
        <span className="pilot-label">Five-camera pilot</span>
        <button className="workspace-select" onClick={() => setTab("Settings")}>
          Demo workspace
          <CaretDown size={14} />
        </button>
        <div className="header-right">
          <span className="header-date">
            Oct 24, 2026 <span>· sample</span>
          </span>
          <button
            className="icon-button"
            aria-label="About this pilot"
            onClick={() => setModal({ type: "help" })}
          >
            <Question size={23} />
          </button>
        </div>
      </header>
      <nav className="sidebar" aria-label="Main navigation">
        {[
          [Monitor, "Monitor"],
          [ListBullets, "Events"],
          [Selection, "Zones"],
          [GearSix, "Settings"],
        ].map(([Icon, label]) => (
          <button
            key={label}
            onClick={() => (label === "Zones" ? zone() : setTab(label))}
            aria-current={tab === label ? "page" : undefined}
            className={`nav-item ${tab === label ? "active" : ""}`}
          >
            <Icon size={25} />
            <span>{label}</span>
            {label === "Events" && pending.length > 0 && (
              <b className="nav-count">{pending.length}</b>
            )}
          </button>
        ))}
        <button
          className="sidebar-help"
          aria-label="Pilot information"
          onClick={() => setModal({ type: "help" })}
        >
          <ShieldCheck size={23} />
        </button>
      </nav>
      <main id="workspace" className={`workspace tab-${tab.toLowerCase()}`}>
        {tab === "Monitor" && (
          <>
            <div className="monitor-layout">
              <section className="camera-wall" aria-label="Sample camera wall">
                {slots.map((id) => (
                  <CameraTile
                    key={id}
                    camera={cameras.find((c) => c.id === id)}
                    selected={id === selected}
                    select={setSelected}
                    expand={(c) => setModal({ type: "camera", camera: c })}
                    rule={rules.find((r) => r.camera === id)}
                  />
                ))}
              </section>
              <aside className="review-queue">
                <div className="queue-heading">
                  <h2>
                    Review queue <span>{pending.length}</span>
                  </h2>
                  <button
                    className="icon-button"
                    aria-label="Review information"
                    onClick={() => setModal({ type: "help" })}
                  >
                    <Question size={18} />
                  </button>
                </div>
                <p className="queue-subtitle">
                  <User size={14} />
                  Human review required
                </p>
                <div>
                  {pending.slice(0, 3).map((e) => (
                    <EventRow
                      key={e.id}
                      event={e}
                      review={review}
                      zone={zone}
                    />
                  ))}
                  {!pending.length && (
                    <div className="empty-state">
                      <Check size={32} />
                      <h3>You’re all caught up</h3>
                      <p>No observations awaiting review.</p>
                      <button
                        className="button"
                        onClick={() => setTab("Events")}
                      >
                        View review history
                      </button>
                    </div>
                  )}
                </div>
                <div className="queue-note">
                  <ShieldCheck size={19} />
                  <p>
                    Observations, not verdicts.
                    <br />
                    <span>Always verify the original footage.</span>
                  </p>
                </div>
              </aside>
            </div>
            <section className="sources">
              <div className="source-heading">
                <h2>
                  Camera sources <span>5</span>
                </h2>
                <span>Simulated scenes</span>
              </div>
              <div className="source-strip">
                {cameras.map((c) => (
                  <button
                    className={`source ${selected === c.id ? "active" : ""}`}
                    key={c.id}
                    onClick={() => selectCamera(c.id)}
                    aria-label={`Select ${c.name}`}
                    aria-pressed={selected === c.id}
                  >
                    <div className="source-image">
                      <img src={c.image} alt="" />
                      <span className="sample-badge">SAMPLE</span>
                    </div>
                    <span className="source-title">
                      <Camera size={14} />
                      <span>
                        Cam {c.id}
                        <small>{c.name}</small>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
        {tab === "Events" && (
          <section className="content-page">
            <div className="page-heading">
              <div>
                <p className="eyebrow">OBSERVATIONS & EVIDENCE</p>
                <h1>Event history</h1>
                <p>
                  Review what was observed, why it was flagged, and your
                  decision.
                </p>
              </div>
              <button
                className="button"
                onClick={() =>
                  download(
                    {
                      schema: "intelligent-dvr.review-export.v1",
                      exportedAt: new Date().toISOString(),
                      events,
                    },
                    "dvr-reviews.json",
                  )
                }
              >
                <DownloadSimple />
                Export reviews
              </button>
            </div>
            <div className="event-filters">
              <label className="search-field">
                <MagnifyingGlass size={19} />
                <input
                  aria-label="Search events"
                  placeholder="Search camera, event, or rule"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <select
                aria-label="Review status"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="pending">Awaiting review</option>
                <option value="confirmed">Confirmed</option>
                <option value="dismissed">Dismissed</option>
              </select>
              <button
                className="button"
                onClick={() => importRef.current.click()}
              >
                <UploadSimple />
                Import receipt
              </button>
            </div>
            <div className="event-table">
              {visible.length ? (
                visible.map((e) => (
                  <button
                    className="event-table-row"
                    key={e.id}
                    onClick={() => review(e)}
                  >
                    <span className="table-icon">
                      {e.label === "person" ? (
                        <User size={24} />
                      ) : (
                        <Cube size={24} />
                      )}
                    </span>
                    <span className="event-row-title">
                      {e.title}
                      <small>
                        {cameraOf(e)?.name || e.cameraName} · {e.time}
                      </small>
                    </span>
                    <span className="mode-tag">
                      {e.mode === "sample" ? "Sample" : "Offline model"}
                    </span>
                    <span className={`status ${e.status}`}>
                      {e.status === "pending" ? "Awaiting review" : e.status}
                    </span>
                    <CaretRight size={18} />
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  <MagnifyingGlass size={30} />
                  <h3>No matching events</h3>
                  <p>Try a different search or status.</p>
                </div>
              )}
            </div>
          </section>
        )}
        {tab === "Zones" && (
          <section className="content-page">
            <div className="page-heading">
              <div>
                <p className="eyebrow">EXPLICIT RULES · HUMAN REVIEW</p>
                <h1>Define what needs attention</h1>
                <p>
                  Draw a zone, then choose what should enter the review queue.
                </p>
              </div>
              <select
                aria-label="Camera for zone"
                value={selected}
                onChange={(e) => zone(+e.target.value)}
              >
                {cameras.map((c) => (
                  <option value={c.id} key={c.id}>
                    Cam {c.id} · {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="zone-layout">
              <div>
                <div className="zone-editor">
                  <img
                    src={cameras.find((c) => c.id === selected).image}
                    alt="Synthetic scene for configuring a review zone"
                  />
                  <Overlay
                    rule={draft}
                    edit
                    onRect={(rect) => setDraft((r) => ({ ...r, rect }))}
                  />
                  <span className="sample-badge">SAMPLE · DRAG TO DRAW</span>
                </div>
                <p className="hint">
                  <Info size={16} />
                  Drag across the scene, or use the keyboard controls below.
                </p>
                <div className="geometry-fields">
                  {["Left", "Top", "Width", "Height"].map((label, i) => (
                    <label key={label}>
                      {label} (%)
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={Math.round(draft.rect[i] * 100)}
                        onChange={(e) =>
                          setDraft((r) => ({
                            ...r,
                            rect: r.rect.map((v, j) =>
                              i === j ? +e.target.value / 100 : v,
                            ),
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
              <form className="rule-form" onSubmit={saveRule}>
                <h2>Review rule</h2>
                <label>
                  Zone name
                  <input
                    maxLength="60"
                    value={draft.name}
                    onChange={(e) =>
                      setDraft((r) => ({ ...r, name: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Observe
                  <select
                    value={draft.label}
                    onChange={(e) =>
                      setDraft((r) => ({ ...r, label: e.target.value }))
                    }
                  >
                    <option value="person">Person</option>
                    <option value="object">Object</option>
                  </select>
                </label>
                <label>
                  Minimum time in zone (seconds)
                  <input
                    type="number"
                    min="0"
                    max="3600"
                    value={draft.dwell}
                    onChange={(e) =>
                      setDraft((r) => ({ ...r, dwell: +e.target.value }))
                    }
                  />
                </label>
                <label>
                  Minimum model score
                  <input
                    type="number"
                    min=".1"
                    max="1"
                    step=".01"
                    value={draft.threshold}
                    onChange={(e) =>
                      setDraft((r) => ({ ...r, threshold: +e.target.value }))
                    }
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) =>
                      setDraft((r) => ({ ...r, enabled: e.target.checked }))
                    }
                  />
                  Enable review rule
                </label>
                <p className="hint">
                  A score is a model output, not a probability of danger.
                  “Object” is a sample category; real models need explicit
                  supported labels.
                </p>
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <button className="button amber" type="submit">
                  Save review rule
                  <Check />
                </button>
                <button className="button" type="button" onClick={tryRule}>
                  <Play />
                  Try simulated event
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    download(
                      { schema: "intelligent-dvr.rules.v1", rules },
                      "dvr-browser-rules.json",
                    )
                  }
                >
                  <DownloadSimple />
                  Export browser rules
                </button>
              </form>
            </div>
          </section>
        )}
        {tab === "Settings" && (
          <section className="content-page settings">
            <div className="page-heading">
              <div>
                <p className="eyebrow">PILOT WORKSPACE</p>
                <h1>Make the boundaries clear.</h1>
                <p>
                  A working review interface. Camera and model qualification
                  come next.
                </p>
              </div>
              <span className="mode-tag">Demo workspace</span>
            </div>
            <div className="settings-grid">
              <section>
                <Camera size={28} />
                <h2>Camera connections</h2>
                <p>
                  No cameras are connected. These five scenes and detections are
                  generated samples. RTSP / ONVIF compatibility has not been
                  tested.
                </p>
                <div className="setting-row">
                  <span>Connected cameras</span>
                  <strong>0 of 5</strong>
                </div>
                <div className="setting-row">
                  <span>Detection model</span>
                  <strong>Not configured</strong>
                </div>
                <div className="setting-row">
                  <span>Measured latency</span>
                  <strong>Not measured</strong>
                </div>
              </section>
              <section>
                <UploadSimple size={28} />
                <h2>Bring your own evidence</h2>
                <p>
                  Preview a local video in this browser. This does not run AI or
                  upload footage. Import observations from the included offline
                  edge tool separately.
                </p>
                <button
                  className="button"
                  onClick={() => videoRef.current.click()}
                >
                  Open local video
                  <UploadSimple />
                </button>
                <button
                  className="button"
                  onClick={() => importRef.current.click()}
                >
                  Import analysis receipt
                  <UploadSimple />
                </button>
              </section>
              <section>
                <ShieldCheck size={28} />
                <h2>Your data stays in your control</h2>
                <p>
                  Rules and review decisions are saved in this browser. Video
                  previews remain in memory. No cloud inference, remote camera
                  access, or automatic enforcement is running.
                </p>
                <button
                  className="text-button"
                  onClick={() => setModal({ type: "reset" })}
                >
                  <ArrowCounterClockwise />
                  Reset sample workspace
                </button>
              </section>
              <section>
                <SlidersHorizontal size={28} />
                <h2>From pilot to real operation</h2>
                <p>
                  Qualify a supported ONNX model on approved recordings. Define
                  object labels and zones, then measure false alerts and
                  end-to-end latency on the target hardware.
                </p>
                <p>
                  Costs, support, storage, and camera coverage need an agreed
                  scope. No efficiency or real-time performance is promised.
                </p>
                <a
                  className="text-button"
                  href="https://github.com/bartytime4life/Intelligent-DVR-Tool"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open project repository
                  <CaretRight />
                </a>
              </section>
            </div>
          </section>
        )}
      </main>
      <footer className="footer">
        <Info size={21} />
        <strong>No cameras connected</strong>
        <span className="footer-divider" />
        <span>
          {events.some((e) => e.mode === "offline-model") ? (
            "Camera previews are simulated. Imported observations need source review."
          ) : (
            <>
              All camera views and detections are <b>sample / simulated.</b>
            </>
          )}
        </span>
        <span className="footer-end">Edge-first. Human-reviewed.</span>
      </footer>
      <input
        hidden
        ref={importRef}
        type="file"
        accept="application/json,.json"
        onChange={importReceipt}
      />
      <input
        hidden
        ref={videoRef}
        type="file"
        accept="video/*"
        onChange={openVideo}
      />
      {toast && (
        <div className="toast" role="status">
          <Info size={20} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setToast("")}
          >
            <X />
          </button>
        </div>
      )}
      {modal?.type === "camera" && (
        <Modal title={modal.camera.name} wide close={() => setModal(null)}>
          <CameraTile
            camera={modal.camera}
            large
            rule={rules.find((r) => r.camera === modal.camera.id)}
          />
          <p className="hint">
            Simulated playback animates a timeline over a generated still. No
            camera or video stream is connected.
          </p>
        </Modal>
      )}
      {modal?.type === "review" && (
        <Modal title="Review observation" wide close={() => setModal(null)}>
          <div className="review-dialog-layout">
            <div>
              {cameraOf(modal.event) ? (
                <>
                  <img
                    className="review-evidence"
                    src={cameraOf(modal.event).image}
                    alt="Generated sample evidence scene"
                  />
                  <span className="mode-tag">SIMULATED EVIDENCE</span>
                </>
              ) : (
                <div className="missing-evidence">
                  <Camera size={44} />
                  <h3>Original footage stays local</h3>
                  <p>
                    Open the source recording at {modal.event.time} to verify
                    this observation. The receipt contains metadata only.
                  </p>
                </div>
              )}
              <p className="hint">
                {modal.event.time} ·{" "}
                {cameraOf(modal.event)?.name || modal.event.cameraName}
              </p>
            </div>
            <div className="review-details">
              <h3>{modal.event.title}</h3>
              <dl>
                <dt>Configured rule</dt>
                <dd>{modal.event.rule}</dd>
                <dt>Model score</dt>
                <dd>
                  {modal.event.score.toFixed(2)}{" "}
                  <small>· not a risk probability</small>
                </dd>
                {modal.event.provenance && (
                  <>
                    <dt>Imported receipt</dt>
                    <dd>
                      {modal.event.provenance.state} · unverified metadata
                    </dd>
                    <dt>Model SHA-256</dt>
                    <dd className="hash">
                      {modal.event.provenance.model_sha256}
                    </dd>
                    <dt>Source SHA-256</dt>
                    <dd className="hash">
                      {modal.event.provenance.source_sha256}
                    </dd>
                  </>
                )}
                <dt>Status</dt>
                <dd className={`status ${modal.event.status}`}>
                  {modal.event.status === "pending"
                    ? "Awaiting review"
                    : modal.event.status}
                </dd>
              </dl>
              <label>
                Review note
                <textarea
                  maxLength="2000"
                  placeholder="What did you observe?"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <button
                className="button amber"
                onClick={() => decide("confirmed")}
              >
                <Check />
                Confirm observation
              </button>
              <button className="button" onClick={() => decide("dismissed")}>
                <X />
                Dismiss event
              </button>
              <p className="hint">
                Confirming records your review. It does not establish intent or
                trigger external actions.
              </p>
            </div>
          </div>
        </Modal>
      )}
      {modal?.type === "video" && video && (
        <Modal title="Local video preview" wide close={() => setModal(null)}>
          <p>{video.name}</p>
          <video
            className="local-video"
            controls
            src={video.url}
            onError={() =>
              setToast(
                "This browser cannot decode this video. Try MP4 with H.264 video.",
              )
            }
          />
          <p className="hint">
            Local playback only. No AI analysis is running. No footage is
            uploaded.
          </p>
        </Modal>
      )}
      {modal?.type === "help" && (
        <Modal
          title="A clear view. A human decision."
          close={() => setModal(null)}
        >
          <p>
            This pilot demonstrates a five-camera review workflow with synthetic
            scenes and sample events.
          </p>
          <p>
            “Out of place” means an explicitly configured object, zone, and
            duration rule. It is not a judgment about a person’s intent.
          </p>
          <p>
            Sample playback uses a generated still and simulated timeline. Real
            video can be previewed locally. Actual model detections require the
            separate edge tool and your qualified model.
          </p>
          <div className="notice">
            <WarningCircle size={21} />
            <span>
              Detection quality, camera compatibility, and real-time latency
              have not been qualified.
            </span>
          </div>
          <button className="button amber" onClick={() => setModal(null)}>
            Understood
            <Check />
          </button>
        </Modal>
      )}
      {modal?.type === "reset" && (
        <Modal title="Reset the sample workspace?" close={() => setModal(null)}>
          <p>
            This clears browser-saved reviews, imported observations, and sample
            rules. Your video files are unaffected.
          </p>
          <button
            className="button amber"
            onClick={() => {
              setEvents(initialEvents);
              setRules(initialRules);
              setModal(null);
              setTab("Monitor");
              setSelected(1);
              setSlots([1, 2, 3, 4]);
              setToast("Sample workspace restored.");
            }}
          >
            Reset workspace
            <ArrowCounterClockwise />
          </button>
          <button className="button" onClick={() => setModal(null)}>
            Keep my workspace
          </button>
        </Modal>
      )}
    </div>
  );
}
