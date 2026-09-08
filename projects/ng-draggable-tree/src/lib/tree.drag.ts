import { ComponentRef, EnvironmentInjector, TemplateRef, createComponent, signal } from '@angular/core';
import type { DropPosition, TreeDropTarget, TreeKey } from './tree.types';
import type { NormalizedTreeOptions } from './tree-options';
import type { TreeRow, TreeRowView } from './tree.model';
import { resolveTargetSlot, walkNodes } from './tree.model';
import { cloneData, removeNodeIdsWithData } from './tree.operations';
import type { NgDraggableTreeComponent } from './ng-draggable-tree';
import type {
  TreeDragMoveInfo,
  TreeRowApi,
} from './ng-draggable-tree-node';
import {
  TreeDragGhostComponent,
  type TreeDragGhostTemplateContext,
} from './drag-ghost.component';
import {
  TreeDragRegistry,
  type CrossTreeDragSession,
  type CrossTreeDropResolution,
  type CrossTreeParticipant,
} from './tree.drag-registry';

/* ============================= 拖拽事件类型 ============================= */

export interface TreeDropEvent<T> {
  nodes: T[];
  parent: T | null;
  parentId: TreeKey | null;
  position: 'before' | 'after' | 'child';
  /**
   * 是否为跨树放置（true 表示 nodes 来自另一棵启用跨树拖拽的树，
   * 本次放置发生在当前树内部数据上）。
   */
  external?: boolean;
}

export interface TreeDragEvent<T> {
  node: T;
  nodeId: TreeKey | null;
  draggedNodes: T[];
  event?: Event;
}

/**
 * 拖放落点上下文：库在拖拽结束时计算出的“如果落位将发生在哪 / 是否有效”。
 *
 */
export interface TreeDropResult<T = unknown> {
  /** 是否落在有效落点（通过了目标行/空树根级的 allowDrop 与冲突校验）。false 表示本次拖放未生效 */
  dropped: boolean;
  /** 是否为跨树放置（落点在另一棵启用跨树拖拽的树内，此时 targetTree 非空） */
  external: boolean;
  /** 源树组件实例（dragEnd 就发在它上面；可调用 moveNodes / removeNodes 等） */
  sourceTree: NgDraggableTreeComponent<T>;
  /** 目标树组件实例：跨树放置时为接收树；树内放置为 null */
  targetTree: NgDraggableTreeComponent<T> | null;
  /** 落点所在的目标行 id；null 表示「根级末尾」 */
  targetRowId: TreeKey | null;
  /** 目标行节点数据；根级末尾 / 无有效目标行为 null */
  target: T | null;
  /** 放置方位：before 插到目标之前 / after 插到目标之后 / child 作为目标子节点；未生效时为 null */
  position: DropPosition | null;
  /** 解析出的父级 id（before/after → 目标行原父级；child → 目标行自身；根级末尾 → null） */
  parentId: TreeKey | null;
  /** 父级节点数据 */
  parent: T | null;
}

/** 拖拽结束事件：在源树输出一次，携带完整落点上下文，不产生任何数据改动 */
export interface TreeDragEndEvent<T> extends TreeDragEvent<T> {
  /** 被拖拽顶层节点的 id（与 draggedNodes 一一对应） */
  draggedIds: TreeKey[];
  /** 落点上下文（源/目标树、目标节点、被拖节点与方位） */
  drop: TreeDropResult<T>;
}

/* ============================= 控制器宿主接口 ============================= */

/**
 * 拖拽控制器所需的树组件能力。由 `NgDraggableTreeComponent` 实现并注入，
 * 使控制器可以读写树的内部状态、读取可见行/选项并发出拖拽事件，而无需
 * 直接触碰组件的私有成员。
 *
 * @internal
 */
export interface TreeDragHost<T> {
  /** 当前可见行（含展开/选中等装饰状态，拖拽期间保持最新） */
  rows: TreeRow<T>[];
  /** 当前规范化选项 */
  opts: NormalizedTreeOptions<T>;
  /** 当前数据根数组（组件直接渲染/修改使用方传入的数据） */
  readData(): T[];
  readExpanded(): ReadonlySet<TreeKey>;
  writeExpanded(v: ReadonlySet<TreeKey>): void;
  /** 选中集合（Ctrl 多选拖拽时读取） */
  readSelected(): ReadonlySet<TreeKey>;
  /** 根据 id 集合返回原始节点数据 */
  dataOf(ids: TreeKey[]): T[];
  findById(id: TreeKey): T | null;
  rowById(id: TreeKey): TreeRow<T> | undefined;
  /** ids 中是否存在任一 id 已落在本树工作树内（跨树落点冲突校验，O(ids)） */
  hasAnyId(ids: readonly TreeKey[]): boolean;
  /** 树根 DOM 元素（#treeRoot） */
  rootElement(): HTMLElement | undefined;
  /** 用户自定义拖拽幽灵模板（#dragGhostTemplate），缺省返回 undefined */
  ghostTemplate(): TemplateRef<TreeDragGhostTemplateContext<T>> | undefined;
  /** 行行为 API（幽灵模板上下文与行模板共用） */
  rowApi: TreeRowApi<T>;
  /** 所属树组件实例（拖放结果载荷向使用方暴露，供调用公开执行器） */
  instance: NgDraggableTreeComponent<T>;
  emitDragStart(e: TreeDragEvent<T>): void;
  emitDragEnd(e: TreeDragEndEvent<T>): void;
}

