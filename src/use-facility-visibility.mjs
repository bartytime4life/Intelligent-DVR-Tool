import {useEffect,useState} from 'react';
import {startVisibilityTask} from './facility-visibility-task.mjs';

export function useFacilityVisibility(plan) {
  const [attempt,setAttempt]=useState(0),[reply,setReply]=useState(null);
  useEffect(()=>{
    setReply({plan,attempt,status:'loading',snapshot:null});
    return startVisibilityTask({plan,
      onResult:snapshot=>setReply({plan,attempt,status:'ready',snapshot}),
      onError:error=>setReply({plan,attempt,status:'error',snapshot:null,error})});
  },[plan,attempt]);
  // Rendering is a second identity gate: effects need not have run yet after a
  // changed draft or retry, and those renders must not expose prior geometry.
  const current=reply?.plan===plan && reply.attempt===attempt ? reply : {status:'loading',snapshot:null};
  return {...current,retry:()=>setAttempt(value=>value+1)};
}
