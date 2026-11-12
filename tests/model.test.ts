import { describe, expect, it } from 'vitest';
import {
  type MindMapDoc, absPos, addChild, addSibling, autoLayout, branchColor, BRANCH_PALETTE, canReparent,
  createMap, depth, parseDoc, removeNode, reparent, side, subtreeRect, visibleIds,
} from '../src/model';

const size = () => ({ w: 100, h: 30 });
const overlaps = (doc: MindMapDoc) => {
  const ids = visibleIds(doc);
  const boxes = ids.map((id) => ({ id, ...absPos(doc, id) }));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (Math.abs(boxes[i].x - boxes[j].x) < 100 && Math.abs(boxes[i].y - boxes[j].y) < 30) return true;
  return false;
};

describe('model', () => {
  it('builds secondary and tertiary levels', () => {
    const d = createMap('Root');
    const a = addChild(d, d.rootId, 'A', size);
    const a1 = addChild(d, a, 'A1', size);
    const a1x = addChild(d, a1, 'A1x', size);
    expect(depth(d, a)).toBe(1);
    expect(depth(d, a1)).toBe(2);
    expect(depth(d, a1x)).toBe(3);
    expect(absPos(d, a1x).x).toBeGreaterThan(absPos(d, a1).x);
  });

  it('balances main branches across both sides of the root', () => {
    const d = createMap();
    const ids = [1, 2, 3, 4].map((i) => addChild(d, d.rootId, 'n' + i, size));
    const sides = ids.map((id) => side(d, id));
    expect(sides.filter((s) => s === 1).length).toBe(2);
    expect(sides.filter((s) => s === -1).length).toBe(2);
    // Children of a left branch grow leftwards
    const left = ids[sides.indexOf(-1)];
    const c = addChild(d, left, 'c', size);
    expect(absPos(d, c).x).toBeLessThan(absPos(d, left).x);
  });

  it('places new children and siblings without overlap', () => {
    const d = createMap();
    const a = addChild(d, d.rootId, 'A', size);
    for (let i = 0; i < 4; i++) addChild(d, a, 'x', size);
    const first = d.nodes[a].children[0];
    addSibling(d, first, 'sib', size);
    expect(d.nodes[a].children[1]).not.toBe(first);
    expect(overlaps(d)).toBe(false);
  });

  it('moving a node moves its subtree', () => {
    const d = createMap();
    const a = addChild(d, d.rootId, 'A', size);
    const b = addChild(d, a, 'B', size);
    const before = absPos(d, b);
    d.nodes[a].dx += 50;
    d.nodes[a].dy -= 20;
    expect(absPos(d, b)).toEqual({ x: before.x + 50, y: before.y - 20 });
  });

  it('removes subtrees and refuses to remove the root', () => {
    const d = createMap();
    const a = addChild(d, d.rootId, 'A', size);
    const b = addChild(d, a, 'B', size);
    expect(removeNode(d, d.rootId)).toBeNull();
    removeNode(d, a);
    expect(d.nodes[a]).toBeUndefined();
    expect(d.nodes[b]).toBeUndefined();
    expect(d.nodes[d.rootId].children).toEqual([]);
  });

  it('reparents but never into its own subtree', () => {
    const d = createMap();
    const a = addChild(d, d.rootId, 'A', size);
    const b = addChild(d, d.rootId, 'B', size);
    const a1 = addChild(d, a, 'A1', size);
    expect(canReparent(d, a, a1)).toBe(false);
    expect(canReparent(d, d.rootId, a)).toBe(false);
    expect(reparent(d, a1, b, size)).toBe(true);
    expect(d.nodes[a1].parentId).toBe(b);
    expect(d.nodes[b].children).toContain(a1);
    expect(d.nodes[a].children).not.toContain(a1);
    expect(side(d, a1)).toBe(side(d, b));
  });

  it('colours: palette per branch, inherited, overridable', () => {
    const d = createMap();
    const a = addChild(d, d.rootId, 'A', size);
    const b = addChild(d, d.rootId, 'B', size);
    const a1 = addChild(d, a, 'A1', size);
    expect(branchColor(d, a)).toBe(BRANCH_PALETTE[0]);
    expect(branchColor(d, b)).toBe(BRANCH_PALETTE[1]);
    expect(branchColor(d, a1)).toBe(BRANCH_PALETTE[0]);
    d.nodes[a].color = '#123456';
    expect(branchColor(d, a1)).toBe('#123456');
  });

  it('auto layout produces no overlaps and hides collapsed nodes', () => {
    const d = createMap();
    for (let i = 0; i < 6; i++) {
      const m = addChild(d, d.rootId, 'm', size);
      for (let j = 0; j < 4; j++) {
        const s = addChild(d, m, 's', size);
        for (let k = 0; k < 3; k++) addChild(d, s, 't', size);
      }
    }
    // scramble
    for (const n of Object.values(d.nodes)) if (n.parentId) n.dy = 0;
    expect(overlaps(d)).toBe(true);
    autoLayout(d, size);
    expect(overlaps(d)).toBe(false);
    const m0 = d.nodes[d.rootId].children[0];
    d.nodes[m0].collapsed = true;
    expect(visibleIds(d)).not.toContain(d.nodes[m0].children[0]);
    expect(subtreeRect(d, m0, size).maxY - subtreeRect(d, m0, size).minY).toBe(30);
  });

  it('round-trips through JSON and rejects garbage', () => {
    const d = createMap('X');
    addChild(d, d.rootId, 'A', size);
    expect(parseDoc(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(() => parseDoc({ foo: 1 })).toThrow();
  });
});
