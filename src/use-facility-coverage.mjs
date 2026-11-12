import {useEffect, useState} from 'react';
import {startCoverageTask} from './facility-coverage-task.mjs';
import {visibilitySnapshotMatches} from './facility-visibility-protocol.mjs';

export function useFacilityCoverage(plan, enabled, snapshot) {
  const [attempt, setAttempt] = useState(0);
  const [reply, setReply] = useState(null);
  const ready=visibilitySnapshotMatches(snapshot,plan);
  useEffect(() => {
    if (!enabled || !ready) return;
    setReply({plan, snapshot, attempt, status:'loading', metrics:null});
    return startCoverageTask({plan, snapshot,
      onResult: metrics => setReply({plan, snapshot, attempt, status:'ready', metrics}),
      onError: error => setReply({plan, snapshot, attempt, status:'error', metrics:null, error}),
    });
  }, [plan, enabled, snapshot, ready, attempt]);
  // Filter during rendering as well as in worker callbacks. A changed draft
  // must never paint a previous plan's numbers while the effect is pending.
  const current = enabled && ready && reply?.plan === plan && reply.snapshot === snapshot && reply.attempt === attempt ? reply :
    {status:enabled ? 'loading' : 'idle', metrics:null};
  return {...current, retry:() => setAttempt(value => value + 1)};
}
