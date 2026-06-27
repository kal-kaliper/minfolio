const mapTitleEl = document.getElementById('mapTitle');
const statusEl = document.getElementById('status');
const viewToggleEl = document.getElementById('viewToggle');
const layoutToggleEl = document.getElementById('layoutToggle');
const fullscreenToggleEl = document.getElementById('fullscreenToggle');
const recentChangesToggleEl = document.getElementById('recentChangesToggle');
const externalBatchSelectEl = document.getElementById('externalBatchSelect');
const browseButtonEl = document.getElementById('browseButton');
const browseOverlayEl = document.getElementById('browseOverlay');
const browseCloseEl = document.getElementById('browseClose');
const browseBreadcrumbsEl = document.getElementById('browseBreadcrumbs');
const browseListEl = document.getElementById('browseList');
const browseBackdropEl = browseOverlayEl ? browseOverlayEl.querySelector('.browse-backdrop') : null;
const depthSliderEl = document.getElementById('depthSlider');
const depthValueEl = document.getElementById('depthValue');
const findBarEl = document.getElementById('findBar');
const findInputEl = document.getElementById('findInput');
const findCountEl = document.getElementById('findCount');
const findPrevEl = document.getElementById('findPrev');
const findNextEl = document.getElementById('findNext');
const findCloseEl = document.getElementById('findClose');
const viewportEl = document.getElementById('viewport');
const canvasEl = document.getElementById('canvas');
const linksEl = document.getElementById('links');
const nodesEl = document.getElementById('nodes');

const palette = ['#f4d35e', '#6ccff6', '#9be564', '#f79d65', '#c792ea', '#f6bd60'];
const H_GAP = 260;
const V_GAP = 84;
const NODE_WIDTH = 220;
const BASE_NODE_HEIGHT = 44;
const NOTE_MIN_PANEL_HEIGHT = 38;
const NOTE_LINE_HEIGHT = 16;
const NOTE_WRAP_CHARS_PER_LINE = 30;
const LINE_ANCHOR_OFFSET_Y = 30;
const NODE_RENDER_Y_OFFSET = 8;
const CONNECTOR_VERTICAL_LIFT = 7;
const NODE_LINE_ANCHOR_OFFSET_Y = LINE_ANCHOR_OFFSET_Y + NODE_RENDER_Y_OFFSET - CONNECTOR_VERTICAL_LIFT;
const ROOT_LINE_ANCHOR_OFFSET_Y = LINE_ANCHOR_OFFSET_Y;
const WRAP_CHARS_PER_LINE = 24;
const WRAP_LINE_HEIGHT = 18;
const MAX_NODE_WIDTH = 860;
const TARGET_NODE_TEXT_LINES = 3;
const AVG_CHAR_WIDTH_PX = 7.2;
const NODE_TRUNCATE_LINE_THRESHOLD = 6;
const NODE_TRUNCATE_VISIBLE_LINES = 5;
const NODE_TRUNCATE_CHAR_THRESHOLD = 260;
const LARGE_NODE_LINE_THRESHOLD = 6;
const LARGE_NODE_EXTRA_V_GAP_PER_LINE = 14;
const EDIT_EXPAND_THRESHOLD_PX = 12;
const BLUE_LEVEL_EXTRA_GAP = 120;
const CHILD_LEVEL_EXTRA_GAP = 120;
const GREEN_NODE_OUTSET_MAX = 90;
const RADIAL_RADIUS_STEP = 190;
const RADIAL_MIN_RING_GAP = 150;
const RADIAL_LABEL_ARC_WIDTH = NODE_WIDTH + 26;
const STAR_NUDGE_MAX = 2600;

const MARGIN_X = 80;
const MARGIN_Y = 80;

let mapState = null;
let selectedId = null;
let draggedId = null;
let dragPreview = null;
let lastMindmapRenderCache = null;
let currentFile = '';
let currentRevision = '';
let dirty = false;
let saveInFlight = false;
let pendingSave = false;
let editingId = null;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
// Active touch pointers (id -> {x, y}) for multi-touch pinch-to-zoom. Mouse/pen
// panning uses the single-pointer path above; two touch points switch to pinch.
const activePointers = new Map();
let pinchPrevDist = 0;
let viewX = 0;
let viewY = 0;
let viewScale = 1;
let viewMode = 'mindmap';
let branchLayoutMode = 'auto';
let layoutMode = 'cartesian';
let needsPostitAutoFit = true;
let maxVisibleDepth = null; // null = show all, or 1-6
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 2.1;
const POSTIT_MIN_FIT_SCALE = 0.18;
const POSTIT_TOP_PADDING = 24;
const PINCH_ZOOM_SENSITIVITY = 0.0068;
const WHEEL_ZOOM_STEP = 1.08;
const KEYBOARD_ZOOM_STEP = 1.28;
const HISTORY_LIMIT = 150;
const FULLSCREEN_TOGGLE_COOLDOWN_MS = 350;
const EXTERNAL_CHANGE_BATCH_WINDOW_MS = 5 * 60 * 1000;
const EXTERNAL_BATCH_STORAGE_KEY = 'mindmap.external-batches.v1';
const MAX_EXTERNAL_BATCHES_PER_FILE = 24;
const MAX_EXTERNAL_BATCH_FILES = 24;
const VIEWPORT_STATE_STORAGE_KEY = 'mindmap.viewport.v1';
const VIEWPORT_STATE_MAX_ENTRIES = 18;
const VIEWPORT_PERSIST_DELAY_MS = 140;

let undoStack = [];
let pendingNoteRelayout = null;
let noteRelayoutRaf = null;
let pendingLabelRelayout = null;
let labelRelayoutRaf = null;
let labelRelayoutInProgress = false;
let labelRelayoutTargetId = null;
let fullscreenToggleInFlight = false;
let lastFullscreenToggleAt = 0;
let labelEditState = null;
let recentChangesEnabled = true;
let recentExternalChangeBySignature = new Map();
let lastExternalChangeSignatures = new Set();
let lastExternalBatchUpdatedAt = 0;
let externalChangeBatches = [];
let selectedExternalBatchId = '';
let selectedExternalBatchSignatures = new Set();
let currentSignatureById = new Map();
let viewportPersistTimer = null;
let searchState = {
  open: false,
  query: '',
  matches: [],
  matchedNodeIds: new Set(),
  activeMatchIndex: -1,
};

// --- Performance: render batching ---
let _renderRafId = null;
let _renderCallbacks = [];
let _dragPreviewRafId = null;

// FOLIO: a 1px off-screen element used as the drag image to hide the browser's
// native drag ghost (see the dragstart handler).
let _blankDragImage = null;
function blankDragImage() {
  if (_blankDragImage) return _blankDragImage;
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(el);
  _blankDragImage = el;
  return el;
}

// --- Performance: node-by-ID index ---
let nodeIndex = new Map(); // id -> { node, parent }

// --- Performance: caching ---
let mapStateVersion = 0;
let _signaturesCache = { version: -1, result: null };
let _batchSigCacheKey = '';
let _searchCacheKey = '';

// --- Performance: event delegation state ---
let _mindmapDelegationSetup = false;
let _noteUndoArmedIds = new Set();

