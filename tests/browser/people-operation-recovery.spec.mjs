import {test,expect} from '@playwright/test';

const person={id:'a'.repeat(16),name:'Generated Person',created:'2026-11-09T12:00:00Z',views:6,baseline:null};
const another={...person,id:'b'.repeat(16),name:'Another Generated Person'};
async function setup(page,{initialMalformed=false,holdDelete=false,deleteStatus=200,deleteReply={deleted:person.id}}={}) {
  const state={reads:0,posts:0,people:[person,another],refreshFails:false,release:null};
  await page.addInitScript(()=>Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
    getUserMedia:()=>Promise.reject(Error('No device is allowed in this generated test')),enumerateDevices:async()=>[],
  }}));
  await page.route('**/api/**',async route=> {
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path==='/api/analysis/session') return route.fulfill({json:{
      token:'generated-token',ready:true,recording_import:{enabled:true},training:{enabled:true},
      models:[{id:'generated',name:'Generated detector',profile:'opencv-zoo-yolox-generated'}],
      rules:[{id:'generated-rule',name:'Generated rule',models:['generated']}],people:{enabled:true},job:null,
    }});
    if(path==='/api/analysis/people'&&request.method()==='GET') {
      state.reads++;
      if(state.refreshFails) return route.fulfill({status:503,json:{error:{message:'Generated list read failure'}}});
      return route.fulfill({json:initialMalformed&&state.reads===1 ? {} : {people:state.people}});
    }
    if(path===`/api/analysis/people/${person.id}/delete`) {
      state.posts++;
      if(holdDelete) await new Promise(resolve=>{state.release=resolve;});
      return route.fulfill({status:deleteStatus,json:deleteReply}).catch(()=>{});
    }
    return route.fulfill({status:503,json:{error:{message:'No native operation exists in this generated fixture'}}});
  });
  await page.goto('/#train');
  await expect(page.getByRole('button',{name:'Start session',exact:true})).toBeEnabled();
  return state;
}

test('a malformed first people reply stays unknown and a later verified refresh recovers the list',async({page})=>{
  await setup(page,{initialMalformed:true});
  const panel=page.getByRole('region',{name:'Enrolled people',exact:true});
  await expect(panel.getByRole('alert')).toContainText('could not be verified');
  await expect(panel).toContainText('Saved people have not been verified');
  await expect(panel).not.toContainText('No saved people were listed');
  await panel.getByRole('button',{name:'Refresh saved people',exact:true}).click();
  await expect(panel.getByText(person.name,{exact:true})).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('delete is single-flight and a failed follow-up read keeps its stale row blocked until verified refresh',async({page})=>{
  const state=await setup(page,{holdDelete:true});
  const panel=page.getByRole('region',{name:'Enrolled people',exact:true});
  const row=panel.getByRole('listitem').filter({has:page.getByText(person.name,{exact:true})});
  await row.getByRole('button',{name:'Delete',exact:true}).click();
  await row.getByRole('button',{name:`Delete ${person.name}’s face template`,exact:true}).evaluate(button=>{button.click();button.click();});
  await expect.poll(()=>state.posts).toBe(1);
  await expect(row.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();
  await expect(panel.getByRole('button',{name:'Check baseline',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Enroll a person',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Start session',exact:true})).toBeDisabled();
  state.refreshFails=true;state.release();
  await expect(panel).toContainText('acknowledged');
  await expect(row.getByRole('button',{name:`Delete ${person.name}’s face template`,exact:true})).toBeDisabled();
  await row.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(row.getByRole('button',{name:'Check baseline',exact:true})).toBeDisabled();
  await expect(row.getByRole('button',{name:'Delete',exact:true})).toBeDisabled();
  state.refreshFails=false;state.people=[another];
  await panel.getByRole('button',{name:'Refresh saved people',exact:true}).click();
  await expect(row).toHaveCount(0);await expect(panel).toContainText('face template was deleted');
  expect(state.posts).toBe(1);
});

for(const reply of ['500','malformed']) test(`${reply} delete reply stays uncertain even when the next list omits the person`,async({page})=>{
  const state=await setup(page,{holdDelete:true,deleteStatus:reply==='500'?500:200,
    deleteReply:reply==='500'?{error:{message:'Generated storage failure'}}:{}});
  const panel=page.getByRole('region',{name:'Enrolled people',exact:true});
  const row=panel.getByRole('listitem').filter({has:page.getByText(person.name,{exact:true})});
  await row.getByRole('button',{name:'Delete',exact:true}).click();
  await row.getByRole('button',{name:`Delete ${person.name}’s face template`,exact:true}).click();
  await expect.poll(()=>Boolean(state.release)).toBe(true);
  state.people=[];state.release();
  await expect(panel).toContainText('could not be confirmed');
  await expect(panel).toContainText('an absent entry alone does not prove');
  await expect(panel).not.toContainText('face template was deleted');
  await panel.getByRole('button',{name:'Refresh saved people',exact:true}).click();
  await expect(panel).toContainText('could not be confirmed');expect(state.posts).toBe(1);
});
