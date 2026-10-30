import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('webcam clip to local import, native analysis, verified report and portable exports',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Record webcam clip',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Connect source',exact:true}).first().click();
  await page.getByRole('button',{name:'Connect webcam',exact:true}).click();
  await page.getByRole('button',{name:'View camera wall',exact:true}).click();
  await page.getByRole('button',{name:'Record webcam clip',exact:true}).click();
  await expect(page.getByText('● Recording webcam clip',{exact:true})).toBeVisible();
  await page.waitForTimeout(1800); // Allow complete native MediaRecorder frames, not a stub.
  await page.getByRole('button',{name:'Stop recording',exact:true}).click();
  await page.getByRole('button',{name:'Open clip in Recognition',exact:true}).click();
  await page.getByRole('button',{name:'Connect local analysis',exact:true}).click();
  await page.getByRole('button',{name:'Import webcam clip',exact:true}).click();
  await expect(page.locator('.local-analysis-message')).toContainText('Recording saved and selected');
  await expect(page.getByRole('button',{name:'Import webcam clip',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Analyze recording',exact:true}).click();
  await expect(page.locator('.recognition-status')).toContainText('fingerprint matched');
  await expect(page.getByLabel('Recognition report',{exact:true})).toBeVisible();
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download report JSON',exact:true}).click();
  const file=await downloaded;const report=JSON.parse(await readFile(await file.path(),'utf8'));
  expect(report.schema).toBe('intelligent-dvr.recognition-report.v1');
  expect(report.source.fingerprint_matched).toBe(true);expect(report.analysis.sampled_frames).toBeGreaterThan(1);
  expect(report.summary.detections).toBeGreaterThan(0);
  const portable=page.waitForEvent('download');
  await page.getByRole('button',{name:'Save recognition results',exact:true}).click();
  const bundle=JSON.parse(await readFile(await (await portable).path(),'utf8'));
  expect(bundle.receipt.source_sha256).toBe(report.source.sha256);
  await page.getByLabel('Open recognition results',{exact:true}).setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});
  await expect(page.locator('.recognition-facts')).toContainText('recording fingerprint matched');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:'test-results/capture-report-mobile.png',fullPage:true});
});

test('explicit file import is idempotent and never starts a job automatically',async({page})=>{
  await page.goto('/#recognition');await page.getByRole('button',{name:'Connect local analysis',exact:true}).click();
  const jobs=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/jobs'))jobs.push(r.url());});
  for(let i=0;i<2;i++){
    await page.getByLabel('Import local recording',{exact:true}).setInputFiles('qa-local/analysis-browser/recordings/synthetic.webm');
    await expect(page.locator('.local-analysis-message')).toContainText('Recording saved and selected');
  }
  expect(jobs).toEqual([]);
  const value=await page.getByLabel('Recording to analyze').inputValue();
  expect(value).toMatch(/^[a-f0-9]{32}$/);
});