function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `n-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

function setStatus(message, tone = 'normal') {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function countOccurrences(haystack, needle) {
  if (!needle || !haystack) return 0;
  let count = 0;
  let index = 0;
  while (index <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, index);
    if (at < 0) break;
    count += 1;
    index = at + needle.length;
  }
  return count;
}

function refreshSearchMatches() {
  if (!mapState || !searchState.query.trim()) {
    searchState.matches = [];
    searchState.matchedNodeIds = new Set();
    searchState.activeMatchIndex = -1;
    _searchCacheKey = '';
    return;
  }

  const cacheKey = `${searchState.query}\0${mapStateVersion}`;
  if (cacheKey === _searchCacheKey) return;
  _searchCacheKey = cacheKey;

  const query = searchState.query.trim().toLowerCase();
  const matches = [];
  walkTree(mapState, (node) => {
    if (node.id === mapState.id) return;
    const textHits = countOccurrences((node.text || '').toLowerCase(), query);
    const noteHits = countOccurrences((node.note || '').toLowerCase(), query);
    for (let i = 0; i < textHits + noteHits; i += 1) {
      matches.push({ nodeId: node.id });
    }
  });

  searchState.matches = matches;
  searchState.matchedNodeIds = new Set(matches.map((m) => m.nodeId));
  if (!matches.length) {
    searchState.activeMatchIndex = -1;
  } else if (searchState.activeMatchIndex < 0 || searchState.activeMatchIndex >= matches.length) {
    searchState.activeMatchIndex = 0;
  }
}

function updateSearchUi() {
  if (findBarEl) {
    findBarEl.classList.toggle('is-hidden', !searchState.open);
  }
  if (findInputEl && findInputEl.value !== searchState.query) {
    findInputEl.value = searchState.query;
  }
  if (findPrevEl) findPrevEl.disabled = searchState.matches.length === 0;
  if (findNextEl) findNextEl.disabled = searchState.matches.length === 0;
  if (findCountEl) {
    if (!searchState.query.trim() || !searchState.matches.length) {
      findCountEl.textContent = '0 of 0';
    } else {
      findCountEl.textContent = `${searchState.activeMatchIndex + 1} of ${searchState.matches.length}`;
    }
  }
}

function ensureNodeVisible(nodeId) {
  if (!nodeId) return;
  const escapedId = window.CSS && CSS.escape ? CSS.escape(nodeId) : nodeId;
  const nodeEl = nodesEl.querySelector(`[data-id="${escapedId}"]`);
  if (!(nodeEl instanceof HTMLElement)) return;
  const vpRect = viewportEl.getBoundingClientRect();
  const nodeRect = nodeEl.getBoundingClientRect();
  const margin = 48;
  let dx = 0;
  let dy = 0;
  if (nodeRect.left < vpRect.left + margin) dx = vpRect.left + margin - nodeRect.left;
  else if (nodeRect.right > vpRect.right - margin) dx = vpRect.right - margin - nodeRect.right;
  if (nodeRect.top < vpRect.top + margin) dy = vpRect.top + margin - nodeRect.top;
  else if (nodeRect.bottom > vpRect.bottom - margin) dy = vpRect.bottom - margin - nodeRect.bottom;
  if (!dx && !dy) return;
  viewX += dx;
  viewY += dy;
  applyCanvasTransform();
}

function focusNodeInViewport(nodeId, { center = true, zoom = false } = {}) {
  if (!nodeId) return;
  const escapedId = window.CSS && CSS.escape ? CSS.escape(nodeId) : nodeId;
  const nodeEl = nodesEl.querySelector(`[data-id="${escapedId}"]`);
  if (!(nodeEl instanceof HTMLElement)) return;

  if (zoom) {
    const rect = nodeEl.getBoundingClientRect();
    const desiredWidth = 300;
    const desiredHeight = 90;
    const widthFactor = rect.width > 0 ? desiredWidth / rect.width : 1;
    const heightFactor = rect.height > 0 ? desiredHeight / rect.height : 1;
    const nextScale = clamp(viewScale * Math.min(widthFactor, heightFactor), MIN_ZOOM, MAX_ZOOM);
    if (nextScale > viewScale) {
      const vpRect = viewportEl.getBoundingClientRect();
      const nodeCenterX = rect.left + rect.width / 2;
      const nodeCenterY = rect.top + rect.height / 2;
      const before = viewportPointToCanvas(nodeCenterX, nodeCenterY);
      viewScale = nextScale;
      viewX = nodeCenterX - vpRect.left - before.x * viewScale;
      viewY = nodeCenterY - vpRect.top - before.y * viewScale;
      applyCanvasTransform();
    }
  }

  if (!center) {
    ensureNodeVisible(nodeId);
    return;
  }

  const vpRect = viewportEl.getBoundingClientRect();
  const nodeRect = nodeEl.getBoundingClientRect();
  const nodeCenterX = nodeRect.left + nodeRect.width / 2;
  const nodeCenterY = nodeRect.top + nodeRect.height / 2;
  viewX += (vpRect.left + vpRect.width / 2) - nodeCenterX;
  viewY += (vpRect.top + vpRect.height / 2) - nodeCenterY;
  applyCanvasTransform();
}

function jumpToSearchMatch(nextIndex, options = {}) {
  const total = searchState.matches.length;
  if (!total) return;
  const normalized = ((nextIndex % total) + total) % total;
  searchState.activeMatchIndex = normalized;
  const match = searchState.matches[normalized];
  if (!match) return;
  selectedId = match.nodeId;
  scheduleRender(() => focusNodeInViewport(match.nodeId, options));
}

function stepSearchMatch(delta, options = {}) {
  if (!searchState.matches.length) return;
  const from = searchState.activeMatchIndex < 0
    ? (delta >= 0 ? 0 : searchState.matches.length - 1)
    : searchState.activeMatchIndex + delta;
  jumpToSearchMatch(from, options);
}

function openSearch() {
  if (!searchState.open) searchState.open = true;
  refreshSearchMatches();
  updateSearchUi();
  if (findInputEl) {
    findInputEl.focus();
    findInputEl.select();
  }
}

function closeSearch() {
  searchState.open = false;
  searchState.query = '';
  searchState.matches = [];
  searchState.matchedNodeIds = new Set();
  searchState.activeMatchIndex = -1;
  updateSearchUi();
  scheduleRender();
}

function getMapDisplayName() {
  if (currentFile) {
    const leaf = currentFile.split(/[\\/]/).pop() || currentFile;
    return leaf.replace(/\.[^.]+$/, '') || leaf;
  }
  if (mapState && mapState.children && mapState.children.length) {
    return mapState.children[0].text || 'Mindmap';
  }
  return 'Mindmap';
}

function updateMapTitle() {
  const title = getMapDisplayName();
  if (mapTitleEl) mapTitleEl.textContent = title;
  document.title = `${title} - Mindmap Live`;
}

function syncUrlState() {
  const params = new URLSearchParams(window.location.search);
  if (currentFile) params.set('file', currentFile);
  params.set('view', viewMode);
  params.set('layout', layoutMode === 'radial' ? 'star' : 'standard');
  const query = params.toString();
  const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState(null, '', nextUrl);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function estimateNodeWidth(text) {
  const clean = (text || '').trim();
  if (!clean) return NODE_WIDTH;
  const desired = Math.ceil((clean.length / TARGET_NODE_TEXT_LINES) * AVG_CHAR_WIDTH_PX + 40);
  return clamp(desired, NODE_WIDTH, MAX_NODE_WIDTH);
}

function estimateCharsPerLine(nodeWidth) {
  return Math.max(14, Math.floor((nodeWidth - 24) / AVG_CHAR_WIDTH_PX));
}

function truncateLabelText(text, maxChars) {
  const clean = (text || '').trim().replace(/\s+/g, ' ');
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function applyCanvasTransform() {
  canvasEl.style.transform = `translate(${viewX}px, ${viewY}px) scale(${viewScale})`;
  scheduleViewportStatePersist();
}

function resetViewportScroll() {
  // Browsers can auto-scroll overflow:hidden containers when focusing
  // contenteditable elements. We manage all positioning via CSS transforms,
  // so any non-zero scroll offset breaks coordinate math. Reset it.
  if (viewportEl.scrollLeft) viewportEl.scrollLeft = 0;
  if (viewportEl.scrollTop) viewportEl.scrollTop = 0;
}

function viewportPointToCanvas(clientX, clientY) {
  resetViewportScroll();
  const rect = viewportEl.getBoundingClientRect();
  return {
    x: (clientX - rect.left - viewX) / viewScale,
    y: (clientY - rect.top - viewY) / viewScale,
  };
}

function zoomAtViewportPoint(clientX, clientY, factor) {
  const nextScale = clamp(viewScale * factor, MIN_ZOOM, MAX_ZOOM);
  if (nextScale === viewScale) return;
  const before = viewportPointToCanvas(clientX, clientY);
  const rect = viewportEl.getBoundingClientRect();
  viewScale = nextScale;
  viewX = clientX - rect.left - before.x * viewScale;
  viewY = clientY - rect.top - before.y * viewScale;
  applyCanvasTransform();
}

function zoomAtViewportCenter(factor) {
  const rect = viewportEl.getBoundingClientRect();
  zoomAtViewportPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
}

function cloneMapState(state) {
  return JSON.parse(JSON.stringify(state));
}

function resetUndoHistory() {
  undoStack = [];
}

function pushUndoSnapshot() {
  if (!mapState) return;
  undoStack.push({
    mapState: cloneMapState(mapState),
    selectedId,
    branchLayoutMode,
  });
  if (undoStack.length > HISTORY_LIMIT) {
    undoStack.shift();
  }
}

function undoLastChange() {
  if (!undoStack.length) return;
  const snapshot = undoStack.pop();
  mapState = snapshot.mapState;
  selectedId = snapshot.selectedId;
  branchLayoutMode = snapshot.branchLayoutMode || 'auto';
  editingId = null;
  mapStateVersion++;
  rebuildNodeIndex();
  scheduleRender();
  scheduleAutosave();
}

// Create a node carrying enough provenance (kind, source lines, original text)
// for the serializer to round-trip standard markdown losslessly.
function mkNode(kind, text, extra) {
  return Object.assign(
    {
      id: makeId(),
      text,
      note: '',
      noteOpen: false,
      children: [],
      kind,
      _srcText: text, // text as parsed; an edit makes text !== _srcText
      trailingBlank: 0,
    },
    extra || {},
  );
}

// Forgiving STANDARD-markdown parser. Every block becomes a node: ATX headings
// (nested by level), list items (bullet/ordered, nested by indent), paragraphs,
// fenced code blocks and blockquotes (kept opaque + verbatim). Nesting is driven
// by a unified depth: headings at their level; content sits one level below the
// active heading, with list indentation deepening it further.
function parseMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const virtualRoot = { id: makeId(), text: '__virtual_root__', note: '', noteOpen: false, children: [] };

  const stack = [{ depth: 0, node: virtualRoot }]; // virtualRoot is depth 0
  let headingLevel = 0; // markdown level of the section currently being filled

  const attach = (depth, node) => {
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ depth, node });
  };
  const lastNode = () => stack[stack.length - 1].node;

  let i = 0;
  let leading = 0;
  while (i < lines.length && !lines[i].trim()) { leading += 1; i += 1; }
  virtualRoot.__leadingBlank = leading;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      const n = lastNode();
      if (n !== virtualRoot) n.trailingBlank = (n.trailingBlank || 0) + 1;
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      headingLevel = level;
      attach(level, mkNode('heading', heading[2].trim(), { level, _raw: [line] }));
      i += 1;
      continue;
    }

    const fence = line.match(/^\s*(```|~~~)(.*)$/);
    if (fence) {
      const marker = fence[1];
      const info = fence[2].trim();
      const raw = [line];
      i += 1;
      while (i < lines.length) {
        raw.push(lines[i]);
        const closes = new RegExp('^\\s*' + marker).test(lines[i]);
        i += 1;
        if (closes) break;
      }
      attach(headingLevel + 1, mkNode('code', info ? `\`\`\` ${info}` : '``` code', { _raw: raw, _opaque: true }));
      continue;
    }

    if (/^\s*>/.test(line)) {
      const raw = [];
      const texts = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        raw.push(lines[i]);
        texts.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      attach(headingLevel + 1, mkNode('quote', texts.join(' ').trim() || 'Quote', { _raw: raw, _opaque: true }));
      continue;
    }

    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const indent = li[1].replace(/\t/g, '  ').length;
      const marker = li[2];
      const ordered = /\d/.test(marker);
      const depth = headingLevel + 1 + Math.floor(indent / 2);
      attach(depth, mkNode('list', li[3].trim(), { marker, ordered, indent, _raw: [line] }));
      i += 1;
      continue;
    }

    // Paragraph: consume consecutive plain lines.
    const raw = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      if (/^(#{1,6})\s+/.test(l)) break;
      if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) break;
      if (/^\s*>/.test(l)) break;
      if (/^\s*(```|~~~)/.test(l)) break;
      raw.push(l);
      i += 1;
    }
    attach(headingLevel + 1, mkNode('paragraph', raw.join('\n').trim(), { _raw: raw }));
  }

  if (virtualRoot.children.length === 0) {
    virtualRoot.children.push(mkNode('heading', 'Mindmap', { level: 1, _raw: ['# Mindmap'] }));
  }
  virtualRoot.__hasExplicitSideMetadata = false;
  return virtualRoot;
}

// Recursively flag a moved subtree so the serializer regenerates prefixes
// (indent / heading level) from its new position instead of reusing stale raw.
function markSubtreeReflow(node) {
  node._reflow = true;
  for (const child of node.children) markSubtreeReflow(child);
}

function buildEffectiveSideMap(virtualRoot) {
  const sideById = new Map();
  for (const rootNode of virtualRoot.children) {
    let leftCount = 0;
    let rightCount = 0;
    for (const child of rootNode.children) {
      let side = 'right';
      if (branchLayoutMode === 'manual') {
        side = child.side === 'left' ? 'left' : 'right';
      } else if (leftCount < rightCount) {
        side = 'left';
      }
      sideById.set(child.id, side);
      if (side === 'left') leftCount += 1;
      else rightCount += 1;
    }
  }
  return sideById;
}

function promoteAutoSidesToManual() {
  if (!mapState || branchLayoutMode === 'manual') return;
  const sideById = buildEffectiveSideMap(mapState);
  for (const rootNode of mapState.children) {
    for (const child of rootNode.children) {
      child.side = sideById.get(child.id) === 'left' ? 'left' : 'right';
    }
  }
  branchLayoutMode = 'manual';
}

// Render one node to its markdown line(s) plus the emit context its children
// inherit. Untouched nodes (text unchanged, not moved) re-emit their exact
// source lines, so unedited regions stay byte-identical; edited/moved/new nodes
// are regenerated relative to their parent's emitted position.
function nodeEmit(node, parentEmit) {
  const kind = node.kind || 'paragraph';
  const unchanged = node._raw && node.text === node._srcText && !node._reflow;

  let level = node.level || 1;
  let indent = node.indent || 0;
  if (kind === 'heading') {
    level = parentEmit.headingLevel >= 1 ? Math.min(parentEmit.headingLevel + 1, 6) : (node.level || 1);
  } else if (kind === 'list') {
    indent = parentEmit.kind === 'list' ? parentEmit.indent + 2 : 0;
  }

  let lines;
  if (unchanged) {
    lines = node._raw.slice();
  } else if (kind === 'heading') {
    lines = ['#'.repeat(level) + ' ' + (node.text || 'Untitled')];
  } else if (kind === 'list') {
    lines = [' '.repeat(Math.max(0, indent)) + (node.marker || '-') + ' ' + (node.text || '')];
  } else if (kind === 'paragraph') {
    lines = (node.text || '').split('\n');
  } else {
    // Opaque blocks (code/quote) are not text-editable; keep their raw form.
    lines = node._raw ? node._raw.slice() : [node.text || ''];
  }

  const emit = {
    kind,
    headingLevel: kind === 'heading' ? level : parentEmit.headingLevel,
    indent: kind === 'list' ? indent : parentEmit.indent,
  };
  return { lines, emit };
}

// Tree -> standard markdown. Walks in document order (parent before children),
// preserving captured blank-line gaps so a parse->serialize of an unedited file
// is a no-op.
function serializeMarkdown(virtualRoot) {
  const out = [];
  for (let b = 0; b < (virtualRoot.__leadingBlank || 0); b += 1) out.push('');

  const emitNode = (node, parentEmit) => {
    const { lines, emit } = nodeEmit(node, parentEmit);
    for (const l of lines) out.push(l);
    for (let b = 0; b < (node.trailingBlank || 0); b += 1) out.push('');
    for (const child of node.children) emitNode(child, emit);
  };

  const rootEmit = { kind: 'root', headingLevel: 0, indent: -2 };
  for (const root of virtualRoot.children) emitNode(root, rootEmit);

  let text = out.join('\n');
  if (!text.endsWith('\n')) text += '\n';
  return text;
}

function walkTree(node, visit, parent = null) {
  visit(node, parent);
  for (const child of node.children) {
    walkTree(child, visit, node);
  }
}

function pruneTreeToDepth(root, maxDepth) {
  // Returns a shallow-ish clone of the tree with children pruned beyond maxDepth.
  // Depth 0 = root nodes (children of the wrapper). maxDepth is relative to those.
  function cloneNode(node, depth) {
    const clone = Object.assign({}, node);
    if (depth >= maxDepth) {
      clone.children = [];
    } else {
      clone.children = node.children.map((child) => cloneNode(child, depth + 1));
    }
    return clone;
  }
  // root is the wrapper node; its children are the actual roots at depth 0
  const wrapper = Object.assign({}, root);
  wrapper.children = root.children.map((child) => cloneNode(child, 0));
  return wrapper;
}

function rebuildNodeIndex() {
  nodeIndex = new Map();
  if (!mapState) return;
  walkTree(mapState, (node, parent) => {
    nodeIndex.set(node.id, { node, parent });
  });
}

function findNodeById(id) {
  const entry = nodeIndex.get(id);
  if (!entry) return { node: null, parent: null, index: -1 };
  const index = entry.parent ? entry.parent.children.findIndex((c) => c.id === id) : -1;
  return { node: entry.node, parent: entry.parent, index };
}

function isDescendant(possibleParentId, possibleChildId) {
  const start = findNodeById(possibleParentId).node;
  if (!start) return false;
  let result = false;
  walkTree(start, (node) => {
    if (node.id === possibleChildId) result = true;
  });
  return result;
}

function ensureSelection() {
  if (!mapState) return;
  if (selectedId && !findNodeById(selectedId).node) {
    selectedId = mapState.children.length ? mapState.children[0].id : mapState.id;
  }
}

function normalizeSignaturePart(value) {
  return (value || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildNodeSignatures(root) {
  const byId = new Map();
  const all = [];
  if (!root || !root.children) return { byId, all };

  const walk = (node, rootIndex, depth) => {
    if (node.id !== root.id) {
      const signature = [
        `r${rootIndex}`,
        `d${depth}`,
        `t:${normalizeSignaturePart(node.text)}`,
        `n:${normalizeSignaturePart(node.note)}`,
        `s:${node.side === 'left' ? 'left' : (node.side === 'right' ? 'right' : '')}`,
      ].join('|');
      byId.set(node.id, signature);
      all.push(signature);
    }
    for (const child of node.children) walk(child, rootIndex, depth + 1);
  };

  root.children.forEach((rootNode, rootIndex) => walk(rootNode, rootIndex, 0));
  return { byId, all };
}

function getCachedNodeSignatures(root) {
  if (_signaturesCache.version === mapStateVersion && _signaturesCache.result) {
    return _signaturesCache.result;
  }
  const result = buildNodeSignatures(root);
  _signaturesCache = { version: mapStateVersion, result };
  return result;
}

function seedLastExternalChangeBatchFromLegacyMap() {
  if (externalChangeBatches.length > 0 || recentExternalChangeBySignature.size === 0) return;
  const now = Date.now();
  const signatures = Array.from(recentExternalChangeBySignature.keys());
  if (!signatures.length) return;
  externalChangeBatches = [{
    id: `legacy-${now}`,
    startedAt: now,
    updatedAt: now,
    signatures,
  }];
  selectedExternalBatchId = externalChangeBatches[0].id;
  _batchSigCacheKey = ''; // Invalidate cache for legacy seed
  syncSelectedExternalBatchSignatures();
  persistExternalBatchesForCurrentFile();
  updateExternalBatchSelectUi();
}

function getExternalBatchFileKey() {
  const normalized = (currentFile || '__default__')
    .toString()
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase();
  return normalized || '__default__';
}



function readStoredExternalBatchesByFile() {
  try {
    const raw = localStorage.getItem(EXTERNAL_BATCH_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function writeStoredExternalBatchesByFile(byFile) {
  try {
    localStorage.setItem(EXTERNAL_BATCH_STORAGE_KEY, JSON.stringify(byFile));
  } catch (_err) {
    // Ignore storage failures.
  }
}

function syncSelectedExternalBatchSignatures() {
  const cacheKey = `${selectedExternalBatchId}\0${externalChangeBatches.length}\0${externalChangeBatches[0]?.updatedAt || 0}`;
  if (cacheKey === _batchSigCacheKey) return;
  _batchSigCacheKey = cacheKey;

  const selectedBatch = externalChangeBatches.find((b) => b.id === selectedExternalBatchId)
    || externalChangeBatches[0]
    || null;
  selectedExternalBatchId = selectedBatch ? selectedBatch.id : '';
  selectedExternalBatchSignatures = new Set(selectedBatch ? selectedBatch.signatures : []);
  lastExternalChangeSignatures = new Set(selectedExternalBatchSignatures);
  lastExternalBatchUpdatedAt = selectedBatch ? selectedBatch.updatedAt : 0;
  recentExternalChangeBySignature = new Map(
    Array.from(selectedExternalBatchSignatures).map((sig) => [sig, Date.now()])
  );
}

function persistExternalBatchesForCurrentFile() {
  const fileKey = getExternalBatchFileKey();
  const byFile = readStoredExternalBatchesByFile();
  byFile[fileKey] = {
    selectedBatchId: selectedExternalBatchId,
    batches: externalChangeBatches
      .slice(0, MAX_EXTERNAL_BATCHES_PER_FILE)
      .map((batch) => ({
        id: batch.id,
        startedAt: batch.startedAt,
        updatedAt: batch.updatedAt,
        signatures: Array.isArray(batch.signatures) ? batch.signatures : [],
      })),
  };

  const entries = Object.entries(byFile);
  if (entries.length > MAX_EXTERNAL_BATCH_FILES) {
    entries.sort((a, b) => ((b[1]?.batches?.[0]?.updatedAt) || 0) - ((a[1]?.batches?.[0]?.updatedAt) || 0));
    writeStoredExternalBatchesByFile(Object.fromEntries(entries.slice(0, MAX_EXTERNAL_BATCH_FILES)));
    return;
  }
  writeStoredExternalBatchesByFile(byFile);
}

function loadExternalBatchesForCurrentFile() {
  const byFile = readStoredExternalBatchesByFile();
  const fileKey = getExternalBatchFileKey();

  const payload = byFile[fileKey] && Array.isArray(byFile[fileKey].batches) && byFile[fileKey].batches.length
    ? byFile[fileKey]
    : null;
  if (!payload || !Array.isArray(payload.batches)) {
    externalChangeBatches = [];
    selectedExternalBatchId = '';
    selectedExternalBatchSignatures = new Set();
    _batchSigCacheKey = '';
    return;
  }
  _batchSigCacheKey = ''; // Invalidate cache before sync
  externalChangeBatches = payload.batches
    .filter((b) => b && Array.isArray(b.signatures))
    .slice(0, MAX_EXTERNAL_BATCHES_PER_FILE)
    .map((batch) => ({
      id: batch.id || `b-${Math.random().toString(16).slice(2)}-${Date.now()}`,
      startedAt: Number.isFinite(batch.startedAt) ? batch.startedAt : Date.now(),
      updatedAt: Number.isFinite(batch.updatedAt) ? batch.updatedAt : Date.now(),
      signatures: Array.from(new Set(batch.signatures.map((s) => `${s || ''}`).filter(Boolean))),
    }));
  selectedExternalBatchId = payload.selectedBatchId || (externalChangeBatches[0]?.id || '');
  syncSelectedExternalBatchSignatures();
  // Rebind recovered payload to current key aliases so future loads resolve directly.
  persistExternalBatchesForCurrentFile();
}

function formatBatchAge(timestamp) {
  const ageMs = Math.max(0, Date.now() - timestamp);
  const mins = Math.floor(ageMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatBatchLabel(batch) {
  const stamp = new Date(batch.updatedAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${stamp} (${formatBatchAge(batch.updatedAt)}) • ${batch.signatures.length} nodes`;
}

function updateExternalBatchSelectUi() {
  if (!externalBatchSelectEl) return;
  externalBatchSelectEl.innerHTML = '';
  if (!externalChangeBatches.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No update batch';
    externalBatchSelectEl.appendChild(opt);
    externalBatchSelectEl.value = '';
    externalBatchSelectEl.disabled = true;
    return;
  }
  for (const batch of externalChangeBatches) {
    const opt = document.createElement('option');
    opt.value = batch.id;
    opt.textContent = formatBatchLabel(batch);
    externalBatchSelectEl.appendChild(opt);
  }
  externalBatchSelectEl.value = selectedExternalBatchId || externalChangeBatches[0].id;
  externalBatchSelectEl.disabled = false;
}

function getViewportContextKey() {
  const fileKey = (currentFile || '__default__').toLowerCase();
  return `${fileKey}|${viewMode}|${layoutMode}`;
}

function readStoredViewportStates() {
  try {
    const raw = localStorage.getItem(VIEWPORT_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function writeStoredViewportStates(states) {
  try {
    localStorage.setItem(VIEWPORT_STATE_STORAGE_KEY, JSON.stringify(states));
  } catch (_err) {
    // Ignore storage errors.
  }
}

function persistViewportState() {
  if (!mapState) return;
  const key = getViewportContextKey();
  const now = Date.now();
  const states = readStoredViewportStates();
  states[key] = {
    x: viewX,
    y: viewY,
    scale: viewScale,
    updatedAt: now,
  };

  const entries = Object.entries(states);
  if (entries.length > VIEWPORT_STATE_MAX_ENTRIES) {
    entries.sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));
    writeStoredViewportStates(Object.fromEntries(entries.slice(0, VIEWPORT_STATE_MAX_ENTRIES)));
    return;
  }
  writeStoredViewportStates(states);
}

function scheduleViewportStatePersist() {
  if (viewportPersistTimer !== null) window.clearTimeout(viewportPersistTimer);
  viewportPersistTimer = window.setTimeout(() => {
    viewportPersistTimer = null;
    persistViewportState();
  }, VIEWPORT_PERSIST_DELAY_MS);
}

function restoreViewportState() {
  const key = getViewportContextKey();
  const states = readStoredViewportStates();
  const saved = states[key];
  if (!saved) return false;
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y) || !Number.isFinite(saved.scale)) {
    return false;
  }
  viewX = saved.x;
  viewY = saved.y;
  viewScale = clamp(saved.scale, MIN_ZOOM, MAX_ZOOM);
  applyCanvasTransform();
  return true;
}

function recordRecentExternalChanges(prevState, nextState) {
  if (!prevState || !nextState) return;
  const now = Date.now();
  const prev = buildNodeSignatures(prevState).all;
  const next = buildNodeSignatures(nextState).all;
  const prevCounts = new Map();
  const nextCounts = new Map();
  const changedSignatures = new Set();

  for (const sig of prev) prevCounts.set(sig, (prevCounts.get(sig) || 0) + 1);
  for (const sig of next) nextCounts.set(sig, (nextCounts.get(sig) || 0) + 1);

  for (const [sig, count] of nextCounts.entries()) {
    const prevCount = prevCounts.get(sig) || 0;
    if (count > prevCount) {
      changedSignatures.add(sig);
    }
  }
  if (!changedSignatures.size) return;
  const shouldAccumulateIntoCurrentBatch =
    externalChangeBatches.length > 0 &&
    lastExternalBatchUpdatedAt > 0 &&
    now - lastExternalBatchUpdatedAt <= EXTERNAL_CHANGE_BATCH_WINDOW_MS;

  let activeBatch;
  if (shouldAccumulateIntoCurrentBatch) {
    activeBatch = externalChangeBatches[0];
    const merged = new Set(activeBatch.signatures);
    for (const sig of changedSignatures) merged.add(sig);
    activeBatch.signatures = Array.from(merged);
    activeBatch.updatedAt = now;
  } else {
    activeBatch = {
      id: `batch-${now}-${Math.random().toString(16).slice(2, 8)}`,
      startedAt: now,
      updatedAt: now,
      signatures: Array.from(changedSignatures),
    };
    externalChangeBatches.unshift(activeBatch);
    if (externalChangeBatches.length > MAX_EXTERNAL_BATCHES_PER_FILE) {
      externalChangeBatches = externalChangeBatches.slice(0, MAX_EXTERNAL_BATCHES_PER_FILE);
    }
  }
  selectedExternalBatchId = activeBatch.id;
  _batchSigCacheKey = ''; // Invalidate cache after batch mutation
  syncSelectedExternalBatchSignatures();
  persistExternalBatchesForCurrentFile();
  updateExternalBatchSelectUi();
}

function isNodeRecentlyChanged(nodeId) {
  if (!recentChangesEnabled) return false;
  seedLastExternalChangeBatchFromLegacyMap();
  const signature = currentSignatureById.get(nodeId);
  if (!signature) return false;
  return selectedExternalBatchSignatures.has(signature);
}

function computeLayoutCartesian(root, starNudge = false) {
  const positions = new Map();
  const nodeHeights = new Map();
  const nodeMetrics = new Map();
  const sideById = buildEffectiveSideMap(root);
  const LEVEL_HORIZONTAL_GAP = 120;

  function getNodeMetrics(node, isRootNode = false) {
    const text = (node.text || '').trim();
    const nodeWidth = isRootNode ? NODE_WIDTH : estimateNodeWidth(text);
    const charsPerLine = isRootNode ? WRAP_CHARS_PER_LINE : estimateCharsPerLine(nodeWidth);
    const noteCharsPerLine = Math.max(18, charsPerLine);
    const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
    const extraTextHeight = (lines - 1) * WRAP_LINE_HEIGHT;
    const noteText = (node.note || '').trim();
    const noteLines = noteText
      ? noteText
          .split('\n')
          .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / noteCharsPerLine)), 0)
      : 1;
    const notePanelHeight = node.noteOpen
      ? Math.max(NOTE_MIN_PANEL_HEIGHT, noteLines * NOTE_LINE_HEIGHT + 8)
      : 0;
    const totalHeight = BASE_NODE_HEIGHT + extraTextHeight + notePanelHeight;
    const labelHeight = 24 + extraTextHeight;
    const anchorOffset = NODE_LINE_ANCHOR_OFFSET_Y;
    return { lines, extraTextHeight, totalHeight, labelHeight, anchorOffset, notePanelHeight, nodeWidth };
  }

  // Pre-pass: compute max depth on each side across all roots
  function measureDepth(node, depth) {
    let max = depth;
    for (const child of node.children) {
      max = Math.max(max, measureDepth(child, depth + 1));
    }
    return max;
  }

  let maxLeftDepth = 0;
  let maxRightDepth = 0;
  for (const rootNode of root.children) {
    for (const child of rootNode.children) {
      const d = measureDepth(child, 1);
      if (sideById.get(child.id) === 'left') maxLeftDepth = Math.max(maxLeftDepth, d);
      else maxRightDepth = Math.max(maxRightDepth, d);
    }
  }

  const maxWidthByLevel = new Map();
  for (const rootNode of root.children) {
    for (const child of rootNode.children) {
      const collect = (node, level) => {
        const width = estimateNodeWidth((node.text || '').trim());
        const prior = maxWidthByLevel.get(level) || NODE_WIDTH;
        if (width > prior) maxWidthByLevel.set(level, width);
        for (const sub of node.children) collect(sub, level + 1);
      };
      collect(child, 1);
    }
  }

  const distanceForLevelCache = new Map([[0, 0]]);
  function distanceForLevel(level) {
    // level: 1 for root child, 2 for grandchild (green), etc.
    if (distanceForLevelCache.has(level)) return distanceForLevelCache.get(level);
    const prev = distanceForLevel(level - 1);
    const prevLevelWidth =
      level === 1 ? NODE_WIDTH : (maxWidthByLevel.get(level - 1) || NODE_WIDTH);
    const baseStep = level === 1 ? (H_GAP + BLUE_LEVEL_EXTRA_GAP) : (H_GAP + CHILD_LEVEL_EXTRA_GAP);
    const widthAwareStep = prevLevelWidth + LEVEL_HORIZONTAL_GAP;
    const next = prev + Math.max(baseStep, widthAwareStep);
    distanceForLevelCache.set(level, next);
    return next;
  }

  const centerX = MARGIN_X + GREEN_NODE_OUTSET_MAX + distanceForLevel(maxLeftDepth);

  // Global normalization for green-node fanout so one-child branches
  // do not get maximum outset and create hard-looking blue link elbows.
  let maxGreenFanout = 1;
  for (const rootNode of root.children) {
    for (const blueNode of rootNode.children) {
      for (const greenNode of blueNode.children) {
        maxGreenFanout = Math.max(maxGreenFanout, greenNode.children.length);
      }
    }
  }
  const greenFanoutDenom = Math.max(1, maxGreenFanout - 1);

  function lineAnchorOffset(isRootNode) {
    return isRootNode ? ROOT_LINE_ANCHOR_OFFSET_Y : NODE_LINE_ANCHOR_OFFSET_Y;
  }

  // Place a subtree, advancing the given cursor object { y }
  function placeSubtree(node, depth, side, cursor, xOffset = 0) {
    const metrics = getNodeMetrics(node, false);
    nodeHeights.set(node.id, metrics.totalHeight);
    nodeMetrics.set(node.id, metrics);
    const leftExtra = Math.max(0, (metrics.nodeWidth || NODE_WIDTH) - NODE_WIDTH);
    const tallNodeLineOverflow = Math.max(0, metrics.lines - LARGE_NODE_LINE_THRESHOLD);
    const tallNodeGapBoost = tallNodeLineOverflow * LARGE_NODE_EXTRA_V_GAP_PER_LINE;

    if (!node.children.length) {
      const y = cursor.y;
      cursor.y += Math.max(V_GAP, metrics.totalHeight + 16 + tallNodeGapBoost);
      const level = depth + 1;
      const baseX = side === 'left'
        ? centerX - distanceForLevel(level) - leftExtra
        : centerX + distanceForLevel(level);
      const x = baseX + xOffset;
      positions.set(node.id, { x, y, depth: depth + 1, side });
      return y;
    }

    const parentVisualDepth = depth + 1;
    const childYs = node.children.map((child) => {
      let childOffset = xOffset;
      // For green nodes (children of blue nodes), push denser branches further out.
      if (parentVisualDepth === 1) {
        const densityRatio = (Math.max(0, child.children.length - 1)) / greenFanoutDenom;
        const densityOutset = densityRatio * GREEN_NODE_OUTSET_MAX;
        childOffset += side === 'left' ? -densityOutset : densityOutset;
      }
      return placeSubtree(child, depth + 1, side, cursor, childOffset);
    });
    const y = childYs.reduce((sum, val) => sum + val, 0) / childYs.length;
    // Reserve additional vertical runway for very tall internal nodes so
    // siblings rendered later don't overlap the node's text block.
    cursor.y = Math.max(cursor.y, y + Math.max(V_GAP, metrics.totalHeight + 28 + tallNodeGapBoost));
    const level = depth + 1;
    const baseX = side === 'left'
      ? centerX - distanceForLevel(level) - leftExtra
      : centerX + distanceForLevel(level);
    const x = baseX + xOffset;
    positions.set(node.id, { x, y, depth: depth + 1, side });
    return y;
  }

  let globalMaxY = MARGIN_Y;

  for (let i = 0; i < root.children.length; i++) {
    if (i > 0) globalMaxY += V_GAP * 0.5;
    const rootNode = root.children[i];
    const metrics = getNodeMetrics(rootNode, true);
    nodeHeights.set(rootNode.id, metrics.totalHeight);
    nodeMetrics.set(rootNode.id, metrics);

    const leftChildren = rootNode.children.filter((c) => sideById.get(c.id) === 'left');
    const rightChildren = rootNode.children.filter((c) => sideById.get(c.id) !== 'left');

    const startY = globalMaxY;

    // Place right and left children with INDEPENDENT cursors from the same startY
    const rightCursor = { y: startY };
    const leftCursor = { y: startY };

    rightChildren.forEach((child) => placeSubtree(child, 0, 'right', rightCursor));
    leftChildren.forEach((child) => placeSubtree(child, 0, 'left', leftCursor));

    // Root Y is derived from child ANCHOR Ys so middle branches can be truly straight.
    const allChildren = [...rightChildren, ...leftChildren];
    const allChildAnchorYs = allChildren.map((child) => {
      const childPos = positions.get(child.id);
      const childMetrics = nodeMetrics.get(child.id);
      const childAnchorOffset = childMetrics?.anchorOffset ?? NODE_LINE_ANCHOR_OFFSET_Y;
      return childPos.y + childAnchorOffset;
    });
    const rootAnchorY = allChildAnchorYs.length
      ? allChildAnchorYs.reduce((sum, val) => sum + val, 0) / allChildAnchorYs.length
      : startY + lineAnchorOffset(true);
    const rootY = rootAnchorY - lineAnchorOffset(true);

    positions.set(rootNode.id, { x: centerX, y: rootY, depth: 0, side: 'center' });

    // Advance global cursor past whichever side is taller
    globalMaxY = Math.max(rightCursor.y, leftCursor.y);
  }

  if (starNudge) {
    const walkSubtree = (node, visit) => {
      visit(node);
      for (const child of node.children) walkSubtree(child, visit);
    };

    for (const rootNode of root.children) {
      const rootPos = positions.get(rootNode.id);
      if (!rootPos) continue;
      const descendants = [];
      for (const child of rootNode.children) {
        walkSubtree(child, (n) => descendants.push(n));
      }
      if (!descendants.length) continue;

      let maxBlueDeltaY = 1;
      const blueChildren = rootNode.children;
      for (const blueNode of blueChildren) {
        const bluePos = positions.get(blueNode.id);
        if (!bluePos) continue;
        maxBlueDeltaY = Math.max(maxBlueDeltaY, Math.abs(bluePos.y - rootPos.y));
      }

      for (const blueNode of blueChildren) {
        const bluePos = positions.get(blueNode.id);
        if (!bluePos) continue;
        const sideSign = bluePos.side === 'left' ? -1 : (bluePos.side === 'right' ? 1 : 0);
        if (!sideSign) continue;
        const yRatio = Math.abs(bluePos.y - rootPos.y) / maxBlueDeltaY;
        const centerWeight = Math.sqrt(Math.max(0, 1 - yRatio * yRatio));
        const nudge = STAR_NUDGE_MAX * centerWeight;

        // Shift the whole blue subtree as a unit to preserve local clustering.
        walkSubtree(blueNode, (node) => {
          const pos = positions.get(node.id);
          if (!pos) return;
          pos.x += sideSign * nudge;
        });
      }

      // Keep root fixed at the center.
      const rootCenterPos = positions.get(rootNode.id);
      if (rootCenterPos) {
        rootCenterPos.x = centerX;
      }
    }
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const [id, pos] of positions.entries()) {
    const metrics = nodeMetrics.get(id);
    const nodeWidth = metrics?.nodeWidth || NODE_WIDTH;
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x + nodeWidth);
  }
  if (minX < MARGIN_X) {
    const shift = MARGIN_X - minX;
    for (const pos of positions.values()) pos.x += shift;
    maxX += shift;
  }

  const width = maxX + MARGIN_X;
  const height = Math.max(globalMaxY + MARGIN_Y, viewportEl.clientHeight);

  return { positions, width, height, nodeHeights, nodeMetrics };
}

