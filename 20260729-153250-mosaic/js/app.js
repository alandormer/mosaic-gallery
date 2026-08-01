const params = new URLSearchParams(window.location.search);
const mapUrl = params.get('map') || '../output/mosaic.json';
const imageOverride = params.get('image');
const targetOverride = params.get('target');
const galleryUrl = params.get('gallery') || 'gallery.html';
const publishedGallery = galleryUrl === '../index.html';

const STARTUP_STAGE_DEFS = [
  { key: 'manifest', label: 'Loading manifest' },
  { key: 'originalImage', label: 'Loading original image' },
  { key: 'mosaicImage', label: 'Loading mosaic image' },
  { key: 'initialFit', label: 'Calculating initial fit' },
  { key: 'hoverIndex', label: 'Building hover index' },
  { key: 'viewerReady', label: 'Viewer ready' },
  { key: 'showingOriginal', label: 'Showing original' },
  { key: 'revealAnimation', label: 'Playing reveal animation' },
  { key: 'viewerInteractive', label: 'Viewer interactive' },
];

const STARTUP_OVERLAY_CONFIG = {
  columns: 12,
  tileDurationMs: 320,
  staggerWindowMs: 1500,
  holdMs: 900,
  settleMs: 120,
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
  manifest: null,
  manifestUrl: null,
  mosaicUrl: null,
  originalUrl: null,
  hoverIndex: null,
  eventListenersBound: false,
  isInteractive: false,
  scale: 1,
  targetScale: 1,
  minScale: 0.08,
  maxScale: 16,
  panX: 0,
  panY: 0,
  targetPanX: 0,
  targetPanY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  panStartX: 0,
  panStartY: 0,
  hover: null,
  lastHoverTile: null,
  animationId: null,
  hoverTimeoutId: null,
  lastHoverTime: 0,
  previewTimeoutId: null,
  currentPreviewPath: '',
  fitPadding: 22,
  startupDebug: null,
  startupOriginalImage: null,
  datasetMode: 'interactive',
  interactiveDataAvailable: true,
  devChromeEnabled: !publishedGallery,
};