/** 拖拽落点标记：id 为 null 且 position 为 'after' 表示「根级末尾」 */
interface DropMarker {
  id: TreeKey | null;
  position: 'before' | 'after' | 'child' | null;
}

/**
 * 行拖拽控制器：集中承载整棵树的拖拽运行逻辑。
 * - 拖拽状态（进行中 / 被拖行集合 / 落点标记 / 幽灵）都在本类维护；
 * - 通过 {@link TreeDragHost} 与树组件协作，不依赖其内部私有实现；
 * - 树的模板/行 API 仅保留一层薄转发，实现细节全部收拢于此。
 *
 * 跨树拖拽：当本树 options.crossTree 非 disabled 时，拖拽开始会向
 * {@link TreeDragRegistry} 登记会话；指针移动时广播坐标给「同 dragGroup 且
 * 同样启用」的其它树，由目标树复用自身的行几何与 allowDrop 显示落点标记；
 * 松手时把落点解析结果并入源树的 dragEnd 载荷一并发出 
 *
 * @internal
 */
export class TreeDragController<T = unknown> {
  private readonly dragging = signal(false);
  private draggedIds: TreeKey[] = [];
  private lastPointer = { x: 0, y: 0 };
  /** 最近一次指针事件（dragEnd 载荷里供使用方读取 ctrl/meta 等修饰键） */
  private lastPointerEvent: MouseEvent | null = null;
  /** 自绘拖拽幽灵（CDK 自由拖拽不会创建预览，需克隆行快照 / 渲染自定义模板） */
  private dragGhost: HTMLElement | null = null;
  /** 自定义幽灵模板的动态宿主组件引用（非空表示当前走模板模式） */
  private ghostRef: ComponentRef<TreeDragGhostComponent<T>> | null = null;
  /** 拖拽期间注册的 scroll 监听清理函数（scroll 事件不冒泡，用 capture 捕获任意滚动容器） */
  private scrollCleanup: (() => void) | null = null;
  private dropMarker = signal<DropMarker>({ id: null, position: null });

  /** 落点指示类（行模板同样绑定这些类；此处用于在 CD 间隙同步到 DOM） */
  private static readonly DROP_CLASSES = [
    'is-drop-before',
    'is-drop-after',
    'is-drop-child',
    'is-drop-forbidden',
  ] as const;
  /** 当前落点标记作用到的行元素（DOM 同步用） */
  private markerRowEl: HTMLElement | null = null;

  /** 本树作为「拖出源」时的跨树会话（拖拽期间非空） */
  private dragSession: CrossTreeDragSession | null = null;
  /** 本树作为「接收目标」时的外部会话（指针停留期间非空） */
  private externalSession: CrossTreeDragSession | null = null;
  /** 本树是否正被外部拖拽指针悬停（用于根容器高亮） */
  private externalHovering = false;
  /** 本控制器在注册表中的参与者视图 */
  private readonly participant: CrossTreeParticipant;

  constructor(
    private readonly host: TreeDragHost<T>,
    private readonly envInjector: EnvironmentInjector,
    private readonly registry: TreeDragRegistry | null = null,
  ) {
    this.participant = this.createParticipant();
    this.registry?.register(this.participant);
  }

  /** 是否处于拖拽中（树根/行指示样式用） */
  active(): boolean {
    return this.dragging();
  }

  /**
   * 该行是否可拖动（options.allowDrag 判定）。
   * 回调收到「拖动该行所带动的全部节点」：多选拖动整组时为整组，否则只有该行自身。
   */
  isDraggable(row: TreeRow<T>): boolean {
    const cfg = this.host.opts.allowDrag;
    if (!cfg) return false;
    return typeof cfg === 'function' ? cfg(this.dragNodesFor(row)) : cfg;
  }

