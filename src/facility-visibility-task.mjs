import {VISIBILITY_TIMEOUT_MS, VISIBILITY_TASK_SCHEMA, acceptVisibilitySnapshot} from './facility-visibility-protocol.mjs';
export {VISIBILITY_TIMEOUT_MS, VISIBILITY_TASK_SCHEMA};
let sequence=0;

// Exactly one disposable worker per revision. Closing the response gate first
// also rejects callbacks that were queued before cancellation/termination.
export function startVisibilityTask({plan, onResult, onError,
  createWorker=()=>new Worker(new URL('./facility-visibility-worker.mjs',import.meta.url),{type:'module'}),
  timeoutMs=VISIBILITY_TIMEOUT_MS, setTimer=setTimeout, clearTimer=clearTimeout,
  now=()=>performance.now()}) {
  const id=++sequence, startedAt=now();
  let active=true, worker, timer;
  const stop=()=>{
    if (!active) return false;
    active=false;
    if (timer !== undefined) clearTimer(timer);
    try { worker?.terminate(); } catch { /* Already closed. */ }
    return true;
  };
  const fail=message=>{if(stop())onError(message);};
  const failed='Camera visibility could not be calculated. Try again or simplify the plan.';
  const timeout='Camera visibility took too long. Try again or simplify the plan.';
  const expired=()=>now()-startedAt >= timeoutMs;
  try {
    worker=createWorker();
    worker.onmessage=({data})=>{
      if (!active || data?.id !== id) return;
      if (expired()) {fail(timeout);return;}
      if (data.schema !== VISIBILITY_TASK_SCHEMA || data.type !== 'result' ||
          !acceptVisibilitySnapshot(data.snapshot,plan,()=>active && !expired())) {
        fail(expired() ? timeout : failed);return;
      }
      if (stop()) onResult(data.snapshot);
    };
    worker.onerror=event=>{event.preventDefault?.();fail(failed);};
    worker.onmessageerror=()=>fail('Camera visibility could not be read. Try again.');
    timer=setTimer(()=>fail(timeout),timeoutMs);
    worker.postMessage({schema:VISIBILITY_TASK_SCHEMA,id,plan});
  } catch { fail('Background camera visibility is unavailable. Try again in this browser.'); }
  return stop;
}
