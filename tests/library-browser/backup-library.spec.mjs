import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {recognitionFixture} from '../fixtures/recognition.mjs';

const source=Buffer.from('controlled OEM video fixture');
const sha=createHash('sha256').update(source).digest('hex');
const item={id:'a'.repeat(32),name:'driveway.mp4',bytes:source.length,sha256:sha,copied_at:1793721600,state:'completed',observations:1,analysis_eligible:true,coverage:'completed'};
const savedConfig={source_folder:'/local/oem/recordings',backup_folder:'/local/another-copy',max_storage_gib:100,reserve_gib:2,settle_seconds:60,recursive:true};
const emptyStatus=()=>({configured:false,active:false,analyzing:false,state:'unconfigured',error:null,config:null,storage_bytes:0,disk_free_bytes:100*1024**3,waiting:0,scan_limited:false,unsupported:[],items:[],limits:{analysis_max_bytes:512*1024**2,max_items:100},counters:{copied:0,duplicates:0}});
async function fixture(page,{status=emptyStatus(),pickerDisabled=false}={}) {
  const state={status,requests:[],cameras:[],statusLost:false,pickerDisabled};
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    let body; if(req.method()==='POST') body=req.postDataJSON();
    state.requests.push({path,method:req.method(),body,headers:req.headers()});
    const reply=(value,code=200)=>route.fulfill({status:code,contentType:'application/json',body:JSON.stringify(value)});
    if((path==='/api/analysis/session'||path==='/api/library/session')) return reply({token:'fixture-owner-token',ready:true,models:[{id:'detector',name:'Local detector'}],rules:[{id:'rules',name:'Default rules',models:['detector']}],recordings:[],job:null,recorder_active:false,recording_import:{enabled:true}});
    if(path==='/api/library/status') return state.statusLost?route.abort():reply(state.status);
    if(path==='/api/library/pick-folder') return state.pickerDisabled?reply({error:'Native folder chooser is unavailable.'},503):reply({path:'/local/chosen-source'});
    if(path==='/api/library/configure') {state.status={...state.status,configured:true,state:'paused',config:body};return reply(state.status);}
    if(path==='/api/library/start') {state.status={...state.status,active:true,state:'running',analyzing:body.analyze};return reply(state.status);}
    if(path==='/api/library/stop') {state.status={...state.status,active:false,analyzing:false,state:'paused'};return reply(state.status);}
    if(path==='/api/library/retry') return reply(state.status);
    if(path.endsWith('/result')) return reply(recognitionFixture(sha));
    if(path.endsWith('/source')) return route.fulfill({contentType:'video/mp4',body:source});
    if(path==='/api/setup/cameras') {
      if(req.method()==='POST') state.cameras.push({id:'b'.repeat(32),name:body.name});
      return reply({enabled:true,sources:state.cameras,limit:100},req.method()==='POST'?201:200);
    }
    if(path==='/api/setup/recorder') return reply({state:'stopped'});
    if(path==='/api/recorder/status') return reply({state:'stopped',active:false,name:'Front entrance',limits:{segment_seconds:30,retention_minutes:60,max_segments:120,max_storage_mib:2048},counters:{recorded:0,analyzed:0,dropped:0,expired:0,reconnects:0},queue_depth:0,oldest_pending_seconds:0,storage_bytes:0,disk_free_bytes:0,worker:{},segments:[],retry_seconds:0,seconds_since_completed_segment:null});
    if(path==='/api/feeds/session') return reply({token:'fixture-owner-token',sources:[],limits:{max_active:4}});
    return reply({error:{message:'Fixture endpoint is not configured.'}},503);
  });
  await page.goto('/#recognition');
  await page.getByRole('button',{name:'Use my existing DVR Keep a verified copy of finished videos',exact:true}).click();
  return state;
}
const panel=page=>page.getByRole('region',{name:'Existing DVR backup'});
async function connect(page) {await page.getByRole('button',{name:/^Use my existing DVR Keep a verified copy/}).click();await panel(page).getByRole('button',{name:'Connect to this computer'}).click();await expect(panel(page).getByRole('button',{name:'Refresh backup connection'})).toBeVisible();}

