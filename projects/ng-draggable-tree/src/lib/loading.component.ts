import { Component, TemplateRef, ViewEncapsulation, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { TreeRow } from './tree.model';

/**
 * 懒加载 loading 模板（`#loadingTemplate`）上下文。
 * 示例：`<ng-template #loadingTemplate let-node let-index="index">...`
 */
export interface TreeLoadingTemplateContext<T = unknown> {
  /** 当前节点原始数据（let-node） */
  $implicit: T;
  /** 当前节点原始数据 */
  node: T;
  /** 当前行模型 */
  row: TreeRow<T>;
  /** 可见行下标 */
  index: number;
}

@Component({
  encapsulation: ViewEncapsulation.None,
  selector: 'tree-loading-component',
  template: `
    @if (template()) {
      <ng-container
        [ngTemplateOutlet]="template()"
        [ngTemplateOutletContext]="context()" />
    } @else {
      <div>
        <span class="ng-draggable-tree-toggle" role="status" aria-label="loading">
          <span class="ng-draggable-tree-caret ng-draggable-tree-spinner"></span>
        </span>
        loading
      </div>
    }
  `,
  imports: [NgTemplateOutlet]
})
export class LoadingComponent<T = unknown> {
  /** 用户自定义 loading 模板；为空时显示内置 spinner */
  readonly template = input<TemplateRef<TreeLoadingTemplateContext<T>>>();
  readonly row = input<TreeRow<T> | null>(null);

  readonly context = computed<TreeLoadingTemplateContext<T>>(() => {
    const r = this.row()!;
    return { $implicit: r.data, node: r.data, row: r, index: r.index };
  });
}
