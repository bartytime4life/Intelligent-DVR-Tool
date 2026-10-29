import {test, expect} from '@playwright/test';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';

test('a completed native analysis reopens after a real service restart without another job',async({page})=>{
  test.skip(process.platform!=='linux','Persistent result storage is Linux-only');
  test.setTimeout(45000);
  const root=process.cwd(), python=process.env.DVR_TEST_PYTHON || 'python';
  await mkdir(path.join(root,'qa-local'),{recursive:true});
  const folder=await mkdtemp(path.join(root,'qa-local/restart-browser-'));
  const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
  const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  let server, logs='';
  const command=['-m','edge.local_service','--recordings',path.join(folder,'recordings'),
    '--config',path.join(folder,'config.json'),'--state-dir',path.join(folder,'state'),'--port',String(port)];
  const session=async()=>{const response=await fetch(origin+'/api/analysis/session');if(!response.ok)throw Error('Session unavailable');return response.json();};
  const start=async()=>{
    server=spawn(python,command,{cwd:root,stdio:['ignore','pipe','pipe']});
    for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{logs=(logs+data).slice(-8000);});
    await expect.poll(async()=>{if(server.exitCode!==null)throw Error(logs);try{return (await session()).ready;}catch{return false;}},{timeout:10000}).toBe(true);
  };
  const stop=async()=>{
    if(!server || server.exitCode!==null)return;
    const current=server;let timer;
    const stopped=new Promise(resolve=>current.once('exit',resolve));current.kill('SIGINT');
    try{
      await Promise.race([stopped,new Promise((_,reject)=>{timer=setTimeout(()=>{current.kill('SIGKILL');reject(Error('Service shutdown deadline'));},4000);timer.unref();})]);
    }finally{clearTimeout(timer);}
  };
  try{
    const fixture=spawnSync(python,['tests/local_analysis_fixture.py','--output',folder],{cwd:root,encoding:'utf8',timeout:10000});
    expect(fixture.status,fixture.stderr).toBe(0);
    await start();await page.goto(origin+'/#recognition');
    await page.getByRole('button',{name:'Connect local analysis',exact:true}).click();
    const recording=(await session()).recordings.find(r=>r.name==='synthetic.webm');
    await page.getByLabel('Recording to analyze',{exact:true}).selectOption(recording.id);
    let starts=0;page.on('request',request=>{if(request.method()==='POST' && new URL(request.url()).pathname==='/api/analysis/jobs')starts++;});
    await page.getByRole('button',{name:'Analyze recording',exact:true}).click();
    await expect(page.getByText('Analysis opened. Recording fingerprint matched;',{exact:false})).toBeVisible({timeout:20000});
    const first=await session();expect(first.job.state).toBe('completed');expect(starts).toBe(1);
    const review=path.join(folder,'state','job-'+first.job.id,'review.json');
    const hash=createHash('sha256').update(await readFile(review)).digest('hex');
    await stop();await start();await page.reload();
    await page.getByRole('button',{name:'Connect local analysis',exact:true}).click();
    await expect(page.getByText('Recovered from local storage after a service restart. No analysis was rerun.',{exact:true})).toBeVisible();
    await expect(page.getByText('Analysis opened. Recording fingerprint matched;',{exact:false})).toBeVisible();
    const second=await session();expect(second.job.id).toBe(first.job.id);expect(second.job.recovered).toBe(true);
    expect(createHash('sha256').update(await readFile(review)).digest('hex')).toBe(hash);expect(starts).toBe(1);
    await page.screenshot({path:'test-results/native-result-recovered-after-restart.png',fullPage:true});
  }finally{
    await stop();await rm(folder,{recursive:true,force:true});
  }
});
