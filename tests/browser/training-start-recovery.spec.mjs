import {test,expect} from '@playwright/test';

async function setup(page,{failure='500'}={}) {
  const state={starts:0,imports:0,cancels:0,job:null};
  await page.addInitScript(()=>{
    window.generatedClock=0;window.generatedCameraRequests=0;
    Object.defineProperty(performance,'now',{configurable:true,value:()=>window.generatedClock});
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
      enumerateDevices:async()=>[],getUserMedia:async()=>{
        window.generatedCameraRequests++;
        const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
        canvas.getContext('2d').fillRect(0,0,64,64);return canvas.captureStream(1);
      },
    }});
    window.MediaRecorder=class{
      static isTypeSupported(){return true;}
      constructor(stream,{mimeType}){this.mimeType=mimeType;this.state='inactive';}
      start(){this.state='recording';}pause(){this.state='paused';}resume(){this.state='recording';}
      stop(){this.state='inactive';queueMicrotask(()=>{
        this.ondataavailable?.({data:new Blob(['generated training video-only recording bytes'],{type:'video/webm'})});this.onstop?.();
      });}
    };
  });
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path==='/api/analysis/session') return route.fulfill({json:{
      token:'generated-token',ready:true,recording_import:{enabled:true},training:{enabled:true},
      models:[{id:'generated',name:'Generated detector',profile:'opencv-zoo-yolox-generated'}],
      rules:[{id:'generated-rule',name:'Generated rule',models:['generated']}],people:{enabled:false},job:state.job,
    }});
    if(path==='/api/analysis/recordings') {
      state.imports++;return route.fulfill({json:{sha256:request.headers()['x-dvr-sha256'],recording:{id:'a'.repeat(32)}}});
    }
    if(path==='/api/analysis/jobs'&&request.method()==='POST') {
      state.starts++;state.job={id:'b'.repeat(32),state:'running',phase:'analyzing'};
      if(failure==='lost') return route.abort('failed');
      if(failure==='malformed') return route.fulfill({json:{}});
      return route.fulfill({status:500,json:{error:{message:'Generated lost start acknowledgement'}}});
    }
    if(path.endsWith('/cancel')) state.cancels++;
    return route.fulfill({status:503,json:{error:{message:'No native worker exists in this generated fixture'}}});
  });
  await page.goto('/#train');
  await page.getByRole('button',{name:'Start session',exact:true}).click();
  await page.getByRole('button',{name:'Connect camera',exact:true}).click();
  await page.getByRole('button',{name:'Start guided recording',exact:true}).click();
  await page.evaluate(()=>{window.generatedClock=3000;});
  await expect(page.locator('.take-phase')).toContainText('Prompt 1');
  await page.evaluate(()=>{window.generatedClock=57000;});
  await expect(page.getByRole('alert')).toContainText('Analysis may already be running');
  return state;
}

for(const failure of ['500','lost','malformed']) test(`${failure} analysis start reply preserves the recording without blindly retrying or cancelling an unknown job`,async({page})=>{
  const state=await setup(page,{failure});
  await expect(page.getByRole('button',{name:'Retry this recording',exact:true})).toHaveCount(0);
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Save training recording',exact:true}).click();
  expect((await download).suggestedFilename()).toMatch(/\.webm$/);
  await page.getByRole('button',{name:'Check local analysis status',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('reports a running analysis');
  await expect(page.getByRole('button',{name:'Retry this recording',exact:true})).toHaveCount(0);
  expect(state.starts).toBe(1);expect(state.imports).toBe(1);expect(state.cancels).toBe(0);
  const dialogReady=page.waitForEvent('dialog');
  const navigation=page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Events',exact:true}).click();
  await(await dialogReady).accept();await navigation;
  await expect(page).toHaveURL(/#events$/);expect(state.cancels).toBe(0);
});

test('only a verified inactive local status exposes an explicit retry and warns before replacing a retained result',async({page})=>{
  const state=await setup(page);
  state.job={...state.job,state:'completed'};
  await page.getByRole('button',{name:'Check local analysis status',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Another run replaces the current analysis result');
  await expect(page.getByRole('button',{name:'Retry this recording',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Open Recognition',exact:true})).toBeEnabled();
  expect(state.starts).toBe(1);expect(state.imports).toBe(1);expect(state.cancels).toBe(0);
});
