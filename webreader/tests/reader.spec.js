const { test, expect } = require('@playwright/test');

test.describe('comic reader', () => {
  test('shows loading ring while waiting for the page image', async ({ page }) => {
    await page.goto('/libraries/lib-1/comics/comic-1?pin=0', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#loading-ring')).toBeVisible();
    await expect(page.locator('#viewer img')).toHaveCount(0);

    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('#loading-ring')).toHaveCount(0);
  });

  test('keeps toolbar hidden on page turn when unpinned', async ({ page }) => {
    await page.goto('/libraries/lib-1/comics/comic-1?pin=0', { waitUntil: 'domcontentloaded' });

    const toolbar = page.locator('#toolbar');
    const viewer = page.locator('#viewer');

    await expect(toolbar).toHaveCSS('opacity', '0');
    await expect(toolbar).toHaveCSS('height', '0px');
    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });

    const box = await viewer.boundingBox();
    if (!box) throw new Error('Viewer not rendered');

    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.5);
    await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.5);

    await expect(toolbar).toHaveCSS('opacity', '0');
    await expect(toolbar).toHaveCSS('height', '0px');

    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });
    await expect(toolbar).toHaveCSS('opacity', '0');
    await expect(toolbar).toHaveCSS('height', '0px');

    await page.mouse.move(box.x + box.width * 0.83, box.y + box.height * 0.5);
    await expect(toolbar).toHaveCSS('opacity', '0');
    await expect(toolbar).toHaveCSS('height', '0px');

    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await expect(toolbar).toHaveCSS('opacity', '1');
  });

  test('does not auto-reveal toolbar on touch devices', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();

    await page.goto('/libraries/lib-1/comics/comic-1?pin=0', { waitUntil: 'domcontentloaded' });

    const toolbar = page.locator('#toolbar');
    const viewer = page.locator('#viewer');

    await expect(toolbar).toHaveCSS('opacity', '0');
    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });

    const box = await viewer.boundingBox();
    if (!box) throw new Error('Viewer not rendered');

    await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5);

    await expect(toolbar).toHaveCSS('opacity', '0');

    await context.close();
  });
});
