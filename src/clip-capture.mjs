export const CLIP_BYTES = 64 * 1024 ** 2;
export const CLIP_SECONDS = 60;

export function createClipRecorder({ Recorder = globalThis.MediaRecorder, Stream = globalThis.MediaStream,
  onState, onClip, now = () => performance.now(), later = setTimeout, cancel = clearTimeout }) {
  let recorder, timer, parts = [], bytes = 0, began = 0, reason = '', failure = '', track;
  const ended = () => stop('Camera disconnected');
  function stop(message = 'Stopped by operator') {
    if (!recorder || recorder.state === 'inactive') return;
    reason = message; cancel(timer); timer = null;
    onState({ state: 'stopping', message: 'Finishing the clip…' });
    recorder.stop();
  }
  function start(stream) {
    if (recorder) return;
    if (!Recorder || !Stream) throw Error('This browser cannot record clips. Import an existing video in Recognition.');
    track = stream?.getVideoTracks().find(t => t.readyState === 'live' && t.enabled);
    if (!track) throw Error('Connect a webcam before recording a clip.');
    const mimeType = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => Recorder.isTypeSupported(t));
    if (!mimeType) throw Error('No supported recording codec is available in this browser.');
    // Only the existing video track is passed; no microphone access or audio.
    recorder = new Recorder(new Stream([track]), { mimeType, videoBitsPerSecond: 2_000_000 });
    parts = []; bytes = 0; failure = ''; reason = 'Camera stream ended'; began = now();
    recorder.ondataavailable = ({ data }) => {
      if (!data.size || failure) return;
      if (bytes + data.size > CLIP_BYTES) {
        failure = 'Clip exceeded 64 MiB and was discarded. Record a shorter clip.';
        parts = []; stop('Size limit'); return;
      }
      parts.push(data); bytes += data.size;
    };
    recorder.onerror = () => { failure = 'The browser could not finish this clip. Try a shorter recording.'; stop('Recorder error'); };
    recorder.onstop = () => {
      cancel(timer); track.removeEventListener('ended', ended);
      const mime = recorder.mimeType.split(';')[0];
      const elapsed = (now() - began) / 1000;
      recorder = null;
      if (!failure && bytes) {
        const blob = new Blob(parts, { type: mime });
        const created = new Date().toISOString();
        onClip({ blob, name: `webcam-${created.replace(/[:.]/g, '-')}.${mime === 'video/mp4' ? 'mp4' : 'webm'}`,
          created, elapsed, reason });
        onState({ state: 'ready', message: `${reason}. Clip ready to save or analyze.` });
      } else onState({ state: 'error', message: failure || 'No video data was recorded. Try again.' });
      parts = [];
    };
    track.addEventListener('ended', ended);
    try { recorder.start(1000); }
    catch (error) { track.removeEventListener('ended', ended); recorder = null; throw error; }
    // Browser timers may be delayed. This is a requested stop time, not a
    // certified media duration; retained bytes have a separate hard bound.
    timer = later(() => stop('60-second stop requested'), CLIP_SECONDS * 1000);
    onState({ state: 'recording', message: 'Recording webcam video · microphone off' });
  }
  return { start, stop };
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
