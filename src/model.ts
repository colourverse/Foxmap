// Core mind map data model. Pure functions — no DOM access — so it can be unit tested.

export type Id = string;

export interface MindNode {
  id: Id;
  parentId: Id | null;
  text: string;
  children: Id[];
  /** Offset of this node's centre from its parent's centre (absolute position for the root). */
  dx: number;
  dy: number;
  /** Fill colour chosen by the user. Unset = inherit from the branch. */
  color?: string;
  collapsed?: boolean;
}

export interface MindMapDoc {
  version: 1;
  id: string;
  title: string;
  rootId: Id;
  nodes: Record<Id, MindNode>;
  updatedAt: number;
}

export interface Size {
  w: number;
  h: number;
}
export type SizeFn = (id: Id) => Size;

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Colours given automatically to main branches, in order. */
export const BRANCH_PALETTE = [
  '#e8590c',
  '#1c7ed6',
  '#2f9e44',
  '#ae3ec9',
  '#f59f00',
  '#0c8599',
  '#e03131',
  '#5f3dc4',
];
export const ROOT_COLOR = '#283593';

const H_GAP_ROOT = 80;
const H_GAP = 44;
const V_GAP = 14;

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function createMap(title = 'Central Idea'): MindMapDoc {
  const rootId = uid();
  return {
    version: 1,
    id: uid(),
    title,
    rootId,
    nodes: {
      [rootId]: { id: rootId, parentId: null, text: title, children: [], dx: 0, dy: 0 },
    },
    updatedAt: Date.now(),
  };
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function depth(doc: MindMapDoc, id: Id): number {
  let d = 0;
  let n = doc.nodes[id];
  while (n && n.parentId) {
    d++;
    n = doc.nodes[n.parentId];
  }
  return d;
}

export function absPos(doc: MindMapDoc, id: Id): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let n: MindNode | undefined = doc.nodes[id];
  while (n) {
    x += n.dx;
    y += n.dy;
    n = n.parentId ? doc.nodes[n.parentId] : undefined;
  }
  return { x, y };
}

/** True if `a` is `b` or one of b's ancestors. */
export function isAncestorOrSelf(doc: MindMapDoc, a: Id, b: Id): boolean {
  let n: MindNode | undefined = doc.nodes[b];
  while (n) {
    if (n.id === a) return true;
    n = n.parentId ? doc.nodes[n.parentId] : undefined;
  }
  return false;
}

/** Which side of its parent a node sits on: 1 = right, -1 = left. Root counts as right. */
export function side(doc: MindMapDoc, id: Id): 1 | -1 {
  const n = doc.nodes[id];
  if (!n.parentId) return 1;
  return n.dx < 0 ? -1 : 1;
}

/** Index of the first-level ancestor (main branch) that this node belongs to, or -1 for the root. */
function branchAncestor(doc: MindMapDoc, id: Id): MindNode | null {
  let n = doc.nodes[id];
  if (!n.parentId) return null;
  while (n.parentId && n.parentId !== doc.rootId) n = doc.nodes[n.parentId];
  return n;
}

/**
 * Branch colour: the nearest user-set colour on the node or its ancestors (excluding the root),
 * else the automatic palette colour of the main branch.
 */
export function branchColor(doc: MindMapDoc, id: Id): string {
  let n: MindNode | undefined = doc.nodes[id];
  if (!n.parentId) return n.color ?? ROOT_COLOR;
  while (n && n.parentId) {
    if (n.color) return n.color;
    n = doc.nodes[n.parentId];
  }
  const top = branchAncestor(doc, id)!;
  const idx = doc.nodes[doc.rootId].children.indexOf(top.id);
  return BRANCH_PALETTE[(idx < 0 ? 0 : idx) % BRANCH_PALETTE.length];
}

/** All nodes that are currently shown (descendants of collapsed nodes are hidden), depth-first. */
export function visibleIds(doc: MindMapDoc, from: Id = doc.rootId): Id[] {
  const out: Id[] = [];
  const walk = (id: Id) => {
    out.push(id);
    const n = doc.nodes[id];
    if (!n.collapsed) n.children.forEach(walk);
  };
  walk(from);
  return out;
}

export function descendantCount(doc: MindMapDoc, id: Id): number {
  let c = 0;
  const walk = (i: Id) => {
    for (const ch of doc.nodes[i].children) {
      c++;
      walk(ch);
    }
  };
  walk(id);
  return c;
}

