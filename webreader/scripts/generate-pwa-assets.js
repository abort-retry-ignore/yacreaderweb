const fs = require('node:fs/promises');
const path = require('node:path');
const { PNG } = require('pngjs');

const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const splashDir = path.join(publicDir, 'apple-splash');

const bg = { r: 0x08, g: 0x11, b: 0x0b, a: 255 };
const panel = { r: 0x10, g: 0x23, b: 0x1a, a: 255 };
const accent = { r: 0x5e, g: 0xea, b: 0xd4, a: 255 };
const paper = { r: 0xf8, g: 0xfa, b: 0xfc, a: 255 };
const lime = { r: 0xd9, g: 0xf9, b: 0x9d, a: 255 };
const ink = { r: 0x0f, g: 0x17, b: 0x2a, a: 255 };

function setPixel(png, x, y, color) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const idx = (png.width * y + x) << 2;
  png.data[idx] = color.r;
  png.data[idx + 1] = color.g;
  png.data[idx + 2] = color.b;
  png.data[idx + 3] = color.a;
}

function fillRect(png, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      setPixel(png, xx, yy, color);
    }
  }
}

function fillRoundedRect(png, x, y, w, h, radius, color) {
  const r2 = radius * radius;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const dx = xx < x + radius ? x + radius - xx : xx >= x + w - radius ? xx - (x + w - radius - 1) : 0;
      const dy = yy < y + radius ? y + radius - yy : yy >= y + h - radius ? yy - (y + h - radius - 1) : 0;
      if (dx === 0 || dy === 0 || (dx * dx + dy * dy <= r2)) {
        setPixel(png, xx, yy, color);
      }
    }
  }
}

function drawBrand(png, x, y, size) {
  const outerR = Math.max(8, Math.round(size * 0.12));
  const innerR = Math.max(6, Math.round(size * 0.09));
  const stroke = Math.max(4, Math.round(size * 0.03));
  const panelX = Math.round(x + size * 0.18);
  const panelY = Math.round(y + size * 0.12);
  const panelW = Math.round(size * 0.64);
  const panelH = Math.round(size * 0.76);

  fillRoundedRect(png, panelX, panelY, panelW, panelH, outerR, panel);

  fillRoundedRect(
    png,
    panelX + stroke,
    panelY + stroke,
    panelW - stroke * 2,
    panelH - stroke * 2,
    innerR,
    accent,
  );

  fillRoundedRect(
    png,
    panelX + stroke * 2,
    panelY + stroke * 2,
    Math.round(panelW * 0.54),
    panelH - stroke * 4,
    innerR,
    lime,
  );

  fillRoundedRect(
    png,
    panelX + stroke * 2 + Math.round(panelW * 0.11),
    panelY + stroke * 2 + Math.round(panelH * 0.06),
    Math.round(panelW * 0.28),
    panelH - stroke * 4 - Math.round(panelH * 0.12),
    innerR,
    paper,
  );

  const lineX = panelX + stroke * 2 + Math.round(panelW * 0.15);
  const lineW = Math.round(panelW * 0.2);
  const lineH = Math.max(4, Math.round(size * 0.03));
  const starts = [0.22, 0.36, 0.5, 0.64];
  const widths = [lineW * 0.75, lineW * 1.25, lineW * 1.25, lineW];
  starts.forEach((ratio, index) => {
    fillRoundedRect(
      png,
      lineX,
      panelY + Math.round(panelH * ratio),
      Math.round(widths[index]),
      lineH,
      Math.max(2, Math.round(lineH / 2)),
      ink,
    );
  });
}

async function writePng(filePath, width, height, painter) {
  const png = new PNG({ width, height });
  fillRect(png, 0, 0, width, height, bg);
  painter(png, width, height);
  const buffer = PNG.sync.write(png);
  await fs.writeFile(filePath, buffer);
}

async function main() {
  await fs.mkdir(publicDir, { recursive: true });
  await fs.mkdir(splashDir, { recursive: true });

  await writePng(path.join(publicDir, 'icon-192.png'), 192, 192, (png) => drawBrand(png, 0, 0, 192));
  await writePng(path.join(publicDir, 'icon-512.png'), 512, 512, (png) => drawBrand(png, 0, 0, 512));
  await fs.copyFile(path.join(publicDir, 'icon-192.png'), path.join(publicDir, 'maskable-icon-192.png'));
  await fs.copyFile(path.join(publicDir, 'icon-512.png'), path.join(publicDir, 'maskable-icon-512.png'));
  await writePng(path.join(publicDir, 'apple-touch-icon.png'), 180, 180, (png) => drawBrand(png, 0, 0, 180));

  const splashSizes = [
    [1320, 2868], [2868, 1320], [1290, 2796], [2796, 1290], [1179, 2556], [2556, 1179],
    [1170, 2532], [2532, 1170], [1125, 2436], [2436, 1125], [1242, 2688], [2688, 1242],
    [828, 1792], [1792, 828], [1536, 2048], [2048, 1536], [1668, 2388], [2388, 1668],
    [1640, 2360], [2360, 1640], [2048, 2732], [2732, 2048],
  ];

  for (const [width, height] of splashSizes) {
    const brandSize = Math.round(Math.min(width, height) * 0.36);
    const x = Math.round((width - brandSize) / 2);
    const y = Math.round((height - brandSize) / 2);
    await writePng(path.join(splashDir, `${width}x${height}.png`), width, height, (png) => drawBrand(png, x, y, brandSize));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
