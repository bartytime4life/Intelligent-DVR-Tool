// The recorder owns the media. This clock owns which prompt was visible and
// admits a clip only when that recorder stopped at the end of the exercise.
import { createClipRecorder } from './clip-capture.mjs';

const COUNTDOWN_MS = 3000;
export function createTrainingTake({ stream, seconds, onChange, onComplete, onError,
  now = () => performance.now(), createRecorder = createClipRecorder }) {
  let phase = 'countdown';
  let started = false;
  let activeMs = 0;
  let runStarted = 0;
  let countdownEnd = now() + COUNTDOWN_MS;
  const track = stream.getVideoTracks().find(item => item.readyState === 'live' && item.enabled);

  function fail(message) {
    if (phase === 'ended') return;
    phase = 'ended';
    recorder.stop('Training interrupted');
    onError(message);
  }

  const recorder = createRecorder({
    onState(state) {
      if (state.state === 'error') fail(state.message);
    },
    onClip(clip) {
      if (phase === 'ended') return;
      // elapsed is measured at the browser recorder. Allow a short scheduling
      // difference between that clock and the UI clock at start/resume.
      if (phase !== 'finishing' || clip.reason !== 'Script complete' ||
          !Number.isFinite(clip.elapsed) || clip.elapsed < seconds - 0.25 || !clip.blob?.size) {
        fail('The recording ended before all prompts were captured. Check the camera and record again.');
        return;
      }
      phase = 'ended';
      onComplete({ ...clip, cameraKey: track?.getSettings?.()?.deviceId || null });
    },
  });

  function elapsed(time) {
    return activeMs + (phase === 'running' ? time - runStarted : 0);
  }

  function update(visible) {
    if (phase === 'ended' || phase === 'finishing' || (phase === 'paused' && !visible)) return;
    const time = now();
    if (!track || track.readyState !== 'live' || track.muted || !track.enabled) {
      fail('Camera frames stopped during the exercise. Reconnect the camera and record again.');
      return;
    }
    try {
      if (!visible) {
        if (phase === 'running') {
          activeMs = elapsed(time);
          if (!recorder.pause()) throw Error('The browser could not pause the recording safely. Record again.');
        }
        phase = 'paused';
      } else if (phase === 'paused') {
        // Every return to the page needs a fresh countdown, including hiding a
        // second time while already counting down to resume.
        phase = started ? 'resuming' : 'countdown';
        countdownEnd = time + COUNTDOWN_MS;
      } else if ((phase === 'countdown' || phase === 'resuming') && time >= countdownEnd) {
        if (started) {
          if (!recorder.resume()) throw Error('The browser could not resume the recording. Record again.');
        } else {
          recorder.start(stream);
          started = true;
        }
        runStarted = time;
        phase = 'running';
      }
      const duration = elapsed(time);
      if (phase === 'running' && duration >= seconds * 1000) {
        phase = 'finishing';
        onChange({ phase, elapsed: seconds, countdown: 0 });
        recorder.stop('Script complete');
        return;
      }
      onChange({ phase, elapsed: duration / 1000, countdown: Math.max(0, Math.ceil((countdownEnd - time) / 1000)) });
    } catch (error) {
      fail(error.message);
    }
  }

  function cancel() {
    if (phase === 'ended') return;
    phase = 'ended';
    recorder.stop('Left training');
  }
  return { update, cancel };
}

// Start only from the user's sound-control gesture. Generated tones connect to
// the speakers. The recorder still receives just the camera's video track.
export function createPromptChime(Audio) {
  const context = new Audio();
  let pending = null, closed = false;

  function silence() {
    pending?.();
  }

  function ring(finished = false) {
    silence();
    if (closed || context.state !== 'running') return Promise.resolve();
    return new Promise(resolve => {
      let oscillator, gain, timeout;
      function done() {
        if (pending !== done) return;
        pending = null;
        clearTimeout(timeout);
        if (oscillator) {
          oscillator.onended = null;
          try { oscillator.stop(); } catch { /* already stopped */ }
          oscillator.disconnect();
        }
        gain?.disconnect();
        resolve();
      }
      pending = done;
      try {
        oscillator = context.createOscillator();
        gain = context.createGain();
        oscillator.connect(gain);
        gain.connect(context.destination);
        const start = context.currentTime;
        oscillator.frequency.value = finished ? 785 : 660;
        gain.gain.setValueAtTime(0, start);
        for (const offset of finished ? [0, .15] : [0]) {
          gain.gain.setValueAtTime(0, start + offset);
          gain.gain.linearRampToValueAtTime(.09, start + offset + .018);
          gain.gain.linearRampToValueAtTime(0, start + offset + .11);
        }
        oscillator.onended = done;
        oscillator.start(start);
        oscillator.stop(start + (finished ? .27 : .12));
        // A suspended output device may never fire ended. It must not hold up
        // the completed video or the review workflow.
        timeout = setTimeout(done, 400);
      } catch { done(); }
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    silence();
    context.close().catch(() => {});
  }
  return { enable: () => context.resume(), ring, silence, close };
}
