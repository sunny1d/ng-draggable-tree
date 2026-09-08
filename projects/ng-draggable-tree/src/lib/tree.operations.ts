import type { NormalizedTreeOptions } from './tree-options';
import type { TreeKey } from './tree.types';

/**
 * 数据操作层：所有操作「原地修改」传入的树数据（顶层数组内容、父级 children
 * 数组与节点对象会被直接改动），数组/节点引用保持不变，由调用方以数据版本号
 * 信号触发视图重算。
 *
 * 例外：`cloneData` 仍用于快照（`snapshot` / `getData`）与外部载荷的深拷贝；
 * `insertNodesTo` / `insertNodesBatch` 插入前会深克隆载荷节点，保证树与外部数据
 * 互不共享对象。
 */

function readArr<T>(node: T, opts: NormalizedTreeOptions<T>): T[] | null {
  const value = opts.getChildren(node);
  return Array.isArray(value) ? value : null;
}

function writeArr<T>(node: T, arr: T[] | null, opts: NormalizedTreeOptions<T>): void {
  // 无子节点写空数组，保持原字段语义
  (node as Record<string, unknown>)[opts.childrenStorage] = arr ?? [];
}

/** 深克隆节点（对象浅拷贝 + children 递归克隆），用于快照与外部载荷拷贝 */
export function cloneData<T>(roots: T[], opts: NormalizedTreeOptions<T>): T[] {
  const cloneNode = (data: T): T => {
    const cp = { ...(data as object) } as T;
    const children = readArr(data, opts);
    if (children && children.length) {
      writeArr(cp, children.map(cloneNode), opts);
    }
    return cp;
  };
  return roots.map(cloneNode);
}

/** 按 id 定位节点，返回节点与父容器信息 */
interface LocateResult<T> {
  node: T;
  /** 根时为 null；否则为父节点数据 */
  parent: T | null;
}

function locate<T>(roots: T[], opts: NormalizedTreeOptions<T>, id: TreeKey): LocateResult<T> | null {
  const search = (list: T[] | null, parent: T | null): LocateResult<T> | null => {
    if (!list) return null;
    for (const node of list) {
      if (opts.getId(node) === id) return { node, parent };
      const hit = search(readArr(node, opts), node);
      if (hit) return hit;
    }
    return null;
  };
  return search(roots, null);
}

/**
 * 就地把一组最顶层节点从树中分离（保留子树），返回被分离节点（按原树先序）。
 * 直接 splice 各层真实数组，容器与节点引用不变。
 */
function detach<T>(
  roots: T[],
  opts: NormalizedTreeOptions<T>,
  topmostIds: Set<TreeKey>,
): T[] {
  const detached: T[] = [];
  const walk = (list: T[]): void => {
    for (let i = 0; i < list.length; ) {
      const node = list[i];
      const id = opts.getId(node);
      if (id !== null && topmostIds.has(id)) {
        detached.push(node);
        list.splice(i, 1);
        continue;
      }
      const children = readArr(node, opts);
      if (children && children.length) walk(children);
      i++;
    }
  };
  walk(roots);
  return detached;
}

/** 计算一组待操作 id 中的“最顶层” id（去掉作为其他待操作节点后代的重复项） */
function toTopmost<T>(
  roots: T[],
  opts: NormalizedTreeOptions<T>,
  ids: TreeKey[],
): TreeKey[] {
  const set = new Set(ids);
  const top: TreeKey[] = [];
  const walk = (list: T[] | null): void => {
    if (!list) return;
    for (const node of list) {
      const id = opts.getId(node);
      if (id === null) continue;
      if (set.has(id)) {
        top.push(id);
        continue; // 整棵子树处理，后代无需展开
      }
      walk(readArr(node, opts));
    }
  };
  walk(roots);
  return top;
}

/** 解析目标容器：根数组或目标父级的真实 children 数组（父级无 children 字段时创建并写入） */
function containerOf<T>(roots: T[], opts: NormalizedTreeOptions<T>, parentId: TreeKey | null): T[] {
  if (parentId === null) return roots;
  const loc = locate(roots, opts, parentId);
  if (!loc) return roots; // 目标缺失兜底为根级末尾（与调用方校验前的回落语义一致）
  const cur = readArr(loc.node, opts);
  if (cur) return cur;
  const fresh: T[] = [];
  writeArr(loc.node, fresh, opts);
  return fresh;
}

/** 解析插入下标：'first' → 0；兄弟锚点 → 其下标（锚点不存在则末尾）；其余 → 末尾 */
function insertIndexOf<T>(
  container: T[],
  opts: NormalizedTreeOptions<T>,
  position: 'first' | 'end' | TreeKey | null,
): number {
  if (position === 'first') return 0;
  if (position !== null && position !== 'end') {
    const idx = container.findIndex((n) => opts.getId(n) === position);
    if (idx >= 0) return idx;
  }
  return container.length;
}