  /**
   * 拖动该行会带动哪些节点：拖拽进行中且该行属于本次被拖集合时沿用锁定的整组，
   * 否则按当前多选态推导（与 onDragStart 的集合口径一致）。
   */
  private dragNodesFor(row: TreeRow<T>): T[] {
    if (this.dragging() && this.draggedIds.includes(row.id)) {
      const locked = this.host.dataOf(this.draggedIds);
      if (locked.length > 0) return locked;
    }
    const sel = this.host.readSelected();
    return this.host.dataOf(sel.has(row.id) && sel.size > 1 ? [...sel] : [row.id]);
  }

  /** 该行是否正被拖拽（多选拖拽时被拖动的多行均为 true） */
  isDragging(id: TreeKey): boolean {
    return this.dragging() && this.draggedIds.includes(id);
  }

  /** 该行的拖拽放置标记（active=允许放置；rejected=不可放置；position=方位） */
  markerFor(id: TreeKey): {
    active: boolean;
    rejected: boolean;
    position: 'before' | 'after' | 'child' | null;
  } {
    const m = this.dropMarker();
    const onRow = m.id === id;
    return {
      active: this.dragging() && onRow && m.position !== null,
      rejected: this.dragging() && onRow && m.position === null,
      position: onRow ? m.position : null,
    };
  }

  /** 该树是否正在被其它树拖拽的指针悬停（接收高亮用） */
  externalActive(): boolean {
    return this.externalHovering && this.externalSession !== null;
  }

  // ==================== 拖拽生命周期 ====================

  onDragStart(row: TreeRow<T>, sourceElement: HTMLElement): void {
    let ids = [row.id];
    const sel = this.host.readSelected();
    if (sel.has(row.id) && sel.size > 1) {
      ids = [...sel];
    }
    // 上一段外部接收/落点指示不可能与本次拖拽并发，但复位更保险
    this.clearExternalState();
    this.draggedIds = ids;
    this.dragging.set(true);
    this.startScrollTracking();
    this.createDragGhost(row, sourceElement);
    this.dragSession =
      this.host.opts.crossTree !== 'disabled'
        ? this.createCrossSession(ids)
        : null;
    this.host.emitDragStart({ node: row.data, nodeId: row.id, draggedNodes: this.host.dataOf(ids) });
  }

  onDragMoved(_row: TreeRow<T>, info: TreeDragMoveInfo): void {
    if (!this.dragging()) return;
    const point = this.toClientPoint(info);
    this.lastPointer = point;
    const ev = info.event as MouseEvent | null;
    if (ev) this.lastPointerEvent = ev;
    // 先完成全部几何读取（跨树广播 + 本树落点判定），最后才写 DOM（幽灵位移）。
    // 反过来“先写幽灵 style 再读 rect”会让每次指针移动都触发一次强制同步布局。
    // 指针位于另一棵「可接收」的树区域时，落点交由目标树显示（避免两树并排时误放置）。
    const claimed = this.dragSession !== null && this.broadcastCrossMove(point);
    if (claimed) {
      this.setDropMarker(null, null);
    } else {
      this.updateDropMarker();
    }
    this.moveDragGhost(point);
  }

  onDragEnd(row: TreeRow<T>): void {
    if (!this.dragging()) return;
    this.stopScrollTracking();
    this.destroyDragGhost();
    const ids = this.draggedIds;
    this.dragging.set(false);
    // 库不做任何数据改动：先把「落点在哪、是否有效」解析出来（跨树目标树
    // 也在此收尾清理各自的指示状态），再一次性发到源树 dragEnd，由使用方
    // 依据载荷决定是否落位、如何落位。
    const drop = this.resolveDropContext(ids);
    this.host.emitDragEnd({
      node: row.data,
      nodeId: row.id,
      draggedNodes: this.host.dataOf(ids),
      draggedIds: ids,
      event: this.lastPointerEvent ?? undefined,
      drop,
    });
  }

  /** 组件销毁时清理滚动监听、幽灵并注销注册表 */
  dispose(): void {
    this.stopScrollTracking();
    this.destroyDragGhost();
    this.registry?.unregister(this.participant);
  }

  // ==================== 跨树拖拽（源侧） ====================

  /** 构造源侧会话：载荷为源树克隆中按最顶层分离出的节点深拷贝（仅作跨树判定/冲突检测用） */
  private createCrossSession(ids: TreeKey[]): CrossTreeDragSession {
    const opts = this.host.opts;
    const cloned = cloneData(this.host.readData(), opts);
    const { removed } = removeNodeIdsWithData(cloned, opts, ids);
    const subtreeIds: TreeKey[] = [];
    walkNodes(removed, opts, ({ id }) => subtreeIds.push(id));
    return {
      nodes: removed as unknown[],
      ids,
      subtreeIds,
      group: opts.dragGroup,
    };
  }