function computeLayoutRadial(root) {
  const positions = new Map();
  const nodeHeights = new Map();
  const nodeMetrics = new Map();
  const sideById = buildEffectiveSideMap(root);

  function getNodeMetrics(node) {
    const text = (node.text || '').trim();
    const lines = Math.max(1, Math.ceil(text.length / WRAP_CHARS_PER_LINE));
    const extraTextHeight = (lines - 1) * WRAP_LINE_HEIGHT;
    const noteText = (node.note || '').trim();
    const noteLines = noteText
      ? noteText
          .split('\n')
          .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / NOTE_WRAP_CHARS_PER_LINE)), 0)
      : 1;
    const notePanelHeight = node.noteOpen
      ? Math.max(NOTE_MIN_PANEL_HEIGHT, noteLines * NOTE_LINE_HEIGHT + 8)
      : 0;
    const totalHeight = BASE_NODE_HEIGHT + extraTextHeight + notePanelHeight;
    const labelHeight = 24 + extraTextHeight;
    const anchorOffset = NODE_LINE_ANCHOR_OFFSET_Y;
    return { lines, extraTextHeight, totalHeight, labelHeight, anchorOffset, notePanelHeight };
  }

  const rootNode = root.children[0];
  const leafCountMemo = new Map();

  function subtreeLeafCount(node) {
    if (leafCountMemo.has(node.id)) return leafCountMemo.get(node.id);
    if (!node.children.length) {
      leafCountMemo.set(node.id, 1);
      return 1;
    }
    const total = node.children.reduce((sum, child) => sum + subtreeLeafCount(child), 0);
    leafCountMemo.set(node.id, total);
    return total;
  }

  function maxDepth(node, depth) {
    let max = depth;
    for (const child of node.children) {
      max = Math.max(max, maxDepth(child, depth + 1));
    }
    return max;
  }

  const maxTreeDepth = maxDepth(rootNode, 0);
  const nodesByDepth = new Map();
  walkTree(rootNode, (node, parent) => {
    const depth = parent ? (positions.get(parent.id)?.depth || 0) + 1 : 0;
    nodesByDepth.set(depth, (nodesByDepth.get(depth) || 0) + 1);
    positions.set(node.id, { depth });
  });

  const radiusByDepth = [0];
  for (let d = 1; d <= maxTreeDepth; d++) {
    const countAtDepth = nodesByDepth.get(d) || 1;
    const rawRadius = Math.max(
      d * RADIAL_RADIUS_STEP,
      (countAtDepth * RADIAL_LABEL_ARC_WIDTH) / (2 * Math.PI)
    );
    radiusByDepth[d] = Math.max((radiusByDepth[d - 1] || 0) + RADIAL_MIN_RING_GAP, rawRadius);
  }

  const maxRadius = radiusByDepth[maxTreeDepth] || RADIAL_RADIUS_STEP;
  const cx = MARGIN_X + maxRadius + NODE_WIDTH;
  const cy = MARGIN_Y + maxRadius + NODE_WIDTH;

  function placeNode(node, depth, startAngle, endAngle) {
    const metrics = getNodeMetrics(node);
    nodeHeights.set(node.id, metrics.totalHeight);
    nodeMetrics.set(node.id, metrics);

    const theta = (startAngle + endAngle) / 2;
    const r = radiusByDepth[depth] || (depth * RADIAL_RADIUS_STEP);
    const centerX = cx + r * Math.cos(theta);
    const centerY = cy + r * Math.sin(theta);
    const side = Math.cos(theta) < 0 ? 'left' : 'right';
    positions.set(node.id, { x: centerX - NODE_WIDTH / 2, y: centerY, depth, side, theta, radial: true });

    if (!node.children.length) return;

    let cursor = startAngle;
    const totalLeaves = Math.max(1, subtreeLeafCount(node));
    for (const child of node.children) {
      const leaves = subtreeLeafCount(child);
      const span = (endAngle - startAngle) * (leaves / totalLeaves);
      placeNode(child, depth + 1, cursor, cursor + span);
      cursor += span;
    }
  }

  const leftChildren = rootNode.children.filter((c) => sideById.get(c.id) === 'left');
  const rightChildren = rootNode.children.filter((c) => sideById.get(c.id) !== 'left');

  // Place root at center.
  const rootMetrics = getNodeMetrics(rootNode);
  nodeHeights.set(rootNode.id, rootMetrics.totalHeight);
  nodeMetrics.set(rootNode.id, rootMetrics);
  positions.set(rootNode.id, { x: cx - NODE_WIDTH / 2, y: cy, depth: 0, side: 'center', radial: true });

  function placeChildrenInArc(children, startAngle, endAngle) {
    if (!children.length) return;
    let cursor = startAngle;
    const totalLeaves = Math.max(1, children.reduce((sum, child) => sum + subtreeLeafCount(child), 0));
    for (const child of children) {
      const leaves = subtreeLeafCount(child);
      const span = (endAngle - startAngle) * (leaves / totalLeaves);
      placeNode(child, 1, cursor, cursor + span);
      cursor += span;
    }
  }

  placeChildrenInArc(rightChildren, -Math.PI / 2, Math.PI / 2);
  placeChildrenInArc(leftChildren, Math.PI / 2, (3 * Math.PI) / 2);

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [id, pos] of positions.entries()) {
    const metrics = nodeMetrics.get(id) || { totalHeight: BASE_NODE_HEIGHT, extraTextHeight: 0 };
    const top = pos.y - metrics.extraTextHeight + NODE_RENDER_Y_OFFSET;
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x + NODE_WIDTH);
    minY = Math.min(minY, top);
    maxY = Math.max(maxY, top + metrics.totalHeight);
  }

  const shiftX = minX < MARGIN_X ? MARGIN_X - minX : 0;
  const shiftY = minY < MARGIN_Y ? MARGIN_Y - minY : 0;
  if (shiftX || shiftY) {
    for (const pos of positions.values()) {
      pos.x += shiftX;
      pos.y += shiftY;
    }
    maxX += shiftX;
    maxY += shiftY;
  }

  const width = Math.max(maxX + MARGIN_X, viewportEl.clientWidth);
  const height = Math.max(maxY + MARGIN_Y, viewportEl.clientHeight);
  return { positions, width, height, nodeHeights, nodeMetrics, radial: true };
}

