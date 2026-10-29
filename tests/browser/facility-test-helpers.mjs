export const savedFacilities = page => page.evaluate(() => {
  const raw=localStorage.getItem('dvr.facilities.v1');
  return raw ? JSON.parse(raw) : null;
});
export const savedPlan = page => page.evaluate(() => {
  const raw=localStorage.getItem('dvr.facilities.v1');
  if(!raw)return null;
  const library=JSON.parse(raw);
  return library.facilities.find(item=>item.id===library.activeId)?.plan || null;
});
export async function openExample(page) {
  const example=page.getByRole('button',{name:'Open example facility',exact:true});
  if(!await example.isVisible())await page.getByText('Backup & examples',{exact:true}).click();
  await example.click();
}
