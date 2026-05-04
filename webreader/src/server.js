const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');
const crypto = require('node:crypto');
const JSZip = require('jszip');

const PORT = Number.parseInt(process.env.WEBREADER_PORT || '3000', 10);
const YACR_SERVER_URL = process.env.YACR_SERVER_URL || 'http://localhost:60000';
const DEBUG = process.env.WEBREADER_DEBUG === '1';
const ROOT_FOLDER_ID = '1';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

const APPLE_SPLASH_LINKS = [
  ['1320x2868.png', 'screen and (device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
  ['2868x1320.png', 'screen and (device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
  ['1290x2796.png', 'screen and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
  ['2796x1290.png', 'screen and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
  ['1179x2556.png', 'screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
  ['2556x1179.png', 'screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
  ['1170x2532.png', 'screen and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
  ['2532x1170.png', 'screen and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
  ['1125x2436.png', 'screen and (device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
  ['2436x1125.png', 'screen and (device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
  ['1242x2688.png', 'screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
  ['2688x1242.png', 'screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'],
  ['828x1792.png', 'screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
  ['1792x828.png', 'screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
  ['1536x2048.png', 'screen and (device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
  ['2048x1536.png', 'screen and (device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
  ['1668x2388.png', 'screen and (device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
  ['2388x1668.png', 'screen and (device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
  ['1640x2360.png', 'screen and (device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
  ['2360x1640.png', 'screen and (device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
  ['2048x2732.png', 'screen and (device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
  ['2732x2048.png', 'screen and (device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)'],
].map(([fileName, media]) => `<link rel="apple-touch-startup-image" href="/apple-splash/${fileName}" media="${media}" />`).join('\n  ');

const STATIC_CONTENT_TYPES = {
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function pageHead(title, themeColor = '#08110b') {
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="${themeColor}">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="YACReaderWeb">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  ${APPLE_SPLASH_LINKS}
  <title>${title}</title>`;
}

function renderComicReaderShell({ title, backUrl, pageLabel, toolbarShown, toolbarPinned, zoom, spread, debug }) {
  const overlayFontSize = Math.max(128, Math.min(360, 240));
  return `
      <div style="display:flex;flex-direction:column;height:100vh;background:#000;overflow:hidden">
        <div id="toolbar" style="position:fixed;top:0;left:0;right:0;height:${toolbarShown ? '36px' : '0'};opacity:${toolbarShown ? '1' : '0'};overflow:hidden;z-index:19;transition:height 160ms ease, opacity 200ms ease;background:var(--reader-toolbar-bg);border-bottom:${toolbarShown ? '1px solid var(--reader-toolbar-border)' : 'none'};display:flex;align-items:center;padding:${toolbarShown ? '0 8px' : '0'};gap:8px;font-size:12px;pointer-events:${toolbarShown ? 'auto' : 'none'};backdrop-filter:blur(12px);">
          ${toolbarShown ? `<a href="${backUrl}" style="background:var(--reader-button-secondary-bg);color:var(--reader-button-text);border:none;padding:3px 8px;border-radius:4px;font-size:11px;text-decoration:none;display:inline-block;">← Back</a>` : ''}
          ${toolbarShown ? `<div style="flex:1;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</div>` : ''}
          ${toolbarShown ? `<button data-action="prev" style="background:var(--reader-button-secondary-bg);color:var(--reader-button-text);border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">◀</button>` : ''}
          ${toolbarShown ? `<span style="min-width:90px;text-align:center;color:var(--reader-text-dim);font-size:13px;">${pageLabel}</span>` : ''}
          ${toolbarShown ? `<button data-action="next" style="background:var(--reader-button-secondary-bg);color:var(--reader-button-text);border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">▶</button>` : ''}
          ${toolbarShown ? `<button data-action="spread" style="background:var(--reader-button-bg);color:var(--reader-button-text);border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">${spread ? 'Spread' : 'Single'}</button>` : ''}
          ${toolbarShown ? `<button data-action="fit" style="background:var(--reader-button-bg);color:var(--reader-button-text);border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">${zoom > 100 ? 'Fit Width' : 'Fit Screen'}</button>` : ''}
          ${toolbarShown ? `<button data-action="pin" style="background:${toolbarPinned ? 'var(--reader-button-active-bg)' : 'var(--reader-button-secondary-bg)'};color:var(--reader-button-text);border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;min-width:28px;">${toolbarPinned ? '📌' : '📍'}</button>` : ''}
        </div>

        <div id="viewer" style="position:relative;flex:1;overflow:${zoom > 100 ? 'auto' : 'hidden'};background:#000;display:flex;align-items:${zoom > 100 ? 'flex-start' : 'center'};justify-content:center;cursor:pointer;min-height:0;">
          <div id="side-arrow-left" style="position:absolute;left:16px;top:50%;transform:translateY(-50%);pointer-events:none;z-index:8;color:rgba(255,255,255,0.42);opacity:0.42;transition:opacity 200ms ease;text-shadow:0 10px 30px rgba(0,0,0,0.72);font-size:min(14vw,88px);font-weight:800;line-height:1;">&lt;</div>
          <div id="side-arrow-right" style="position:absolute;right:16px;top:50%;transform:translateY(-50%);pointer-events:none;z-index:8;color:rgba(255,255,255,0.42);opacity:0.42;transition:opacity 200ms ease;text-shadow:0 10px 30px rgba(0,0,0,0.72);font-size:min(14vw,88px);font-weight:800;line-height:1;">&gt;</div>
          <div style="display:flex;align-items:center;justify-content:center;min-width:${zoom > 100 ? 'max-content' : '100%'};min-height:${zoom > 100 ? 'max-content' : '100%'};padding:16px;"></div>
        </div>

        <div id="page-overlay" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9;opacity:0;transition:opacity 500ms ease, background 200ms ease;background:transparent;color:rgba(255,255,255,0.68);text-shadow:0 10px 30px rgba(0,0,0,0.7);font-size:${overlayFontSize}px;font-weight:800;letter-spacing:-0.05em;"></div>

        <div id="zoom-controls" style="position:fixed;right:12px;top:50%;transform:translateY(-50%);z-index:10;display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px 8px;border-radius:999px;background:var(--reader-chrome-bg);border:1px solid var(--reader-toolbar-border);box-shadow:0 12px 30px rgba(0,0,0,0.35);opacity:0.8;transition:opacity 200ms ease;backdrop-filter:blur(12px);">
          <button id="zoom-in" style="width:30px;height:30px;padding:0;border-radius:999px;background:var(--reader-button-secondary-bg);color:var(--reader-button-text);border:none;cursor:pointer;font-size:16px;line-height:1;">+</button>
          <input id="zoom-range" type="range" min="100" max="300" step="10" value="${zoom}" style="writing-mode:vertical-lr;direction:rtl;width:28px;height:180px;accent-color:var(--reader-range-accent);">
          <div style="min-width:42px;text-align:center;color:var(--reader-text-dim);font-size:11px;">${zoom}%</div>
          <button id="zoom-out" style="width:30px;height:30px;padding:0;border-radius:999px;background:var(--reader-button-secondary-bg);color:var(--reader-button-text);border:none;cursor:pointer;font-size:16px;line-height:1;">−</button>
        </div>

        ${!toolbarShown ? `<button id="toolbar-toggle" style="position:fixed;top:0;left:50%;transform:translateX(-50%);min-width:112px;height:32px;padding:0 18px 8px;border:none;border-radius:0 0 14px 14px;border-bottom:1px solid var(--reader-toolbar-border);border-left:1px solid var(--reader-toolbar-border);border-right:1px solid var(--reader-toolbar-border);background:var(--reader-chrome-bg-soft);color:var(--reader-text-dim);z-index:20;font-size:11px;font-weight:500;letter-spacing:0.04em;line-height:1;opacity:0.8;backdrop-filter:blur(12px);">▼ menu</button>` : ''}
      </div>`;
}

async function serveStaticAsset(res, assetPath) {
  const normalized = path.normalize(assetPath).replace(/^\.+[\/\\]/, '');
  const fullPath = path.join(PUBLIC_DIR, normalized);
  const shouldBypassCache = normalized === 'comic-reader.js' || normalized === 'service-worker.js' || normalized === 'manifest.webmanifest';

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }

  try {
    const body = await fs.readFile(fullPath);
    const ext = path.extname(fullPath);
    res.writeHead(200, {
      'Content-Type': STATIC_CONTENT_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': shouldBypassCache ? 'no-store, max-age=0' : 'public, max-age=3600'
    });
    res.end(body);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Failed to load asset: ${error.message}`);
    return true;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getRequestId(req, res) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)webreader_request_id=([^;]+)/);

  if (match) {
    return decodeURIComponent(match[1]);
  }

  const requestId = crypto.randomUUID();
  res.setHeader('Set-Cookie', `webreader_request_id=${encodeURIComponent(requestId)}; Path=/; HttpOnly; SameSite=Lax`);
  return requestId;
}

async function fetchJson(pathname, requestId, options = {}) {
  const url = new URL(pathname, YACR_SERVER_URL);
  const headers = {
    'x-request-id': requestId,
    accept: 'application/json',
    ...(options.headers || {})
  };
  let response;

  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body
    });
  } catch (error) {
    throw new Error(`Could not reach upstream ${url.origin}: ${error.message}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Upstream request failed: ${response.status} ${response.statusText}${body ? ` - ${body.slice(0, 200)}` : ''}`);
  }

  return response.json();
}

function getCoverFileName(item) {
  if (!item || !item.library_id) {
    return null;
  }

  if (item.type === 'comic' && item.hash) {
    return `${item.hash}.jpg`;
  }

  if (item.type === 'folder') {
    if (item.custom_image) {
      return item.custom_image;
    }

    if (item.first_comic_hash) {
      return `${item.first_comic_hash}.jpg`;
    }
  }

  return null;
}

function getCoverUrl(item) {
  const fileName = getCoverFileName(item);
  if (!fileName) {
    return null;
  }

  return `/covers/${encodeURIComponent(item.library_id)}/${fileName.split('/').map(encodeURIComponent).join('/')}`;
}

function getComicDownloadUrl(item) {
  if (!item || !item.library_id || !item.id) {
    return null;
  }

  return `/libraries/${encodeURIComponent(item.library_id)}/comics/${encodeURIComponent(item.id)}/download`;
}

const WEB_THEMES = {
  matrix: {
    themeColor: '#08110b', bg: '#080c08', panel: '#0d140d', card: '#101811', cardHover: '#152119', text: '#e8fbe8', textDim: '#6a9a6a', accent: '#32ff70', border: 'rgba(50,255,112,0.14)', shadow: 'rgba(0,0,0,0.28)',
  },
  'matrix-blue': {
    themeColor: '#071019', bg: '#06090d', panel: '#0b1220', card: '#09101a', cardHover: '#122031', text: '#e6f5ff', textDim: '#6b91aa', accent: '#54acff', border: 'rgba(84,172,255,0.14)', shadow: 'rgba(0,0,0,0.25)',
  },
  'matrix-purple': {
    themeColor: '#100815', bg: '#09070d', panel: '#130d1d', card: '#100a18', cardHover: '#1a1128', text: '#f5e9ff', textDim: '#9a72b4', accent: '#b85cff', border: 'rgba(184,92,255,0.14)', shadow: 'rgba(0,0,0,0.25)',
  },
  'matrix-amber': {
    themeColor: '#130d06', bg: '#0d0a05', panel: '#1a1309', card: '#151007', cardHover: '#21170b', text: '#fff5dd', textDim: '#b39355', accent: '#ffbf40', border: 'rgba(255,191,64,0.14)', shadow: 'rgba(0,0,0,0.25)',
  },
  'matrix-orange': {
    themeColor: '#140a06', bg: '#0d0805', panel: '#1b1009', card: '#160d07', cardHover: '#22130c', text: '#fff0e6', textDim: '#b98465', accent: '#ff8a3d', border: 'rgba(255,138,61,0.14)', shadow: 'rgba(0,0,0,0.25)',
  },
  'dark-grey': {
    themeColor: '#0b0b0b', bg: '#090909', panel: '#141414', card: '#101010', cardHover: '#191919', text: '#ededed', textDim: '#9a9a9a', accent: '#b8b8b8', border: 'rgba(255,255,255,0.12)', shadow: 'rgba(0,0,0,0.25)',
  },
  'dark-red': {
    themeColor: '#0d0708', bg: '#0b0607', panel: '#170d0e', card: '#130b0c', cardHover: '#1d1113', text: '#f0e0dc', textDim: '#b07070', accent: '#e05555', border: 'rgba(220,80,70,0.16)', shadow: 'rgba(0,0,0,0.3)',
  },
  nord: {
    themeColor: '#2e3440', bg: '#2e3440', panel: '#3b4252', card: '#434c5e', cardHover: '#4c566a', text: '#eceff4', textDim: '#a7b1c2', accent: '#88c0d0', border: 'rgba(136,192,208,0.2)', shadow: 'rgba(0,0,0,0.25)',
  },
  dark: {
    themeColor: '#1d2024', bg: '#1d2024', panel: '#263238', card: '#2c3540', cardHover: '#33404d', text: '#dbe5ec', textDim: '#8a9baa', accent: '#6c9eff', border: 'rgba(255,255,255,0.08)', shadow: 'rgba(0,0,0,0.24)',
  },
  light: {
    themeColor: '#f0f4f8', bg: '#edf2f7', panel: '#f8fafc', card: '#ffffff', cardHover: '#f5f7fb', text: '#22303c', textDim: '#5f7082', accent: '#0066cc', border: 'rgba(15,23,42,0.08)', shadow: 'rgba(15,23,42,0.08)',
  },
  dracula: {
    themeColor: '#282a36', bg: '#282a36', panel: '#303341', card: '#363a49', cardHover: '#414558', text: '#f8f8f2', textDim: '#b6bac6', accent: '#8be9fd', border: 'rgba(139,233,253,0.14)', shadow: 'rgba(0,0,0,0.28)',
  },
  'oled-dark': {
    themeColor: '#000000', bg: '#000000', panel: '#0f2051', card: '#0b0b0b', cardHover: '#141414', text: '#dddddd', textDim: '#777777', accent: '#788bc3', border: '#3d444e', shadow: 'rgba(0,0,0,0.35)',
  },
  'solarized-light': {
    themeColor: '#fdf6e3', bg: '#fdf6e3', panel: '#eee8d5', card: '#fdf6e3', cardHover: '#eee8d5', text: '#657b83', textDim: '#839496', accent: '#268bd2', border: '#eee8d5', shadow: 'rgba(0,43,54,0.18)',
  },
  'solarized-dark': {
    themeColor: '#002b36', bg: '#002b36', panel: '#073642', card: '#002b36', cardHover: '#073642', text: '#839496', textDim: '#657b83', accent: '#268bd2', border: '#586e75', shadow: 'rgba(0,0,0,0.28)',
  },
  'aritim-dark': {
    themeColor: '#10151a', bg: '#10151a', panel: '#141a21', card: '#141a21', cardHover: '#1b2430', text: '#d3dae3', textDim: '#666a73', accent: '#5a95c5', border: '#141a21', shadow: 'rgba(0,0,0,0.34)',
  },
};

const WEB_THEME_ALIASES = {
  amber: 'matrix-amber',
  oled: 'oled-dark',
};

function normalizeTheme(theme) {
  const resolved = WEB_THEME_ALIASES[theme] || theme;
  return WEB_THEMES[resolved] ? resolved : 'matrix';
}

const WEB_THEME_OPTIONS = [
  ['matrix', 'Matrix'],
  ['matrix-blue', 'Matrix Blue'],
  ['matrix-purple', 'Matrix Purple'],
  ['matrix-amber', 'Matrix Amber'],
  ['matrix-orange', 'Matrix Orange'],
  ['dark-grey', 'Dark Grey'],
  ['dark-red', 'Dark Red'],
  ['nord', 'Nord'],
  ['dark', 'Dark'],
  ['light', 'Light'],
  ['dracula', 'Dracula'],
  ['oled-dark', 'OLED Dark'],
  ['solarized-light', 'Solarized Light'],
  ['solarized-dark', 'Solarized Dark'],
  ['aritim-dark', 'Aritim Dark'],
];

function renderLibraryStats(stats) {
  if (typeof stats.folders === 'number') return `${stats.folders} folders`;
  return '';
}

function renderThemePicker(theme) {
  const activeTheme = normalizeTheme(theme);
  return `<label class="theme-control"><span>Theme</span><select data-theme-picker>${WEB_THEME_OPTIONS.map(([value, label]) => `<option value="${value}"${activeTheme === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
}

function renderThemeCss() {
  return Object.entries(WEB_THEMES).map(([name, colors]) => `body.theme-${name}, html.theme-${name} { --theme-color:${colors.themeColor}; --bg:${colors.bg}; --bg-panel:${colors.panel}; --bg-card:${colors.card}; --bg-card-hover:${colors.cardHover}; --text:${colors.text}; --text-dim:${colors.textDim}; --accent:${colors.accent}; --border:${colors.border}; --shadow:${colors.shadow}; --reader-toolbar-bg:color-mix(in srgb, ${colors.panel} 92%, transparent); --reader-chrome-bg:color-mix(in srgb, ${colors.panel} 86%, transparent); --reader-chrome-bg-soft:color-mix(in srgb, ${colors.panel} 80%, transparent); --reader-button-bg:color-mix(in srgb, ${colors.cardHover} 84%, ${colors.accent} 16%); --reader-button-secondary-bg:color-mix(in srgb, ${colors.card} 84%, ${colors.accent} 16%); --reader-button-active-bg:color-mix(in srgb, ${colors.accent} 70%, ${colors.card} 30%); --reader-button-text:${colors.text}; --reader-toolbar-border:${colors.border}; --reader-text-dim:${colors.textDim}; --reader-range-accent:${colors.accent}; color-scheme:${name === 'light' ? 'light' : 'dark'}; }`).join('\n');
}

function renderSearchForm(selectedLibrary, searchQuery) {
  if (!selectedLibrary) {
    return '';
  }

  const action = `/libraries/${encodeURIComponent(selectedLibrary.id)}/folders/${encodeURIComponent(ROOT_FOLDER_ID)}`;
  return `<form class="search-form" action="${action}" method="get"><input class="search-input" type="search" name="q" value="${escapeHtml(searchQuery || '')}" placeholder="Search this library" aria-label="Search this library"><button class="search-button" type="submit">Search</button>${searchQuery ? `<a class="search-clear" href="${action}">Clear</a>` : ''}</form>`;
}

function pageTemplate({ libraries, selectedLibrary, items, currentFolderId, breadcrumbs, error, libraryStatsById = {}, theme = 'matrix', searchQuery = '', searchResults = false, escapeUrl = null }) {
  const activeTheme = normalizeTheme(theme);
  const libraryLinks = libraries.map((library) => {
    const isActive = selectedLibrary && String(selectedLibrary.id) === String(library.id);
    return `<li><a href="/libraries/${encodeURIComponent(library.id)}/folders/${encodeURIComponent(ROOT_FOLDER_ID)}"${isActive ? ' aria-current="page"' : ''}>${escapeHtml(library.name)}</a></li>`;
  }).join('');

  const libraryCards = libraries.map((library) => {
    const stats = libraryStatsById[String(library.id)] || null;
    const statsText = stats ? renderLibraryStats(stats) : '';
    const coverUrl = getCoverUrl({ ...library, type: 'folder' });
    return `
      <a class="library-card" href="/libraries/${encodeURIComponent(library.id)}/folders/${encodeURIComponent(ROOT_FOLDER_ID)}">
        <div class="library-card-media">${coverUrl ? `<img class="library-card-cover" src="${coverUrl}" alt="" loading="lazy">` : `<div class="library-card-cover library-card-placeholder" aria-hidden="true">${escapeHtml((library.name || 'Library').slice(0, 1).toUpperCase())}</div>`}</div>
        <div class="library-card-body">
          <div class="library-card-title">${escapeHtml(library.name || 'Unnamed library')}</div>
          <div class="library-card-meta">${statsText || 'Open library root'}</div>
        </div>
      </a>`;
  }).join('');

  const contentTiles = items.map((item) => {
    const coverUrl = getCoverUrl(item);
    const thumbnail = coverUrl
      ? `<img class="tile-cover" src="${coverUrl}" alt="" loading="lazy">`
      : `<div class="tile-cover tile-placeholder" aria-hidden="true">${item.type === 'folder' ? 'Folder' : 'Comic'}</div>`;

    if (item.type === 'folder') {
      return `
        <a class="content-tile folder-tile" href="/libraries/${encodeURIComponent(item.library_id)}/folders/${encodeURIComponent(item.id)}">
          <div class="tile-media">${thumbnail}</div>
          <div class="tile-body">
            <div class="tile-title">${escapeHtml(item.folder_name || 'Unnamed folder')}</div>
            <div class="tile-meta">${escapeHtml(String(item.num_children ?? 0))} items</div>
          </div>
        </a>`;
    }

    const readerLink = `/libraries/${encodeURIComponent(item.library_id)}/comics/${encodeURIComponent(item.id)}`;
    const downloadLink = getComicDownloadUrl(item);
    return `
      <article class="content-tile comic-tile">
        <a class="tile-media" href="${readerLink}">${thumbnail}</a>
        <div class="tile-body">
          <a class="tile-title" href="${readerLink}">${escapeHtml(item.title || item.file_name || 'Untitled comic')}</a>
          <div class="tile-meta">${escapeHtml(item.file_name || '')}</div>
          <div class="tile-actions">
            <a class="action action-secondary" href="${downloadLink}">Download</a>
            <a class="action" href="${readerLink}">Read</a>
          </div>
        </div>
      </article>`;
  }).join('');

  const breadcrumbHtml = breadcrumbs && breadcrumbs.length > 0
    ? `<nav class="breadcrumbs">${breadcrumbs.map((crumb) => crumb.link ? `<a href="${crumb.link}">${escapeHtml(crumb.label)}</a>` : `<span>${escapeHtml(crumb.label)}</span>`).join(' <span class="sep">›</span> ')}</nav>`
    : '';
  const searchForm = renderSearchForm(selectedLibrary, searchQuery);
  const selectedLibrarySectionLabel = searchResults ? `Search results${searchQuery ? ` for “${escapeHtml(searchQuery)}”` : ''}` : 'Library contents';
  const selectedLibraryHint = searchResults
    ? (items.length > 0 ? `${items.length} matches across folders and comics.` : 'No matches found in this library.')
    : 'Browse folders and comics in a responsive cover grid.';

  return `<!doctype html>
<html lang="en">
  <head>
    ${pageHead('YACReaderWeb', WEB_THEMES[activeTheme].themeColor)}
    <style>
      :root { font-family: system-ui, sans-serif; color-scheme: dark; }
      body { margin: 0; background: var(--bg); color: var(--text); transition: background 160ms ease, color 160ms ease; }
      ${renderThemeCss()}
      * { box-sizing: border-box; }
      a { color: inherit; text-decoration: none; }
      .shell { min-height: 100vh; display: grid; grid-template-columns: 280px 1fr; }
      .shell-sidebar { background: linear-gradient(180deg, var(--bg-panel), color-mix(in srgb, var(--bg-panel) 86%, var(--bg) 14%)); border-right: 1px solid var(--border); padding: 20px; }
      .shell-main { padding: 24px; }
      .brand { margin: 0 0 8px; font-size: 28px; line-height: 1.05; }
      .brand-copy { margin: 0 0 20px; color: var(--text-dim); }
      .theme-control { display:flex; flex-direction:column; gap:6px; margin-bottom:20px; color: var(--text-dim); font-size:13px; }
      .theme-control select { border:1px solid var(--border); background: var(--bg-card); color: var(--text); border-radius: 12px; padding: 10px 12px; }
      .library-nav-title { font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color: var(--text-dim); margin: 0 0 10px; }
      .library-nav { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:8px; }
      .library-nav a { display:block; padding:10px 12px; border-radius: 12px; color: var(--text-dim); background: transparent; border: 1px solid transparent; }
      .library-nav a[aria-current="page"] { color: var(--text); background: var(--bg-card); border-color: var(--border); }
      .library-nav a:hover { background: var(--bg-card); color: var(--text); }
      .hero { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:24px; }
      .hero h2 { margin:0 0 6px; font-size: clamp(28px, 4vw, 44px); line-height:1; }
      .hero p { margin:0; color: var(--text-dim); max-width: 720px; }
      .hero-copy { display:flex; flex-direction:column; gap:14px; max-width: 720px; }
      .hint { color: var(--text-dim); }
      .error { margin-bottom:16px; padding:14px 16px; border:1px solid color-mix(in srgb, #ef4444 45%, transparent); border-radius:16px; background: color-mix(in srgb, #7f1d1d 55%, transparent); color: #fecaca; }
      .breadcrumbs { margin-bottom: 18px; color: var(--text-dim); }
      .breadcrumbs a { color: var(--accent); }
      .breadcrumbs .sep { margin: 0 8px; color: var(--text-dim); }
      .search-form { display:flex; align-items:center; gap:10px; width:min(100%, 720px); }
      .search-input { flex:1 1 auto; min-width:0; border:1px solid var(--border); background: var(--bg-card); color: var(--text); border-radius: 14px; padding: 12px 14px; font: inherit; }
      .search-button, .search-clear { display:inline-flex; align-items:center; justify-content:center; border-radius: 14px; padding: 12px 16px; border:1px solid var(--border); background: var(--accent); color: color-mix(in srgb, black 75%, white); font: inherit; font-weight:700; }
      .search-clear { background: var(--bg-card); color: var(--text); }
      .library-grid, .content-grid { display:grid; gap:18px; }
      .library-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
      .content-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
      .library-card, .content-tile { background: var(--bg-card); border: 1px solid var(--border); border-radius: 22px; overflow:hidden; box-shadow: 0 18px 40px var(--shadow); transition: transform 140ms ease, background 140ms ease, border-color 140ms ease; }
      .library-card:hover, .content-tile:hover { transform: translateY(-2px); background: var(--bg-card-hover); }
      .library-card-media { aspect-ratio: 16 / 10; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 28%, var(--bg-card)), var(--bg-card)); }
      .library-card-cover, .tile-cover { width:100%; height:100%; display:block; object-fit:cover; }
      .library-card-placeholder, .tile-placeholder { display:flex; align-items:center; justify-content:center; color: var(--text); font-weight:700; font-size: clamp(24px, 4vw, 34px); }
      .library-card-body, .tile-body { padding: 16px; }
      .library-card-title, .tile-title { display:block; font-size:16px; font-weight:700; color: var(--text); }
      .library-card-meta, .tile-meta { margin-top:6px; color: var(--text-dim); font-size:13px; }
      .tile-media { display:block; aspect-ratio: 3 / 4; background: color-mix(in srgb, var(--bg-card) 84%, black); }
      .tile-actions { display:flex; gap:8px; margin-top:14px; }
      .action { display:inline-flex; align-items:center; justify-content:center; min-width:0; flex:1 1 auto; padding:10px 12px; border-radius: 12px; background: var(--accent); color: color-mix(in srgb, black 75%, white); font-size:13px; font-weight:700; }
      .action-secondary { background: color-mix(in srgb, var(--bg-card-hover) 86%, var(--accent) 14%); color: var(--text); }
      .section-label { margin: 0 0 14px; color: var(--text-dim); font-size:12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .mobile-topbar { display:none; }
      @media (max-width: 900px) {
        .shell { grid-template-columns: 1fr; }
        .shell-sidebar { display:none; }
        .shell-main { padding: 18px; }
        .mobile-topbar { display:flex; flex-direction:column; gap:14px; margin-bottom:18px; }
        .mobile-topbar .theme-control { margin:0; }
      }
      @media (max-width: 640px) {
        .library-grid { grid-template-columns: 1fr; }
        .content-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
        .hero { flex-direction:column; }
        .search-form { flex-wrap:wrap; }
        .search-button, .search-clear { flex:1 1 140px; }
        .tile-actions { flex-direction:column; }
      }
    </style>
  </head>
  <body class="theme-${escapeHtml(activeTheme)}">
    <script>
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
      (function(){
        var key='yacreaderweb-theme';
        var saved=localStorage.getItem(key);
        var body=document.body;
        var currentTheme='${activeTheme}';
        function getPickers(){return Array.from(document.querySelectorAll('[data-theme-picker]'))}
        function normalizeTheme(theme){var aliases=${JSON.stringify(WEB_THEME_ALIASES)};var themes=${JSON.stringify(Object.keys(WEB_THEMES))};var resolved=aliases[theme]||theme;return themes.indexOf(resolved)!==-1?resolved:'matrix'}
        function syncThemeColor(){var meta=document.querySelector('meta[name="theme-color"]');if(!meta)return;var color=getComputedStyle(body).getPropertyValue('--theme-color').trim();if(color)meta.setAttribute('content', color)}
        function setTheme(theme){theme=normalizeTheme(theme);currentTheme=theme;body.className='theme-'+theme;localStorage.setItem(key, theme);syncThemeColor();getPickers().forEach(function(picker){if(picker.value!==theme)picker.value=theme})}
        if(saved) setTheme(saved); else setTheme(currentTheme);
        window.addEventListener('DOMContentLoaded', function(){getPickers().forEach(function(picker){picker.onchange=function(){setTheme(this.value)}}); getPickers().forEach(function(picker){if(picker.value!==currentTheme)picker.value=currentTheme}); syncThemeColor();});
      })();
    </script>
    ${escapeUrl ? `<script>
      window.addEventListener('keydown', function(e){
        if (e.key !== 'Escape' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (!window.matchMedia('(min-width: 901px)').matches) return;
        window.location.href = ${JSON.stringify(escapeUrl)};
      });
    </script>` : ''}
    <main class="shell">
      <aside class="shell-sidebar">
        <h1 class="brand">YACReaderWeb</h1>
        <p class="brand-copy">Library-first web shell for browsing comics, folders, and reader sessions.</p>
        ${renderThemePicker(activeTheme)}
        <div class="library-nav-title">Libraries</div>
        <ul class="library-nav">${libraryLinks || '<li class="hint">No libraries found</li>'}</ul>
      </aside>
      <section class="shell-main">
        <div class="mobile-topbar">
          <h1 class="brand">YACReaderWeb</h1>
          ${renderThemePicker(activeTheme)}
        </div>
        ${selectedLibrary ? `${breadcrumbHtml}<div class="hero"><div class="hero-copy"><div><h2>${escapeHtml(selectedLibrary.name)}</h2><p>${escapeHtml(selectedLibraryHint)}</p></div>${searchForm}</div></div><div class="section-label">${selectedLibrarySectionLabel}</div>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<div class="content-grid">${contentTiles || `<div class="hint">${searchResults ? 'No matches found' : 'No items in this folder'}</div>`}</div>` : `<div class="hero"><div><h2>Your libraries</h2><p>Pick a library to start browsing. Fast stats below are shallow counts from each library root.</p></div></div>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<div class="section-label">Available libraries</div><div class="library-grid">${libraryCards || '<div class="hint">No libraries found</div>'}</div>`}
      </section>
    </main>
  </body>
</html>`;
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function renderHome(req, res, selectedLibraryId = null, currentFolderId = ROOT_FOLDER_ID) {
  const requestId = getRequestId(req, res);
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const searchQuery = (urlObj.searchParams.get('q') || '').trim();

  try {
    const libraries = await fetchJson('/v2/libraries', requestId);
    const libraryStatsEntries = await Promise.all(libraries.map(async (library) => {
      try {
        const rootItems = await fetchJson(`/v2/library/${encodeURIComponent(library.id)}/folder/${encodeURIComponent(ROOT_FOLDER_ID)}/content`, requestId);
        return [String(library.id), {
          items: rootItems.length,
          folders: rootItems.filter((item) => item.type === 'folder').length,
          comics: rootItems.filter((item) => item.type === 'comic').length,
        }];
      } catch {
        return [String(library.id), null];
      }
    }));
    const libraryStatsById = Object.fromEntries(libraryStatsEntries);
    let selectedLibrary = null;
    let items = [];
    let breadcrumbs = [];
    let escapeUrl = null;

    if (selectedLibraryId) {
      selectedLibrary = libraries.find((library) => String(library.id) === String(selectedLibraryId)) || null;
      if (selectedLibrary) {
        if (searchQuery) {
          items = await fetchJson(`/v2/library/${encodeURIComponent(selectedLibrary.id)}/search`, requestId, {
            method: 'POST',
            headers: {
              'content-type': 'application/json'
            },
            body: JSON.stringify({ query: searchQuery })
          });
        } else {
          items = await fetchJson(`/v2/library/${encodeURIComponent(selectedLibrary.id)}/folder/${encodeURIComponent(currentFolderId)}/content`, requestId);
        }

        breadcrumbs = [{ label: 'Root', link: '/' }];

        if (currentFolderId === ROOT_FOLDER_ID) {
          breadcrumbs.push({ label: selectedLibrary.name, link: null });
        } else {
          breadcrumbs.push({ label: selectedLibrary.name, link: `/libraries/${encodeURIComponent(selectedLibrary.id)}/folders/${encodeURIComponent(ROOT_FOLDER_ID)}` });
        }

        if (searchQuery) {
          breadcrumbs.push({ label: 'Search', link: null });
        } else if (currentFolderId && currentFolderId !== ROOT_FOLDER_ID) {
          breadcrumbs.push({ label: 'Folder', link: null });
        }

        escapeUrl = currentFolderId && currentFolderId !== ROOT_FOLDER_ID
          ? `/libraries/${encodeURIComponent(selectedLibrary.id)}/folders/${encodeURIComponent(ROOT_FOLDER_ID)}`
          : '/';
      }
    }

    sendHtml(res, 200, pageTemplate({
      libraries,
      selectedLibrary,
      items,
      currentFolderId,
      breadcrumbs,
      libraryStatsById,
      searchQuery,
      searchResults: Boolean(searchQuery),
      escapeUrl,
      error: selectedLibraryId && !selectedLibrary ? `Library ${selectedLibraryId} was not found.` : null
    }));
  } catch (error) {
    sendHtml(res, 502, pageTemplate({
      libraries: [],
      selectedLibrary: null,
      items: [],
      currentFolderId,
      breadcrumbs: [],
      libraryStatsById: {},
      searchQuery,
      searchResults: Boolean(searchQuery),
      escapeUrl: null,
      error: error.message
    }));
  }
}

async function proxyCover(req, res, libraryId, coverPath) {
  const requestId = getRequestId(req, res);
  const upstreamPath = `/v2/library/${encodeURIComponent(libraryId)}/cover/${coverPath.split('/').map(encodeURIComponent).join('/')}`;
  const url = new URL(upstreamPath, YACR_SERVER_URL);

  try {
    const response = await fetch(url, {
      headers: {
        'x-request-id': requestId
      }
    });

    if (!response.ok) {
      res.writeHead(response.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Cover not found');
      return;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600'
    });
    res.end(body);
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Could not load cover: ${error.message}`);
  }
}

async function renderComicReader(req, res, libraryId, comicId) {
  const requestId = getRequestId(req, res);
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pageParam = urlObj.searchParams.get('page');
  const spreadParam = urlObj.searchParams.get('spread');
  const zoomParam = urlObj.searchParams.get('zoom');
  const pinParam = urlObj.searchParams.get('pin');
  const resumeParam = urlObj.searchParams.get('resume');
  const requestedPage = parseInt(pageParam || '0', 10) || 0;
  const spreadMode = spreadParam === '1' || spreadParam === 'true';
  const initialToolbarPinned = !(pinParam === '0' || pinParam === 'false');
  const allowResume = !(resumeParam === '0' || resumeParam === 'false');
  const parsedZoomLevel = Number.parseInt(zoomParam || '', 10);
  const initialZoomLevel = Math.max(100, Math.min(Number.isFinite(parsedZoomLevel) ? parsedZoomLevel : 100, 300));
  const hasExplicitPage = pageParam !== null;
  const hasExplicitSpread = spreadParam !== null;
  const hasExplicitZoom = zoomParam !== null;

  try {
    const comicInfo = await fetchJson(`/v2/library/${encodeURIComponent(libraryId)}/comic/${encodeURIComponent(comicId)}/fullinfo`, requestId);
    await fetch(new URL(`/v2/library/${encodeURIComponent(libraryId)}/comic/${encodeURIComponent(comicId)}/remote`, YACR_SERVER_URL), {
      headers: { 'x-request-id': requestId }
    });

    const totalContentPages = comicInfo.num_pages || 1;
    const totalDisplayPages = totalContentPages;
    const safePage = Math.max(0, Math.min(requestedPage, totalDisplayPages - 1));
    const coverHash = comicInfo.hash || '';
    const toolbarStorageKey = `webreader_toolbar_pinned_${libraryId}_${comicId}`;
    const title = escapeHtml(comicInfo.title || comicInfo.file_name || 'Comic');
    const pageLabel = `${safePage === 0 ? 'Cover' : `Page ${safePage}`} / ${totalDisplayPages}`;
    const defaultTheme = 'matrix';
    const parentFolderId = comicInfo.parent_id ? String(comicInfo.parent_id) : ROOT_FOLDER_ID;
    const escapeUrl = parentFolderId && parentFolderId !== ROOT_FOLDER_ID
      ? `/libraries/${encodeURIComponent(libraryId)}/folders/${encodeURIComponent(parentFolderId)}`
      : `/libraries/${encodeURIComponent(libraryId)}/folders/${encodeURIComponent(ROOT_FOLDER_ID)}`;

    const html = `<!doctype html>
<html lang="en">
<head>
    ${pageHead(`${title} - YACReaderWeb`)}
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    ${renderThemeCss()}
    *, *::before, *::after { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; background: #000; color: var(--text); overflow: hidden; }
    body { display: flex; flex-direction: column; }
    #app { display: contents; }
    .loading-ring {
      width: min(24vw, 176px);
      height: min(24vw, 176px);
      border-radius: 999px;
      border: min(1.8vw, 14px) solid rgba(255, 255, 255, 0.26);
      border-top-color: rgba(255, 255, 255, 1);
      border-right-color: rgba(255, 255, 255, 0.92);
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.78), 0 0 0 1px rgba(255, 255, 255, 0.08);
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body class="theme-${defaultTheme}">
  <div id="app">${renderComicReaderShell({
    title,
    backUrl: `/libraries/${encodeURIComponent(libraryId)}/folders/1`,
    pageLabel,
    toolbarShown: initialToolbarPinned,
    toolbarPinned: initialToolbarPinned,
    zoom: initialZoomLevel,
    spread: spreadMode,
    totalDisplayPages,
    debug: DEBUG,
  })}</div>
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
  </script>
  <script>
    (function(){
      var key='yacreaderweb-theme';
      var body=document.body;
      var root=document.documentElement;
      function normalizeTheme(theme){var aliases=${JSON.stringify(WEB_THEME_ALIASES)};var themes=${JSON.stringify(Object.keys(WEB_THEMES))};var resolved=aliases[theme]||theme;return themes.indexOf(resolved)!==-1?resolved:'${defaultTheme}'}
      function syncThemeColor(){var meta=document.querySelector('meta[name="theme-color"]');if(!meta)return;var color=getComputedStyle(body).getPropertyValue('--theme-color').trim();if(color)meta.setAttribute('content', color)}
      function setTheme(theme){theme=normalizeTheme(theme);var next='theme-'+theme;body.className=next;root.className=next;syncThemeColor()}
      try {
        var saved=localStorage.getItem(key) || '${defaultTheme}';
        setTheme(saved);
      } catch {
        setTheme('${defaultTheme}');
      }
      window.addEventListener('DOMContentLoaded', syncThemeColor);
    })();
  </script>
  <script>
    window.__COMIC__ = ${JSON.stringify({
      libraryId,
      comicId,
      totalContentPages,
      totalDisplayPages,
      coverHash,
      title: comicInfo.title || comicInfo.file_name || 'Comic',
      backUrl: `/libraries/${encodeURIComponent(libraryId)}/folders/1`,
      escapeUrl,
      toolbarKey: toolbarStorageKey,
      toolbarVisibleKey: `yacreaderweb_toolbar_visible_${libraryId}_${comicId}`,
      progressKey: 'yacreaderweb_progress_' + libraryId + '_' + comicId,
      initialPage: safePage,
      initialSpread: spreadMode,
      initialZoom: initialZoomLevel,
      initialToolbarPinned,
      debug: DEBUG,
      allowResume,
      hasExplicitPage,
      hasExplicitSpread,
      hasExplicitZoom,
    })};
  </script>
  <script src="/comic-reader.js"></script>
</body>
</html>`;

    sendHtml(res, 200, html);
  } catch (error) {
    sendHtml(res, 502, `<h1>Error</h1><p>${escapeHtml(error.message)}</p><a href="/">Back</a>`);
  }
}

async function proxyComicPage(req, res, libraryId, comicId, pageNum) {
  const requestId = getRequestId(req, res);
  const upstreamPageNum = Math.max(0, Number.parseInt(pageNum, 10) - 1);
  debugLog(`[proxyComicPage] library=${libraryId} comic=${comicId} page=${pageNum} upstreamPage=${upstreamPageNum} requestId=${requestId}`);
  try {
    const result = await fetchComicPageBuffer(libraryId, comicId, upstreamPageNum, requestId);
    res.writeHead(200, {
      'Content-Type': result.contentType,
      'Cache-Control': 'public, max-age=14400'
    });
    res.end(result.body);
  } catch (error) {
    res.writeHead(error.statusCode || 502, { 'Content-Type': 'text/plain' });
    res.end(error.message);
  }
}

async function fetchComicPageBuffer(libraryId, comicId, pageNum, requestId, options = {}) {
  const upstreamPath = `/v2/library/${encodeURIComponent(libraryId)}/comic/${encodeURIComponent(comicId)}/page/${pageNum}/remote`;
  const url = new URL(upstreamPath, YACR_SERVER_URL);

  const maxRetries = options.maxRetries || 8;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await fetch(url, {
        headers: { 'x-request-id': requestId }
      });

      if (response.status === 200) {
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const body = Buffer.from(await response.arrayBuffer());
        return { contentType, body };
      }

      if (response.status === 412) {
        // Still opening or loading page
        attempt++;
        await new Promise(r => setTimeout(r, 600 * attempt));
        continue;
      }

      if (response.status >= 500) {
        attempt++;
        await new Promise(r => setTimeout(r, 600 * attempt));
        continue;
      }

      // If no comic is open in this session (404 from page controller), try to open it first
      if (response.status === 404) {
        const openUrl = new URL(`/v2/library/${encodeURIComponent(libraryId)}/comic/${encodeURIComponent(comicId)}/remote`, YACR_SERVER_URL);
        await fetch(openUrl, { headers: { 'x-request-id': requestId } });
        attempt++;
        await new Promise(r => setTimeout(r, 800));
        continue;
      }

      throw Object.assign(new Error(await response.text() || `Failed to load page: ${response.status} ${response.statusText}`), {
        statusCode: response.status
      });
    } catch (error) {
      attempt++;
      console.error(`[fetchComicPageBuffer] library=${libraryId} comic=${comicId} page=${pageNum} attempt=${attempt} error=${error.message}`);
      if (attempt >= maxRetries) {
        throw Object.assign(new Error(`Failed to load page: ${error.message}`), {
          statusCode: error.statusCode || 502
        });
      }
      await new Promise(r => setTimeout(r, 600 * attempt));
    }
  }

  throw Object.assign(new Error('Page still loading after retries'), { statusCode: 504 });
}

async function downloadComicCbz(req, res, libraryId, comicId) {
  const requestId = getRequestId(req, res);

  try {
    debugLog(`[downloadComicCbz] library=${libraryId} comic=${comicId} requestId=${requestId}`);
    const comicInfo = await fetchJson(`/v2/library/${encodeURIComponent(libraryId)}/comic/${encodeURIComponent(comicId)}/fullinfo`, requestId);
    await fetch(new URL(`/v2/library/${encodeURIComponent(libraryId)}/comic/${encodeURIComponent(comicId)}/remote`, YACR_SERVER_URL), {
      headers: { 'x-request-id': requestId }
    });
    const totalPages = Number.parseInt(comicInfo.num_pages || '0', 10) || 0;
    const zip = new JSZip();
    const baseName = String(comicInfo.file_name || comicInfo.title || `comic-${comicId}`).replace(/\.[^.]+$/, '');

    if (comicInfo.hash) {
      const coverResponse = await fetch(new URL(`/v2/library/${encodeURIComponent(libraryId)}/cover/${encodeURIComponent(comicInfo.hash)}.jpg`, YACR_SERVER_URL), {
        headers: { 'x-request-id': requestId }
      });

      if (coverResponse.ok) {
        zip.file('0000.jpg', Buffer.from(await coverResponse.arrayBuffer()));
      }
    }

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      const pageName = String(pageIndex + 1).padStart(4, '0') + '.jpg';
      debugLog(`[downloadComicCbz] fetching page ${pageIndex + 1}/${totalPages} for comic=${comicId}`);
      const page = await fetchComicPageBuffer(libraryId, comicId, pageIndex, requestId, { maxRetries: 20 });
      zip.file(pageName, page.body);
    }

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.writeHead(200, {
      'Content-Type': 'application/vnd.comicbook+zip',
      'Content-Disposition': `attachment; filename="${baseName}.cbz"`,
      'Content-Length': buffer.length
    });
    res.end(buffer);
  } catch (error) {
    console.error(`[downloadComicCbz] library=${libraryId} comic=${comicId} failed: ${error.message}`);
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Could not build CBZ: ${error.message}`);
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  if (url.pathname === '/manifest.webmanifest' || url.pathname === '/service-worker.js' || url.pathname === '/comic-reader.js' || url.pathname === '/icon.svg' || url.pathname === '/apple-touch-icon.png' || url.pathname === '/icon-192.png' || url.pathname === '/icon-512.png' || url.pathname === '/maskable-icon-192.png' || url.pathname === '/maskable-icon-512.png') {
    const served = await serveStaticAsset(res, url.pathname.slice(1));
    if (served) return;
  }

  if (url.pathname.startsWith('/apple-splash/')) {
    const served = await serveStaticAsset(res, url.pathname.slice(1));
    if (served) return;
  }

  if (url.pathname === '/') {
    if (url.searchParams.has('zoom') || url.searchParams.has('page') || url.searchParams.has('spread')) {
      url.search = '';
      sendRedirect(res, url.pathname);
      return;
    }
    await renderHome(req, res);
    return;
  }

  const folderMatch = url.pathname.match(/^\/libraries\/([^/]+)\/folders\/([^/]+)$/);
  if (folderMatch) {
    if (url.searchParams.has('zoom') || url.searchParams.has('page') || url.searchParams.has('spread')) {
      url.search = '';
      sendRedirect(res, url.pathname);
      return;
    }
    await renderHome(req, res, folderMatch[1], folderMatch[2]);
    return;
  }

  const coverMatch = url.pathname.match(/^\/covers\/([^/]+)\/(.+)$/);
  if (coverMatch) {
    await proxyCover(req, res, coverMatch[1], coverMatch[2]);
    return;
  }

  const comicMatch = url.pathname.match(/^\/libraries\/([^/]+)\/comics\/([^/]+)$/);
  if (comicMatch) {
    await renderComicReader(req, res, comicMatch[1], comicMatch[2]);
    return;
  }

  const pageMatch = url.pathname.match(/^\/libraries\/([^/]+)\/comics\/([^/]+)\/pages\/(\d+)$/);
  if (pageMatch) {
    await proxyComicPage(req, res, pageMatch[1], pageMatch[2], pageMatch[3]);
    return;
  }

  const downloadMatch = url.pathname.match(/^\/libraries\/([^/]+)\/comics\/([^/]+)\/download$/);
  if (downloadMatch) {
    await downloadComicCbz(req, res, downloadMatch[1], downloadMatch[2]);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  debugLog(`YACReaderWeb listening on port ${PORT}`);
  debugLog(`Using YACReader server ${YACR_SERVER_URL}`);
});
