import {COVERAGE_TIMEOUT_MS, COVERAGE_TASK_SCHEMA} from './facility-coverage-protocol.mjs';
import {visibilitySnapshotMatches} from './facility-visibility-protocol.mjs';
export {COVERAGE_TIMEOUT_MS, COVERAGE_TASK_SCHEMA};
let sequence = 0;
const areaFields = ['area','coveredArea','overlapArea','uncoveredArea','coverage','overlap'];
function validMetrics(metrics, plan, snapshot) {
  const unknown=snapshot.cameras.some(view=>!view.estimated);
  const zones = (plan.zones || []).filter(zone => zone.enabled);
  if (!Array.isArray(metrics?.zones) || metrics.zones.length !== zones.length ||
      !Number.isInteger(metrics.cameras) || metrics.cameras < 0 ||
      metrics.cameras > (plan.cameras || []).filter(camera => camera.enabled).length) return false;
  for (let i=0; i<zones.length; i++) {
    const zone=metrics.zones[i];
    if (!zone || zone.id !== zones[i].id || typeof zone.estimated !== 'boolean') return false;
    if (zones[i].buildingId !== undefined) {
      if (zone.estimated || zone.estimateReason !== 'indoor') return false;
    } else if (!zone.estimated) {
      if (!['geometry-limit','geometry-error','visibility-unavailable'].includes(zone.estimateReason) || zone.blindSpots !== null ||
          !areaFields.every(field => zone[field] === null)) return false;
      if ((zone.estimateReason === 'visibility-unavailable') !== unknown) return false;
    } else if (zone.method !== 'polygon-area-v1' || !areaFields.every(field => Number.isFinite(zone[field])) ||
        !(zone.area > 0) || zone.coveredArea < 0 || zone.coveredArea > zone.area ||
        zone.overlapArea < 0 || zone.overlapArea > zone.coveredArea ||
        zone.uncoveredArea < 0 || zone.uncoveredArea > zone.area ||
        zone.coverage < 0 || zone.coverage > 1 || zone.overlap < 0 || zone.overlap > zone.coverage ||
        !Array.isArray(zone.blindSpots) || unknown) return false;
  }
  const route=metrics.route;
  const hasRoute=Array.isArray(plan.route) && plan.route.slice(1).some((point,i)=>point[0]!==plan.route[i][0] || point[1]!==plan.route[i][1]);
  if (route === null) return !hasRoute;
  if (!hasRoute) return false;
  if (route?.method !== 'arclength-intervals-v1' || !Number.isFinite(route.length) || !(route.length > 0)) return false;
  const fields=['coveredLength','overlapLength','uncoveredLength','longestBlindStretch','coverage','overlap'];
  if (route.estimated === false) return unknown && route.estimateReason === 'visibility-unavailable' && fields.every(field=>route[field]===null);
  const epsilon=32*Number.EPSILON*route.length;
  return !unknown && route.estimated === true && fields.every(field=>Number.isFinite(route[field])) &&
    route.coveredLength >= 0 && route.coveredLength <= route.length+epsilon && route.overlapLength >= 0 && route.overlapLength <= route.coveredLength+epsilon &&
    route.uncoveredLength >= 0 && route.uncoveredLength <= route.length+epsilon && route.longestBlindStretch >= 0 && route.longestBlindStretch <= route.uncoveredLength+epsilon &&
    route.coverage >= 0 && route.coverage <= 1 && route.overlap >= 0 && route.overlap <= route.coverage;
}

// One bounded worker per calculation. Cancellation closes the response gate
// before termination, including messages already queued by the old worker.
export function startCoverageTask({plan, snapshot, onResult, onError,
  createWorker = () => new Worker(new URL('./facility-coverage-worker.mjs', import.meta.url), {type:'module'}),
  timeoutMs = COVERAGE_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout,
  now = () => performance.now()}) {
  const id = ++sequence;
  const startedAt = now();
  let active = true, worker, timer;
  const stop = () => {
    if (!active) return false;
    active = false;
    if (timer !== undefined) clearTimer(timer);
    try { worker?.terminate(); } catch { /* The response gate is already closed. */ }
    return true;
  };
  const fail = message => { if (stop()) onError(message); };
  try {
    if (!visibilitySnapshotMatches(snapshot,plan)) {
      fail('Camera visibility is not ready for this plan. Wait for it or retry.');
      return stop;
    }
    worker = createWorker();
    worker.onmessage = ({data}) => {
      if (!active || data?.id !== id) return;
      if (now() - startedAt >= timeoutMs) {
        fail('Coverage took too long. Try again or simplify the plan.');
        return;
      }
      if (data.schema !== COVERAGE_TASK_SCHEMA || data.type !== 'result' ||
          !validMetrics(data.metrics, plan, snapshot)) {
        fail('Coverage could not be calculated. Try again or simplify the plan.');
        return;
      }
      if (now() - startedAt >= timeoutMs) {
        fail('Coverage took too long. Try again or simplify the plan.');return;
      }
      if (stop()) onResult(data.metrics);
    };
    worker.onerror = event => {
      event.preventDefault?.();
      fail('Coverage could not be calculated. Try again or simplify the plan.');
    };
    worker.onmessageerror = () => fail('Coverage could not be read. Try again.');
    timer = setTimer(() => fail('Coverage took too long. Try again or simplify the plan.'), timeoutMs);
    worker.postMessage({schema:COVERAGE_TASK_SCHEMA, id, plan, snapshot});
  } catch {
    fail('Background coverage is unavailable. Try again in this browser.');
  }
  return stop;
}
