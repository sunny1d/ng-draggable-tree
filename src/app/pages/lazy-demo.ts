import { Component, computed, signal, viewChild } from '@angular/core';
import {
  NgDraggableTreeComponent,
  type TreeLoadChildrenEvent,
  type TreeOptions,
} from 'ng-draggable-tree';
import { LazyNode, lazySeed, makeId, timeNow } from '../shared/demo-data';
import { EventLogPanel } from '../shared/event-log-panel';

type TreeRef = NgDraggableTreeComponent<LazyNode>;
type LoadEvent = TreeLoadChildrenEvent<LazyNode>;

@Component({
  selector: 'app-lazy-demo',
  standalone: true,
  imports: [NgDraggableTreeComponent, EventLogPanel],
  templateUrl: './lazy-demo.html',
})
export class LazyDemo {
  readonly customLoader = signal(true);
  /** 模拟“远端目录”：仅记录每个父级下的直接子级名称 */
  private readonly catalog: Record<string, string[]> = {
    数据中心: ['华东资源池', '华北资源池', '海外资源池'],
    华东资源池: ['上海 A 区', '杭州 B 区', '南京 C 区'],
    华北资源池: ['北京 D 区', '天津 E 区'],
    海外资源池: ['新加坡 F 区'],
  };

  /** 数据源：组件直接接管并就地改写（懒加载结果写入这里的节点对象，数组引用不变） */
  readonly data = signal<LazyNode[]>(lazySeed(1));

  /** 数据源被就地改写后的刷新信号：数组引用不变，用它驱动 stats 重算 */
  private readonly dataVersion = signal(0);

  protected readonly options: TreeOptions<LazyNode> = {
    // 子级来源：hasChildren 标记“还有下一层”，首次展开才调用 loadChildren
    hasChildrenField: 'hasChildren',
    loadChildren: (node) => this.load(node),
  };

  /** 直接遍历绑定的数据源，用于证明懒加载结果确实就地写入了 data */
  protected readonly stats = computed(() => {
    this.dataVersion(); // 数据被就地改写（引用不变）：依赖刷新信号重算
    let branches = 0;
    let total = 0;
    const walk = (list: LazyNode[]): void => {
      for (const node of list) {
        total += 1;
        const children = node.children;
        if (children?.length) {
          branches += 1;
          walk(children);
        }
      }
    };
    walk(this.data());
    return { branches, total };
  });

  protected readonly tree = viewChild<TreeRef>('tree');
  protected readonly inflight = signal(0);
  protected readonly logs = signal<string[]>([]);

  private log(message: string): void {
    const next = [`[${timeNow()}] ${message}`, ...this.logs()];
    this.logs.set(next.slice(0, 80));
  }

  private load(node: LazyNode): Promise<LazyNode[]> {
    const children = (this.catalog[node.name] ?? []).map<LazyNode>((name) => ({
      id: makeId('lz'),
      name,
      // 下一层还有节点时先用 hasChildren 标记：展开前即可显示箭头
      hasChildren: (this.catalog[name] ?? []).length > 0,
    }));
    return new Promise<LazyNode[]>((resolve) => {
      this.inflight.update((n) => n + 1);
      const started = performance.now();
      window.setTimeout(() => {
        this.inflight.update((n) => n - 1);
        const elapsed = Math.round(performance.now() - started);
        this.log(`「${node.name}」加载耗时 ${elapsed}ms`);
        resolve(children);
      }, 350 + Math.random() * 550);
    });
  }

  reset(): void {
    this.data.set(lazySeed());
    this.inflight.set(0);
    this.logs.set([]);
  }

  /** 递归展开：逐层展开并对未加载分支发起懒加载，直到最深层全部落定 */
  async expandAll(): Promise<void> {
    const tree = this.tree();
    if (!tree) return;
    this.log('递归展开：逐层拉取中…');
    await tree.expandAllRecursive();
    this.log('递归展开完成');
  }

  collapseAll(): void {
    this.tree()?.collapseAll();
  }

  onLoadChildren(e: LoadEvent): void {
    this.log(`loadChildren 事件：${e.node.name} 返回 ${e.children?.length ?? 0} 项`);
  }

  /** 组件就地改写了数据源：刷新依赖它的派生展示（数组引用不变，signal 不会自己触发） */
  onDataChange(): void {
    this.dataVersion.update((v) => v + 1);
  }

  clearLogs(): void {
    this.logs.set([]);
  }
}
