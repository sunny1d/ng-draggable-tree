import { Component, signal, viewChild } from '@angular/core';
import {
  NgDraggableTreeComponent,
  type TreeNodeEvent,
  type TreeExpansionEvent,
  type TreeOptions,
  TreeDropTarget,
  TreeDragEndEvent,
} from 'ng-draggable-tree';
import { FileNode, fileTree, timeNow } from '../shared/demo-data';
import { EventLogPanel } from '../shared/event-log-panel';

type TreeRef = NgDraggableTreeComponent<FileNode>;
type ClickEvent = TreeNodeEvent<FileNode>;
type ExpandEvent = TreeExpansionEvent<FileNode>;
type EndDragEvent = TreeDragEndEvent<FileNode>;
const POSITION_TEXT: Record<'before' | 'after' | 'child', string> = {
  before: '（插入到目标之前）',
  after: '（插入到目标之后）',
  child: '（作为目标子节点）',
};

@Component({
  selector: 'app-basic-demo',
  standalone: true,
  imports: [NgDraggableTreeComponent, EventLogPanel],
  templateUrl: './basic-demo.html',  
})
export class BasicDemo {
  readonly data = signal<FileNode[]>(fileTree());

  protected readonly options: TreeOptions<FileNode> = {
    idField: 'id',
    displayField: 'name',
    childrenField: 'children',
    showLine: true,
    levelIndent: 22,
    multiSelect: true,
    selectOnClick: true,
    animate: true,
    allowDrag: true,
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
    this.logs.set([]);
  }

  onExpand(e: ExpandEvent): void {
    this.log(`展开「${e.node.name}」(${e.nodeId})`);
  }

  onCollapse(e: ExpandEvent): void {
    this.log(`折叠「${e.node.name}」(${e.nodeId})`);
  }

  onClick(e: ClickEvent): void {
    e.event?.stopPropagation();
    e.event?.preventDefault();
    this.log(`点击 「${e.node.name}」(${e.nodeId})`);
  }
  onDoubleClick(e: ClickEvent): void {
    e.event?.stopPropagation();
    e.event?.preventDefault();
    this.tree()?.updateRow(e.node.id,{name:'新名称'})
    this.log(`双击 「${e.node.name}」(${e.nodeId})`);
  }
  onContextMenu(e: ClickEvent): void {
    this.log(`右键「${e.node.name}」(${e.nodeId})，菜单已弹出`);
  }

  onMenuInfo(node: FileNode): void {
    this.log(`菜单操作：记录「${node.name}」(${node.id})`);
  }
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
    const destText = d.parent ? `父级「${d.parent.name}」` : '根级';
    const ok = this.tree()?.moveNodes(e.draggedIds, d.targetRowId, d.position!);
    this.log(
      `拖放「${names}」→ ${d.target ? `目标「${d.target.name}」` : '根级末尾'}${POSITION_TEXT[d.position ?? 'after']}${destText}：页面在 dragEnd 中调用 moveNodes ${ok ? '已执行' : '被拒绝'}`,
    );
  }

  clearLogs(): void {
    this.logs.set([]);
  }
}
