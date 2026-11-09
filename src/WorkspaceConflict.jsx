import React, { useId, useState } from 'react';
import { DownloadSimple, WarningCircle } from '@phosphor-icons/react';
import './workspace-conflict.css';

export default function WorkspaceConflict({ kind, localCount, conflict, exportLocal, exportRemote, disabled=false }) {
  const titleId = useId();
  const [working, setWorking] = useState(false);
  const [unexpected, setUnexpected] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  if (!conflict) return null;
  const title = kind === 'reviews' ? 'Reviews' : kind === 'facilities' ? 'Facilities' : 'Rules';
  const noun = count => kind === 'facilities' ? count===1?'facility':'facilities' : `${kind === 'reviews' ? 'review' : 'rule'}${count === 1 ? '' : 's'}`;
  async function choose(method) {
    if (working || disabled) return;
    setWorking(true); setUnexpected('');
    try { await conflict[method](); }
    catch { setUnexpected('The choice could not be saved. Both versions are still available below; download them before closing.'); }
    finally { setWorking(false); }
  }
  function downloadCopy(copy) {
    setUnexpected(''); setCopyNotice('');
    let url;
    try {
      url = URL.createObjectURL(new Blob([copy.downloadRaw ?? copy.raw], {type:'application/json'}));
      const anchor = document.createElement('a');
      anchor.href=url; anchor.download=`dvr-${kind}-saved-copy-${copy.slot}.json`;
      anchor.click();
      // Enable removal only after a real download action for this exact snapshot.
      if (copy.markDownloaded()) setCopyNotice(`Saved copy ${copy.slot} download started. Check that you kept the file before removing its browser copy.`);
    } catch { setUnexpected('The copy could not be downloaded. Its browser copy is preserved.'); }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  async function removeCopy(copy) {
    if (working || !copy.downloaded) return;
    setWorking(true); setUnexpected(''); setCopyNotice('');
    try {
      if (await copy.remove()) setCopyNotice(`Saved copy ${copy.slot} removed from this browser. Choose a version above to finish saving.`);
    } catch { setUnexpected('The browser copy could not be removed. Downloaded files and the current versions are preserved.'); }
    finally { setWorking(false); }
  }
  return <section className="workspace-conflict" aria-labelledby={titleId}>
    <div className="workspace-conflict-heading" role="alert">
      <WarningCircle size={24} aria-hidden="true" />
      <div><h2 id={titleId}>{title} save conflict</h2><p>Your changes are still in this tab. Saving is paused until you choose a version.</p></div>
    </div>
    <div className="workspace-conflict-versions">
      <div><h3>This tab</h3><p>{localCount} {noun(localCount)} in memory</p><button className="button" onClick={exportLocal}><DownloadSimple size={17} aria-hidden="true" />Download this version</button></div>
      <div><h3>Other tab</h3><p>{conflict.remoteDeleted ? 'The saved version was removed.' : conflict.remoteValid ? `${conflict.remoteValue.length} saved ${noun(conflict.remoteValue.length)}` : 'The saved version cannot be read.'}</p><button className="button" onClick={exportRemote} disabled={conflict.remoteRaw == null && !conflict.remoteValid}><DownloadSimple size={17} aria-hidden="true" />Download other version</button></div>
    </div>
    <p>The version you replace is backed up in this browser first. Downloads give you a separate copy.</p>
    {(conflict.error || unexpected) && <p className="workspace-conflict-error" role="alert">{unexpected || conflict.error}</p>}
    <div className="workspace-conflict-actions">
      <button className="button amber" disabled={working || disabled} onClick={() => choose('keepLocal')}>{working ? 'Saving your choice…' : "Keep this tab’s version"}</button>
      <button className="button" disabled={working || disabled || !conflict.remoteValid} onClick={() => choose('useRemote')}>{conflict.remoteDeleted ? kind === 'reviews' ? 'Use empty review queue' : kind === 'facilities' ? 'Start a blank facility' : 'Use default rules' : "Use other tab’s version"}</button>
    </div>
    <details className="workspace-conflict-copies">
      <summary>Saved conflict copies{conflict.savedCopies?.copies.length ? ` (${conflict.savedCopies.copies.length}/10)` : ''}</summary>
      <p>Download a saved copy, then remove its browser copy to free a slot for your choice. Keep the downloaded file. Copies are never removed automatically.</p>
      {conflict.savedCopies?.error && <p className="workspace-conflict-error" role="alert">{conflict.savedCopies.error}</p>}
      {conflict.savedCopies?.copies.map(copy => <div className="workspace-conflict-copy" key={copy.slot}>
        <div><h3>Saved copy {copy.slot}</h3><p>{copy.savedAt ? new Date(copy.savedAt).toLocaleString() : 'Original saved bytes · date unavailable'}</p></div>
        <div className="workspace-conflict-copy-actions"><button className="button" disabled={working} aria-label={`Download saved copy ${copy.slot}`} onClick={() => downloadCopy(copy)}><DownloadSimple size={17} aria-hidden="true" />Download copy</button>
          <button className="button" disabled={working || !copy.downloaded} aria-label={`Remove saved copy ${copy.slot}`} onClick={() => removeCopy(copy)}>Remove this copy</button></div>
      </div>)}
      {!conflict.savedCopies?.error && !conflict.savedCopies?.copies.length && <p>No saved conflict copies in this browser.</p>}
      {copyNotice && <p role="status">{copyNotice}</p>}
    </details>
  </section>;
}
