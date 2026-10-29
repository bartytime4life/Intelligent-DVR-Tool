import {visibleCameraSlots} from './resources.mjs';
export const localFeedOrigin = location => location?.protocol === 'http:' && location?.hostname === '127.0.0.1';
export function stopStream(stream) { stream?.getTracks().forEach(track => track.stop()); }
export function webcamError(error) {
  return ({NotAllowedError:'Camera access was denied. Allow camera access for this app in your browser, then connect again.',
    NotFoundError:'No webcam was found. Attach a USB camera or enable a built-in camera, then refresh devices.',
    AbortError:'Camera startup was interrupted. Check the device and try connecting again.',
    InvalidStateError:'This page is no longer active. Return to Monitor and connect again.',
    NotSupportedError:'This browser build does not support webcam capture. Open the app in a current full Chrome, Edge or Firefox browser and retry.',
    TypeError:'The browser rejected the camera request. Check browser camera support and retry.',
    NotReadableError:'The camera could not start. Close other apps using it, check its connection, and retry.',
    OverconstrainedError:'This camera is no longer available. Refresh devices and select another camera.',
    SecurityError:'Camera access is disabled. Open this app on HTTPS or localhost and check browser permissions.'})[error?.name] ||
    'Camera access failed. Check the device and browser permissions, then retry.';
}
// A permission prompt may resolve after cancellation. Late streams must be stopped.
export function webcamController(media, onChange) {
  let generation = 0, stream = null;
  const stop = (message = 'Disconnected') => { generation++; stopStream(stream); stream = null; onChange({state:'disconnected', message}); };
  return {
    stop,
    async connect(deviceId = '') {
      stop(); const ticket = generation;
      onChange({state:'connecting', message:'Allow camera access in your browser. You can cancel while permission is pending.'});
      try {
        if (!media?.getUserMedia) throw {name:'SecurityError'};
        const next = await media.getUserMedia({audio:false, video:{...(deviceId ? {deviceId:{exact:deviceId}} : {}),
          width:{ideal:960, max:1920}, height:{ideal:540,max:1080}, frameRate:{ideal:15,max:30}}});
        if (generation !== ticket) { stopStream(next); return; }
        stream = next;
        const track = next.getVideoTracks()[0];
        if (!track || track.readyState === 'ended') throw {name:'NotReadableError'};
        track.addEventListener('ended', () => { if (generation === ticket) stop('Camera disconnected or permission revoked. Connect again when ready.'); });
        track.addEventListener('mute', () => { if (generation === ticket) onChange({state:'interrupted', message:'Camera frames interrupted. Check the device.', stream:next}); });
        track.addEventListener('unmute', () => { if (generation === ticket) onChange({state:'live', message:'Webcam preview · audio off', stream:next}); });
        onChange({state:track.muted ? 'interrupted' : 'live', message:track.muted ? 'Waiting for camera frames…' : 'Webcam preview · audio off', stream:next});
      } catch (error) {
        if (generation === ticket) { stopStream(stream); stream = null; onChange({state:'failed', message:webcamError(error)}); }
      }
    },
  };
}
export async function feedRequest(path, {token='', body, signal} = {}, fetcher=fetch) {
  let response;
  try {
    response = await fetcher(`/api/feeds${path}`, {method:body === undefined ? 'GET' : 'POST',
      headers:{...(token ? {'X-DVR-Token':token} : {}), ...(body === undefined ? {} : {'Content-Type':'application/json'})},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}), cache:'no-store', credentials:'same-origin', signal});
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw Error('Local DVR service is unavailable. Open the configured local app and retry.');
  }
  if (!response.ok) {
    let value; try { value = await response.json(); } catch { /* no native error detail */ }
    throw Error(value?.error?.message || 'Local DVR request failed. Reconnect the service and retry.');
  }
  return response;
}

export function visibleFeedTiles(tiles, selected, limit) {
  if (!tiles.length) return [];
  const ids = tiles.map(t => t.id);
  const current = ids.includes(selected) ? selected : ids[0];
  return visibleCameraSlots(ids, current, limit).map(id => tiles.find(t => t.id === id));
}
