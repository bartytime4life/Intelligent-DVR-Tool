import {test,expect} from '@playwright/test';

async function publicFixture(page,{fails=false}={}) {
  const calls=[];let connected=false;
  const source={id:'public-garden',name:'Synthetic public garden',kind:'public-jpeg',provider:'Synthetic provider',provider_url:'https://www.provider.org/webcams/',refresh_seconds:60};
  await page.route('**/api/feeds/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    calls.push({path,body:request.postDataJSON()});
    if(path.endsWith('/session'))return route.fulfill({json:{token:'test-public-token',ready:true,sources:[source,{id:'private',name:'Private DVR',kind:'rtsp'}]}});
    const state={...source,id:'a'.repeat(32),source:source.id,state:fails?'failed':'live',error:fails?{message:'Public webcam unavailable. Check provider availability and valid HTTPS certificate. Reconnect explicitly.'}:null,frame_age_seconds:0};
    if(path.endsWith('/connect')){connected=true;return route.fulfill({status:202,json:{...state,state:'connecting'}});}
    if(path.endsWith('/disconnect')){connected=false;return route.fulfill({json:{...state,state:'disconnected'}});}
    if(path.endsWith('/frame'))return route.fulfill({contentType:'image/jpeg',body:Buffer.from(await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#24635e';ctx.fillRect(0,0,64,48);
      return canvas.toDataURL('image/jpeg').split(',')[1];
    }),'base64')});
    return route.fulfill({json:{...state,state:connected?state.state:'disconnected'}});
  });
  return calls;
}

test('public webcam is explicit, attributed, source-filtered and labelled as a periodic snapshot',async({page})=>{
  const requests=[];page.on('request',r=>requests.push(r.url()));
  const calls=await publicFixture(page);await page.goto('/');
  await page.getByRole('button',{name:'Public webcams',exact:true}).click();
  await expect(page.getByText('Connecting sends this computer’s public IP',{exact:false})).toBeVisible();
  expect(calls).toHaveLength(0);
  await page.getByRole('button',{name:'Load approved public webcams'}).click();
  await expect(page.getByLabel('Public webcam',{exact:true}).locator('option')).toHaveCount(2);
  expect(calls.filter(c=>c.path.endsWith('/connect'))).toHaveLength(0);
  await expect(page.getByRole('link',{name:'Synthetic provider · provider page ↗'})).toHaveAttribute('rel','noreferrer noopener');
  await page.getByRole('button',{name:'Connect public webcam',exact:true}).click();
  await expect(page.getByAltText('Synthetic public garden current preview frame')).toBeVisible();
  await expect(page.getByText('Snapshot · refresh 60s',{exact:false})).toBeVisible();
  await expect(page.getByText('Provider capture time and freshness unverified')).toBeVisible();
  expect(calls.find(c=>c.path.endsWith('/connect')).body).toEqual({source:'public-garden'});
  expect(requests.filter(u=>u.startsWith('https://www.provider.org'))).toEqual([]);
  await page.screenshot({path:'test-results/public-webcam-synthetic-snapshot.png',fullPage:true});
  await page.getByRole('button',{name:'Disconnect all',exact:true}).click();
  await expect(page.locator('.camera-wall img')).toHaveCount(0);
  expect(calls.some(c=>c.path.endsWith('/disconnect'))).toBe(true);
});

test('public source failure clears images and allows explicit recovery',async({page})=>{
  await publicFixture(page,{fails:true});await page.goto('/');
  await page.getByRole('button',{name:'Public webcams',exact:true}).click();
  await page.getByRole('button',{name:'Load approved public webcams'}).click();
  await page.getByRole('button',{name:'Connect public webcam',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Connection needs attention'})).toBeVisible();
  await expect(page.getByText('Public webcam unavailable.',{exact:false})).toBeVisible();
  await expect(page.locator('.camera-wall img')).toHaveCount(0);
  await page.unroute('**/api/feeds/**');await publicFixture(page);
  await page.getByRole('button',{name:'Public webcams',exact:true}).click();
  await page.getByRole('button',{name:'Load approved public webcams'}).click();
  await page.getByRole('button',{name:'Connect public webcam',exact:true}).click();
  await expect(page.getByAltText('Synthetic public garden current preview frame')).toBeVisible();
  await expect(page.locator('.live-tile')).toHaveCount(1);
});

test('public connection setup fits a phone and hidden previews stop without reconnecting',async({page})=>{
  const calls=await publicFixture(page);await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:'Public webcams',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:'test-results/public-webcam-mobile-setup.png',fullPage:true});
  await page.getByRole('button',{name:'Load approved public webcams'}).click();
  await page.getByRole('button',{name:'Connect public webcam',exact:true}).click();
  await expect(page.locator('.camera-wall img')).toHaveCount(1);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.locator('.camera-wall img')).toHaveCount(0);
  await expect.poll(()=>calls.filter(c=>c.path.endsWith('/disconnect')).length).toBe(1);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  expect(calls.filter(c=>c.path.endsWith('/connect'))).toHaveLength(1);
});