/** 就地插入节点（根数组或父级 children 数组 splice 写入，引用不变） */
function insertInPlace<T>(
  roots: T[],
  opts: NormalizedTreeOptions<T>,
  items: T[],
  parentId: TreeKey | null,
  position: 'first' | 'end' | TreeKey | null,
): void {
  const container = containerOf(roots, opts, parentId);
  const idx = insertIndexOf(container, opts, position);
  container.splice(idx, 0, ...items);
}

/**
 * 单树内「移动」：把 roots 中 nodeIds 对应节点（含各自子树）**原地**移动到
 * targetParentId 下，返回同一根数组（内容已被修改）。
 *
 * - targetParentId 为 null 表示移到根级；
 * - anchorNodeId 非空时插到该锚点之前（作为其兄弟）；为空时追加到末尾；
 *   锚点本身也在被移动集合内时（拖拽组内部成员）自动改为追加。
 *
 * 落点是否合法（例如「不能移入自身后代」，否则形成环）不在本函数校验，
 * 由调用方按 allowDrop 保证——与本模块其余操作一致。
 */
export function moveNodes<T>(
  roots: T[],
  opts: NormalizedTreeOptions<T>,
  nodeIds: TreeKey[],
  targetParentId: TreeKey | null,
  anchorNodeId: TreeKey | null,
): T[] {
  const topmost = toTopmost(roots, opts, nodeIds);
  if (!topmost.length) return roots;

  const detached = detach(roots, opts, new Set(topmost));
  const detachedOrdered: T[] = [];
  for (const id of topmost) {
    const found = detached.find((d) => opts.getId(d) === id);
    if (found !== undefined && found !== null) detachedOrdered.push(found);
  }

  // 锚点可能随被移动节点一起被移除（拖拽组内部成员），此时改为追加
  const anchorResolved: TreeKey | null =
    anchorNodeId !== null && topmost.includes(anchorNodeId) ? null : anchorNodeId;

  insertInPlace(roots, opts, detachedOrdered, targetParentId, anchorResolved);
  return roots;
}

/**
 * @deprecated 同义别名，请改用 {@link moveNodes}。
 */
export const moveNodesTo = moveNodes;

/**
 * 把一组「外部节点」（含完整子树）插入树的指定位置，供跨树拖拽的目标树使用。
 * 载荷节点插入前深克隆（确保目标树与源树/多次插入之间互不共享对象），
 * 树本身原地修改（splice 写入，引用不变）。
 * anchorNodeId 非空时插到该兄弟之前；为空时追加到容器末尾。
 */
export function insertNodesTo<T>(
  roots: T[],
  opts: NormalizedTreeOptions<T>,
  nodes: T[],
  targetParentId: TreeKey | null,
  anchorNodeId: TreeKey | null,
): T[] {
  if (!nodes.length) return roots;
  const toInsert = nodes.map((n) => cloneData([n], opts)[0]);
  insertInPlace(roots, opts, toInsert, targetParentId, anchorNodeId);
  return roots;
}

/** 目标树中是否已存在 ids 中的任一 id（跨树键冲突校验，命中即返回） */
function containsAnyId<T>(list: T[] | null, opts: NormalizedTreeOptions<T>, ids: ReadonlySet<TreeKey>): boolean {
  if (!list) return false;
  for (const node of list) {
    const id = opts.getId(node);
    if (id !== null && ids.has(id)) return true;
    if (containsAnyId(readArr(node, opts), opts, ids)) return true;
  }
  return false;
}

/** 收集节点及其全部后代的 id */
function collectIds<T>(node: T, opts: NormalizedTreeOptions<T>, out: Set<TreeKey>): void {
  const id = opts.getId(node);
  if (id !== null) out.add(id);
  const children = readArr(node, opts);
  if (children) for (const child of children) collectIds(child, opts, out);
}

/** 跨树「移动」的结果：两棵树的根数组与被搬走的顶层子树 */
export interface TreeTransferResult<T> {
  /** 源树根数组（原地修改后的同一引用） */
  sourceRoots: T[];
  /** 目标树根数组（原地修改后的同一引用） */
  targetRoots: T[];
  /** 被搬走的顶层节点（含各自子树），即源树中被分离的实际对象 */
  moved: T[];
}

