(function () {
  const COMIC = window.__COMIC__;
  if (!COMIC) return;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }

  const app = document.getElementById('app');
  const state = {
    page: 0,
    spread: COMIC.initialSpread,
    zoom: COMIC.initialZoom,
    toolbarVisible: true,
    toolbarPinned: false,
    imgSrc: '',
    imgNaturalSize: { w: 0, h: 0 },
    spreadSrcs: ['', ''],
    spreadNaturalSizes: [{ w: 0, h: 0 }, { w: 0, h: 0 }],
    pageLabel: '',
    pageOverlay: '',
    pageOverlayVisible: false,
    zoomDimmed: false,
  };

  try { state.toolbarPinned = localStorage.getItem(COMIC.toolbarKey) === '1'; } catch {}
  try {
    const stored = localStorage.getItem(COMIC.toolbarVisibleKey);
    if (stored === '0') state.toolbarVisible = false;
    if (stored === '1') state.toolbarVisible = true;
  } catch {}
  if (COMIC.allowResume) {
    try {
      const saved = JSON.parse(localStorage.getItem(COMIC.progressKey) || 'null');
      if (saved && Number.isInteger(saved.page)) state.page = Math.max(0, Math.min(saved.page, COMIC.totalDisplayPages - 1));
      if (saved && typeof saved.spread === 'boolean') state.spread = saved.spread;
      if (saved && Number.isInteger(saved.zoom)) state.zoom = Math.max(100, Math.min(saved.zoom, 300));
    } catch {}
  }

  let viewerRef = null;
  let zoomControlsRef = null;
  let pageOverlayRef = null;
  let overlayTimer = null;
  let zoomTimer = null;

  function syncZoomControlsOpacity() {
    if (!zoomControlsRef) return;
    zoomControlsRef.style.opacity = state.zoomDimmed ? '0.36' : '0.8';
  }

  function syncPageOverlay() {
    if (!pageOverlayRef) return;
    pageOverlayRef.textContent = state.pageOverlay;
    pageOverlayRef.style.opacity = state.pageOverlayVisible ? '1' : '0';
  }

  function scheduleZoomFade(delay = 1000) {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      state.zoomDimmed = true;
      syncZoomControlsOpacity();
    }, delay);
  }

  function revealZoomControls(delay = 1000) {
    const wasDimmed = state.zoomDimmed;
    state.zoomDimmed = false;
    scheduleZoomFade(delay);
    if (wasDimmed) syncZoomControlsOpacity();
  }

  function pageUrl(page) {
    return '/libraries/' + encodeURIComponent(COMIC.libraryId) + '/comics/' + encodeURIComponent(COMIC.comicId) + '/pages/' + (page + 1);
  }

  function pageLabelFor(page) {
    return page === 0 ? 'Cover' : 'Page ' + page;
  }

  function getSpreadPages(p) {
    const rightPage = p % 2 === 1 ? p : p + 1;
    const leftPage = rightPage - 1;
    return [leftPage, rightPage].filter((x) => x >= 0 && x <= COMIC.totalDisplayPages - 1);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      if (!src) {
        reject(new Error('Empty image source'));
        return;
      }

      const img = new Image();
      let retried = false;

      img.onload = () => resolve(img);
      img.onerror = () => {
        if (retried) {
          reject(new Error('Failed to load ' + src));
          return;
        }
        retried = true;
        setTimeout(() => {
          img.src = src + (src.includes('?') ? '&' : '?') + 'retry=' + Date.now();
        }, 300);
      };

      img.src = src;
    });
  }

  function pushUrl(replace = false) {
    const url = new URL(window.location);
    url.searchParams.set('page', String(state.page));
    url.searchParams.set('spread', state.spread ? '1' : '0');
    url.searchParams.set('zoom', String(state.zoom));
    if (replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
  }

  function persist() {
    try {
      localStorage.setItem(COMIC.progressKey, JSON.stringify({ page: state.page, spread: state.spread, zoom: state.zoom }));
    } catch {}
  }

  function computeImgStyle(nw, nh) {
    if (!nw || !nh || !viewerRef) return {};
    const availW = viewerRef.clientWidth - 32;
    const availH = viewerRef.clientHeight - 32;
    const scale = Math.min(availW / nw, availH / nh);
    const fittedW = Math.round(nw * scale);
    const fittedH = Math.round(nh * scale);
    if (state.zoom === 100) {
      return { width: fittedW + 'px', height: fittedH + 'px', flexShrink: '0' };
    }
    return {
      width: Math.round(fittedW * state.zoom / 100) + 'px',
      height: Math.round(fittedH * state.zoom / 100) + 'px',
      flexShrink: '0',
    };
  }

  function cssText(style) {
    return Object.entries(style).map(([key, value]) => `${key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${value}`).join(';');
  }

  function showPage(page) {
    state.pageOverlay = page === 0 ? 'Cover' : String(page);
    state.pageOverlayVisible = true;
    state.zoomDimmed = false;

    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => {
      state.pageOverlayVisible = false;
      syncPageOverlay();
    }, 1000);
    scheduleZoomFade(1000);

    if (state.spread && page > 0) {
      const pages = getSpreadPages(page);
      const label = pages.length === 2 ? pages[0] + '-' + pages[1] : pageLabelFor(pages[0]);
      state.pageLabel = label + ' / ' + COMIC.totalDisplayPages;
      state.imgSrc = '';
      Promise.all(pages.map((p) => loadImage(pageUrl(p)))).then((imgs) => {
        state.spreadSrcs = imgs.map((i) => i.src);
        state.spreadNaturalSizes = imgs.map((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
        render();
      }).catch(() => {});
    } else {
      const src = pageUrl(page);
      state.pageLabel = pageLabelFor(page) + ' / ' + COMIC.totalDisplayPages;
      state.spreadSrcs = ['', ''];
      loadImage(src).then((img) => {
        state.imgSrc = img.src;
        state.imgNaturalSize = { w: img.naturalWidth, h: img.naturalHeight };
        render();
      }).catch(() => {});
    }

    if (viewerRef) viewerRef.scrollTop = 0;
    persist();
    pushUrl(true);
    render();
  }

  function prevPage() {
    state.page = Math.max(0, state.page - (state.spread ? 2 : 1));
    showPage(state.page);
  }

  function nextPage() {
    state.page = Math.min(COMIC.totalDisplayPages - 1, state.page + (state.spread ? 2 : 1));
    showPage(state.page);
  }

  function toggleSpread() {
    state.spread = !state.spread;
    showPage(state.page);
  }

  function togglePin() {
    state.toolbarPinned = !state.toolbarPinned;
    try {
      if (state.toolbarPinned) localStorage.setItem(COMIC.toolbarKey, '1');
      else localStorage.removeItem(COMIC.toolbarKey);
    } catch {}
    render();
  }

  function toggleToolbarVisible() {
    state.toolbarVisible = !state.toolbarVisible;
    try { localStorage.setItem(COMIC.toolbarVisibleKey, state.toolbarVisible ? '1' : '0'); } catch {}
    render();
  }

  function setZoom(next) {
    state.zoom = Math.max(100, Math.min(next, 300));
    persist();
    pushUrl(true);
    render();
  }

  function render() {
    const showSpread = state.spread && state.spreadSrcs[0];
    const imgStyle = showSpread ? {} : computeImgStyle(state.imgNaturalSize.w, state.imgNaturalSize.h);
    const toolbarShown = state.toolbarPinned || state.toolbarVisible;
    const zoomControlStyle = [
      'position:fixed', 'right:12px', 'top:50%', 'transform:translateY(-50%)',
      'z-index:10', 'display:flex', 'flex-direction:column', 'align-items:center',
      'gap:8px', 'padding:10px 8px', 'border-radius:999px',
      'background:rgba(15,23,42,0.88)', 'border:1px solid rgba(148,163,184,0.2)',
      'box-shadow:0 12px 30px rgba(0,0,0,0.35)',
      'opacity:' + (state.zoomDimmed ? 0.36 : 0.8),
      'transition:opacity 200ms ease',
    ].join(';');

    app.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100vh;background:#000;overflow:hidden">
        <div id="toolbar" style="height:${toolbarShown ? '36px' : '0'};overflow:hidden;flex-shrink:0;transition:height 160ms ease;background:rgba(15,23,42,0.96);border-bottom:${toolbarShown ? '1px solid #334155' : 'none'};display:flex;align-items:center;padding:${toolbarShown ? '0 8px' : '0'};gap:8px;font-size:12px;">
          ${toolbarShown ? `<a href="${COMIC.backUrl}" style="background:#334155;color:white;border:none;padding:3px 8px;border-radius:4px;font-size:11px;text-decoration:none;display:inline-block;">← Back</a>` : ''}
          ${toolbarShown ? `<div style="flex:1;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${COMIC.title}</div>` : ''}
          ${toolbarShown ? `<button data-action="prev" style="background:#334155;color:white;border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">◀</button>` : ''}
          ${toolbarShown ? `<span style="min-width:90px;text-align:center;color:#94a3b8;font-size:13px;">${state.pageLabel}</span>` : ''}
          ${toolbarShown ? `<button data-action="next" style="background:#334155;color:white;border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">▶</button>` : ''}
          ${toolbarShown ? `<button data-action="spread" style="background:#475569;color:white;border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">${state.spread ? 'Spread' : 'Single'}</button>` : ''}
          ${toolbarShown ? `<button data-action="fit" style="background:#475569;color:white;border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">${state.zoom > 100 ? 'Fit Width' : 'Fit Screen'}</button>` : ''}
          ${toolbarShown ? `<button data-action="pin" style="background:${state.toolbarPinned ? '#0f766e' : '#334155'};color:white;border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;min-width:28px;">${state.toolbarPinned ? '📌' : '📍'}</button>` : ''}
        </div>

        <div id="viewer" style="position:relative;flex:1;overflow:${state.zoom > 100 ? 'auto' : 'hidden'};background:#000;display:flex;align-items:${state.zoom > 100 ? 'flex-start' : 'center'};justify-content:center;cursor:pointer;min-height:0;">
          <div style="position:absolute;left:16px;top:50%;transform:translateY(-50%);pointer-events:none;z-index:8;color:rgba(255,255,255,0.42);text-shadow:0 10px 30px rgba(0,0,0,0.72);font-size:min(14vw,88px);font-weight:800;line-height:1;">&lt;</div>
          <div style="position:absolute;right:16px;top:50%;transform:translateY(-50%);pointer-events:none;z-index:8;color:rgba(255,255,255,0.42);text-shadow:0 10px 30px rgba(0,0,0,0.72);font-size:min(14vw,88px);font-weight:800;line-height:1;">&gt;</div>
          <div style="display:flex;align-items:center;justify-content:center;min-width:${state.zoom > 100 ? 'max-content' : '100%'};min-height:${state.zoom > 100 ? 'max-content' : '100%'};padding:16px;">
            ${showSpread ? `
              <div style="display:flex;gap:8px;align-items:center;">
                ${state.spreadSrcs[0] ? `<img src="${state.spreadSrcs[0]}" style="${cssText(computeImgStyle(state.spreadNaturalSizes[0].w, state.spreadNaturalSizes[0].h))}" draggable="false">` : ''}
                ${state.spreadSrcs[1] ? `<img src="${state.spreadSrcs[1]}" style="${cssText(computeImgStyle(state.spreadNaturalSizes[1].w, state.spreadNaturalSizes[1].h))}" draggable="false">` : ''}
              </div>
            ` : state.imgSrc ? `<img src="${state.imgSrc}" style="${cssText({ ...imgStyle, boxShadow: '0 10px 40px rgba(0,0,0,0.7)', display: 'block' })}" draggable="false">` : ''}
          </div>
        </div>

        <div id="page-overlay" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9;opacity:${state.pageOverlayVisible ? 1 : 0};transition:opacity 1000ms ease;color:rgba(255,255,255,0.28);text-shadow:0 10px 30px rgba(0,0,0,0.7);font-size:${Math.max(128, Math.min(Math.min(window.innerWidth * 0.35, window.innerHeight * 0.45), 360))}px;font-weight:800;letter-spacing:-0.05em;">${state.pageOverlay}</div>

        <div id="zoom-controls" style="${zoomControlStyle}">
          <button id="zoom-in" style="width:30px;height:30px;padding:0;border-radius:999px;background:#334155;color:white;border:none;cursor:pointer;font-size:16px;line-height:1;">+</button>
          <input id="zoom-range" type="range" min="100" max="300" step="10" value="${state.zoom}" style="writing-mode:vertical-lr;direction:rtl;width:28px;height:180px;accent-color:#60a5fa;">
          <div style="min-width:42px;text-align:center;color:#cbd5e1;font-size:11px;">${state.zoom}%</div>
          <button id="zoom-out" style="width:30px;height:30px;padding:0;border-radius:999px;background:#334155;color:white;border:none;cursor:pointer;font-size:16px;line-height:1;">−</button>
        </div>

        ${!state.toolbarPinned && !state.toolbarVisible ? `<div id="toolbar-handle" style="position:fixed;top:0;left:50%;transform:translateX(-50%);width:72px;height:10px;border-radius:0 0 10px 10px;background:rgba(148,163,184,0.18);z-index:20;cursor:pointer;"></div>` : ''}
      </div>`;

    viewerRef = document.getElementById('viewer');
    zoomControlsRef = document.getElementById('zoom-controls');
    pageOverlayRef = document.getElementById('page-overlay');
    const toolbar = document.getElementById('toolbar');
    const zoomRange = document.getElementById('zoom-range');
    const zoomIn = document.getElementById('zoom-in');
    const zoomOut = document.getElementById('zoom-out');
    const toolbarHandle = document.getElementById('toolbar-handle');

    if (viewerRef) {
      viewerRef.onclick = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < rect.width * 0.3) prevPage();
        else if (x > rect.width * 0.7) nextPage();
      };
    }

    if (toolbar) {
      const prevBtn = toolbar.querySelector('[data-action="prev"]');
      const nextBtn = toolbar.querySelector('[data-action="next"]');
      const spreadBtn = toolbar.querySelector('[data-action="spread"]');
      const fitBtn = toolbar.querySelector('[data-action="fit"]');
      const pinBtn = toolbar.querySelector('[data-action="pin"]');
      if (prevBtn) prevBtn.onclick = prevPage;
      if (nextBtn) nextBtn.onclick = nextPage;
      if (spreadBtn) spreadBtn.onclick = toggleSpread;
      if (fitBtn) fitBtn.onclick = () => setZoom(state.zoom > 100 ? 100 : 130);
      if (pinBtn) pinBtn.onclick = togglePin;
    }

    if (zoomRange) zoomRange.oninput = (e) => setZoom(Number(e.target.value));
    if (zoomIn) zoomIn.onclick = () => setZoom(state.zoom + 10);
    if (zoomOut) zoomOut.onclick = () => setZoom(state.zoom - 10);
    if (toolbarHandle) toolbarHandle.onclick = () => {
      if (!state.toolbarVisible) toggleToolbarVisible();
    };

    syncZoomControlsOpacity();
    syncPageOverlay();
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') prevPage();
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextPage(); }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      if (viewerRef) {
        e.preventDefault();
        viewerRef.scrollBy({ top: -(viewerRef.clientHeight * 0.85), behavior: 'smooth' });
      }
    }
    if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      if (viewerRef) {
        e.preventDefault();
        viewerRef.scrollBy({ top: viewerRef.clientHeight * 0.85, behavior: 'smooth' });
      }
    }
    if (e.key === '+' || e.key === '=') setZoom(state.zoom + 10);
    if (e.key === '-') setZoom(state.zoom - 10);
    if (e.key.toLowerCase() === 's') toggleSpread();
    if (e.key.toLowerCase() === 'w') setZoom(state.zoom > 100 ? 100 : 130);
    if (e.key.toLowerCase() === 't') {
      toggleToolbarVisible();
    }
    if (e.key === 'Escape') {
      if (state.toolbarVisible) toggleToolbarVisible();
    }
  });

  window.addEventListener('popstate', () => {
    const url = new URL(window.location);
    state.page = parseInt(url.searchParams.get('page') || '0', 10) || 0;
    state.spread = url.searchParams.get('spread') === '1';
    state.zoom = parseInt(url.searchParams.get('zoom') || '100', 10) || 100;
    showPage(state.page);
  });

  window.addEventListener('pointermove', () => {
    revealZoomControls(1200);
  }, { passive: true });
  window.addEventListener('touchstart', () => {
    revealZoomControls(1200);
  }, { passive: true });

  window.addEventListener('resize', render);

  function toggleSpread() {
    state.spread = !state.spread;
    showPage(state.page);
  }

  showPage(state.page);
  render();
})();
