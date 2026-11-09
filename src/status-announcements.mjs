// Keep live announcements about transitions. Frequently polled counters remain
// ordinary readable text so they do not interrupt the operator every second.
export function analysisAnnouncement(job, connected = true) {
  if (!job) return '';
  if (!connected) return 'Analysis status is unavailable. Reconnect to check the retained job.';
  if (job.state === 'completed') return job.result_state === 'partial'
    ? 'Analysis finished with a partial result. Check its coverage before review.'
    : 'Analysis finished. Open the result for human review.';
  if (job.state === 'cancelled') return 'Analysis cancelled. Your existing review is preserved.';
  if (job.state === 'failed') return 'Analysis stopped. Review the error before retrying.';
  return {
    preparing: 'Preparing the selected recording for local analysis.',
    validating: 'Checking the recording before analysis.',
    analyzing: 'Analyzing the selected recording on this computer.',
    verifying: 'Verifying the recording and analysis results.',
    cancelling: 'Cancelling analysis. Wait for the confirmed result.',
  }[job.phase] || 'Analysis is in progress on this computer.';
}

export function recorderAnnouncement(status, connected = true) {
  if (!status) return '';
  if (!connected) return 'Recording status is unknown. Recording may still be running; reconnect to check.';
  return {
    starting: 'Starting the configured LAN recorder.',
    recording: 'LAN recording is active.',
    reconnecting: 'The LAN recorder is reconnecting. Gaps are possible.',
    stopping: 'Stopping LAN recording. Wait for confirmed stopped status.',
    stopped: 'LAN recording is stopped.',
    disk_pressure: 'LAN recording needs storage attention. Review the storage warning.',
    failed: 'The LAN recorder stopped unexpectedly. Review the error.',
  }[status.state] || (status.active ? 'The LAN recorder is active. Review its status.' : 'The LAN recorder is paused.');
}

export function backupAnnouncement(status, connected = true) {
  if (!status) return '';
  if (!connected) return 'Backup status is unknown. Background copying may continue; reconnect to check.';
  if (status.error) return 'Backup needs attention. Review the warning; saved copies are preserved.';
  if (status.state === 'stopping') return 'Stopping backup. Saved copies are preserved.';
  if (status.analyzing) return 'Backup is running with local analysis.';
  if (status.active) return 'Backup is running. Finished videos will be copied.';
  return status.configured ? 'Backup is paused.' : 'Backup folders have not been configured.';
}
