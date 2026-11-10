// Navigation only: choosing a task never starts a camera, recording or analysis.
export const WORKSPACE_TASKS = Object.freeze([
  {id:'watch', group:'Watch & record', title:'Watch cameras', detail:'Connect a source and view its preview.', workspace:'Monitor', keywords:'live webcam usb rtsp streams ip camera'},
  {id:'recorder', group:'Watch & record', title:'Record a LAN camera', detail:'Set up one authorized RTSP source.', workspace:'Recognition', task:'recorder', keywords:'dvr ip network stream capture'},
  {id:'backup', group:'Watch & record', title:'Back up saved DVR videos', detail:'Keep verified copies and check saved byte receipts.', workspace:'Recognition', task:'backup', keywords:'backup library existing recorder folders files storage byte integrity checksum sha acceptance receipts verification'},
  {id:'recording', group:'Analyze & review', title:'Analyze a recording', detail:'Choose a saved video and inspect detections.', workspace:'Recognition', task:'recording', keywords:'video file clip objects detection model inference ai'},
  {id:'import', group:'Analyze & review', title:'Open saved results', detail:'Match an analysis export to its original video.', workspace:'Recognition', task:'import', keywords:'import receipt json trace recognition evidence'},
  {id:'review', group:'Analyze & review', title:'Review observations', detail:'Filter events, add notes and record decisions.', workspace:'Events', keywords:'history queue alerts human verdict export'},
  {id:'facility', group:'Plan & improve', title:'Design facility coverage', detail:'Plan buildings, rooms and camera placement.', workspace:'Facility', keywords:'map floor plan building site walls layout doors'},
  {id:'zones', group:'Plan & improve', title:'Set review zones', detail:'Choose where and when an observation needs attention.', workspace:'Zones', keywords:'rules area rectangle labels threshold motion'},
  {id:'train', group:'Plan & improve', title:'Train recognition', detail:'Run a guided check or manage local face templates.', workspace:'Train', keywords:'training person people enrollment verify accuracy compare'},
  {id:'system', group:'Set up', title:'Plan this machine', detail:'Balance camera load, storage and hardware.', workspace:'System', keywords:'gpu cpu memory ram disk resources capacity performance setup'},
  {id:'settings', group:'Set up', title:'Connections and local evidence', detail:'Find camera setup, imports and privacy information.', workspace:'Settings', keywords:'settings local data privacy repository help'},
]);

const words = value => value.toLocaleLowerCase('en-US').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();

export function findWorkspaceTasks(query = '') {
  const normalized = words(String(query).slice(0,160));
  if (!normalized) return [...WORKSPACE_TASKS];
  const tokens = normalized.split(/\s+/);
  return WORKSPACE_TASKS.map((task,index) => {
    const title = words(task.title), destination = words(task.workspace);
    const all = words(`${task.title} ${task.detail} ${task.workspace} ${task.group} ${task.keywords}`);
    if (!tokens.every(token => all.includes(token))) return null;
    const score = (title.includes(normalized) ? 100 : 0) + tokens.reduce((sum,token) => sum + (title.includes(token) ? 8 : destination.includes(token) ? 3 : 1),0);
    return {task,score,index};
  }).filter(Boolean).sort((a,b) => b.score-a.score || a.index-b.index).map(entry => entry.task);
}
