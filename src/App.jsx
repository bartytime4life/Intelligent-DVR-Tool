import React, { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
const FacilityBuilder = lazy(() => import("./FacilityBuilder.jsx").then(m => ({default:m.FacilityBuilder})));
const SystemSetup = lazy(() => import("./SystemSetup.jsx"));
import LiveMonitor from "./LiveMonitor.jsx";
const RecognitionReview = lazy(() => import("./RecognitionReview.jsx"));
import { mergeRecognitionEvents } from './recognition.mjs';
import { workspaceFromHash, readWorkspace, writeWorkspace, preserveUnreadable, reviewExport, parseReviewExport } from './workspace-state.mjs';
import { backdropDismiss } from './dialog-dismiss.mjs';
import { DEFAULT_SETUP, parseSetup } from "./resources.mjs";
import {
  Monitor,
  Buildings,
  ListBullets,
  Selection,
  GearSix,
  CaretRight,
  Eye,
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
  Cpu,
} from "@phosphor-icons/react";
import {
  cameras,
  initialRules,
  validateRule,
  parseReceipt,
  reviewEvent,
} from "./data.mjs";
const cameraOf = (e) => cameras.find((c) => c.id === e.camera);
// Observations from different recordings of one camera otherwise look identical.
const recordingTag = (e) => e.provenance?.source_sha256 ? <span className="event-recording" title={`Source SHA-256 ${e.provenance.source_sha256}`}> · rec {e.provenance.source_sha256.slice(0, 8)}</span> : null;
const ruleFor = (rules, camera) => {
  const r = rules.find((r) => r.camera === camera) || initialRules.find((r) => r.camera === camera) || initialRules[0];
  return { ...r, rect: [...r.rect] };
};
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
function downloadText(text, name) {
  const u = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
const browserStorage = () => ({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
function useStored(key, initial) {
  const [loaded] = useState(() => readWorkspace(browserStorage(), key, initial));
  const [v, set] = useState(loaded.value);
  const [saveError, setSaveError] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(Boolean(loaded.error));
  const adopted = useRef(null);
  useEffect(() => {
    if ((loaded.error && v === loaded.value) || v === adopted.current) return;
    if (loaded.raw != null && !preserveUnreadable(browserStorage(), key, loaded.raw)) {
      setSaveError("Changes are only in memory. The unreadable saved entry could not be backed up, so it was not replaced. Export before closing this page.");
      return;
    }
    setSaveError(writeWorkspace(browserStorage(), key, v));
  }, [key, v, loaded]);
  useEffect(() => {
    // Another tab saved newer data. Adopt it instead of overwriting it with this tab's older copy.
    const changed = e => {
      if (e.storageArea !== localStorage || e.key !== key || e.newValue === null) return;
      const next = readWorkspace({ getItem: () => e.newValue }, key, null);
      if (next.error || !next.value) return;
      adopted.current = next.value;
      set(next.value);
      setSaveError("");
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);
  const recovery = recoveryOpen ? { message: loaded.error, raw: loaded.raw, dismiss: () => setRecoveryOpen(false) } : null;
  return [v, set, saveError || recovery?.message || "", recovery];
}
class WorkspaceBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="content-page workspace-error" role="alert">
        <p className="eyebrow">{this.props.name.toUpperCase()}</p>
        <h1>This workspace stopped unexpectedly</h1>
        <p>Other workspaces, saved reviews and the current Recognition session are unaffected. Try again, or reload if the app was just updated. Reloading clears unsaved in-memory clips.</p>
        <p className="hint">{this.state.error?.message}</p>
        <div className="review-actions">
          <button className="button" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="button" onClick={() => window.location.reload()}>Reload page</button>
        </div>
      </section>
    );
  }
}
function Modal({ title, close, children, wide = false }) {
  const ref = useRef();
  const titleId = useId();
  useEffect(() => {
    const before = document.activeElement;
    ref.current.showModal();
    return () => before?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={close}
      {...backdropDismiss(close)}
    >
      <div className="modal-heading">
        <div>
          <p className="eyebrow">INTELLIGENT DVR</p>
          <h2 id={titleId}>{title}</h2>
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
  rule,
  edit = false,
  onRect,
  pixelScale = 2,
}) {
  const ref = useRef(),
    start = useRef();
  useEffect(() => {
    const el = ref.current,
      ctx = el.getContext("2d");
    function draw() {
      const w = el.clientWidth,
        h = el.clientHeight;
      el.width = w * pixelScale;
      el.height = h * pixelScale;
      ctx.scale(pixelScale, pixelScale);
      ctx.clearRect(0, 0, w, h);
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
    }
    draw();
    const o = new ResizeObserver(draw);
    o.observe(el);
    return () => o.disconnect();
  }, [rule, edit, pixelScale]);
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
function EventRow({ event, review, zone }) {
  const c = cameraOf(event);
  return (
    <article className="event-card">
      <div className="event-preview">
        <Camera size={35} />
        <span className="sample-badge">
          {event.mode === "sample" ? "SAMPLE" : "OFFLINE"}
        </span>
      </div>
      <div className="event-content">
        <time>{event.time}</time>
        <p className="event-source">
          {c ? `Cam ${c.id} · ${c.name}` : event.cameraName}
          {recordingTag(event)}
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
  const [tab, updateTab] = useState(() => workspaceFromHash(window.location.hash) || "Monitor"),
    [selected, setSelected] = useState(1),
    [events, setEvents, eventsStorageError, eventsRecovery] = useStored("dvr.events.v1", []),
    [rules, setRules, rulesStorageError, rulesRecovery] = useStored("dvr.rules.v1", initialRules),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [draft, setDraft] = useState(() => ruleFor(rules, 1)),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [video, setVideo] = useState(null);
  const [liveCount, setLiveCount] = useState(0);
  const [capturedClip, setCapturedClip] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [capturePending, setCapturePending] = useState(false);
  useEffect(() => {
    if (!capturedClip && !capturePending) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [capturedClip, capturePending]);
  const [recognitionOpened, setRecognitionOpened] = useState(tab === "Recognition");
  const [clearedEvents, setClearedEvents] = useState(null);
  const [eventMode, setEventMode] = useState("all");
  // Read the latest queue after asynchronous file reads and rapid consecutive imports.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  // Leaving Facility unmounts the builder, so unsaved drafts and its undo history would be lost silently.
  const tabRef = useRef(tab), facilityDirty = useRef(false);
  tabRef.current = tab;
  const mayLeave = (next) => {
    if (tabRef.current !== "Facility" || next === "Facility" || !facilityDirty.current) return true;
    if (!window.confirm("Leave the facility builder? Unsaved facility edits, drafts and undo history will be discarded.")) return false;
    facilityDirty.current = false; // popstate and hashchange can both report one Back press.
    return true;
  };
  function setTab(next) {
    if (!mayLeave(next)) return;
    if (next === "Recognition") setRecognitionOpened(true);
    updateTab(next);
    const hash = `#${next.toLowerCase()}`;
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
  }
  useEffect(() => {
    const changed = () => {
      const next = workspaceFromHash(window.location.hash);
      if (!next) return; // Preserve the skip-to-workspace anchor.
      if (!mayLeave(next)) { window.history.pushState(null, "", "#facility"); return; }
      if (next === "Recognition") setRecognitionOpened(true);
      updateTab(next);
    };
    window.addEventListener("popstate", changed);
    window.addEventListener("hashchange", changed);
    return () => { window.removeEventListener("popstate", changed); window.removeEventListener("hashchange", changed); };
  }, []);
  function addObservations(added, openEvents = true) {
    try {
      const merged = mergeRecognitionEvents(eventsRef.current, added);
      const newCount = merged.length - eventsRef.current.length;
      eventsRef.current = merged;
      setEvents(merged);
      if (openEvents) { setFilter("all"); setEventMode("all"); setQuery(""); setTab("Events"); }
      setToast(`${newCount} new observations added. Existing decisions kept. Footage stays local.`);
      return true;
    } catch (err) { setToast(err.message); return false; }
  }
  function exportReviews() { download(reviewExport(eventsRef.current), "dvr-reviews.json"); }
  function undoClear() {
    if (clearedEvents && addObservations(clearedEvents)) setClearedEvents(null);
  }
  const [resourceState, setResourceState] = useState(() => {
    let saved = null;
    try {
      saved = localStorage.getItem("dvr.setup.v1");
      return { setup: saved ? parseSetup(saved) : structuredClone(DEFAULT_SETUP), error: "" };
    } catch {
      return { setup: structuredClone(DEFAULT_SETUP), unreadable: saved, error: "Saved machine setup was unavailable or invalid. Defaults are shown; the unreadable entry is kept as a browser backup. Export your plan if storage is unavailable." };
    }
  });
  const loadedSetup = useRef(resourceState.setup), adoptedSetup = useRef(null);
  const [pageHidden, setPageHidden] = useState(document.hidden);
  const resources = resourceState.setup;
  useEffect(() => {
    const changed = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    // Nothing changed yet: never replace an unreadable or another tab's entry on load.
    if (resources === loadedSetup.current || resources === adoptedSetup.current) return;
    try {
      if (resourceState.unreadable != null && !preserveUnreadable(localStorage, "dvr.setup.v1", resourceState.unreadable)) throw Error("backup failed");
      localStorage.setItem("dvr.setup.v1", JSON.stringify(resources));
    }
    catch { setResourceState(s => ({ ...s, error: "Machine setup could not be saved in this browser. Export the setup plan to keep it." })); }
  }, [resources]);
  useEffect(() => {
    const changed = (e) => {
      if (e.storageArea !== localStorage || e.key !== "dvr.setup.v1" || e.newValue === null) return;
      try { const setup = parseSetup(e.newValue); adoptedSetup.current = setup; setResourceState(s => ({ ...s, setup, error: "" })); }
      catch { /* Keep this tab's valid setup; the other tab reports its own problem. */ }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
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
    if (!mayLeave("Zones")) return;
    setSelected(id);
    setTab("Zones");
  }
  // Every way into Zones (navigation, links, Back/Forward) edits the saved rule for the selected plan.
  useEffect(() => {
    if (tab !== "Zones") return;
    setDraft(ruleFor(rules, selected));
    setError("");
  }, [tab, selected]);
  function review(e) {
    setNote(e.note || "");
    setModal({ type: "review", event: e });
  }
  function decide(status) {
    setEvents((es) => reviewEvent(es, modal.event.id, status, note));
    setModal(null);
    setToast(
      `${status === "confirmed" ? "Observation confirmed" : "Event dismissed"}. Review updated.`,
    );
  }
  function saveRule(e) {
    e.preventDefault();
    const problem = validateRule(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setRules((rs) => rs.map((r) => (r.camera === draft.camera ? draft : r)));
    setError("");
    setToast("Review rule updated.");
  }
  async function importReceipt(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw Error("Review file exceeds the 8 MiB limit.");
      const value = JSON.parse(await file.text());
      const added = value?.schema === "intelligent-dvr.review-export.v1" ? parseReviewExport(value) : parseReceipt(value);
      addObservations(added);
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
      (eventMode === "all" || e.mode === eventMode) &&
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
        <span className="pilot-label">{tab === "Recognition" ? "Recording recognition" : tab === "Facility" ? "Guided facility builder" : "Local camera workspace"}</span>
        <button className="workspace-select" onClick={() => setTab("Settings")} aria-label="Open workspace settings">
          Local workspace
          <GearSix size={14} />
        </button>
        <div className="header-right">
          <span className="header-date">
            Local <span>· human review</span>
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
          [Eye, "Recognition"],
          [Buildings, "Facility"],
          [ListBullets, "Events"],
          [Selection, "Zones"],
          [Cpu, "System"],
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
        {(eventsStorageError || rulesStorageError) && <div className="workspace-storage-warning" role="alert">
          <WarningCircle size={22} /><div><strong>Browser save needs attention</strong>
          {eventsStorageError && <p>Reviews: {eventsStorageError}</p>}
          {rulesStorageError && <p>Rules: {rulesStorageError}</p>}</div>
          <button className="button" onClick={exportReviews}>Export reviews</button>
          <button className="button" onClick={() => download({schema:"intelligent-dvr.rules.v1", rules}, "dvr-rules.json")}>Export rules</button>
          {eventsRecovery?.raw != null && <button className="button" onClick={() => downloadText(eventsRecovery.raw, "dvr-unreadable-reviews.json")}>Download unreadable reviews</button>}
          {rulesRecovery?.raw != null && <button className="button" onClick={() => downloadText(rulesRecovery.raw, "dvr-unreadable-rules.json")}>Download unreadable rules</button>}
          {(eventsRecovery || rulesRecovery) && <button className="text-button" onClick={() => { eventsRecovery?.dismiss(); rulesRecovery?.dismiss(); }}>Dismiss</button>}
        </div>}
        {recognitionOpened && <div hidden={tab !== "Recognition"}><WorkspaceBoundary name="Recognition"><Suspense fallback={<div className="content-page"><h1>Opening recognition review…</h1></div>}>
          <RecognitionReview active={tab === "Recognition" && !pageHidden} onImport={addObservations} clip={capturedClip} onClip={setCapturedClip} reviews={events} evidence={evidence} />
        </Suspense></WorkspaceBoundary></div>}
        {tab === "Facility" && <WorkspaceBoundary name="Facility"><Suspense fallback={<div className="content-page"><h1>Opening facility builder…</h1></div>}><FacilityBuilder onPreviewCount={setLiveCount} onDirtyChange={(dirty) => { facilityDirty.current = dirty; }} /></Suspense></WorkspaceBoundary>}
        {tab === "System" && <WorkspaceBoundary name="System"><Suspense fallback={<div className="content-page"><h1>Opening machine setup…</h1></div>}><SystemSetup setup={resources}
          onApply={setup => setResourceState(s => ({ ...s, setup, error: "" }))} storageError={resourceState.error} download={download} /></Suspense></WorkspaceBoundary>}
        {tab === "Monitor" && <WorkspaceBoundary name="Monitor"><LiveMonitor visibleTiles={resources.browser.visibleTiles} onCount={setLiveCount} pageHidden={pageHidden} clip={capturedClip} onClip={setCapturedClip} capturePending={capturePending} onCaptureBusy={setCapturePending} onReviewClip={() => setTab('Recognition')} queue={
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
                  {pending.length > 3 && (
                    <button className="text-button queue-more" onClick={() => { setFilter("pending"); setEventMode("all"); setQuery(""); setTab("Events"); }}>
                      View all {pending.length} awaiting review
                      <CaretRight size={13} />
                    </button>
                  )}
                  {!pending.length && (
                    <div className="empty-state">
                      <Check size={32} />
                      <h3>No observations yet</h3>
                      <p>Analyze a recording in Recognition to produce observations for review.</p>
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
        } /></WorkspaceBoundary>}
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
              <div className="review-actions">
                <button className="button" onClick={exportReviews}><DownloadSimple />Export reviews</button>
                <button className="button" disabled={!events.length} onClick={() => setModal({type:"clear-reviews"})}>Clear queue</button>
              </div>
            </div>
            <div className="review-summary" aria-label="Review queue summary">
              <span><strong>{pending.length}</strong> awaiting review</span>
              <span>{events.filter(e => e.mode === "offline-model").length} model observations</span>
              <span>{events.filter(e => e.mode === "sample").length} samples</span>
              <span>{events.length} / 1,000 records</span>
            </div>
            {clearedEvents && <div className="review-recovery" role="status"><span>Queue cleared. {clearedEvents.length} previous records can be restored until this page closes.</span><button className="button" onClick={undoClear}>Undo clear</button></div>}
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
              <select aria-label="Observation source" value={eventMode} onChange={e => setEventMode(e.target.value)}>
                <option value="all">All sources</option><option value="offline-model">Model observations</option><option value="sample">Samples</option>
              </select>
              <button className="button" onClick={() => importRef.current.click()}><UploadSimple />Import receipt or reviews</button>
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
                        {cameraOf(e)?.name || e.cameraName} · {e.time}{recordingTag(e)}
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
                  <h3>{events.length ? "No matching events" : "Your review queue is empty"}</h3>
                  <p>{events.length ? "Change the filters to see other observations." : "Open recognition results or restore a review export to start."}</p>
                  {events.length ? <button className="button" onClick={() => { setFilter("all"); setEventMode("all"); setQuery(""); }}>Clear filters</button> : <button className="button" onClick={() => setTab("Recognition")}>Open Recognition</button>}
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
                  Saved rule plans are retained here. They are not attached to connected feeds; live analysis is not running.
                </p>
              </div>
              <select
                aria-label="Camera for zone"
                value={selected}
                onChange={(e) => zone(+e.target.value)}
              >
                {cameras.map((c) => (
                  <option value={c.id} key={c.id}>
                    Plan {c.id} · {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="zone-layout">
              <div>
                <div className="zone-editor">
                  <div className="zone-planning-grid" />
                  <Overlay
                    rule={draft}
                    edit
                    pixelScale={resources.browser.overlayScale}
                    onRect={(rect) => setDraft((r) => ({ ...r, rect }))}
                  />
                  <span className="sample-badge">RULE PLAN · NO CAMERA IMAGE</span>
                </div>
                <p className="hint">
                  <Info size={16} />
                  Define normalized coordinates on this planning grid, or use the keyboard controls below.
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
                <p className="eyebrow">LOCAL WORKSPACE</p>
                <h1>Connections and local evidence</h1>
                <p>
                  Connect your cameras explicitly and analyze recordings on this computer.
                </p>
              </div>
              <span className="mode-tag">Local operation</span>
            </div>
            <div className="settings-grid">
              <section>
                <Camera size={28} />
                <h2>Camera connections</h2><button className="button" onClick={() => setTab("Monitor")}>Open camera connections</button>
                <p>
                  Connect built-in or USB webcams and configured local DVR RTSP channels from Monitor. No camera starts automatically. ONVIF discovery is not included.
                </p>
                <div className="setting-row">
                  <span>Connected cameras</span>
                  <strong>{liveCount} receiving</strong>
                </div>
                <div className="setting-row">
                  <span>Live detection on previews</span>
                  <strong>Off · recordings only</strong>
                </div>
                <div className="setting-row">
                  <span>Detection model</span>
                  <button className="text-button" onClick={() => setTab("Recognition")}>Chosen per analysis in Recognition</button>
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
                  Preview a local video, or open Recognition to launch bounded local analysis with your configured model and rules. Video stays on this computer.
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
                  previews remain in memory. No cloud inference or automatic enforcement is running. Camera previews stop when you leave Monitor or hide the page.
                </p>
                <button
                  className="text-button"
                  onClick={() => setModal({ type: "reset" })}
                >
                  <ArrowCounterClockwise />
                  Remove pending legacy samples
                </button>
              </section>
              <section>
                <SlidersHorizontal size={28} />
                <h2>From pilot to real operation</h2>
                <button className="button" onClick={() => setTab("System")}><Cpu />Plan this machine</button>
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
        <strong>{liveCount ? `${liveCount} receiving` : 'No camera preview active'}</strong>
        <span className="footer-divider" />
        <span>Record a webcam clip explicitly, then analyze it in Recognition. Live previews do not run AI.</span>
        <span className="footer-end">Edge-first. Human-reviewed.</span>
      </footer>
      <input
        hidden
        ref={importRef}
        aria-label="Import receipt or review export"
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
      {modal?.type === "review" && (
        <Modal title="Review observation" wide close={() => setModal(null)}>
          <div className="review-dialog-layout">
            <div>
              <div className="missing-evidence">
                <Camera size={44} />
                <h3>{modal.event.mode === 'sample' ? 'Legacy sample observation' : 'Original footage stays local'}</h3>
                <p>{modal.event.mode === 'sample' ? 'This retained sample has no real camera evidence. Your previous decision and notes are preserved.' : `Open the source recording at ${modal.event.time} in Recognition to verify this observation.`}</p>
                {modal.event.provenance?.source_sha256 && <button className="button" onClick={() => {
                  const e = modal.event;
                  setEvidence({ sourceId: e.sourceId, sha: e.provenance.source_sha256, model: e.provenance.model_sha256, time: e.time, nonce: Date.now() });
                  setModal(null); setTab("Recognition");
                }}>Open in Recognition<CaretRight size={15} /></button>}
              </div>
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
        <Modal title="Local video preview" wide close={() => { setModal(null); setVideo(null); }}>
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
            Connect a webcam or a configured local DVR channel in Monitor. The wall starts empty and shows only frames received from your selected sources.
          </p>
          <p>
            “Out of place” means an explicitly configured object, zone, and
            duration rule. It is not a judgment about a person’s intent.
          </p>
          <p>
            Recognition can analyze a selected local recording with a configured model and rules. Monitor can explicitly capture a short webcam clip. Live previews do not run AI or track people.
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
      {modal?.type === "clear-reviews" && (
        <Modal title="Clear the review queue?" close={() => setModal(null)}>
          <p>Export your {events.length} reviews first to keep decisions and notes. Clearing leaves an empty queue ready for a full analysis run. Video files and rules stay on this computer.</p>
          <p className="hint">Undo is available until this page closes. Exported reviews can be imported again.</p>
          {clearedEvents && <p className="hint">Clearing again replaces the previous undo copy. <button className="text-button" onClick={() => download(reviewExport(clearedEvents), "dvr-previous-reviews.json")}>Export previous cleared reviews</button></p>}
          <div className="review-actions">
            <button className="button" onClick={exportReviews}><DownloadSimple />Export all reviews</button>
            <button className="button amber" onClick={() => {
              setClearedEvents(eventsRef.current);
              eventsRef.current = []; setEvents([]); setModal(null); setToast("Queue cleared. Undo is available in Event history.");
            }}>Clear queue now</button>
            <button className="button" onClick={() => setModal(null)}>Keep reviews</button>
          </div>
        </Modal>
      )}
      {modal?.type === "reset" && (
        <Modal title="Remove pending legacy samples?" close={() => setModal(null)}>
          <p>
            This removes unreviewed legacy sample events. Imported observations, reviewed samples, saved rules and review notes are kept. No new sample events will be created.
          </p>
          <button
            className="button amber"
            onClick={() => {
              try {
                const reset = eventsRef.current.filter(e => e.mode !== 'sample' || e.status !== 'pending');
                eventsRef.current = reset;
                setEvents(reset);
              } catch (err) { setToast(err.message); return; }
              setModal(null);
              setTab("Monitor");
              setSelected(1);
              setToast("Pending legacy samples removed.");
            }}
          >
            Remove pending samples
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

