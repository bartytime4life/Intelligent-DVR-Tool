import {test, expect} from '@playwright/test';
const nav=(page,name)=>page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:new RegExp(`^${name}`)});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    window.mediaDiagnostics=[];
    const media=navigator.mediaDevices, original=media?.getUserMedia;
    if(original)media.getUserMedia=async function(options){
      try{const result=await original.call(media,options);window.mediaDiagnostics.push({ok:true,tracks:result.getVideoTracks().map(t=>({state:t.readyState,muted:t.muted}))});return result;}
      catch(error){window.mediaDiagnostics.push({name:error.name,message:error.message});throw error;}
    };
  });
});
test.afterEach(async({page},info)=>{
  if(info.status!==info.expectedStatus)await info.attach('synthetic-webcam-diagnostics',{body:JSON.stringify(await page.evaluate(()=>window.mediaDiagnostics)),contentType:'application/json'});
});
async function dvr(page,source='video') {
  await page.getByRole('button',{name:'Set up local DVR'}).click();
  await page.getByRole('button',{name:'Load configured DVR sources'}).click();
  await page.getByLabel('DVR channel',{exact:true}).selectOption(source);
  await page.getByRole('button',{name:'Connect DVR channel',exact:true}).click();
}
test('monitor starts empty without stock images, synthetic events or camera activation',async({page})=>{
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Your cameras belong here'})).toBeVisible();
  await expect(page.getByRole('region',{name:'Start camera monitoring'})).toBeVisible();
  await expect(page.locator('.empty-feed')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Connect source',exact:true})).toHaveCount(1);
  await expect(page.getByRole('group',{name:'Camera source shortcuts'}).getByRole('button')).toHaveCount(3);
  await expect(page.locator('.camera-wall img,.camera-wall video')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('dvr.events.v1')))).toEqual([]);
  expect(requests.filter(u=>/loading-dock|front-entrance|warehouse-aisle|sales-floor|parking-lot|\/api\/feeds\/connect/.test(u))).toEqual([]);
  await page.screenshot({path:'test-results/real-monitor-empty-desktop.png',fullPage:true});
});
test('explicit webcam preview receives frames, stops on leaving, and reconnects',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Connect source',exact:true}).first().click();
  await page.getByRole('button',{name:'Connect webcam',exact:true}).click();
  await expect(page.getByRole('button',{name:'View camera wall'})).toBeVisible();
  await page.getByRole('button',{name:'View camera wall'}).click();
  const video=page.getByLabel('Webcam video');await expect(video).toBeVisible();
  await expect.poll(()=>video.evaluate(v=>v.videoWidth)).toBeGreaterThan(0);
  await page.evaluate(()=>window.testTrack=document.querySelector('video').srcObject.getVideoTracks()[0]);
  await page.screenshot({path:'test-results/real-monitor-synthetic-webcam.png',fullPage:true});
  await nav(page,'Recognition').click();
  expect(await page.evaluate(()=>window.testTrack.readyState)).toBe('ended');
  await nav(page,'Monitor').click();await expect(page.getByRole('heading',{name:'Your cameras belong here'})).toBeVisible();
  await page.getByRole('button',{name:'Connect source',exact:true}).first().click();await page.getByRole('button',{name:'Connect webcam',exact:true}).click();
  await expect(page.getByRole('button',{name:'Disconnect webcam',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Disconnect webcam',exact:true}).click();
  await expect(page.getByRole('button',{name:'Connect webcam',exact:true})).toBeEnabled();
});
test('denied webcam permission reports recovery instead of placeholder footage',async({page,context})=>{
  await context.grantPermissions([], {origin:'http://127.0.0.1:4184'});await page.goto('/');await page.getByRole('button',{name:'Connect source',exact:true}).first().click();
  await page.getByRole('button',{name:'Connect webcam',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Camera access was denied');
  await expect(page.getByLabel('Webcam video')).toHaveCount(0);
  await context.grantPermissions(['camera'], {origin:'http://127.0.0.1:4184'});await page.getByRole('button',{name:'Connect webcam',exact:true}).click();
  await expect(page.getByRole('button',{name:'View camera wall'})).toBeVisible();
});
test('configured RTSP stream traverses native decoder and local HTTP bridge; leaving disconnects',async({page})=>{
  await page.goto('/');await dvr(page);
  await expect(page.getByAltText('Synthetic RTSP video current preview frame')).toBeVisible({timeout:15000});
  await expect(page.locator('.feed-status')).toHaveText('Receiving');
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('fixture-secret');
  await page.screenshot({path:'test-results/real-monitor-synthetic-rtsp.png',fullPage:true});
  await nav(page,'Events').click();await nav(page,'Monitor').click();
  await expect(page.getByRole('heading',{name:'Your cameras belong here'})).toBeVisible();
  await dvr(page);await expect(page.getByAltText('Synthetic RTSP video current preview frame')).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'Disconnect all',exact:true}).click();
  await expect(page.locator('.camera-wall img')).toHaveCount(0);
});
test('invalid DVR channel errors, cancellation and retry recover without old frames',async({page})=>{
  await page.goto('/');await dvr(page,'missing');
  await expect(page.getByRole('heading',{name:'Connection needs attention'})).toBeVisible({timeout:15000});
  await expect(page.getByText('No usable RTSP stream.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Set up local DVR'}).click();
  await page.getByLabel('DVR channel',{exact:true}).selectOption('stall');await page.getByRole('button',{name:'Connect DVR channel',exact:true}).click();
  await expect(page.locator('.live-tile')).toHaveCount(1); // Terminal error was replaced.
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('.live-tile')).toHaveCount(0);
  await page.getByRole('button',{name:'Set up local DVR'}).click();await page.getByLabel('DVR channel',{exact:true}).selectOption('video');await page.getByRole('button',{name:'Connect DVR channel',exact:true}).click();
  await expect(page.getByAltText('Synthetic RTSP video current preview frame')).toBeVisible({timeout:15000});
});
test('mobile camera setup and monitor remain usable without horizontal scrolling',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'Connect source',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'Connect a camera source'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  await page.screenshot({path:'test-results/real-monitor-mobile-setup.png',fullPage:true});
});

