// Turns a MindMapDoc into SVG. Used both for the live editor and for PNG/PDF export.
import {
  type Id,
  type MindMapDoc,
  type Rect,
  type Size,
  absPos,
  branchColor,
  depth,
  descendantCount,
  side,
  visibleIds,
} from './model';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const FONT_FAMILY = "'Segoe UI', system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif";

interface LevelStyle {
  size: number;
  weight: number;
  padX: number;
  padY: number;
  radius: number;
  minW: number;
  maxW: number;
}

const LEVELS: LevelStyle[] = [
  { size: 22, weight: 700, padX: 26, padY: 16, radius: 14, minW: 140, maxW: 320 },
  { size: 16, weight: 600, padX: 16, padY: 10, radius: 10, minW: 60, maxW: 260 },
  { size: 14, weight: 500, padX: 12, padY: 7, radius: 8, minW: 40, maxW: 240 },
  { size: 13, weight: 400, padX: 10, padY: 6, radius: 6, minW: 30, maxW: 220 },
];
export function levelStyle(d: number): LevelStyle {
  return LEVELS[Math.min(d, LEVELS.length - 1)];
}
export function fontFor(d: number): string {
  const s = levelStyle(d);
  return `${s.weight} ${s.size}px ${FONT_FAMILY}`;
}

let ctx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')!;
  return ctx;
}

/** Word-wrap text to fit maxW, honouring explicit newlines. */
export function wrapText(text: string, font: string, maxW: number): string[] {
  const c = measureCtx();
  c.font = font;
  const lines: string[] = [];
  for (const para of (text || ' ').split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (c.measureText(test).width > maxW && line.trim()) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else line = test;
      // Break very long single words.
      while (c.measureText(line).width > maxW && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && c.measureText(line.slice(0, cut)).width > maxW) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line || ' ');
  }
  return lines;
}

/**
 * Map a point (relative to the node centre) to a character offset in `text`,
 * using the same wrapped lines and font the node is drawn with.
 */
export function offsetAtPoint(text: string, lines: string[], font: string, lineHeight: number, relX: number, relY: number): number {
  const c = measureCtx();
  c.font = font;
  const top = -((lines.length - 1) * lineHeight) / 2;
  const li = Math.max(0, Math.min(lines.length - 1, Math.round((relY - top) / lineHeight)));
  // Start offset of each wrapped line within the original text.
  const starts: number[] = [];
  let pos = 0;
  for (const ln of lines) {
    let idx: number;
    if (ln.trim() === '') {
      idx = text[pos] === '\n' ? pos + 1 : pos;
      starts.push(idx);
      pos = idx;
      continue;
    }
    idx = text.indexOf(ln, pos);
    if (idx < 0) idx = pos;
    starts.push(idx);
    pos = idx + ln.length;
  }
  const line = lines[li].trim() === '' ? '' : lines[li];
  const x = relX + c.measureText(line).width / 2; // text is centred
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i <= line.length; i++) {
    const dist = Math.abs(c.measureText(line.slice(0, i)).width - x);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return Math.min(text.length, starts[li] + best);
}

export interface Layout {
  lines: string[];
  size: Size;
}

/** Caches measurements per (text, depth). */
export class Measurer {
  private cache = new Map<string, Layout>();
  constructor(private doc: () => MindMapDoc) {}

  layout(id: Id): Layout {
    const doc = this.doc();
    const n = doc.nodes[id];
    const d = depth(doc, id);
    const key = d + '\u0000' + n.text;
    let l = this.cache.get(key);
    if (!l) {
      const st = levelStyle(Math.min(d, LEVELS.length - 1));
      const font = fontFor(d);
      const lines = wrapText(n.text, font, st.maxW);
      const c = measureCtx();
      c.font = font;
      const tw = Math.max(...lines.map((ln) => c.measureText(ln).width));
      const lh = st.size * 1.3;
      l = {
        lines,
        size: {
          w: Math.ceil(Math.max(st.minW, tw + st.padX * 2)),
          h: Math.ceil(lines.length * lh + st.padY * 2),
        },
      };
      this.cache.set(key, l);
    }
    return l;
  }

  size = (id: Id): Size => this.layout(id).size;
}

// ---------- colour helpers ----------
function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
/** Mix colour with white. t=0 → colour, t=1 → white. */
export function tint(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}
export function shade(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - t), g * (1 - t), b * (1 - t));
}
export function textColorFor(bg: string): string {
  const [r, g, b] = hexToRgb(bg).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.45 ? '#1f2328' : '#ffffff';
}

