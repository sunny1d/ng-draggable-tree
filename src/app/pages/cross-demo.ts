import { Component, computed, signal, viewChild } from '@angular/core';
import {
  NgDraggableTreeComponent,
  resolveTargetSlot,
  transferNodes,
  type TreeDragEndEvent,
  type TreeDragEvent,
  type TreeDropTarget,
  type TreeOptions,
} from 'ng-draggable-tree';
import {
  FileNode,
  crossDemoSource,
  crossDemoTarget,
  timeNow,
} from '../shared/demo-data';
import { EventLogPanel } from '../shared/event-log-panel';

type TreeRef = NgDraggableTreeComponent<FileNode>;
type DragEvent = TreeDragEvent<FileNode>;
type EndDragEvent = TreeDragEndEvent<FileNode>;

const POSITION_TEXT: Record<'before' | 'after' | 'child', string> = {
  before: '（插到目标之前）',
  after: '（插到目标之后）',
  child: '（作为目标子节点）',
};

@Component({
  selector: 'app-cross-demo',
  standalone: true,
  imports: [NgDraggableTreeComponent, EventLogPanel],
  templateUrl: './cross-demo.html',
  styles: [
    `
      :host {
        display: block;
      }

      .duo {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 20px;
        align-items: start;
      }

      .toolbar-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 14px;
        align-items: center;
        margin-bottom: 18px;
      }

      .seg {
        display: inline-flex;
        border: 1px solid var(--line);
        border-radius: 999px;
        overflow: hidden;
      }

      .seg button {
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 13px;
        padding: 6px 14px;
        cursor: pointer;
        color: var(--ink-2);
      }

      .seg button + button {
        border-left: 1px solid var(--line);
      }

      .seg button.is-on {
        background: var(--accent);
        color: #fff;
      }

      .hint {
        font-size: 12px;
        color: var(--ink-3);
        margin: 0 0 0 4px;
      }

      @media (max-width: 1280px) {
        .duo {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class CrossDemo {
  readonly leftData = signal<FileNode[]>(crossDemoSource());
  readonly rightData = signal<FileNode[]>(crossDemoTarget());
  /** 拖放语义在松手时刻由 (dragEnd) 处理器决定；此处是「默认值」，按住 Ctrl/⌘ 拖放会强制走 copy */
  readonly mode = signal<'move' | 'copy'>('move');
  readonly logs = signal<string[]>([]);

  protected readonly leftTreeRef = viewChild<TreeRef>('leftTree');
  protected readonly rightTreeRef = viewChild<TreeRef>('rightTree');

  /** 两棵树共用同组配置：跨树必须同 dragGroup，目标树 allowDrop 同样生效 */
  private readonly baseOptions: TreeOptions<FileNode> = {
    showLine: true,
    multiSelect: true,
    selectOnClick: true,
    allowDrag: true,
    allowDrop: (ctx: TreeDropTarget<FileNode>) => {
      if (ctx.isSelf || ctx.isDescendant) return false;
      // 跨树放置同样受目标树规则约束：文件不能作为容器
      if (ctx.position === 'child' && ctx.target?.kind === 'file') return false;
      return true;
    },
  };

  /**
   * 两棵树 crossTree 固定为 'move'，表示参与跨树拖拽；
   * 真正的 move/copy 语义在每次松手时由两棵树的 (dragEnd) 处理器决定。
   */
  protected readonly leftOptions = computed<TreeOptions<FileNode>>(() => ({
    ...this.baseOptions,
    crossTree: 'move',
    dragGroup: 'cross-demo',
  }));

  protected readonly rightOptions = computed<TreeOptions<FileNode>>(() => ({
    ...this.baseOptions,
    crossTree: 'move',
    dragGroup: 'cross-demo',
  }));

  setMode(mode: 'move' | 'copy'): void {
    this.mode.set(mode);
    this.log(
      `默认语义切换为 ${mode === 'move' ? 'move（移出源树）' : 'copy（复制到目标树）'}，Ctrl/⌘ 拖放可随时强制复制`,
    );
  }

  emptyRight(): void {
    this.rightData.set([]);
    this.log('右侧清空：可把左侧节点拖到空树区域验证「根级末尾」落点');
  }

  reset(): void {
    this.leftData.set(crossDemoSource());
    this.rightData.set(crossDemoTarget());
    this.leftTreeRef()?.collapseAll();
    this.rightTreeRef()?.collapseAll();
    this.logs.set([]);
  }

  onLeftData(list: FileNode[]): void {
    this.leftData.set(list);
  }

  onRightData(list: FileNode[]): void {
    this.rightData.set(list);
  }

  onDragStart(side: 'left' | 'right', e: DragEvent): void {
    const name = side === 'left' ? '左侧资料库' : '右侧已发布';
    const group = e.draggedNodes.length > 1 ? `（含 ${e.draggedNodes.length} 项多选）` : '';
    this.log(`${name}：开始拖拽「${e.node.name}」${group}`);
  }

  /**
   * 拖拽结束：更新数据。
   */
  onDragEnd(side: 'left' | 'right', e: EndDragEvent): void {
    const d = e.drop;
    const sourceName = side === 'left' ? '左侧资料库' : '右侧已发布';
    const destName = d.external ? (side === 'left' ? '右侧已发布' : '左侧资料库') : sourceName;
    const names = e.draggedNodes.map((n) => n.name).join('、');
    if (!d.dropped) {
      this.log(`${sourceName}：拖放「${names}」未落到有效位置，已取消（未改动任何数据）`);
      return;
    }
    const destText = d.parent ? `父级「${d.parent.name}」` : '根级';
    const slotText = `${d.target ? `目标「${d.target.name}」` : '根级末尾'}${POSITION_TEXT[d.position ?? 'after']}${destText}`;
    if (!d.external) {
      const ok = this.treeOf(side)?.moveNodes(e.draggedIds, d.targetRowId, d.position!);
      this.log(`${sourceName}：树内移动「${names}」→ ${slotText}（moveNodes ${ok ? '已执行' : '被拒绝'}）`);
      return;
    }
    const target = d.targetTree;
    if (!target) {
      this.log(`${sourceName}：跨树落点缺少接收树引用，已忽略`);
      return;
    }

    const ev = e.event as MouseEvent | undefined;
    const wantCopy = Boolean(ev && (ev.ctrlKey || ev.metaKey)) || this.mode() === 'copy';

    if (wantCopy) {
      const inserted = target.copyNodes(e.draggedNodes, d.targetRowId, d.position!);
      this.log(
        inserted
          ? `${sourceName}：copy「${names}」→ ${destName} ${slotText}（目标树 copyNodes 已执行，源树保留）`
          : `${sourceName}：copy「${names}」被「${destName}」拒绝（目标树已含相同 id 等），已忽略`,
      );
      return;
    }

    // 跨树 move：先按目标树当前可见行把「落点行 + 方位」解析成数据层落点（父容器 + 锚点兄弟），
    // 再交给 transferNodes 一次性算出两棵树的新数组；校验不通过返回 null，两棵树都不动。
    const slot = resolveTargetSlot(target.treeRows(), d.targetRowId, d.position!);
    const moved = slot
      ? transferNodes(
          d.sourceTree.getData(),
          d.sourceTree.opts,
          target.getData(),
          target.opts,
          e.draggedIds,
          slot.parentId,
          slot.anchor,
        )
      : null;
    if (!slot || !moved) {
      this.log(`${sourceName}：move「${names}」被「${destName}」拒绝（落点无效或目标树已含相同 id），已忽略`);
      return;
    }

    this.applyTransfer(side, moved.sourceRoots, moved.targetRoots);
    if (slot.parentId !== null) target.expandNode(slot.parentId);
    this.log(`${sourceName}：move「${names}」→ ${destName} ${slotText}（transferNodes 一次写入两棵树）`);
  }

  /** 按被拖来源把 transferNodes 的结果写回两个数据源（源树一份、目标树一份新数组） */
  private applyTransfer(side: 'left' | 'right', sourceRoots: FileNode[], targetRoots: FileNode[]): void {
    if (side === 'left') {
      this.leftData.set(sourceRoots);
      this.rightData.set(targetRoots);
    } else {
      this.rightData.set(sourceRoots);
      this.leftData.set(targetRoots);
    }
  }

  private treeOf(side: 'left' | 'right'): TreeRef | undefined {
    return side === 'left' ? this.leftTreeRef() : this.rightTreeRef();
  }

  private log(message: string): void {
    const next = [`[${timeNow()}] ${message}`, ...this.logs()];
    this.logs.set(next.slice(0, 80));
  }

  clearLogs(): void {
    this.logs.set([]);
  }
}
