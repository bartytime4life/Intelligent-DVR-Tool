import {planVisibility} from './facility-visibility.mjs';
import {VISIBILITY_TASK_SCHEMA} from './facility-visibility-protocol.mjs';

self.onmessage=({data})=>{
  if (data?.schema !== VISIBILITY_TASK_SCHEMA || !Number.isSafeInteger(data.id)) return;
  try {
    const snapshot=planVisibility(data.plan);
    self.postMessage({schema:VISIBILITY_TASK_SCHEMA,id:data.id,type:'result',snapshot});
  } catch {
    self.postMessage({schema:VISIBILITY_TASK_SCHEMA,id:data.id,type:'error'});
  }
};
