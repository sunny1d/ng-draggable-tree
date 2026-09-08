import { describe, expect, it } from 'vitest';
import { normalizeOptions, type NormalizedTreeOptions } from './tree-options';
import { TreeIndex } from './tree.index';
import { walkNodes } from './tree.model';

interface DemoNode {
  id: string;
  name: string;
  children?: DemoNode[];
}

const ROOTS: DemoNode[] = [
  {
    id: '1',
    name: 'A',
    children: [
      {
        id: '1-1',
        name: 'A1',
        children: [{ id: '1-1-1', name: 'A1a' }],
      },
      { id: '1-2', name: 'A2' },
    ],
  },
  { id: '2', name: 'B' },
  { id: '3', name: 'C', children: [] },
];

/** id 缺失（undefined）的节点：自身不入索引，但应继续遍历其子节点 */
const WITH_IDLESS = [
  {
    id: undefined,
    name: 'IDLESS',
    children: [{ id: 'ok-1', name: 'OK1', children: [{ id: 'ok-2', name: 'OK2' }] }],
  },
] as unknown as DemoNode[];

function opts(): NormalizedTreeOptions<DemoNode> {
  return normalizeOptions<DemoNode>({
    idField: 'id',
    displayField: 'name',
    childrenField: 'children',
  });
}

/** 用 walkNodes 产出 id → 定位信息，作为索引的“参照实现” */
function reference(roots: DemoNode[]): Map<string, { parentId: string | null; depth: number; indexInParent: number }> {
  const options = opts();
  const map = new Map<string, { parentId: string | null; depth: number; indexInParent: number }>();
  walkNodes(roots, options, (v) => {
    const parentId = v.parent === null ? null : options.getId(v.parent);
    map.set(String(v.id), {
      parentId: parentId === null ? null : String(parentId),
      depth: v.depth,
      indexInParent: v.indexInParent,
    });
  });
  return map;
}

describe('TreeIndex.build', () => {
  it('索引全部带 id 的节点，并可 O(1) 取回节点与父节点', () => {
    const idx = TreeIndex.build(ROOTS, opts());
    expect(idx.size).toBe(6);
    expect(idx.has('1-1-1')).toBe(true);
    expect(idx.node('1-1')!.name).toBe('A1');
    expect(idx.parentOf('1-1')!.id).toBe('1');
    expect(idx.parentOf('1')).toBeNull();
    expect(idx.node('missing')).toBeNull();
    expect(idx.get('missing')).toBeUndefined();
  });

  it('定位信息与 walkNodes 参照实现一致（parentId / depth / indexInParent）', () => {
    const idx = TreeIndex.build(ROOTS, opts());
    const ref = reference(ROOTS);
    expect(idx.size).toBe(ref.size);
    for (const [id, expected] of ref) {
      const entry = idx.get(id);
      expect(entry, `id=${id}`).toBeDefined();
      expect(entry!.depth).toBe(expected.depth);
      expect(entry!.indexInParent).toBe(expected.indexInParent);
      expect(entry!.parentId === null ? null : String(entry!.parentId)).toBe(expected.parentId);
    }
  });

  it('entries() 顺序与 walkNodes 先序一致', () => {
    const idx = TreeIndex.build(ROOTS, opts());
    const expected: string[] = [];
    walkNodes(ROOTS, opts(), (v) => expected.push(String(v.id)));
    expect(idx.entries().map((e) => String(e.id))).toEqual(expected);
  });

  it('id 缺失的节点不入索引，但其子节点仍被索引', () => {
    const idx = TreeIndex.build(WITH_IDLESS, opts());
    expect(idx.size).toBe(2);
    expect(idx.entries().some((e) => e.node.name === 'IDLESS')).toBe(false);
    expect(idx.has('ok-1')).toBe(true);
    expect(idx.has('ok-2')).toBe(true);
    expect(idx.parentOf('ok-1')!.name).toBe('IDLESS');
    expect(idx.parentOf('ok-2')!.id).toBe('ok-1');
  });

  it('重复 id 时定位取先序首个，但先序条目保留全部出现', () => {
    const dup: DemoNode[] = [
      { id: 'd', name: 'first', children: [{ id: 'd', name: 'second' }] },
    ];
    const idx = TreeIndex.build(dup, opts());
    expect(idx.size).toBe(1);
    expect(idx.node('d')!.name).toBe('first');
    expect(idx.entries().filter((e) => e.id === 'd').length).toBe(2);
    // 与旧 nodesFromIds 行为一致：树中同 id 的多次出现都会被取出
    expect(idx.pick(['d']).map((n) => n.name)).toEqual(['first', 'second']);
  });
});