function computeLayout(root) {
  if (layoutMode === 'radial') {
    // Keep tree topology and only nudge toward a star-like silhouette.
    return computeLayoutCartesian(root, true);
  }
  return computeLayoutCartesian(root, false);
}

function scheduleAutosave() {
  mapStateVersion++;
  dirty = true;
  pendingSave = true;
  setStatus('Saving...', 'warn');
  if (!saveInFlight) {
    saveNow();
  }
}

async function loadFile(pathToLoad, fromExternalEvent = false) {
  if (!pathToLoad) return;

  try {
    setStatus('Loading...');
    const data = await Bridge.loadFile(pathToLoad);

    currentFile = data.filePath;
    currentRevision = data.revision;
    loadExternalBatchesForCurrentFile();
    const previousState = mapState ? JSON.parse(JSON.stringify(mapState)) : null;

    if (!data.exists) {
      const defaultRoot = { id: makeId(), text: 'Mindmap', note: '', noteOpen: false, children: [] };
      mapState = { id: makeId(), text: '__virtual_root__', note: '', noteOpen: false, children: [defaultRoot] };
      mapStateVersion++;
      rebuildNodeIndex();
      branchLayoutMode = 'auto';
      selectedId = defaultRoot.id;
      resetUndoHistory();
      scheduleAutosave();
    } else {
      mapState = parseMarkdown(data.markdown || '');
      mapStateVersion++;
      rebuildNodeIndex();
      branchLayoutMode = mapState.__hasExplicitSideMetadata ? 'manual' : 'auto';
      delete mapState.__hasExplicitSideMetadata;
      if (fromExternalEvent && previousState) {
        recordRecentExternalChanges(previousState, mapState);
      }
      ensureSelection();
      resetUndoHistory();
      dirty = false;
      setStatus(fromExternalEvent ? 'Updated from external file change' : 'Loaded', 'ok');
    }

    reconnectEvents();
    updateMapTitle();
    render();
    updateToggleLabels();
    // FOLIO: in an embedded host the iframe is reused across files (tab
    // switches push new markdown), so fit each freshly-loaded map to view.
    if (Bridge.isFlutter() && viewMode !== 'postits') requestAutoFit();
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  }
}

async function saveNow() {
  if (!currentFile || !mapState) return;
  if (saveInFlight) return;
  if (!pendingSave && !dirty) return;
  saveInFlight = true;
  pendingSave = false;

  try {
    setStatus('Saving...');
    const markdown = serializeMarkdown(mapState);
    const data = await Bridge.saveFile(currentFile, markdown, currentRevision);

    if (data._status === 409) {
      dirty = true;
      currentRevision = data.revision || currentRevision;
      setStatus(`Conflict. Backup created: ${data.backupPath}`, 'error');
      return;
    }

    currentRevision = data.revision;
    dirty = false;
    setStatus('Saved', 'ok');
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  } finally {
    saveInFlight = false;
    if (pendingSave) {
      saveNow();
    }
  }
}

let _unwatchFile = null;

function reconnectEvents() {
  if (_unwatchFile) {
    _unwatchFile();
    _unwatchFile = null;
  }
  if (!currentFile) return;

  _unwatchFile = Bridge.watchFile(currentFile, (msg) => {
    if (msg.type !== 'changed') return;

    if (msg.revision && msg.revision === currentRevision) {
      return;
    }

    if (dirty) {
      setStatus('External change detected while unsaved edits exist', 'warn');
      return;
    }

    loadFile(currentFile, true);
  });
}

function removeNode(id) {
  const { node, parent, index } = findNodeById(id);
  if (!node || !parent) return;
  if (parent.id === mapState.id && mapState.children.length <= 1) return;
  pushUndoSnapshot();
  parent.children.splice(index, 1);
  if (parent.id === mapState.id) {
    selectedId = mapState.children[Math.min(index, mapState.children.length - 1)].id;
  } else {
    selectedId = parent.id;
  }
  scheduleAutosave();
  scheduleRender();
}

function addChildNode(id) {
  const { node } = findNodeById(id);
  if (!node) return;
  pushUndoSnapshot();
  // New nodes serialize as bullet list items (no _raw -> always regenerated).
  const child = { id: makeId(), text: 'New node', note: '', noteOpen: false, children: [], kind: 'list', marker: '-', ordered: false };
  // In manual mode, persist explicit sides for direct children of a root.
  const isRoot = mapState.children.some(r => r.id === node.id);
  if (isRoot && branchLayoutMode === 'manual') {
    const sideById = buildEffectiveSideMap(mapState);
    const leftCount = node.children.filter((c) => sideById.get(c.id) === 'left').length;
    const rightCount = node.children.filter((c) => sideById.get(c.id) !== 'left').length;
    child.side = leftCount < rightCount ? 'left' : 'right';
  }
  node.children.push(child);
  selectedId = child.id;
  scheduleAutosave();
  scheduleRender(() => focusLabel(child.id));
}

function addSiblingNode(id) {
  const { parent, index } = findNodeById(id);
  if (!parent) {
    addChildNode(id);
    return;
  }
  pushUndoSnapshot();
  const isRootSibling = parent.id === mapState.id;
  const ref = findNodeById(id).node;
  // A sibling mirrors its reference node's kind so it serializes consistently
  // (sibling of a heading is a heading; sibling of a bullet is a bullet).
  const shape = isRootSibling
    ? { kind: 'heading', level: 1 }
    : ref && ref.kind === 'heading'
      ? { kind: 'heading', level: ref.level || 2 }
      : { kind: 'list', marker: (ref && ref.marker) || '-', ordered: !!(ref && ref.ordered) };
  const sibling = Object.assign(
    { id: makeId(), text: isRootSibling ? 'New tree' : 'New node', note: '', noteOpen: false, children: [] },
    shape,
  );
  parent.children.splice(index + 1, 0, sibling);
  selectedId = sibling.id;
  scheduleAutosave();
  scheduleRender(() => focusLabel(sibling.id));
}

function outdentNode(id) {
  const { node, parent } = findNodeById(id);
  if (!node || !parent) return;
  const grand = findNodeById(parent.id).parent;
  if (!grand) return;
  pushUndoSnapshot();

  const idx = parent.children.findIndex((c) => c.id === id);
  if (idx >= 0) parent.children.splice(idx, 1);

  const parentIdx = grand.children.findIndex((c) => c.id === parent.id);
  grand.children.splice(parentIdx + 1, 0, node);
  markSubtreeReflow(node); // depth changed -> regenerate prefixes on save
  selectedId = id;
  scheduleAutosave();
  scheduleRender();
}

function moveNode(dragId, targetId, asSibling, insertBefore = false) {
  if (!dragId || !targetId || dragId === targetId) return;
  const dragInfo = findNodeById(dragId);
  const targetInfo = findNodeById(targetId);
  if (!dragInfo.node || !dragInfo.parent || !targetInfo.node) return;
  if (isDescendant(dragId, targetId)) return;
  pushUndoSnapshot();

  dragInfo.parent.children.splice(dragInfo.index, 1);
  rebuildNodeIndex();
  const nextTargetInfo = findNodeById(targetId);
  if (!nextTargetInfo.node) return;

  if (asSibling) {
    if (!nextTargetInfo.parent) return;
    const insertIndex = nextTargetInfo.index + (insertBefore ? 0 : 1);
    nextTargetInfo.parent.children.splice(insertIndex, 0, dragInfo.node);
  } else {
    nextTargetInfo.node.children.push(dragInfo.node);
  }

  markSubtreeReflow(dragInfo.node); // depth may have changed -> regenerate prefixes
  selectedId = dragId;
  scheduleAutosave();
  scheduleRender();
}

function focusLabel(id) {
  requestAnimationFrame(() => {
    const label = nodesEl.querySelector(`[data-label-for="${id}"]`);
    if (!label) return;
    beginLabelEdit(id, label);
  });
}

