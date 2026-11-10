import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {recognitionFixture} from '../fixtures/recognition.mjs';

// Only mocked JSON endpoints: no camera, recording, model or filesystem activation.
const id = 'a'.repeat(32);
const job = {id, state:'running', phase:'analyzing', recording:'generated.webm',
  frames_read:10, frames_analyzed:2, max_frames:6000, elapsed_seconds:1};
const recorder = {state:'running', active:true, name:'Generated recorder',
  limits:{segment_seconds:30,retention_minutes:60,max_segments:120,max_storage_mib:2048},
  counters:{recorded:0,analyzed:0,dropped:0,expired:0,reconnects:0}, queue_depth:0,
  oldest_pending_seconds:0, storage_bytes:0, disk_free_bytes:1024**3, worker:{},
  segments:[], retry_seconds:0, seconds_since_completed_segment:null};
const library = {configured:true,active:true,analyzing:false,state:'running',error:null,
  config:{source_folder:'/generated/source',backup_folder:'/generated/backup',max_storage_gib:100,reserve_gib:2,settle_seconds:60,recursive:true},
  storage_bytes:0,disk_free_bytes:1024**3,waiting:0,scan_limited:false,unsupported:[],items:[],
  limits:{analysis_max_bytes:512*1024**2,max_items:100},counters:{copied:0,duplicates:0}};

const cases = [
  {name:'recording cancellation',task:/^Analyze a recording/,region:'Local recording analysis',
    connect:'Connect local analysis',command:'Cancel analysis',recovered:'Refresh choices',
    poll:`/api/analysis/jobs/${id}`,action:`/api/analysis/jobs/${id}/cancel`,initialPolls:0,
    initial:job,stopped:{...job,state:'cancelled',phase:'cancelled'}},
  {name:'LAN recorder stop',task:/^Record a LAN camera/,region:'LAN camera recorder',
    connect:'Connect LAN recorder',command:'Stop recording & analysis',recovered:'Start recording & analysis',
    poll:'/api/recorder/status',action:'/api/recorder/stop',initialPolls:1,
    initial:recorder,stopped:{...recorder,active:false,state:'stopped'}},
  {name:'backup stop',task:/^Use my existing DVR/,region:'Existing DVR backup',
    connect:'Connect to this computer',command:'Stop backup',recovered:'Start backup',
    poll:'/api/library/status',action:'/api/library/stop',initialPolls:1,
    initial:library,stopped:{...library,active:false,state:'paused'}},
];

for (const scenario of cases) test(`${scenario.name} ignores an older failed status response`, async ({page}) => {
  const state = {poll:null,command:null,polls:0,current:scenario.initial};
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if ((path === '/api/analysis/session' || path === '/api/library/session')) return route.fulfill({json:{
      token:'generated-session',ready:true,recordings:[{id:'video',name:'generated.webm',bytes:100}],
      models:[{id:'model',name:'Generated model'}],rules:[{id:'rules',name:'Presence',models:['model'],summary:[]}],
      job:scenario.poll.startsWith('/api/analysis/jobs/') ? job : null,recorder_active:false,
    }});
    if (path === scenario.poll) {
      if (state.polls++ >= scenario.initialPolls && !state.poll) {state.poll=route;return;}
      return route.fulfill({json:state.current});
    }
    if (path === scenario.action) {state.command=route;return;}
    if (path === '/api/setup/cameras') return route.fulfill({json:{enabled:true,sources:[]}});
    return route.fulfill({status:503,json:{error:{message:'Unused generated endpoint.'}}});
  });
  await page.goto('/#recognition');
  await page.getByRole('button',{name:scenario.task}).click();
  const panel = page.getByRole('region',{name:scenario.region});
  await panel.getByRole('button',{name:scenario.connect,exact:true}).click();
  const command = panel.getByRole('button',{name:scenario.command,exact:true});
  await expect(command).toBeEnabled();
  await expect.poll(() => Boolean(state.poll)).toBe(true);
  await command.click();
  await expect(command).toBeDisabled();
  await expect.poll(() => Boolean(state.command)).toBe(true);

  // The older poll fails while the explicit command is still pending. Its failure
  // must not disconnect the controller or defeat the successful command response.
  const failed = page.waitForResponse(response => new URL(response.url()).pathname === scenario.poll && response.status() === 503);
  await state.poll.fulfill({status:503,json:{error:{message:'Older status request failed.'}}});
  await failed;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  state.current=scenario.stopped;
  await state.command.fulfill({json:state.current});
  await expect(panel.getByRole('button',{name:scenario.recovered,exact:true})).toBeEnabled();
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

