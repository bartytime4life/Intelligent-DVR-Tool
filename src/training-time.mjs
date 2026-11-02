// The recorder's active wall clock stops while paused. Compare it to the decoded
// presentation span before scoring prompts. A 0.5 s tolerance is below the 2 s
// settling period and accommodates browser start/stop scheduling and a final frame.
export const MAX_TRAINING_CLOCK_DRIFT_SECONDS = 0.5;

function estimated(reason) {
  return { verified: false, method: 'estimated', reason };
}

export function trainingTiming(trace, recordedSeconds) {
  const coverage = trace?.media_coverage;
  if (!Number.isFinite(recordedSeconds) || recordedSeconds <= 0)
    return estimated('The recording has no usable active duration.');
  if (trace?.origin !== 'offline-analyzer' || trace.source_timing !== 'pyav-relative-pts-v1' || !coverage)
    return estimated('This analysis lacks decoded presentation timestamps.');
  const count = trace.frames_read;
  if (coverage.termination !== 'source-end' || !['inventory-matched', 'unverified'].includes(coverage.status) ||
      !Number.isSafeInteger(count) || count <= 0 || coverage.analysis_frames !== count ||
      coverage.validated_frames !== count || !/^[a-f0-9]{64}$/.test(trace.source_sha256) ||
      coverage.source_sha256 !== trace.source_sha256)
    return estimated('The decoder could not align the complete recording with its analyzed frames.');
  const extent = coverage.decoded_duration_seconds;
  if (!Number.isFinite(extent) || extent <= 0 || Math.abs(extent - recordedSeconds) > MAX_TRAINING_CLOCK_DRIFT_SECONDS)
    return estimated('The decoded video duration and the active recording timer could not be aligned within half a second.');
  const samples = trace.frames;
  if (!Number.isSafeInteger(trace.stride) || trace.stride < 1 || !Array.isArray(samples) ||
      samples.length !== Math.ceil(count / trace.stride) || samples[0]?.source_seconds !== 0)
    return estimated('The recording has missing sampled timestamps.');
  let previous = -1;
  for (const [i, frame] of samples.entries()) {
    const time = frame?.source_seconds;
    if (frame?.frame_index !== i * trace.stride || !Number.isFinite(time) || time <= previous || time >= extent)
      return estimated('The sampled timestamps are incomplete or out of order.');
    previous = time;
  }
  return { verified: true, method: 'source-pts', reason: 'Sampled moments follow decoded video timestamps matched to the active recording timer.' };
}

export function timedTrainingFrames(trace, recordedSeconds) {
  const timing = trainingTiming(trace, recordedSeconds);
  const positional = Number.isFinite(recordedSeconds) && recordedSeconds > 0 && Number.isSafeInteger(trace?.frames_read) && trace.frames_read > 0;
  const samples = Array.isArray(trace?.frames) ? trace.frames : [];
  const frames = samples.map(frame => {
    const estimatedSeconds = positional && Number.isSafeInteger(frame.frame_index)
      ? frame.frame_index / trace.frames_read * recordedSeconds : frame.seconds;
    return { ...frame, seconds: timing.verified ? frame.source_seconds : estimatedSeconds };
  });
  return { timing, frames };
}
