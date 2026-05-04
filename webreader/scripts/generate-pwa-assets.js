const fs = require('node:fs/promises');
const path = require('node:path');
const { PNG } = require('pngjs');

const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const splashDir = path.join(publicDir, 'apple-splash');

const bg = { r: 0x08, g: 0x11, b: 0x0b, a: 255 };
const horn = { r: 0x63, g: 0x5d, b: 0x58, a: 255 };
const coat = { r: 0xf2, g: 0xeb, b: 0xdc, a: 255 };
const shadow = { r: 0xd9, g: 0xcf, b: 0xbd, a: 255 };
const muzzle = { r: 0xe8, g: 0xd9, b: 0xcf, a: 255 };
const nose = { r: 0xb8, g: 0xa1, b: 0x9d, a: 255 };
const eye = { r: 0x1a, g: 0x12, b: 0x10, a: 255 };

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

function fillEllipse(png, cx, cy, rx, ry, color) {
  for (let yy = Math.floor(cy - ry); yy <= Math.ceil(cy + ry); yy++) {
    for (let xx = Math.floor(cx - rx); xx <= Math.ceil(cx + rx); xx++) {
      const dx = (xx - cx) / rx;
      const dy = (yy - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPixel(png, xx, yy, color);
    }
  }
}

function fillTriangle(png, ax, ay, bx, by, cx, cy, color) {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0) return;
  for (let yy = minY; yy <= maxY; yy++) {
    for (let xx = minX; xx <= maxX; xx++) {
      const w1 = ((bx - xx) * (cy - yy) - (by - yy) * (cx - xx)) / area;
      const w2 = ((cx - xx) * (ay - yy) - (cy - yy) * (ax - xx)) / area;
      const w3 = ((ax - xx) * (by - yy) - (ay - yy) * (bx - xx)) / area;
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) setPixel(png, xx, yy, color);
    }
  }
}

function strokeArc(png, cx, cy, rx, ry, start, end, thickness, color) {
  const half = thickness / 2;
  for (let yy = Math.floor(cy - ry - thickness); yy <= Math.ceil(cy + ry + thickness); yy++) {
    for (let xx = Math.floor(cx - rx - thickness); xx <= Math.ceil(cx + rx + thickness); xx++) {
      const dx = xx - cx;
      const dy = yy - cy;
      const dist = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
      if (dist < 1 - half / Math.max(rx, ry) || dist > 1 + half / Math.max(rx, ry)) continue;
      let angle = Math.atan2(dy, dx);
      if (angle < 0) angle += Math.PI * 2;
      let normStart = start;
      let normEnd = end;
      if (normStart < 0) normStart += Math.PI * 2;
      if (normEnd < 0) normEnd += Math.PI * 2;
      const inRange = normStart <= normEnd
        ? angle >= normStart && angle <= normEnd
        : angle >= normStart || angle <= normEnd;
      if (inRange) setPixel(png, xx, yy, color);
    }
  }
}

function drawYakMark(png, x, y, size) {
  const cx = x + size * 0.5;
  const headY = y + size * 0.56;

  strokeArc(png, cx - size * 0.21, y + size * 0.31, size * 0.18, size * 0.18, Math.PI * 0.82, Math.PI * 1.76, size * 0.05, horn);
  strokeArc(png, cx + size * 0.21, y + size * 0.31, size * 0.18, size * 0.18, Math.PI * 1.24, Math.PI * 0.18, size * 0.05, horn);

  fillTriangle(png, cx - size * 0.18, headY - size * 0.16, cx - size * 0.29, headY - size * 0.02, cx - size * 0.12, headY - size * 0.03, shadow);
  fillTriangle(png, cx + size * 0.18, headY - size * 0.16, cx + size * 0.29, headY - size * 0.02, cx + size * 0.12, headY - size * 0.03, shadow);

  fillEllipse(png, cx, headY, size * 0.23, size * 0.26, coat);
  fillEllipse(png, cx, headY - size * 0.1, size * 0.18, size * 0.14, coat);

  fillEllipse(png, cx - size * 0.1, headY - size * 0.12, size * 0.08, size * 0.11, shadow);
  fillEllipse(png, cx + size * 0.1, headY - size * 0.12, size * 0.08, size * 0.11, shadow);
  fillEllipse(png, cx, headY - size * 0.05, size * 0.19, size * 0.15, coat);
  fillEllipse(png, cx, headY + size * 0.08, size * 0.14, size * 0.11, muzzle);

  fillEllipse(png, cx - size * 0.08, headY - size * 0.03, size * 0.018, size * 0.024, eye);
  fillEllipse(png, cx + size * 0.08, headY - size * 0.03, size * 0.018, size * 0.024, eye);
  fillEllipse(png, cx - size * 0.045, headY + size * 0.1, size * 0.022, size * 0.015, nose);
  fillEllipse(png, cx + size * 0.045, headY + size * 0.1, size * 0.022, size * 0.015, nose);

  fillEllipse(png, cx, y + size * 0.79, size * 0.19, size * 0.09, coat);
  fillEllipse(png, cx - size * 0.11, y + size * 0.82, size * 0.055, size * 0.08, shadow);
  fillEllipse(png, cx + size * 0.11, y + size * 0.82, size * 0.055, size * 0.08, shadow);
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

  await writePng(path.join(publicDir, 'icon-192.png'), 192, 192, (png) => drawYakMark(png, 0, 0, 192));
  await writePng(path.join(publicDir, 'icon-512.png'), 512, 512, (png) => drawYakMark(png, 0, 0, 512));
  await fs.copyFile(path.join(publicDir, 'icon-192.png'), path.join(publicDir, 'maskable-icon-192.png'));
  await fs.copyFile(path.join(publicDir, 'icon-512.png'), path.join(publicDir, 'maskable-icon-512.png'));
  await writePng(path.join(publicDir, 'apple-touch-icon.png'), 180, 180, (png) => drawYakMark(png, 0, 0, 180));

  const splashSizes = [
    [1320, 2868], [2868, 1320], [1290, 2796], [2796, 1290], [1179, 2556], [2556, 1179],
    [1170, 2532], [2532, 1170], [1125, 2436], [2436, 1125], [1242, 2688], [2688, 1242],
    [828, 1792], [1792, 828], [1536, 2048], [2048, 1536], [1668, 2388], [2388, 1668],
    [1640, 2360], [2360, 1640], [2048, 2732], [2732, 2048],
  ];

  for (const [width, height] of splashSizes) {
      const brandSize = Math.round(Math.min(width, height) * 0.34);
      const x = Math.round((width - brandSize) / 2);
      const y = Math.round((height - brandSize) / 2);
      await writePng(path.join(splashDir, `${width}x${height}.png`), width, height, (png) => drawYakMark(png, x, y, brandSize));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