  /** 广播指针移动给所有“同组且启用”的树；返回指针是否落在某可接收树区域内 */
  private broadcastCrossMove(point: { x: number; y: number }): boolean {
    const session = this.dragSession;
    if (!session) return false;
    let claimed = false;
    this.registry?.forEach((p) => {
      if (p === this.participant || p.isBusy()) return;
      if (p.crossTreeMode() === 'disabled' || p.group() !== session.group) {
        p.clearExternalState();
        return;
      }
      // 是否“接管”由目标树在判几何时一并返回，避免这里重复做一次 rect 判定
      if (p.handleExternalPointerMove(point, session)) claimed = true;
    });
    return claimed;
  }

  /**
   * 汇总本次拖拽的落点结果（跨树优先，其次本树），供 dragEnd 载荷使用。
   * 只读不改数据：无论落点是否有效，被拖节点都原样留在源树。
   */
  private resolveDropContext(ids: TreeKey[]): TreeDropResult<T> {
    const sourceTree = this.host.instance;
    const cross = this.resolveCrossDrop();
    if (cross) {
      return {
        dropped: cross.ok,
        external: true,
        sourceTree,
        targetTree: (cross.tree as NgDraggableTreeComponent<T>) ?? null,
        targetRowId: cross.targetRowId,
        target: cross.target as T | null,
        position: cross.position,
        parentId: cross.parentId,
        parent: cross.parent as T | null,
      };
    }
    return this.resolveIntraDrop(sourceTree, ids);
  }

  /** 指针停留处若有「可接收」目标树则取回其落点解析；同时收尾清理各树接收状态 */
  private resolveCrossDrop(): CrossTreeDropResolution | null {
    const session = this.dragSession;
    this.dragSession = null;
    if (!session) return null;
    let chosen: CrossTreeDropResolution | null = null;
    this.registry?.forEach((p) => {
      if (p === this.participant || p.isBusy()) return;
      if (p.crossTreeMode() === 'disabled' || p.group() !== session.group) {
        p.clearExternalState();
        return;
      }
      if (!chosen && p.containsPoint(this.lastPointer)) {
        chosen = p.resolveExternalDrop(session);
      } else {
        p.clearExternalState();
      }
    });
    return chosen;
  }

  // ==================== 跨树拖拽（目标侧） ====================

  /** 注册表能力封装（抹掉泛型后的视图） */
  private createParticipant(): CrossTreeParticipant {
    const self = this;
    return {
      crossTreeMode: () => self.host.opts.crossTree,
      group: () => self.host.opts.dragGroup,
      isBusy: () => self.dragging(),
      containsPoint: (point) => self.pointInRoot(point),
      handleExternalPointerMove: (point, session) => self.handleExternalPointerMove(point, session),
      resolveExternalDrop: (session) => self.resolveExternalDrop(session),
      clearExternalState: () => self.clearExternalState(),
    };
  }

  /**
   * 目标树收到源树广播：刷新/清除本树标记。
   * 返回本树是否接管本次悬停（指针落在本树区域内），供源树判定
   * 「指针是否已在别的树上方」，省掉调用方重复做一次几何判定。
   */
  private handleExternalPointerMove(
    point: { x: number; y: number },
    session: CrossTreeDragSession,
  ): boolean {
    if (this.dragging()) {
      this.clearExternalState();
      return false;
    }
    if (!this.pointInRoot(point)) {
      this.externalHovering = false;
      this.setDropMarker(null, null);
      this.syncExternalRootClass();
      return false;
    }
    const newSource = this.externalSession !== session;
    this.externalSession = session;
    this.externalHovering = true;
    this.lastPointer = point;
    if (newSource) this.setDropMarker(null, null);
    this.updateExternalMarker(session);
    this.syncExternalRootClass();
    return true;
  }

  /**
   * 目标树解析一次外部放置的落点（不改动任何数据）。
   * 先清空自身接收状态与行落点指示，再复用 allowDrop 期间生成的标记做最终校验，
   * 把「落点行/方位/父级/组件实例」回报给源树——是否真正落位由使用方依据
   * 源树 dragEnd 载荷调用公开执行器完成。
   */
  private resolveExternalDrop(session: CrossTreeDragSession): CrossTreeDropResolution {
    const marker = this.dropMarker();
    const incoming = this.externalSession;
    this.dropMarker.set({ id: null, position: null });
    this.syncMarkerRowDom(null, null);
    this.externalSession = null;
    this.externalHovering = false;
    this.syncExternalRootClass();
    const failed = (): CrossTreeDropResolution => ({
      ok: false,
      targetRowId: marker.id,
      position: null,
      target: this.rowDataOf(marker.id),
      parentId: null,
      parent: null,
      tree: this.host.instance as unknown,
    });
    if (!incoming || marker.position === null) return failed();
    const payload = session.nodes as T[];
    if (!payload.length) return failed();
    // 目标树已存在相同 id 时拒绝（防止 cdk-trackBy 键冲突）
    if (this.overlapsWorking(session)) return failed();
    const slot = resolveTargetSlot(this.host.rows, marker.id, marker.position);
    if (!slot) return failed();
    if (slot.parentId !== null && session.subtreeIds.includes(slot.parentId)) {
      return failed();
    }
    const parentNode = slot.parentId !== null ? this.host.findById(slot.parentId) : null;
    return {
      ok: true,
      targetRowId: marker.id,
      position: marker.position,
      target: this.rowDataOf(marker.id),
      parentId: slot.parentId,
      parent: (parentNode ?? null) as unknown,
      tree: this.host.instance as unknown,
    };
  }

