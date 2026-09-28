(function () {
  const COMIC = window.__COMIC__;
  if (!COMIC) return;
  const DEBUG = COMIC.debug === true;
  const PREFS_KEY = 'yacreaderweb_reader_prefs';
  const FLIP_MS = 500;

  function debugLog(...args) {
    if (DEBUG) console.log(...args);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }

  const app = document.getElementById('app');
  const state = {
    page: COMIC.initialPage,
    spread: COMIC.initialSpread,
    zoom: COMIC.initialZoom,
    toolbarPinned: COMIC.initialToolbarPinned !== false,
    toolbarVisible: COMIC.initialToolbarPinned !== false,
    showPageOverlay: COMIC.hasExplicitOverlay ? COMIC.initialOverlay !== false : true,
    showFlipAnim: COMIC.hasExplicitAnim ? COMIC.initialAnim !== false : true,
    rtl: COMIC.hasExplicitRtl ? COMIC.initialRtl === true : false,
    mode: COMIC.hasExplicitMode && COMIC.initialMode === 'vertical' ? 'vertical' : 'page',
    imgSrc: '',
    imgNaturalSize: { w: 0, h: 0 },
    spreadSrcs: ['', ''],
    spreadNaturalSizes: [{ w: 0, h: 0 }, { w: 0, h: 0 }],
    verticalSrcs: [],
    verticalSizes: [],
    verticalLoading: {},
    pageLabel: '',
    pageOverlay: '',
    pageOverlayVisible: false,
    isLoadingPage: false,
    zoomDimmed: false,
    menuOpen: false,
    editingPage: false,
    pageInputValue: '',
  };

  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (prefs && typeof prefs === 'object') {
      if (!COMIC.hasExplicitOverlay && typeof prefs.showPageOverlay === 'boolean') state.showPageOverlay = prefs.showPageOverlay;
      if (!COMIC.hasExplicitAnim && typeof prefs.showFlipAnim === 'boolean') state.showFlipAnim = prefs.showFlipAnim;
      if (!COMIC.hasExplicitRtl && typeof prefs.rtl === 'boolean') state.rtl = prefs.rtl;
      if (!COMIC.hasExplicitMode && (prefs.mode === 'vertical' || prefs.mode === 'page')) state.mode = prefs.mode;
    }
  } catch {}

  if (COMIC.allowResume) {
    try {
      const saved = JSON.parse(localStorage.getItem(COMIC.progressKey) || 'null');
      if (saved && Number.isInteger(saved.page) && !COMIC.hasExplicitPage) state.page = Math.max(0, Math.min(saved.page, COMIC.totalDisplayPages - 1));
      if (saved && typeof saved.spread === 'boolean' && !COMIC.hasExplicitSpread) state.spread = saved.spread;
      if (saved && Number.isInteger(saved.zoom) && !COMIC.hasExplicitZoom) state.zoom = Math.max(100, Math.min(saved.zoom, 300));
      if (saved && typeof saved.rtl === 'boolean' && !COMIC.hasExplicitRtl) state.rtl = saved.rtl;
      if (saved && (saved.mode === 'vertical' || saved.mode === 'page') && !COMIC.hasExplicitMode) state.mode = saved.mode;
    } catch {}
  }

  if (state.mode === 'vertical') state.spread = false;

  let viewerRef = null;
  let toolbarRef = null;
  let zoomControlsRef = null;
  let sideArrowLeftRef = null;
  let sideArrowRightRef = null;
  let toolbarToggleRef = null;
  let pageOverlayRef = null;
  let overlayTimer = null;
  let toolbarTimer = null;
  let zoomTimer = null;
  let flipTimer = null;
  let flipAnim = null;
  let verticalObserver = null;
  let verticalScrollRaf = 0;
  let lastPageTurnAt = 0;
  let pointerRevealAnchor = null;
  let lastPointerPosition = null;
  let lastToolbarShown = null;
  let firstPagePaint = true;
  let wheelZoomAcc = 0;

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function pageStep() {
    return state.spread && state.mode !== 'vertical' ? 2 : 1;
  }

  function clampPage(page) {
    return Math.max(0, Math.min(page, COMIC.totalDisplayPages - 1));
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        showPageOverlay: state.showPageOverlay,
        showFlipAnim: state.showFlipAnim,
        rtl: state.rtl,
        mode: state.mode,
      }));
    } catch {}
  }

  function syncToolbarChrome() {
    if (!toolbarRef) return;
    const visible = state.toolbarPinned || state.toolbarVisible;
    toolbarRef.style.height = visible ? '36px' : '0';
    toolbarRef.style.opacity = visible ? '1' : '0';
    toolbarRef.style.padding = visible ? '0 8px' : '0';
    toolbarRef.style.borderBottom = visible ? '1px solid var(--reader-toolbar-border)' : 'none';
    toolbarRef.style.pointerEvents = visible ? 'auto' : 'none';
  }

  function logToolbarEvent(kind, details = {}) {
    debugLog('[toolbar-state]', {
      kind,
      page: state.page,
      zoom: state.zoom,
      spread: state.spread,
      mode: state.mode,
      rtl: state.rtl,
      pinned: state.toolbarPinned,
      visible: state.toolbarVisible,
      loading: state.isLoadingPage,
      ...details,
    });
  }

  function syncZoomControlsOpacity() {
    if (!zoomControlsRef) return;
    zoomControlsRef.style.opacity = state.zoomDimmed ? '0.36' : '0.8';
  }

  function syncSideArrowOpacity() {
    const hide = state.mode === 'vertical' || state.zoomDimmed;
    const opacity = hide ? '0' : '0.42';
    if (sideArrowLeftRef) sideArrowLeftRef.style.opacity = opacity;
    if (sideArrowRightRef) sideArrowRightRef.style.opacity = opacity;
  }

  function syncToolbarToggleOpacity() {
    if (!toolbarToggleRef) return;
    toolbarToggleRef.style.opacity = state.zoomDimmed ? '0.36' : '0.8';
  }

  function syncPageOverlay() {
    if (!pageOverlayRef) return;
    if (state.isLoadingPage) {
      pageOverlayRef.innerHTML = '<div id="loading-ring" class="loading-ring" role="status" aria-label="Loading page"></div>';
    } else {
      pageOverlayRef.textContent = state.showPageOverlay ? state.pageOverlay : '';
    }
    pageOverlayRef.style.background = state.isLoadingPage ? 'radial-gradient(circle, color-mix(in srgb, var(--reader-toolbar-bg) 36%, transparent) 0%, rgba(0,0,0,0) 58%)' : 'transparent';
    pageOverlayRef.style.opacity = state.pageOverlayVisible ? '1' : '0';
  }

  function pageInputDisplay() {
    if (state.editingPage) return state.pageInputValue;
    return state.page === 0 ? 'Cover' : String(state.page);
  }

  function syncPageChrome() {
    const input = document.getElementById('page-input');
    const total = document.getElementById('page-total');
    const range = document.getElementById('page-range');
    if (input && !state.editingPage) input.value = pageInputDisplay();
    if (total) total.textContent = ' / ' + COMIC.totalDisplayPages;
    if (range) range.value = String(state.page);
    state.pageLabel = pageLabelFor(state.page) + ' / ' + COMIC.totalDisplayPages;
    const spreadBtn = document.querySelector('[data-action="spread"]');
    if (spreadBtn) {
      spreadBtn.textContent = state.mode === 'vertical' ? 'Vertical' : (state.spread ? 'Spread' : 'Single');
    }
  }

  function scheduleZoomFade(delay = 1000) {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      state.zoomDimmed = true;
      syncZoomControlsOpacity();
      syncSideArrowOpacity();
      syncToolbarToggleOpacity();
    }, delay);
  }

  function revealZoomControls(delay = 1000) {
    const wasDimmed = state.zoomDimmed;
    state.zoomDimmed = false;
    scheduleZoomFade(delay);
    if (wasDimmed) {
      syncZoomControlsOpacity();
      syncSideArrowOpacity();
      syncToolbarToggleOpacity();
    }
  }

  function scheduleToolbarFade(delay = 1000) {
    clearTimeout(toolbarTimer);
    toolbarTimer = setTimeout(() => {
      if (state.toolbarPinned || !state.toolbarVisible) return;
      state.toolbarVisible = false;
      syncToolbarChrome();
      logToolbarEvent('hide-applied', { toolbarShown: state.toolbarPinned || state.toolbarVisible });
    }, delay);
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

  function prefetchImage(src) {
    if (!src) return;
    const img = new Image();
    img.src = src;
  }

  function pushUrl(replace = false) {
    const url = new URL(window.location);
    url.searchParams.set('page', String(state.page));
    url.searchParams.set('spread', state.spread ? '1' : '0');
    url.searchParams.set('zoom', String(state.zoom));
    url.searchParams.set('pin', state.toolbarPinned ? '1' : '0');
    url.searchParams.set('overlay', state.showPageOverlay ? '1' : '0');
    url.searchParams.set('anim', state.showFlipAnim ? '1' : '0');
    url.searchParams.set('rtl', state.rtl ? '1' : '0');
    url.searchParams.set('mode', state.mode);
    if (replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
  }

  function persist() {
    try {
      localStorage.setItem(COMIC.progressKey, JSON.stringify({
        page: state.page,
        spread: state.spread,
        zoom: state.zoom,
        rtl: state.rtl,
        mode: state.mode,
      }));
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

  function fittedVerticalSize(naturalW, naturalH) {
    const availW = Math.max(80, (viewerRef ? viewerRef.clientWidth : window.innerWidth) - 32);
    const targetW = Math.round(availW * state.zoom / 100);
    if (!naturalW || !naturalH) {
      return { w: targetW, h: Math.round(targetW * 4 / 3) };
    }
    return { w: targetW, h: Math.round(targetW * naturalH / naturalW) };
  }

  function cssText(style) {
    return Object.entries(style).map(([key, value]) => `${key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${value}`).join(';');
  }

  function captureFlip(dir) {
    clearTimeout(flipTimer);
    const stage = document.getElementById('page-stage');
    if (!state.showFlipAnim || !stage || !stage.querySelector('img') || prefersReducedMotion()) {
      flipAnim = null;
      return;
    }
    flipAnim = { html: stage.innerHTML, dir: dir || 1 };
  }

  function clearFlipAnim() {
    clearTimeout(flipTimer);
    flipAnim = null;
    const outgoing = document.getElementById('page-outgoing');
    if (outgoing) outgoing.remove();
  }

  function completePageLoad(page, applyLoadedState) {
    applyLoadedState();
    state.isLoadingPage = false;
    if (state.showPageOverlay && state.mode !== 'vertical') {
      state.pageOverlay = page === 0 ? 'Cover' : String(page);
      state.pageOverlayVisible = true;
    } else {
      state.pageOverlay = '';
      state.pageOverlayVisible = false;
    }
    firstPagePaint = false;
    render();
    clearTimeout(overlayTimer);
    if (state.showPageOverlay && state.pageOverlayVisible) {
      overlayTimer = setTimeout(() => {
        state.pageOverlayVisible = false;
        syncPageOverlay();
      }, 500);
    }
    if (flipAnim) {
      const outgoing = document.getElementById('page-outgoing');
      flipTimer = setTimeout(() => {
        flipAnim = null;
        if (outgoing && outgoing.parentNode) outgoing.remove();
      }, FLIP_MS + 20);
    }
  }

  function showPage(page, opts = {}) {
    lastPageTurnAt = Date.now();
    pointerRevealAnchor = lastPointerPosition;
    if (!state.toolbarPinned) {
      state.toolbarVisible = false;
      syncToolbarChrome();
    }

    if (state.mode === 'vertical') {
      clearFlipAnim();
      scrollToVerticalPage(page, opts.snap ? 'auto' : 'smooth');
      persist();
      pushUrl(true);
      syncPageChrome();
      return;
    }

    if (opts.animate && state.showFlipAnim && !firstPagePaint) captureFlip(opts.dir || 1);
    else clearFlipAnim();

    state.pageOverlay = '';
    state.pageOverlayVisible = true;
    state.isLoadingPage = true;
    state.zoomDimmed = false;

    clearTimeout(overlayTimer);
    scheduleZoomFade(1000);

    if (state.spread && page > 0) {
      const pages = getSpreadPages(page);
      const label = pages.length === 2 ? pages[0] + '-' + pages[1] : pageLabelFor(pages[0]);
      state.pageLabel = label + ' / ' + COMIC.totalDisplayPages;
      Promise.all(pages.map((p) => loadImage(pageUrl(p)))).then((imgs) => {
        completePageLoad(page, () => {
          state.spreadSrcs = imgs.map((i) => i.src);
          state.spreadNaturalSizes = imgs.map((i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
        });
        prefetchImage(pageUrl(Math.min(page + pageStep(), COMIC.totalDisplayPages - 1)));
      }).catch(() => {});
    } else {
      const src = pageUrl(page);
      state.pageLabel = pageLabelFor(page) + ' / ' + COMIC.totalDisplayPages;
      loadImage(src).then((img) => {
        completePageLoad(page, () => {
          state.imgSrc = img.src;
          state.imgNaturalSize = { w: img.naturalWidth, h: img.naturalHeight };
          state.spreadSrcs = ['', ''];
        });
        prefetchImage(pageUrl(Math.min(page + pageStep(), COMIC.totalDisplayPages - 1)));
      }).catch(() => {});
    }

    if (viewerRef) viewerRef.scrollTop = 0;
    persist();
    pushUrl(true);
    render();
  }

  function goToPage(page, opts = {}) {
    state.page = clampPage(page);
    showPage(state.page, opts);
  }

  function prevPage() {
    const to = clampPage(state.page - pageStep());
    debugLog('[page-advance]', { source: 'prevPage', from: state.page, to });
    if (to === state.page && state.mode !== 'vertical') return;
    state.page = to;
    showPage(state.page, { animate: true, dir: -1 });
  }

  function nextPage() {
    const to = clampPage(state.page + pageStep());
    debugLog('[page-advance]', { source: 'nextPage', from: state.page, to });
    if (to === state.page && state.mode !== 'vertical') return;
    state.page = to;
    showPage(state.page, { animate: true, dir: 1 });
  }

  function leftAction() {
    if (state.mode === 'vertical') {
      scrollVerticalBy(state.rtl ? 1 : -1);
      return;
    }
    if (state.rtl) nextPage();
    else prevPage();
  }

  function rightAction() {
    if (state.mode === 'vertical') {
      scrollVerticalBy(state.rtl ? -1 : 1);
      return;
    }
    if (state.rtl) prevPage();
    else nextPage();
  }

  function toggleSpread() {
    if (state.mode === 'vertical') {
      setReadingMode('single');
      return;
    }
    state.spread = !state.spread;
    persist();
    savePrefs();
    showPage(state.page);
  }

  function setReadingMode(next) {
    const prevMode = state.mode;
    if (next === 'vertical') {
      state.mode = 'vertical';
      state.spread = false;
    } else {
      state.mode = 'page';
      state.spread = next === 'spread';
    }
    state.menuOpen = false;
    savePrefs();
    persist();
    pushUrl(true);
    if (state.mode === 'vertical') {
      clearFlipAnim();
      state.isLoadingPage = true;
      state.pageOverlayVisible = true;
      render();
      requestAnimationFrame(() => {
        scrollToVerticalPage(state.page, 'auto');
        ensureVerticalRange(state.page);
      });
    } else if (prevMode === 'vertical' || next !== 'vertical') {
      disconnectVerticalObserver();
      showPage(state.page);
    }
  }

  function togglePin() {
    state.toolbarPinned = !state.toolbarPinned;
    if (state.toolbarPinned) {
      state.toolbarVisible = true;
    }
    if (!state.toolbarPinned) state.toolbarVisible = false;
    syncToolbarChrome();
    pushUrl(true);
    render();
  }

  function toggleToolbarVisible() {
    if (state.toolbarPinned) return;
    state.toolbarVisible = !state.toolbarVisible;
    syncToolbarChrome();
    pushUrl(true);
    render();
  }

  function toggleMenu() {
    state.menuOpen = !state.menuOpen;
    render();
  }

  function toggleOverlayPref() {
    state.showPageOverlay = !state.showPageOverlay;
    if (!state.showPageOverlay) {
      state.pageOverlay = '';
      if (!state.isLoadingPage) state.pageOverlayVisible = false;
    }
    savePrefs();
    pushUrl(true);
    render();
  }

  function toggleAnimPref() {
    state.showFlipAnim = !state.showFlipAnim;
    if (!state.showFlipAnim) clearFlipAnim();
    savePrefs();
    pushUrl(true);
    render();
  }

  function toggleRtlPref() {
    state.rtl = !state.rtl;
    savePrefs();
    persist();
    pushUrl(true);
    render();
  }

  function setZoom(next) {
    const clamped = Math.max(100, Math.min(next, 300));
    if (clamped === state.zoom) return;
    state.zoom = clamped;
    persist();
    pushUrl(true);
    render();
  }

  function commitPageInput() {
    const raw = String(state.pageInputValue || '').trim().toLowerCase();
    state.editingPage = false;
    let next;
    if (raw === '' || raw === 'cover') next = 0;
    else {
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n)) {
        syncPageChrome();
        return;
      }
      next = n;
    }
    next = clampPage(next);
    if (next === state.page) {
      syncPageChrome();
      return;
    }
    goToPage(next, { snap: true });
  }

  function bindPageInput(input) {
    if (!input) return;
    input.onfocus = () => {
      state.editingPage = true;
      state.pageInputValue = String(state.page);
      input.value = state.pageInputValue;
      input.select();
    };
    input.oninput = (e) => {
      state.pageInputValue = e.target.value;
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        state.editingPage = false;
        input.value = pageInputDisplay();
        input.blur();
      }
    };
    input.onblur = () => {
      if (!state.editingPage) {
        syncPageChrome();
        return;
      }
      commitPageInput();
    };
  }

  function bindPageRange(range) {
    if (!range) return;
    range.oninput = (e) => {
      const next = Number(e.target.value);
      const input = document.getElementById('page-input');
      if (input && !state.editingPage) input.value = next === 0 ? 'Cover' : String(next);
    };
    range.onchange = (e) => {
      const next = clampPage(Number(e.target.value));
      if (next === state.page) return;
      goToPage(next, { snap: true });
    };
  }

  function scrollVerticalBy(sign) {
    if (!viewerRef) return;
    viewerRef.scrollBy({ top: viewerRef.clientHeight * 0.9 * sign, behavior: 'smooth' });
  }

  function scrollToVerticalPage(page, behavior) {
    if (!viewerRef) return;
    const el = viewerRef.querySelector('.v-page[data-page="' + page + '"]');
    if (el) el.scrollIntoView({ behavior: behavior || 'smooth', block: 'start' });
    ensureVerticalRange(page);
  }

  function disconnectVerticalObserver() {
    if (verticalObserver) {
      verticalObserver.disconnect();
      verticalObserver = null;
    }
  }

  function paintVerticalSlot(page) {
    if (!viewerRef) return;
    const el = viewerRef.querySelector('.v-page[data-page="' + page + '"]');
    if (!el) return;
    const oldH = el.offsetHeight;
    const src = state.verticalSrcs[page];
    const size = fittedVerticalSize(state.verticalSizes[page] && state.verticalSizes[page].w, state.verticalSizes[page] && state.verticalSizes[page].h);
    el.style.width = size.w + 'px';
    if (src) {
      el.style.height = 'auto';
      if (!el.querySelector('img')) {
        el.innerHTML = '<img src="' + src + '" alt="" style="width:100%;height:auto;display:block;" draggable="false">';
      } else {
        el.querySelector('img').src = src;
      }
    } else {
      el.style.height = size.h + 'px';
      el.innerHTML = '';
    }
    if (page < state.page) {
      const delta = el.offsetHeight - oldH;
      if (delta) viewerRef.scrollTop += delta;
    }
  }

  function loadVerticalPage(page) {
    if (page < 0 || page >= COMIC.totalDisplayPages) return;
    if (state.verticalSrcs[page] || state.verticalLoading[page]) return;
    state.verticalLoading[page] = true;
    loadImage(pageUrl(page)).then((img) => {
      state.verticalSrcs[page] = img.src;
      state.verticalSizes[page] = { w: img.naturalWidth, h: img.naturalHeight };
      state.verticalLoading[page] = false;
      paintVerticalSlot(page);
      if (page === state.page && state.isLoadingPage) {
        state.isLoadingPage = false;
        state.pageOverlayVisible = false;
        firstPagePaint = false;
        syncPageOverlay();
      }
    }).catch(() => {
      state.verticalLoading[page] = false;
    });
  }

  function ensureVerticalRange(center) {
    const total = COMIC.totalDisplayPages;
    for (let i = 0; i < total; i++) {
      if (Math.abs(i - center) <= 2) loadVerticalPage(i);
      else if (Math.abs(i - center) > 8 && state.verticalSrcs[i]) {
        state.verticalSrcs[i] = '';
        state.verticalSizes[i] = null;
        paintVerticalSlot(i);
      }
    }
  }

  function setupVerticalObserver() {
    disconnectVerticalObserver();
    if (!viewerRef || state.mode !== 'vertical') return;
    verticalObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const page = Number(entry.target.getAttribute('data-page'));
        if (Number.isFinite(page)) ensureVerticalRange(page);
      });
    }, { root: viewerRef, rootMargin: '200% 0px' });
    viewerRef.querySelectorAll('.v-page').forEach((el) => verticalObserver.observe(el));
  }

  function onVerticalScroll() {
    if (verticalScrollRaf) return;
    verticalScrollRaf = requestAnimationFrame(() => {
      verticalScrollRaf = 0;
      if (!viewerRef || state.mode !== 'vertical') return;
      const centerY = viewerRef.scrollTop + viewerRef.clientHeight / 2;
      let best = state.page;
      let bestDist = Infinity;
      viewerRef.querySelectorAll('.v-page').forEach((el) => {
        const mid = el.offsetTop + el.offsetHeight / 2;
        const dist = Math.abs(mid - centerY);
        if (dist < bestDist) {
          bestDist = dist;
          best = Number(el.getAttribute('data-page'));
        }
      });
      if (!Number.isFinite(best) || best === state.page) return;
      state.page = best;
      persist();
      pushUrl(true);
      syncPageChrome();
    });
  }

  function verticalSlotsHtml() {
    const parts = [];
    for (let i = 0; i < COMIC.totalDisplayPages; i++) {
      const src = state.verticalSrcs[i];
      const natural = state.verticalSizes[i] || {};
      const size = fittedVerticalSize(natural.w, natural.h);
      parts.push(
        '<div class="v-page" data-page="' + i + '" style="width:' + size.w + 'px;height:' + (src ? 'auto' : size.h + 'px') + ';margin:0 auto 12px;">' +
        (src ? '<img src="' + src + '" alt="" style="width:100%;height:auto;display:block;" draggable="false">' : '') +
        '</div>'
      );
    }
    return parts.join('');
  }

  function modeLabel() {
    if (state.mode === 'vertical') return 'Vertical';
    return state.spread ? 'Spread' : 'Single';
  }

  function menuHtml() {
    if (!state.menuOpen) return '';
    const overlayOn = state.showPageOverlay;
    const activeMode = state.mode === 'vertical' ? 'vertical' : (state.spread ? 'spread' : 'single');
    return `
      <div id="reader-menu" role="menu">
        <button type="button" data-pref="overlay" role="menuitem">
          <span>Page number flash</span><span>${overlayOn ? 'On' : 'Off'}</span>
        </button>
        <button type="button" data-pref="anim" role="menuitem">
          <span>Page flip animation</span><span>${state.showFlipAnim ? 'On' : 'Off'}</span>
        </button>
        <button type="button" data-pref="rtl" role="menuitem">
          <span>Right to left</span><span>${state.rtl ? 'On' : 'Off'}</span>
        </button>
        <div class="menu-label">Reading mode</div>
        <div class="menu-modes">
          <button type="button" data-mode="single" class="${activeMode === 'single' ? 'is-active' : ''}">Single</button>
          <button type="button" data-mode="spread" class="${activeMode === 'spread' ? 'is-active' : ''}">Spread</button>
          <button type="button" data-mode="vertical" class="${activeMode === 'vertical' ? 'is-active' : ''}">Vertical</button>
        </div>
      </div>`;
  }

  function pageStageHtml() {
    if (state.mode === 'vertical') return verticalSlotsHtml();

    const showSpread = state.spread && state.spreadSrcs[0];
    const imgStyle = showSpread ? {} : computeImgStyle(state.imgNaturalSize.w, state.imgNaturalSize.h);
    const srcs = showSpread && state.rtl ? state.spreadSrcs.slice().reverse() : state.spreadSrcs;
    const sizes = showSpread && state.rtl ? state.spreadNaturalSizes.slice().reverse() : state.spreadNaturalSizes;
    const visualDir = flipAnim && !state.isLoadingPage ? (state.rtl ? -flipAnim.dir : flipAnim.dir) : 0;
    const enterClass = visualDir > 0 ? 'page-enter-next' : visualDir < 0 ? 'page-enter-prev' : '';

    const inner = showSpread
      ? `<div style="display:flex;gap:8px;align-items:center;">
          ${srcs[0] ? `<img src="${srcs[0]}" style="${cssText(computeImgStyle(sizes[0].w, sizes[0].h))}" draggable="false">` : ''}
          ${srcs[1] ? `<img src="${srcs[1]}" style="${cssText(computeImgStyle(sizes[1].w, sizes[1].h))}" draggable="false">` : ''}
        </div>`
      : (state.imgSrc ? `<img src="${state.imgSrc}" style="${cssText({ ...imgStyle, boxShadow: '0 10px 40px rgba(0,0,0,0.7)', display: 'block' })}" draggable="false">` : '');

    const outgoing = flipAnim && !state.isLoadingPage
      ? `<div id="page-outgoing" class="${visualDir > 0 ? 'page-exit-next' : 'page-exit-prev'}" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:2;pointer-events:none;">${flipAnim.html}</div>`
      : '';

    return `<div id="page-stage" class="${enterClass}" style="position:relative;z-index:1;display:flex;align-items:center;justify-content:center;min-width:${state.zoom > 100 ? 'max-content' : '100%'};min-height:${state.zoom > 100 ? 'max-content' : '100%'};padding:0 16px;">${inner}</div>${outgoing}`;
  }

  function render() {
    const toolbarShown = state.toolbarPinned || state.toolbarVisible;
    const toolbarToggleShown = !state.toolbarPinned && !state.toolbarVisible;
    const vertical = state.mode === 'vertical';
    const sideArrowOpacity = vertical || state.zoomDimmed ? 0 : 0.42;
    const safeAreaTop = 'var(--safe-area-top, env(safe-area-inset-top, 0px))';
    const safeAreaBottom = 'var(--safe-area-bottom, env(safe-area-inset-bottom, 0px))';
    const mobilePwaTopOffset = 'var(--mobile-pwa-top-offset, 0px)';
    const readerChromeHeight = toolbarShown ? '36px' : '32px';
    const viewerTopInset = 'calc(' + safeAreaTop + ' + ' + mobilePwaTopOffset + ' + ' + readerChromeHeight + ')';
    const viewerBottomInset = 'calc(16px + ' + safeAreaBottom + ')';
    const viewerOverflow = vertical || state.zoom > 100 ? 'auto' : 'hidden';
    const viewerAlign = vertical || state.zoom > 100 ? 'flex-start' : 'center';
    const lastPage = Math.max(0, COMIC.totalDisplayPages - 1);
    const zoomControlStyle = [
      'position:fixed', 'right:12px', 'top:calc(50% + (' + safeAreaTop + ' - ' + safeAreaBottom + ') / 2)', 'transform:translateY(-50%)',
      'z-index:10', 'display:flex', 'flex-direction:column', 'align-items:center',
      'gap:8px', 'padding:10px 8px', 'border-radius:999px',
      'background:var(--reader-chrome-bg)', 'border:1px solid var(--reader-toolbar-border)',
      'box-shadow:0 12px 30px rgba(0,0,0,0.35)',
      'backdrop-filter:blur(12px)',
      'opacity:' + (state.zoomDimmed ? 0.36 : 0.8),
      'transition:opacity 200ms ease',
    ].join(';');

    const btn = (action, extra, label) =>
      `<button data-action="${action}" style="background:${extra};color:var(--reader-button-text);border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">${label}</button>`;

    app.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100vh;background:#000;overflow:hidden">
        <div id="toolbar" style="position:fixed;top:calc(${safeAreaTop});left:0;right:0;height:${toolbarShown ? '36px' : '0'};opacity:${toolbarShown ? '1' : '0'};overflow:hidden;z-index:19;transition:height 160ms ease, opacity 200ms ease;background:var(--reader-toolbar-bg);border-bottom:${toolbarShown ? '1px solid var(--reader-toolbar-border)' : 'none'};display:flex;align-items:center;padding:${toolbarShown ? '0 8px' : '0'};gap:8px;font-size:12px;pointer-events:${toolbarShown ? 'auto' : 'none'};backdrop-filter:blur(12px);">
          ${toolbarShown ? `<a href="${COMIC.backUrl}" style="background:var(--reader-button-secondary-bg);color:var(--reader-button-text);border:none;padding:3px 8px;border-radius:4px;font-size:11px;text-decoration:none;display:inline-block;flex-shrink:0;">← Back</a>` : ''}
          ${toolbarShown ? `<div class="toolbar-title" style="flex:1;min-width:40px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${COMIC.title}</div>` : ''}
          ${toolbarShown ? `<input id="page-range" type="range" min="0" max="${lastPage}" step="1" value="${state.page}" aria-label="Page progress">` : ''}
          ${toolbarShown ? btn('prev', 'var(--reader-button-secondary-bg)', '◀') : ''}
          ${toolbarShown ? `<label class="page-label"><input id="page-input" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Current page" value="${pageInputDisplay()}"><span id="page-total"> / ${COMIC.totalDisplayPages}</span></label>` : ''}
          ${toolbarShown ? btn('next', 'var(--reader-button-secondary-bg)', '▶') : ''}
          ${toolbarShown ? btn('spread', 'var(--reader-button-bg)', modeLabel()) : ''}
          ${toolbarShown ? btn('fit', 'var(--reader-button-bg)', state.zoom > 100 ? 'Fit Width' : 'Fit Screen') : ''}
          ${toolbarShown ? btn('menu', 'var(--reader-button-secondary-bg)', '⋯') : ''}
          ${toolbarShown ? `<button data-action="pin" style="background:${state.toolbarPinned ? 'var(--reader-button-active-bg)' : 'var(--reader-button-secondary-bg)'};color:var(--reader-button-text);border:none;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;min-width:28px;">${state.toolbarPinned ? '📌' : '📍'}</button>` : ''}
        </div>

        ${toolbarToggleShown ? `<div id="page-range-wrap"><input id="page-range" type="range" min="0" max="${lastPage}" step="1" value="${state.page}" aria-label="Page progress"></div>` : ''}

        <div id="viewer" style="position:relative;flex:1;overflow:${viewerOverflow};background:#000;display:flex;flex-direction:${vertical ? 'column' : 'row'};align-items:${viewerAlign};justify-content:${vertical ? 'flex-start' : 'center'};cursor:pointer;min-height:0;padding:${viewerTopInset} 0 ${viewerBottomInset};">
          <div id="side-arrow-left" style="position:absolute;left:16px;top:50%;transform:translateY(-50%);pointer-events:none;z-index:8;color:rgba(255,255,255,0.42);opacity:${sideArrowOpacity};transition:opacity 200ms ease;text-shadow:0 10px 30px rgba(0,0,0,0.72);font-size:min(14vw,88px);font-weight:800;line-height:1;">&lt;</div>
          <div id="side-arrow-right" style="position:absolute;right:16px;top:50%;transform:translateY(-50%);pointer-events:none;z-index:8;color:rgba(255,255,255,0.42);opacity:${sideArrowOpacity};transition:opacity 200ms ease;text-shadow:0 10px 30px rgba(0,0,0,0.72);font-size:min(14vw,88px);font-weight:800;line-height:1;">&gt;</div>
          ${pageStageHtml()}
        </div>

        <div id="page-overlay" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9;opacity:${state.pageOverlayVisible ? 1 : 0};transition:opacity 500ms ease, background 200ms ease;background:${state.isLoadingPage ? 'radial-gradient(circle, color-mix(in srgb, var(--reader-toolbar-bg) 36%, transparent) 0%, rgba(0,0,0,0) 58%)' : 'transparent'};color:rgba(255,255,255,0.68);text-shadow:0 10px 30px rgba(0,0,0,0.7);font-size:${Math.max(128, Math.min(Math.min(window.innerWidth * 0.35, window.innerHeight * 0.45), 360))}px;font-weight:800;letter-spacing:-0.05em;">${state.isLoadingPage ? '<div id="loading-ring" class="loading-ring" role="status" aria-label="Loading page"></div>' : (state.showPageOverlay ? state.pageOverlay : '')}</div>

        <div id="zoom-controls" style="${zoomControlStyle}">
          <button id="zoom-in" style="width:30px;height:30px;padding:0;border-radius:999px;background:var(--reader-button-secondary-bg);color:var(--reader-button-text);border:none;cursor:pointer;font-size:16px;line-height:1;">+</button>
          <input id="zoom-range" type="range" min="100" max="300" step="10" value="${state.zoom}" style="writing-mode:vertical-lr;direction:rtl;width:28px;height:180px;accent-color:var(--reader-range-accent);">
          <div style="min-width:42px;text-align:center;color:var(--reader-text-dim);font-size:11px;">${state.zoom}%</div>
          <button id="zoom-out" style="width:30px;height:30px;padding:0;border-radius:999px;background:var(--reader-button-secondary-bg);color:var(--reader-button-text);border:none;cursor:pointer;font-size:16px;line-height:1;">−</button>
        </div>

        ${toolbarToggleShown ? `<button id="toolbar-toggle" style="position:fixed;top:calc(${safeAreaTop} + ${mobilePwaTopOffset});left:50%;transform:translateX(-50%);min-width:112px;height:32px;padding:0 18px 8px;border:none;border-radius:0 0 14px 14px;border-bottom:1px solid var(--reader-toolbar-border);border-left:1px solid var(--reader-toolbar-border);border-right:1px solid var(--reader-toolbar-border);background:var(--reader-chrome-bg-soft);color:var(--reader-text-dim);z-index:20;font-size:11px;font-weight:500;letter-spacing:0.04em;line-height:1;opacity:${state.zoomDimmed ? 0.36 : 0.8};backdrop-filter:blur(12px);">▼ menu</button>` : ''}
        ${menuHtml()}
      </div>`;

    viewerRef = document.getElementById('viewer');
    toolbarRef = document.getElementById('toolbar');
    zoomControlsRef = document.getElementById('zoom-controls');
    sideArrowLeftRef = document.getElementById('side-arrow-left');
    sideArrowRightRef = document.getElementById('side-arrow-right');
    toolbarToggleRef = document.getElementById('toolbar-toggle');
    pageOverlayRef = document.getElementById('page-overlay');
    const toolbar = toolbarRef;
    const zoomRange = document.getElementById('zoom-range');
    const zoomIn = document.getElementById('zoom-in');
    const zoomOut = document.getElementById('zoom-out');
    const pageRange = document.getElementById('page-range');
    const pageInput = document.getElementById('page-input');
    const toolbarToggle = document.getElementById('toolbar-toggle');
    const readerMenu = document.getElementById('reader-menu');

    if (lastToolbarShown !== toolbarShown) {
      logToolbarEvent(toolbarShown ? 'draw-show' : 'draw-hide', {
        toolbarShown,
        toolbarToggle: Boolean(toolbarToggle),
        toolbarHeight: toolbarShown ? '36px' : '0',
        viewerOverflow,
        hasImage: Boolean(state.imgSrc),
        mode: state.mode,
      });
      lastToolbarShown = toolbarShown;
    }

    if (viewerRef) {
      viewerRef.onclick = (e) => {
        if (e.target.closest('#reader-menu') || e.target.closest('#toolbar') || e.target.closest('#page-range-wrap')) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        debugLog('[viewer-click]', {
          clientX: e.clientX,
          x,
          zone: x < rect.width * 0.3 ? 'left' : x > rect.width * 0.7 ? 'right' : 'middle',
          rtl: state.rtl,
          mode: state.mode,
        });
        if (x < rect.width * 0.3) leftAction();
        else if (x > rect.width * 0.7) rightAction();
      };
      viewerRef.onscroll = vertical ? onVerticalScroll : null;
    }

    if (toolbar) {
      const prevBtn = toolbar.querySelector('[data-action="prev"]');
      const nextBtn = toolbar.querySelector('[data-action="next"]');
      const spreadBtn = toolbar.querySelector('[data-action="spread"]');
      const fitBtn = toolbar.querySelector('[data-action="fit"]');
      const pinBtn = toolbar.querySelector('[data-action="pin"]');
      const menuBtn = toolbar.querySelector('[data-action="menu"]');
      if (prevBtn) prevBtn.onclick = leftAction;
      if (nextBtn) nextBtn.onclick = rightAction;
      if (spreadBtn) spreadBtn.onclick = toggleSpread;
      if (fitBtn) fitBtn.onclick = () => setZoom(state.zoom > 100 ? 100 : 130);
      if (pinBtn) pinBtn.onclick = togglePin;
      if (menuBtn) menuBtn.onclick = (e) => { e.stopPropagation(); toggleMenu(); };
    }

    if (readerMenu) {
      const overlayBtn = readerMenu.querySelector('[data-pref="overlay"]');
      const animBtn = readerMenu.querySelector('[data-pref="anim"]');
      const rtlBtn = readerMenu.querySelector('[data-pref="rtl"]');
      if (overlayBtn) overlayBtn.onclick = toggleOverlayPref;
      if (animBtn) animBtn.onclick = toggleAnimPref;
      if (rtlBtn) rtlBtn.onclick = toggleRtlPref;
      readerMenu.querySelectorAll('[data-mode]').forEach((btn) => {
        btn.onclick = () => setReadingMode(btn.getAttribute('data-mode'));
      });
    }

    if (zoomRange) {
      zoomRange.oninput = (e) => {
        const next = Number(e.target.value);
        const scale = next / state.zoom;
        const img = viewerRef && viewerRef.querySelector('img');
        if (img) img.style.transform = `scale(${scale})`;
        const zoomLabel = zoomControlsRef && zoomControlsRef.querySelector('div');
        if (zoomLabel) zoomLabel.textContent = next + '%';
      };
      zoomRange.onchange = (e) => {
        const img = viewerRef && viewerRef.querySelector('img');
        if (img) img.style.transform = '';
        setZoom(Number(e.target.value));
      };
    }
    if (zoomIn) zoomIn.onclick = () => setZoom(state.zoom + 10);
    if (zoomOut) zoomOut.onclick = () => setZoom(state.zoom - 10);
    bindPageRange(pageRange);
    bindPageInput(pageInput);
    if (toolbarToggle) toolbarToggle.onclick = toggleToolbarVisible;

    if (state.editingPage && pageInput) {
      pageInput.focus();
      pageInput.value = state.pageInputValue;
    }

    syncToolbarChrome();
    syncZoomControlsOpacity();
    syncSideArrowOpacity();
    syncToolbarToggleOpacity();
    syncPageOverlay();

    if (vertical) {
      setupVerticalObserver();
      ensureVerticalRange(state.page);
      const currentSlot = viewerRef && viewerRef.querySelector('.v-page[data-page="' + state.page + '"]');
      if (currentSlot) currentSlot.scrollIntoView({ block: 'start' });
    } else {
      disconnectVerticalObserver();
    }
  }

  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    if (e.key === 'Escape' && state.menuOpen) {
      e.preventDefault();
      state.menuOpen = false;
      const menu = document.getElementById('reader-menu');
      if (menu) menu.remove();
      return;
    }
    if (e.key === 'ArrowLeft') leftAction();
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); rightAction(); }
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
      if (window.matchMedia('(max-width: 900px)').matches) return;
      window.location.href = COMIC.escapeUrl || COMIC.backUrl || '/';
    }
  });

  window.addEventListener('pointerdown', (e) => {
    if (!state.menuOpen) return;
    if (e.target.closest('#reader-menu') || e.target.closest('[data-action="menu"]')) return;
    state.menuOpen = false;
    const menu = document.getElementById('reader-menu');
    if (menu) menu.remove();
  });

  window.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    wheelZoomAcc += e.deltaY;
    if (Math.abs(wheelZoomAcc) < 20) return;
    const dir = wheelZoomAcc < 0 ? 10 : -10;
    wheelZoomAcc = 0;
    setZoom(state.zoom + dir);
  }, { passive: false });

  window.addEventListener('popstate', () => {
    const url = new URL(window.location);
    state.page = parseInt(url.searchParams.get('page') || '0', 10) || 0;
    state.spread = url.searchParams.get('spread') === '1';
    state.zoom = parseInt(url.searchParams.get('zoom') || '100', 10) || 100;
    state.toolbarPinned = url.searchParams.get('pin') === '1';
    state.toolbarVisible = state.toolbarPinned;
    state.showPageOverlay = url.searchParams.get('overlay') !== '0';
    state.showFlipAnim = url.searchParams.get('anim') !== '0';
    state.rtl = url.searchParams.get('rtl') === '1';
    state.mode = url.searchParams.get('mode') === 'vertical' ? 'vertical' : 'page';
    if (state.mode === 'vertical') {
      state.spread = false;
      render();
      requestAnimationFrame(() => scrollToVerticalPage(state.page, 'auto'));
    } else {
      showPage(state.page);
    }
  });

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const nextPosition = { x: event.clientX, y: event.clientY };
    lastPointerPosition = nextPosition;
    revealZoomControls(1200);
  }, { passive: true });
  window.addEventListener('touchstart', () => {
    pointerRevealAnchor = null;
    revealZoomControls(1200);
  }, { passive: true });

  window.addEventListener('resize', render);

  if (state.mode === 'vertical') {
    state.pageLabel = pageLabelFor(state.page) + ' / ' + COMIC.totalDisplayPages;
    state.isLoadingPage = true;
    state.pageOverlayVisible = true;
    persist();
    pushUrl(true);
    render();
    requestAnimationFrame(() => {
      scrollToVerticalPage(state.page, 'auto');
      ensureVerticalRange(state.page);
    });
  } else {
    showPage(state.page);
  }
})();
