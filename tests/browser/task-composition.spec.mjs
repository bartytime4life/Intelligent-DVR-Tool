import {test, expect} from '@playwright/test';

test('task search composition commits text before Enter or arrow keys can select a destination', async ({page}) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({status:503, json:{error:{message:'No service in generated composition test'}}});
    return route.continue();
  });
  await page.goto('/#settings'); await page.getByRole('button', {name:'Find a task', exact:true}).click();
  const finder = page.getByRole('dialog', {name:'Find a task', exact:true}), input = finder.getByRole('combobox', {name:'Search tasks'});
  await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', isComposing:true, bubbles:true, cancelable:true})));
  await expect(finder.getByRole('option', {selected:true})).toContainText('Watch cameras');
  await input.fill('review observations');
  await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', isComposing:true, bubbles:true, cancelable:true})));
  await expect(finder).toBeVisible(); await expect(page).toHaveURL(/#settings$/);
  await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', keyCode:229, bubbles:true, cancelable:true})));
  await expect(finder).toBeVisible(); await expect(page).toHaveURL(/#settings$/);
  await input.press('Enter'); await expect(finder).toHaveCount(0);
  await expect(page).toHaveURL(/#events$/);
});
