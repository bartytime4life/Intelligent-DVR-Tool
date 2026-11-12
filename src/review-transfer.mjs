// All result sources share this intent, including file reads that may fail.
// Claim before asynchronous work: an older valid result must not undo a newer
// request just because the newer file was rejected or its download is slower.
export function createReviewOpening({available = () => true} = {}) {
  let current = null;
  return {
    begin() {
      if (!available()) return null;
      current = {};
      return current;
    },
    isCurrent(intent) { return intent !== null && current === intent && available(); },
    invalidate() { current = null; },
  };
}

// One bounded review transfer per panel. Cancellation releases its controls at
// once, even if a decoder or storage operation takes longer to settle.
export function createReviewTransfer({timeout = 120000} = {}) {
  let current = null;
  return {
    begin(parentSignal, onAbort) {
      if (current || parentSignal?.aborted) return null;
      const controller = new AbortController();
      const signal = AbortSignal.any([parentSignal, controller.signal, AbortSignal.timeout(timeout)].filter(Boolean));
      const operation = {signal, controller};
      const aborted = () => {
        if (current !== operation) return;
        current = null;
        onAbort?.(signal.reason);
      };
      operation.cleanup = () => signal.removeEventListener('abort', aborted);
      current = operation;
      signal.addEventListener('abort', aborted, {once:true});
      return operation;
    },
    isCurrent(operation) { return current === operation && !operation.signal.aborted; },
    finish(operation) {
      operation.cleanup();
      if (current !== operation) return false;
      current = null;
      return true;
    },
    cancel() { current?.controller.abort(new DOMException('Review transfer cancelled', 'AbortError')); },
  };
}
