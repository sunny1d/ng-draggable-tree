import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  TemplateRef,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ComponentPortal } from '@angular/cdk/portal';
import { ConnectionPositionPair, Overlay, OverlayRef } from '@angular/cdk/overlay';
import type { TreeKey } from './tree.types';
import type { NormalizedTreeOptions } from './tree-options';
import type { TreeRow, TreeRowView } from './tree.model';
import type { TreeRowApi } from './ng-draggable-tree-node';
import type { TreeNodeEvent } from './ng-draggable-tree';

/* ============================= 菜单模板类型 ============================= */

/**
 * 右键菜单模板（`#contextMenuTemplate`）的渲染上下文。
 *
 * 示例：
 * ```html
 * <ng-draggable-tree [nodes]="nodes">
 *   <ng-template #contextMenuTemplate let-node let-row="row" let-api="api" let-close="close">
 *     <button type="button" (click)="rename(node); close()">重命名</button>
 *     <button type="button" (click)="api.onDelete(row); close()">删除</button>
 *   </ng-template>
 * </ng-draggable-tree>
 * ```
 */
export interface TreeContextMenuTemplateContext<T = unknown> {
  /** 节点原始数据（`let-node`） */
  $implicit: T;
  /** 节点原始数据 */
  node: T;
  /** 右键命中的行模型：`row.node` 为轻量 TreeNode 视图（`parent` / `index` / `isExpanded` 等） */
  row: TreeRowView<T>;
  /** 行行为 API：`onToggleExpand` / `onDelete` / `onClick` / `selectOnly` 等 */
  api: TreeRowApi<T>;
  /** 关闭菜单。自定义菜单项执行完操作后应调用它 */
  close: () => void;
  /** 触发菜单的原始事件；程序化 {@link NgDraggableTreeComponent.openContextMenu} 打开时为 null */
  event: MouseEvent | null;
}

/* ============================= 菜单宿主组件 ============================= */

/**
 * 右键菜单宿主组件：只渲染使用方提供的 `#contextMenuTemplate`。
 *
 * 库不提供内置菜单项：没有模板就不弹菜单，右键只发出 `(contextMenu)` 事件，
 * 由使用方自行决定右键后做什么（见 {@link TreeContextMenuController.onRowContextMenu}）。
 *
 * 由 {@link TreeContextMenuController} 经 CDK Overlay 动态创建，挂载于
 * `.cdk-overlay-container` 下，因此不参与树内部的布局与命中；
 * 自定义模板里可直接使用宿主页面的样式（ViewEncapsulation.None）。
 *
 * @internal 仅供 TreeContextMenuController 内部使用
 */