test('copy-only setup works without a model and keeps automatic analysis disabled',async({page})=>{
  const state=await fixture(page);
  state.status={...state.status,configured:true,config:savedConfig};
  await page.route('**/api/library/session',route=>route.fulfill({json:{token:'fixture-owner-token',ready:false,models:[],rules:[],analysis_enabled:false}}));
  await connect(page);
  await expect(panel(page).getByLabel('Analyze copied videos automatically')).toBeDisabled();
  await expect(panel(page).getByText('Copy-only mode:',{exact:false})).toBeVisible();
  await panel(page).getByRole('button',{name:'Start backup',exact:true}).click();
  expect(state.requests.find(r=>r.path==='/api/library/start').body).toEqual({analyze:false,model:'',rules:''});
  await expect(panel(page).locator('.local-analysis-badge')).toHaveText('Backup running');
});

test('novice setup saves folders, starts backup only, stops explicitly and survives reconnect',async({page})=>{
  const state=await fixture(page);
  await expect(panel(page).getByRole('heading',{name:'Use my existing DVR'})).toBeVisible();
  await expect(panel(page).getByRole('button',{name:'Start backup',exact:true})).toBeDisabled();
  expect(state.requests.filter(r=>r.method==='POST')).toEqual([]);
  await connect(page);
  await panel(page).getByRole('button',{name:'Choose source folder'}).click();
  await expect(panel(page).getByRole('textbox',{name:'DVR source folder',exact:true})).toHaveValue('/local/chosen-source');
  await panel(page).getByRole('textbox',{name:'Backup folder',exact:true}).fill(savedConfig.backup_folder);
  await panel(page).getByRole('button',{name:'Save settings',exact:true}).click();
  const configured=state.requests.find(r=>r.path==='/api/library/configure');
  expect(configured.body).toEqual({...savedConfig,source_folder:'/local/chosen-source'});
  await expect(panel(page).getByLabel('Analyze copied videos automatically')).not.toBeChecked();
  await panel(page).getByRole('button',{name:'Start backup',exact:true}).click();
  expect(state.requests.find(r=>r.path==='/api/library/start').body).toEqual({analyze:false,model:'detector',rules:'rules'});
  await expect(panel(page).locator('.local-analysis-badge')).toHaveText('Backup running');
  await expect(page.getByLabel('Open recognition results')).toBeEnabled();
  await page.reload();
  expect(state.requests.filter(r=>r.path==='/api/library/stop')).toHaveLength(0);
  await connect(page);
  await expect(panel(page).getByRole('textbox',{name:'Backup folder',exact:true})).toHaveValue(savedConfig.backup_folder);
  await panel(page).getByRole('button',{name:'Stop backup',exact:true}).click();
  await expect(panel(page).locator('.local-analysis-badge')).toHaveText('Backup paused');
  expect(state.requests.filter(r=>r.path==='/api/library/start')).toHaveLength(1);
});

test('local folder validation and native picker failure give an actionable fallback',async({page})=>{
  const state=await fixture(page,{pickerDisabled:true});await connect(page);
  await panel(page).getByRole('button',{name:'Choose source folder'}).click();
  await expect(panel(page).getByText(/type or paste the full folder path/)).toBeVisible();
  await panel(page).getByRole('textbox',{name:'DVR source folder',exact:true}).fill('/same');
  await panel(page).getByRole('textbox',{name:'Backup folder',exact:true}).fill('/same/');
  await panel(page).getByRole('button',{name:'Save settings',exact:true}).click();
  await expect(panel(page).getByRole('alert')).toContainText('separate');
  expect(state.requests.filter(r=>r.path==='/api/library/configure')).toHaveLength(0);
  await expect(panel(page).getByRole('button',{name:'Refresh backup connection'})).toBeEnabled();
});

