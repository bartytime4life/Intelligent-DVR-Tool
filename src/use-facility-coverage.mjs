import {useEffect, useState} from 'react';
import {startCoverageTask} from './facility-coverage-task.mjs';

export function useFacilityCoverage(plan, enabled) {
  const [attempt, setAttempt] = useState(0);
  const [reply, setReply] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    setReply({plan, attempt, status:'loading', metrics:null});
    return startCoverageTask({plan,
      onResult: metrics => setReply({plan, attempt, status:'ready', metrics}),
      onError: error => setReply({plan, attempt, status:'error', metrics:null, error}),
    });
  }, [plan, enabled, attempt]);
  // Filter during rendering as well as in worker callbacks. A changed draft
  // must never paint a previous plan's numbers while the effect is pending.
  const current = enabled && reply?.plan === plan && reply.attempt === attempt ? reply :
    {status:enabled ? 'loading' : 'idle', metrics:null};
  return {...current, retry:() => setAttempt(value => value + 1)};
}
