import { ChangeDetectionStrategy, Component, input, OnInit, signal, TemplateRef } from '@angular/core';
import { CdkDrag, CdkDragStart } from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import type { NormalizedTreeOptions } from './tree-options';
import type { TreeRow, TreeRowView } from './tree.model';
import { LoadingComponent, type TreeLoadingTemplateContext } from './loading.component';
import { TreeHighlightPipe } from './tree.highlight';

/** 拖拽移动信息（与 CdkDragMove 对齐） */
export interface TreeDragMoveInfo {
  pointerPosition: { x: number; y: number };
  event?: Event;
}

/** 树组件暴露给行模板的行为 API（在父组件实现并注入） */
export interface TreeRowApi<T = unknown> {
  isDraggable(row: TreeRow<T>): boolean;
  /**
   * 该行当前是否**可被折叠**（展开态 + 非叶子 + 过滤未生效）。
   * 过滤视图下被强制展开的分支不可折叠，箭头只作状态指示
   * （渲染层据此加 `is-locked` / `aria-disabled`，与 `onToggleExpand` 的静默忽略一致）
   */
  isRowCollapsible(row: TreeRow<T>): boolean;
  /**
   * 切换行展开/折叠。与箭头是否显示无关：调用即切换，不可切换的行（叶子等）静默忽略；
   * 过滤生效时被强制展开的分支不响应折叠（箭头只作状态指示）
   */
  onToggleExpand(row: TreeRow<T>): void;
  onClick(row: TreeRow<T>, event: MouseEvent): void;
  onDoubleClick(row: TreeRow<T>, event: MouseEvent): void;
  onContextMenu(row: TreeRow<T>, event: MouseEvent): void;
  onCheckboxChange(row: TreeRow<T>): void;
  onDelete(row: TreeRow<T>): void;
  isLoading(row: TreeRow<T>): boolean;
  dragDropActive(): boolean;
  /** 该行是否正被拖拽（多选拖拽时被选中的多行均为 true） */
  isDragging(row: TreeRow<T>): boolean;
  /** 拖拽开始。sourceElement 为该行的 DOM 元素（cdkDragStarted 的 source.element），用于克隆/定位拖拽幽灵 */
  onDragStart(row: TreeRow<T>, sourceElement: HTMLElement): void;
  onDragMoved(row: TreeRow<T>, info: TreeDragMoveInfo): void;
  onDragEnd(row: TreeRow<T>): void;
  /** 拖拽放置标记：active=允许放置；rejected=该行被判定不可放置（指针悬停其上）；position=放置方位 */
  dragMarker(row: TreeRow<T>): {
    active: boolean;
    rejected: boolean;
    position: 'before' | 'after' | 'child' | null;
  };
  /**
   * 新增的行是否播放进入动画（`TreeOptions.animate`，默认开启）。
   * 行组件在挂载时读取一次：首屏渲染的行返回 false，之后新增的行（展开 / 过滤 / 数据变化）返回 true。
   */
  animateEntering(): boolean;
}

/**
 * 节点内容模板（`#treeNodeTemplate`）上下文。
 * 示例：`<ng-template #treeNodeTemplate let-node let-row="row">...`
 */
export interface TreeNodeTemplateContext<T = unknown> {
  /** 节点原始数据（let-node） */
  $implicit: T;
  /** 节点原始数据 */
  node: T;
  /**
   * 当前行模型：depth / expanded / selected / active / matched 等状态均在此；
   * `row.node` 为轻量 TreeNode 视图（`parent` / `index` / `isExpanded` 等树语义）。
   */
  row: TreeRowView<T>;
  /** 行行为 API：供模板内触发展开/折叠、选中、删除等 */
  api: TreeRowApi<T>;
  /**
   * 当前过滤关键字（未过滤时为空串）。自定义模板可配合 `treeHighlight` 管道
   * 或 `splitHighlight()` 自行实现「只高亮匹配词」：
   * `@for (seg of node.name | treeHighlight : keyword : row.matched; track $index)`
   */
  keyword: string;
}

/** 可投影模板集合：通过树组件内容投影收集，逐行注入 */
export interface TreeTemplates<T = unknown> {
  /** 懒加载行 loading 模板（`#loadingTemplate`）；缺省显示内置 spinner */
  loadingTemplate?: TemplateRef<TreeLoadingTemplateContext<T>>;
  /** 节点内容模板（`#treeNodeTemplate`）；缺省按 displayField 显示文本 */
  treeNodeTemplate?: TemplateRef<TreeNodeTemplateContext<T>>;
}


