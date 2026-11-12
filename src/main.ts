import './style.css';
import {
  BRANCH_PALETTE,
  type Id,
  type MindMapDoc,
  absPos,
  addChild,
  addSibling,
  autoLayout,
  canReparent,
  clone,
  createMap,
  depth,
  isAncestorOrSelf,
  parseDoc,
  removeNode,
  reparent,
  fillSample,
  side,
  visibleIds,
} from './model';
import { Measurer, contentRect, fontFor, levelStyle, nodeColors, renderMap } from './render';
import { exportJson, exportPdf, exportPng } from './export';
import * as store from './storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = $('canvas') as unknown as SVGSVGElement;
const viewportG = document.getElementById('viewport') as unknown as SVGGElement;
const edgesG = document.getElementById('edges') as unknown as SVGGElement;
const nodesG = document.getElementById('nodes') as unknown as SVGGElement;
const editor = $<HTMLTextAreaElement>('editor');
const titleInput = $<HTMLInputElement>('title');

// ---------------- state ----------------
let doc: MindMapDoc;
let selected: Id | null = null;
const view = { x: 0, y: 0, k: 1 };
let undoStack: MindMapDoc[] = [];
let redoStack: MindMapDoc[] = [];
const measurer = new Measurer(() => doc);
const size = measurer.size;

interface DragState {
  id: Id | null; // null = panning
  startX: number;
  startY: number;
  origDx: number;
  origDy: number;
  origViewX: number;
  origViewY: number;
  moved: boolean;
  snapshot: MindMapDoc;
  dropTarget: Id | null;
}
let drag: DragState | null = null;

// ---------------- persistence & history ----------------
let saveTimer = 0;
function scheduleSave() {
  doc.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => store.saveMap(doc), 300);
}

function pushUndo(snapshot: MindMapDoc = clone(doc)) {
  undoStack.push(snapshot);
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
}

/** Run a mutation as one undoable step. */
function commit(fn: () => void) {
  pushUndo();
  fn();
  afterChange();
}

function afterChange() {
  if (selected && !doc.nodes[selected]) selected = doc.rootId;
  scheduleSave();
  render();
}

function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(clone(doc));
  doc = prev;
  afterChange();
}
function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(clone(doc));
  doc = next;
  afterChange();
}

function loadDoc(d: MindMapDoc, fit = true) {
  finishEdit(true);
  doc = d;
  selected = d.rootId;
  undoStack = [];
  redoStack = [];
  store.setLast(d.id);
  render();
  if (fit) fitView();
}

// ---------------- rendering ----------------
function applyView() {
  viewportG.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  $('zoom-label').textContent = Math.round(view.k * 100) + '%';
  if (editingId) positionEditor();
}

function render() {
  renderMap(doc, measurer, edgesG, nodesG, {
    selectedId: selected,
    dropTargetId: drag?.dropTarget ?? null,
    draggingId: drag?.moved ? drag.id : null,
    interactive: true,
  });
  if (editingId) {
    const t = nodesG.querySelector(`[data-id="${editingId}"] text`);
    if (t) t.setAttribute('opacity', '0');
    positionEditor();
  }
  applyView();
  if (document.activeElement !== titleInput) titleInput.value = doc.title;
  ($('btn-undo') as HTMLButtonElement).disabled = undoStack.length === 0;
  ($('btn-redo') as HTMLButtonElement).disabled = redoStack.length === 0;
  const hasSel = !!selected;
  for (const b of ['btn-child', 'btn-sibling', 'btn-color']) ($(b) as HTMLButtonElement).disabled = !hasSel;
  ($('btn-delete') as HTMLButtonElement).disabled = !selected || selected === doc.rootId;
  $('color-dot').style.background = selected ? nodeColors(doc, selected).fill : 'transparent';
}

function stageSize() {
  const r = svg.getBoundingClientRect();
  return { w: r.width, h: r.height, left: r.left, top: r.top };
}

function fitView() {
  const r = contentRect(doc, measurer);
  const { w, h } = stageSize();
  const cw = r.maxX - r.minX + 80;
  const ch = r.maxY - r.minY + 80;
  view.k = Math.max(0.15, Math.min(1.25, w / cw, h / ch));
  view.x = w / 2 - ((r.minX + r.maxX) / 2) * view.k;
  view.y = h / 2 - ((r.minY + r.maxY) / 2) * view.k;
  applyView();
}

