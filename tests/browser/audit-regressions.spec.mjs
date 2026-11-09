import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {recognitionFixture} from '../fixtures/recognition.mjs';
import {parseRecognition} from '../../src/recognition.mjs';
const upload=value=>({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});

test('conflicting recording imports leave the original reviewed thumbnail untouched',async({page})=>{
  const old={...parseRecognition(recognitionFixture()).events[0],status:'confirmed',note:'Existing review'};
  await page.addInitScript(event=>localStorage.setItem('dvr.events.v1',JSON.stringify([event])),old);
  await page.goto('/#recognition');
  await page.getByRole('button',{name:/^Open saved results/}).click();
  await page.evaluate(async event=>{
    const images=await import('/src/local-images.mjs');
    if(!await images.putImage('thumbnails',images.observationImageKey(event),new Blob(['original-still'])))throw Error('Fixture image could not be saved');
  },old);
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
    const ctx=canvas.getContext('2d'),stream=canvas.captureStream(10),parts=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    recorder.ondataavailable=e=>parts.push(e.data);
    const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
    for(let i=0;i<10;i++){ctx.fillStyle=i%2?'#284b55':'#182b35';ctx.fillRect(0,0,320,240);await new Promise(r=>setTimeout(r,100));}
    recorder.stop();await stopped;stream.getTracks().forEach(t=>t.stop());
    return Array.from(new Uint8Array(await new Blob(parts).arrayBuffer()));
  });
  const buffer=Buffer.from(bytes),bundle=recognitionFixture(createHash('sha256').update(buffer).digest('hex'));
  await page.getByLabel('Open recognition results').setInputFiles(upload(bundle));
  await page.getByLabel('Match original recording').setInputFiles({name:'generated.webm',mimeType:'video/webm',buffer});
  await expect(page.locator('.recognition-status')).toContainText('fingerprint matched');
  await page.getByRole('button',{name:'Send 1 observations to Events'}).click();
  await expect(page.locator('.toast')).toContainText('conflicts');
  const images=await page.evaluate(async({old,changed})=>{
    const {getImage,observationImageKey}=await import('/src/local-images.mjs');
    return {old:await (await getImage('thumbnails',observationImageKey(old))).text(),changed:await getImage('thumbnails',observationImageKey(changed))};
  },{old,changed:parseRecognition(bundle).events[0]});
  expect(images).toEqual({old:'original-still',changed:null});
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('dvr.events.v1')))).toEqual([old]);
});

test('another tab saving System preserves a dirty draft until explicit reload',async({page,context})=>{
  await page.goto('/#system');
  await page.getByLabel('Planned cameras',{exact:true}).fill('111');
  const other=await context.newPage();
  try {
    await other.goto('/#system');
    await other.getByLabel('Planned cameras',{exact:true}).fill('123');
    await other.getByRole('button',{name:'Apply workspace limits',exact:true}).click();
    await expect(page.getByText('Saved setup changed in another tab.',{exact:false})).toBeVisible();
    await expect(page.getByLabel('Planned cameras',{exact:true})).toHaveValue('111');
    await page.getByRole('button',{name:'Discard draft & load saved setup',exact:true}).click();
    await expect(page.getByLabel('Planned cameras',{exact:true})).toHaveValue('123');
  }finally{await other.close();}
});