// Cache DOM elements (avoid repeated queries)
const dom = {
  startupDebugRows: document.getElementById('startupDebugRows'),
  startupDebugClose: document.getElementById('startupDebugClose'),
  devIndicator: document.getElementById('devIndicator'),
  devIndicatorClose: document.getElementById('devIndicatorClose'),
  startupReveal: document.getElementById('startupReveal'),
  startupLoading: document.getElementById('startupLoading'),
  startupLoadingText: document.getElementById('startupLoadingText'),
  startupOverlayGrid: document.getElementById('startupOverlayGrid'),
  backToGalleryBtn: document.getElementById('backToGalleryBtn'),
  infoPanel: document.querySelector('.info-panel'),
  viewport: document.getElementById('viewport'),
  mosaicLayer: document.getElementById('mosaicLayer'),
  mosaicImage: document.getElementById('mosaicImage'),
  tileHighlight: document.getElementById('tileHighlight'),
  sourcePreview: document.getElementById('sourcePreview'),
  sourceFilename: document.getElementById('sourceFilename'),
  sourceDate: document.getElementById('sourceDate'),
  tilePosition: document.getElementById('tilePosition'),
  status: document.getElementById('status'),
  zoomDisplay: document.getElementById('zoomDisplay'),
  overlay: document.getElementById('overlay'),
  overlayImage: document.getElementById('overlayImage'),
  overlayCaption: document.getElementById('overlayCaption'),
  overlayClose: document.getElementById('overlayClose'),
  fitBtn: document.getElementById('fitBtn'),
  oneToOneBtn: document.getElementById('oneToOneBtn'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
};

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
  initUi();
  try {
    if (state.devChromeEnabled) {
      initStartupDebug();
    }
    showStartupOverlay();
    state.isInteractive = false;

    setStartupLoadingText('Loading…');
    state.manifestUrl = new URL(mapUrl, window.location.href);

    startStartupStage('manifest');
    const manifest = await loadManifest(state.manifestUrl);
    completeStartupStage('manifest');
    state.manifest = manifest;
    state.interactiveDataAvailable = hasInteractiveDataset(manifest);
    state.datasetMode = state.interactiveDataAvailable ? 'interactive' : (manifest.dataset_mode || 'mosaic-only');
    applyDatasetModeUi();
    state.mosaicUrl = imageOverride
      ? new URL(imageOverride, window.location.href)
      : new URL(manifest.image.file, state.manifestUrl);

    // Load original image and mosaic image in parallel
    startStartupStage('originalImage');
    state.originalUrl = await resolveOriginalTargetUrl(manifest);
    const originalImagePromise = loadImageElement(state.originalUrl.href).then((img) => {
      state.startupOriginalImage = img;
      completeStartupStage('originalImage');
    });

    startStartupStage('mosaicImage');
    const mosaicImagePromise = loadImage(dom.mosaicImage, state.mosaicUrl.href).then(() => {
      completeStartupStage('mosaicImage');
    });

    await Promise.all([originalImagePromise, mosaicImagePromise]);

    if (!state.eventListenersBound) {
      setupEventListeners();
      state.eventListenersBound = true;
    }

    startStartupStage('initialFit');
    await waitForFrames(2);
    fitToWindow(false);
    await waitForFrames(1);
    fitToWindow(false);
    completeStartupStage('initialFit');

    startStartupStage('hoverIndex');
    if (state.interactiveDataAvailable) {
      buildHoverIndex();
      setDefaultPreviewTile();
      dom.status.textContent = `${manifest.grid.columns} × ${manifest.grid.rows} tiles`;
    } else {
      state.hoverIndex = null;
      dom.status.textContent = 'Mosaic only dataset';
    }
    completeStartupStage('hoverIndex');

    startStartupStage('viewerReady');
    completeStartupStage('viewerReady');

    startStartupStage('revealAnimation');
    await playStartupSequence(manifest);
    completeStartupStage('revealAnimation');

    startStartupStage('viewerInteractive');
    state.isInteractive = true;
    completeStartupStage('viewerInteractive');
  } catch (error) {
    state.isInteractive = false;
    logStartupEvent(`ERROR: ${String(error && error.message ? error.message : error)}`);
    showStartupError(error);
    dom.status.textContent = String(error.message || error);
  }
}

function initUi() {
  if (dom.backToGalleryBtn) {
    dom.backToGalleryBtn.href = galleryUrl;
  }

  if (state.devChromeEnabled) {
    if (dom.devIndicator) {
      dom.devIndicator.classList.remove('hidden');
    }
    const debugPanel = document.getElementById('startupDebug');
    if (debugPanel) {
      debugPanel.classList.remove('hidden');
    }
  }

  if (dom.devIndicatorClose) {
    dom.devIndicatorClose.addEventListener('click', () => {
      dom.devIndicator.classList.add('hidden');
    });
  }
  const debugPanel = document.getElementById('startupDebug');
  if (dom.startupDebugClose && debugPanel) {
    dom.startupDebugClose.addEventListener('click', () => {
      debugPanel.classList.add('hidden');
    });
  }
}

function initStartupDebug() {
  state.startupDebug = {
    sessionStartedAt: performance.now(),
    stages: new Map(),
    rows: new Map(),
  };

  dom.startupDebugRows.textContent = '';

  for (const stageDef of STARTUP_STAGE_DEFS) {
    const row = document.createElement('div');
    row.className = 'startup-debug-row';

    const mark = document.createElement('span');
    mark.className = 'startup-debug-mark';
    mark.textContent = '[ ]';

    const label = document.createElement('span');
    label.className = 'startup-debug-label';
    label.textContent = stageDef.label;

    const time = document.createElement('span');
    time.className = 'startup-debug-time';
    time.textContent = '—';

    row.append(mark, label, time);
    dom.startupDebugRows.appendChild(row);

    state.startupDebug.stages.set(stageDef.key, {
      key: stageDef.key,
      label: stageDef.label,
      startedAt: null,
      completedAt: null,
    });

    state.startupDebug.rows.set(stageDef.key, { row, mark, time });
  }

  logStartupEvent('SESSION START');
}

