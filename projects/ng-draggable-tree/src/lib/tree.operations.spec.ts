import { describe, expect, it } from 'vitest';
import { normalizeOptions, type NormalizedTreeOptions } from './tree-options';
import {
  cloneData,
  insertNodeData,
  listOfParent,
  moveNodes,
  moveNodesTo,
  removeNodeIds,
  removeNodeIdsWithData,
  transferNodes,
} from './tree.operations';

interface DemoNode {
  id: string;
  name: string;
  children?: DemoNode[];
}

const seed = (): DemoNode[] => [
  {
    id: '1',
    name: 'A',
    children: [
      { id: '1-1', name: 'A1' },
      { id: '1-2', name: 'A2' },
    ],
  },
  { id: '2', name: 'B' },
];

const left = (): DemoNode[] => [
  {
    id: 'l1',
    name: 'L1',
    children: [{ id: 'l1-1', name: 'L1.1' }],
  },
  { id: 'l2', name: 'L2' },
];

const right = (): DemoNode[] => [
  {
    id: 'r1',
    name: 'R1',
    children: [{ id: 'r1-1', name: 'R1.1' }],
  },
];

function opts(): NormalizedTreeOptions<DemoNode> {
  return normalizeOptions<DemoNode>({
    idField: 'id',
    displayField: 'name',
    childrenField: 'children',
  });
}

const rootIds = (list: DemoNode[]): string[] => list.map((n) => n.id);

function findSub(list: DemoNode[] | null, id: string): DemoNode | null {
  if (!list) return null;
  for (const node of list) {
    if (node.id === id) return node;
    const hit = findSub(node.children ?? null, id);
    if (hit) return hit;
  }
  return null;
}

const childIds = (parent: DemoNode): string[] => (parent.children ?? []).map((n) => n.id);

describe('cloneData', () => {
  it('深克隆树结构且不改动原对象', () => {
    const data = seed();
    const cp = cloneData(data, opts());
    expect(cp).not.toBe(data);
    expect(cp[0]).not.toBe(data[0]);
    expect(cp[0].children![0]).not.toBe(data[0].children![0]);
    expect(childIds(cp[0])).toEqual(['1-1', '1-2']);
    // 修改克隆不影响原数据
    cp[0].children!.pop();
    expect(data[0].children!.length).toBe(2);
  });
});

describe('moveNodes', () => {
  it('移动到根数组末尾（reorder）：原地修改，引用不变', () => {
    const data = seed();
    const next = moveNodes(data, opts(), ['1'], null, null);
    expect(next).toBe(data); // 原地语义：返回传入的同一引用
    expect(rootIds(next)).toEqual(['2', '1']);
  });

  it('移动到指定锚点之前', () => {
    const data = seed();
    const next = moveNodes(data, opts(), ['2'], null, '1');
    expect(next).toBe(data);
    expect(rootIds(next)).toEqual(['2', '1']);
  });

  it('移入指定父节点下并追加到末尾', () => {
    const data = seed();
    moveNodes(data, opts(), ['1'], null, null); // 先重排根级
    const next = moveNodes(data, opts(), ['1'], '2', null);
    expect(next).toBe(data);
    const b = findSub(next, '2')!;
    expect(childIds(b)).toEqual(['1']);
    expect(findSub(next, '1')).not.toBeNull();
  });

  it('整体携带被移动节点的后代', () => {
    const data = seed();
    const next = moveNodes(data, opts(), ['1'], '2', null);
    const a = findSub(next, '1')!;
    expect(childIds(a)).toEqual(['1-1', '1-2']);
    expect(rootIds(next)).toEqual(['2']);
  });

  it('被移动的是原对象（非克隆）', () => {
    const data = seed();
    const a = findSub(data, '1')!;
    moveNodes(data, opts(), ['1'], '2', null);
    expect(findSub(data, '2')!.children![0]).toBe(a);
  });

  it('moveNodesTo 同义别名行为一致', () => {
    const data = seed();
    const other = seed();
    expect(moveNodesTo(data, opts(), ['1'], '2', null)).toEqual(moveNodes(other, opts(), ['1'], '2', null));
  });
});

