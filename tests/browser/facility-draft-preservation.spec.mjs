import {test,expect} from '@playwright/test';
import {blankFacility} from '../../src/facility.mjs';
import {createLibrary} from '../../src/facility-library.mjs';
import {savedFacilities,savedPlan} from './facility-test-helpers.mjs';

// Generated local plans and text only. No map provider, service, camera or model
// is contacted by these draft-preservation checks.
const nav=(page,name)=>page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name,exact:true});
async function openFacility(page,plan=blankFacility()) {
  await page.addInitScript(({key,raw})=>{
    if(localStorage.getItem(key)===null)localStorage.setItem(key,raw);
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
      enumerateDevices:async()=>[],getUserMedia:()=>{throw Error('Camera access is forbidden in this generated test.');},
    }});
  },{key:'dvr.facilities.v1',raw:JSON.stringify(createLibrary(plan))});
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return url.hostname==='127.0.0.1' && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
  await page.goto('/#facility');
  await expect(page.getByRole('heading',{name:'Locate your facility',exact:true})).toBeVisible();
  await expect(page.locator('.facility-library-save')).toContainText('Saved in this browser');
}
async function chooseConfirmation(page,action,accept=false) {
  const ready=page.waitForEvent('dialog'),running=action();
  const dialog=await ready;
  expect(dialog.type()).toBe('confirm');
  const message=dialog.message();
  await (accept?dialog.accept():dialog.dismiss());await running;
  return message;
}
const unloadBlocked=page=>page.evaluate(()=>{
  const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;
});

test('route coordinate drafts keep their units and text until saved or explicitly discarded',async({page})=>{
  await openFacility(page);
  await page.getByRole('button',{name:/^6 Handoffs/}).click();
  await page.getByText('Enter route points as coordinates',{exact:true}).click();
  const points=page.getByLabel('Route points',{exact:true}),before=await savedPlan(page);
  await points.fill('0, 0\n10, 0');
  await expect(page.getByLabel('Measurement units',{exact:true})).toBeDisabled();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeDisabled();
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await expect(page.getByRole('heading',{name:'Test camera handoffs',exact:true})).toBeVisible();
  await page.getByText('Enter route points as coordinates',{exact:true}).click();
  await page.getByText('Enter route points as coordinates',{exact:true}).click();
  expect(await chooseConfirmation(page,()=>nav(page,'Events').click())).toContain('Leave the facility builder?');
  await expect(points).toHaveValue('0, 0\n10, 0');
  expect(await savedPlan(page)).toEqual(before);
  await page.getByRole('button',{name:'Save route points',exact:true}).click();
  await expect.poll(async()=>(await savedPlan(page)).route).toEqual([[0,0],[10,0]]);
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeEnabled();
  await expect(points).toHaveValue('');
  await points.fill('0,0\ninvalid');
  await page.getByRole('button',{name:'Replace route with these points',exact:true}).click();
  await expect(page.getByText(/Enter one east, north pair per line/)).toBeVisible();
  await expect(points).toHaveValue('0,0\ninvalid');
  await page.getByRole('button',{name:'Discard route points',exact:true}).click();
  await expect(page.getByLabel('Measurement units',{exact:true})).toBeEnabled();
  await nav(page,'Events').click();
  await expect(page).toHaveURL(/#events$/);
});

test('pathway coordinate drafts stay bound to their original floor and remain saveable',async({page})=>{
  const plan=blankFacility();
  plan.buildings=[{id:'generated-building',name:'Generated two-floor building',height:8,floors:2,
    footprint:[[-20,-20],[20,-20],[20,20],[-20,20],[-20,-20]]}];
  await openFacility(page,plan);
  await page.getByRole('button',{name:/^3 Floors & labels/}).click();
  await page.getByText('Enter pathway points as coordinates',{exact:true}).click();
  const points=page.getByLabel('Pathway points',{exact:true});
  await points.fill('-10, 0\n10, 0');
  await page.getByLabel('Active floor',{exact:true}).selectOption('1');
  await expect(page.getByLabel('Active floor',{exact:true})).toHaveValue('0');
  await expect(points).toHaveValue('-10, 0\n10, 0');
  await expect(page.getByLabel('Measurement units',{exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Draw floor opening',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Add pathway on Level 1',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Add pathway on Level 1',exact:true}).click();
  await expect.poll(async()=>(await savedPlan(page)).paths).toEqual([expect.objectContaining({
    buildingId:'generated-building',level:0,points:[[-10,0],[10,0]],
  })]);
  await expect(page.getByLabel('Pathway name',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeEnabled();
  await points.fill('0, 0\n5, 5');
  await page.getByRole('button',{name:'Discard pathway points',exact:true}).click();
  await expect(points).toHaveValue('');
  await expect(page.getByLabel('Measurement units',{exact:true})).toBeEnabled();
  await page.getByLabel('Active floor',{exact:true}).selectOption('1');
  await expect(page.getByLabel('Active floor',{exact:true})).toHaveValue('1');
  expect((await savedPlan(page)).paths[0].level).toBe(0);
});

test('pasted JSON warns on navigation and accidental close without blocking its own import',async({page})=>{
  await openFacility(page);
  await page.getByRole('button',{name:'Paste JSON',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Import facility JSON'}),text=dialog.getByLabel('Facility plan JSON',{exact:true});
  expect(await unloadBlocked(page)).toBe(false);
  const raw=JSON.stringify({...blankFacility(),name:'Generated pasted campus'});
  await text.fill(raw);
  await expect.poll(()=>unloadBlocked(page)).toBe(true);
  expect(await chooseConfirmation(page,()=>page.evaluate(()=>{window.location.hash='#events';}))).toContain('Leave the facility builder?');
  await expect(page).toHaveURL(/#facility$/);
  await expect(text).toHaveValue(raw);
  expect(await chooseConfirmation(page,()=>dialog.getByRole('button',{name:'Close JSON import',exact:true}).click())).toContain('Discard pasted facility JSON?');
  await expect(text).toHaveValue(raw);
  await dialog.getByRole('button',{name:'Import pasted plan',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async()=>(await savedFacilities(page)).facilities.length).toBe(2);
  await expect(page.getByLabel('Facility name',{exact:true})).toHaveValue('Generated pasted campus');
  await expect(page.locator('.facility-library-save')).toContainText('Saved in this browser');
  expect(await unloadBlocked(page)).toBe(false);
  await page.getByRole('button',{name:'Paste JSON',exact:true}).click();
  await dialog.getByLabel('Facility plan JSON',{exact:true}).fill('Generated unfinished JSON');
  await dialog.getByRole('button',{name:'Discard pasted JSON',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  // Dialog unmount clears its draft, then the builder reports the combined
  // dirty state to the app. Wait for those effects before checking the guard.
  await expect.poll(()=>unloadBlocked(page)).toBe(false);
});
