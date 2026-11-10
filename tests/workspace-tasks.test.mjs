import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACE_TASKS, findWorkspaceTasks } from '../src/workspace-tasks.mjs';

test('task catalog exposes each workspace without starting an operation', () => {
  assert.equal(new Set(WORKSPACE_TASKS.map(task => task.id)).size, WORKSPACE_TASKS.length);
  assert.deepEqual(new Set(WORKSPACE_TASKS.map(task => task.workspace)),new Set(['Monitor','Recognition','Train','Facility','Events','Zones','System','Settings']));
  assert.deepEqual(WORKSPACE_TASKS.filter(task => task.task).map(task => task.task).sort(),['backup','import','recorder','recording']);
});
test('common user words find their destination and title matches rank first', () => {
  for (const [query,id] of [['GPU','system'],['notes','review'],['floor plan','facility'],['backup folders','backup'],['saved results','import'],['Analyze a recording','recording'],['RTSP network','recorder']]) {
    assert.equal(findWorkspaceTasks(query)[0]?.id,id,query);
  }
});
test('search handles punctuation, word order, case and empty results', () => {
  assert.equal(findWorkspaceTasks('  FLOOR / Plan! ')[0].id,'facility');
  assert.equal(findWorkspaceTasks('folders backup')[0].id,'backup');
  assert.deepEqual(findWorkspaceTasks('volcano sandwich'),[]);
  assert.deepEqual(findWorkspaceTasks(''),WORKSPACE_TASKS);
  assert.deepEqual(findWorkspaceTasks('   '),WORKSPACE_TASKS);
});
