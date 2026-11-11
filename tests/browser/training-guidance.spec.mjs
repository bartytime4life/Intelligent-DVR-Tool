import {test, expect} from '@playwright/test';
import {build} from 'esbuild';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Mount the actual scorecard with generated score arrays. No camera, recording,
// model worker, service writes or private browser evidence is needed here.
let fixture;
test.beforeAll(async()=>{
  const result=await build({
    stdin:{resolveDir:dirname(fileURLToPath(import.meta.url)),loader:'jsx',contents:`
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import Scorecard from '../../src/TrainingScorecard.jsx';
      import {compareTrainingCheck} from '../../src/training.mjs';
      const labeled=[
        ...[0,1,2].map(seconds=>({segment:'usual',expect:'present',score:.45,seconds,wall:seconds})),
        ...[14,15,16].map(seconds=>({segment:'empty',expect:'absent',score:.1,seconds,wall:seconds})),
      ];
      const outcome={current:.5,labeled,frames:6,canApply:true};
      const past=[{calibration:{present:[.8,.8,.8],absent:[.45,.45,.45]},check:null}];
      function GeneratedScorecard(){
        const [include,setInclude]=useState(false),[check,setCheck]=useState(null);
        function fresh(value){
          const frames=labeled.map(frame=>({...frame,segment:frame.expect==='present'?'check-present':'check-empty'}));
          setCheck({value,confirmed:true,result:compareTrainingCheck(frames,outcome.current,value)});
        }
        return <>
          <button onClick={()=>setInclude(value=>!value)}>Generated evidence update</button>
          <Scorecard outcome={outcome} service={{training:{enabled:true}}} pastSessions={past}
            viewName="Generated view" includeSession={include} onInclude={setInclude} check={check}
            onCheck={fresh} onSave={()=>{}} onRetry={()=>{}}/>
        </>;
      }
      createRoot(document.getElementById('fixture')).render(<GeneratedScorecard/>);
    `},
    bundle:true,write:false,format:'esm',platform:'browser',loader:{'.css':'empty'},
    define:{'process.env.NODE_ENV':'"test"'},
  });
  fixture=result.outputFiles[0].text;
});

async function openScorecard(page){
  await page.route('**/generated-training-scorecard',route=>route.fulfill({contentType:'text/html',body:
    '<!doctype html><html lang="en"><head><title>Generated training guidance regression</title></head><body><main id="fixture"></main><script type="module" src="/generated-training-scorecard.js"></script></body></html>'}));
  await page.route('**/generated-training-scorecard.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}));
  await page.route('**/api/**',route=>route.abort());
  await page.goto('/generated-training-scorecard');
  await expect(page.getByRole('heading',{name:'Your first recording is scored'})).toBeVisible();
}

const trial=page=>page.locator('.train-score-detail summary small');
const combined=page=>page.getByRole('checkbox',{name:/Add this session to the combined evidence/});

test('automatic training trial follows combined evidence and a fresh check freezes the tested pair',async({page})=>{
  await openScorecard(page);
  await expect(trial(page)).toHaveText('Trial 0.40');
  await combined(page).check();
  await expect(trial(page)).toHaveText('Trial 0.50');
  await expect(page.getByText('2 calibration sessions inform the suggestion.',{exact:false})).toBeVisible();
  await combined(page).uncheck();
  await expect(trial(page)).toHaveText('Trial 0.40');
  await page.getByRole('button',{name:'Check on a new recording',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Better on the fresh check'})).toBeVisible();
  await expect(combined(page)).toBeDisabled();
  await page.getByRole('button',{name:'Generated evidence update',exact:true}).click();
  await expect(combined(page)).toBeChecked();
  await expect(trial(page)).toHaveText('Trial 0.40');
  await expect(page.getByRole('slider',{name:'Trial detection threshold'})).toHaveCount(0);
});

test('manual trial survives evidence changes and reset resumes automatic suggestions',async({page})=>{
  await openScorecard(page);
  await page.getByText('Advanced sensitivity',{exact:true}).click();
  const slider=page.getByRole('slider',{name:'Trial detection threshold'});
  await expect(slider).toHaveAccessibleName('Trial detection threshold');
  await slider.fill('0.45');
  await combined(page).check();
  await expect(trial(page)).toHaveText('Trial 0.45');
  await page.getByRole('button',{name:'Reset to suggested 0.50',exact:true}).click();
  await expect(slider).toHaveValue('0.5');
  await combined(page).uncheck();
  await expect(trial(page)).toHaveText('Trial 0.40');
  await expect(slider).toHaveValue('0.4');
});
