// A coarse network position can be in a different town. Only a site-scale fix may move the pin.
export const SITE_ACCURACY_METERS = 100;
export const LOCATION_WAIT_MS = 20000;
const distance = meters => meters >= 1000 ? `${Number((meters / 1000).toFixed(1))} km` : `${Math.ceil(meters)} m`;

export function requestSiteLocation(geolocation, { progress, found, failed }) {
  let active = true, watchId = null, best = Infinity;
  const timer = setTimeout(() => fail(tooCoarse()), LOCATION_WAIT_MS);
  function stop() {
    active = false;
    clearTimeout(timer);
    if (watchId !== null) geolocation.clearWatch(watchId);
    watchId = null;
  }
  function tooCoarse() {
    return Number.isFinite(best)
      ? `The best reported accuracy was ${distance(best)}. That is too broad to place a facility.`
      : 'Your browser did not return a precise location in time.';
  }
  function fail(message) {
    if (!active) return;
    stop();
    failed(message);
  }
  try {
    watchId = geolocation.watchPosition(({coords, timestamp}) => {
      if (!active) return;
      const {longitude, latitude, accuracy} = coords;
      const age = Date.now() - timestamp;
      if (!Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
          !Number.isFinite(latitude) || Math.abs(latitude) > 80) {
        fail('This position is outside the supported map area.');
        return;
      }
      if (!Number.isFinite(accuracy) || accuracy <= 0 || !Number.isFinite(timestamp) || age < 0 || age > LOCATION_WAIT_MS) return;
      if (accuracy <= SITE_ACCURACY_METERS) {
        stop();
        found([+longitude.toFixed(7), +latitude.toFixed(7)], distance(accuracy));
      } else if (accuracy < best) {
        best = accuracy;
        progress(`The browser reports a ${distance(best)} radius. Waiting for a closer reading…`);
      }
    }, error => fail(error.code === 1 ? 'Location permission was declined.' :
      error.code === 3 || Number.isFinite(best) ? tooCoarse() : 'The device could not determine its location.'),
    { enableHighAccuracy: true, maximumAge: 0, timeout: LOCATION_WAIT_MS });
    if (!active) stop();
  } catch {
    fail('The browser could not start its location service.');
  }
  return stop;
}
