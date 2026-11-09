import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('OEM source → verified backup → real CPU analysis → matching browser review, original unchanged',async({page})=>{
  const root=resolve('qa-local/library-native');
  const source=resolve(root,'oem/entrance.webm');
  const before=createHash('sha256').update(await readFile(source)).digest('hex');
  await page.goto('/');
  await page.getByRole('button',{name:'Recognition',exact:true}).click();
  await page.getByRole('button',{name:/^Use my existing DVR Keep a verified copy/}).click();
  const panel=page.getByRole('region',{name:'Existing DVR backup'});
  await panel.getByRole('button',{name:'Connect to this computer',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Save settings',exact:true})).toBeEnabled();
  await panel.getByLabel('DVR source folder',{exact:true}).fill(resolve(root,'oem'));
  await panel.getByLabel('Backup folder',{exact:true}).fill(resolve(root,'backup'));
  await panel.getByRole('button',{name:'Save settings',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Start backup',exact:true})).toBeEnabled();
  await panel.getByRole('checkbox',{name:'Analyze copied videos automatically',exact:true}).check();
  await panel.getByRole('button',{name:'Start backup',exact:true}).click();
  await panel.getByText('Saved videos',{exact:false}).click();
  await expect(panel.getByRole('button',{name:'Review backup',exact:true})).toBeVisible({timeout:45000});
  await expect(panel.getByText('Analysis finished · recording coverage unverified',{exact:true})).toBeVisible();
  expect(createHash('sha256').update(await readFile(source)).digest('hex')).toBe(before);
  await panel.getByRole('button',{name:'Stop backup',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Start backup',exact:true})).toBeEnabled();
  // The backup must remain usable after the OEM's own file is removed.
  await rm(source);
  await panel.getByRole('button',{name:'Review backup',exact:true}).click();
  await expect(page.locator('.recognition-status')).toContainText('fingerprint matched');
  await expect(page.locator('.recognition-stage video')).toBeVisible();
  await page.screenshot({path:'qa-local/library-native/review-desktop.png',fullPage:true});
  const session=await (await page.request.get('/api/analysis/session')).json();
  const status=await (await page.request.get('/api/library/status',{headers:{'X-DVR-Token':session.token}})).json();
  expect(status.items).toHaveLength(1);
  expect(status.items[0].sha256).toBe(before);
  if (process.env.DVR_LIBRARY_CATALOG) {
    const result=await (await page.request.get(`/api/library/items/${status.items[0].id}/result`,{headers:{'X-DVR-Token':session.token}})).json();
    expect(result.receipt.runtime.backend_id).toBe('onnxruntime-cuda');
    expect(result.receipt.runtime.startup_execution.node_execution_counts.CUDAExecutionProvider).toBeGreaterThan(0);
  } else expect(status.items[0].observations).toBeGreaterThan(0);
  expect(status.active).toBe(false);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('dvr.events.v1')||'[]').length)).toBe(0);
});