function zoomAt(factor: number, sx?: number, sy?: number) {
  const { w, h } = stageSize();
  const cx = sx ?? w / 2;
  const cy = sy ?? h / 2;
  const nk = Math.max(0.1, Math.min(4, view.k * factor));
  view.x = cx - ((cx - view.x) * nk) / view.k;
  view.y = cy - ((cy - view.y) * nk) / view.k;
  view.k = nk;
  applyView();
}

/** Pan just enough to bring a node into view. */
function ensureVisible(id: Id) {
  const p = absPos(doc, id);
  const s = size(id);
  const { w, h } = stageSize();
  const m = 40;
  const l = (p.x - s.w / 2) * view.k + view.x;
  const r = (p.x + s.w / 2) * view.k + view.x;
  const t = (p.y - s.h / 2) * view.k + view.y;
  const b = (p.y + s.h / 2) * view.k + view.y;
  if (l < m) view.x += m - l;
  else if (r > w - m) view.x -= r - (w - m);
  if (t < m) view.y += m - t;
  else if (b > h - m) view.y -= b - (h - m);
  applyView();
}

// ---------------- text editing ----------------
let editingId: Id | null = null;
let editOriginal = '';
let editSnapshot: MindMapDoc | null = null;

function startEdit(id: Id, initial?: string) {
  finishEdit(true);
  selected = id;
  editingId = id;
  editOriginal = doc.nodes[id].text;
  editSnapshot = clone(doc);
  if (initial !== undefined) doc.nodes[id].text = initial;
  editor.hidden = false;
  editor.value = doc.nodes[id].text;
  render();
  editor.focus();
  if (initial === undefined) editor.select();
  else editor.setSelectionRange(editor.value.length, editor.value.length);
}

function positionEditor() {
  if (!editingId || !doc.nodes[editingId]) return;
  const id = editingId;
  const p = absPos(doc, id);
  const s = size(id);
  const d = depth(doc, id);
  const st = levelStyle(d);
  const col = nodeColors(doc, id);
  const w = Math.max(s.w, 80) * view.k;
  const h = s.h * view.k;
  Object.assign(editor.style, {
    left: `${p.x * view.k + view.x - w / 2}px`,
    top: `${p.y * view.k + view.y - h / 2}px`,
    width: `${w}px`,
    height: `${h}px`,
    font: fontFor(d).replace(`${st.size}px`, `${st.size * view.k}px`),
    padding: `${st.padY * view.k - 2}px ${st.padX * view.k - 2}px`,
    background: col.fill,
    color: col.text,
    borderRadius: `${st.radius * view.k}px`,
  });
}

function finishEdit(keep: boolean) {
  if (!editingId) return;
  const id = editingId;
  editingId = null;
  editor.hidden = true;
  if (doc.nodes[id]) {
    const text = keep ? editor.value.trim() || editOriginal || 'Topic' : editOriginal;
    doc.nodes[id].text = text;
    if (id === doc.rootId && keep && (doc.title === editOriginal || !doc.title)) doc.title = text.replace(/\n/g, ' ');
    if (keep && editSnapshot && JSON.stringify(editSnapshot) !== JSON.stringify(doc)) pushUndo(editSnapshot);
  }
  editSnapshot = null;
  scheduleSave();
  render();
  svg.focus();
}

editor.addEventListener('input', () => {
  if (!editingId) return;
  doc.nodes[editingId].text = editor.value || ' ';
  render();
});
editor.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    finishEdit(false);
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    finishEdit(true);
  } else if (e.key === 'Tab') {
    e.preventDefault();
    finishEdit(true);
    addChildAndEdit();
  }
});
editor.addEventListener('blur', () => finishEdit(true));

// ---------------- actions ----------------
function addChildAndEdit(parent = selected) {
  if (!parent) return;
  let id = '';
  commit(() => {
    id = addChild(doc, parent, 'New topic', size);
    selected = id;
  });
  ensureVisible(id);
  startEdit(id);
}

function addSiblingAndEdit() {
  if (!selected) return;
  const from = selected;
  let id = '';
  commit(() => {
    id = addSibling(doc, from, 'New topic', size);
    selected = id;
  });
  ensureVisible(id);
  startEdit(id);
}

function deleteSelected() {
  if (!selected || selected === doc.rootId) return;
  const id = selected;
  commit(() => {
    selected = removeNode(doc, id);
  });
}

function toggleCollapse(id: Id) {
  const n = doc.nodes[id];
  if (!n.children.length || !n.parentId) return;
  commit(() => {
    n.collapsed = !n.collapsed;
    if (n.collapsed && selected && selected !== id && isAncestorOrSelf(doc, id, selected)) selected = id;
  });
}

