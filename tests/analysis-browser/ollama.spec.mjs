import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

test('receipt review and local advice require separate operator actions', async ({page}) => {
  const requests = [];
  await page.route('http://127.0.0.1:11434/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'Access-Control-Allow-Origin':'http://127.0.0.1:4183', 'Access-Control-Allow-Headers':'Content-Type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({status:204,headers});
    requests.push(path);
    let body;
    if (path === '/api/tags') body = {models:[{name:'local-test'}, {name:'remote:cloud'}]};
    else if (path === '/api/show') body = {details:{format:'gguf'},capabilities:['completion']};
    else {
      expect(path).toBe('/api/chat');
      const prompt = JSON.parse(route.request().postDataJSON().messages[1].content);
      expect(prompt).toEqual({stage:'Training Lab receipt',scope:'synthetic',threshold:.5,frames:1,tp:0,fp:0,fn:1});
      body = {done:true,message:{content:JSON.stringify({action:'inspect_misses'})}};
    }
    await route.fulfill({json:body,headers});
  });
  await page.goto('/#train');
  await page.getByText('Review a Training Lab receipt', {exact:true}).click();
  const data = {schema:'intelligent-dvr.lab-receipt.v1', data_kind:'synthetic', engine:'pixel-components-v1',backend:'browser-javascript',
    settings:{threshold:.5,iou:.5}, sources:[{sha256:'1'.repeat(64),split:'eval',frames:[
      {id:'private-frame',reviewed:true,labels:[{label:'person',box:[0,0,.4,.4]}]}]}],
    metrics:{frames:1,tp:0,fp:0,fn:1}, predictions:{'private-frame':[]}, review_history:[{note:'private review'}]};
  const receipt = {...data,receipt_payload_sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
  await page.getByLabel('Run receipt').setInputFiles({name:'test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(receipt))});
  await expect(page.getByRole('heading',{name:'Your held-out results'})).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByRole('button',{name:'Find installed models'}).click();
  await page.getByLabel('Local chat model').selectOption('local-test');
  expect(requests).toEqual(['/api/tags','/api/show']);
  await page.getByRole('button',{name:'Suggest a review step'}).click();
  await expect(page.getByText(/In Review, inspect missed labels/)).toBeVisible();
  expect(requests).toEqual(['/api/tags','/api/show','/api/show','/api/chat']);
  await page.getByRole('button',{name:'Close receipt'}).click();
  await expect(page.getByText(/In Review, inspect missed labels/)).toHaveCount(0);
});
