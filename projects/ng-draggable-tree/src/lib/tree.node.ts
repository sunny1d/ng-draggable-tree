import type { TreeKey, TreeSetStateKind, TreeStateStore } from './tree.types';

/**
 * 节点状态快照：{@link TreeNode.getState} 的返回形状。
 * 均为「某一时刻」的读取结果，不随状态变化自动更新。
 */
export interface TreeNodeState {
  /** 是否处于展开态 */
  expanded: boolean;
  /** 是否选中 */
  selected: boolean;
  /** 是否勾选（复选框模式） */
  checked: boolean;
  /** 是否正在懒加载 */
  loading: boolean;
}

/**
 * 轻量 TreeNode 视图（**不是数据**）：把「节点在树中的位置 + 状态」包成一个对象，
 * 让模板/调用方能用树语义（`parent` / `depth` / `index` / `isExpanded`）访问节点。
 *
 * 设计约束（与数据层严格解耦）：
 * - `data` 仍是工作树中的原始节点对象引用，本视图**不持有副本、不修改数据**；
 * - 状态（展开/选中/勾选/加载中）**不做快照**，每次经 {@link TreeStateStore} 实时读取，
 *   因此状态集合变化后无需重建视图对象；
 * - 视图由组件在行管线中创建：结构未变时引用稳定（复用上一轮对象），
 *   结构变化时随行一起重建（`parent` 链在一次扫描内解析）。
 *
 * @example
 * ```html
 * <ng-template #treeNodeTemplate let-node let-row="row">
 *   {{ node.name }}
 *   @if (row.node?.isExpanded) { <em>展开中</em> }
 *   @if (row.node?.parent) { <em>父级：{{ row.node!.parent!.data.name }}</em> }
 * </ng-template>
 * ```
 */
export class TreeNode<T = unknown> {
  constructor(
    /** 节点原始数据（工作树中的引用） */
    readonly data: T,
    /** 节点 id */
    readonly id: TreeKey,
    /** 直接父节点的视图；根节点为 null */
    readonly parent: TreeNode<T> | null,
    /** 层级（根为 0） */
    readonly depth: number,
    /** 在父级数组（或根数组）中的下标 */
    readonly index: number,
    private readonly state: TreeStateStore,
  ) {}

  /** 是否处于展开态（实时读取状态集合） */
  get isExpanded(): boolean {
    return this.state.hasState('expanded', this.id);
  }

  /** 是否选中（实时读取状态集合） */
  get isSelected(): boolean {
    return this.state.hasState('selected', this.id);
  }

  /** 是否勾选（实时读取状态集合；复选框模式） */
  get isChecked(): boolean {
    return this.state.hasState('checked', this.id);
  }

  /** 是否正在懒加载（实时读取状态集合） */
  get isLoading(): boolean {
    return this.state.hasState('loading', this.id);
  }

  /** 读取该节点的状态快照 */
  getState(): TreeNodeState {
    return {
      expanded: this.isExpanded,
      selected: this.isSelected,
      checked: this.isChecked,
      loading: this.isLoading,
    };
  }

  /**
   * 写入该节点的状态（只改传入的字段）。内部仍是「写回集合」，
   * 因此会立即反映到渲染，但**不会**发出 `expand` / `selectionChange` 等事件，
   * 也不会回写数据源——需要事件请调用组件的公开方法或行 API。
   */
  setState(patch: Partial<TreeNodeState>): void {
    const apply = (kind: TreeSetStateKind, value: boolean | undefined): void => {
      if (value === undefined) return;
      this.state.mutateState(kind, (draft) => {
        if (value) draft.add(this.id);
        else draft.delete(this.id);
      });
    };
    apply('expanded', patch.expanded);
    apply('selected', patch.selected);
    apply('checked', patch.checked);
    apply('loading', patch.loading);
  }
}
