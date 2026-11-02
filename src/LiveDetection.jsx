import React from 'react';
import { Brain, PaperPlaneTilt, X } from '@phosphor-icons/react';
import { LIVE_DISPLAY_SCORE, liveBoxLabel, liveCounts, boxesFresh } from './live-ai.mjs';

// Boxes are drawn in the analyzed frame's own pixel space; "meet" matches the tile's object-fit: contain.
export function LiveOverlay({ ai, now }) {
  const result = ai?.result;
  if (!result || !boxesFresh(ai, now)) return null;
  const { width, height } = result, shown = result.detections.filter(d => d.score >= LIVE_DISPLAY_SCORE).slice(0, 50);
  const size = Math.max(11, height * 0.032), stroke = Math.max(2, height * 0.004);
  return <svg className="live-ai-overlay" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-label="Live AI detections on the analyzed frame" role="img">
    {shown.map((d, i) => {
      const [x, y, w, h] = [d.box[0] * width, d.box[1] * height, d.box[2] * width, d.box[3] * height];
      const text = liveBoxLabel(d), tracked = Number.isInteger(d.track);
      return <g key={i} className={tracked ? 'tracked' : 'untracked'}>
        <rect x={x} y={y} width={w} height={h} strokeWidth={stroke} />
        <rect className="live-ai-tag" x={x} y={Math.max(0, y - size * 1.35)} width={text.length * size * 0.58 + size * 0.6} height={size * 1.35} />
        <text x={x + size * 0.3} y={Math.max(size * 1.02, y - size * 0.33)} fontSize={size}>{text}</text>
      </g>;
    })}
  </svg>;
}

export function LiveTileAI({ ai, available, onStart, onStop, onSend, onDismiss, now }) {
  const active = ['starting', 'live'].includes(ai?.state);
  const counts = liveCounts(ai?.result?.detections);
  const session = ai?.session, stale = ai?.state === 'live' && ai.result && !boxesFresh(ai, now);
  const idle = ai?.result?.detector === 'skipped-still';
  return <div className="live-ai" onClick={e => e.stopPropagation()}>
    <div className="live-ai-row">
      <button className={`button live-ai-toggle ${active ? 'active' : ''}`} disabled={!available && !active} aria-pressed={active}
        onClick={() => active ? onStop() : onStart()} title={available ? '' : 'Live AI needs the local app on this computer'}>
        <Brain aria-hidden="true" />{ai?.state === 'starting' ? 'Starting AI…' : active ? 'Stop AI' : 'Start AI'}</button>
      {ai?.state === 'live' && <span className="live-ai-status" role="status">
        {counts.length ? counts.map(([label, n]) => <span key={label} className="live-ai-count">{n} {label}</span>) : <span>{idle ? 'Still scene · detector resting' : 'Nothing detected'}</span>}
        <small>{stale ? 'AI delayed · boxes hidden' : `${ai.fps ? ai.fps.toFixed(1) : '–'} fps · ${ai.result?.timing?.inference_ms ?? ai.result?.timing?.total_ms ?? '–'} ms on this computer`}</small>
      </span>}
      {ai?.state === 'failed' && <span className="live-ai-error" role="alert">{ai.error}</span>}
      {ai?.state === 'stopped' && ai.error && <span className="live-ai-note">{ai.error}</span>}
    </div>
    {ai?.state === 'live' && session && <p className="live-ai-meta">
      {session.model} · {session.rules} · {session.analyzed} analyzed{session.skipped_still ? ` · ${session.skipped_still} still frames skipped` : ''}{ai.skippedBusy ? ` · ${ai.skippedBusy} dropped while busy` : ''}
      {Object.keys(session.tracks_by_label || {}).length > 0 && <> · tracks so far: {Object.entries(session.tracks_by_label).map(([l, n]) => `${n} ${l}`).join(', ')}</>}
    </p>}
    {ai?.observations?.length > 0 && <ul className="live-ai-observations" aria-label="Live AI observations">
      {ai.observations.map((o, i) => <li key={o.observation.id}>
        <span><strong>{o.observation.label}</strong> · {o.observation.rule}<small>{new Date(o.capturedAt).toLocaleTimeString()} · score {o.observation.score.toFixed(2)}</small></span>
        {o.sent ? <span className="live-ai-sent">In Events</span> : <button className="text-button" onClick={() => onSend(i)}><PaperPlaneTilt aria-hidden="true" />Send to Events</button>}
        <button className="icon-button" aria-label="Dismiss this live observation" onClick={() => onDismiss(i)}><X /></button>
      </li>)}
    </ul>}
  </div>;
}
