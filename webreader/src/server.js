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

async function fetchJson(pathname, requestId) {
  const url = new URL(pathname, YACR_SERVER_URL);
  let response;

  try {
    response = await fetch(url, {
      headers: {
        'x-request-id': requestId,
        'accept': 'application/json'
      }
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

function pageTemplate({ libraries, selectedLibrary, items, currentFolderId, breadcrumbs, error }) {
  const libraryLinks = libraries.map((library) => {
    const isActive = selectedLibrary && String(selectedLibrary.id) === String(library.id);
    return `<li><a href="/libraries/${encodeURIComponent(library.id)}/folders/${encodeURIComponent(ROOT_FOLDER_ID)}"${isActive ? ' aria-current="page"' : ''}>${escapeHtml(library.name)}</a></li>`;
  }).join('');

  const itemRows = items.map((item) => {
    const coverUrl = getCoverUrl(item);
    const thumbnail = coverUrl
      ? `<img class="thumb" src="${coverUrl}" alt="" loading="lazy">`
      : `<div class="thumb thumb-placeholder" aria-hidden="true">${item.type === 'folder' ? 'Folder' : 'Comic'}</div>`;

    if (item.type === 'folder') {
      return `
        <li class="item folder">
          <div class="thumb-wrap">${thumbnail}</div>
          <div class="item-main">
            <a href="/libraries/${encodeURIComponent(item.library_id)}/folders/${encodeURIComponent(item.id)}">${escapeHtml(item.folder_name || 'Unnamed folder')}</a>
            <div class="meta">${escapeHtml(String(item.num_children ?? ''))} items</div>
          </div>
        </li>`;
    }

    const readerLink = `/libraries/${encodeURIComponent(item.library_id)}/comics/${encodeURIComponent(item.id)}`;
    const downloadLink = getComicDownloadUrl(item);
    return `
      <li class="item comic">
        <div class="thumb-wrap">${thumbnail}</div>
        <div class="item-main">
          <a href="${readerLink}"><strong>${escapeHtml(item.title || item.file_name || 'Untitled comic')}</strong></a>
          <div class="meta">${escapeHtml(item.file_name || '')}</div>
        </div>
        <a class="read-link download-link" href="${downloadLink}">Download CBZ</a>
        <a class="read-link" href="${readerLink}">Read</a>
      </li>`;
  }).join('');

  const breadcrumbHtml = breadcrumbs && breadcrumbs.length > 0
    ? `<nav class="breadcrumbs">${breadcrumbs.map((crumb, idx) => {
        if (crumb.link) {
          return `<a href="${crumb.link}">${escapeHtml(crumb.label)}</a>`;
        }
        return `<span>${escapeHtml(crumb.label)}</span>`;
      }).join(' <span class="sep">›</span> ')}</nav>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    ${pageHead('YACReaderWeb')}
    <style>
      :root {
        color-scheme: dark;
        font-family: system-ui, sans-serif;
      }

      body {
        margin: 0;
        background: #111827;
        color: #e5e7eb;
      }

      main {
        display: grid;
        grid-template-columns: 280px 1fr;
        min-height: 100vh;
      }

      aside {
        padding: 1rem;
        border-right: 1px solid #374151;
        background: #0f172a;
      }

      section {
        padding: 1.5rem;
      }

      h1, h2 {
        margin-top: 0;
      }

      ul {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      li + li {
        margin-top: 0.75rem;
      }

      a {
        color: #93c5fd;
        text-decoration: none;
      }

      a:hover {
        text-decoration: underline;
      }

      .item {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.9rem 1rem;
        border: 1px solid #374151;
        border-radius: 0.75rem;
        background: #1f2937;
      }

      .folder {
        background: #1e293b;
      }

      .meta {
        margin-top: 0.25rem;
        color: #9ca3af;
        font-size: 0.9rem;
      }

      .thumb-wrap {
        flex: 0 0 auto;
      }

      .thumb {
        display: block;
        width: 56px;
        height: 84px;
        object-fit: cover;
        border-radius: 0.5rem;
        border: 1px solid #4b5563;
        background: #0b1220;
      }

      .thumb-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 84px;
        padding: 0.5rem;
        border-radius: 0.5rem;
        border: 1px dashed #4b5563;
        color: #94a3b8;
        font-size: 0.75rem;
        text-align: center;
        background: #0b1220;
      }

      .item-main {
        min-width: 0;
        flex: 1 1 auto;
      }

      .item-main a,
      .item-main strong {
        display: block;
      }

      .read-link {
        padding: 0.4rem 0.9rem;
        background: #1e40af;
        color: white;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        white-space: nowrap;
      }

      .download-link {
        background: #065f46;
      }

      .read-link:hover {
        background: #1e3a8a;
        text-decoration: none;
      }

      .download-link:hover {
        background: #047857;
      }

      .breadcrumbs {
        margin-bottom: 1rem;
        font-size: 0.95rem;
      }

      .breadcrumbs a {
        color: #93c5fd;
      }

      .breadcrumbs .sep {
        color: #64748b;
        margin: 0 0.5rem;
      }

      .error {
        margin-bottom: 1rem;
        padding: 0.9rem 1rem;
        border: 1px solid #7f1d1d;
        border-radius: 0.75rem;
        background: #450a0a;
        color: #fecaca;
      }

      .hint {
        color: #9ca3af;
      }

      @media (max-width: 860px) {
        main {
          grid-template-columns: 1fr;
        }

        aside {
          border-right: 0;
          border-bottom: 1px solid #374151;
        }
      }
    </style>
  </head>
  <body>
    <script>
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js').catch(() => {});
      }
    </script>
    <main>
      <aside>
        <h1>YACReaderWeb</h1>
        <p class="hint">Upstream: ${escapeHtml(YACR_SERVER_URL)}</p>
        <h2>Libraries</h2>
        <ul>${libraryLinks || '<li class="hint">No libraries found</li>'}</ul>
      </aside>
      <section>
        ${breadcrumbHtml}
        <h2>${selectedLibrary ? escapeHtml(selectedLibrary.name) : 'Select a library'}</h2>
        <p class="hint">Folder ID: ${escapeHtml(String(currentFolderId ?? ROOT_FOLDER_ID))}</p>
        ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
        <ul>${itemRows || '<li class="hint">No items in this folder</li>'}</ul>
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

  try {
    const libraries = await fetchJson('/v2/libraries', requestId);
    let selectedLibrary = null;
    let items = [];
    let breadcrumbs = [];

    if (!selectedLibraryId && libraries.length > 0) {
      sendRedirect(res, `/libraries/${encodeURIComponent(libraries[0].id)}/folders/${encodeURIComponent(ROOT_FOLDER_ID)}`);
      return;
    }

    if (selectedLibraryId) {
      selectedLibrary = libraries.find((library) => String(library.id) === String(selectedLibraryId)) || null;
      if (selectedLibrary) {
        items = await fetchJson(`/v2/library/${encodeURIComponent(selectedLibrary.id)}/folder/${encodeURIComponent(currentFolderId)}/content`, requestId);

        // Build simple breadcrumbs
        breadcrumbs = [
          { label: 'Root', link: `/libraries/${encodeURIComponent(selectedLibrary.id)}/folders/${encodeURIComponent(ROOT_FOLDER_ID)}` },
          { label: selectedLibrary.name, link: null }
        ];

        if (currentFolderId && currentFolderId !== ROOT_FOLDER_ID) {
          // Try to find current folder name from items (parent of first item)
          const first = items[0];
          if (first && first.parent_id) {
            breadcrumbs.push({ label: 'Folder', link: null });
          }
        }
      }
    }

    sendHtml(res, 200, pageTemplate({
      libraries,
      selectedLibrary,
      items,
      currentFolderId,
      breadcrumbs,
      error: selectedLibraryId && !selectedLibrary ? `Library ${selectedLibraryId} was not found.` : null
    }));
  } catch (error) {
    sendHtml(res, 502, pageTemplate({
      libraries: [],
      selectedLibrary: null,
      items: [],
      currentFolderId,
      breadcrumbs: [],
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
  const allowResume = resumeParam === '1' || resumeParam === 'true';
  const parsedZoomLevel = Number.parseInt(zoomParam || '', 10);
  const initialZoomLevel = Math.max(100, Math.min(Number.isFinite(parsedZoomLevel) ? parsedZoomLevel : 100, 300));

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

    const html = `<!doctype html>
<html lang="en">
<head>
   ${pageHead(`${title} - YACReaderWeb`)}
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; background: #000; color: #e2e8f0; overflow: hidden; }
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
<body>
  <div id="app"></div>
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
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
      toolbarKey: toolbarStorageKey,
      toolbarVisibleKey: `yacreaderweb_toolbar_visible_${libraryId}_${comicId}`,
      progressKey: 'yacreaderweb_progress_' + libraryId + '_' + comicId,
      initialPage: safePage,
      initialSpread: spreadMode,
      initialZoom: initialZoomLevel,
      initialToolbarPinned,
      debug: DEBUG,
      allowResume,
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
