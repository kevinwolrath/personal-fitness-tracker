import { expect,test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { openAt, MONDAY } from './helpers';
test('approved favicon loads and functional shell icons retain accessible navigation',async({page})=>{
  await openAt(page,MONDAY);
  const icon=page.locator('link[rel*="icon"]').first();
  await expect(icon).toHaveAttribute('href',/favicon/);
  const href=await icon.getAttribute('href');
  expect((await page.request.get(href!)).ok()).toBe(true);
  await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeVisible();
  const width=page.viewportSize()!.width;const dir='docs/design/issue-106-branding';mkdirSync(dir,{recursive:true});
  await page.screenshot({path:`${dir}/${width}-today.png`,scale:'css'});
  await page.getByTestId('tab-progress').click();await expect(page.getByTestId('progress-summary')).toBeVisible();
  await page.screenshot({path:`${dir}/${width}-progress.png`,scale:'css'});
  await page.getByTestId('tab-today').click();await expect(page.getByTestId('day-progress')).toBeVisible();
});
