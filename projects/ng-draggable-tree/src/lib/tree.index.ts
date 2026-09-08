import type { NormalizedTreeOptions } from './tree-options';
import type { TreeKey } from './tree.types';

/**
 * 定位索引：把「工作树」一次性展开成可 O(1) 查询的结构。
 * @internal
 */

/** 索引条目：单个节点的定位结果 */
export interface TreeIndexEntry<T = unknown> {
  /** 节点原始数据（工作树中的引用） */
  node: T;
  /** 节点 id */
  id: TreeKey;
  /** 直接父节点数据；根节点为 null */
  parent: T | null;
  /** 父节点 id；根节点为 null */
  parentId: TreeKey | null;
  /** 层级（根为 0） */
  depth: number;
  /** 在父数组（或根数组）中的下标 */
  indexInParent: number;
  /** 先序遍历序号 */
  rank: number;
}

export class TreeIndex<T = unknown> {
  private constructor(
    private readonly byId: Map<TreeKey, TreeIndexEntry<T>>,
    private readonly preorder: readonly TreeIndexEntry<T>[],
  ) {}

  /** 以工作树根数组构建索引（O(n)，迭代式先序遍历，避免深树递归爆栈） */
  static build<T>(roots: T[], options: NormalizedTreeOptions<T>): TreeIndex<T> {
    const byId = new Map<TreeKey, TreeIndexEntry<T>>();
    const preorder: TreeIndexEntry<T>[] = [];

    interface Frame {
      node: T;
      parent: T | null;
      parentId: TreeKey | null;
      depth: number;
      indexInParent: number;
    }

    const pushChildren = (children: readonly T[] | null, parent: T, parentId: TreeKey | null, depth: number): Frame[] => {
      const out: Frame[] = [];
      if (!children) return out;
      for (let i = children.length - 1; i >= 0; i--) {
        out.push({ node: children[i], parent, parentId, depth, indexInParent: i });
      }
      return out;
    };

    const stack: Frame[] = [];
    if (Array.isArray(roots)) {
      for (let i = roots.length - 1; i >= 0; i--) {
        stack.push({ node: roots[i], parent: null, parentId: null, depth: 0, indexInParent: i });
      }
    }

    while (stack.length) {
      const frame = stack.pop()!;
      const { node, parent, parentId, depth, indexInParent } = frame;
      const id = options.getId(node);
      if (id !== null) {
        const entry: TreeIndexEntry<T> = {
          node,
          id,
          parent,
          parentId,
          depth,
          indexInParent,
          rank: preorder.length,
        };
        preorder.push(entry);
        if (!byId.has(id)) byId.set(id, entry);
      }
      const value = options.getChildren(node);
      const children = Array.isArray(value) ? value : null;
      if (children && children.length) {
        stack.push(...pushChildren(children, node, id, depth + 1));
      }
    }

    return new TreeIndex<T>(byId, preorder);
  }

  /** 已索引的节点数（重复 id 只计一次） */
  get size(): number {
    return this.byId.size;
  }

  /** 是否包含该 id（O(1)） */
  has(id: TreeKey): boolean {
    return this.byId.has(id);
  }

  /** 查询条目（O(1)）；不存在返回 undefined */
  get(id: TreeKey): TreeIndexEntry<T> | undefined {
    return this.byId.get(id);
  }

  /** 查询节点数据（O(1)）；不存在返回 null */
  node(id: TreeKey): T | null {
    const entry = this.byId.get(id);
    return entry ? entry.node : null;
  }

  /** 查询父节点数据（O(1)）；根节点或不存在返回 null */
  parentOf(id: TreeKey): T | null {
    const entry = this.byId.get(id);
    return entry ? entry.parent : null;
  }

  /** 全部先序条目（含重复 id，顺序与 walkNodes 一致） */
  entries(): readonly TreeIndexEntry<T>[] {
    return this.preorder;
  }

  /**
   * 由 id 集合取回节点数据，顺序与 walkNodes（先序）一致；只包含树中存在的 id。
   */
  pick(ids: Iterable<TreeKey>): T[] {
    const set = new Set<TreeKey>(ids);
    if (!set.size) return [];
    const out: T[] = [];
    for (const entry of this.preorder) {
      if (set.has(entry.id)) out.push(entry.node);
    }
    return out;
  }

  /**
   * candidate 是否位于 ancestor 的子树内（**不含自身**），语义与
   * `tree.model.ts` 的 `isDescendantId` 一致，但复杂度为 O(depth) 而非 O(子树)。
   *
   * 依赖 id 唯一：重复 id 时以前序首个出现为准。
   */
  isDescendantOf(ancestorId: TreeKey, candidateId: TreeKey): boolean {
    if (ancestorId === candidateId) return false;
    let cursor = this.byId.get(candidateId);
    while (cursor && cursor.parentId !== null) {
      if (cursor.parentId === ancestorId) return true;
      cursor = this.byId.get(cursor.parentId);
    }
    return false;
  }
}