test('hiding the page releases webcam tracks and does not reconnect automatically',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Connect source',exact:true}).first().click();
  await page.getByRole('button',{name:'Connect webcam',exact:true}).click();await page.getByRole('button',{name:'View camera wall'}).click();
  await page.evaluate(()=>{window.testTrack=document.querySelector('video').srcObject.getVideoTracks()[0];Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>page.evaluate(()=>window.testTrack.readyState)).toBe('ended');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.getByLabel('Webcam video')).toHaveCount(0);
  await expect(page.getByText('Preview stopped while the page was hidden.',{exact:false})).toBeVisible();
});

test('onboarding source paths reuse explicit setup without opening a camera by themselves',async({page})=>{
  await page.goto('/');
  const start=page.getByRole('region',{name:'Start camera monitoring'});
  const dialog=page.getByRole('dialog',{name:'Connect a camera source'});
  await start.getByRole('button',{name:/Computer webcam/}).click();
  await expect(dialog).toContainText('Use a built-in or USB webcam');
  await dialog.getByRole('button',{name:'Close connection setup'}).click();
  await expect(dialog).toHaveCount(0);
  await start.getByRole('button',{name:/Local DVR \/ IP camera/}).click();
  await expect(dialog).toContainText('Choose an RTSP channel');
  await dialog.getByRole('button',{name:'Close connection setup'}).click();
  await start.getByRole('button',{name:/Approved public webcam/}).click();
  await expect(dialog).toContainText('Choose an approved public webcam');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.camera-wall img,.camera-wall video')).toHaveCount(0);
  await expect(page.locator('.live-tile')).toHaveCount(0);
});

test('after connecting from first-run choice, focus returns to a reachable toolbar control',async({page})=>{
  await page.goto('/');
  await page.getByRole('region',{name:'Start camera monitoring'}).getByRole('button',{name:/Computer webcam/}).click();
  await page.getByRole('button',{name:'Connect webcam',exact:true}).click();
  await page.getByRole('button',{name:'View camera wall'}).click();
  await expect(page.locator('.monitor-welcome')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Connect source',exact:true})).toBeFocused();
});

test('a stopped webcam preview can be removed to restore uncluttered first-run wall',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Connect source',exact:true}).click();
  await page.getByRole('button',{name:'Connect webcam',exact:true}).click();
  await page.getByRole('button',{name:'View camera wall'}).click();
  await expect(page.getByLabel('Webcam video')).toBeVisible();
  await page.locator('.live-tile').getByRole('button',{name:'Disconnect',exact:true}).click();
  await expect(page.locator('.live-tile')).toHaveCount(1);
  await page.locator('.live-tile').getByRole('button',{name:'Remove',exact:true}).click();
  await expect(page.getByRole('region',{name:'Start camera monitoring'})).toBeVisible();
  await expect(page.locator('.live-tile')).toHaveCount(0);
  await expect(page.locator('.camera-wall img,.camera-wall video')).toHaveCount(0);
});