describe('transferNodes', () => {
  it('跨树移动到目标根级末尾：源树移除、目标树追加（两棵树均原地修改）', () => {
    const [src, dst] = [left(), right()];
    const r = transferNodes(src, opts(), dst, opts(), ['l1'], null, null)!;
    expect(r.sourceRoots).toBe(src);
    expect(r.targetRoots).toBe(dst);
    expect(rootIds(r.sourceRoots)).toEqual(['l2']);
    expect(rootIds(r.targetRoots)).toEqual(['r1', 'l1']);
    expect(r.moved.map((n) => n.id)).toEqual(['l1']);
    expect(childIds(r.moved[0])).toEqual(['l1-1']);
    expect(childIds(findSub(r.targetRoots, 'l1')!)).toEqual(['l1-1']);
  });

  it('插入到目标锚点之前', () => {
    const [src, dst] = [left(), right()];
    const r = transferNodes(src, opts(), dst, opts(), ['l1'], null, 'r1')!;
    expect(rootIds(r.targetRoots)).toEqual(['l1', 'r1']);
  });

  it('移入目标节点下并追加到末尾', () => {
    const [src, dst] = [left(), right()];
    const r = transferNodes(src, opts(), dst, opts(), ['l2'], 'r1', null)!;
    expect(childIds(findSub(r.targetRoots, 'r1')!)).toEqual(['r1-1', 'l2']);
  });

  it('写入目标树时深克隆：两棵树之间互不共享节点对象', () => {
    const [src, dst] = [left(), right()];
    const sourceNode = findSub(src, 'l1')!;
    const r = transferNodes(src, opts(), dst, opts(), ['l1'], null, null)!;
    // moved 是源树中被分离的实际对象
    expect(r.moved[0]).toBe(sourceNode);
    // 目标树持有的是克隆副本，与源对象不共享
    expect(findSub(r.targetRoots, 'l1')).not.toBe(r.moved[0]);
    expect(childIds(findSub(r.targetRoots, 'l1')!)).toEqual(['l1-1']);
    expect(childIds(findSub(r.targetRoots, 'l1')!.children![0])).toEqual([]);
  });

  it('目标树已存在同 id（含后代 id）时返回 null 且两棵树保持原样', () => {
    const [src, dst] = [left(), right()];
    expect(transferNodes(src, opts(), [{ id: 'l1', name: 'dup' }], opts(), ['l1'], null, null)).toBeNull();
    expect(transferNodes(src, opts(), [{ id: 'l1-1', name: 'dup' }], opts(), ['l1'], null, null)).toBeNull();
    // 冲突预检在改动源树之前完成
    expect(transferNodes(src, opts(), [{ id: 'l1', name: 'dup' }], opts(), ['l1'], null, null)).toBeNull();
    expect(rootIds(src)).toEqual(['l1', 'l2']);
    expect(rootIds(dst)).toEqual(['r1']);
  });

  it('落点容器不存在 / 源树找不到节点 / ids 为空时返回 null', () => {
    const [src, dst] = [left(), right()];
    expect(transferNodes(src, opts(), dst, opts(), ['l1'], 'ghost', null)).toBeNull();
    expect(transferNodes(src, opts(), dst, opts(), ['ghost'], null, null)).toBeNull();
    expect(transferNodes(src, opts(), dst, opts(), [], null, null)).toBeNull();
    expect(rootIds(src)).toEqual(['l1', 'l2']);
    expect(rootIds(dst)).toEqual(['r1']);
  });
});

describe('insertNodeData', () => {
  it('在根数组首位插入：原地 splice 写入', () => {
    const data = seed();
    const next = insertNodeData(data, opts(), null, { id: 'x', name: 'X' }, 'first');
    expect(next).toBe(data);
    expect(rootIds(next)).toEqual(['x', '1', '2']);
  });

  it('在指定父节点下追加', () => {
    const data = seed();
    const next = insertNodeData(data, opts(), '1', { id: '1-3', name: 'A3' });
    expect(next).toBe(data);
    expect(childIds(findSub(next, '1')!)).toEqual(['1-1', '1-2', '1-3']);
  });

  it('作为指定兄弟节点之前插入', () => {
    const data = seed();
    const next = insertNodeData(data, opts(), '1', { id: 'new', name: 'NEW' }, '1-2');
    expect(childIds(findSub(next, '1')!)).toEqual(['1-1', 'new', '1-2']);
  });
});

describe('removeNodeIds', () => {
  it('删除整棵子树并返回剩余根（原地修改）', () => {
    const data = seed();
    const next = removeNodeIds(data, opts(), ['1']);
    expect(next).toBe(data);
    expect(rootIds(next)).toEqual(['2']);
  });

  it('removeNodeIdsWithData 同时返回被删数据', () => {
    const data = seed();
    const removed = findSub(data, '1-2')!;
    const { roots, removed: detached } = removeNodeIdsWithData(data, opts(), ['1-2', '2']);
    expect(roots).toBe(data);
    expect(rootIds(roots)).toEqual(['1']);
    expect(detached.map((n) => n.id)).toEqual(['1-2', '2']);
    expect(detached[0]).toBe(removed);
    expect(findSub(roots, '1-2')).toBeNull();
  });
});

describe('listOfParent', () => {
  it('返回节点所在容器', () => {
    const data = seed();
    expect(listOfParent(data, opts(), '1')).toBe(data);
    expect(listOfParent(data, opts(), '1-1')!.map((n) => n.id)).toEqual(['1-1', '1-2']);
    expect(listOfParent(data, opts(), 'missing')).toBeNull();
  });
});