export interface NodeColors {
  fill: string;
  stroke: string;
  text: string;
  edge: string;
}
export function nodeColors(doc: MindMapDoc, id: Id): NodeColors {
  const n = doc.nodes[id];
  const d = depth(doc, id);
  const branch = branchColor(doc, id);
  let fill: string;
  if (n.color) fill = n.color;
  else if (d === 0) fill = branch;
  else if (d === 1) fill = branch;
  else if (d === 2) fill = tint(branch, 0.82);
  else fill = tint(branch, 0.92);
  return { fill, stroke: d <= 1 ? shade(fill, 0.15) : branch, text: textColorFor(fill), edge: branch };
}

// ---------- SVG building ----------
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export interface RenderOptions {
  selectedId?: Id | null;
  dropTargetId?: Id | null;
  draggingId?: Id | null;
  interactive?: boolean;
}

export function contentRect(doc: MindMapDoc, m: Measurer): Rect {
  const r: Rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const id of visibleIds(doc)) {
    const p = absPos(doc, id);
    const s = m.size(id);
    r.minX = Math.min(r.minX, p.x - s.w / 2);
    r.maxX = Math.max(r.maxX, p.x + s.w / 2 + (doc.nodes[id].collapsed ? 30 : 0));
    r.minY = Math.min(r.minY, p.y - s.h / 2);
    r.maxY = Math.max(r.maxY, p.y + s.h / 2);
  }
  return r;
}

