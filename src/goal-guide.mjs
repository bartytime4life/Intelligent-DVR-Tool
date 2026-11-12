import { WORKSPACE_TASKS } from './workspace-tasks.mjs';

// These are shortcuts to the existing guarded routes, never operational actions.
const goals = [
  ['watch', 'Watch cameras', 'Choose a source preview'],
  ['recording', 'Analyze saved video', 'Find people and objects'],
  ['backup', 'Keep DVR copies', 'Preserve finished recordings'],
  ['facility', 'Plan coverage', 'Draw your site and camera plan'],
];

export const GOAL_GUIDE_TASKS = Object.freeze(goals.map(([id, title, detail]) =>
  Object.freeze({ ...WORKSPACE_TASKS.find(task => task.id === id), goalTitle: title, goalDetail: detail })
));

const guidance = Object.freeze({
  Monitor: 'Choose a source preview, then start recording or AI only when ready.',
  Recognition: 'Choose a recording task, inspect its source, then send observations to Events.',
  Train: 'Record a guided session, check the result, then choose whether to save a setting.',
  Facility: 'Locate your site, draw the spaces, then place cameras. Coverage is a planning estimate.',
  Events: 'Inspect each observation and its source before saving a decision or note.',
  Zones: 'Mark an image region and save its review rule. Export it separately for local analysis.',
  System: 'Estimate storage and workload, then apply browser limits or export a local policy.',
  Settings: 'Find camera connections, local evidence and privacy information here.',
});

export function workspaceGuidance(workspace) {
  return Object.hasOwn(guidance, workspace) ? guidance[workspace] : 'Find a task to choose your next step. Operations start only when you choose.';
}