@Component({
  selector: 'ngx-tree-context-menu',
  imports: [NgTemplateOutlet],
  template: `
    @if (template(); as tpl) {
      <div class="ng-draggable-tree-menu-custom">
        <ng-container [ngTemplateOutlet]="tpl" [ngTemplateOutletContext]="context()" />
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TreeContextMenuComponent<T = unknown> {
  /** 使用方提供的自定义菜单模板 */
  readonly template = input<TemplateRef<TreeContextMenuTemplateContext<T>> | null>(null);
  /** 菜单渲染上下文 */
  readonly context = input<TreeContextMenuTemplateContext<T> | null>(null);
}

/* ============================= 控制器宿主接口 ============================= */

/**
 * 右键菜单控制器所需的树组件能力。由 `NgDraggableTreeComponent` 实现并注入，
 * 使控制器可以读选项/取模板/定位行并发出鼠标事件，而无需触碰组件的私有成员。
 *
 * @internal
 */
export interface TreeContextMenuHost<T> {
  /** 当前规范化选项（`contextMenu` 开关在此读取） */
  readonly opts: NormalizedTreeOptions<T>;
  /** 按 id 取当前可见行（O(1)）；不可见 / 不存在返回 undefined */
  rowById(id: TreeKey): TreeRow<T> | undefined;
  /** 命中行的右键事件输出（由控制器负责发出，保证「事件先于菜单」的顺序） */
  emitContextMenu(e: TreeNodeEvent<T>): void;
  /** 自定义菜单模板（`#contextMenuTemplate`）；缺省返回 undefined → 不弹出菜单 */
  menuTemplate(): TemplateRef<TreeContextMenuTemplateContext<T>> | undefined;
  /** 树根 DOM 元素（程序化定位锚点与主题变量来源） */
  rootElement(): HTMLElement | undefined;
  /** 行行为 API（作为模板上下文的 `api` 暴露给使用方） */
  readonly rowApi: TreeRowApi<T>;
}

/**
 * 右键菜单位置候选：origin 为「鼠标点」。
 * 依次尝试 右下 → 右上 → 左下 → 左上，由 CDK 依视口空间自动挑选，
 * 因此靠近右/下边缘时菜单会向内翻转而不是被裁掉。
 */
const CONTEXT_MENU_POSITIONS: ConnectionPositionPair[] = [
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'top' },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
  { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'top' },
  { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
];

/* ============================= 右键菜单控制器 ============================= */

/**
 * 右键菜单控制器：集中承载菜单的全部运行逻辑。
 * - 菜单浮层的创建 / 定位 / 翻转 / 关闭（菜单外点击、菜单外右键、Esc、滚动、销毁）都在本类维护；
 * - 菜单内容完全由使用方提供的 `#contextMenuTemplate` 决定：库没有内置菜单项，
 *   未提供模板时不弹菜单、也不 `preventDefault`，右键只发出 `(contextMenu)` 事件，
 *   由使用方自行决定右键行为。
 *
 * @internal
 */
export class TreeContextMenuController<T = unknown> {
  /** 菜单是否已打开（组件对外暴露的 `contextMenuOpen`） */
  readonly open = signal(false);
  /** 当前菜单浮层（null=未打开） */
  private menuRef: OverlayRef | null = null;
  /** 菜单外交互监听（点击 / 右键 / 滚动）的清理函数，关闭 / 销毁时统一释放 */
  private cleanups: Array<() => void> = [];

  constructor(
    private readonly host: TreeContextMenuHost<T>,
    private readonly envInjector: EnvironmentInjector,
    private readonly overlay: Overlay,
  ) {}

  /**
   * 行右键入口：先照常发出 `(contextMenu)` 事件，再判断是否真的弹菜单。
   *
   * 只有「提供了 `#contextMenuTemplate`」且「该节点的 `options.contextMenu` 为开」时才弹，
   * 这时才 `preventDefault` 掉浏览器原生菜单；否则不弹、也不 `preventDefault`，
   * 使用方可在 `(contextMenu)` 事件里自行决定右键行为。
   */
  onRowContextMenu(row: TreeRow<T>, event: MouseEvent): void {
    this.host.emitContextMenu({ node: row.data, nodeId: row.id, event });
    if (!this.canOpen(row)) return;
    event.preventDefault();
    this.openAt(row, event.clientX, event.clientY, event);
  }

  /**
   * 在指定位置打开右键菜单（等价于用户在该行上右键）。
   * 未传坐标时以该行左下角为锚点。
   *
   * @param nodeId 目标行 id（须为当前可见行）
   * @param position 视口坐标；缺省按行位置定位
   * @returns 目标不可用（非可见行 / 未提供 `#contextMenuTemplate` / 该节点的菜单被配置关闭）时返回 false
   */
  openForRow(nodeId: TreeKey, position?: { x: number; y: number }): boolean {
    const row = this.host.rowById(nodeId);
    if (!row || !this.canOpen(row)) return false;
    const point = position ?? this.rowAnchor(row.id);
    if (!point) return false;
    this.openAt(row, point.x, point.y, null);
    return true;
  }

  /** 关闭当前菜单（未打开时静默忽略） */
  close(): void {
    const ref = this.menuRef;
    if (!ref) return;
    this.menuRef = null;
    this.open.set(false);
    this.runCleanups();
    ref.dispose();
  }

  /** 组件销毁：释放菜单浮层 */
  dispose(): void {
    this.close();
  }

  // ==================== 内部实现 ====================

  /** 该行当前是否应弹出菜单：必须有 `#contextMenuTemplate`，且该节点的菜单开关为开 */
  private canOpen(row: TreeRow<T>): boolean {
    return !!this.host.menuTemplate() && this.isEnabled(row.data);
  }

  /** 该节点的菜单是否启用（options.contextMenu：true / 按节点判定 / false） */
  private isEnabled(node: T): boolean {
    const conf = this.host.opts.contextMenu;
    return typeof conf === 'function' ? !!conf(node) : conf;
  }

  /** 在视口坐标 (x, y) 处创建并挂载菜单浮层 */
  private openAt(row: TreeRow<T>, x: number, y: number, event: MouseEvent | null): void {
    this.close();
    const overlayRef = this.overlay.create({
      // 不挂遮罩：遮罩会挡住页面，菜单外的元素仍需可点（单击 / 双击 / 右键）
      hasBackdrop: false,
      panelClass: 'ng-draggable-tree-menu-panel',
      // 滚动后鼠标点已失效：不跟随滚动，直接关闭（见 listenOutside）
      scrollStrategy: this.overlay.scrollStrategies.noop(),
      positionStrategy: this.overlay
        .position()
        .flexibleConnectedTo({ x, y })
        .withPositions(CONTEXT_MENU_POSITIONS)
        .withPush(true),
    });
    this.menuRef = overlayRef;
    this.open.set(true);

    const ref = overlayRef.attach(
      new ComponentPortal(TreeContextMenuComponent, null, this.envInjector),
    );
    ref.setInput('template', this.host.menuTemplate() ?? null);
    ref.setInput('context', this.buildContext(row, event, overlayRef));
    // 立即渲染菜单内容，避免等下一轮变更检测才出现
    ref.changeDetectorRef.detectChanges();

    overlayRef.keydownEvents().subscribe((e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      this.close();
    });
    this.listenOutside(overlayRef);

    // 菜单挂在 overlay 容器下（脱离树根），需内联主题变量才能与树保持同一套明/暗配色
    this.copyThemeVars(ref.location.nativeElement as HTMLElement);
  }

  /**
   * 菜单外交互的关闭监听：按下鼠标 / 单击（含双击）/ 右键 / 滚动。
   *
   * 菜单没有遮罩，菜单外的指针事件会照常命中真实元素，因此这里只负责关闭菜单，
   * 既不 `preventDefault` 也不 `stopPropagation`：其它行该选中就选中、该拖拽就拖拽、
   * 该展开就展开；右键另一行由该行自己弹出菜单，右键到非树
   * 元素则保留浏览器原生菜单——菜单之外的元素始终可正常操作。
   *
   * 监听一律注册在捕获阶段：`contextmenu` 行处理器可能在本轮事件中打开新菜单，
   * 冒泡阶段的监听会立刻把新菜单又关掉，捕获阶段则不会。
   */
  private listenOutside(overlayRef: OverlayRef): void {
    const panel = overlayRef.overlayElement;
    const onOutsideEvent = (e: Event): void => {
      const target = e.target;
      if (target instanceof Node && panel.contains(target)) return;
      this.close();
    };
    // pointerdown：拖动行时（不一定产生 click）菜单也应立即让位
    document.addEventListener('pointerdown', onOutsideEvent, true);
    document.addEventListener('click', onOutsideEvent, true);
    document.addEventListener('contextmenu', onOutsideEvent, true);
    // 页面 / 任意容器滚动后指针位置已失效，直接关闭；
    // 菜单面板自身的滚动（自定义模板内可能出现）不关闭
    document.addEventListener('scroll', onOutsideEvent, true);
    this.cleanups.push(() => {
      document.removeEventListener('pointerdown', onOutsideEvent, true);
      document.removeEventListener('click', onOutsideEvent, true);
      document.removeEventListener('contextmenu', onOutsideEvent, true);
      document.removeEventListener('scroll', onOutsideEvent, true);
    });
  }

  /** 释放菜单外交互监听（关闭 / 销毁时调用） */
  private runCleanups(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }

  /** 自定义菜单模板的渲染上下文 */
  private buildContext(
    row: TreeRow<T>,
    event: MouseEvent | null,
    overlayRef: OverlayRef,
  ): TreeContextMenuTemplateContext<T> {
    return {
      $implicit: row.data,
      node: row.data,
      // 菜单锚定渲染行，必定已挂 TreeNode 视图（见 TreeRowView 约定）
      row: row as TreeRowView<T>,
      api: this.host.rowApi,
      close: () => {
        if (this.menuRef === overlayRef) this.close();
      },
      event,
    };
  }

  /** 行的左下角视口坐标（程序化打开菜单时的锚点） */
  private rowAnchor(id: TreeKey): { x: number; y: number } | null {
    const el = this.rowElement(id);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom };
  }

  /** 按 id 找到行的 DOM 元素（仅用于程序化定位，行数量级=可见行数） */
  private rowElement(id: TreeKey): HTMLElement | null {
    const root = this.host.rootElement();
    if (!root) return null;
    const key = String(id);
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-treeid]'));
    for (const el of candidates) {
      if (el.getAttribute('data-treeid') === key) return el;
    }
    return null;
  }

  /** 把树根上的主题 CSS 变量复制到菜单宿主（菜单脱离了树根，无法自然继承） */
  private copyThemeVars(host: HTMLElement): void {
    const root = this.host.rootElement();
    if (!root) return;
    const cs = getComputedStyle(root);
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      if (name.startsWith('--')) host.style.setProperty(name, cs.getPropertyValue(name));
    }
  }
}
