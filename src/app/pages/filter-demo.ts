import { Component, computed, signal, viewChild } from '@angular/core';
import {
  NgDraggableTreeComponent,
  type TreeNodeEvent,
  type TreeOptions,
} from 'ng-draggable-tree';
import { FileNode, fileTree, timeNow } from '../shared/demo-data';
import { EventLogPanel } from '../shared/event-log-panel';

type TreeRef = NgDraggableTreeComponent<FileNode>;
type ClickEvent = TreeNodeEvent<FileNode>;

@Component({
  selector: 'app-filter-demo',
  standalone: true,
  imports: [NgDraggableTreeComponent, EventLogPanel],
  templateUrl: './filter-demo.html',
})
export class FilterDemo {
  readonly keyword = signal('');
  readonly data = signal<FileNode[]>(fileTree());
  /** 过滤时是否保留命中节点的父子路径（对应 TreeOptions.autoShow） */
  readonly autoShow = signal(true);

  protected readonly suggested = ['src', '文档', 'ngx', 'README', '库'];

  protected readonly options = computed<TreeOptions<FileNode>>(() => ({
    showLine: true,
    highlightMode: 'label',
    multiSelect: true,
    selectOnClick: true,
    autoShow: this.autoShow(),
    filterFn: (node: FileNode, keyword: string): boolean => {
      return node['name'].includes(keyword);
    },
  }));

  protected readonly tree = viewChild<TreeRef>('tree');
  protected readonly logs = signal<string[]>([]);

  private log(message: string): void {
    const next = [`[${timeNow()}] ${message}`, ...this.logs()];
    this.logs.set(next.slice(0, 80));
  }

  onKeyword(value: string): void {
    this.keyword.set(value);
    this.tree()?.filter(value);
  }

  applySuggestion(word: string): void {
    this.onKeyword(word);
  }

  clear(): void {
    this.onKeyword('');
  }

  toggleAutoShow(): void {
    const next = !this.autoShow();
    this.autoShow.set(next);
    this.log(
      next
        ? '过滤保留父子路径（autoShow: true）'
        : '过滤只显示命中节点自身（autoShow: false）',
    );
  }

  expandAll(): void {
    this.tree()?.expandAll();
  }

  collapseAll(): void {
    this.tree()?.collapseAll();
  }

  reset(): void {
    this.clear();
    this.data.set(fileTree());
    this.logs.set([]);
  }

  onClick(e: ClickEvent): void {
    const kw = this.keyword().trim();
    const context = kw ? `（命中「${kw}」）` : '';
    this.log(`点击「${e.node.name}」${context}`);
  }

  clearLogs(): void {
    this.logs.set([]);
  }
}
