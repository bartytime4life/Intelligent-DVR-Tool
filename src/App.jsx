import React, { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import WorkspaceConflict from './WorkspaceConflict.jsx';
import TaskFinder from './TaskFinder.jsx';
const FacilityBuilder = lazy(() => import("./FacilityBuilder.jsx").then(m => ({default:m.FacilityBuilder})));
const SystemSetup = lazy(() => import("./SystemSetup.jsx"));
const LiveMonitor = lazy(() => import("./LiveMonitor.jsx"));
const RecognitionReview = lazy(() => import("./RecognitionReview.jsx"));
const TrainingWorkspace = lazy(() => import("./TrainingWorkspace.jsx"));
import { mergeRecognitionEvents } from './recognition.mjs';
import { workspaceFromHash, reviewExport, parseReviewExport, pauseHiddenPlayback } from './workspace-state.mjs';
import { createWorkspaceSave } from './workspace-save.mjs';
import { backdropDismiss } from './dialog-dismiss.mjs';
import { getImage, putImage, deleteImage, pruneImages, imageFileFrame, observationImageKey } from './local-images.mjs';
import { ANALYZER_CLASSES, DEFAULT_MAX_GAP, analyzerRules, analyzerFilename } from './zone-rules.mjs';
import { filterEvents, queueChoices, nextPending, queueCSV, dismissPending, restorePending } from './review-queue.mjs';
import { DEFAULT_SETUP } from "./resources.mjs";
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
  Target,
} from "@phosphor-icons/react";
import {
  cameras,
  initialRules,
  validateRule,
  parseReceipt,
  reviewEvent,
  saveReviewNote,
  reviewEvidenceIdentity,
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
function downloadText(text, name, type = "text/plain") {
  const u = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
const browserStorage = () => ({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) });
function useStored(key, initial, options) {
  const [session] = useState(() => createWorkspaceSave(browserStorage(), key, initial, options));
  const [saved, setSaved] = useState(() => session.snapshot());
  const [recoveryOpen, setRecoveryOpen] = useState(Boolean(session.loaded.error));
  useEffect(() => session.subscribe(() => setSaved(session.snapshot())), [session]);
  useEffect(() => {
    void session.flush();
  }, [session, saved.editVersion]);
  useEffect(() => {
    const changed = e => {
      if (e.storageArea !== localStorage || (e.key !== key && e.key !== null)) return;
      session.receive();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key, session]);
  const recovery = recoveryOpen ? { message: session.loaded.error, raw: session.loaded.raw, dismiss: () => setRecoveryOpen(false) } : null;
  return [saved.value, session.update, saved.error || saved.conflict?.message || recovery?.message || "", recovery, saved.conflict, saved.hasUnsavedChanges];
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
  const previousFocus = useRef(document.activeElement);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current;
    element.showModal();
    return () => {
      element.close();
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
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
// With a camera still, rules map to the full frame exactly (normalized like edge/rules.py);
// without one, the planning grid keeps its virtual 3:2 image.
function project(w, h, aspect) {
  if (aspect) {
    const iw = Math.min(w, h * aspect), ih = iw / aspect;
    return { iw, ih, ox: (w - iw) / 2, oy: (h - ih) / 2 };
  }
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
  aspect = 0,
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
      const { iw, ih, ox, oy } = project(w, h, aspect);
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
  }, [rule, edit, pixelScale, aspect]);
  function point(e) {
    const r = e.currentTarget.getBoundingClientRect(),
      { iw, ih, ox, oy } = project(r.width, r.height, aspect);
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
// Bumped when observations arrive so stills saved just before them are read again.
const StillVersion = React.createContext(0);
function Still({ event, large = false, fallback = null }) {
  const id = observationImageKey(event);
  const version = React.useContext(StillVersion);
  const [url, setUrl] = useState("");
  useEffect(() => {
    let live = true, made = "";
    setUrl("");
    getImage("thumbnails", id).then((blob) => { if (live && blob) { made = URL.createObjectURL(blob); setUrl(made); } });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id, version]);
  return url ? <img className={`event-still${large ? " large" : ""}`} src={url} alt={event.mode === 'live-model' ? 'Analyzed live frame for this observation' : 'Still from the source-matched recording at this observation'} /> : fallback;
}
function EventRow({ event, review, zone }) {
  const c = cameraOf(event);
  return (
    <article className="event-card">
      <div className="event-preview">
        <Still event={event} fallback={<Camera size={35} />} />
        <span className="sample-badge">
          {event.mode === "sample" ? "SAMPLE" : event.mode === "live-model" ? "LIVE" : "OFFLINE"}
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
    [events, setEvents, eventsStorageError, eventsRecovery, eventsConflict, eventsUnsaved] = useStored("dvr.events.v1", []),
    [rules, setRules, rulesStorageError, rulesRecovery, rulesConflict, rulesUnsaved] = useStored("dvr.rules.v1", initialRules),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [draft, setDraft] = useState(() => ruleFor(rules, 1)),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [video, setVideo] = useState(null);
  const [noteDrafts, setNoteDrafts] = useState(() => new Map());
  const [liveCount, setLiveCount] = useState(0);
  const [capturedClip, setCapturedClip] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [sourceFilter, setSourceFilter] = useState("all"), [recordingFilter, setRecordingFilter] = useState("all"), [sort, setSort] = useState("newest");
  const [bulkUndo, setBulkUndo] = useState(null), [stillVersion, setStillVersion] = useState(0), [recorderStatus, setRecorderStatus] = useState(null);
  // A captured camera still waits for an explicit "Use for Plan N"; the saved still is per plan.
  const [stillOffer, setStillOffer] = useState(null), [zoneStill, setZoneStill] = useState(null), [zoneStillVersion, setZoneStillVersion] = useState(0);
  const [capturePending, setCapturePending] = useState(false);
  useEffect(() => {
    if (!capturedClip && !capturePending) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [capturedClip, capturePending]);
  const [recognitionOpened, setRecognitionOpened] = useState(tab === "Recognition");
  const [taskFinderOpen, setTaskFinderOpen] = useState(false);
  const [recognitionTask, setRecognitionTask] = useState(null);
  const [navigationVersion, setNavigationVersion] = useState(0);
  const workspaceElement = useRef(), focusWorkspace = useRef(false);
  const [routeAnnouncement, setRouteAnnouncement] = useState('');
  useEffect(() => {
    document.title = `${tab} · Intelligent DVR`;
    if (navigationVersion) setRouteAnnouncement(`${tab} workspace opened.`);
    if (!focusWorkspace.current) return;
    focusWorkspace.current = false;
    const frame = requestAnimationFrame(() => {
      workspaceElement.current?.focus({preventScroll:true});
      workspaceElement.current?.scrollTo({top:0});
      window.scrollTo({top:0,left:0});
    });
    return () => cancelAnimationFrame(frame);
  },[tab,navigationVersion]);
  useEffect(() => {
    const shortcut = event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return;
      if (document.querySelector('dialog[open]') && !taskFinderOpen) return;
      event.preventDefault();
      setTaskFinderOpen(true);
    };
    window.addEventListener('keydown',shortcut);
    return () => window.removeEventListener('keydown',shortcut);
  },[taskFinderOpen]);
  const [clearedEvents, setClearedEvents] = useState(null);
  const [eventMode, setEventMode] = useState("all");
  // Read the latest queue after asynchronous file reads and rapid consecutive imports.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  // Leaving Facility unmounts the builder, so unsaved drafts and its undo history would be lost silently.
  const tabRef = useRef(tab), facilityDirty = useRef(false), systemDirty = useRef(false), zoneDirty = useRef(false), trainingDirty = useRef(false);
  const [systemDraftPending, setSystemDraftPending] = useState(false);
  const [resources, setResources, setupStorageError, setupRecovery, setupConflict, setupUnsaved] = useStored('dvr.setup.v1', DEFAULT_SETUP, {canResolve:() => !systemDirty.current});
  const setupSaveError = setupStorageError === setupRecovery?.message ? '' : setupStorageError;
  const reportSystemDirty = useCallback(dirty => { systemDirty.current = dirty; setSystemDraftPending(dirty); }, []);
  const pendingBrowserSave = useRef(false);
  pendingBrowserSave.current = eventsUnsaved || rulesUnsaved || setupUnsaved || noteDrafts.size > 0;
  const reportTrainingDirty = useCallback(dirty => { trainingDirty.current = dirty; }, []);
  tabRef.current = tab;
  // Unsaved zone rules are a draft, not the separately persisted analyzer rules.
  // The history listener was installed on mount; refs ensure it sees fresh values.
  zoneDirty.current = tab === "Zones" && JSON.stringify(draft) !== JSON.stringify(ruleFor(rules, selected));
  const mayLeave = (next) => {
    if (tabRef.current === next) return true;
    const blockers = {
      Facility: [facilityDirty, "Leave the facility builder? Unsaved facility edits, drafts and undo history will be discarded."],
      Zones: [zoneDirty, "Leave Zones? Unsaved rule edits will be discarded. Save the review rule before leaving."],
      Train: [trainingDirty, "Leave Train? Unfinished recordings, checks and unsaved results will be discarded. Session-owned camera capture will stop and analysis cancellation will be requested. A submitted template operation may still finish. Saved settings stay on this computer."],
      System: [systemDirty, "Leave System? Unapplied machine settings will be discarded. Apply the draft before leaving."]
    };
    const blocker = blockers[tabRef.current];
    if (!blocker?.[0].current) return true;
    if (!window.confirm(blocker[1])) return false;
    blocker[0].current = false; // Back and hashchange may both observe one navigation.
    return true;
  };
  useEffect(() => {
    const warn = event => {
      if (tabRef.current === "Facility" && facilityDirty.current ||
          tabRef.current === "Zones" && zoneDirty.current ||
          tabRef.current === "System" && systemDirty.current ||
          tabRef.current === "Train" && trainingDirty.current || pendingBrowserSave.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function setTab(next, {focus = true} = {}) {
    if (!mayLeave(next)) return false;
    if (next === "Recognition") setRecognitionOpened(true);
    focusWorkspace.current = focus;
    tabRef.current = next;
    updateTab(next);
    setNavigationVersion(version => version + 1);
    const hash = `#${next.toLowerCase()}`;
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    return true;
  }
  function openTask(task) {
    if (task.workspace === 'Zones') return zone();
    if (!setTab(task.workspace)) return false;
    if (task.task) setRecognitionTask(previous => ({id:task.task,version:(previous?.version || 0)+1}));
    return true;
  }
  useEffect(() => {
    const changed = () => {
      const next = workspaceFromHash(window.location.hash);
      if (!next) return; // Preserve the skip-to-workspace anchor.
      if (!mayLeave(next)) {
        // Return to whichever editor owns the pending draft, not always Facility.
        window.history.pushState(null, "", `#${tabRef.current.toLowerCase()}`);
        return;
      }
      if (next === "Recognition") setRecognitionOpened(true);
      if (next === tabRef.current) return; // popstate and hashchange can describe one transition.
      tabRef.current = next;
      focusWorkspace.current = true;
      updateTab(next);
      setNavigationVersion(version => version + 1);
    };
    window.addEventListener("popstate", changed);
    window.addEventListener("hashchange", changed);
    return () => { window.removeEventListener("popstate", changed); window.removeEventListener("hashchange", changed); };
  }, []);
  function addObservations(added, openEvents = true, validateOnly = false) {
    try {
      const merged = mergeRecognitionEvents(eventsRef.current, added);
      if (validateOnly) return true;
      const newCount = merged.length - eventsRef.current.length;
      eventsRef.current = merged;
      setEvents(merged);
      setStillVersion((v) => v + 1);
      if (openEvents) { clearFilters(); setTab("Events"); }
      setToast(`${newCount} new observations added. Existing decisions kept. Footage stays local.`);
      return true;
    } catch (err) { setToast(err.message); return false; }
  }
  async function addLiveObservation(event, still) {
    try { mergeRecognitionEvents(eventsRef.current, [event]); }
    catch (err) { setToast(err.message); return false; }
    // The still is a live observation's only image evidence: never queue it without one.
    if (!still || !(await putImage("thumbnails", observationImageKey(event), still))) {
      setToast("This browser could not save the observation’s still, so it was not sent. Free browser storage or leave private browsing, then send it again.");
      return false;
    }
    // On refusal (a full queue), the unreferenced still is pruned with the queue's stills.
    return addObservations([event], false);
  }
  function exportReviews() { download(reviewExport(eventsRef.current), "dvr-reviews.json"); }
  function undoClear() {
    if (clearedEvents && addObservations(clearedEvents)) setClearedEvents(null);
  }
  const [pageHidden, setPageHidden] = useState(document.hidden);
  useEffect(() => pauseHiddenPlayback(document), []);
  useEffect(() => {
    const changed = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
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
    // Switching the plan inside Zones also discards the current edit draft.
    if (tabRef.current === "Zones" && id !== selected && zoneDirty.current) {
      if (!window.confirm("Switch zone plans? Unsaved rule edits for this plan will be discarded.")) return false;
      zoneDirty.current = false;
    }
    if (!mayLeave("Zones")) return false;
    setSelected(id);
    return setTab("Zones");
  }
  useEffect(() => {
    if (tab !== "Zones") return;
    let live = true, made = "";
    getImage("zone-stills", `plan-${selected}`).then((blob) => {
      if (!live) return;
      if (!blob) { setZoneStill(null); return; }
      made = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => { if (live) setZoneStill({ url: made, width: image.naturalWidth, height: image.naturalHeight }); };
      image.onerror = () => { if (live) setZoneStill(null); };
      image.src = made;
    });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [tab, selected, zoneStillVersion]);
  useEffect(() => () => { if (stillOffer?.url) URL.revokeObjectURL(stillOffer.url); }, [stillOffer]);
  function offerZoneStill(frame, source) {
    setStillOffer({ ...frame, source, url: URL.createObjectURL(frame.blob) });
    setTab("Zones");
  }
  async function useOfferedStill() {
    if (!(await putImage("zone-stills", `plan-${selected}`, stillOffer.blob))) { setToast("This browser could not store the still. Zones still work on the planning grid."); return; }
    setStillOffer(null); setZoneStillVersion((v) => v + 1);
    setToast(`Still saved for Plan ${selected}. Draw the zone on the image; rectangles use full-frame coordinates.`);
  }
  async function removeZoneStill() {
    await deleteImage("zone-stills", `plan-${selected}`);
    setZoneStillVersion((v) => v + 1);
  }
  async function chooseStillFile(e) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    try { offerZoneStill(await imageFileFrame(file), file.name); } catch (err) { setToast(err.message); }
  }
  function exportAnalyzerRules() {
    try { const value = analyzerRules(draft); download(value, analyzerFilename(draft)); setError(""); setToast("Analyzer rules downloaded. List the file in the local app's analysis configuration to use it."); }
    catch (err) { setError(err.message); }
  }
  // Every way into Zones (navigation, links, Back/Forward) edits the saved rule for the selected plan.
  useEffect(() => {
    if (tab !== "Zones") return;
    setDraft(ruleFor(rules, selected));
    setError("");
  }, [tab, selected]);
  function review(e) {
    setNote(noteDrafts.get(reviewEvidenceIdentity(e))?.note ?? e.note ?? "");
    setModal({ type: "review", event: e });
  }
  const currentReview = modal?.type === "review" ? events.find(event => event.id === modal.event.id) : null;
  const reviewIsCurrent = currentReview && reviewEvidenceIdentity(currentReview) === reviewEvidenceIdentity(modal?.event);
  const reviewChanged = reviewIsCurrent && ['note', 'status', 'reviewedAt', 'reviewRevision'].some(key => currentReview[key] !== modal.event[key]);
  const noteDraft = modal?.type === "review" ? noteDrafts.get(reviewEvidenceIdentity(modal.event)) : null;
  function editNote(value) {
    setNote(value);
    const event = modal.event, key = reviewEvidenceIdentity(event);
    setNoteDrafts(drafts => {
      const next = new Map(drafts);
      if (value === (event.note ?? '')) next.delete(key);
      else next.set(key, { event, note: value, savedNote: drafts.get(key)?.savedNote ?? event.note });
      return next;
    });
  }
  function removeNoteDraft(event) {
    setNoteDrafts(drafts => { const next = new Map(drafts); next.delete(reviewEvidenceIdentity(event)); return next; });
  }
  function discardNoteDraft() {
    const event = reviewIsCurrent ? currentReview : modal.event;
    removeNoteDraft(modal.event);
    setNote(event.note || "");
    if (reviewIsCurrent) setModal({ type: "review", event });
  }
  function saveNote() {
    try {
      const updated = saveReviewNote(eventsRef.current, modal.event.id, note, modal.event);
      eventsRef.current = updated; setEvents(updated);
      removeNoteDraft(modal.event);
      setModal({ type: "review", event: updated.find(event => event.id === modal.event.id) });
      setToast("Note added to this tab’s reviews without changing its decision. Browser save status appears above the workspace.");
    } catch (problem) { setToast(problem.message); }
  }
  // Review moves through pending items in the order the user is looking at.
  const reviewList = () => (tab === "Events" ? visible : pending);
  function decide(status) {
    if (!reviewIsCurrent || reviewChanged) { setToast("This observation changed. Your note draft is kept. Review the saved version before deciding."); return; }
    const current = modal.event, next = nextPending(reviewList(), current.id);
    setEvents((es) => reviewEvent(es, current.id, status, note));
    removeNoteDraft(current);
    if (next) review(next); else setModal(null);
    setToast(`${status === "confirmed" ? "Observation confirmed" : "Event dismissed"}.${next ? " Showing the next one awaiting review." : " Nothing else here awaits review."}`);
  }
  function step(direction) {
    const next = nextPending(reviewList(), modal.event.id, direction);
    if (next) review(next);
  }
  useEffect(() => {
    if (modal?.type !== "review") return;
    const key = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("textarea, input, select")) return;
      const action = { c: () => decide("confirmed"), d: () => decide("dismissed"), j: () => step(1), k: () => step(-1), ArrowRight: () => step(1), ArrowLeft: () => step(-1) }[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (action) { e.preventDefault(); action(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  function clearFilters() { setFilter("all"); setEventMode("all"); setSourceFilter("all"); setRecordingFilter("all"); setSort("newest"); setQuery(""); }
  function dismissShown() {
    const result = dismissPending(eventsRef.current, visible.filter((e) => e.status === "pending").map((e) => e.id), "Dismissed in bulk from Events.");
    eventsRef.current = result.events; setEvents(result.events); setBulkUndo(result); setModal(null);
    setToast(`${result.previous.length} observations dismissed. Undo is available in Events.`);
  }
  function undoBulk() {
    const restored = restorePending(eventsRef.current, bulkUndo);
    eventsRef.current = restored; setEvents(restored); setBulkUndo(null);
    setToast("Bulk dismissal undone. Later decisions were kept.");
  }
  // Stills follow the queue: removed with their observations, kept while Undo can restore them.
  useEffect(() => {
    const timer = setTimeout(() => { pruneImages("thumbnails", new Set([...events, ...(clearedEvents || [])].flatMap(e => [e.id, observationImageKey(e)]))); }, 2000);
    return () => clearTimeout(timer);
  }, [events, clearedEvents]);
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
  const visible = filterEvents(events, { status: filter, mode: eventMode, source: sourceFilter, recording: recordingFilter, query, sort, label: (e) => cameraOf(e)?.name || e.cameraName });
  const choices = queueChoices(events), shownPending = visible.filter((e) => e.status === "pending").length;
  return (
    <StillVersion.Provider value={stillVersion}>
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
        <span className="pilot-label">{tab === "Recognition" ? "Recording recognition" : tab === "Train" ? "Guided training" : tab === "Facility" ? "Guided facility builder" : "Local camera workspace"}</span>
        <button className="workspace-select" onClick={() => setTab("Settings")} aria-label="Open workspace settings">
          Local workspace
          <GearSix size={14} />
        </button>
        <div className="header-right">
          <button className="task-trigger" aria-label="Find a task" aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" onClick={() => setTaskFinderOpen(true)}>
            <MagnifyingGlass size={18} aria-hidden="true" /><span className="task-trigger-label">Find a task</span><kbd aria-hidden="true">⌘ / Ctrl K</kbd>
          </button>
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
          [Target, "Train"],
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
      <span className="sr-only" role="status" aria-live="polite">{routeAnnouncement}</span>
      {taskFinderOpen && <TaskFinder onChoose={openTask} onClose={() => setTaskFinderOpen(false)} />}
      <main ref={workspaceElement} id="workspace" tabIndex={-1} aria-label={`${tab} workspace`} className={`workspace tab-${tab.toLowerCase()}`}>
        {noteDrafts.size > 0 && <div className="workspace-storage-warning" role="status"><Info size={22} /><div><strong>{noteDrafts.size} unsaved review note {noteDrafts.size === 1 ? 'draft' : 'drafts'}</strong><p>Kept in this tab while you inspect sources. Save or download them before closing this page.</p></div><button className="button" onClick={() => setModal({type:'note-drafts'})}>Review note drafts</button></div>}
        {((eventsStorageError && !eventsConflict) || (rulesStorageError && !rulesConflict) || (setupStorageError && !setupConflict) || eventsRecovery || rulesRecovery || setupRecovery) && <div className="workspace-storage-warning" role="alert">
          <WarningCircle size={22} /><div><strong>Browser save needs attention</strong>
          {eventsStorageError && !eventsConflict && <p>Reviews: {eventsStorageError}</p>}
          {rulesStorageError && !rulesConflict && <p>Rules: {rulesStorageError}</p>}
          {setupStorageError && !setupConflict && <p>Machine plan: {setupStorageError}</p>}</div>
          {eventsConflict && eventsRecovery && <p>The original unreadable reviews are also preserved. Download them before dismissing this recovery notice.</p>}
          {rulesConflict && rulesRecovery && <p>The original unreadable rules are also preserved. Download them before dismissing this recovery notice.</p>}
          {setupConflict && setupRecovery && <p>The original unreadable machine plan is also preserved. Download it before dismissing this recovery notice.</p>}
          <button className="button" onClick={exportReviews}>Export reviews</button>
          <button className="button" onClick={() => download({schema:"intelligent-dvr.rules.v1", rules}, "dvr-rules.json")}>Export rules</button>
          <button className="button" onClick={() => download(resources, 'dvr-machine-setup.json')}>Export machine plan</button>
          {eventsRecovery?.raw != null && <button className="button" onClick={() => downloadText(eventsRecovery.raw, "dvr-unreadable-reviews.json")}>Download unreadable reviews</button>}
          {rulesRecovery?.raw != null && <button className="button" onClick={() => downloadText(rulesRecovery.raw, "dvr-unreadable-rules.json")}>Download unreadable rules</button>}
          {setupRecovery?.raw != null && <button className="button" onClick={() => downloadText(setupRecovery.raw, 'dvr-unreadable-machine-setup.json')}>Download unreadable machine plan</button>}
          {(eventsRecovery || rulesRecovery || setupRecovery) && <button className="text-button" onClick={() => { eventsRecovery?.dismiss(); rulesRecovery?.dismiss(); setupRecovery?.dismiss(); }}>Dismiss</button>}
        </div>}
        {eventsConflict && <WorkspaceConflict kind="reviews" localCount={events.length} conflict={eventsConflict}
          exportLocal={exportReviews}
          exportRemote={() => eventsConflict.remoteValid
            ? download(reviewExport(eventsConflict.remoteValue), 'dvr-reviews-other-tab.json')
            : downloadText(eventsConflict.remoteRaw ?? 'null', 'dvr-unreadable-reviews-other-tab.json')} />}
        {rulesConflict && <WorkspaceConflict kind="rules" localCount={rules.length} conflict={rulesConflict}
          exportLocal={() => download({schema:'intelligent-dvr.rules.v1', rules}, 'dvr-rules.json')}
          exportRemote={() => rulesConflict.remoteValid
            ? download({schema:'intelligent-dvr.rules.v1', rules:rulesConflict.remoteValue}, 'dvr-rules-other-tab.json')
            : downloadText(rulesConflict.remoteRaw ?? 'null', 'dvr-unreadable-rules-other-tab.json')} />}
        {setupConflict && <div className="system-save-recovery">
          {systemDraftPending && <p role="status">Apply or discard your machine-plan draft before choosing a saved version. Downloads contain the applied plans.</p>}
          <WorkspaceConflict kind="setup" localCount={1} conflict={setupConflict} disabled={systemDraftPending}
            exportLocal={() => download(resources, 'dvr-machine-setup-this-tab.json')}
            exportRemote={() => setupConflict.remoteValid
              ? download(setupConflict.remoteValue, 'dvr-machine-setup-other-tab.json')
              : downloadText(setupConflict.remoteRaw ?? 'null', 'dvr-unreadable-machine-setup-other-tab.json')} />
        </div>}
        {recognitionOpened && <div hidden={tab !== "Recognition"}><WorkspaceBoundary name="Recognition"><Suspense fallback={<div className="content-page"><h1>Opening recognition review…</h1></div>}>
          <RecognitionReview taskRequest={recognitionTask} active={tab === "Recognition" && !pageHidden} onImport={addObservations} onValidateImport={added => addObservations(added, false, true)} clip={capturedClip} onClip={setCapturedClip} reviews={events} evidence={evidence} onClearEvidence={() => setEvidence(null)} onRecorderStatus={setRecorderStatus} onZoneStill={offerZoneStill} />
        </Suspense></WorkspaceBoundary></div>}
        {tab === "Train" && <WorkspaceBoundary name="Train"><Suspense fallback={<div className="content-page"><h1>Opening training…</h1></div>}><TrainingWorkspace onOpenRecognition={() => setTab("Recognition")} onDirtyChange={reportTrainingDirty} /></Suspense></WorkspaceBoundary>}
        {tab === "Facility" && <WorkspaceBoundary name="Facility"><Suspense fallback={<div className="content-page"><h1>Opening facility builder…</h1></div>}><FacilityBuilder onPreviewCount={setLiveCount} onDirtyChange={(dirty) => { facilityDirty.current = dirty; }} /></Suspense></WorkspaceBoundary>}
        {tab === "System" && <WorkspaceBoundary name="System"><Suspense fallback={<div className="content-page"><h1>Opening machine setup…</h1></div>}><SystemSetup setup={resources}
          onApply={setResources} onDirtyChange={reportSystemDirty}
          storageError={setupSaveError} storagePending={setupUnsaved && !setupSaveError && !setupConflict} storageConflict={Boolean(setupConflict)} download={download} /></Suspense></WorkspaceBoundary>}
        {tab === "Monitor" && <WorkspaceBoundary name="Monitor"><Suspense fallback={<div className="content-page"><h1>Opening Monitor…</h1></div>}><LiveMonitor onZoneStill={offerZoneStill} visibleTiles={resources.browser.visibleTiles} onCount={setLiveCount} pageHidden={pageHidden} clip={capturedClip} onClip={setCapturedClip} capturePending={capturePending} onCaptureBusy={setCapturePending} onReviewClip={() => setTab('Recognition')} onLiveObservation={addLiveObservation} queue={
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
                      <p>Analyze a recording in Recognition, or send a live AI observation from a camera tile.</p>
                      <button className="button primary queue-start" onClick={() => openTask({workspace:'Recognition',task:'recording'})}>Analyze a recording<CaretRight size={15} /></button>
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
        } /></Suspense></WorkspaceBoundary>}
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
              <span>{events.filter(e => e.mode === "offline-model").length} recording observations</span>
              <span>{events.filter(e => e.mode === "live-model").length} live observations</span>
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
                <option value="all">All kinds</option><option value="offline-model">Recording observations</option><option value="live-model">Live observations</option><option value="sample">Samples</option>
              </select>
              <select aria-label="Camera or source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                <option value="all">All cameras</option>
                {choices.sources.map((s) => <option key={s.value} value={s.value}>{s.value} ({s.count})</option>)}
              </select>
              <select aria-label="Recording" value={recordingFilter} onChange={(e) => setRecordingFilter(e.target.value)}>
                <option value="all">All recordings</option>
                {choices.recordings.map((r) => <option key={r.value} value={r.value}>rec {r.value.slice(0, 8)} ({r.count})</option>)}
              </select>
              <select aria-label="Sort events" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">Newest added</option><option value="score">Highest score</option><option value="clip">Clip time</option>
              </select>
              <button className="button" onClick={() => importRef.current.click()}><UploadSimple />Import receipt or reviews</button>
            </div>
            <div className="event-bulk-actions">
              <span>{visible.length} shown · {shownPending} awaiting review</span>
              <button className="text-button" disabled={!visible.length} onClick={() => downloadText(queueCSV(visible), "dvr-events.csv", "text/csv")}><DownloadSimple size={15} />Export shown as CSV</button>
              <button className="text-button" disabled={!shownPending} onClick={() => setModal({ type: "bulk-dismiss" })}><X size={15} />Dismiss {shownPending} shown awaiting review</button>
              <span className="hint">Shortcuts while reviewing: C confirm · D dismiss · J/K or ←/→ next and previous.</span>
            </div>
            {bulkUndo && <div className="review-recovery" role="status"><span>{bulkUndo.previous.length} observations were dismissed in bulk.</span><button className="button" onClick={undoBulk}>Undo bulk dismissal</button></div>}
            <div className="event-table">
              {visible.length ? (
                visible.map((e) => (
                  <button
                    className="event-table-row"
                    key={e.id}
                    onClick={() => review(e)}
                  >
                    <span className="table-icon">
                      <Still event={e} fallback={e.label === "person" ? <User size={24} /> : <Cube size={24} />} />
                    </span>
                    <span className="event-row-title">
                      {e.title}
                      <small>
                        {cameraOf(e)?.name || e.cameraName} · {e.time}{recordingTag(e)}
                      </small>
                    </span>
                    <span className="mode-tag">
                      {e.mode === "sample" ? "Sample" : e.mode === "live-model" ? "Live AI" : "Offline model"}
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
                  {events.length ? <button className="button" onClick={clearFilters}>Clear filters</button> : <button className="button" onClick={() => setTab("Recognition")}>Open Recognition</button>}
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
                  Draw each rule on a still from its camera, then export it for the local analyzer. Rules are not attached to live feeds; live analysis is not running.
                </p>
              </div>
              <select
                aria-label="Camera for zone"
                value={selected}
                onChange={(e) => zone(+e.target.value)}
              >
                {cameras.map((c) => (
                  <option value={c.id} key={c.id}>
                    Plan {c.id} · {ruleFor(rules, c.id).planName || c.name}
                  </option>
                ))}
              </select>
            </div>
            {stillOffer && (
              <div className="zone-still-offer" role="status">
                <img src={stillOffer.url} alt={`Captured still from ${stillOffer.source}`} />
                <div><strong>New camera still</strong><span>{stillOffer.source} · {stillOffer.width}×{stillOffer.height} · stays in this browser</span></div>
                <button className="button amber" onClick={useOfferedStill}>Use for Plan {selected}</button>
                <button className="text-button" onClick={() => setStillOffer(null)}>Discard</button>
              </div>
            )}
            <div className="zone-layout">
              <div>
                <div className="zone-editor" style={zoneStill ? { aspectRatio: `${zoneStill.width} / ${zoneStill.height}` } : undefined}>
                  {zoneStill ? <img className="zone-still" src={zoneStill.url} alt={`Camera still for Plan ${selected}`} /> : <div className="zone-planning-grid" />}
                  <Overlay
                    rule={draft}
                    edit
                    pixelScale={resources.browser.overlayScale}
                    aspect={zoneStill ? zoneStill.width / zoneStill.height : 0}
                    onRect={(rect) => setDraft((r) => ({ ...r, rect }))}
                  />
                  <span className="sample-badge">{zoneStill ? `CAMERA STILL · ${zoneStill.width}×${zoneStill.height}` : "RULE PLAN · NO CAMERA IMAGE"}</span>
                </div>
                <div className="zone-still-actions">
                  <label className="text-button">Choose image file<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a camera still image" onChange={chooseStillFile} /></label>
                  {zoneStill && <button className="text-button" onClick={removeZoneStill}>Remove still</button>}
                  <span className="hint">Or use <strong>Use for zones</strong> on a Monitor preview or a Recognition frame.</span>
                </div>
                <p className="hint">
                  <Info size={16} />
                  {zoneStill ? "Rectangles use full-frame coordinates of this still, the same convention the analyzer uses. Keyboard controls are below." : "Define normalized coordinates on this planning grid, or use the keyboard controls below."}
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
                  Camera name for this plan
                  <input
                    maxLength="40"
                    placeholder={cameras.find((c) => c.id === draft.camera)?.name}
                    value={draft.planName || ""}
                    onChange={(e) => setDraft((r) => ({ ...r, planName: e.target.value || undefined }))}
                  />
                </label>
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
                    {!ANALYZER_CLASSES.includes(draft.label) && <option value={draft.label}>{draft.label} (legacy; choose a model class to export)</option>}
                    {ANALYZER_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
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
                <label>
                  Allowed gap between sightings (seconds)
                  <input
                    type="number"
                    min="0.1"
                    max="60"
                    step="0.1"
                    value={draft.maxGap ?? DEFAULT_MAX_GAP}
                    onChange={(e) => setDraft((r) => ({ ...r, maxGap: +e.target.value }))}
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
                  A score is a model output, not a probability of danger. Classes are the bundled COCO model's labels; other models need matching labels. A longer gap lets brief missed detections continue one dwell run.
                </p>
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                {zoneDirty.current && <p className="hint" role="status">Unsaved review rule changes. Save before changing screens or camera plans.</p>}
                <button className="button amber" type="submit">
                  Save review rule
                  <Check />
                </button>
                <button className="button" type="button" onClick={exportAnalyzerRules}>
                  <DownloadSimple />
                  Export analyzer rules
                </button>
                <p className="hint">Exports the rule as shown as a file the local analyzer accepts. Add the file to the analysis configuration on this computer to use it.</p>
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
                  Back up browser rules (not an analyzer file)
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
                  <strong>Start AI on each connected Monitor tile</strong>
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
        {(recorderStatus?.active || recorderStatus?.unknown) && <><span className="footer-divider" /><strong className="footer-recording" role="status">{recorderStatus.unknown ? 'Recording status unknown' : 'LAN recording active'}{recorderStatus.name ? ` · ${recorderStatus.name}` : ''}{recorderStatus.unknown && ' · reconnect in Recognition'}</strong></>}
        <span className="footer-divider" />
        <span>Record a clip for Recognition, or choose Start AI on a connected Monitor tile.</span>
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
                <Still event={modal.event} large fallback={<Camera size={44} />} />
                <h3>{modal.event.mode === 'sample' ? 'Legacy sample observation' : modal.event.mode === 'live-model' ? 'Live AI observation · still only' : 'Original footage stays local'}</h3>
                <p>{modal.event.mode === 'sample' ? 'This retained sample has no real camera evidence. Your previous decision and notes are preserved.'
                  : modal.event.mode === 'live-model' ? 'Live AI saw this on the camera preview. Only the analyzed still above is kept in this browser; no recording exists. Check the scene or your recorder before confirming.'
                  : `Open the source recording at ${modal.event.time} in Recognition to verify this observation.`}</p>
                {modal.event.provenance?.source_sha256 && <button className="button" onClick={() => {
                  const e = modal.event;
                  if (!setTab("Recognition", {focus:false})) return;
                  setEvidence({ sourceId: e.sourceId, sha: e.provenance.source_sha256, model: e.provenance.model_sha256, time: e.time, camera: e.cameraName || cameraOf(e)?.name || '', nonce: Date.now() });
                  setModal(null);
                }}>Open in Recognition<CaretRight size={15} /></button>}
              </div>
              <p className="hint">
                {modal.event.time} ·{" "}
                {cameraOf(modal.event)?.name || modal.event.cameraName}
              </p>
            </div>
            <div className="review-details">
              {(() => {
                const queue = reviewList().filter((e) => e.status === "pending"), at = queue.findIndex((e) => e.id === modal.event.id);
                return <div className="review-stepper">
                  <button className="text-button" disabled={queue.length < (at < 0 ? 1 : 2)} onClick={() => step(-1)}>← Previous</button>
                  <span>{at < 0 ? `${queue.length} awaiting review` : `${at + 1} of ${queue.length} awaiting review`}</span>
                  <button className="text-button" disabled={queue.length < (at < 0 ? 1 : 2)} onClick={() => step(1)}>Next →</button>
                </div>;
              })()}
              <h3>{modal.event.title}</h3>
              <dl>
                <dt>Configured rule</dt>
                <dd>{modal.event.rule}</dd>
                <dt>Model score</dt>
                <dd>
                  {modal.event.score.toFixed(2)}{" "}
                  <small>· not a risk probability</small>
                </dd>
                {modal.event.mode === "live-model" && modal.event.provenance && (
                  <>
                    <dt>Live session</dt>
                    <dd>{new Date(modal.event.provenance.captured_at).toLocaleString()} · unverified metadata</dd>
                    <dt>Model SHA-256</dt>
                    <dd className="hash">{modal.event.provenance.model_sha256}</dd>
                  </>
                )}
                {modal.event.mode === "offline-model" && modal.event.provenance && (
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
                  aria-label="Review note"
                  readOnly={!reviewIsCurrent}
                  maxLength="2000"
                  placeholder="What did you observe?"
                  value={note}
                  onChange={(e) => editNote(e.target.value)}
                />
              </label>
              {noteDraft && <p className="hint" role="status">Unsaved note draft kept while you move between observations or workspaces. Save it before closing this page.</p>}
              {noteDraft && noteDraft.savedNote !== modal.event.note && <div className="notice"><div><strong>The saved note changed.</strong><p>{modal.event.note || 'The saved note is empty.'}</p><p>Your earlier draft is kept in the field above. Save note replaces this saved note.</p></div></div>}
              {!reviewIsCurrent && <p className="notice" role="alert">This observation is no longer in the queue with the same evidence. Your draft is kept. Close this review and choose a current observation.</p>}
              {reviewChanged && <div className="notice" role="alert"><span>This saved observation changed while you were reviewing it. Your draft is kept.</span><button className="button" onClick={() => review(currentReview)}>Review saved version</button></div>}
              <div className="review-actions">
                <button className="button" disabled={!noteDraft || !reviewIsCurrent || reviewChanged} onClick={saveNote}>Save note</button>
                {noteDraft && <button className="text-button" onClick={discardNoteDraft}>Discard note draft</button>}
              </div>
              <button
                className="button amber"
                disabled={!reviewIsCurrent || reviewChanged}
                onClick={() => decide("confirmed")}
              >
                <Check />
                Confirm observation
              </button>
              <button className="button" disabled={!reviewIsCurrent || reviewChanged} onClick={() => decide("dismissed")}>
                <X />
                Dismiss event
              </button>
              <p className="hint">
                Confirming records your review and opens the next one awaiting review. It does not establish intent or
                trigger external actions. Keys: C confirm · D dismiss · J/K move.
              </p>
            </div>
          </div>
        </Modal>
      )}
      {modal?.type === "note-drafts" && (
        <Modal title="Unsaved review note drafts" close={() => setModal(null)}>
          <p>These drafts stay in this tab until you save or discard them. A draft for removed or changed evidence stays read-only.</p>
          {noteDrafts.size ? <>
            <button className="button" onClick={() => download({schema:'intelligent-dvr.review-note-drafts.v1', drafts:[...noteDrafts.values()]}, 'dvr-review-note-drafts.json')}><DownloadSimple />Download note drafts</button>
            {[...noteDrafts].map(([key, draft]) => <section className="notice" key={key}><div><strong>{draft.event.cameraName || cameraOf(draft.event)?.name || 'Observation'} · {draft.event.time}</strong><p>{draft.note || 'Draft clears the saved note.'}</p><div className="review-actions">
              <button className="button" onClick={() => review(events.find(event => reviewEvidenceIdentity(event) === key) || draft.event)}>Resume note draft</button>
              <button className="text-button" onClick={() => removeNoteDraft(draft.event)}>Discard note draft</button>
            </div></div></section>)}
          </> : <p role="status">No unsaved note drafts remain.</p>}
        </Modal>
      )}
      {modal?.type === "bulk-dismiss" && (
        <Modal title={`Dismiss ${shownPending} observations?`} close={() => setModal(null)}>
          <p>This dismisses the {shownPending} shown observations that await review, using your current filters. Confirmed and dismissed items are unchanged.</p>
          <p className="hint">Undo is available in Events until this page closes. Later decisions are kept when you undo.</p>
          <div className="review-actions">
            <button className="button amber" onClick={dismissShown}>Dismiss {shownPending}</button>
            <button className="button" onClick={() => setModal(null)}>Keep them</button>
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
            Recognition analyzes selected local recordings. In Monitor, choose Start AI on a connected tile for live detections and short-lived tracks, or record a short webcam clip for later review.
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
    </StillVersion.Provider>
  );
}