/**
 * 跨树「移动」：把 sourceRoots 中 nodeIds 对应节点（含各自子树）搬到
 * targetRoots 的指定落点。两棵树都**原地修改**（返回值中的 sourceRoots /
 * targetRoots 即传入引用）；写入目标树时载荷会再次深克隆（同 {@link insertNodesTo}），
 * 因此两棵树之间互不共享节点对象。
 *
 * 返回 null 表示不满足搬运前提，调用方应整体放弃（两棵树的数据保持不变）：
 * - nodeIds 去重后为空，或源树中一个都没命中；
 * - targetParentId 非空但目标树中不存在该容器；
 * - 被搬子树（含后代）的任一 id 已存在于目标树——键冲突会破坏 trackBy 与定位索引。
 *   该检查在真正改动源树之前完成，失败时无任何副作用。
 *
 * 跨树场景不会出现「落点在自身子树内」的环：被搬节点的 id 都不在目标树中。
 * anchorNodeId 非空时插到该兄弟之前，锚点不在容器内时追加到末尾（同 insertNodesTo）。
 */
export function transferNodes<T>(
  sourceRoots: T[],
  sourceOpts: NormalizedTreeOptions<T>,
  targetRoots: T[],
  targetOpts: NormalizedTreeOptions<T>,
  nodeIds: TreeKey[],
  targetParentId: TreeKey | null,
  anchorNodeId: TreeKey | null,
): TreeTransferResult<T> | null {
  const ids = [...new Set(nodeIds)];
  if (!ids.length) return null;
  // 落点容器必须真实存在：insertNodesTo 在定位失败时会静默回落为「根级末尾」
  if (targetParentId !== null && locate(targetRoots, targetOpts, targetParentId) === null) return null;

  const topmost = toTopmost(sourceRoots, sourceOpts, ids);
  if (!topmost.length) return null;

  // 预检目标树键冲突：在真正改动源树之前完成，失败时两棵树保持原样
  const movedIds = new Set<TreeKey>();
  for (const id of topmost) {
    const loc = locate(sourceRoots, sourceOpts, id);
    if (loc) collectIds(loc.node, sourceOpts, movedIds);
  }
  if (containsAnyId(targetRoots, targetOpts, movedIds)) return null;

  const moved = detach(sourceRoots, sourceOpts, new Set(topmost));
  const targetRootsAfter = insertNodesTo(targetRoots, targetOpts, moved, targetParentId, anchorNodeId);
  return { sourceRoots, targetRoots: targetRootsAfter, moved };
}

/** 删除一组节点（含全部后代）。原地修改根数组；如需拿到被删数据请用 removeNodeIdsWithData */
export function removeNodeIds<T>(
  roots: T[],
  opts: NormalizedTreeOptions<T>,
  nodeIds: TreeKey[],
): T[] {
  const topmost = new Set(toTopmost(roots, opts, nodeIds));
  if (!topmost.size) return roots;
  detach(roots, opts, topmost);
  return roots;
}

/** 删除一组节点并返回被删除的子树数据（根数组原地修改，removed 为被分离的实际对象） */
export function removeNodeIdsWithData<T>(
  roots: T[],
  opts: NormalizedTreeOptions<T>,
  nodeIds: TreeKey[],
): { roots: T[]; removed: T[] } {
  const topmost = toTopmost(roots, opts, nodeIds);
  if (!topmost.length) return { roots, removed: [] };
  const removed = detach(roots, opts, new Set(topmost));
  return { roots, removed };
}

/**
 * 新增节点（原地修改）。
 * parentId 为 null 时加入根；position: 'first' | 'end' 或插入到某个兄弟前。
 * 注意：`data` 按原引用写入（不做克隆），调用方需自行保证不与树内数据共享。
 */
export function insertNodeData<T>(
  roots: T[],
  opts: NormalizedTreeOptions<T>,
  parentId: TreeKey | null,
  data: T,
  position: 'first' | 'end' | TreeKey = 'end',
): T[] {
  insertInPlace(roots, opts, [data], parentId, position);
  return roots;
}

/**
 * 批量新增节点（同一容器、同一位置，保持传入顺序，原地修改）。
 * 载荷节点会被深克隆，确保与调用方数据/多次插入之间互不共享对象。
 *
 * parentId 为 null 时加入根；position 为 'first' | 'end' 或某个兄弟 id（插到其之前）。
 */
export function insertNodesBatch<T>(
  roots: T[],
  opts: NormalizedTreeOptions<T>,
  parentId: TreeKey | null,
  nodes: T[],
  position: 'first' | 'end' | TreeKey = 'end',
): T[] {
  if (!nodes.length) return roots;
  const toInsert = nodes.map((n) => cloneData([n], opts)[0]);
  insertInPlace(roots, opts, toInsert, parentId, position);
  return roots;
}

/** 通过 id 返回其父容器数组引用（供索引类计算） */
export function listOfParent<T>(
  roots: T[],
  opts: NormalizedTreeOptions<T>,
  id: TreeKey,
): T[] | null {
  const loc = locate(roots, opts, id);
  if (!loc) return null;
  return loc.parent === null ? roots : readArr(loc.parent, opts);
}