function setColor(color: string | undefined) {
  if (!selected) return;
  const id = selected;
  const wholeBranch = ($('color-branch') as HTMLInputElement).checked;
  commit(() => {
    const apply = (i: Id) => {
      if (color) doc.nodes[i].color = color;
      else delete doc.nodes[i].color;
    };
    apply(id);
    // Descendants inherit the branch colour automatically; when "whole branch" is set,
    // clear their overrides so the new colour flows through.
    if (wholeBranch) {
      const clear = (i: Id) => doc.nodes[i].children.forEach((c) => (delete doc.nodes[c].color, clear(c)));
      clear(id);
    }
  });
}

// Keyboard navigation between topics.
function navigate(key: string) {
  if (!selected) {
    selected = doc.rootId;
    render();
    return;
  }
  const n = doc.nodes[selected];
  const vis = new Set(visibleIds(doc));
  const s = side(doc, selected);
  const closestChild = (dir: 1 | -1) => {
    if (n.collapsed) return null;
    const ks = n.children.filter((c) => vis.has(c) && (doc.nodes[c].dx < 0 ? -1 : 1) === dir);
    ks.sort((a, b) => Math.abs(doc.nodes[a].dy) - Math.abs(doc.nodes[b].dy));
    return ks[0] ?? null;
  };
  let next: Id | null = null;
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    const dir = key === 'ArrowRight' ? 1 : -1;
    if (!n.parentId) next = closestChild(dir);
    else if (s === dir) next = closestChild(dir);
    else next = n.parentId;
  } else if (n.parentId) {
    const sibs = doc.nodes[n.parentId].children
      .filter((c) => side(doc, c) === s)
      .sort((a, b) => doc.nodes[a].dy - doc.nodes[b].dy);
    const i = sibs.indexOf(selected);
    next = sibs[i + (key === 'ArrowDown' ? 1 : -1)] ?? null;
  }
  if (next) {
    selected = next;
    render();
    ensureVisible(next);
  }
}

// ---------------- pointer interaction ----------------
function toWorld(clientX: number, clientY: number) {
  const { left, top } = stageSize();
  return { x: (clientX - left - view.x) / view.k, y: (clientY - top - view.y) / view.k };
}

function nodeAtPoint(clientX: number, clientY: number, exclude: Id): Id | null {
  for (const elm of document.elementsFromPoint(clientX, clientY)) {
    const g = elm.closest?.('[data-id]');
    const id = g?.getAttribute('data-id');
    if (id && !isAncestorOrSelf(doc, exclude, id)) return id;
  }
  return null;
}

svg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  closePopovers();
  if (editingId) finishEdit(true);
  const target = e.target as Element;
  const add = target.closest('[data-add]');
  if (add) {
    e.preventDefault();
    addChildAndEdit(add.getAttribute('data-add')!);
    return;
  }
  const toggle = target.closest('[data-toggle]');
  if (toggle) {
    e.preventDefault();
    toggleCollapse(toggle.getAttribute('data-toggle')!);
    return;
  }
  const nodeEl = target.closest('[data-id]');
  svg.setPointerCapture(e.pointerId);
  svg.focus();
  if (nodeEl) {
    const id = nodeEl.getAttribute('data-id')!;
    selected = id;
    drag = {
      id, startX: e.clientX, startY: e.clientY,
      origDx: doc.nodes[id].dx, origDy: doc.nodes[id].dy,
      origViewX: view.x, origViewY: view.y,
      moved: false, snapshot: clone(doc), dropTarget: null,
    };
  } else {
    drag = {
      id: null, startX: e.clientX, startY: e.clientY, origDx: 0, origDy: 0,
      origViewX: view.x, origViewY: view.y, moved: false, snapshot: doc, dropTarget: null,
    };
    svg.classList.add('panning');
  }
  render();
});

svg.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const ddx = e.clientX - drag.startX;
  const ddy = e.clientY - drag.startY;
  if (!drag.moved && Math.hypot(ddx, ddy) < 4) return;
  drag.moved = true;
  if (drag.id === null) {
    view.x = drag.origViewX + ddx;
    view.y = drag.origViewY + ddy;
    applyView();
    return;
  }
  svg.classList.add('dragging');
  const n = doc.nodes[drag.id];
  n.dx = drag.origDx + ddx / view.k;
  n.dy = drag.origDy + ddy / view.k;
  // If a branch crosses to the other side of its parent, mirror its children so they follow.
  if (n.parentId && Math.sign(n.dx) !== Math.sign(drag.origDx) && n.dx !== 0) {
    mirrorChildren(drag.id);
    drag.origDx = -drag.origDx;
    n.dx = drag.origDx + ddx / view.k;
  }
  const t = e.shiftKey ? null : nodeAtPoint(e.clientX, e.clientY, drag.id);
  drag.dropTarget = t && canReparent(doc, drag.id, t) ? t : null;
  render();
});