test('explicit automatic analysis blocks competing manual actions while copy-only does not',async({page})=>{
  const status={...emptyStatus(),configured:true,state:'paused',config:savedConfig};
  const state=await fixture(page,{status});await connect(page);
  await page.getByRole('button',{name:/^Record a LAN camera/}).click();
  await page.getByRole('region',{name:'LAN camera recorder'}).getByRole('button',{name:'Connect LAN recorder'}).click();
  await expect(page.getByRole('button',{name:'Start recording & analysis',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:/^Use my existing DVR/}).click();
  await panel(page).getByLabel('Analyze copied videos automatically').check();
  await expect(panel(page).getByLabel('Backup analysis model')).toBeVisible();
  await panel(page).getByRole('button',{name:'Start backup',exact:true}).click();
  expect(state.requests.find(r=>r.path==='/api/library/start').body.analyze).toBe(true);
  await page.getByRole('button',{name:/^Open saved results/}).click();
  await expect(page.getByLabel('Open recognition results')).toBeDisabled();
  await page.getByRole('button',{name:/^Record a LAN camera/}).click();
  await expect(page.getByRole('button',{name:'Start recording & analysis',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:/^Use my existing DVR/}).click();
  await panel(page).getByRole('button',{name:'Stop backup',exact:true}).click();
  await page.getByRole('button',{name:/^Open saved results/}).click();
  await expect(page.getByLabel('Open recognition results')).toBeEnabled();
});

test('lost status stays visible, preserves analyzing guard and never restarts work',async({page})=>{
  const status={...emptyStatus(),configured:true,active:true,analyzing:true,state:'running',config:savedConfig};
  const state=await fixture(page,{status});await connect(page);state.statusLost=true;
  await expect(panel(page).getByRole('alert')).toContainText('Background backup may continue',{timeout:7000});
  await expect(panel(page).getByRole('button',{name:'Start backup',exact:true})).toBeDisabled();
  await expect(page.getByLabel('Open recognition results')).toBeDisabled();
  expect(state.requests.filter(r=>r.method==='POST')).toEqual([]);
  state.statusLost=false;state.status={...status,active:false,analyzing:false,state:'paused'};
  await panel(page).getByRole('button',{name:'Refresh backup connection'}).click();
  await expect(page.getByLabel('Open recognition results')).toBeEnabled();
});

test('completed backup opens only its matched result, partial coverage stays clear and retry is explicit',async({page})=>{
  const status={...emptyStatus(),configured:true,config:savedConfig,active:true,items:[{...item,coverage:'partial'},{...item,id:'c'.repeat(32),name:'back-door.mp4',state:'failed',error:'Check recording integrity.'}],counters:{copied:2,duplicates:1}};
  const state=await fixture(page,{status});await connect(page);
  await panel(page).getByText('Saved videos', {exact:false}).click();
  await expect(panel(page).getByText('Partial analysis · recording coverage unverified')).toBeVisible();
  await panel(page).getByRole('button',{name:'Retry analysis',exact:true}).click();
  expect(state.requests.find(r=>r.path==='/api/library/retry').body).toEqual({id:'c'.repeat(32)});
  await panel(page).getByRole('button',{name:'Review backup',exact:true}).click();
  await expect(page.locator('.recognition-status')).toContainText('fingerprint matched');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('dvr.events.v1')||'[]').length)).toBe(0);
});

