const { test, expect } = require('@playwright/test');

test.describe('library shell', () => {
  test('renders library search results from upstream search API', async ({ page }) => {
    await page.goto('/libraries/lib-1/folders/1?q=batman', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Mock Library' })).toBeVisible();
    await expect(page.locator('input[name="q"][value="batman"]')).toBeVisible();
    await expect(page.getByText('Search results for “batman”')).toBeVisible();
    await expect(page.locator('.folder-tile .tile-title', { hasText: 'Batman' })).toBeVisible();
    await expect(page.locator('.comic-tile .tile-title', { hasText: 'Batman Year One' })).toBeVisible();
  });

  test('uses Escape to move up comic, folder, library, then stops at root', async ({ page }) => {
    await page.goto('/libraries/lib-1/comics/comic-1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/libraries\/lib-1\/folders\/2$/);
    await expect(page.getByRole('heading', { name: 'Mock Library' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/libraries\/lib-1\/folders\/1$/);

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/$/);

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('comic reader', () => {
  test('resumes saved page by default and allows opt-out', async ({ page }) => {
    await page.goto('/libraries/lib-1/comics/comic-1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });

    await page.evaluate(() => {
      localStorage.setItem('yacreaderweb_progress_lib-1_comic-1', JSON.stringify({ page: 2, spread: false, zoom: 100 }));
    });

    await page.goto('/libraries/lib-1/comics/comic-1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });
    await expect(page).toHaveURL(/\?page=2(&|$)/);

    await page.goto('/libraries/lib-1/comics/comic-1?resume=0', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });
    await expect(page).toHaveURL(/\?resume=0&page=0(&|$)/);
  });

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
    const toolbarToggle = page.locator('#toolbar-toggle');
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
    await expect(toolbar).toHaveCSS('opacity', '0');
    await expect(toolbar).toHaveCSS('height', '0px');

    await expect(toolbarToggle).toBeVisible();
    await toolbarToggle.click();
    await expect(toolbar).toHaveCSS('opacity', '1');
    await expect(toolbar).not.toHaveCSS('height', '0px');
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
