import {expect} from '@playwright/test';

async function waitForFacilitySave(page,{waitForSave=true}={}) {
  if(!waitForSave)return;
  const status=page.locator('.facility-library-save');
  // Saving now waits for a shared browser lock. Read storage after its public
  // status settles; failures/conflicts still expose the last committed version.
  // Reads after leaving Facility have no status, and focus mode may hide it.
  if(await status.count())await expect(status).toHaveText(/^(Saved in this browser|Memory only)/);
}

export const savedFacilities = async(page,options) => {
  await waitForFacilitySave(page,options);
  return page.evaluate(() => {
  const raw=localStorage.getItem('dvr.facilities.v1');
  return raw ? JSON.parse(raw) : null;
  });
};
export const savedPlan = async(page,options) => {
  await waitForFacilitySave(page,options);
  return page.evaluate(() => {
  const raw=localStorage.getItem('dvr.facilities.v1');
  if(!raw)return null;
  const library=JSON.parse(raw);
  return library.facilities.find(item=>item.id===library.activeId)?.plan || null;
  });
};
export async function openExample(page) {
  const example=page.getByRole('button',{name:'Open example facility',exact:true});
  if(!await example.isVisible())await page.getByText('Backup & examples',{exact:true}).click();
  await example.click();
}