  /** 取某行的原始节点数据（根级末尾 / 未知行返回 null） */
  private rowDataOf(id: TreeKey | null): unknown {
    if (id === null) return null;
    const row = this.host.rowById(id);
    return row ? row.data : null;
  }

  /** 目标树停止接收：清理外部会话与落点标记 */
  private clearExternalState(): void {
    this.externalSession = null;
    this.externalHovering = false;
    this.setDropMarker(null, null);
    this.syncExternalRootClass();
  }

  /** 视口坐标是否落在本树根元素区域内 */
  private pointInRoot(point: { x: number; y: number }): boolean {
    const rootEl = this.host.rootElement();
    if (!rootEl) return false;
    const rect = rootEl.getBoundingClientRect();
    return (
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
    );
  }

  /** 目标树是否已存在与被拖子树重叠的 id（走宿主索引，O(ids)） */
  private overlapsWorking(session: CrossTreeDragSession): boolean {
    return this.host.hasAnyId(session.subtreeIds);
  }

  // ==================== 拖拽幽灵 ====================

  /**
   * 创建拖拽幽灵。sourceElement 为被拖行 DOM（来自 cdkDragStarted 的 source.element）：
   * - 提供了 `#dragGhostTemplate`：动态渲染自定义幽灵（Angular 模板，内容可交互/响应式）；
   * - 缺省：克隆 sourceElement（被拖行快照）作为幽灵。
   */
  private createDragGhost(row: TreeRow<T>, sourceElement: HTMLElement): void {
    this.destroyDragGhost();
    const tpl = this.host.ghostTemplate();
    if (tpl) {
      this.createTemplateGhost(row, sourceElement, tpl);
    } else {
      this.createCloneGhost(sourceElement, this.draggedIds.length);
    }
  }

  /**
   * 克隆被拖行作为幽灵：CDK 自由拖拽不会创建 `.cdk-drag-preview`，
   * 这里把源行克隆为脱离树的固定定位行快照，跟随指针移动。
   * count 为本次拖拽的节点数（多选拖拽时大于 1），此时在快照右侧附加数量角标。
   */
  private createCloneGhost(source: HTMLElement, count: number): void {
    if (!document.body) return;
    const ghost = source.cloneNode(true) as HTMLElement;
    // 去掉运行期状态类，避免透明度/光标/放置指示等状态污染幽灵
    ghost.classList.remove(
      'is-dragging',
      'is-grabbable',
      'is-drop-before',
      'is-drop-after',
      'is-drop-child',
      'is-drop-forbidden',
    );
    for (const cls of [...ghost.classList]) {
      if (cls.startsWith('cdk-')) ghost.classList.remove(cls);
    }
    // 幽灵脱离 .ng-draggable-tree-root 后需内联 CSS 变量，保证明/暗主题外观一致
    this.copyThemeVars(source, ghost);
    ghost.classList.add('ng-draggable-tree-drag-ghost');
    // CDK 拖拽/排序会把内联 transform/transition 写到源行上（如 translate3d(0, 8px, 0)），
    // 克隆会把它们带进幽灵，与 fixed 的 left/top 叠加导致幽灵偏离指针。这里显式清除。
    ghost.style.transform = 'none';
    ghost.style.transition = 'none';
    ghost.style.position = 'fixed';
    ghost.style.left = `${source.getBoundingClientRect().left}px`;
    ghost.style.top = `${source.getBoundingClientRect().top}px`;
    ghost.style.width = `${source.offsetWidth}px`;
    ghost.style.margin = '0';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '100000';
    if (count > 1) {
      // 多选拖拽：角标展示拖动节点总数（DOM 克隆快照无法感知模板上下文）
      const badge = document.createElement('span');
      badge.className = 'ng-draggable-tree-drag-count';
      badge.textContent = String(count);
      badge.setAttribute('aria-hidden', 'true');
      ghost.appendChild(badge);
      ghost.classList.add('is-multi');
    }
    document.body.appendChild(ghost);
    this.dragGhost = ghost;
  }

