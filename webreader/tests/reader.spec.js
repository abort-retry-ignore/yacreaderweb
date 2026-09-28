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

  test('can hide the page number overlay', async ({ page }) => {
    await page.goto('/libraries/lib-1/comics/comic-1?overlay=0&pin=1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });

    await page.locator('[data-action="next"]').click();
    await expect(page).toHaveURL(/page=1/);
    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('#loading-ring')).toHaveCount(0);
    await expect(page.locator('#page-overlay')).toHaveText('');
  });

  test('zooms with ctrl + wheel instead of the browser', async ({ page }) => {
    await page.goto('/libraries/lib-1/comics/comic-1?pin=1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });

    await page.evaluate(() => {
      window.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -120,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    await expect(page).toHaveURL(/zoom=110/);
    const scale = await page.evaluate(() => (window.visualViewport && window.visualViewport.scale) || 1);
    expect(scale).toBe(1);
  });

  test('puts the page progress bar in the toolbar', async ({ page }) => {
    await page.goto('/libraries/lib-1/comics/comic-1?pin=1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#toolbar #page-range')).toBeVisible();
    await expect(page.locator('#page-bar')).toHaveCount(0);
  });

  test('jumps to a typed page number', async ({ page }) => {
    await page.goto('/libraries/lib-1/comics/comic-1?pin=1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });

    const input = page.locator('#page-input');
    await input.click();
    await input.fill('2');
    await input.press('Enter');

    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });
    await expect(input).toHaveValue('2');
  });

  test('reverses click zones when rtl=1', async ({ page }) => {
    await page.goto('/libraries/lib-1/comics/comic-1?rtl=1&pin=0', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#viewer img')).toHaveCount(1, { timeout: 5000 });

    const viewer = page.locator('#viewer');
    const box = await viewer.boundingBox();
    if (!box) throw new Error('Viewer not rendered');

    await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.5);
    await expect(page).toHaveURL(/page=1/);
  });

  test('stacks pages in vertical reading mode', async ({ page }) => {
    await page.goto('/libraries/lib-1/comics/comic-1?mode=vertical&pin=1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.v-page')).toHaveCount(3);
    await expect(page.locator('#viewer img')).toHaveCount(3, { timeout: 8000 });

    await page.locator('#viewer').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect.poll(() => page.url()).toMatch(/page=2/);
  });
});
