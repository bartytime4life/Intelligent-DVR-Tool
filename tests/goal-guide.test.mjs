import test from 'node:test';
import assert from 'node:assert/strict';
import { GOAL_GUIDE_TASKS, workspaceGuidance } from '../src/goal-guide.mjs';
import { WORKSPACE_TASKS } from '../src/workspace-tasks.mjs';

test('goal shortcuts retain the existing task identities and guarded destinations', () => {
  assert.deepEqual(GOAL_GUIDE_TASKS.map(task => [task.id, task.workspace, task.task]), [
    ['watch', 'Monitor', undefined], ['recording', 'Recognition', 'recording'],
    ['backup', 'Recognition', 'backup'], ['facility', 'Facility', undefined],
  ]);
  for (const shortcut of GOAL_GUIDE_TASKS) {
    const { goalTitle, goalDetail, ...task } = shortcut;
    assert.deepEqual(task, WORKSPACE_TASKS.find(candidate => candidate.id === task.id));
    assert.ok(goalTitle && goalDetail);
    assert.ok(Object.isFrozen(shortcut));
  }
});

test('each workspace has its own next-step guidance without unrelated camera starts', () => {
  const workspaces = new Set(WORKSPACE_TASKS.map(task => task.workspace));
  assert.equal(new Set([...workspaces].map(workspaceGuidance)).size, workspaces.size);
  for (const workspace of ['Facility', 'Events', 'System', 'Zones', 'Settings']) {
    assert.doesNotMatch(workspaceGuidance(workspace), /webcam|start ai|record a clip/i);
  }
  assert.match(workspaceGuidance('Facility'), /planning estimate/);
  assert.match(workspaceGuidance('Events'), /decision or note/);
  assert.match(workspaceGuidance('Unknown'), /Find a task/);
});