function mirrorChildren(id: Id) {
  for (const c of doc.nodes[id].children) {
    doc.nodes[c].dx = -doc.nodes[c].dx;
    mirrorChildren(c);
  }
}

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  svg.classList.remove('panning', 'dragging');
  if (d.id && d.moved) {
    if (d.dropTarget) {
      // Restore position first so reparent places it neatly under the new parent.
      reparent(doc, d.id, d.dropTarget, size);
    }
    pushUndo(d.snapshot);
    scheduleSave();
  }
  render();
}
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);

svg.addEventListener('dblclick', (e) => {
  const nodeEl = (e.target as Element).closest('[data-id]');
  if (nodeEl && !(e.target as Element).closest('[data-toggle],[data-add]')) startEdit(nodeEl.getAttribute('data-id')!);
  else if (!nodeEl) {
    // Double-click on empty canvas adds a topic to the selected node (or root).
    const w = toWorld(e.clientX, e.clientY);
    const parent = selected ?? doc.rootId;
    let id = '';
    commit(() => {
      id = addChild(doc, parent, 'New topic', size);
      const pp = absPos(doc, parent);
      doc.nodes[id].dx = w.x - pp.x;
      doc.nodes[id].dy = w.y - pp.y;
      selected = id;
    });
    startEdit(id);
  }
});

svg.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const { left, top } = stageSize();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - left, e.clientY - top);
    } else {
      view.x -= e.deltaX;
      view.y -= e.deltaY;
      applyView();
    }
  },
  { passive: false },
);

// ---------------- keyboard ----------------
window.addEventListener('keydown', (e) => {
  const active = document.activeElement;
  const inField = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    exportJson(doc);
    return;
  }
  if (inField || document.querySelector('dialog[open]')) return;

  if (mod) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) undo();
    else if ((k === 'z' && e.shiftKey) || k === 'y') redo();
    else if (k === '=' || k === '+') zoomAt(1.2);
    else if (k === '-') zoomAt(1 / 1.2);
    else if (k === '0') fitView();
    else return;
    e.preventDefault();
    return;
  }
  switch (e.key) {
    case 'Tab':
      e.preventDefault();
      addChildAndEdit(selected ?? doc.rootId);
      return;
    case 'Enter':
      e.preventDefault();
      if (selected) addSiblingAndEdit();
      return;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      deleteSelected();
      return;
    case 'F2':
      e.preventDefault();
      if (selected) startEdit(selected);
      return;
    case ' ':
      e.preventDefault();
      if (selected) toggleCollapse(selected);
      return;
    case 'Escape':
      closePopovers();
      return;
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
      e.preventDefault();
      navigate(e.key);
      return;
  }
  if (selected && e.key.length === 1 && !e.altKey) {
    e.preventDefault();
    startEdit(selected, e.key);
  }
});

// ---------------- toolbar ----------------
function closePopovers() {
  $('color-pop').hidden = true;
  $('export-pop').hidden = true;
}
function togglePop(id: string) {
  const p = $(id);
  const wasHidden = p.hidden;
  closePopovers();
  p.hidden = !wasHidden;
}
document.addEventListener('pointerdown', (e) => {
  if (!(e.target as Element).closest('.popover-host')) closePopovers();
});

let toastTimer = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 2500);
}

const swatches = $('swatches');
for (const c of [...BRANCH_PALETTE, '#283593', '#495057', '#ffd43b', '#ffa8a8', '#a5d8ff', '#b2f2bb']) {
  const b = document.createElement('button');
  b.style.background = c;
  b.title = c;
  b.addEventListener('click', () => {
    setColor(c);
    closePopovers();
  });
  swatches.appendChild(b);
}
$('custom-color').addEventListener('change', (e) => setColor((e.target as HTMLInputElement).value));
$('btn-color-auto').addEventListener('click', () => {
  setColor(undefined);
  closePopovers();
});
$('btn-color').addEventListener('click', () => togglePop('color-pop'));
$('btn-export').addEventListener('click', () => togglePop('export-pop'));

