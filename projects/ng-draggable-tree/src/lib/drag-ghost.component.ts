import { ChangeDetectionStrategy, Component, TemplateRef, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { TreeRowView } from './tree.model';
import type { TreeRowApi } from './ng-draggable-tree-node';

/**
 * 拖拽幽灵模板（`#dragGhostTemplate`）的渲染上下文。
 *
 * 在 `<ng-draggable-tree>` 内投影一个 `<ng-template #dragGhostTemplate>`，
 * 即可用 Angular 模板完全接管拖拽过程中跟随指针移动的“幽灵”外观。
 * 缺省（未提供该模板）时，组件会克隆被拖拽行作为幽灵快照。
 *
 * 示例：
 * ```html
 * <ng-draggable-tree [nodes]="nodes()" [options]="options">
 *   <ng-template #dragGhostTemplate let-node let-row="row" let-draggedNodes="draggedNodes">
 *     <span class="my-ghost">{{ node.name }}</span>
 *     @if (draggedNodes.length > 1) {
 *       <em>等 {{ draggedNodes.length }} 项</em>
 *     }
 *   </ng-template>
 * </ng-draggable-tree>
 * ```
 */
export interface TreeDragGhostTemplateContext<T = unknown> {
  /** 被拖拽的起始节点原始数据（let-node） */
  $implicit: T;
  /** 被拖拽的起始节点原始数据 */
  node: T;
  /** 起始节点在拖拽开始时的行模型（depth / selected / isLeaf 等；`row.node` 为 TreeNode 视图） */
  row: TreeRowView<T>;
  /** 行行为 API（与行模板中的 api 一致，可在幽灵模板内触发展开/选中等） */
  api: TreeRowApi<T>;
  /** 本次被拖拽的全部节点（Ctrl/Cmd 多选拖拽时数量大于 1） */
  draggedNodes: T[];
}

/**
 * 拖拽幽灵渲染宿主：拖拽开始时由主组件动态创建，并把用户的
 * `#dragGhostTemplate` 渲染到 `document.body` 上的固定定位容器中。
 *
 * @internal 仅供 NgDraggableTreeComponent 内部使用
 */
@Component({
  selector: 'ngx-tree-drag-ghost',
  imports: [NgTemplateOutlet],
  template: `
    @if (ghostTemplate(); as tpl) {
      <ng-container [ngTemplateOutlet]="tpl" [ngTemplateOutletContext]="context()" />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreeDragGhostComponent<T = unknown> {
  /** 用户自定义的拖拽幽灵模板 */
  readonly ghostTemplate = input<TemplateRef<TreeDragGhostTemplateContext<T>> | null>(null);
  /** 幽灵模板的渲染上下文 */
  readonly context = input<TreeDragGhostTemplateContext<T> | null>(null);
}