function startStartupStage(stageKey) {
  const stage = state.startupDebug && state.startupDebug.stages.get(stageKey);
  if (!stage || stage.startedAt !== null) return;
  stage.startedAt = performance.now();
  logStartupEvent(`START ${stage.label}`);
}

function completeStartupStage(stageKey) {
  const stage = state.startupDebug && state.startupDebug.stages.get(stageKey);
  const rowRef = state.startupDebug && state.startupDebug.rows.get(stageKey);
  if (!stage || !rowRef || stage.completedAt !== null) return;

  if (stage.startedAt === null) {
    stage.startedAt = performance.now();
  }

  stage.completedAt = performance.now();
  const elapsedMs = Math.round(stage.completedAt - stage.startedAt);

  rowRef.row.classList.add('done');
  rowRef.mark.textContent = '✓';
  rowRef.time.textContent = `${elapsedMs} ms`;

  logStartupEvent(`DONE  ${stage.label} (${elapsedMs} ms)`);
}

function logStartupEvent(message) {
  const now = performance.now();
  const sessionStart = state.startupDebug ? state.startupDebug.sessionStartedAt : now;
  const elapsed = now - sessionStart;
  const iso = new Date().toISOString();
  console.log(`[startup ${iso} +${elapsed.toFixed(1)}ms] ${message}`);
}

async function loadManifest(url) {
  const response = await fetch(url.href);
  if (!response.ok) {
    throw new Error(`Failed to load tile map: ${response.status}`);
  }
  return response.json();
}

function buildHoverIndex() {
  if (!state.manifest) {
    state.hoverIndex = null;
    return;
  }

  const manifest = state.manifest;
  const entries = new Array(manifest.tiles.length);

  for (let tileIndex = 0; tileIndex < manifest.tiles.length; tileIndex += 1) {
    const row = Math.floor(tileIndex / manifest.grid.columns);
    const col = tileIndex % manifest.grid.columns;
    const sourceId = manifest.tiles[tileIndex];
    entries[tileIndex] = {
      row,
      col,
      tileIndex,
      source: manifest.sources[sourceId],
      x0: manifest.grid.x_positions[col],
      x1: manifest.grid.x_positions[col + 1],
      y0: manifest.grid.y_positions[row],
      y1: manifest.grid.y_positions[row + 1],
    };
  }

  state.hoverIndex = entries;
}

async function resolveOriginalTargetUrl(manifest) {
  if (targetOverride) {
    const direct = new URL(targetOverride, window.location.href);
    if (await urlExists(direct)) {
      return direct;
    }
  }

  const manifestTargetFile = manifest && manifest.target && manifest.target.file;
  if (manifestTargetFile) {
    const fromManifest = new URL(manifestTargetFile, state.manifestUrl);
    if (await urlExists(fromManifest)) {
      return fromManifest;
    }
  }

  const stem = String(manifest.image.file || '').replace(/\.[^.]+$/, '');
  const candidates = [
    `../target/${stem}.jpg`,
    `../target/${stem}.jpeg`,
    `../target/${stem}.png`,
    `../target/${stem}.webp`,
    `../target/${stem}.heic`,
    `../target/${stem}.heif`,
    `../target/${stem}.JPG`,
    `../target/${stem}.JPEG`,
    `../target/${stem}.PNG`,
    `../target/${stem}.WEBP`,
    `../target/${stem}.HEIC`,
    `../target/${stem}.HEIF`,
  ];

  for (const relativePath of candidates) {
    const url = new URL(relativePath, window.location.href);
    if (await urlExists(url)) {
      return url;
    }
  }

  return state.mosaicUrl;
}

async function loadImageElement(src) {
  const img = new Image();
  await loadImage(img, src);
  return img;
}