  /**
   * 通过用户模板渲染拖拽幽灵：动态创建宿主组件并挂载到 document.body。
   * 上下文提供 node / row / api / draggedNodes，供模板自由定制外观。
   */
  private createTemplateGhost(
    row: TreeRow<T>,
    source: HTMLElement,
    template: TemplateRef<TreeDragGhostTemplateContext<T>>,
  ): void {
    if (!document.body) return;
    const ref = createComponent<TreeDragGhostComponent<T>>(TreeDragGhostComponent<T>, {
      environmentInjector: this.envInjector,
    });
    const ctx: TreeDragGhostTemplateContext<T> = {
      $implicit: row.data,
      node: row.data,
      // 幽灵模板创建自行管线产出的行，必定已挂 TreeNode 视图（见 TreeRowView 约定）
      row: row as TreeRowView<T>,
      api: this.host.rowApi,
      draggedNodes: this.host.dataOf(this.draggedIds),
    };
    ref.setInput('ghostTemplate', template);
    ref.setInput('context', ctx);
    ref.changeDetectorRef.detectChanges();

    const el = ref.location.nativeElement as HTMLElement;
    el.classList.add('ng-draggable-tree-drag-ghost', 'ng-draggable-tree-drag-ghost-custom');
    this.copyThemeVars(source, el);
    el.style.position = 'fixed';
    el.style.width = 'max-content';
    el.style.margin = '0';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '100000';
    const rect = source.getBoundingClientRect();
    el.style.left = `${rect?.left ?? 0}px`;
    el.style.top = `${rect?.top ?? 0}px`;
    // 显式在组件销毁时移除宿主节点，避免任何环境差异下的 DOM 残留
    ref.onDestroy(() => el.remove());
    document.body.appendChild(el);

    this.ghostRef = ref;
    this.dragGhost = el;
  }

