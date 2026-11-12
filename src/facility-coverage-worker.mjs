import {coverageMetrics} from './facility-coverage.mjs';
import {COVERAGE_TASK_SCHEMA} from './facility-coverage-protocol.mjs';
import {validVisibilitySnapshot} from './facility-visibility-protocol.mjs';

self.onmessage = ({data}) => {
  if (data?.schema !== COVERAGE_TASK_SCHEMA || !Number.isSafeInteger(data.id)) return;
  try {
    if (!validVisibilitySnapshot(data.snapshot,data.plan)) throw Error('Missing current visibility snapshot.');
    const byId=new Map(data.snapshot.cameras.map(view=>[view.id,view]));
    const metrics = coverageMetrics(data.plan, camera=>byId.get(camera.id));
    self.postMessage({schema:COVERAGE_TASK_SCHEMA, id:data.id, type:'result', metrics});
  } catch {
    self.postMessage({schema:COVERAGE_TASK_SCHEMA, id:data.id, type:'error'});
  }
};
