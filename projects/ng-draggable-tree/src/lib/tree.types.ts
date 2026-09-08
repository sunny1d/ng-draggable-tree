import type { Observable } from 'rxjs';

/** 树节点的唯一键类型 */
export type TreeKey = string | number;

/** 子节点数据来源：数组 / 空 / Promise / Observable（懒加载） */
export type ChildrenSource<T> =
  | T[]
  | null
  | undefined
  | Promise<T[] | null | undefined>
  | Observable<T[] | null | undefined>;

/** 子节点读取函数 */
export type ChildrenAccessor<T> = (node: T) => ChildrenSource<T>;

/** 允许配置为字段名或读取函数 */
export type FieldOrFn<T, R> = string | ((node: T) => R);

/** 写回某字段（如重命名节点时的 displayField 回写） */
export type SetterFn<T, V> = (node: T, value: V) => void;

/** 放置位置 */
export type DropPosition = 'before' | 'after' | 'child';

/** 拖拽候选位置上下文，供 allowDrop 判断 */
export interface TreeDropTarget<T = unknown> {
  /** 落点所在目标节点 */
  target: T | null;
  /** 目标 id */
  targetId: TreeKey | null;
  /** 即将插入的位置 */
  position: DropPosition;
  /** 目标是否为被拖拽节点的后代 */
  isDescendant: boolean;
  /** 目标是否是被拖拽节点自身 */
  isSelf: boolean;
  /** 被拖拽的全部节点 */
  dragged: T[];
}

/**
 * 拖拽放置校验函数。返回 true 允许放置。
 * 组件在拖动过程中与松手时都会调用。
 */
export type TreeDropFilter<T = unknown> = (ctx: TreeDropTarget<T>) => boolean;

/**
 * 「按 id 维护的集合类状态」种类。所有这些状态在内部都是同一形态——
 * 一份 `ReadonlySet<TreeKey>`（signal 持有，写回即换新引用）。
 */
export type TreeSetStateKind =
  | 'expanded'
  | 'selected'
  | 'checked'
  | 'loading'
  | 'lazyRequested'
  | 'asyncLeaves';

/**
 * 集合状态存取门面：把散落的状态集合收敛成「按种类读写」的单一入口，
 * 内部存储仍是不可变 `Set`（写回换新引用，保持 signal 的变更通知语义）。
 *
 * 用途：
 * - 组件内部与 {@link TreeNode} 视图统一经此读写，新增状态只需登记一处；
 * - 使用方也可以经 `tree.treeState` 读取/覆盖状态集合。
 *
 * 注意：经 `setState` / `mutateState` 直接改写状态**不会触发** `expand` /
 * `selectionChange` 等事件，也不回写数据源——需要事件与快照请走组件公开方法
 * （`expandNode` / `selectNode` / ...）或行 API。
 */
export interface TreeStateStore {
  /** 读取某一类状态集合（只读，勿原地修改） */
  getState(kind: TreeSetStateKind): ReadonlySet<TreeKey>;
  /** 整体替换某一类状态集合 */
  setState(kind: TreeSetStateKind, value: ReadonlySet<TreeKey>): void;
  /** 单点判定：等价于 `getState(kind).has(id)` */
  hasState(kind: TreeSetStateKind, id: TreeKey): boolean;
  /**
   * 在现有集合上增删（内部先复制再写回，保持不可变更新）。
   * 集合内容无实际变化时返回 false 且不写回，避免无谓的重算。
   */
  mutateState(kind: TreeSetStateKind, mutate: (draft: Set<TreeKey>) => void): boolean;
}