function beginLabelEdit(nodeId, labelEl, selectAll = true) {
  if (!labelEl) return;
  const alreadyEditingThisLabel =
    editingId === nodeId &&
    labelEl.contentEditable === 'true' &&
    typeof labelEl.__editInputHandler === 'function';
  if (alreadyEditingThisLabel) {
    labelEl.focus();
    if (selectAll) {
      const range = document.createRange();
      range.selectNodeContents(labelEl);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    return;
  }
  const overflowEditMode = labelEl.classList.contains('label-truncated');
  // Capture the pre-edit visible height so expanded text grows upward
  // while keeping the underline anchor in place.
  const anchorHeight = Math.max(24, labelEl.clientHeight || labelEl.scrollHeight || 24);
  const info = findNodeById(nodeId);
  if (info.node && editingId !== nodeId) {
    // Ensure edit mode always starts from full text, not truncated display text.
    labelEl.textContent = info.node.text || '';
    labelEl.classList.remove('label-truncated');
    labelEl.style.maxHeight = '';
    labelEl.style.overflow = '';
    labelEl.title = '';
  }
  if (editingId !== nodeId) {
    labelEditState = { nodeId, initialText: info.node ? info.node.text : '' };
  }
  editingId = nodeId;
  labelEl.contentEditable = 'true';
  labelEl.style.minHeight = `${anchorHeight}px`;
  labelEl.style.height = '';
  labelEl.style.maxHeight = '';
  labelEl.style.overflow = '';
  labelEl.classList.remove('label-edit-expanded');
  if (overflowEditMode) {
    labelEl.classList.add('label-edit-expanded');
  }
  const previewNodeEl = labelEl.closest('.node');
  const previewBaseWidth = previewNodeEl ? previewNodeEl.offsetWidth : NODE_WIDTH;
  const previewBaseLeft = previewNodeEl ? parseFloat(previewNodeEl.style.left || '0') : 0;
  const previewBaseTop = previewNodeEl ? parseFloat(previewNodeEl.style.top || '0') : 0;
  const previewIsLeftSide = Boolean(previewNodeEl && previewNodeEl.classList.contains('left-side'));
  const handleLabelInput = () => {
    // Dark backdrop is reserved for nodes that were truncated in read mode.
    if (overflowEditMode) labelEl.classList.add('label-edit-expanded');
    else labelEl.classList.remove('label-edit-expanded');
    const info = findNodeById(nodeId);
    if (!info.node) return;
    const liveText = labelEl.textContent || '';
    if (info.node.text !== liveText) {
      info.node.text = liveText;
      // Avoid full re-render while typing in contenteditable (can drop keystrokes).
      // Apply a local width preview to the active node, then do full layout on commit.
      const nodeEl = previewNodeEl;
      if (nodeEl && !nodeEl.classList.contains('root-node')) {
        const nextWidth = estimateNodeWidth(liveText);
        nodeEl.style.width = `${nextWidth}px`;
        // Keep the center-facing edge fixed for left-side nodes while width changes.
        // This makes long labels expand away from the graph center.
        if (previewIsLeftSide) {
          nodeEl.style.left = `${previewBaseLeft - (nextWidth - previewBaseWidth)}px`;
        }
      }
    }
    // Shift the node upward so the underline (at the label's bottom edge) stays
    // in its original position as text grows. The label sizes naturally; we move
    // the whole node to compensate for the height increase.
    const currentLabelHeight = labelEl.offsetHeight;
    const growth = Math.max(0, currentLabelHeight - anchorHeight);
    if (previewNodeEl) {
      previewNodeEl.style.top = `${previewBaseTop - growth}px`;
    }
  };
  if (labelEl.__editInputHandler) {
    labelEl.removeEventListener('input', labelEl.__editInputHandler);
  }
  labelEl.__editInputHandler = handleLabelInput;
  labelEl.addEventListener('input', handleLabelInput);
  requestAnimationFrame(handleLabelInput);
  labelEl.focus();
  if (selectAll) {
    const range = document.createRange();
    range.selectNodeContents(labelEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function endLabelEdit(nodeId, labelEl, save = true) {
  if (!labelEl) return;
  if (labelEl.__editInputHandler) {
    labelEl.removeEventListener('input', labelEl.__editInputHandler);
    delete labelEl.__editInputHandler;
  }
  labelEl.style.height = '';
  labelEl.style.transform = '';
  labelEl.classList.remove('label-edit-expanded');
  const info = findNodeById(nodeId);
  const initialText =
    labelEditState && labelEditState.nodeId === nodeId
      ? labelEditState.initialText
      : (info.node ? info.node.text : '');
  if (save && info.node) {
    const nextText = labelEl.textContent.trim() || 'New node';
    if (initialText !== nextText) {
      if (info.node.text !== initialText) {
        info.node.text = initialText;
      }
      pushUndoSnapshot();
      info.node.text = nextText;
      scheduleAutosave();
    }
  } else if (info.node) {
    info.node.text = initialText || 'New node';
    labelEl.textContent = info.node.text;
  }
  labelEl.contentEditable = 'false';
  resetViewportScroll();
  if (editingId === nodeId) editingId = null;
  if (labelEditState && labelEditState.nodeId === nodeId) labelEditState = null;
  pendingLabelRelayout = null;
  scheduleRender();
}

function scheduleNoteRelayout(nodeId, noteAreaEl) {
  if (!noteAreaEl) return;
  pendingNoteRelayout = {
    nodeId,
    selectionStart: noteAreaEl.selectionStart || 0,
    selectionEnd: noteAreaEl.selectionEnd || 0,
    scrollTop: noteAreaEl.scrollTop || 0,
  };
  if (noteRelayoutRaf !== null) return;
  noteRelayoutRaf = requestAnimationFrame(() => {
    noteRelayoutRaf = null;
    const target = pendingNoteRelayout;
    pendingNoteRelayout = null;
    if (!target) return;

    render();
    requestAnimationFrame(() => {
      const refreshedNote = nodesEl.querySelector(`.node-note[data-note-for="${target.nodeId}"]`);
      if (!(refreshedNote instanceof HTMLTextAreaElement)) return;
      refreshedNote.focus();
      const max = refreshedNote.value.length;
      const start = Math.min(target.selectionStart, max);
      const end = Math.min(target.selectionEnd, max);
      refreshedNote.setSelectionRange(start, end);
      refreshedNote.scrollTop = target.scrollTop;
    });
  });
}

function getSelectionOffsetsWithin(element) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return { start: 0, end: 0 };
  const range = sel.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
    return { start: 0, end: 0 };
  }

  const startRange = range.cloneRange();
  startRange.selectNodeContents(element);
  startRange.setEnd(range.startContainer, range.startOffset);
  const start = startRange.toString().length;

  const endRange = range.cloneRange();
  endRange.selectNodeContents(element);
  endRange.setEnd(range.endContainer, range.endOffset);
  const end = endRange.toString().length;

  return { start, end };
}

function resolveTextPosition(element, targetOffset) {
  const offset = Math.max(0, targetOffset || 0);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  let consumed = 0;
  let node = walker.nextNode();
  let lastNode = null;
  while (node) {
    lastNode = node;
    const len = node.textContent ? node.textContent.length : 0;
    if (consumed + len >= offset) {
      return { node, offset: Math.min(Math.max(0, offset - consumed), len) };
    }
    consumed += len;
    node = walker.nextNode();
  }
  if (lastNode) {
    return { node: lastNode, offset: lastNode.textContent ? lastNode.textContent.length : 0 };
  }
  return null;
}

function setSelectionOffsetsWithin(element, startOffset, endOffset) {
  const startPos = resolveTextPosition(element, startOffset);
  const endPos = resolveTextPosition(element, endOffset);
  const sel = window.getSelection();
  if (!sel) return;

  if (startPos && endPos) {
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function scheduleLabelRelayout(nodeId, labelEl) {
  if (!labelEl) return;
  const selection = getSelectionOffsetsWithin(labelEl);
  pendingLabelRelayout = {
    nodeId,
    selectionStart: selection.start,
    selectionEnd: selection.end,
  };
  if (labelRelayoutRaf !== null) return;
  labelRelayoutRaf = requestAnimationFrame(() => {
    labelRelayoutRaf = null;
    const target = pendingLabelRelayout;
    pendingLabelRelayout = null;
    if (!target || editingId !== target.nodeId) return;

    labelRelayoutInProgress = true;
    labelRelayoutTargetId = target.nodeId;
    render();
    requestAnimationFrame(() => {
      if (editingId !== target.nodeId) {
        labelRelayoutInProgress = false;
        labelRelayoutTargetId = null;
        return;
      }
      const refreshedLabel = nodesEl.querySelector(`[data-label-for="${target.nodeId}"]`);
      if (!(refreshedLabel instanceof HTMLElement)) {
        labelRelayoutInProgress = false;
        labelRelayoutTargetId = null;
        return;
      }
      beginLabelEdit(target.nodeId, refreshedLabel, false);
      setSelectionOffsetsWithin(refreshedLabel, target.selectionStart, target.selectionEnd);
      labelRelayoutInProgress = false;
      labelRelayoutTargetId = null;
    });
  });
}

function toggleNote(nodeId) {
  const info = findNodeById(nodeId);
  if (!info.node) return;
  info.node.noteOpen = !info.node.noteOpen;
  scheduleRender();
}

function setupViewportInteractions() {
  viewportEl.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('.node, .wall-node')) return;
    if (!selectedId) return;
    selectedId = null;
    scheduleRender();
  });

  viewportEl.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (event.ctrlKey) {
        // Pinch-to-zoom gesture (trackpad)
        const zoomFactor = Math.exp(-event.deltaY * PINCH_ZOOM_SENSITIVITY);
        zoomAtViewportPoint(event.clientX, event.clientY, zoomFactor);
      } else if (event.deltaMode === 0) {
        // Pixel-level deltas — trackpad two-finger scroll → pan
        viewX -= event.deltaX;
        viewY -= event.deltaY;
        applyCanvasTransform();
      } else {
        // Line/page deltas — mouse scroll wheel → zoom at cursor
        const zoomDirection = event.deltaY > 0 ? 1 / WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP;
        zoomAtViewportPoint(event.clientX, event.clientY, zoomDirection);
      }
    },
    { passive: false }
  );

  function endTouchPointer(event) {
    if (event.pointerType !== 'touch') return;
    activePointers.delete(event.pointerId);
    // Dropping from 2->1 fingers: reset pinch baseline and let the remaining
    // finger resume panning seamlessly from its current position.
    if (activePointers.size < 2) pinchPrevDist = 0;
    if (activePointers.size === 1) {
      const [pt] = activePointers.values();
      isPanning = true;
      panStartX = pt.x - viewX;
      panStartY = pt.y - viewY;
    }
  }

  viewportEl.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Element && event.target.closest('.node, .wall-node')) return;

    if (event.pointerType === 'touch') {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      viewportEl.setPointerCapture(event.pointerId);
      if (activePointers.size === 2) {
        // Two fingers down → pinch/zoom mode; suspend single-finger panning.
        isPanning = false;
        viewportEl.classList.remove('panning');
        pinchPrevDist = 0;
        return;
      }
    } else if (event.button !== 0) {
      return;
    }

    isPanning = true;
    panStartX = event.clientX - viewX;
    panStartY = event.clientY - viewY;
    viewportEl.classList.add('panning');
    viewportEl.setPointerCapture(event.pointerId);
  });

  viewportEl.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' && activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    // Two-finger pinch: zoom by the change in finger distance, centered on the
    // midpoint between the fingers (which also pans when the midpoint moves).
    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (pinchPrevDist > 0 && dist > 0) {
        zoomAtViewportPoint(midX, midY, dist / pinchPrevDist);
      }
      pinchPrevDist = dist;
      return;
    }

    if (!isPanning) return;
    viewX = event.clientX - panStartX;
    viewY = event.clientY - panStartY;
    applyCanvasTransform();
  });

  viewportEl.addEventListener('pointerup', (event) => {
    endTouchPointer(event);
    if (isPanning && activePointers.size === 0) {
      isPanning = false;
      viewportEl.classList.remove('panning');
    }
    if (viewportEl.hasPointerCapture(event.pointerId)) {
      viewportEl.releasePointerCapture(event.pointerId);
    }
  });

  viewportEl.addEventListener('pointercancel', (event) => {
    endTouchPointer(event);
    if (activePointers.size === 0) {
      isPanning = false;
      viewportEl.classList.remove('panning');
    }
  });

  // Safari/WKWebView exposes trackpad pinch as GestureEvent (non-standard WebKit).
  // On macOS, this fires instead of ctrlKey+wheel, so we need to handle it here.
  if (typeof GestureEvent !== 'undefined') {
    let _gestureScale = 1;
    viewportEl.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      _gestureScale = e.scale;
    }, { passive: false });
    viewportEl.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      if (_gestureScale === 0) return;
      const factor = e.scale / _gestureScale;
      _gestureScale = e.scale;
      if (Math.abs(factor - 1) > 0.0005) {
        zoomAtViewportPoint(e.clientX, e.clientY, factor);
      }
    }, { passive: false });
    viewportEl.addEventListener('gestureend', (e) => {
      e.preventDefault();
      _gestureScale = 1;
    }, { passive: false });
  }
}

function setupMindmapDelegation() {
  if (_mindmapDelegationSetup) return;
  _mindmapDelegationSetup = true;

  function getNodeId(event) {
    const nodeEl = event.target.closest('.node');
    return nodeEl ? nodeEl.dataset.id : null;
  }

  function getDropIntent(event, nodeId, nodeEl) {
    if (!draggedId || draggedId === nodeId) return null;
    const dragInfo = findNodeById(draggedId);
    const targetInfo = findNodeById(nodeId);
    if (!dragInfo.node || !dragInfo.parent || !targetInfo.node || !targetInfo.parent) return null;
    if (event.shiftKey) {
      const rect = nodeEl.getBoundingClientRect();
      const insertBefore = event.clientY < rect.top + rect.height / 2;
      return { asSibling: true, insertBefore, visualClass: insertBefore ? 'drop-before' : 'drop-after' };
    }
    return { asSibling: false, insertBefore: false, visualClass: 'drop-child' };
  }

  function clearDropClasses(el) {
    el.classList.remove('drop-target', 'drop-child', 'drop-before', 'drop-after');
  }

  function updateDragPreview(event) {
    if (!dragPreview || !draggedId || draggedId !== dragPreview.id) return;
    const pointer = viewportPointToCanvas(event.clientX, event.clientY);
    const nextX = pointer.x - dragPreview.offsetX;
    const nextY = pointer.y - dragPreview.offsetY;
    if (Math.abs(nextX - dragPreview.x) > 0.5 || Math.abs(nextY - dragPreview.y) > 0.5) {
      dragPreview.x = nextX;
      dragPreview.y = nextY;
      scheduleDragPreviewRefresh();
    }
  }

  // --- Click delegation ---
  nodesEl.addEventListener('click', (event) => {
    // Note toggle
    const noteToggle = event.target.closest('.note-toggle');
    if (noteToggle) {
      event.preventDefault();
      event.stopPropagation();
      const nodeEl = noteToggle.closest('.node');
      if (nodeEl) toggleNote(nodeEl.dataset.id);
      return;
    }
    // Note area - stop propagation
    if (event.target.closest('.node-note')) return;
    // Label click
    const label = event.target.closest('.node-label');
    if (label) {
      event.stopPropagation();
      const nodeId = label.dataset.labelFor;
      selectedId = nodeId;
      const isRootNode = mapState && mapState.children.some(r => r.id === nodeId);
      if (isRootNode) {
        // Root nodes: single-click selects only, double-click edits
        if (editingId === nodeId) return;
        scheduleRender();
      } else {
        if (editingId !== nodeId) beginLabelEdit(nodeId, label, false);
      }
      return;
    }
    // Node click (not on label/note)
    const nodeId = getNodeId(event);
    if (nodeId) {
      selectedId = nodeId;
      if (nodeId !== editingId) scheduleRender();
    }
  });

  // --- Double-click delegation ---
  nodesEl.addEventListener('dblclick', (event) => {
    if (event.target.closest('.note-toggle, .node-note')) return;
    const label = event.target.closest('.node-label');
    if (label) {
      event.stopPropagation();
      const nodeId = label.dataset.labelFor;
      if (editingId === nodeId) return;
      beginLabelEdit(nodeId, label, false);
      return;
    }
    const nodeId = getNodeId(event);
    if (nodeId) {
      event.stopPropagation();
      selectedId = nodeId;
      focusLabel(nodeId);
    }
  });

  // --- Drag delegation ---
  nodesEl.addEventListener('dragstart', (event) => {
    const nodeId = getNodeId(event);
    if (!nodeId) return;
    if (editingId === nodeId) { event.preventDefault(); return; }
    const nodeEl = event.target.closest('.node');
    if (nodeEl) {
      const pointer = viewportPointToCanvas(event.clientX, event.clientY);
      const startX = parseFloat(nodeEl.style.left || '0');
      const startY = parseFloat(nodeEl.style.top || '0');
      dragPreview = {
        id: nodeId,
        x: startX,
        y: startY,
        offsetX: pointer.x - startX,
        offsetY: pointer.y - startY,
      };
    } else {
      dragPreview = null;
    }
    draggedId = nodeId;
    event.dataTransfer.effectAllowed = 'move';
    // FOLIO: suppress the browser's native drag ghost. The engine repositions
    // the real node element to follow the pointer, so the default translucent
    // clone shows up as a duplicate. (Flutter's webview hid it; Chrome/Quest
    // don't.)
    if (event.dataTransfer.setDragImage) {
      event.dataTransfer.setDragImage(blankDragImage(), 0, 0);
    }
  });

  nodesEl.addEventListener('dragover', (event) => {
    const nodeEl = event.target.closest('.node');
    if (!nodeEl) return;
    const nodeId = nodeEl.dataset.id;
    updateDragPreview(event);
    if (!draggedId || draggedId === nodeId) return;
    if (isDescendant(draggedId, nodeId)) return;
    const intent = getDropIntent(event, nodeId, nodeEl);
    if (!intent) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearDropClasses(nodeEl);
    nodeEl.classList.add('drop-target');
    nodeEl.classList.add(intent.visualClass);
  });

  viewportEl.addEventListener('dragover', (event) => {
    if (!draggedId) return;
    updateDragPreview(event);
    const overNode = event.target instanceof Element && event.target.closest('.node');
    if (overNode) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    for (const el of nodesEl.querySelectorAll('.drop-target')) clearDropClasses(el);
  });

  nodesEl.addEventListener('dragleave', (event) => {
    const nodeEl = event.target.closest('.node');
    if (nodeEl) clearDropClasses(nodeEl);
  });

  nodesEl.addEventListener('drop', (event) => {
    const nodeEl = event.target.closest('.node');
    if (!nodeEl) return;
    event.preventDefault();
    const nodeId = nodeEl.dataset.id;
    const intent = getDropIntent(event, nodeId, nodeEl);
    clearDropClasses(nodeEl);
    if (!draggedId || draggedId === nodeId || !intent) return;
    moveNode(draggedId, nodeId, intent.asSibling, intent.insertBefore);
    draggedId = null;
    dragPreview = null;
  });

  viewportEl.addEventListener('drop', (event) => {
    const overNode = event.target instanceof Element && event.target.closest('.node');
    if (overNode) return;
    event.preventDefault();
    draggedId = null;
    dragPreview = null;
    scheduleRender();
    for (const el of nodesEl.querySelectorAll('.drop-target')) clearDropClasses(el);
  });

  nodesEl.addEventListener('dragend', () => {
    draggedId = null;
    dragPreview = null;
    scheduleRender();
    for (const el of nodesEl.querySelectorAll('.drop-target')) clearDropClasses(el);
  });

  // --- Note toggle: prevent default on pointerdown/mousedown ---
  nodesEl.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.note-toggle')) { event.preventDefault(); event.stopPropagation(); }
  });
  nodesEl.addEventListener('mousedown', (event) => {
    if (event.target.closest('.note-toggle')) { event.preventDefault(); event.stopPropagation(); }
  });

  // --- Label blur (focusout bubbles) ---
  nodesEl.addEventListener('focusout', (event) => {
    const label = event.target.closest('.node-label');
    if (label) {
      const nodeId = label.dataset.labelFor;
      if (editingId !== nodeId) return;
      if (labelRelayoutInProgress && labelRelayoutTargetId === nodeId) return;
      endLabelEdit(nodeId, label, true);
      return;
    }
    // Note area blur
    const noteArea = event.target.closest('.node-note');
    if (noteArea) {
      scheduleRender();
    }
  });

  // --- Label keydown ---
  nodesEl.addEventListener('keydown', (event) => {
    const label = event.target.closest('.node-label');
    if (!label) return;
    const nodeId = label.dataset.labelFor;
    if (editingId !== nodeId) return;
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      endLabelEdit(nodeId, label, true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      endLabelEdit(nodeId, label, false);
    }
  });

  // --- Note area focus/input delegation ---
  nodesEl.addEventListener('focusin', (event) => {
    const noteArea = event.target.closest('.node-note');
    if (noteArea) {
      const nodeId = noteArea.dataset.noteFor;
      _noteUndoArmedIds.add(nodeId);
    }
  });

  nodesEl.addEventListener('input', (event) => {
    const noteArea = event.target.closest('.node-note');
    if (!noteArea) return;
    const nodeId = noteArea.dataset.noteFor;
    const info = findNodeById(nodeId);
    if (!info.node) return;
    if (_noteUndoArmedIds.has(nodeId)) {
      pushUndoSnapshot();
      _noteUndoArmedIds.delete(nodeId);
    }
    info.node.note = noteArea.value;
    scheduleAutosave();
    scheduleNoteRelayout(nodeId, noteArea);
  });
}