/** Bounding box (absolute coordinates) of a node and its visible descendants. */
export function subtreeRect(doc: MindMapDoc, id: Id, size: SizeFn): Rect {
  const r: Rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const v of visibleIds(doc, id)) {
    const p = absPos(doc, v);
    const s = size(v);
    r.minX = Math.min(r.minX, p.x - s.w / 2);
    r.maxX = Math.max(r.maxX, p.x + s.w / 2);
    r.minY = Math.min(r.minY, p.y - s.h / 2);
    r.maxY = Math.max(r.maxY, p.y + s.h / 2);
  }
  return r;
}

/** Position `childId` (already in parent's children list) next to its parent, below existing siblings. */
export function placeChild(doc: MindMapDoc, childId: Id, size: SizeFn, forceSide?: 1 | -1): void {
  const child = doc.nodes[childId];
  const parent = doc.nodes[child.parentId!];
  const isRoot = !parent.parentId;
  const others = parent.children.filter((c) => c !== childId);

  let s: 1 | -1;
  if (forceSide) s = forceSide;
  else if (isRoot) {
    const right = others.filter((c) => doc.nodes[c].dx >= 0).length;
    const left = others.length - right;
    s = right <= left ? 1 : -1;
  } else s = side(doc, parent.id);

  const ps = size(parent.id);
  const cs = size(childId);
  child.dx = s * (ps.w / 2 + (isRoot ? H_GAP_ROOT : H_GAP) + cs.w / 2);

  const sameSide = others.filter((c) => (doc.nodes[c].dx < 0 ? -1 : 1) === s);
  if (sameSide.length === 0) {
    child.dy = 0;
    return;
  }
  const py = absPos(doc, parent.id).y;
  let bottom = -Infinity;
  for (const sib of sameSide) bottom = Math.max(bottom, subtreeRect(doc, sib, size).maxY - py);
  child.dy = bottom + V_GAP + cs.h / 2;
}

export function addChild(doc: MindMapDoc, parentId: Id, text: string, size: SizeFn): Id {
  const parent = doc.nodes[parentId];
  const id = uid();
  doc.nodes[id] = { id, parentId, text, children: [], dx: 0, dy: 0 };
  parent.children.push(id);
  parent.collapsed = false;
  placeChild(doc, id, size);
  return id;
}

/** Add a sibling directly after `id`. Siblings below it on the same side are pushed down. */
export function addSibling(doc: MindMapDoc, id: Id, text: string, size: SizeFn): Id {
  const n = doc.nodes[id];
  if (!n.parentId) return addChild(doc, id, text, size);
  const parent = doc.nodes[n.parentId];
  const newId = uid();
  doc.nodes[newId] = { id: newId, parentId: parent.id, text, children: [], dx: 0, dy: 0 };
  parent.children.splice(parent.children.indexOf(id) + 1, 0, newId);

  const s = side(doc, id);
  const ps = size(parent.id);
  const cs = size(newId);
  const isRoot = !parent.parentId;
  const nn = doc.nodes[newId];
  nn.dx = s * (ps.w / 2 + (isRoot ? H_GAP_ROOT : H_GAP) + cs.w / 2);
  const py = absPos(doc, parent.id).y;
  const below = subtreeRect(doc, id, size).maxY - py;
  nn.dy = below + V_GAP + cs.h / 2;

  // Push down siblings on the same side that would now overlap.
  const shift = cs.h + V_GAP;
  for (const sib of parent.children) {
    if (sib === newId || sib === id) continue;
    const sn = doc.nodes[sib];
    if ((sn.dx < 0 ? -1 : 1) === s && sn.dy > n.dy) sn.dy += shift;
  }
  return newId;
}

export function removeNode(doc: MindMapDoc, id: Id): Id | null {
  const n = doc.nodes[id];
  if (!n.parentId) return null; // root can't be removed
  const parent = doc.nodes[n.parentId];
  const idx = parent.children.indexOf(id);
  parent.children.splice(idx, 1);
  const kill = (i: Id) => {
    doc.nodes[i].children.forEach(kill);
    delete doc.nodes[i];
  };
  kill(id);
  // Select a neighbour afterwards.
  return parent.children[Math.min(idx, parent.children.length - 1)] ?? parent.id;
}

export function canReparent(doc: MindMapDoc, id: Id, newParentId: Id): boolean {
  const n = doc.nodes[id];
  return !!n.parentId && n.parentId !== newParentId && !isAncestorOrSelf(doc, id, newParentId);
}

