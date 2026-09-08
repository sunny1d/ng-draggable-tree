import { Component, signal, viewChild } from '@angular/core';
import {
  NgDraggableTreeComponent,
  type TreeDragEndEvent,
  type TreeDragEvent,
  type TreeDropTarget,
  type TreeOptions,
} from 'ng-draggable-tree';
import { FileNode, fileTree, timeNow } from '../shared/demo-data';
import { EventLogPanel } from '../shared/event-log-panel';

type TreeRef = NgDraggableTreeComponent<FileNode>;
type DragEvent = TreeDragEvent<FileNode>;
type EndDragEvent = TreeDragEndEvent<FileNode>;

const POSITION_TEXT: Record<'before' | 'after' | 'child', string> = {
  before: '（插入到目标之前）',
  after: '（插入到目标之后）',
  child: '（作为目标子节点）',
};

@Component({
  selector: 'app-drag-demo',
  standalone: true,
  imports: [NgDraggableTreeComponent, EventLogPanel],
  templateUrl: './drag-demo.html',
})
export class DragDemo {
  readonly data = signal<FileNode[]>(fileTree());
  /** 是否启用 #dragGhostTemplate 自定义拖拽幽灵（关闭时对比内置克隆幽灵） */
  readonly customGhost = signal(true);

  /** 幽灵模板展示用图标 */
  ghostIcon(node: FileNode): string {
    const name = node.icon || (node.kind === 'folder' ? 'folder' : 'script');
    return `/assets/icon/${name}.png`;
  }

  protected readonly options: TreeOptions<FileNode> = {
    showLine: true,
    multiSelect: true,
    selectOnClick: true,
    // 所有节点允许拖拽；回调参数是本次被拖动的全部节点（多选拖动时为整组）
    allowDrag: (nodes: FileNode[]) => {
      return nodes.length > 0;
    },
    // 自定义放置校验：禁止放到自身/后代、禁止把文件节点当作容器
    allowDrop: (ctx: TreeDropTarget<FileNode>) => {
      if (ctx.isSelf || ctx.isDescendant) return false;
      if (ctx.position === 'child' && ctx.target?.kind === 'file') return false;
      return true;
    },
  };

  protected readonly tree = viewChild<TreeRef>('tree');
  protected readonly logs = signal<string[]>([]);

  private log(message: string): void {
    const next = [`[${timeNow()}] ${message}`, ...this.logs()];
    this.logs.set(next.slice(0, 80));
  }

  expandAll(): void {
    this.tree()?.expandAll();
  }

  collapseAll(): void {
    this.tree()?.collapseAll();
  }

  reset(): void {
    this.data.set(fileTree());
    this.tree()?.collapseAll();
    this.logs.set([]);
  }

  onDataChange(list: FileNode[]): void {
    this.data.set(list);
  }

  onDragStart(e: DragEvent): void {
    const group = e.draggedNodes.length > 1 ? `（含 ${e.draggedNodes.length} 项多选）` : '';
    this.log(`开始拖拽「${e.node.name}」${group}`);
  }

  /**
   * 拖拽结束时库只发出 dragEnd：由这里根据落点载荷决定是否落位，
   * 并调用公开执行器完成实际移动。
   */
  onDragEnd(e: EndDragEvent): void {
    const d = e.drop;
    const names = e.draggedNodes.map((n) => n.name).join('、');
    if (!d.dropped) {
      this.log(`拖放「${names}」未落到有效位置，已取消（未改动任何数据）`);
      return;
    }
    if (d.external) {
      this.log(`拖放「${names}」跨出本树：请到接收树的 dragEnd 逻辑处理`);
      return;
    }
    const ok = this.tree()?.moveNodes(e.draggedIds, d.targetRowId, d.position!);
    const destText = d.parent ? `父级「${d.parent.name}」` : '根级';
    this.log(
      `拖放「${names}」→ ${d.target ? `目标「${d.target.name}」` : '根级末尾'}${POSITION_TEXT[d.position ?? 'after']}${destText}：页面在 dragEnd 中调用 moveNodes ${ok ? '已执行' : '被拒绝'}`,
    );
  }

  clearLogs(): void {
    this.logs.set([]);
  }
}
