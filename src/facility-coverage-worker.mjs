import {coverageMetrics, fanCache} from './facility-coverage.mjs';
import {wallObstacles} from './facility.mjs';
import {COVERAGE_TASK_SCHEMA} from './facility-coverage-protocol.mjs';

self.onmessage = ({data}) => {
  if (data?.schema !== COVERAGE_TASK_SCHEMA || !Number.isSafeInteger(data.id)) return;
  try {
    const metrics = coverageMetrics(data.plan, fanCache()(wallObstacles(data.plan)));
    self.postMessage({schema:COVERAGE_TASK_SCHEMA, id:data.id, type:'result', metrics});
  } catch {
    self.postMessage({schema:COVERAGE_TASK_SCHEMA, id:data.id, type:'error'});
  }
};
