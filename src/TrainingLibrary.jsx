import React from 'react';
import { Trash } from '@phosphor-icons/react';
import './training-library.css';

export default function TrainingLibrary({ library, onRemove, busy }) {
  const groups = [...new Set(library.sessions.map(s => s.view))];
  return <section className="training-library training-panel" aria-label="Combined training evidence">
    <p className="eyebrow">BUILD ON PAST SESSIONS</p><h2>Every confirmed session can contribute</h2>
    <p>Repeat training for the same camera view to build a stronger set of examples. Suggestions use confirmed recordings together, then need a fresh check before you use them.</p>
    <strong>{library.sessions.length} of 50 sessions saved · {groups.length} camera {groups.length === 1 ? 'view' : 'views'}</strong>
    <p className="training-note">Saved in this browser. More examples help test a setting; they do not guarantee better detection. Detector weights stay unchanged.</p>
    {library.error && <p role="alert">{library.error}</p>}
    {!!library.sessions.length && <details><summary>Manage saved evidence</summary><ul>
      {[...library.sessions].reverse().map(s => <li key={s.calibration.sourceHash}>
        <div><strong>{s.view}</strong><span>{new Date(s.at).toLocaleString()} · {s.calibration.present.length + s.calibration.absent.length} calibration samples{s.check ? ' · fresh check saved' : ''}</span></div>
        <button className="text-button" disabled={busy} onClick={() => onRemove(s.calibration.sourceHash)} aria-label={`Remove evidence from ${s.view}, ${new Date(s.at).toLocaleString()}`}><Trash size={16} /> Remove</button>
      </li>)}
    </ul><p className="training-note">Removing evidence excludes it from future suggestions. Saved rules, recordings and review decisions stay available.</p></details>}
  </section>;
}