const source = Buffer.from('generated review transfer bytes');
const sha = createHash('sha256').update(source).digest('hex');
const completed = {id,state:'completed',sha256:sha,source:'generated',name:'generated.webm',bytes:source.length,
  created_at:1000,copied_at:1000,observations:1,analysis_eligible:true,coverage:'completed'};
const transferCases = [
  {name:'segment review',task:/^Record a LAN camera/,region:'LAN camera recorder',connect:'Connect LAN recorder',
    open:'Review segment',stop:'Stop recording & analysis',cancel:'Cancel review transfer',
    prefix:'/api/recorder',initial:{...recorder,segments:[completed]},stopped:{...recorder,active:false,state:'stopped',segments:[completed]}},
  {name:'segment Send to Events',task:/^Record a LAN camera/,region:'LAN camera recorder',connect:'Connect LAN recorder',
    open:'Send to Events',stop:'Stop recording & analysis',cancel:'Cancel review transfer',
    prefix:'/api/recorder',initial:{...recorder,segments:[completed]},stopped:{...recorder,active:false,state:'stopped',segments:[completed]}},
  {name:'backup review',task:/^Use my existing DVR/,region:'Existing DVR backup',connect:'Connect to this computer',
    open:'Review backup',stop:'Stop backup',cancel:'Cancel backup opening',
    prefix:'/api/library',initial:{...library,items:[completed]},stopped:{...library,active:false,state:'paused',items:[completed]}},
];

for (const scenario of transferCases) test(`${scenario.name} can be cancelled while Stop stays available`, async ({page}) => {
  const state = {current:scenario.initial,results:[],stops:0};
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if ((path === '/api/analysis/session' || path === '/api/library/session')) return route.fulfill({json:{token:'generated-session',ready:true,recordings:[],
      models:[{id:'model',name:'Generated model'}],rules:[{id:'rules',name:'Presence',models:['model'],summary:[]}],job:null,recorder_active:false}});
    if (path === `${scenario.prefix}/status`) return route.fulfill({json:state.current});
    if (path === `${scenario.prefix}/stop`) {state.stops++;state.current=scenario.stopped;return route.fulfill({json:state.current});}
    if (path.endsWith('/result')) {state.results.push(route);return;}
    if (path.endsWith('/source')) return route.fulfill({contentType:'video/webm',body:source});
    if (path === '/api/setup/cameras') return route.fulfill({json:{enabled:true,sources:[]}});
    return route.fulfill({status:503,json:{error:{message:'Unused generated endpoint.'}}});
  });
  await page.goto('/#recognition');
  await page.getByRole('button',{name:/^Open saved results/}).click();
  const previous = recognitionFixture('f'.repeat(64));
  previous.receipt.camera=previous.trace.camera='previous-review';
  previous.receipt.events.forEach(event => {event.camera='previous-review';});
  await page.getByLabel('Open recognition results').setInputFiles({name:'previous.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(previous))});
  await expect(page.locator('.recognition-facts')).toContainText('previous-review');
  await page.getByRole('button',{name:scenario.task}).click();
  const panel = page.getByRole('region',{name:scenario.region});
  await panel.getByRole('button',{name:scenario.connect,exact:true}).click();
  if (scenario.prefix === '/api/library') await panel.locator('.backup-saved summary').click();
  const opening = panel.getByRole('button',{name:scenario.open,exact:true});
  // Synchronous repeated clicks must still create only one transfer.
  await opening.evaluate(button => {button.click();button.click();});
  await expect.poll(() => state.results.length).toBe(1);
  const cancel = panel.getByRole('button',{name:scenario.cancel,exact:true});
  await expect(cancel).toBeEnabled();
  const stop = panel.getByRole('button',{name:scenario.stop,exact:true});
  await expect(stop).toBeEnabled();await stop.click();
  await expect.poll(() => state.stops).toBe(1);
  await expect(cancel).toBeEnabled();await cancel.click();
  await expect(opening).toBeEnabled();
  await expect(page.locator('.recognition-facts')).toContainText('previous-review');
  if (scenario.prefix === '/api/recorder') await expect(panel.locator('.lan-segment.unhandled')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dvr.events.v1') || '[]'))).toEqual([]);

  // A late completion/finally from the first operation cannot clear a new one.
  await opening.click();await expect.poll(() => state.results.length).toBe(2);
  await state.results[0].fulfill({json:recognitionFixture(sha)}).catch(() => {});
  await expect(cancel).toBeEnabled();await expect(opening).toBeDisabled();
  await cancel.click();
  await state.results[1].fulfill({json:recognitionFixture(sha)}).catch(() => {});
  await expect(page.locator('.recognition-facts')).toContainText('previous-review');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dvr.events.v1') || '[]'))).toEqual([]);
});