test('private camera saves with no connect, password is cleared, and recorder source requires a separate click',async({page})=>{
  const state=await fixture(page);await connect(page);
  await panel(page).getByText('Connect an IP camera or LAN DVR',{exact:true}).click();
  const details=panel(page).locator('.backup-camera-setup');
  await details.getByRole('textbox',{name:'Name',exact:true}).fill('Front entrance');
  await details.getByRole('textbox',{name:'Private IPv4 address'}).fill('192.168.1.20');
  await details.getByRole('textbox',{name:'Documented channel path'}).fill('/approved/channel');
  await details.getByRole('textbox',{name:'Camera username'}).fill('operator');
  await details.getByLabel('Camera password').fill('test-private-password');
  await details.getByRole('button',{name:'Save camera source',exact:true}).click();
  await expect(details.getByText(/Camera saved on this computer/)).toBeVisible();
  await expect(details.getByLabel('Camera password')).toHaveValue('');
  expect(state.requests.some(r=>r.path==='/api/feeds/connect'||r.path==='/api/recorder/start'||r.path==='/api/setup/recorder')).toBe(false);
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('test-private-password');
  await details.getByRole('button',{name:'Use for LAN recording',exact:true}).click();
  expect(state.requests.find(r=>r.path==='/api/setup/recorder').body).toEqual({source:'b'.repeat(32)});
  await expect(page.getByRole('region',{name:'LAN camera recorder'}).getByRole('heading',{name:'Front entrance'})).toBeVisible();
  expect(state.requests.some(r=>r.path==='/api/recorder/start')).toBe(false);
});

test('mobile backup panel contains long names, latest 100 rows and large-file browser limits',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const items=Array.from({length:103},(_,i)=>({...item,id:i.toString(16).padStart(32,'0'),name:`${'long-camera-name-'.repeat(6)}${i}.mp4`,bytes:i===0?513*1024**2:item.bytes,analysis_eligible:i!==0}));
  await fixture(page,{status:{...emptyStatus(),configured:true,config:savedConfig,items}});await connect(page);
  await panel(page).getByText('Saved videos', {exact:false}).click();
  await expect(panel(page).locator('.backup-item')).toHaveCount(100);
  await expect(panel(page).getByRole('button',{name:'Review backup'}).first()).toBeDisabled();
  await expect(panel(page).getByText('Copy saved; outside local analysis limits.')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:'test-results/library/mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'test-results/library/desktop.png',fullPage:true});
});

test('an incomplete stop keeps setup and restart disabled until status confirms it finished',async({page})=>{
  const state=await fixture(page,{status:{...emptyStatus(),configured:true,config:savedConfig,state:'stopping'}});await connect(page);
  await expect(panel(page).locator('.local-analysis-badge')).toHaveText('Stopping backup');
  await expect(panel(page).getByRole('button',{name:'Start backup',exact:true})).toBeDisabled();
  await expect(panel(page).getByRole('textbox',{name:'DVR source folder',exact:true})).toBeDisabled();
  state.status={...state.status,state:'paused'};
  await expect(panel(page).getByRole('button',{name:'Start backup',exact:true})).toBeEnabled({timeout:7000});
});

test('a mismatched saved source never opens a result or sends observations',async({page})=>{
  await fixture(page,{status:{...emptyStatus(),configured:true,config:savedConfig,items:[item]}});await connect(page);
  await page.route('**/api/library/items/*/source',route=>route.fulfill({contentType:'video/mp4',body:Buffer.from('different bytes')}));
  await panel(page).getByText('Saved videos', {exact:false}).click();
  await panel(page).getByRole('button',{name:'Review backup',exact:true}).click();
  await expect(panel(page).getByRole('alert')).toContainText('does not match');
  await expect(page.locator('.recognition-status')).not.toContainText('fingerprint matched');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('dvr.events.v1')||'[]').length)).toBe(0);
});