@Component({
  selector: 'ng-draggable-tree-node',
  imports: [CdkDrag, NgTemplateOutlet, LoadingComponent, TreeHighlightPipe],
  templateUrl: './ng-draggable-tree-node.template.html',
  styles: [
    `
      :host.ng-draggable-tree-node-root {
        display: block;
      }
      :host.ng-draggable-tree-node-root.cdk-drag,
      :host.ng-draggable-tree-node-root.cdk-drag:active {
        transform: none !important;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreeNodeComponent<T = unknown> implements OnInit {
  readonly row = input<TreeRow<T> | null>(null);
  readonly api = input<TreeRowApi<T> | null>(null);
  readonly opts = input<NormalizedTreeOptions<T> | null>(null);
  readonly templates = input<TreeTemplates<T> | null>(null);
  /** 当前过滤关键字（由树组件下发）：默认 label 路径按它切分命中片段 */
  readonly keyword = input<string>('');

  /**
   * 本行是否播放进入动画。挂载时确定一次即可：行组件由 CDK 按 id 复用，
   * 只有真正新增的行才会新建组件，已存在的行不会重播。
   */
  readonly entering = signal(false);

  ngOnInit(): void {
    this.entering.set(this.api()?.animateEntering() ?? false);
  }

  depthRange(depth: number): number[] {
    return depth > 0 ? Array.from({ length: depth }, (_, i) => i) : [];
  }

  displayText(): string {
    const row = this.row();
    const opts = this.opts();
    return row && opts ? opts.getDisplay(row.data) : '';
  }

  /** 过滤是否生效（与树组件 `filterActive` 同一判据：关键字去除首尾空白后非空） */
  keywordActive(): boolean {
    return this.keyword().trim().length > 0;
  }

  /**
   * 是否按「只高亮匹配词」渲染：`highlightMode` 非 `'label'` 且过滤生效。
   * 未过滤时走普通插值路径（不产生额外片段视图，零渲染开销）。
   */
  keywordHighlight(): boolean {
    return this.opts()?.highlightMode !== 'label' && this.keywordActive();
  }

  /** 自定义节点模板的渲染上下文 */
  nodeContext(): TreeNodeTemplateContext<T> {
    const row = this.row()!;
    // 渲染行由组件行管线产出，必定已挂 TreeNode 视图（见 TreeRowView 约定）
    return {
      $implicit: row.data,
      node: row.data,
      row: row as TreeRowView<T>,
      api: this.api()!,
      keyword: this.keyword(),
    };
  }

  toggleExpand(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const row = this.row();
    if (row && this.api()) this.api()!.onToggleExpand(row);
  }

  /**
   * 箭头是否处于“锁定”态：非叶子且已展开，但当前不可折叠
   * ——过滤视图下被强制展开的分支。锁定态按钮不可折叠（点击静默忽略），
   * 故渲染 `aria-disabled` 并改用禁用手型光标。
   */
  isToggleLocked(): boolean {
    const row = this.row();
    const api = this.api();
    return !!row && !!api && row.expanderVisible && row.expanded && !api.isRowCollapsible(row);
  }

  onCheckbox(event: Event): void {
    event.stopPropagation();
    const row = this.row();
    if (row && this.api()) this.api()!.onCheckboxChange(row);
  }

  onClick(event: MouseEvent): void {
    const row = this.row();
    if (row && this.api()) this.api()!.onClick(row, event);
  }

  onDblClick(event: MouseEvent): void {
    const row = this.row();
    if (row && this.api()) this.api()!.onDoubleClick(row, event);
  }

  onContextMenu(event: MouseEvent): void {
    const row = this.row();
    if (row && this.api()) this.api()!.onContextMenu(row, event);
  }

  onDelete(event: MouseEvent): void {
    event.stopPropagation();
    const row = this.row();
    if (row && this.api()) this.api()!.onDelete(row);
  }

  dragStarted(event: CdkDragStart): void {
    const row = this.row();
    if (row && this.api()) this.api()!.onDragStart(row, event.source.element.nativeElement);
  }

  dragMoved(info:TreeDragMoveInfo ): void {
    const row = this.row();
    if (row && this.api()) this.api()!.onDragMoved(row, info);
  }

  dragEnded(): void {
    const row = this.row();
    if (row && this.api()) this.api()!.onDragEnd(row);
  }
}