$('export-pop').addEventListener('click', async (e) => {
  const b = (e.target as Element).closest('[data-export]');
  if (!b) return;
  closePopovers();
  const kind = b.getAttribute('data-export')!;
  const prevSel = selected;
  try {
    toast('Exporting…');
    if (kind === 'png') await exportPng(doc, measurer);
    else if (kind === 'png-t') await exportPng(doc, measurer, true);
    else if (kind === 'pdf-a4') await exportPdf(doc, measurer, 'a4');
    else if (kind === 'pdf-letter') await exportPdf(doc, measurer, 'letter');
    else if (kind === 'pdf-fit') await exportPdf(doc, measurer, 'fit');
    toast('Export ready');
  } catch (err) {
    console.error(err);
    toast('Export failed: ' + (err as Error).message);
  }
  selected = prevSel;
});

$('btn-child').addEventListener('click', () => addChildAndEdit());
$('btn-sibling').addEventListener('click', () => addSiblingAndEdit());
$('btn-delete').addEventListener('click', deleteSelected);
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-layout').addEventListener('click', () => {
  commit(() => autoLayout(doc, size));
  fitView();
});
$('btn-fit').addEventListener('click', fitView);
$('btn-zoom-in').addEventListener('click', () => zoomAt(1.2));
$('btn-zoom-out').addEventListener('click', () => zoomAt(1 / 1.2));

titleInput.addEventListener('change', () => {
  const t = titleInput.value.trim() || 'Untitled';
  commit(() => {
    doc.title = t;
  });
});
titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') titleInput.blur();
});

function newMap() {
  store.saveMap(doc);
  const d = createMap('Central Idea');
  store.saveMap(d);
  loadDoc(d);
  startEdit(d.rootId);
}
$('btn-new').addEventListener('click', newMap);
$('btn-save').addEventListener('click', () => exportJson(doc));
const fileInput = $<HTMLInputElement>('file-input');
$('btn-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (!f) return;
  try {
    const d = parseDoc(JSON.parse(await f.text()));
    // Avoid clobbering an existing map with the same id.
    if (store.loadMap(d.id)) d.id = createMap().id;
    store.saveMap(doc);
    store.saveMap(d);
    loadDoc(d);
    toast(`Opened “${d.title}”`);
  } catch (err) {
    toast('Could not open file: ' + (err as Error).message);
  }
});

// Maps dialog
const mapsDialog = $<HTMLDialogElement>('maps-dialog');
function renderMapsList() {
  const ul = $('maps-list');
  ul.replaceChildren();
  for (const m of store.listMaps()) {
    const li = document.createElement('li');
    if (m.id === doc.id) li.className = 'current';
    const open = document.createElement('button');
    open.className = 'map-open';
    open.textContent = m.title;
    open.addEventListener('click', () => {
      const d = store.loadMap(m.id);
      if (d) {
        store.saveMap(doc);
        loadDoc(d);
      }
      mapsDialog.close();
    });
    const date = document.createElement('span');
    date.className = 'map-date';
    date.textContent = new Date(m.updatedAt).toLocaleString();
    const del = document.createElement('button');
    del.textContent = '🗑';
    del.title = 'Delete map';
    del.addEventListener('click', () => {
      if (!confirm(`Delete “${m.title}”? This cannot be undone.`)) return;
      store.deleteMap(m.id);
      if (m.id === doc.id) {
        const rest = store.listMaps();
        const next = (rest[0] && store.loadMap(rest[0].id)) || createMap();
        store.saveMap(next);
        loadDoc(next);
      }
      renderMapsList();
    });
    li.append(open, date, del);
    ul.appendChild(li);
  }
}
$('btn-maps').addEventListener('click', () => {
  store.saveMap(doc);
  renderMapsList();
  mapsDialog.showModal();
});
$('maps-close').addEventListener('click', () => mapsDialog.close());
$('maps-new').addEventListener('click', () => {
  mapsDialog.close();
  newMap();
});
const helpDialog = $<HTMLDialogElement>('help-dialog');
$('btn-help').addEventListener('click', () => helpDialog.showModal());
$('help-close').addEventListener('click', () => helpDialog.close());

window.addEventListener('resize', () => applyView());
window.addEventListener('beforeunload', () => store.saveMap(doc));

// ---------------- boot ----------------
function boot() {
  store.migrateLegacy();
  const lastId = store.getLast();
  const last = lastId ? store.loadMap(lastId) : null;
  const first = last ?? store.listMaps().map((m) => store.loadMap(m.id)).find(Boolean) ?? null;
  if (first) loadDoc(first);
  else {
    // Measurer needs `doc` set before sizing nodes.
    doc = createMap('Foxmap');
    const sample = fillSample(doc, size);
    store.saveMap(sample);
    loadDoc(sample);
  }
  svg.focus();
}
boot();

// Exposed for automated tests / debugging.
(window as unknown as { foxmap: unknown }).foxmap = {
  get doc() {
    return doc;
  },
  get selected() {
    return selected;
  },
};