describe('TreeIndex.pick', () => {
  it('按先序返回命中的节点数据', () => {
    const idx = TreeIndex.build(ROOTS, opts());
    expect(idx.pick(['2', '1-1', '1-1-1']).map((n) => n.name)).toEqual(['A1', 'A1a', 'B']);
  });

  it('忽略树中不存在的 id，空集合返回空数组', () => {
    const idx = TreeIndex.build(ROOTS, opts());
    expect(idx.pick(['missing'])).toEqual([]);
    expect(idx.pick([])).toEqual([]);
  });

  it('不返回 id 缺失的节点', () => {
    const idx = TreeIndex.build(WITH_IDLESS, opts());
    expect(idx.pick(['ok-1', 'ok-2']).map((n) => n.name)).toEqual(['OK1', 'OK2']);
    expect(idx.entries().length).toBe(2);
  });
});

describe('TreeIndex.isDescendantOf', () => {
  it('正确识别多层级后代关系', () => {
    const idx = TreeIndex.build(ROOTS, opts());
    expect(idx.isDescendantOf('1', '1-1')).toBe(true);
    expect(idx.isDescendantOf('1', '1-1-1')).toBe(true);
    expect(idx.isDescendantOf('1-1', '1-1-1')).toBe(true);
  });

  it('自身、兄弟、祖先、未知 id 均不算后代', () => {
    const idx = TreeIndex.build(ROOTS, opts());
    expect(idx.isDescendantOf('1', '1')).toBe(false);
    expect(idx.isDescendantOf('1-1', '1-2')).toBe(false);
    expect(idx.isDescendantOf('1-1-1', '1')).toBe(false);
    expect(idx.isDescendantOf('1', '2')).toBe(false);
    expect(idx.isDescendantOf('1', 'missing')).toBe(false);
    expect(idx.isDescendantOf('missing', '1')).toBe(false);
  });
});

describe('TreeIndex 查询复杂度（回归护栏）', () => {
  it('构建后定位查询不再触发任何遍历（getId 调用次数不增长）', () => {
    let reads = 0;
    const counting: NormalizedTreeOptions<DemoNode> = normalizeOptions<DemoNode>({
      idField: (n: DemoNode) => {
        reads++;
        return n.id;
      },
      displayField: 'name',
      childrenField: 'children',
    });

    const rows = 200;
    const perRow = 50;
    const big: DemoNode[] = [];
    for (let r = 0; r < rows; r++) {
      const children: DemoNode[] = [];
      for (let c = 0; c < perRow; c++) children.push({ id: `n-${r}-${c}`, name: `N${r}-${c}` });
      big.push({ id: `n-${r}`, name: `N${r}`, children });
    }

    const idx = TreeIndex.build(big, counting);
    const afterBuild = reads;
    expect(idx.size).toBe(rows * (perRow + 1));

    // 大量定位 / 祖先判定：不应再触碰数据（即 O(1) / O(depth)）
    let ok = true;
    for (let i = 0; i < 5000; i++) {
      const row = i % rows;
      const col = i % perRow;
      const id = `n-${row}-${col}`;
      ok = ok && idx.has(id) && idx.node(id) !== null && idx.parentOf(id) !== null;
      ok = ok && idx.isDescendantOf(`n-${row}`, id);
      ok = ok && !idx.isDescendantOf(id, `n-${row}`);
    }
    expect(ok).toBe(true);
    expect(reads).toBe(afterBuild);
  });
});