test('camera setup refusal reports actual error and preserves the current source list',async({page})=>{
  const state=await fixture(page);state.cameras=[{id:'camera-existing',name:'Existing camera'}];await connect(page);
  await panel(page).getByText('Connect an IP camera or LAN DVR',{exact:true}).click();
  await expect(panel(page).getByText('Saved sources: Existing camera.')).toBeVisible();
  await page.route('**/api/setup/cameras',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Use the PC launcher for guided camera setup.'})}));
  await panel(page).getByRole('button',{name:'Refresh backup connection'}).click();
  await expect(panel(page).locator('.backup-camera-setup').getByRole('alert')).toHaveText('Use the PC launcher for guided camera setup.');
  await expect(panel(page).getByText('Saved sources: Existing camera.')).toBeVisible();
  expect(state.requests.filter(r=>r.path==='/api/feeds/connect'||r.path==='/api/recorder/start')).toHaveLength(0);
});

test('copy progress names the video and advances without reserving the analyzer',async({page})=>{
  const copying={name:'front-entrance-completed.mp4',bytes:100*1024**2,copied_bytes:25*1024**2};
  const state=await fixture(page,{status:{...emptyStatus(),configured:true,active:true,config:savedConfig,copying}});await connect(page);
  const progress=panel(page).getByRole('progressbar',{name:'Copy progress for front-entrance-completed.mp4'});
  await expect(panel(page).getByText('Saving another copy: front-entrance-completed.mp4')).toBeVisible();
  await expect(progress).toHaveAttribute('max',String(copying.bytes));
  await expect(progress).toHaveAttribute('value',String(copying.copied_bytes));
  await expect(panel(page).getByText('25.0 MiB of 100.0 MiB')).toBeVisible();
  await expect(page.getByLabel('Open recognition results')).toBeEnabled();
  state.status={...state.status,copying:{...copying,copied_bytes:75*1024**2}};
  await expect(progress).toHaveAttribute('value',String(75*1024**2),{timeout:7000});
  await expect(page.getByLabel('Open recognition results')).toBeEnabled();
  state.status={...state.status,copying:null};
  await expect(progress).toHaveCount(0,{timeout:7000});
  expect(state.requests.filter(r=>r.path==='/api/library/start'||r.path==='/api/library/stop')).toHaveLength(0);
});

test('storage fields share their input baseline at tablet width',async({page})=>{
  await page.setViewportSize({width:768,height:1000});
  await fixture(page,{status:{...emptyStatus(),configured:true,config:savedConfig}});await connect(page);
  await panel(page).getByText('Storage & file settings',{exact:true}).click();
  const tops=await panel(page).locator('.backup-settings-grid input').evaluateAll(inputs=>inputs.map(input=>input.getBoundingClientRect().top));
  expect(Math.max(...tops)-Math.min(...tops)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('task switching keeps unsaved folders and reports background backup separately from analyzer use',async({page})=>{
  const state=await fixture(page,{status:{...emptyStatus(),configured:true,config:savedConfig}});await connect(page);
  await panel(page).getByRole('textbox',{name:'DVR source folder',exact:true}).fill('/local/pending-folder-edit');
  await page.getByRole('button',{name:/^Open saved results/}).click();
  await expect(panel(page)).not.toBeVisible();
  await expect(page.getByRole('heading',{name:'Open previously exported results'})).toBeVisible();
  await page.getByRole('button',{name:/^Use my existing DVR/}).click();
  await expect(panel(page).getByRole('textbox',{name:'DVR source folder',exact:true})).toHaveValue('/local/pending-folder-edit');
  await expect(panel(page).getByText('Unsaved folder settings')).toBeVisible();
  state.status={...state.status,active:true,state:'running'};
  await expect(page.getByRole('button',{name:/^Use my existing DVR/})).toContainText('Backup running');
  await page.getByRole('button',{name:/^Analyze a recording/}).click();
  await expect(page.getByRole('button',{name:/^Use my existing DVR/})).toContainText('Backup running');
  state.statusLost=true;
  await expect(page.getByRole('button',{name:/^Use my existing DVR/})).toContainText('Status unknown',{timeout:7000});
  expect(state.requests.filter(r=>r.path==='/api/library/start'||r.path==='/api/library/stop')).toHaveLength(0);
});