function renderMindmap() {
  if (!mapState) return;
  setupMindmapDelegation();
  ensureSelection();
  if (editingId && !findNodeById(editingId).node) editingId = null;
  updateMapTitle();
  const activeDragPreview = (
    dragPreview &&
    draggedId &&
    dragPreview.id === draggedId &&
    Number.isFinite(dragPreview.x) &&
    Number.isFinite(dragPreview.y)
  ) ? dragPreview : null;

  const renderTree = maxVisibleDepth !== null ? pruneTreeToDepth(mapState, maxVisibleDepth) : mapState;
  const { positions, width, height, nodeHeights, nodeMetrics, radial: isRadial = false } = computeLayout(renderTree);

  // Remove non-node children (e.g. workshop-board from postit view)
  for (const child of Array.from(nodesEl.children)) {
    if (!child.classList.contains('node')) child.remove();
  }

  // Collect existing node elements for DOM recycling
  const existingNodes = new Map();
  for (const el of nodesEl.querySelectorAll(':scope > .node')) {
    if (el.dataset.id) existingNodes.set(el.dataset.id, el);
  }

  // Clear SVG paths (lightweight, no listeners)
  linksEl.innerHTML = '';

  nodesEl.style.width = `${width}px`;
  nodesEl.style.height = `${height}px`;
  linksEl.setAttribute('width', String(width));
  linksEl.setAttribute('height', String(height));
  linksEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const rendered = new Map();
  const labelById = new Map();
  const visited = new Set();
  walkTree(renderTree, (node, parent) => {
    if (node.id === mapState.id) return;
    const pos = positions.get(node.id);
    if (!pos) return;

    visited.add(node.id);
    let nodeEl = existingNodes.get(node.id);
    const isRecycled = Boolean(nodeEl);
    if (!nodeEl) {
      nodeEl = document.createElement('div');
      nodeEl.dataset.id = node.id;
    }

    const metrics = nodeMetrics.get(node.id) || {
      extraTextHeight: 0,
      totalHeight: BASE_NODE_HEIGHT,
      labelHeight: 24,
    };
    const isRootNode = parent && parent.id === mapState.id;
    const shouldTruncateLabel =
      !isRootNode &&
      editingId !== node.id &&
      (metrics.lines > NODE_TRUNCATE_LINE_THRESHOLD || (node.text || '').length > NODE_TRUNCATE_CHAR_THRESHOLD);
    const nodeWidth = metrics.nodeWidth || NODE_WIDTH;
    const charsPerLineForDisplay = isRootNode ? WRAP_CHARS_PER_LINE : estimateCharsPerLine(nodeWidth);
    const truncateBudgetChars = Math.max(
      NODE_TRUNCATE_CHAR_THRESHOLD,
      Math.floor(charsPerLineForDisplay * NODE_TRUNCATE_VISIBLE_LINES * 0.92)
    );
    const truncatedText = shouldTruncateLabel
      ? truncateLabelText(node.text, truncateBudgetChars)
      : (node.text || '');
    const visibleLines = shouldTruncateLabel
      ? Math.min(
          NODE_TRUNCATE_VISIBLE_LINES,
          Math.max(1, Math.ceil(truncatedText.length / Math.max(1, charsPerLineForDisplay)))
        )
      : metrics.lines;
    const displayExtraTextHeight = Math.max(0, visibleLines - 1) * WRAP_LINE_HEIGHT;
    const displayLabelHeight = 24 + displayExtraTextHeight;
    const notePanelHeight = metrics.notePanelHeight || 0;
    const displayTotalHeight = BASE_NODE_HEIGHT + displayExtraTextHeight + notePanelHeight;
    let nodeClass = 'node';
    if (isRootNode) nodeClass += ' root-node';
    if (pos.side === 'left') nodeClass += ' left-side';
    if (node.id === selectedId) nodeClass += ' selected';
    if (node.id === editingId) nodeClass += ' editing';
    if (recentChangesEnabled && isNodeRecentlyChanged(node.id)) nodeClass += ' recent-change';
    if (recentChangesEnabled && searchState.matchedNodeIds.has(node.id)) nodeClass += ' find-match';
    if (recentChangesEnabled && searchState.matches[searchState.activeMatchIndex]?.nodeId === node.id) {
      nodeClass += ' find-active';
    }
    nodeEl.className = nodeClass;
    const defaultTop = pos.y - displayExtraTextHeight + NODE_RENDER_Y_OFFSET;
    if (activeDragPreview && activeDragPreview.id === node.id) {
      nodeEl.style.left = `${activeDragPreview.x}px`;
      nodeEl.style.top = `${activeDragPreview.y}px`;
    } else {
      nodeEl.style.left = `${pos.x}px`;
      nodeEl.style.top = `${defaultTop}px`;
    }
    if (!isRootNode) {
      nodeEl.style.width = `${nodeWidth}px`;
    } else {
      nodeEl.style.width = '';
    }
    nodeEl.style.height = `${displayTotalHeight}px`;
    nodeEl.style.borderColor = palette[pos.depth % palette.length];
    nodeEl.style.setProperty('--branch-color', palette[pos.depth % palette.length]);
    nodeEl.draggable = editingId !== node.id;

    // Rebuild children (label, note toggle, note area)
    nodeEl.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'node-label';
    label.contentEditable = node.id === editingId ? 'true' : 'false';
    label.spellcheck = false;
    label.dataset.labelFor = node.id;
    label.textContent = truncatedText;
    label.title = shouldTruncateLabel ? (node.text || '') : '';
    if (shouldTruncateLabel) {
      label.classList.add('label-truncated');
      label.style.minHeight = `${displayLabelHeight}px`;
      label.style.maxHeight = `${displayLabelHeight}px`;
      label.style.overflow = 'hidden';
    } else {
      label.style.minHeight = `${displayLabelHeight}px`;
      label.style.maxHeight = '';
      label.style.overflow = '';
    }

    const hasNote = Boolean((node.note || '').trim());
    if (hasNote || node.noteOpen) {
      const noteToggle = document.createElement('button');
      noteToggle.type = 'button';
      noteToggle.className = 'note-toggle';
      noteToggle.title = node.noteOpen ? 'Collapse note' : 'Expand note';
      noteToggle.setAttribute('aria-label', node.noteOpen ? 'Collapse note' : 'Expand note');
      noteToggle.setAttribute('aria-expanded', node.noteOpen ? 'true' : 'false');
      noteToggle.setAttribute('contenteditable', 'false');
      noteToggle.draggable = false;
      if (node.noteOpen) noteToggle.classList.add('is-open');
      if (hasNote) noteToggle.classList.add('has-note');
      label.appendChild(noteToggle);
    }

    nodeEl.appendChild(label);
    labelById.set(node.id, label);

    if (node.noteOpen) {
      const noteWrap = document.createElement('div');
      noteWrap.className = 'node-note-wrap';
      const noteArea = document.createElement('textarea');
      noteArea.className = 'node-note';
      noteArea.dataset.noteFor = node.id;
      noteArea.placeholder = 'Optional paragraph note';
      noteArea.value = node.note || '';
      noteArea.style.height = `${Math.max(30, (metrics.notePanelHeight || NOTE_MIN_PANEL_HEIGHT) - 8)}px`;
      noteWrap.appendChild(noteArea);
      nodeEl.appendChild(noteWrap);
    }

    if (!isRecycled) nodesEl.appendChild(nodeEl);
    rendered.set(node.id, nodeEl);
  });

  // Remove orphaned node elements
  for (const [id, el] of existingNodes) {
    if (!visited.has(id)) el.remove();
  }

  const xShiftById = new Map();
  if (!isRadial) {
    // Compensate for variable root-node width: layout math uses NODE_WIDTH spacing,
    // so when a root pill is narrower, left subtrees need an equal leftward shift
    // to keep left/right geometry mirrored.
    const sideById = buildEffectiveSideMap(renderTree);
    for (const rootNode of renderTree.children) {
      const rootEl = rendered.get(rootNode.id);
      const rootWidth = rootEl ? rootEl.offsetWidth : NODE_WIDTH;
      const leftShift = Math.max(0, NODE_WIDTH - rootWidth);
      xShiftById.set(rootNode.id, 0);

      const markSubtreeShift = (node, shiftX) => {
        xShiftById.set(node.id, shiftX);
        for (const child of node.children) markSubtreeShift(child, shiftX);
      };

      for (const child of rootNode.children) {
        if (sideById.get(child.id) === 'left') markSubtreeShift(child, -leftShift);
        else markSubtreeShift(child, 0);
      }
    }
  } else {
    walkTree(renderTree, (node) => {
      xShiftById.set(node.id, 0);
    });
  }

  for (const [id, nodeEl] of rendered.entries()) {
    const pos = positions.get(id);
    if (!pos) continue;
    if (activeDragPreview && activeDragPreview.id === id) {
      nodeEl.style.left = `${activeDragPreview.x}px`;
      continue;
    }
    const shiftX = xShiftById.get(id) || 0;
    nodeEl.style.left = `${pos.x + shiftX}px`;
  }

  const rootIdSet = new Set(renderTree.children.map((n) => n.id));
  const anchorById = new Map();
  const nodesRect = nodesEl.getBoundingClientRect();
  walkTree(renderTree, (node) => {
    if (node.id === renderTree.id) return;
    const pos = positions.get(node.id);
    if (!pos) return;

    if (activeDragPreview && activeDragPreview.id === node.id) {
      const isRootNode = rootIdSet.has(node.id);
      const metrics = nodeMetrics.get(node.id);
      const anchorOffset = isRootNode
        ? ROOT_LINE_ANCHOR_OFFSET_Y
        : (metrics?.anchorOffset ?? NODE_LINE_ANCHOR_OFFSET_Y);
      anchorById.set(node.id, activeDragPreview.y + anchorOffset);
      return;
    }

    if (rootIdSet.has(node.id)) {
      anchorById.set(node.id, pos.y + ROOT_LINE_ANCHOR_OFFSET_Y);
      return;
    }

    const label = labelById.get(node.id);
    if (label) {
      const labelRect = label.getBoundingClientRect();
      const measuredY = (labelRect.bottom - nodesRect.top) / Math.max(0.0001, viewScale) - 1;
      anchorById.set(node.id, measuredY);
      return;
    }

    const metrics = nodeMetrics.get(node.id);
    anchorById.set(node.id, pos.y + (metrics?.anchorOffset ?? NODE_LINE_ANCHOR_OFFSET_Y));
  });

  walkTree(renderTree, (node, parent) => {
    if (!parent || parent.id === renderTree.id) return;
    const pos = positions.get(node.id);
    const pPos = positions.get(parent.id);
    if (!pos || !pPos) return;
    const nodeIsPreview = Boolean(activeDragPreview && activeDragPreview.id === node.id);
    const parentIsPreview = Boolean(activeDragPreview && activeDragPreview.id === parent.id);
    const nodeShiftX = xShiftById.get(node.id) || 0;
    const parentShiftX = xShiftById.get(parent.id) || 0;
    const nodeX = nodeIsPreview ? activeDragPreview.x : (pos.x + nodeShiftX);
    const parentX = parentIsPreview ? activeDragPreview.x : (pPos.x + parentShiftX);

    const isRootEdge = renderTree.children.some((r) => r.id === parent.id);
    const isLeft = pos.side === 'left';
    const parentWidth = rendered.get(parent.id)?.offsetWidth || NODE_WIDTH;
    const childWidth = rendered.get(node.id)?.offsetWidth || NODE_WIDTH;
    let x1;
    let x2;
    if (isLeft) {
      x1 = parentX;
      x2 = nodeX + childWidth;
    } else {
      x1 = parentX + parentWidth;
      x2 = nodeX;
    }
    const fallbackParentY = parentIsPreview
      ? (activeDragPreview.y + (rootIdSet.has(parent.id) ? ROOT_LINE_ANCHOR_OFFSET_Y : NODE_LINE_ANCHOR_OFFSET_Y))
      : (pPos.y + ROOT_LINE_ANCHOR_OFFSET_Y);
    const fallbackNodeY = nodeIsPreview
      ? (activeDragPreview.y + (rootIdSet.has(node.id) ? ROOT_LINE_ANCHOR_OFFSET_Y : NODE_LINE_ANCHOR_OFFSET_Y))
      : (pos.y + NODE_LINE_ANCHOR_OFFSET_Y);
    const y1 = anchorById.get(parent.id) || fallbackParentY;
    const y2 = anchorById.get(node.id) || fallbackNodeY;
    const midX = (x1 + x2) / 2;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
    path.setAttribute('stroke', palette[pos.depth % palette.length]);
    path.setAttribute('stroke-width', String(isRootEdge ? 3 : 2));
    path.setAttribute('fill', 'none');
    path.classList.add('branch-link');
    path.dataset.parentId = parent.id;
    path.dataset.childId = node.id;
    linksEl.appendChild(path);
  });

  lastMindmapRenderCache = {
    renderTree,
    positions,
    nodeMetrics,
    xShiftById,
    anchorById,
    rootIdSet,
    rendered,
  };
}

function getPreviewAnchorOffset(cache, nodeId) {
  if (cache.rootIdSet.has(nodeId)) return ROOT_LINE_ANCHOR_OFFSET_Y;
  return cache.nodeMetrics.get(nodeId)?.anchorOffset ?? NODE_LINE_ANCHOR_OFFSET_Y;
}

function getPreviewNodeX(cache, nodeId, preview) {
  const pos = cache.positions.get(nodeId);
  if (!pos) return null;
  if (preview && preview.id === nodeId) return preview.x;
  return pos.x + (cache.xShiftById.get(nodeId) || 0);
}

function getPreviewNodeY(cache, nodeId, preview) {
  if (preview && preview.id === nodeId) {
    return preview.y + getPreviewAnchorOffset(cache, nodeId);
  }
  const pos = cache.positions.get(nodeId);
  if (!pos) return null;
  return cache.anchorById.get(nodeId) || (pos.y + getPreviewAnchorOffset(cache, nodeId));
}

function appendPreviewBranchPath(cache, parentId, childId, preview) {
  const pos = cache.positions.get(childId);
  if (!pos) return;
  const parentX = getPreviewNodeX(cache, parentId, preview);
  const childXBase = getPreviewNodeX(cache, childId, preview);
  const y1 = getPreviewNodeY(cache, parentId, preview);
  const y2 = getPreviewNodeY(cache, childId, preview);
  if (parentX === null || childXBase === null || y1 === null || y2 === null) return;

  const isRootEdge = cache.rootIdSet.has(parentId);
  const isLeft = pos.side === 'left';
  const parentWidth = cache.rendered.get(parentId)?.offsetWidth || NODE_WIDTH;
  const childWidth = cache.rendered.get(childId)?.offsetWidth || NODE_WIDTH;
  const x1 = isLeft ? parentX : parentX + parentWidth;
  const x2 = isLeft ? childXBase + childWidth : childXBase;
  const midX = (x1 + x2) / 2;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
  path.setAttribute('stroke', palette[pos.depth % palette.length]);
  path.setAttribute('stroke-width', String(isRootEdge ? 3 : 2));
  path.setAttribute('fill', 'none');
  path.classList.add('branch-link');
  path.dataset.parentId = parentId;
  path.dataset.childId = childId;
  linksEl.appendChild(path);
}