  /** 把源元素继承到的主题 CSS 变量复制到幽灵元素（幽灵脱离树根后需自带主题变量） */
  private copyThemeVars(source: HTMLElement, target: HTMLElement): void {
    const cs = getComputedStyle(source);
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      if (name.startsWith('--')) target.style.setProperty(name, cs.getPropertyValue(name));
    }
  }

  /**
   * 把拖拽事件换算成视口(client)坐标。
   * 不直接使用 CDK 的 `pointerPosition`：它由「page 坐标 − 拖拽开始时缓存的滚动量」算出，
   * 两次拖拽之间发生滚动时会得到陈旧坐标，使 fixed 定位的幽灵偏离指针。
   * 原生事件的 clientX/clientY 与视口坐标同源，始终反映当前指针位置。
   */
  private toClientPoint(info: TreeDragMoveInfo): { x: number; y: number } {
    const ev = info.event as MouseEvent | null;
    if (ev && ev.clientX !== undefined && (ev.clientX !== 0 || ev.clientY !== 0)) {
      return { x: ev.clientX, y: ev.clientY };
    }
    //拿不到 client 坐标（罕见触摸环境/测试合成事件）时退化为 page 坐标减页面滚动
    const scroller = document.scrollingElement || document.documentElement;
    const sx = scroller ? scroller.scrollLeft || 0 : 0;
    const sy = scroller ? scroller.scrollTop || 0 : 0;
    return { x: info.pointerPosition.x - sx, y: info.pointerPosition.y - sy };
  }

  /** 幽灵跟随指针（point 为视口 client 坐标，与 fixed 定位同源；右下方轻微偏移避免遮挡目标行） */
  private moveDragGhost(point: { x: number; y: number }): void {
    const ghost = this.dragGhost;
    if (!ghost) return;
    ghost.style.left = `${point.x + 12}px`;
    ghost.style.top = `${point.y + 8}px`;
  }

  private destroyDragGhost(): void {
    if (this.ghostRef) {
      this.ghostRef.destroy();
      this.ghostRef = null;
    } else if (this.dragGhost) {
      this.dragGhost.remove();
    }
    this.dragGhost = null;
  }

  // ==================== 滚动跟踪 ====================

  /** 拖拽期间滚动容器/页面滚动时实时刷新放置锚点（scroll 不冒泡，capture 捕获所有滚动源） */
  private startScrollTracking(): void {
    this.stopScrollTracking();
    const onScroll = () => {
      if (this.dragging()) this.updateDropMarker();
    };
    window.addEventListener('scroll', onScroll, true);
    this.scrollCleanup = () => window.removeEventListener('scroll', onScroll, true);
  }

  private stopScrollTracking(): void {
    if (this.scrollCleanup) {
      this.scrollCleanup();
      this.scrollCleanup = null;
    }
  }

  // ==================== 落点指示 ====================

  private updateDropMarker(): void {
    this.updateMarkerInternal(this.draggedIds, false);
  }

  private updateExternalMarker(session: CrossTreeDragSession): void {
    if (this.externalSession !== session) return;
    this.updateMarkerInternal(session.ids, true);
  }

  private updateMarkerInternal(ids: TreeKey[], external: boolean): void {
    const rootEl = this.host.rootElement();
    const rows = this.host.rows;
    if (!rootEl) {
      this.setDropMarker(null, null);
      return;
    }
    const rect = rootEl.getBoundingClientRect();
    const pointerY = this.lastPointer.y;
    // 外部接收：多棵树并排/堆叠时只认「指针落进本树根区域」的拖放
    if (external) {
      const px = this.lastPointer.x;
      if (px < rect.left || px > rect.right || pointerY > rect.bottom) {
        this.setDropMarker(null, null);
        return;
      }
    }
    if (pointerY < rect.top) {
      // 指针在树可视区域上方 → 不产生放置指示
      this.setDropMarker(null, null);
      return;
    }
    if (!rows.length) {
      // 空树：仅外部接收时支持“根级末尾”落点（指针必须落在树区域内）
      if (external) {
        this.setDropMarker(
          null,
          this.isDropAllowed('after', null, ids, true) ? 'after' : null,
        );
      } else {
        this.setDropMarker(null, null);
      }
      return;
    }
    const rowEls = rootEl.querySelectorAll<HTMLElement>('.ng-draggable-tree-row');
    if (!rowEls.length) {
      this.setDropMarker(null, null);
      return;
    }

    // 指针坐标与行几何统一换算到「根内容坐标」：
    // 视口坐标 clientY → 减 rect.top → 加根滚动量 scrollTop，
    // 树内滚动与页面/祖先滚动都保持同一坐标系，避免锚点随滚动偏移。
    const scrollTop = rootEl.scrollTop || 0;
    const y = pointerY - rect.top + scrollTop;

    const firstTop = rowEls[0].getBoundingClientRect().top - rect.top + scrollTop;
    if (y < firstTop) {
      // 首行上方留白（根顶有间距）→ 视为插到首行之前
      const first = rows[0];
      this.setDropMarker(first.id, this.isDropAllowed('before', first, ids, external) ? 'before' : null);
      return;
    }

    const hit = this.hitRowIndex(y, rowEls, rect.top, scrollTop);
    if (hit < 0) {
      // 指针在全部行之下：根级末尾追加（标记无 id，表示 root end）
      this.setDropMarker(null, external ? (this.isDropAllowed('after', null, ids, true) ? 'after' : null) : 'after');
      return;
    }
    const target = rows[Math.min(hit, rows.length - 1)];
    if (!target) return;
    const el = rowEls[hit];
    const h = el.offsetHeight || 24;
    const elTop = el.getBoundingClientRect().top - rect.top + scrollTop;
    const ratio = (y - elTop) / h;
    let position: 'before' | 'after' | 'child' | null = null;
    if (target.isLeaf){
      position = ratio < 0.5 ? 'before' : 'after';
    }else{
      position = ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'child';
    }
    this.setDropMarker(target.id, this.isDropAllowed(position, target, ids, external) ? position : null);
  }

  /** 仅在标记值变化时写入，避免拖拽指针高频移动触发整树装饰重算 */
  private setDropMarker(id: TreeKey | null, position: 'before' | 'after' | 'child' | null): void {
    const cur = this.dropMarker();
    if (cur.id === id && cur.position === position) return;
    this.dropMarker.set({ id, position });
    // 行是 OnPush 子组件且拖拽中 row/api 引用不变，模板绑定不会随指针高频刷新；
    // 这里直接把落点/禁用类同步到对应行 DOM（与模板绑定同一状态，CD 后仍一致）。
    this.syncMarkerRowDom(id, position);
  }

  /** 把当前落点标记同步为行上的指示类（root-end 无具体行，不落视觉类） */
  private syncMarkerRowDom(id: TreeKey | null, position: 'before' | 'after' | 'child' | null): void {
    const prev = this.markerRowEl;
    if (prev) {
      prev.classList.remove(...TreeDragController.DROP_CLASSES);
      this.markerRowEl = null;
    }
    if (id === null) return;
    const root = this.host.rootElement();
    if (!root) return;
    const key = String(id);
    let el: HTMLElement | null = null;
    const els = root.querySelectorAll<HTMLElement>('.ng-draggable-tree-row');
    for (const rowEl of els) {
      if (rowEl.getAttribute('data-treeid') === key) {
        el = rowEl;
        break;
      }
    }
    if (!el) return;
    this.markerRowEl = el;
    const cls =
      position === null
        ? 'is-drop-forbidden'
        : position === 'before'
          ? 'is-drop-before'
          : position === 'after'
            ? 'is-drop-after'
            : 'is-drop-child';
    el.classList.add(cls);
  }

  /** 把“正被外部拖拽悬停”同步到树根高亮类（根视图同样可能错过高频刷新） */
  private syncExternalRootClass(): void {
    const root = this.host.rootElement();
    if (!root) return;
    root.classList.toggle('is-cross-drag-target', this.externalActive());
  }

  /** 命中检测：行几何与指针同在根内容坐标系中比较 */
  private hitRowIndex(y: number, els: NodeListOf<HTMLElement>, rootTop: number, scrollTop: number): number {
    for (let i = 0; i < els.length; i++) {
      const top = els[i].getBoundingClientRect().top - rootTop + scrollTop;
      const h = els[i].offsetHeight || 24;
      if (y >= top && y <= top + h) return i;
    }
    return els.length ? els.length - 1 : -1;
  }

  /**
   * 放置校验：
   * - 本树拖拽：沿用 options.allowDrop（默认禁自身/禁后代），ids 为本树行 id；
   * - 外部接收：目标树 options.allowDrop 同样生效；跨树场景不存在“自身/后代”，
   *   但需额外校验目标树不与被拖子树产生 id 冲突，防止 trackBy 键重复。
   */
  private isDropAllowed(
    position: 'before' | 'after' | 'child',
    target: TreeRow<T> | null,
    ids: TreeKey[],
    external: boolean,
  ): boolean {
    if (!ids.length) return false;
    const isChild = position === 'child';
    let dragged: T[];
    let isSelf = false;
    let isDescendant = false;

    if (external) {
      const session = this.externalSession;
      if (!session) return false;
      dragged = session.nodes as T[];
      // 目标树行不可能是被拖节点本身/后代，但若 id 已存在（防键冲突）则拒绝
      if (session.subtreeIds.includes(target?.id ?? -1)) return false;
      if (this.overlapsWorking(session)) return false;
    } else {
      if (target && ids.includes(target.id)) return false;
      dragged = this.host.dataOf(ids);
      isSelf =
        dragged.length === 1 &&
        (isChild ? target?.id === ids[0] : target?.parentId === ids[0]);
      isDescendant = target ? this.targetInsideDragged(target, ids) : false;
    }

    const dropCtx: TreeDropTarget<T> = {
      target: target === null ? null : isChild ? target.data : target.parentData,
      targetId: target === null ? null : isChild ? target.id : target.parentId,
      position,
      dragged,
      isSelf,
      isDescendant,
    };
    return this.host.opts.allowDrop(dropCtx);
  }

  /** target 是否为被拖拽节点的后代（位置 child 时的禁入区） */
  private targetInsideDragged(target: TreeRow<T>, ids: TreeKey[]): boolean {
    const rows = this.host.rows;
    const rowIndex = rows.findIndex((r) => r.id === target.id);
    if (rowIndex < 0) return false;
    let current: TreeRow<T> | undefined = rows[rowIndex];
    // 沿可见行向上找祖先链，命中拖拽集合即非法
    for (let i = rowIndex - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.depth < current.depth && current.parentId === r.id) {
        if (ids.includes(r.id)) return true;
        current = r;
      }
    }
    return false;
  }

  /**
   * 本树内落点解析：读取当前落点标记（有效标记均已通过 allowDrop），
   * 不改数据，只把落点行 / 方位 / 父级等信息整理成 dragEnd 载荷。
   */
  private resolveIntraDrop(sourceTree: NgDraggableTreeComponent<T>, ids: TreeKey[]): TreeDropResult<T> {
    const marker = this.dropMarker();
    this.dropMarker.set({ id: null, position: null });
    this.syncMarkerRowDom(null, null);
    const markerId = marker.id;
    const markerPosition = marker.position;
    const dropped = markerPosition !== null;
    const targetRow = markerId !== null ? this.host.rowById(markerId) : undefined;
    let parentId: TreeKey | null = null;
    let parent: T | null = null;
    if (dropped) {
      const slot = markerId !== null ? resolveTargetSlot(this.host.rows, markerId, markerPosition) : null;
      const safe = slot ?? { parentId: null, anchor: null };
      // allowDrop 一般已拦截“放入自身子树”的情况；此处兜底，不把循环落点描述为有效
      if (safe.parentId !== null && ids.includes(safe.parentId)) {
        return {
          dropped: false,
          external: false,
          sourceTree,
          targetTree: null,
          targetRowId: markerId,
          target: targetRow ? targetRow.data : null,
          position: markerPosition,
          parentId: null,
          parent: null,
        };
      }
      parentId = safe.parentId;
      parent = parentId !== null ? this.host.findById(parentId) : null;
    }
    return {
      dropped,
      external: false,
      sourceTree,
      targetTree: null,
      targetRowId: markerId,
      target: targetRow ? targetRow.data : null,
      position: markerPosition,
      parentId,
      parent,
    };
  }
}