/** Render edges + nodes into `edgesG` and `nodesG`. */
export function renderMap(
  doc: MindMapDoc,
  m: Measurer,
  edgesG: SVGGElement,
  nodesG: SVGGElement,
  opts: RenderOptions = {},
): void {
  edgesG.replaceChildren();
  nodesG.replaceChildren();
  const ids = visibleIds(doc);
  const pos = new Map(ids.map((id) => [id, absPos(doc, id)]));

  // Edges
  for (const id of ids) {
    const n = doc.nodes[id];
    if (!n.parentId) continue;
    const p = pos.get(n.parentId)!;
    const c = pos.get(id)!;
    const ps = m.size(n.parentId);
    const cs = m.size(id);
    const d = depth(doc, id);
    const color = nodeColors(doc, id).edge;
    const dir = c.x >= p.x ? 1 : -1;
    let path: string;
    if (Math.abs(c.x - p.x) < (ps.w + cs.w) / 2 - 4) {
      // Mostly vertical relationship — connect top/bottom.
      const vdir = c.y >= p.y ? 1 : -1;
      const sy = p.y + (vdir * ps.h) / 2;
      const ey = c.y - (vdir * cs.h) / 2;
      const my = (sy + ey) / 2;
      path = `M${p.x},${sy} C${p.x},${my} ${c.x},${my} ${c.x},${ey}`;
    } else {
      const sx = d === 1 ? p.x + (dir * ps.w) / 2 - dir * 8 : p.x + (dir * ps.w) / 2;
      const ex = c.x - (dir * cs.w) / 2;
      const mx = (sx + ex) / 2;
      path = `M${sx},${p.y} C${mx},${p.y} ${mx},${c.y} ${ex},${c.y}`;
    }
    const width = d === 1 ? 4 : d === 2 ? 2.5 : 1.6;
    edgesG.appendChild(
      el('path', { d: path, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round' }),
    );
  }

  // Nodes
  for (const id of ids) {
    const n = doc.nodes[id];
    const { x, y } = pos.get(id)!;
    const d = depth(doc, id);
    const st = levelStyle(d);
    const lay = m.layout(id);
    const { w, h } = lay.size;
    const col = nodeColors(doc, id);

    const isSel = opts.interactive && id === opts.selectedId;
    const g = el('g', { transform: `translate(${x},${y})`, 'data-id': id, class: isSel ? 'node selected' : 'node' });
    if (opts.draggingId && id === opts.draggingId) g.setAttribute('opacity', '0.85');

    if (d === 0) {
      g.appendChild(
        el('rect', {
          x: -w / 2 + 2, y: -h / 2 + 4, width: w, height: h, rx: st.radius, fill: '#000', opacity: 0.12,
        }),
      );
    }
    g.appendChild(
      el('rect', {
        x: -w / 2, y: -h / 2, width: w, height: h, rx: st.radius,
        fill: col.fill, stroke: col.stroke, 'stroke-width': d <= 1 ? 1 : 1.5,
      }),
    );

    if (opts.interactive && (id === opts.selectedId || id === opts.dropTargetId)) {
      g.appendChild(
        el('rect', {
          x: -w / 2 - 5, y: -h / 2 - 5, width: w + 10, height: h + 10, rx: st.radius + 4,
          fill: 'none', stroke: id === opts.dropTargetId ? '#12b886' : '#339af0',
          'stroke-width': 2.5, 'stroke-dasharray': id === opts.dropTargetId ? '6 4' : '0',
          class: 'sel-outline',
        }),
      );
    }

    const lh = st.size * 1.3;
    const text = el('text', {
      'font-family': FONT_FAMILY, 'font-size': st.size, 'font-weight': st.weight,
      fill: col.text, 'text-anchor': 'middle',
    });
    const top = -((lay.lines.length - 1) * lh) / 2;
    lay.lines.forEach((ln, i) => {
      const t = el('tspan', { x: 0, y: top + i * lh, 'dominant-baseline': 'central' });
      t.textContent = ln;
      text.appendChild(t);
    });
    g.appendChild(text);

    // Collapse toggle (non-root nodes with children)
    if (n.children.length && n.parentId) {
      const s = side(doc, id);
      const tx = s * (w / 2 + 11);
      const tg = el('g', { transform: `translate(${tx},0)`, 'data-toggle': id, class: 'toggle' });
      if (n.collapsed) {
        const count = String(descendantCount(doc, id));
        const tw = Math.max(18, count.length * 7 + 10);
        tg.setAttribute('transform', `translate(${s * (w / 2 + 4 + tw / 2)},0)`);
        tg.appendChild(el('rect', { x: -tw / 2, y: -9, width: tw, height: 18, rx: 9, fill: '#fff', stroke: col.edge, 'stroke-width': 1.5 }));
        const ct = el('text', {
          'font-family': FONT_FAMILY, 'font-size': 11, 'font-weight': 600, fill: col.edge,
          'text-anchor': 'middle', 'dominant-baseline': 'central',
        });
        ct.textContent = count;
        tg.appendChild(ct);
        g.appendChild(tg);
      } else if (opts.interactive) {
        tg.appendChild(el('circle', { r: 7, fill: '#fff', stroke: col.edge, 'stroke-width': 1.5 }));
        tg.appendChild(el('path', { d: 'M-3.5,0 H3.5', stroke: col.edge, 'stroke-width': 1.6 }));
        g.appendChild(tg);
      }
    }

    // "+" add-child button on the selected node
    if (opts.interactive && id === opts.selectedId && !opts.draggingId) {
      const s = n.parentId ? side(doc, id) : 1;
      const off = n.children.length && n.parentId ? (n.collapsed ? 50 : 34) : 18;
      const ag = el('g', { transform: `translate(${s * (w / 2 + off)},0)`, 'data-add': id, class: 'add-btn' });
      ag.appendChild(el('circle', { r: 10, fill: '#339af0' }));
      ag.appendChild(el('path', { d: 'M-5,0 H5 M0,-5 V5', stroke: '#fff', 'stroke-width': 2, 'stroke-linecap': 'round' }));
      g.appendChild(ag);
    }

    nodesG.appendChild(g);
  }
}

/** Build a standalone SVG document for export. */
export function buildExportSvg(doc: MindMapDoc, m: Measurer, background = '#ffffff', pad = 40): {
  svg: string;
  width: number;
  height: number;
} {
  const r = contentRect(doc, m);
  const width = Math.ceil(r.maxX - r.minX + pad * 2);
  const height = Math.ceil(r.maxY - r.minY + pad * 2);
  const svg = el('svg', {
    xmlns: SVG_NS, width, height, viewBox: `${r.minX - pad} ${r.minY - pad} ${width} ${height}`,
  });
  if (background !== 'transparent') {
    svg.appendChild(el('rect', { x: r.minX - pad, y: r.minY - pad, width, height, fill: background }));
  }
  const eg = el('g', {});
  const ng = el('g', {});
  svg.append(eg, ng);
  renderMap(doc, m, eg, ng, { interactive: false });
  return { svg: new XMLSerializer().serializeToString(svg), width, height };
}
