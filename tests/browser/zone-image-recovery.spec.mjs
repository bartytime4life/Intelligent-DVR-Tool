import {test,expect} from '@playwright/test';

async function setup(page) {
  await page.addInitScript(()=>{
    // Hold only completion delivery for generated zone-still transactions.
    // The real browser database remains responsible for transaction ordering.
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(stores,mode,...rest){
      const tx=transaction.call(this,stores,mode,...rest);
      const zone=typeof stores==='string'?stores==='zone-stills':Array.from(stores).includes('zone-stills');
      if(zone&&window.holdGeneratedZoneMode===(mode||'readonly')) {
        window.holdGeneratedZoneMode=null;
        Object.defineProperty(tx,'oncomplete',{configurable:true,set(handler){
          tx.addEventListener('complete',event=>{window.releaseGeneratedZoneTransaction=()=>handler.call(tx,event);},{once:true});
        }});
      }
      return tx;
    };
    const remove=IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete=function(key){
      if(this.name==='zone-stills'&&window.failGeneratedZoneDelete)throw new DOMException('Generated storage refusal','QuotaExceededError');
      return remove.call(this,key);
    };
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
      enumerateDevices:async()=>[],getUserMedia:async()=>{throw Error('No device is allowed in the generated still fixture');},
    }});
  });
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:{message:'No native service exists in this generated fixture'}}}));
  await page.goto('/#zones');
  await expect(page.locator('.zone-editor')).toBeVisible();
}
async function offer(page,name,width=64,height=36) {
  const bytes=await page.evaluate(async({width,height})=>{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');context.fillStyle='#206c76';context.fillRect(0,0,width,height);
    return Array.from(new Uint8Array(await(await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))).arrayBuffer()));
  },{width,height});
  await page.getByLabel('Choose a camera still image',{exact:true}).setInputFiles({name,mimeType:'image/png',buffer:Buffer.from(bytes)});
  await expect(page.locator('.zone-still-offer')).toContainText(name);
}
async function save(page,plan,name,width,height) {
  await offer(page,name,width,height);
  await page.getByRole('button',{name:`Use for Plan ${plan}`,exact:true}).click();
  await expect(page.locator('.zone-still-offer')).toHaveCount(0);
  await expect(page.locator('.zone-editor img.zone-still')).toBeVisible();
  await expect(page.locator('.zone-editor')).toContainText(`${width}×${height}`);
}

test('an older save completing preserves the newer offered image and never changes its destination',async({page})=>{
  await setup(page);await offer(page,'generated-first.png');
  await page.evaluate(()=>{window.holdGeneratedZoneMode='readwrite';});
  await page.getByRole('button',{name:'Use for Plan 1',exact:true}).evaluate(button=>{button.click();button.click();});
  await expect.poll(()=>page.evaluate(()=>Boolean(window.releaseGeneratedZoneTransaction))).toBe(true);
  await expect(page.locator('.zone-still-offer').getByRole('button',{name:'Discard',exact:true})).toBeDisabled();
  await offer(page,'generated-newer.png',80,40);
  await page.getByLabel('Camera for zone',{exact:true}).selectOption('2');
  await page.evaluate(()=>window.releaseGeneratedZoneTransaction());
  await expect(page.locator('.zone-still-offer')).toContainText('generated-newer.png');
  await expect(page.locator('.zone-still-offer')).toContainText('80×40');
  await expect(page.getByRole('button',{name:'Use for Plan 2',exact:true})).toBeEnabled();
  await expect(page.locator('.zone-editor img.zone-still')).toHaveCount(0);
  await page.getByLabel('Camera for zone',{exact:true}).selectOption('1');
  await expect(page.locator('.zone-editor')).toContainText('64×36');
});

test('a delayed plan-image read displays the planning grid instead of pixels from the previous plan',async({page})=>{
  await setup(page);await save(page,1,'generated-plan-1.png',64,36);
  await page.getByLabel('Camera for zone',{exact:true}).selectOption('2');
  await save(page,2,'generated-plan-2.png',80,40);
  await page.getByLabel('Camera for zone',{exact:true}).selectOption('1');
  await expect(page.locator('.zone-editor')).toContainText('64×36');
  await page.evaluate(()=>{window.releaseGeneratedZoneTransaction=null;window.holdGeneratedZoneMode='readonly';});
  await page.getByLabel('Camera for zone',{exact:true}).selectOption('2');
  await expect.poll(()=>page.evaluate(()=>Boolean(window.releaseGeneratedZoneTransaction))).toBe(true);
  await expect(page.locator('.zone-editor img.zone-still')).toHaveCount(0);
  await expect(page.locator('.zone-planning-grid')).toHaveCount(1);
  await expect(page.locator('.zone-editor canvas')).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'Loading camera still for Plan 2'})).toBeVisible();
  await page.evaluate(()=>window.releaseGeneratedZoneTransaction());
  await expect(page.locator('.zone-editor img.zone-still')).toBeVisible();
  await expect(page.locator('.zone-editor')).toContainText('80×40');
});

test('a refused still removal reports the storage error and leaves its saved image available',async({page})=>{
  await setup(page);await save(page,1,'generated-retained.png',64,36);
  await page.evaluate(()=>{window.failGeneratedZoneDelete=true;});
  await page.getByRole('button',{name:'Remove still',exact:true}).click();
  await expect(page.getByText('This browser could not remove the saved still. Its current copy is preserved; check browser storage and try again.',{exact:true})).toBeVisible();
  await expect(page.locator('.zone-editor img.zone-still')).toBeVisible();
  await page.evaluate(()=>{window.failGeneratedZoneDelete=false;});
  await page.getByRole('button',{name:'Remove still',exact:true}).click();
  await expect(page.locator('.zone-editor img.zone-still')).toHaveCount(0);
});