async function urlExists(url) {
  try {
    const response = await fetch(url.href, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

function setStartupLoadingText(text) {
  dom.startupLoadingText.textContent = text;
}

function showStartupError(error) {
  const message = String(error && error.message ? error.message : error);
  dom.startupReveal.classList.remove('hidden');
  dom.startupLoading.classList.remove('hidden');
  dom.startupLoading.classList.remove('is-fading');
  setStartupLoadingText(message);
}

function showStartupOverlay() {
  dom.startupReveal.classList.remove('hidden');
  dom.startupLoading.classList.remove('hidden');
  dom.startupLoading.classList.remove('is-fading');
  dom.startupOverlayGrid.classList.add('hidden');
  dom.startupOverlayGrid.textContent = '';
  state.startupOriginalImage = null;
}

function hideStartupOverlay() {
  dom.startupReveal.classList.add('hidden');
  dom.startupLoading.classList.add('hidden');
  dom.startupOverlayGrid.classList.add('hidden');
  dom.startupOverlayGrid.textContent = '';
}

async function playStartupSequence(manifest) {
  // Fade out loading card — mosaic already fitted underneath
  dom.startupLoading.classList.add('is-fading');
  await delay(260);
  dom.startupLoading.classList.add('hidden');

  // Place original-image tiles over the viewport (mosaic visible underneath)
  startStartupStage('showingOriginal');
  buildOriginalOverlayTiles(state.startupOriginalImage, manifest);
  completeStartupStage('showingOriginal');

  // Hold so user sees the complete original photograph
  await delay(STARTUP_OVERLAY_CONFIG.holdMs);

  // Animate tiles away to reveal mosaic underneath
  await animateOverlayTilesAway();

  // Remove startup layer — mosaic already fully visible
  hideStartupOverlay();
}

function buildOriginalOverlayTiles(originalImage, manifest) {
  const grid = dom.startupOverlayGrid;
  if (!grid || !originalImage || !manifest) return;

  const vw = Math.max(1, dom.viewport.clientWidth);
  const vh = Math.max(1, dom.viewport.clientHeight);
  const columns = STARTUP_OVERLAY_CONFIG.columns;
  const rows = Math.max(1, Math.round(columns * (vh / vw)));

  const drawWidth = manifest.image.width * state.scale;
  const drawHeight = manifest.image.height * state.scale;
  const imgUrl = originalImage.src;

  grid.textContent = '';
  const fragment = document.createDocumentFragment();

  for (let row = 0; row < rows; row += 1) {
    const top = (row / rows) * vh;
    const bottom = ((row + 1) / rows) * vh;
    const tileH = bottom - top;

    for (let col = 0; col < columns; col += 1) {
      const left = (col / columns) * vw;
      const right = ((col + 1) / columns) * vw;
      const tileW = right - left;

      const tile = document.createElement('div');
      tile.className = 'startup-overlay-tile';
      tile.dataset.row = String(row);
      tile.dataset.col = String(col);
      tile.style.left = `${left}px`;
      tile.style.top = `${top}px`;
      tile.style.width = `${tileW + 0.5}px`;
      tile.style.height = `${tileH + 0.5}px`;
      tile.style.backgroundImage = `url(${imgUrl})`;
      tile.style.backgroundSize = `${drawWidth}px ${drawHeight}px`;
      tile.style.backgroundPosition = `${state.panX - left}px ${state.panY - top}px`;

      fragment.appendChild(tile);
    }
  }

  grid.appendChild(fragment);
  grid.dataset.columns = String(columns);
  grid.dataset.rows = String(rows);
  grid.classList.remove('hidden');
  logStartupEvent(`OVERLAY: ${columns}×${rows} tiles built (${columns * rows} total)`);
}

async function animateOverlayTilesAway() {
  const grid = dom.startupOverlayGrid;
  if (!grid) return;

  const columns = parseInt(grid.dataset.columns, 10) || STARTUP_OVERLAY_CONFIG.columns;
  const rows = parseInt(grid.dataset.rows, 10) || 1;
  const tiles = Array.from(grid.querySelectorAll('.startup-overlay-tile'));
  if (tiles.length === 0) return;

  const maxDiag = (rows - 1) + (columns - 1);
  const { staggerWindowMs, tileDurationMs } = STARTUP_OVERLAY_CONFIG;

  for (const tile of tiles) {
    const tileRow = parseInt(tile.dataset.row, 10);
    const tileCol = parseInt(tile.dataset.col, 10);
    const diagProgress = maxDiag > 0 ? (tileRow + tileCol) / maxDiag : 0;
    const delayMs = diagProgress * staggerWindowMs;
    setTimeout(() => tile.classList.add('departing'), delayMs);
  }

  await delay(staggerWindowMs + tileDurationMs + STARTUP_OVERLAY_CONFIG.settleMs);

  grid.textContent = '';
  grid.classList.add('hidden');
}


function setDefaultPreviewTile() {
  if (!state.manifest || !state.hoverIndex || state.hoverIndex.length === 0) {
    return;
  }

  const centerRow = Math.floor(state.manifest.grid.rows / 2);
  const centerCol = Math.floor(state.manifest.grid.columns / 2);
  const centerIndex = centerRow * state.manifest.grid.columns + centerCol;
  const fallbackIndex = Math.floor(state.hoverIndex.length / 2);
  const tile = state.hoverIndex[centerIndex] || state.hoverIndex[fallbackIndex];

  updateHoverWithFade(tile, { immediate: true, showHighlight: false });
  state.lastHoverTile = null;
}

function waitForFrames(count = 1) {
  return new Promise((resolve) => {
    let remaining = Math.max(1, count);
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadImage(img, src) {
  return new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Unable to load image: ${src}`));
    img.src = src;
  });
}

function setupEventListeners() {
  dom.viewport.addEventListener('wheel', handleWheel, { passive: false });
  dom.viewport.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  dom.viewport.addEventListener('mouseleave', handleMouseLeave);
  dom.viewport.addEventListener('dblclick', handleDoubleClick, { passive: false });
  
  dom.fitBtn.addEventListener('click', fitToWindow);
  dom.oneToOneBtn.addEventListener('click', zoomToOneHundred);
  dom.zoomInBtn.addEventListener('click', zoomIn);
  dom.zoomOutBtn.addEventListener('click', zoomOut);
  
  dom.overlayClose.addEventListener('click', () => dom.overlay.classList.add('hidden'));
  dom.overlay.addEventListener('click', (event) => {
    if (event.target === dom.overlay) {
      dom.overlay.classList.add('hidden');
    }
  });

  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', handleResize);
}

function hasInteractiveDataset(manifest) {
  if (!manifest || typeof manifest !== 'object') return false;
  const grid = manifest.grid;
  if (!grid || typeof grid !== 'object') return false;
  const columns = Number(grid.columns);
  const rows = Number(grid.rows);
  const xPositions = Array.isArray(grid.x_positions) ? grid.x_positions : null;
  const yPositions = Array.isArray(grid.y_positions) ? grid.y_positions : null;
  const tiles = Array.isArray(manifest.tiles) ? manifest.tiles : null;
  const sources = Array.isArray(manifest.sources) ? manifest.sources : null;

  if (!Number.isFinite(columns) || columns <= 0) return false;
  if (!Number.isFinite(rows) || rows <= 0) return false;
  if (!xPositions || !yPositions) return false;
  if (!tiles || !sources) return false;
  return true;
}

function applyDatasetModeUi() {
  if (state.interactiveDataAvailable) {
    return;
  }

  dom.tileHighlight.classList.add('hidden');
  if (dom.infoPanel) {
    dom.infoPanel.classList.add('hidden');
  }
}

// ============================================================================
// ZOOM & PAN CONTROL
// ============================================================================

function fitToWindow(animate = true) {
  if (!state.manifest) return;
  if (!state.isInteractive && animate) return;
  
  const vw = dom.viewport.clientWidth;
  const vh = dom.viewport.clientHeight;
  const iw = state.manifest.image.width;
  const ih = state.manifest.image.height;
  const pad = state.fitPadding;
  const availableW = Math.max(0, vw - pad * 2);
  const availableH = Math.max(0, vh - pad * 2);

  const fitScale = Math.min(availableW / iw, availableH / ih);
  state.targetScale = Math.max(state.minScale, Math.min(fitScale, state.maxScale));

  const fittedW = iw * state.targetScale;
  const fittedH = ih * state.targetScale;
  state.targetPanX = pad + (availableW - fittedW) / 2;
  state.targetPanY = pad + (availableH - fittedH) / 2;

  if (animate) {
    animateToTarget();
    return;
  }

  state.scale = state.targetScale;
  state.panX = state.targetPanX;
  state.panY = state.targetPanY;
  updateTransform();
  updateZoomDisplay();
}

function zoomToOneHundred() {
  if (!state.isInteractive) return;
  if (!state.manifest) return;
  const vw = dom.viewport.clientWidth;
  const vh = dom.viewport.clientHeight;
  const centerX = vw / 2;
  const centerY = vh / 2;
  
  const imageX = (centerX - state.panX) / state.scale;
  const imageY = (centerY - state.panY) / state.scale;
  
  state.targetScale = 1;
  state.targetPanX = centerX - imageX * 1;
  state.targetPanY = centerY - imageY * 1;
  
  constrainPan();
  animateToTarget();
}

function zoomIn() {
  if (!state.isInteractive) return;
  const nextScale = state.targetScale * 1.4;
  zoomToScale(nextScale);
}

function zoomOut() {
  if (!state.isInteractive) return;
  const nextScale = state.targetScale / 1.4;
  zoomToScale(nextScale);
}

function zoomToScale(nextScale) {
  if (!state.isInteractive) return;
  if (!state.manifest) return;
  
  state.targetScale = clamp(nextScale, state.minScale, state.maxScale);
  
  const vw = dom.viewport.clientWidth;
  const vh = dom.viewport.clientHeight;
  const centerX = vw / 2;
  const centerY = vh / 2;
  const imageX = (centerX - state.panX) / state.scale;
  const imageY = (centerY - state.panY) / state.scale;
  
  state.targetPanX = centerX - imageX * state.targetScale;
  state.targetPanY = centerY - imageY * state.targetScale;
  
  constrainPan();
  animateToTarget();
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function handleWheel(event) {
  event.preventDefault();
  if (!state.isInteractive) return;
  
  if (state.dragging) return;
  if (state.animationId) cancelAnimationFrame(state.animationId);
  
  const isZoomingIn = event.deltaY < 0;
  const scrollDelta = Math.abs(event.deltaY);
  
  // Reduced sensitivity: exponential based on scroll amount
  const sensitivityFactor = 0.00032;
  const zoomChange = scrollDelta * sensitivityFactor;
  const zoomFactor = isZoomingIn 
    ? Math.exp(zoomChange)
    : Math.exp(-zoomChange);
  
  const nextScale = state.targetScale * zoomFactor;
  state.targetScale = clamp(nextScale, state.minScale, state.maxScale);
  
  // Zoom around mouse cursor
  const rect = dom.viewport.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const imageX = (localX - state.panX) / state.scale;
  const imageY = (localY - state.panY) / state.scale;

  state.targetPanX = localX - imageX * state.targetScale;
  state.targetPanY = localY - imageY * state.targetScale;
  
  constrainPan();
  animateToTarget();
}

function handleMouseDown(event) {
  if (!state.isInteractive) return;
  if (event.button !== 0) return;
  if (state.animationId) cancelAnimationFrame(state.animationId);
  
  state.dragging = true;
  state.dragStartX = event.clientX;
  state.dragStartY = event.clientY;
  state.panStartX = state.panX;
  state.panStartY = state.panY;
  dom.viewport.classList.add('dragging');
}

function handleMouseMove(event) {
  if (!state.isInteractive) return;
  if (state.dragging) {
    state.panX = state.panStartX + (event.clientX - state.dragStartX);
    state.panY = state.panStartY + (event.clientY - state.dragStartY);
    constrainPan();
    updateTransform();
    updateZoomDisplay();
    return;
  }

  if (!state.interactiveDataAvailable) {
    return;
  }

  // Throttle hover detection to ~150ms
  scheduleHoverUpdate(event);
}

function handleMouseUp() {
  if (!state.isInteractive) return;
  if (state.dragging) {
    state.dragging = false;
    dom.viewport.classList.remove('dragging');
    state.targetPanX = state.panX;
    state.targetPanY = state.panY;
    state.targetScale = state.scale;
  }
}

function handleMouseLeave() {
  if (!state.isInteractive || state.dragging) return;
  if (!state.interactiveDataAvailable) return;
  cancelScheduledHoverUpdate();
  state.hover = null;
  state.lastHoverTile = null;
  dom.tileHighlight.classList.add('hidden');
}

function handleDoubleClick(event) {
  if (!state.isInteractive) return;
  event.preventDefault();
  if (event.shiftKey) {
    zoomOut();
  } else {
    zoomIn();
  }
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    dom.overlay.classList.add('hidden');
  }
}

function handleResize() {
  if (!state.manifest) return;
  fitToWindow(false);
}

// ============================================================================
// HOVER THROTTLING WITH FADE EFFECT
// ============================================================================

function scheduleHoverUpdate(event) {
  const now = Date.now();
  
  if (state.hoverTimeoutId) {
    clearTimeout(state.hoverTimeoutId);
  }
  
  if (now - state.lastHoverTime < 150) {
    state.hoverTimeoutId = setTimeout(() => {
      processHoverUpdate(event);
      state.lastHoverTime = Date.now();
    }, 150 - (now - state.lastHoverTime));
  } else {
    processHoverUpdate(event);
    state.lastHoverTime = now;
  }
}

function cancelScheduledHoverUpdate() {
  if (state.hoverTimeoutId) {
    clearTimeout(state.hoverTimeoutId);
    state.hoverTimeoutId = null;
  }
}

function processHoverUpdate(event) {
  if (!state.interactiveDataAvailable) return;
  const coords = clientToImage(event.clientX, event.clientY);
  const tile = findTileAt(coords.x, coords.y);
  
  // Compare by tileIndex — findTileAt creates new objects each call
  const newKey = tile ? tile.tileIndex : null;
  const oldKey = state.lastHoverTile ? state.lastHoverTile.tileIndex : null;
  if (newKey === oldKey) return;

  updateHoverWithFade(tile);
  state.lastHoverTile = tile;
}

function updateHoverWithFade(tile, options = {}) {
  if (!state.interactiveDataAvailable) return;
  const { immediate = false, showHighlight = true } = options;

  if (state.previewTimeoutId) {
    clearTimeout(state.previewTimeoutId);
    state.previewTimeoutId = null;
  }

  state.hover = tile;
  
  if (!tile) {
    dom.tileHighlight.classList.add('hidden');
    return;
  }

  if (showHighlight) {
    dom.tileHighlight.classList.remove('hidden');
    dom.tileHighlight.style.left = `${tile.x0}px`;
    dom.tileHighlight.style.top = `${tile.y0}px`;
    dom.tileHighlight.style.width = `${tile.x1 - tile.x0}px`;
    dom.tileHighlight.style.height = `${tile.y1 - tile.y0}px`;
  } else {
    dom.tileHighlight.classList.add('hidden');
  }

  const sourceUrl = new URL(tile.source.path, state.manifestUrl).href;
  const sourceChanged = sourceUrl !== state.currentPreviewPath;

  dom.sourceFilename.textContent = tile.source.filename;
  dom.sourceDate.textContent = formatDateFromFilename(tile.source.filename);
  dom.tilePosition.textContent = `Row ${tile.row + 1} • Column ${tile.col + 1}`;

  if (!sourceChanged) {
    return;
  }

  if (immediate) {
    dom.sourcePreview.classList.remove('fading-out');
    dom.sourcePreview.src = sourceUrl;
    state.currentPreviewPath = sourceUrl;
    return;
  }

  dom.sourcePreview.classList.add('fading-out');
  state.previewTimeoutId = setTimeout(() => {
    if (state.hover === tile) {
      dom.sourcePreview.src = sourceUrl;
      dom.sourcePreview.classList.remove('fading-out');
      state.currentPreviewPath = sourceUrl;
    }
  }, 40);
}

// Alias for backwards compatibility
function updateHover(tile) {
  updateHoverWithFade(tile);
}

// ============================================================================
// ANIMATION & TRANSFORM
// ============================================================================

function animateToTarget() {
  if (state.animationId) {
    cancelAnimationFrame(state.animationId);
  }
  
  const startTime = performance.now();
  const duration = 190;
  
  const startScale = state.scale;
  const startPanX = state.panX;
  const startPanY = state.panY;
  
  function frame(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    const easeProgress = easeOutCubic(progress);
    
    state.scale = startScale + (state.targetScale - startScale) * easeProgress;
    state.panX = startPanX + (state.targetPanX - startPanX) * easeProgress;
    state.panY = startPanY + (state.targetPanY - startPanY) * easeProgress;
    
    updateTransform();
    updateZoomDisplay();
    
    if (progress < 1) {
      state.animationId = requestAnimationFrame(frame);
    }
  }
  
  state.animationId = requestAnimationFrame(frame);
}

function updateTransform() {
  dom.mosaicLayer.style.transform = `translate(${Math.round(state.panX)}px, ${Math.round(state.panY)}px) scale(${state.scale})`;
}

function updateZoomDisplay() {
  const percentage = Math.round(state.scale * 100);
  dom.zoomDisplay.textContent = `${percentage}%`;
}

function constrainPan() {
  if (!state.manifest) return;
  
  const vw = dom.viewport.clientWidth;
  const vh = dom.viewport.clientHeight;
  const iw = state.manifest.image.width * state.targetScale;
  const ih = state.manifest.image.height * state.targetScale;
  const pad = state.fitPadding;

  const availableW = Math.max(0, vw - pad * 2);
  const availableH = Math.max(0, vh - pad * 2);

  let minX;
  let maxX;
  if (iw <= availableW) {
    const centeredX = pad + (availableW - iw) / 2;
    minX = centeredX;
    maxX = centeredX;
  } else {
    minX = vw - iw - pad;
    maxX = pad;
  }

  let minY;
  let maxY;
  if (ih <= availableH) {
    const centeredY = pad + (availableH - ih) / 2;
    minY = centeredY;
    maxY = centeredY;
  } else {
    minY = vh - ih - pad;
    maxY = pad;
  }

  state.targetPanX = clamp(state.targetPanX, minX, maxX);
  state.targetPanY = clamp(state.targetPanY, minY, maxY);
}

// ============================================================================
// COORDINATE & TILE DETECTION
// ============================================================================

function clientToImage(clientX, clientY) {
  const rect = dom.viewport.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  return {
    x: (localX - state.panX) / state.scale,
    y: (localY - state.panY) / state.scale,
  };
}

function findTileAt(imageX, imageY) {
  const manifest = state.manifest;
  if (!manifest || !state.interactiveDataAvailable) {
    return null;
  }

  const { width, height } = manifest.image;
  if (imageX < 0 || imageY < 0 || imageX >= width || imageY >= height) {
    return null;
  }

  const col = findInterval(manifest.grid.x_positions, imageX);
  const row = findInterval(manifest.grid.y_positions, imageY);
  if (col < 0 || row < 0) {
    return null;
  }

  const tileIndex = row * manifest.grid.columns + col;
  if (state.hoverIndex && state.hoverIndex[tileIndex]) {
    return state.hoverIndex[tileIndex];
  }

  const sourceId = manifest.tiles[tileIndex];
  return {
    row,
    col,
    tileIndex,
    source: manifest.sources[sourceId],
    x0: manifest.grid.x_positions[col],
    x1: manifest.grid.x_positions[col + 1],
    y0: manifest.grid.y_positions[row],
    y1: manifest.grid.y_positions[row + 1],
  };
}

function findInterval(positions, value) {
  let low = 0;
  let high = positions.length - 2;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (value < positions[mid]) {
      high = mid - 1;
    } else if (value >= positions[mid + 1]) {
      low = mid + 1;
    } else {
      return mid;
    }
  }
  return -1;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function formatDateFromFilename(filename) {
  const match = String(filename || '').match(/(\d{4})(\d{2})(\d{2})/);
  if (!match) {
    return 'Unknown';
  }

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

// ============================================================================
// STARTUP
// ============================================================================

init();