export function reparent(doc: MindMapDoc, id: Id, newParentId: Id, size: SizeFn): boolean {
  if (!canReparent(doc, id, newParentId)) return false;
  const n = doc.nodes[id];
  const old = doc.nodes[n.parentId!];
  old.children.splice(old.children.indexOf(id), 1);
  const np = doc.nodes[newParentId];
  np.children.push(id);
  np.collapsed = false;
  n.parentId = newParentId;
  // Moving across sides of the root mirrors the subtree.
  const oldSide = side(doc, id);
  placeChild(doc, id, size);
  if (side(doc, id) !== oldSide) mirror(doc, id);
  return true;
}

/** Flip a node's descendants horizontally (used when a branch moves to the other side). */
function mirror(doc: MindMapDoc, id: Id) {
  for (const c of doc.nodes[id].children) {
    doc.nodes[c].dx = -doc.nodes[c].dx;
    mirror(doc, c);
  }
}

/**
 * Tidy automatic layout: keeps each main branch on its current side and stacks
 * subtrees so nothing overlaps.
 */
export function autoLayout(doc: MindMapDoc, size: SizeFn): void {
  const heights = new Map<Id, number>();
  const kids = (id: Id) => (doc.nodes[id].collapsed ? [] : doc.nodes[id].children);
  const height = (id: Id): number => {
    const ks = kids(id);
    const own = size(id).h;
    const h = ks.length ? Math.max(own, ks.reduce((a, k) => a + height(k), 0) + V_GAP * (ks.length - 1)) : own;
    heights.set(id, h);
    return h;
  };

  const stack = (parentId: Id, ids: Id[], s: 1 | -1, gap: number) => {
    const ps = size(parentId);
    const total = ids.reduce((a, k) => a + heights.get(k)!, 0) + V_GAP * Math.max(0, ids.length - 1);
    let y = -total / 2;
    for (const k of ids) {
      const h = heights.get(k)!;
      const n = doc.nodes[k];
      n.dx = s * (ps.w / 2 + gap + size(k).w / 2);
      n.dy = y + h / 2;
      y += h + V_GAP;
      stack(k, kids(k), s, H_GAP);
    }
  };

  const root = doc.nodes[doc.rootId];
  const right = root.children.filter((c) => doc.nodes[c].dx >= 0);
  const left = root.children.filter((c) => doc.nodes[c].dx < 0);
  // Balance if everything ended up on one side.
  if (left.length === 0 && right.length > 3) left.push(...right.splice(Math.ceil(right.length / 2)));
  root.children.forEach(height);
  stack(root.id, root.collapsed ? [] : right, 1, H_GAP_ROOT);
  stack(root.id, root.collapsed ? [] : left, -1, H_GAP_ROOT);
}

/** Validate & normalise a document loaded from JSON. Throws on invalid input. */
export function parseDoc(json: unknown): MindMapDoc {
  const d = json as MindMapDoc;
  if (!d || typeof d !== 'object' || !d.nodes || !d.rootId || !d.nodes[d.rootId]) {
    throw new Error('Not a Foxmap map file');
  }
  for (const [id, n] of Object.entries(d.nodes)) {
    if (n.id !== id || !Array.isArray(n.children) || typeof n.text !== 'string') {
      throw new Error('Corrupt node ' + id);
    }
    n.dx = Number(n.dx) || 0;
    n.dy = Number(n.dy) || 0;
    n.children = n.children.filter((c) => d.nodes[c]);
  }
  return {
    version: 1,
    id: d.id || uid(),
    title: d.title || d.nodes[d.rootId].text || 'Untitled',
    rootId: d.rootId,
    nodes: d.nodes,
    updatedAt: d.updatedAt || Date.now(),
  };
}

/** Fill a fresh map (just a root) with a small starter map showing the hierarchy levels. */
export function fillSample(doc: MindMapDoc, size: SizeFn): MindMapDoc {
  const r = doc.rootId;
  const ideas = addChild(doc, r, 'Ideas', size);
  addChild(doc, ideas, 'Brainstorm', size);
  const s = addChild(doc, ideas, 'Research', size);
  addChild(doc, s, 'Articles', size);
  addChild(doc, s, 'Interviews', size);
  const plan = addChild(doc, r, 'Plan', size);
  addChild(doc, plan, 'Milestones', size);
  addChild(doc, plan, 'Budget', size);
  const tips = addChild(doc, r, 'Tips', size);
  addChild(doc, tips, 'Tab = add child', size);
  addChild(doc, tips, 'Enter = add sibling', size);
  addChild(doc, tips, 'Drag nodes to move', size);
  addChild(doc, tips, 'Drop on a node to re-parent', size);
  const share = addChild(doc, r, 'Share', size);
  addChild(doc, share, 'Export PNG', size);
  addChild(doc, share, 'Export PDF', size);
  autoLayout(doc, size);
  return doc;
}