function refreshDragPreviewVisual() {
  if (viewMode !== 'mindmap') return;
  if (!dragPreview || !draggedId || dragPreview.id !== draggedId) return;
  const cache = lastMindmapRenderCache;
  if (!cache || !cache.rendered || !cache.positions) {
    scheduleRender();
    return;
  }

  const draggedEl = cache.rendered.get(draggedId);
  if (!draggedEl) {
    scheduleRender();
    return;
  }

  draggedEl.style.left = `${dragPreview.x}px`;
  draggedEl.style.top = `${dragPreview.y}px`;

  const info = findNodeById(draggedId);
  if (!info.node) return;

  for (const path of Array.from(linksEl.querySelectorAll('.branch-link'))) {
    if (path.dataset.parentId === draggedId || path.dataset.childId === draggedId) {
      path.remove();
    }
  }

  if (info.parent && info.parent.id !== mapState.id && cache.rendered.has(info.parent.id)) {
    appendPreviewBranchPath(cache, info.parent.id, draggedId, dragPreview);
  }

  for (const child of info.node.children) {
    if (!cache.rendered.has(child.id)) continue;
    appendPreviewBranchPath(cache, draggedId, child.id, dragPreview);
  }
}

function scheduleDragPreviewRefresh() {
  if (_dragPreviewRafId !== null) return;
  _dragPreviewRafId = requestAnimationFrame(() => {
    _dragPreviewRafId = null;
    refreshDragPreviewVisual();
  });
}

function createWallNodeLabel(node, className = 'wall-label') {
  const label = document.createElement('div');
  label.className = className;
  label.contentEditable = node.id === editingId ? 'true' : 'false';
  label.spellcheck = false;
  label.dataset.labelFor = node.id;
  label.textContent = node.text;

  label.addEventListener('dblclick', (event) => {
    event.stopPropagation();
    if (editingId === node.id) return;
    beginLabelEdit(node.id, label, false);
  });

  label.addEventListener('click', (event) => {
    event.stopPropagation();
    selectedId = node.id;
    if (editingId !== node.id) beginLabelEdit(node.id, label, false);
  });

  label.addEventListener('blur', () => {
    if (editingId !== node.id) return;
    if (labelRelayoutInProgress && labelRelayoutTargetId === node.id) return;
    endLabelEdit(node.id, label, true);
  });

  label.addEventListener('keydown', (event) => {
    if (editingId !== node.id) return;
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      endLabelEdit(node.id, label, true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      endLabelEdit(node.id, label, false);
    }
  });

  return label;
}

function createWallNoteToggle(node) {
  const hasNote = Boolean((node.note || '').trim());
  if (!hasNote && !node.noteOpen) return null;

  const noteToggle = document.createElement('button');
  noteToggle.type = 'button';
  noteToggle.className = 'note-toggle';
  noteToggle.title = node.noteOpen ? 'Collapse note' : 'Expand note';
  noteToggle.setAttribute('aria-label', node.noteOpen ? 'Collapse note' : 'Expand note');
  noteToggle.setAttribute('aria-expanded', node.noteOpen ? 'true' : 'false');
  noteToggle.setAttribute('contenteditable', 'false');
  noteToggle.draggable = false;
  if (node.noteOpen) noteToggle.classList.add('is-open');
  if (hasNote) noteToggle.classList.add('has-note');
  noteToggle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  noteToggle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  noteToggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleNote(node.id);
  });
  return noteToggle;
}

function createWallNoteArea(node) {
  if (!node.noteOpen) return null;

  const noteWrap = document.createElement('div');
  noteWrap.className = 'wall-note-wrap';

  const noteArea = document.createElement('textarea');
  noteArea.className = 'node-note';
  noteArea.dataset.noteFor = node.id;
  noteArea.placeholder = 'Optional paragraph note';
  noteArea.value = node.note || '';
  let noteUndoArmed = false;
  noteArea.addEventListener('click', (event) => event.stopPropagation());
  noteArea.addEventListener('focus', () => {
    noteUndoArmed = true;
  });
  noteArea.addEventListener('input', () => {
    if (noteUndoArmed) {
      pushUndoSnapshot();
      noteUndoArmed = false;
    }
    node.note = noteArea.value;
    scheduleAutosave();
    scheduleNoteRelayout(node.id, noteArea);
  });
  noteArea.addEventListener('blur', () => {
    scheduleRender();
  });
  noteWrap.appendChild(noteArea);
  return noteWrap;
}

function buildDistanceToLeafMap(rootNodes) {
  const dist = new Map();

  function walk(node) {
    if (!node.children.length) {
      dist.set(node.id, 0);
      return 0;
    }
    let minChildDist = Number.POSITIVE_INFINITY;
    for (const child of node.children) {
      minChildDist = Math.min(minChildDist, walk(child));
    }
    const next = minChildDist + 1;
    dist.set(node.id, next);
    return next;
  }

  for (const root of rootNodes) {
    walk(root);
  }

  return dist;
}

const LAYER_TONES = [
  { bg: 'linear-gradient(175deg, rgba(255, 243, 181, 0.98) 0%, rgba(243, 224, 141, 0.98) 100%)', text: '#3e3314', accent: '#7d641f' },
  { bg: 'linear-gradient(175deg, rgba(203, 233, 255, 0.98) 0%, rgba(167, 214, 247, 0.98) 100%)', text: '#173247', accent: '#2d6d93' },
  { bg: 'linear-gradient(175deg, rgba(206, 243, 196, 0.98) 0%, rgba(170, 227, 154, 0.98) 100%)', text: '#1f3a1a', accent: '#3e7a2b' },
  { bg: 'linear-gradient(175deg, rgba(252, 218, 193, 0.98) 0%, rgba(244, 188, 158, 0.98) 100%)', text: '#4a2818', accent: '#9a4f2d' },
  { bg: 'linear-gradient(175deg, rgba(240, 220, 252, 0.98) 0%, rgba(220, 188, 247, 0.98) 100%)', text: '#3b234b', accent: '#75439b' },
];

function applyLayerTone(el, layer) {
  const tone = LAYER_TONES[layer % LAYER_TONES.length];
  el.style.setProperty('--layer-bg', tone.bg);
  el.style.setProperty('--layer-text', tone.text);
  el.style.setProperty('--layer-accent', tone.accent);
}

function createPostitCard(node, layer = 0) {
  const postit = document.createElement('article');
  postit.className = 'wall-node postit-node';
  if (node.id === selectedId) postit.classList.add('selected');
  if (recentChangesEnabled && isNodeRecentlyChanged(node.id)) postit.classList.add('recent-change');
  if (recentChangesEnabled && searchState.matchedNodeIds.has(node.id)) postit.classList.add('find-match');
  if (recentChangesEnabled && searchState.matches[searchState.activeMatchIndex]?.nodeId === node.id) {
    postit.classList.add('find-active');
  }
  postit.dataset.id = node.id;
  postit.dataset.layer = String(layer);
  applyLayerTone(postit, layer);

  postit.addEventListener('click', (event) => {
    if (event.target.closest('.note-toggle, .node-note')) return;
    selectedId = node.id;
    if (node.id !== editingId) scheduleRender();
  });

  const label = createWallNodeLabel(node, 'postit-label');
  const noteToggle = createWallNoteToggle(node);
  if (noteToggle) label.appendChild(noteToggle);
  postit.appendChild(label);

  const noteArea = createWallNoteArea(node);
  if (noteArea) postit.appendChild(noteArea);
  return postit;
}

function buildWallNode(node, distanceToLeaf, layer = 0) {
  const nodeDepthToLeaf = distanceToLeaf.get(node.id) ?? 0;
  const isPostitLevel = nodeDepthToLeaf <= 1;

  if (isPostitLevel) {
    const postit = createPostitCard(node, layer);
    if (!node.children.length) return postit;

    const bundle = document.createElement('div');
    bundle.className = 'wall-node postit-bundle';
    bundle.appendChild(postit);

    const childCluster = document.createElement('div');
    childCluster.className = 'postit-cluster postit-child-cluster';
    for (const child of node.children) {
      const childGroup = document.createElement('div');
      childGroup.className = 'postit-group';
      const childDepthToLeaf = distanceToLeaf.get(child.id) ?? 0;
      if (childDepthToLeaf === 1) childGroup.classList.add('has-bundle');
      else childGroup.classList.add('single-note');
      childGroup.appendChild(buildWallNode(child, distanceToLeaf, layer + 1));
      childCluster.appendChild(childGroup);
    }
    bundle.appendChild(childCluster);
    return bundle;
  }

  const area = document.createElement('section');
  area.className = 'wall-node area-node';
  if (node.id === selectedId) area.classList.add('selected');
  if (recentChangesEnabled && isNodeRecentlyChanged(node.id)) area.classList.add('recent-change');
  if (recentChangesEnabled && searchState.matchedNodeIds.has(node.id)) area.classList.add('find-match');
  if (recentChangesEnabled && searchState.matches[searchState.activeMatchIndex]?.nodeId === node.id) {
    area.classList.add('find-active');
  }
  area.dataset.id = node.id;
  area.dataset.layer = String(layer);
  applyLayerTone(area, layer);

  area.addEventListener('click', (event) => {
    if (event.target.closest('.note-toggle, .node-note')) return;
    selectedId = node.id;
    if (node.id !== editingId) scheduleRender();
  });

  const header = document.createElement('header');
  header.className = 'area-header';
  const title = createWallNodeLabel(node, 'area-title');
  const noteToggle = createWallNoteToggle(node);
  if (noteToggle) title.appendChild(noteToggle);
  header.appendChild(title);
  area.appendChild(header);

  const noteArea = createWallNoteArea(node);
  if (noteArea) area.appendChild(noteArea);

  const body = document.createElement('div');
  body.className = 'area-body';
  const childAreas = node.children.filter((child) => (distanceToLeaf.get(child.id) ?? 0) > 1);
  const childPostits = node.children.filter((child) => (distanceToLeaf.get(child.id) ?? 0) <= 1);

  if (childAreas.length) {
    const nestedAreas = document.createElement('div');
    nestedAreas.className = 'nested-areas';
    for (const childArea of childAreas) {
      nestedAreas.appendChild(buildWallNode(childArea, distanceToLeaf, layer + 1));
    }
    body.appendChild(nestedAreas);
  }

  if (childPostits.length) {
    // Keep post-it children grouped together for workshop-style clustering.
    const postitCluster = document.createElement('div');
    postitCluster.className = 'postit-cluster';
    for (const postitNode of childPostits) {
      const postitGroup = document.createElement('div');
      postitGroup.className = 'postit-group';
      const postitDepthToLeaf = distanceToLeaf.get(postitNode.id) ?? 0;
      if (postitDepthToLeaf === 1) postitGroup.classList.add('has-bundle');
      else postitGroup.classList.add('single-note');
      postitGroup.appendChild(buildWallNode(postitNode, distanceToLeaf, layer + 1));
      postitCluster.appendChild(postitGroup);
    }
    body.appendChild(postitCluster);
  }

  area.appendChild(body);
  return area;
}

function renderPostitWall() {
  nodesEl.innerHTML = '';
  linksEl.innerHTML = '';
  canvasEl.classList.add('postit-mode');
  nodesEl.classList.add('postit-wall');

  const board = document.createElement('div');
  board.className = 'workshop-board';
  const wallRoots =
    mapState.children.length === 1 && mapState.children[0].children.length
      ? mapState.children[0].children
      : mapState.children;
  const distanceToLeaf = buildDistanceToLeafMap(wallRoots);
  for (const rootNode of wallRoots) {
    board.appendChild(buildWallNode(rootNode, distanceToLeaf, 0));
  }
  nodesEl.appendChild(board);

  const bounds = measurePostitContentBounds();
  const width = Math.max(Math.ceil(bounds.maxX + MARGIN_X), viewportEl.clientWidth);
  const height = Math.max(Math.ceil(bounds.maxY + MARGIN_Y), viewportEl.clientHeight);
  nodesEl.style.width = `${width}px`;
  nodesEl.style.height = `${height}px`;
  linksEl.setAttribute('width', String(width));
  linksEl.setAttribute('height', String(height));
  linksEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (needsPostitAutoFit) {
    const fitWidth = Math.max(1, bounds.maxX - bounds.minX);
    const fitHeight = Math.max(1, bounds.maxY - bounds.minY);
    fitCanvasInViewport(
      fitWidth,
      fitHeight,
      0.92,
      POSTIT_MIN_FIT_SCALE,
      'top',
      bounds.minX,
      bounds.minY
    );
    needsPostitAutoFit = false;
  }
}

function measurePostitContentBounds() {
  const elems = nodesEl.querySelectorAll('.area-title, .postit-node, .wall-note-wrap');
  if (!elems.length) {
    return { minX: 0, minY: 0, maxX: viewportEl.clientWidth, maxY: viewportEl.clientHeight };
  }

  const nodesRect = nodesEl.getBoundingClientRect();
  const scale = Math.max(0.0001, viewScale || 1);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const el of elems) {
    const rect = el.getBoundingClientRect();
    const left = (rect.left - nodesRect.left) / scale;
    const top = (rect.top - nodesRect.top) / scale;
    const right = left + rect.width / scale;
    const bottom = top + rect.height / scale;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, maxX: viewportEl.clientWidth, maxY: viewportEl.clientHeight };
  }

  return { minX, minY, maxX, maxY };
}

function updateToggleLabels() {
  if (viewToggleEl) {
    const viewTip = viewMode === 'mindmap'
      ? 'Switch to Post-its view'
      : 'Switch to Mindmap view';
    viewToggleEl.title = viewTip;
    viewToggleEl.setAttribute('aria-label', viewTip);
    viewToggleEl.dataset.tooltip = viewTip;
    viewToggleEl.classList.toggle('is-active', viewMode === 'postits');
  }
  if (layoutToggleEl) {
    const layoutTip = layoutMode === 'cartesian'
      ? 'Switch to Star Tree layout'
      : 'Switch to Standard Tree layout';
    layoutToggleEl.title = layoutTip;
    layoutToggleEl.setAttribute('aria-label', layoutTip);
    layoutToggleEl.dataset.tooltip = layoutTip;
    layoutToggleEl.classList.toggle('is-active', layoutMode !== 'cartesian');
  }
  if (fullscreenToggleEl) {
    const fullscreenTip = document.fullscreenElement
      ? 'Exit fullscreen'
      : 'Enter fullscreen';
    fullscreenToggleEl.title = fullscreenTip;
    fullscreenToggleEl.setAttribute('aria-label', fullscreenTip);
    fullscreenToggleEl.dataset.tooltip = fullscreenTip;
    fullscreenToggleEl.classList.toggle('is-active', Boolean(document.fullscreenElement));
  }
  if (recentChangesToggleEl) {
    const hasBatches = externalChangeBatches.length > 0;
    const recentTip = recentChangesEnabled
      ? 'Hide last external update highlights'
      : 'Show last external update highlights';
    recentChangesToggleEl.title = recentTip;
    recentChangesToggleEl.setAttribute('aria-label', recentTip);
    recentChangesToggleEl.dataset.tooltip = recentTip;
    recentChangesToggleEl.classList.toggle('is-active', recentChangesEnabled);
    recentChangesToggleEl.disabled = !hasBatches && !recentChangesEnabled;
  }
  updateExternalBatchSelectUi();
}

function toggleViewMode() {
  viewMode = viewMode === 'mindmap' ? 'postits' : 'mindmap';
  if (viewMode === 'postits') {
    needsPostitAutoFit = !restoreViewportState();
  } else {
    restoreViewportState();
  }
  updateToggleLabels();
  syncUrlState();
  scheduleRender();
}

function toggleLayoutMode() {
  layoutMode = layoutMode === 'cartesian' ? 'radial' : 'cartesian';
  setStatus(`Layout: ${layoutMode === 'radial' ? 'star tree' : 'standard tree'}`, 'ok');
  restoreViewportState();
  updateToggleLabels();
  syncUrlState();
  scheduleRender();
}

