import { Component, computed, signal, viewChild } from '@angular/core';
import {
  NgDraggableTreeComponent,
  type TreeSelectionEvent,
  type TreeOptions,
} from 'ng-draggable-tree';
import { DictNode, permissionTree, timeNow } from '../shared/demo-data';
import { EventLogPanel } from '../shared/event-log-panel';

type TreeRef = NgDraggableTreeComponent<DictNode>;

@Component({
  selector: 'app-checkbox-demo',
  standalone: true,
  imports: [NgDraggableTreeComponent, EventLogPanel],
  templateUrl: './checkbox-demo.html',
})
export class CheckboxDemo {
  readonly data = signal<DictNode[]>(permissionTree());

  /** 三态级联开关：演示 useTriState 的两种勾选语义 */
  readonly triState = signal(true);

  protected readonly options = computed<TreeOptions<DictNode>>(() => ({
    useCheckbox: true,
    useTriState: this.triState(),
  }));

  protected readonly tree = viewChild<TreeRef>('tree');
  protected readonly checked = signal<string[]>([]);
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

  /** 切换三态级联：两种模式的勾选集合语义不同，切换时清空勾选避免误解 */
  toggleTriState(): void {
    const next = !this.triState();
    this.triState.set(next);
    this.tree()?.clearState();
    this.checked.set([]);
    this.log(next ? 'useTriState = true：父级级联 + 半选态' : 'useTriState = false：父子各自独立勾选');
  }

  reset(): void {
    this.data.set(permissionTree());
    this.tree()?.clearState();
    this.checked.set([]);
    this.logs.set([]);
  }

  onSelectionChange(e: TreeSelectionEvent<DictNode>): void {
    const names = e.selectedNodes.map((n) => n.name);
    this.checked.set(names);
    this.log(`勾选变化：${names.length > 0 ? names.join('、') : '（已全部取消）'}`);
  }

  clearLogs(): void {
    this.logs.set([]);
  }
}
