const http = require('node:http');
const { URL } = require('node:url');
const crypto = require('node:crypto');
const JSZip = require('jszip');

const PORT = Number.parseInt(process.env.WEBREADER_PORT || '3000', 10);
const YACR_SERVER_URL = process.env.YACR_SERVER_URL || 'http://localhost:8080';
const ROOT_FOLDER_ID = '1';

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
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>YACReader Webreader</title>
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
    <main>
      <aside>
        <h1>Webreader</h1>
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
  const requestedPage = parseInt(pageParam || '0', 10) || 0;
  const spreadMode = spreadParam === '1' || spreadParam === 'true';
  const parsedZoomLevel = Number.parseInt(zoomParam || '', 10);
  const initialZoomLevel = Math.max(100, Math.min(Number.isFinite(parsedZoomLevel) ? parsedZoomLevel : 100, 300));

  try {
    const comicInfo = await fetchJson(`/v2/library/${encodeURIComponent(libraryId)}/comic/${encodeURIComponent(comicId)}/fullinfo`, requestId);
    await fetch(new URL(`/v2/library/${encodeURIComponent(libraryId)}/comic/${encodeURIComponent(comicId)}/remote`, YACR_SERVER_URL), {
      headers: { 'x-request-id': requestId }
    });

    const totalContentPages = comicInfo.num_pages || 1;
    const totalDisplayPages = totalContentPages + 1;
    const safePage = Math.max(0, Math.min(requestedPage, totalDisplayPages - 1));
    const coverHash = comicInfo.hash || '';
    const toolbarStorageKey = `webreader_toolbar_pinned_${libraryId}_${comicId}`;
    const title = escapeHtml(comicInfo.title || comicInfo.file_name || 'Comic');

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - Webreader</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; background: #000; color: #e2e8f0; overflow: hidden; }
    body { display: flex; flex-direction: column; }
    #app { display: contents; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module">
    import { h, render } from 'https://esm.sh/preact@10.22.0';
    import { useState, useEffect, useRef, useCallback } from 'https://esm.sh/preact@10.22.0/hooks';

    const COMIC = ${JSON.stringify({
      libraryId,
      comicId,
      totalContentPages,
      totalDisplayPages,
      coverHash,
      title: comicInfo.title || comicInfo.file_name || 'Comic',
      backUrl: `/libraries/${encodeURIComponent(libraryId)}/folders/1`,
    })};
    const TOOLBAR_KEY = ${JSON.stringify(toolbarStorageKey)};
    const INITIAL_PAGE = ${safePage};
    const INITIAL_SPREAD = ${spreadMode ? 'true' : 'false'};
    const INITIAL_ZOOM = ${initialZoomLevel};

    function pageUrl(page) {
      return '/libraries/' + encodeURIComponent(COMIC.libraryId) + '/comics/' + encodeURIComponent(COMIC.comicId) + '/pages/' + page;
    }
    function coverUrl() {
      return COMIC.coverHash ? '/covers/' + encodeURIComponent(COMIC.libraryId) + '/' + encodeURIComponent(COMIC.coverHash) + '.jpg' : '';
    }
    function pageLabelFor(page) {
      return page === 0 ? 'Cover' : 'Page ' + page;
    }

    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        let retried = false;
        img.onload = () => resolve(img);
        img.onerror = () => {
          if (retried) { reject(new Error('Failed to load ' + src)); return; }
          retried = true;
          setTimeout(() => { img.src = src + (src.includes('?') ? '&' : '?') + 'retry=' + Date.now(); }, 300);
        };
        img.src = src;
      });
    }

    function App() {
      const [page, setPage] = useState(INITIAL_PAGE);
      const [spread, setSpread] = useState(INITIAL_SPREAD);
      const [zoom, setZoom] = useState(INITIAL_ZOOM);
      const [toolbarVisible, setToolbarVisible] = useState(false);
      const [toolbarPinned, setToolbarPinned] = useState(() => {
        try { return localStorage.getItem(TOOLBAR_KEY) === '1'; } catch { return false; }
      });
      // imgSrc: single page src; spreadSrcs: [left, right]
      const [imgSrc, setImgSrc] = useState('');
      const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0 });
      const [spreadSrcs, setSpreadSrcs] = useState(['', '']);
      const [spreadNaturalSizes, setSpreadNaturalSizes] = useState([{ w: 0, h: 0 }, { w: 0, h: 0 }]);
      const [pageLabel, setPageLabel] = useState('');

      const viewerRef = useRef(null);
      const pushingUrl = useRef(false);

      // Derived spread pages
      function getSpreadPages(p) {
        const rightPage = p % 2 === 1 ? p : p + 1;
        const leftPage = rightPage - 1;
        return [leftPage, rightPage].filter(x => x >= 1 && x <= COMIC.totalContentPages);
      }

      // Navigate to a page, updating URL
      const goToPage = useCallback((nextPage, opts = {}) => {
        const p = Math.max(0, Math.min(nextPage, COMIC.totalDisplayPages - 1));
        setPage(p);
        if (opts.pushUrl !== false) {
          const url = new URL(window.location);
          url.searchParams.set('page', String(p));
          url.searchParams.set('spread', spread ? '1' : '0');
          url.searchParams.set('zoom', String(zoom));
          window.history.pushState({}, '', url);
        }
      }, [spread, zoom]);

      const prevPage = useCallback(() => {
        setPage(p => {
          const next = Math.max(0, p - (spread ? 2 : 1));
          const url = new URL(window.location);
          url.searchParams.set('page', String(next));
          url.searchParams.set('spread', spread ? '1' : '0');
          url.searchParams.set('zoom', String(zoom));
          window.history.pushState({}, '', url);
          return next;
        });
      }, [spread, zoom]);

      const nextPage = useCallback(() => {
        setPage(p => {
          const next = Math.min(COMIC.totalDisplayPages - 1, p + (spread ? 2 : 1));
          const url = new URL(window.location);
          url.searchParams.set('page', String(next));
          url.searchParams.set('spread', spread ? '1' : '0');
          url.searchParams.set('zoom', String(zoom));
          window.history.pushState({}, '', url);
          return next;
        });
      }, [spread, zoom]);

      // Load image(s) when page or spread changes
      useEffect(() => {
        let cancelled = false;
        if (spread && page > 0) {
          const pages = getSpreadPages(page);
          const label = pages.length === 2 ? pages[0] + '-' + pages[1] : pageLabelFor(pages[0]);
          setPageLabel(label + ' / ' + COMIC.totalDisplayPages);
          setImgSrc('');
          Promise.all(pages.map(p => loadImage(pageUrl(p)))).then(imgs => {
            if (cancelled) return;
            setSpreadSrcs(imgs.map(i => i.src));
            setSpreadNaturalSizes(imgs.map(i => ({ w: i.naturalWidth, h: i.naturalHeight })));
          }).catch(() => {});
        } else {
          const src = page === 0 ? coverUrl() : pageUrl(page);
          setPageLabel(pageLabelFor(page) + ' / ' + COMIC.totalDisplayPages);
          setSpreadSrcs(['', '']);
          loadImage(src).then(img => {
            if (cancelled) return;
            setImgSrc(img.src);
            setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
          }).catch(() => {});
        }
        // Scroll to top on page change
        if (viewerRef.current) viewerRef.current.scrollTop = 0;
        return () => { cancelled = true; };
      }, [page, spread]);

      // Update URL when zoom changes (without pushing history)
      useEffect(() => {
        const url = new URL(window.location);
        url.searchParams.set('zoom', String(zoom));
        window.history.replaceState({}, '', url);
      }, [zoom]);

      // Keyboard shortcuts
      useEffect(() => {
        const onKey = (e) => {
          if (e.key === 'ArrowLeft') prevPage();
          if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextPage(); }
          if (e.key === '+' || e.key === '=') setZoom(z => Math.min(300, z + 10));
          if (e.key === '-') setZoom(z => Math.max(100, z - 10));
          if (e.key.toLowerCase() === 's') setSpread(s => !s);
          if (e.key.toLowerCase() === 'w') setZoom(z => z > 100 ? 100 : 130);
          if (e.key.toLowerCase() === 't') setToolbarVisible(v => !v);
          if (e.key === 'Escape') setToolbarVisible(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [prevPage, nextPage]);

      // Popstate
      useEffect(() => {
        const onPop = () => {
          const url = new URL(window.location);
          const p = parseInt(url.searchParams.get('page') || '0', 10) || 0;
          const s = url.searchParams.get('spread') === '1';
          const z = parseInt(url.searchParams.get('zoom') || '100', 10) || 100;
          setPage(p);
          setSpread(s);
          setZoom(z);
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
      }, []);

      // Resize
      useEffect(() => {
        const onResize = () => { /* zoom is CSS transform, no action needed */ };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, []);

      function togglePin() {
        setToolbarPinned(p => {
          const next = !p;
          try { next ? localStorage.setItem(TOOLBAR_KEY, '1') : localStorage.removeItem(TOOLBAR_KEY); } catch {}
          return next;
        });
      }

      // Compute scaled image size for zoom
      // At zoom=100: image fills viewer (constrained by both W and H)
      // At zoom>100: image is zoomed relative to fit-to-screen size, centered, scrollable
      function computeImgStyle(nw, nh) {
        if (!nw || !nh) return {};
        const viewer = viewerRef.current;
        if (!viewer) return {};
        const availW = viewer.clientWidth - 32;
        const availH = viewer.clientHeight - 32;
        const scale = Math.min(availW / nw, availH / nh);
        const fittedW = Math.round(nw * scale);
        const fittedH = Math.round(nh * scale);
        if (zoom === 100) {
          return { width: fittedW + 'px', height: fittedH + 'px', flexShrink: '0' };
        }
        return {
          width: Math.round(fittedW * zoom / 100) + 'px',
          height: Math.round(fittedH * zoom / 100) + 'px',
          flexShrink: '0',
        };
      }

      const showSpread = spread && spreadSrcs[0];
      const imgStyle = showSpread ? {} : computeImgStyle(imgNaturalSize.w, imgNaturalSize.h);

      // Toolbar visibility: pinned always shown, otherwise toggled
      const toolbarShown = toolbarPinned || toolbarVisible;

      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#000', overflow: 'hidden' } },
        // Toolbar
        h('div', {
          style: {
            height: toolbarShown ? '36px' : '0',
            overflow: 'hidden',
            flexShrink: 0,
            transition: 'height 160ms ease',
            background: 'rgba(15,23,42,0.96)',
            borderBottom: toolbarShown ? '1px solid #334155' : 'none',
            display: 'flex',
            alignItems: 'center',
            padding: toolbarShown ? '0 8px' : '0',
            gap: '8px',
            fontSize: '12px',
          }
        },
          toolbarShown && h('a', { href: COMIC.backUrl, style: btnStyle }, '← Back'),
          toolbarShown && h('div', { style: { flex: 1, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, COMIC.title),
          toolbarShown && h('button', { onClick: prevPage, style: btnStyle }, '◀'),
          toolbarShown && h('span', { style: { minWidth: 90, textAlign: 'center', color: '#94a3b8', fontSize: 13 } }, pageLabel),
          toolbarShown && h('button', { onClick: nextPage, style: btnStyle }, '▶'),
          toolbarShown && h('button', { onClick: () => setSpread(s => !s), style: { ...btnStyle, background: '#475569' } }, spread ? 'Spread' : 'Single'),
          toolbarShown && h('button', { onClick: () => setZoom(z => z > 100 ? 100 : 130), style: { ...btnStyle, background: '#475569' } }, zoom > 100 ? 'Fit Width' : 'Fit Screen'),
          toolbarShown && h('button', { onClick: togglePin, style: { ...btnStyle, background: toolbarPinned ? '#0f766e' : '#334155', minWidth: 28 } }, toolbarPinned ? '📌' : '📍'),
        ),

        // Viewer
        h('div', {
          ref: viewerRef,
          onClick: (e) => {
            // Left/right click zones
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < rect.width * 0.3) prevPage();
            else if (x > rect.width * 0.7) nextPage();
            else if (!toolbarPinned) setToolbarVisible(v => !v);
          },
          style: {
            flex: 1,
            overflow: zoom > 100 ? 'auto' : 'hidden',
            background: '#000',
            display: 'flex',
            alignItems: zoom > 100 ? 'flex-start' : 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            minHeight: 0,
          }
        },
          h('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: zoom > 100 ? 'max-content' : '100%',
              minHeight: zoom > 100 ? 'max-content' : '100%',
              padding: '16px',
            }
          },
            showSpread
              ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                  spreadSrcs[0] && h('img', {
                    src: spreadSrcs[0],
                    style: computeImgStyle(spreadNaturalSizes[0].w, spreadNaturalSizes[0].h),
                    draggable: false,
                  }),
                  spreadSrcs[1] && h('img', {
                    src: spreadSrcs[1],
                    style: computeImgStyle(spreadNaturalSizes[1].w, spreadNaturalSizes[1].h),
                    draggable: false,
                  }),
                )
              : imgSrc && h('img', {
                  src: imgSrc,
                  style: { ...imgStyle, boxShadow: '0 10px 40px rgba(0,0,0,0.7)', display: 'block' },
                  draggable: false,
                })
          )
        ),

        // Zoom control (fixed right side)
        h('div', {
          style: {
            position: 'fixed', right: 12, top: '50%', transform: 'translateY(-50%)',
            zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 8, padding: '10px 8px', borderRadius: 999,
            background: 'rgba(15,23,42,0.88)', border: '1px solid rgba(148,163,184,0.2)',
            boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
          }
        },
          h('button', { onClick: () => setZoom(z => Math.min(300, z + 10)), style: roundBtnStyle }, '+'),
          h('input', {
            type: 'range', min: 100, max: 300, step: 10, value: zoom,
            onInput: (e) => setZoom(Number(e.target.value)),
            style: { writingMode: 'vertical-lr', direction: 'rtl', width: 28, height: 180, accentColor: '#60a5fa' },
          }),
          h('div', { style: { minWidth: 42, textAlign: 'center', color: '#cbd5e1', fontSize: 11 } }, zoom + '%'),
          h('button', { onClick: () => setZoom(z => Math.max(100, z - 10)), style: roundBtnStyle }, '−'),
        ),

        // Toolbar reveal handle (when hidden)
        !toolbarPinned && !toolbarVisible && h('div', {
          onClick: () => setToolbarVisible(true),
          style: {
            position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
            width: 72, height: 10, borderRadius: '0 0 10px 10px',
            background: 'rgba(148,163,184,0.18)', zIndex: 20, cursor: 'pointer',
          }
        }),
      );
    }

    const btnStyle = {
      background: '#334155', color: 'white', border: 'none', padding: '3px 8px',
      borderRadius: 4, fontSize: 11, cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
    };
    const roundBtnStyle = {
      width: 30, height: 30, padding: 0, borderRadius: 999,
      background: '#334155', color: 'white', border: 'none', cursor: 'pointer',
      fontSize: 16, lineHeight: 1,
    };

    render(h(App, null), document.getElementById('app'));
  </script>
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
  console.log(`[proxyComicPage] library=${libraryId} comic=${comicId} page=${pageNum} upstreamPage=${upstreamPageNum} requestId=${requestId}`);
  try {
    const result = await fetchComicPageBuffer(libraryId, comicId, upstreamPageNum, requestId);
    res.writeHead(200, {
      'Content-Type': result.contentType,
      'Cache-Control': 'public, max-age=300'
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
    console.log(`[downloadComicCbz] library=${libraryId} comic=${comicId} requestId=${requestId}`);
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
      console.log(`[downloadComicCbz] fetching page ${pageIndex + 1}/${totalPages} for comic=${comicId}`);
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

  if (url.pathname === '/') {
    await renderHome(req, res);
    return;
  }

  const folderMatch = url.pathname.match(/^\/libraries\/([^/]+)\/folders\/([^/]+)$/);
  if (folderMatch) {
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
  console.log(`Webreader listening on port ${PORT}`);
  console.log(`Using YACReader server ${YACR_SERVER_URL}`);
});