async function toggleFullscreenMode() {
  if (Bridge.isFlutter()) {
    Bridge.toggleFullscreen();
    return;
  }
  const now = Date.now();
  if (fullscreenToggleInFlight) return;
  if (now - lastFullscreenToggleAt < FULLSCREEN_TOGGLE_COOLDOWN_MS) return;
  fullscreenToggleInFlight = true;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
    updateToggleLabels();
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  } finally {
    fullscreenToggleInFlight = false;
    lastFullscreenToggleAt = Date.now();
  }
}

function toggleRecentChangesMode() {
  if (!externalChangeBatches.length && !recentChangesEnabled) return;
  recentChangesEnabled = !recentChangesEnabled;
  updateToggleLabels();
  scheduleRender();
}

function scheduleRender(afterRender) {
  if (typeof afterRender === 'function') _renderCallbacks.push(afterRender);
  if (_renderRafId !== null) return;
  _renderRafId = requestAnimationFrame(() => {
    _renderRafId = null;
    const cbs = _renderCallbacks;
    _renderCallbacks = [];
    render();
    for (const cb of cbs) cb();
  });
}

function render() {
  if (!mapState) return;
  rebuildNodeIndex();
  seedLastExternalChangeBatchFromLegacyMap();
  syncSelectedExternalBatchSignatures();
  currentSignatureById = getCachedNodeSignatures(mapState).byId;
  ensureSelection();
  if (editingId && !findNodeById(editingId).node) editingId = null;
  if (searchState.query.trim()) {
    refreshSearchMatches();
  } else {
    searchState.matches = [];
    searchState.matchedNodeIds = new Set();
    searchState.activeMatchIndex = -1;
  }
  updateSearchUi();
  updateMapTitle();
  if (viewMode === 'postits') {
    lastMindmapRenderCache = null;
    renderPostitWall();
    return;
  }
  canvasEl.classList.remove('postit-mode');
  nodesEl.classList.remove('postit-wall');
  renderMindmap();
}

function handleKeydown(event) {
  if (!mapState) return;
  const key = event.key;
  const keyLower = key.toLowerCase();
  const active = document.activeElement;
  const editingText =
    editingId !== null ||
    (active && (
      active.tagName === 'TEXTAREA' ||
      active.tagName === 'INPUT' ||
      active.isContentEditable
    ));

  // Strict mode: while typing in any editable field, ignore all app-level key handling.
  if (editingText) return;

  if ((event.metaKey || event.ctrlKey) && !event.altKey && keyLower === 'f') {
    event.preventDefault();
    openSearch();
    return;
  }

  if (keyLower === 'f' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    const focused = document.activeElement;
    const onCanvas = !focused || focused === document.body || focused === viewportEl || focused === canvasEl;
    if (onCanvas) {
      event.preventDefault();
      toggleFullscreenMode();
      return;
    }
  }

  if ((event.metaKey || event.ctrlKey) && keyLower === 's') {
    event.preventDefault();
    saveNow();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && !event.altKey) {
    if (key === '+' || key === '=' || key === 'Add') {
      event.preventDefault();
      zoomAtViewportCenter(KEYBOARD_ZOOM_STEP);
      return;
    }
    if (key === '-' || key === '_' || key === 'Subtract') {
      event.preventDefault();
      zoomAtViewportCenter(1 / KEYBOARD_ZOOM_STEP);
      return;
    }
    if (key === '0') {
      event.preventDefault();
      zoomAtViewportCenter(1 / viewScale);
      return;
    }
  }

  if (!selectedId) return;

  if ((event.metaKey || event.ctrlKey) && !event.altKey && keyLower === 'z') {
    event.preventDefault();
    undoLastChange();
    return;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    if (event.shiftKey) outdentNode(selectedId);
    else addChildNode(selectedId);
    return;
  }

  if (selectedId && keyLower === 's' && viewMode === 'mindmap') {
    const { node, parent } = findNodeById(selectedId);
    const isDirectChildOfRoot = parent && mapState.children.some(r => r.id === parent.id);
    if (isDirectChildOfRoot) {
      event.preventDefault();
      pushUndoSnapshot();
      if (branchLayoutMode === 'auto') promoteAutoSidesToManual();
      const sideById = buildEffectiveSideMap(mapState);
      const currentSide = sideById.get(node.id) === 'left' ? 'left' : 'right';
      node.side = currentSide === 'left' ? 'right' : 'left';
      scheduleAutosave();
      scheduleRender();
    }
    return;
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (selectedId !== mapState.id) {
      event.preventDefault();
      removeNode(selectedId);
    }
    return;
  }

}

// Measure the bounding box of the rendered mindmap nodes in canvas
// coordinates (mirror of measurePostitContentBounds, for `.node` elements).
function measureMindmapContentBounds() {
  const elems = nodesEl.querySelectorAll('.node');
  if (!elems.length) {
    return { minX: 0, minY: 0, maxX: viewportEl.clientWidth, maxY: viewportEl.clientHeight };
  }
  const nodesRect = nodesEl.getBoundingClientRect();
  const scale = Math.max(0.0001, viewScale || 1);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elems) {
    const rect = el.getBoundingClientRect();
    const left = (rect.left - nodesRect.left) / scale;
    const top = (rect.top - nodesRect.top) / scale;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, left + rect.width / scale);
    maxY = Math.max(maxY, top + rect.height / scale);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return { minX: 0, minY: 0, maxX: viewportEl.clientWidth, maxY: viewportEl.clientHeight };
  }
  return { minX, minY, maxX, maxY };
}

function centerViewOnRoot() {
  if (!mapState || !mapState.children.length) return;
  // Fit the actual rendered content bounds, centered both axes. (The old
  // root-anchored fit used a layout height padded up to the viewport height,
  // which pushed the map low in the pane.)
  const bounds = measureMindmapContentBounds();
  const fitWidth = Math.max(1, bounds.maxX - bounds.minX);
  const fitHeight = Math.max(1, bounds.maxY - bounds.minY);
  fitCanvasInViewport(fitWidth, fitHeight, 0.9, MIN_ZOOM, 'center', bounds.minX, bounds.minY);
}

// FOLIO: keep the map fit-to-content until the user first pans/zooms. The
// engine otherwise fits once at boot — before async label relayout settles and
// before the embedding iframe reaches its final size — leaving the map
// off-centre. Re-fit across a few frames and on viewport resize.
let _autoFitActive = false;
let _autoFitInstalled = false;
function requestAutoFit() {
  _autoFitActive = true;
  installAutoFit();
  const run = () => { if (_autoFitActive) centerViewOnRoot(); };
  requestAnimationFrame(() => { run(); requestAnimationFrame(run); });
  setTimeout(run, 200);
}
function installAutoFit() {
  if (_autoFitInstalled || !viewportEl) return;
  _autoFitInstalled = true;
  const stop = () => { _autoFitActive = false; };
  viewportEl.addEventListener('pointerdown', stop, true);
  viewportEl.addEventListener('wheel', stop, { capture: true, passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (_autoFitActive) centerViewOnRoot(); }).observe(viewportEl);
  }
}

function fitCanvasInViewport(
  contentWidth,
  contentHeight,
  fillRatio = 0.9,
  minScale = MIN_ZOOM,
  verticalAlign = 'center',
  contentOffsetX = 0,
  contentOffsetY = 0
) {
  const vpW = viewportEl.clientWidth;
  const vpH = viewportEl.clientHeight;
  if (!vpW || !vpH || !contentWidth || !contentHeight) return;

  const scaleX = vpW / contentWidth;
  const scaleY = vpH / contentHeight;
  const targetScale = Math.min(scaleX, scaleY) * fillRatio;
  viewScale = clamp(Math.max(minScale, targetScale), MIN_ZOOM, MAX_ZOOM);

  viewX = (vpW - contentWidth * viewScale) / 2 - contentOffsetX * viewScale;
  if (verticalAlign === 'top') {
    viewY = POSTIT_TOP_PADDING - contentOffsetY * viewScale;
  } else {
    viewY = (vpH - contentHeight * viewScale) / 2 - contentOffsetY * viewScale;
  }
  applyCanvasTransform();
}

async function boot() {
  setStatus('Starting...');

  const params = new URLSearchParams(window.location.search);
  const queryFile = params.get('file');
  const queryView = params.get('view');
  const queryLayout = params.get('layout');
  if (queryView === 'postits' || queryView === 'mindmap') {
    viewMode = queryView;
  }
  if (queryLayout === 'star' || queryLayout === 'radial') {
    layoutMode = 'radial';
  } else if (queryLayout === 'standard' || queryLayout === 'cartesian') {
    layoutMode = 'cartesian';
  }
  updateToggleLabels();

  const config = await Bridge.getConfig();
  const initialFile = queryFile || config.defaultFile || '';

  if (initialFile) {
    await loadFile(initialFile);
  } else {
    const defaultRoot = { id: makeId(), text: 'Mindmap', note: '', noteOpen: false, children: [] };
    mapState = { id: makeId(), text: '__virtual_root__', note: '', noteOpen: false, children: [defaultRoot] };
    mapStateVersion++;
    rebuildNodeIndex();
    selectedId = defaultRoot.id;
    resetUndoHistory();
    render();
    setStatus('Ready');
  }

  syncUrlState();
  if (viewMode === 'postits') {
    needsPostitAutoFit = !restoreViewportState();
    render();
  } else if (Bridge.isFlutter()) {
    // Embedded (Folio/Flutter host): always fit fresh and keep re-fitting on
    // relayout/resize until the user pans or zooms. The shared virtual file
    // name makes saved per-file viewport state unreliable across host tabs.
    requestAutoFit();
  } else {
    if (!restoreViewportState()) centerViewOnRoot();
  }
}

document.addEventListener('keydown', handleKeydown);
if (findInputEl) {
  findInputEl.addEventListener('input', () => {
    searchState.query = findInputEl.value || '';
    _searchCacheKey = ''; // Invalidate search cache for live input
    refreshSearchMatches();
    if (searchState.matches.length) {
      selectedId = searchState.matches[searchState.activeMatchIndex].nodeId;
    }
    scheduleRender(() => {
      if (searchState.matches.length) {
        const activeNodeId = searchState.matches[searchState.activeMatchIndex]?.nodeId;
        ensureNodeVisible(activeNodeId);
      }
    });
  });

  findInputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      stepSearchMatch(event.shiftKey ? -1 : 1, { center: true, zoom: true });
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
    }
  });
}
if (findPrevEl) findPrevEl.addEventListener('click', () => stepSearchMatch(-1, { center: true, zoom: false }));
if (findNextEl) findNextEl.addEventListener('click', () => stepSearchMatch(1, { center: true, zoom: false }));
if (findCloseEl) findCloseEl.addEventListener('click', closeSearch);
setupViewportInteractions();
applyCanvasTransform();
if (depthSliderEl) {
  depthSliderEl.addEventListener('input', () => {
    const val = parseInt(depthSliderEl.value, 10);
    if (val >= 7) {
      maxVisibleDepth = null;
      depthValueEl.textContent = 'All';
    } else {
      maxVisibleDepth = val;
      depthValueEl.textContent = String(val);
    }
    scheduleRender();
  });
}
if (layoutToggleEl) {
  layoutToggleEl.addEventListener('click', toggleLayoutMode);
}
if (viewToggleEl) {
  viewToggleEl.addEventListener('click', toggleViewMode);
}
if (fullscreenToggleEl) {
  fullscreenToggleEl.addEventListener('click', toggleFullscreenMode);
}
if (recentChangesToggleEl) {
  recentChangesToggleEl.addEventListener('click', toggleRecentChangesMode);
}
if (externalBatchSelectEl) {
  externalBatchSelectEl.addEventListener('change', () => {
    const nextId = externalBatchSelectEl.value;
    if (!nextId) return;
    if (!externalChangeBatches.some((batch) => batch.id === nextId)) return;
    selectedExternalBatchId = nextId;
    _batchSigCacheKey = ''; // Invalidate cache for explicit selection change
    syncSelectedExternalBatchSignatures();
    persistExternalBatchesForCurrentFile();
    updateToggleLabels();
    scheduleRender();
  });
}
document.addEventListener('fullscreenchange', updateToggleLabels);
updateToggleLabels();
window.addEventListener('resize', () => {
  if (!mapState) return;
  if (viewMode === 'postits') {
    needsPostitAutoFit = true;
    scheduleRender();
  }
});
window.addEventListener('pagehide', () => {
  persistExternalBatchesForCurrentFile();
  persistViewportState();
});
window.addEventListener('beforeunload', () => {
  persistExternalBatchesForCurrentFile();
  persistViewportState();
});

// --- Browse modal ---
function openBrowseModal() {
  if (!browseOverlayEl) return;
  const startDir = currentFile ? currentFile.replace(/\/[^/]+$/, '') : '';
  browseOverlayEl.classList.remove('is-hidden');
  fetchBrowseDir(startDir || '');
}

function closeBrowseModal() {
  if (!browseOverlayEl) return;
  browseOverlayEl.classList.add('is-hidden');
}

async function fetchBrowseDir(dir) {
  try {
    const data = await Bridge.listDir(dir);
    renderBrowseBreadcrumbs(data.dir, data.parent);
    renderBrowseList(data.dir, data.parent, data.entries);
  } catch (err) {
    if (browseListEl) {
      browseListEl.innerHTML = `<li style="color:var(--err)">${err.message}</li>`;
    }
  }
}

function renderBrowseBreadcrumbs(dir, parent) {
  if (!browseBreadcrumbsEl) return;
  browseBreadcrumbsEl.innerHTML = '';
  const parts = dir.split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'bc-sep';
      sep.textContent = '/';
      browseBreadcrumbsEl.appendChild(sep);
    }
    const seg = document.createElement('button');
    seg.className = 'bc-seg';
    seg.textContent = parts[i];
    const segPath = '/' + parts.slice(0, i + 1).join('/');
    seg.addEventListener('click', () => fetchBrowseDir(segPath));
    browseBreadcrumbsEl.appendChild(seg);
  }
}

function renderBrowseList(dir, parent, entries) {
  if (!browseListEl) return;
  browseListEl.innerHTML = '';

  if (parent != null) {
    const li = document.createElement('li');
    li.className = 'browse-up';
    li.innerHTML = '<span class="browse-icon">↩</span><span class="browse-name">..</span>';
    li.addEventListener('click', () => fetchBrowseDir(parent));
    browseListEl.appendChild(li);
  }

  for (const entry of entries) {
    const li = document.createElement('li');
    const icon = entry.type === 'dir' ? '📁' : '📄';
    li.innerHTML = `<span class="browse-icon">${icon}</span><span class="browse-name">${escapeHtml(entry.name)}</span>`;
    const fullPath = dir + '/' + entry.name;
    if (entry.type === 'dir') {
      li.addEventListener('click', () => fetchBrowseDir(fullPath));
    } else {
      li.addEventListener('click', async () => {
        closeBrowseModal();
        await loadFile(fullPath);
        const url = new URL(window.location);
        url.searchParams.set('file', fullPath);
        window.history.replaceState({}, '', url);
        if (!restoreViewportState()) centerViewOnRoot();
      });
    }
    browseListEl.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

if (browseButtonEl) browseButtonEl.addEventListener('click', openBrowseModal);
if (browseCloseEl) browseCloseEl.addEventListener('click', closeBrowseModal);
if (browseBackdropEl) browseBackdropEl.addEventListener('click', closeBrowseModal);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && browseOverlayEl && !browseOverlayEl.classList.contains('is-hidden')) {
    event.stopPropagation();
    closeBrowseModal();
  }
}, true);

// --- Drag-and-drop file import ---
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = Array.from(e.dataTransfer.files).find((f) => f.name.endsWith('.md'));
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      setStatus('Importing...', 'warn');
      const data = await Bridge.importFile(
        file.name,
        reader.result,
        currentFile ? currentFile.replace(/\/[^/]+$/, '') : '',
      );
      await loadFile(data.filePath);
      const url = new URL(window.location);
      url.searchParams.set('file', data.filePath);
      window.history.replaceState({}, '', url);
      centerViewOnRoot();
      setStatus(`Imported ${data.filePath.split('/').pop()}`, 'ok');
    } catch (err) {
      setStatus(err.message || String(err), 'error');
    }
  };
  reader.readAsText(file);
});

// In embedded Flutter mode, hide standalone-only UI elements
if (Bridge.isFlutter()) {
  if (mapTitleEl) mapTitleEl.style.display = 'none';
  if (statusEl) statusEl.style.display = 'none';
}

boot().catch((err) => {
  setStatus(err.message || String(err), 'error');
});
