import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  ElementRef,
  effect,
  EnvironmentInjector,
  inject,
  Input,
  linkedSignal,
  model,
  OnChanges,
  OnDestroy,
  output,
  signal,
  TemplateRef,
  ViewEncapsulation,
  viewChild,
} from '@angular/core';
import { CdkTree, CdkTreeNodeDef, FlatTreeControl } from '@angular/cdk/tree';
import { ArrayDataSource } from '@angular/cdk/collections';
import { Overlay } from '@angular/cdk/overlay';
import type { DropPosition, TreeKey, TreeStateStore } from './tree.types';
import { normalizeOptions, type NormalizedTreeOptions, type TreeOptions } from './tree-options';
import {
  buildCheckStats,
  collectSubtreeIds,
  flattenStructure,
  resolveRowDecoration,
  resolveTargetSlot,
  walkNodes,
  type CheckStats,
  type TreeRow,
  type RowDecorationInput,
} from './tree.model';
import {
  TreeNodeComponent,
  type TreeRowApi,
  type TreeTemplates,
} from './ng-draggable-tree-node';
import {
  TreeContextMenuController,
  type TreeContextMenuHost,
  type TreeContextMenuTemplateContext,
} from './tree.context-menu';
import {
  TreeDragController,
  type TreeDragEndEvent,
  type TreeDragEvent,
  type TreeDragHost,
  type TreeDropEvent,
  type TreeDropResult,
} from './tree.drag';
import { TreeDragRegistry } from './tree.drag-registry';
export type { TreeDragEndEvent, TreeDragEvent, TreeDropEvent, TreeDropResult } from './tree.drag';
import {
  TreeNavigationController,
  type TreeNavigationHost,
} from './tree.navigation';
import { attachResolvedChildren, isAsyncObject, sameOptionsInput } from './tree.util';
import {
  cloneData,
  insertNodesBatch,
  insertNodesTo,
  moveNodes,
  removeNodeIdsWithData,
} from './tree.operations';
import { TreeIndex } from './tree.index';
import { TreeNode } from './tree.node';
import { createTreeStateStore } from './tree.state';

/* ============================= 公共事件类型 ============================= */

export interface TreeNodeEvent<T> {
  node: T;
  nodeId: TreeKey | null;
  event?: Event;
}

export interface TreeExpansionEvent<T> {
  node: T;
  nodeId: TreeKey | null;
  isExpanded: boolean;
}

export interface TreeSelectionEvent<T> {
  selectedNodes: T[];
  node: T;
  nodeId: TreeKey | null;
}

export interface TreeLoadChildrenEvent<T> {
  node: T;
  nodeId: TreeKey | null;
  children: T[] | null;
}

/** 批量新增节点事件（`addNodes` 成功后发出） */
export interface TreeAddEvent<T> {
  /** 本次新增的节点（写入数据源的实际引用，顺序与传入一致） */
  nodes: T[];
  /** 落入的父级节点；加入根级时为 null */
  parent: T | null;
  parentId: TreeKey | null;
  /** 插入位置：'first' 容器开头 / 'end' 容器末尾 / 具体锚点兄弟 id（插到其之前） */
  position: 'first' | 'end' | TreeKey;
}

/* ============================= 落点计划（resolve / apply 分离） ============================= */

/**
 * 「移动」的落点计划：{@link NgDraggableTreeComponent.resolveMove} 的纯计算结果。
 * 只做校验与落点（父级 + 兄弟锚点）归一化，**不改动数据、不触发视图**。
 */
export interface TreeMovePlan {
  /** 被移动的节点 id（已去重，保持传入顺序） */
  ids: TreeKey[];
  /** 归一化后的落点父级 id；null 表示根级 */
  parentId: TreeKey | null;
  /** 归一化后的兄弟锚点 id（插到它之前）；null 表示插到容器末尾 */
  anchor: TreeKey | null;
  /** 调用方传入的原始方位（原样回填，便于事件与日志） */
  position: DropPosition;
  /** 调用方传入的目标行 id（原样回填） */
  targetRowId: TreeKey | null;
}

/** 「复制 / 插入外部节点」的落点计划（同 {@link TreeMovePlan}，载荷为节点数据） */
export interface TreeCopyPlan<T> {
  /** 待插入的载荷节点（`applyCopy` 会深克隆，与调用方数据互不共享） */
  nodes: T[];
  parentId: TreeKey | null;
  anchor: TreeKey | null;
  position: DropPosition;
  targetRowId: TreeKey | null;
}

/** 「新增」的落点计划：落点直接由 parentId + position 给出，无需行解析 */
export interface TreeAddPlan<T> {
  nodes: T[];
  parentId: TreeKey | null;
  /** 插入位置：'first' 容器开头 / 'end' 容器末尾 / 具体锚点兄弟 id（插到其之前） */
  position: 'first' | 'end' | TreeKey;
}

/** 「删除」计划：命中 id 与其完整子树 id（受控方据此同步清理外部状态） */
export interface TreeRemovePlan {
  /** 命中的顶层 id（已去重，保持传入顺序；不存在的 id 已被剔除） */
  ids: TreeKey[];
  /** ids 各自子树（含自身）的全部 id */
  subtreeIds: TreeKey[];
}

/** 行模型别名：`Row<T>` 用于组件内部（与 tree.model 的 TreeRow 同构） */
type Row<T> = TreeRow<T>;

/**
 * `updateRow` 的字段补丁：直接给字段对象，或按当前节点计算补丁的函数
 * （参数是工作树中的节点，返回补丁对象；返回 null / 空对象表示不更新）。
 */
export type TreeNodePatch<T> = Partial<T> & Record<string, unknown>;

/** `updateRow` 的可选参数 */
export interface UpdateRowOptions {
  /**
   * 是否发出 `dataChange` 并回写 `[(nodes)]`，默认 `true`。
   * 传 `false` 为静默就地改写：数据已在数据源上更新，仅少了事件通知。
   */
  emit?: boolean;
}

/** 共享空集合：避免装饰层在无复选框场景反复分配/建立依赖 */
const EMPTY_KEY_SET: ReadonlySet<TreeKey> = new Set<TreeKey>();

/** 共享空版本号表：未发生定点更新时不建立多余依赖 */
const EMPTY_ROW_PATCHES: ReadonlyMap<TreeKey, number> = new Map();

/** 共享空数据：nodes 未提供（undefined）时保持引用稳定，避免被误判为一次数据变化 */
const EMPTY_DATA: never[] = [];

/** 外部传入的 id 集合归一化为 Set（null / undefined → 空集） */
function toKeySet(src: Iterable<TreeKey> | null | undefined): ReadonlySet<TreeKey> {
  return src ? new Set(src) : new Set<TreeKey>();
}

/** 内容比较：Set 与任意 id 可迭代集合是否等价（仅在受控输入变化时调用，O(n)） */
function sameKeySet(a: ReadonlySet<TreeKey>, b: Iterable<TreeKey> | null | undefined): boolean {
  if (!b) return a.size === 0;
  let n = 0;
  for (const id of b) {
    n++;
    if (!a.has(id)) return false;
  }
  return n === a.size;
}

@Component({
  selector: 'ng-draggable-tree',
  imports: [CdkTree, CdkTreeNodeDef, TreeNodeComponent],
  templateUrl: './ng-draggable-tree.template.html',
  styleUrl: './tree.styles.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NgDraggableTreeComponent<T = unknown> implements OnChanges, AfterViewInit, OnDestroy {
  // ---------------- 输入 ----------------
  /**
   * 数据源，支持双向绑定：`<ng-draggable-tree [(nodes)]="data" />`。
   *
   * 组件在增删/移动/懒加载落位时**就地修改**这份数据（数组内容与节点对象被改动，
   * 引用不变）；视图更新由内部数据版本号驱动，绑定值不会被替换为新数组。
   * 外部整体替换数据数组（传入新引用）同样受支持，会触发一次视图重建。
   */
  readonly nodes = model<T[]>([]);

  /**
   * 展开状态（**可选受控**）：外部传入时以外部为真源，内部展开/折叠的结果经
   * `expandedIdsChange` 回写，可直接 `[(expandedIds)]` 双向绑定接管，
   * 或 `[expandedIds]` + `(expandedIdsChange)` 自行处理（如服务端校验后再落位）。
   *
   * - 变化判定按 id 集合**内容**比较（与元素顺序、数组/Set、引用均无关），
   *   因此传 `[...expanded()]` 这类每轮新建的引用不会造成重复同步；
   * - 未绑定（或传 null）时组件自管；
   * - 内容一致时不回写，`expand` / `collapse` 事件不受受控影响，仍照常发出。
   */
  readonly expandedIdsInput = model<Iterable<TreeKey> | null>(null, { alias: 'expandedIds' });

  /** 选中状态（可选受控），语义同 {@link expandedIdsInput} */
  readonly selectedIdsInput = model<Iterable<TreeKey> | null>(null, { alias: 'selectedIds' });

  /**
   * 勾选状态（可选受控），语义同 {@link expandedIdsInput}。
   * `useTriState` 为真（默认）时勾选单元是叶子，父级由统计派生；回写的是**叶子集合**，
   * 与 {@link checkedIds} 的语义一致（外部只需存叶子 id）。
   */
  readonly checkedIdsInput = model<Iterable<TreeKey> | null>(null, { alias: 'checkedIds' });

  @Input() set options(o: TreeOptions<T> | undefined) {
    this.rawOptions = o;
  }

  /** 已应用于视图的数据输入引用（用于判断外部是否整体替换了数据数组） */
  private appliedRawData: T[] | null = null;
  private rawOptions: TreeOptions<T> | undefined = undefined;
  /** 已生效的原始 options 输入（用于内容比较） */
  private appliedOptions: TreeOptions<T> | undefined = undefined;
  /** 已消费「初始展开」字段标记的节点 id（每个节点只应用一次，见 applyNodeStateFlags） */
  private expandedFlagApplied = new Set<TreeKey>();
  /** 已消费「初始选中」字段标记的节点 id（同上） */
  private selectedFlagApplied = new Set<TreeKey>();
  loadingRef = contentChild<TemplateRef<any>>('loadingTemplate')
  treeNodeRef = contentChild<TemplateRef<any>>('treeNodeTemplate')
  /** 自定义拖拽幽灵模板（#dragGhostTemplate）；缺省时克隆被拖行作为幽灵快照 */
  dragGhostTemplateRef = contentChild<TemplateRef<any>>('dragGhostTemplate')
  /**
   * 自定义右键菜单模板（`#contextMenuTemplate`）；**未投影时右键不弹菜单**，
   * 只发出 `(contextMenu)` 事件，由使用方自行处理。上下文见 {@link TreeContextMenuTemplateContext}。
   */
  contextMenuTemplateRef = contentChild<TemplateRef<TreeContextMenuTemplateContext<T>>>('contextMenuTemplate')
  // ---------------- 输出 ----------------
  readonly expand = output<TreeExpansionEvent<T>>();
  readonly collapse = output<TreeExpansionEvent<T>>();
  readonly selectionChange = output<TreeSelectionEvent<T>>();
  readonly click = output<TreeNodeEvent<T>>();
  readonly doubleClick = output<TreeNodeEvent<T>>();
  readonly contextMenu = output<TreeNodeEvent<T>>();
  readonly dragStart = output<TreeDragEvent<T>>();
  readonly dragEnd = output<TreeDragEndEvent<T>>();
  readonly deleteNode = output<TreeDropEvent<T>>();
  readonly addNode = output<TreeAddEvent<T>>();
  readonly loadChildren = output<TreeLoadChildrenEvent<T>>();
  readonly dataChange = output<T[]>();

  // ---------------- 内部状态 ----------------
  private optsSignal = signal<NormalizedTreeOptions<T>>(normalizeOptions<T>(undefined));
  /**
   * 数据版本号：组件承诺「原地修改数据、不改数组引用」，原地变更无法被
   * 信号依赖感知，因此每次数据变更后递增该版本号，使依赖数据的 computed
   * 失效重算。外部整体替换数据数组（引用变化）时无需版本号即可触发重算。
   */
  private readonly dataVersion = signal(0);
  /**
   * 展开集合：外部输入（`expandedIds`）为源，内部可写（linkedSignal）。
   * 源变化时按内容比较重算——内容相同则沿用旧引用，避免无谓的整树重算。
   */
  private readonly expandedIds = linkedSignal<Iterable<TreeKey> | null, ReadonlySet<TreeKey>>({
    source: () => this.expandedIdsInput(),
    computation: (src, prev) => (prev && sameKeySet(prev.value, src) ? prev.value : toKeySet(src)),
  });
  private readonly selectedIds = linkedSignal<Iterable<TreeKey> | null, ReadonlySet<TreeKey>>({
    source: () => this.selectedIdsInput(),
    computation: (src, prev) => (prev && sameKeySet(prev.value, src) ? prev.value : toKeySet(src)),
  });
  private readonly checkedIds = linkedSignal<Iterable<TreeKey> | null, ReadonlySet<TreeKey>>({
    source: () => this.checkedIdsInput(),
    computation: (src, prev) => (prev && sameKeySet(prev.value, src) ? prev.value : toKeySet(src)),
  });
  private focusId = signal<TreeKey | null>(null);
  private filterKw = signal('');
  private lazyRequested = signal<ReadonlySet<TreeKey>>(new Set());
  private asyncLeaves = signal<ReadonlySet<TreeKey>>(new Set());
  private loadingIds = signal<ReadonlySet<TreeKey>>(new Set());

  /**
   * 状态门面：把「按 id 的集合状态」收敛为统一读写入口
   * （`getState` / `setState` / `hasState` / `mutateState`）。
   *
   * 组件内部与行上的 {@link TreeNode} 视图都经它读写状态；使用方也可直接读/写。
   * 注意：绕过事件路径直接写状态不会发出 `expand` / `selectionChange` 等事件，
   * 也不会回写数据源——需要事件与快照请走公开方法（`expandNode` / `selectNode` …）。
   */
  readonly treeState: TreeStateStore = createTreeStateStore({
    expanded: this.expandedIds,
    selected: this.selectedIds,
    checked: this.checkedIds,
    loading: this.loadingIds,
    lazyRequested: this.lazyRequested,
    asyncLeaves: this.asyncLeaves,
  });

  constructor() {
    // 受控回写：内部写集合后同步给 [(expandedIds)] / [(selectedIds)] / [(checkedIds)]。
    // 未绑定（输入 null 且内部为空）或内容一致时立即返回——不拷贝、不惊动外部。
    effect(() => {
      const expanded = this.expandedIds();
      if (!sameKeySet(expanded, this.expandedIdsInput())) this.expandedIdsInput.set([...expanded]);
    });
    effect(() => {
      const selected = this.selectedIds();
      if (!sameKeySet(selected, this.selectedIdsInput())) this.selectedIdsInput.set([...selected]);
    });
    effect(() => {
      const checked = this.checkedIds();
      if (!sameKeySet(checked, this.checkedIdsInput())) this.checkedIdsInput.set([...checked]);
    });
  }

  /** CDK Overlay：承载右键菜单浮层（层级、外部点击关闭、视口边界翻转都交给它） */
  private readonly overlay = inject(Overlay);
  /** 注入环境（供 tree.drag.ts 控制器动态创建自定义幽灵组件） */
  private readonly envInjector = inject(EnvironmentInjector);
  /** 跨树拖拽注册表（供 tree.drag.ts 控制器在多棵树间广播坐标/会话） */
  private readonly dragRegistry = inject(TreeDragRegistry);

  private cdkControlInstance: FlatTreeControl<Row<T>, TreeKey> | null = null;
  /** 树滚动容器（#treeRoot）DOM 引用 */
  private readonly viewRoot = viewChild<ElementRef<HTMLElement>>('treeRoot');

  // ---------------- 派生 ----------------
  /**
   * 定位索引：把当前数据一次性展开为 id → 条目的映射（数据数组引用变化或
   * 数据版本号递增时重建）。
   * 组件内所有按 id 的定位（节点查询、id 集合取数据、状态裁剪、落点冲突校验）
   * 都走此索引，避免一次交互中反复全树递归扫描。
   */
  private readonly nodeIndex = computed<TreeIndex<T>>(() => {
    void this.dataVersion(); // 原地数据变更（引用不变）也触发重建
    return TreeIndex.build(this.rawNodes(), this.optsSignal());
  });

  /**
   * 关键字过滤是否生效。过滤视图下分支显隐由过滤逻辑接管（命中的分支被强制展开呈现），
   * 交互式折叠因此不可用（见 {@link onToggleExpand}）。
   */
  private readonly filterActive = computed(() => this.filterKw().trim().length > 0);

  /**
   * 当前过滤关键字（行渲染用于命中词高亮）。未过滤时为空串。
   * @see TreeOptions.highlightMode
   */
  readonly filterKeyword = this.filterKw.asReadonly();

  /**
   * 过滤视图是否处于「只展示命中节点自身」模式（`TreeOptions.autoShow: false`）。
   * 该视图是扁平结果集：祖先路径不出现、行不可展开（不显示箭头、不触发懒加载）。
   * 模板据此挂 `is-filter-flat` 类，供样式层定制（如压平缩进）。
   */
  readonly filterFlatMode = computed(() => this.filterActive() && !this.optsSignal().autoShow);

  /**
   * 是否处于「只高亮匹配词」模式（`highlightMode: 'keyword'`，默认）：
   * 模板据此在树根挂 `is-keyword-highlight` 类，供样式层区分两套命中视觉
   * （整标签高亮 vs 仅命中片段），同时不影响 `is-match` / `is-child-match` 这些公开钩子。
   */
  readonly keywordHighlightMode = computed(() => this.optsSignal().highlightMode !== 'label');

  /**
   * 展开动画是否生效（`TreeOptions.animate`，默认开启）：首屏渲染完成后才启用，
   * 使进入动画只出现在后续新增的行上（展开 / 过滤 / 数据变化），首屏整树不播放。
   */
  readonly animateEnabled = computed(() => this.optsSignal().animate && this.animateReady());

  /** 首屏渲染已完成（ngAfterViewInit 时置位：此前的行是初始行，不播放进入动画） */
  private readonly animateReady = signal(false);

  /**
   * 结构层：仅依据树结构/展开/过滤等“结构状态”生成可见行（不含装饰字段）。
   * 结构状态未变化时该 computed 返回同一数组引用，供装饰层做增量合并。
   * **不读取选中/勾选/焦点集合**：这三者是纯装饰态（结构行里只作占位），
   * 把它排除在依赖外后，选中/勾选变化不会触发整树重新扁平化。
   */
  private structureRows = computed<Row<T>[]>(() => {
    void this.dataVersion(); // 原地数据变更（引用不变）也触发重算
    const opts = this.optsSignal();
    return flattenStructure<T>({
      options: opts,
      roots: this.rawNodes(),
      expanded: this.expandedIds(),
      keyword: this.filterKw(),
      asyncLeaves: this.asyncLeaves(),
      isLazyNode: opts.isLazyNode,
    });
  });

  /**
   * 复选框子树统计缓存：仅当勾选集合/数据/选项/过滤状态变化时重算。
   * 展开/折叠、选中、焦点变化不会触发整树统计。
   * `useTriState` 关闭时父子互不派生，无需统计（此时勾选集合直接决定各节点自身状态）。
   */
  private checkStats = computed<Map<TreeKey, CheckStats> | null>(() => {
    const opts = this.optsSignal();
    if (!opts.useCheckbox || !opts.useTriState) return null;
    if (this.filterKw().trim()) return null; // 过滤模式下复选框隐藏，无需统计
    void this.dataVersion(); // 原地数据变更（引用不变）也触发重算
    return buildCheckStats(this.rawNodes(), opts, this.checkedIds());
  });

  /**
   * 定点更新（`updateRow`）的行版本号：id → 递增序号。
   * 只改展示字段时不动数据版本号（不重建整棵树），靠它让命中行换一次对象即可重新渲染。
   */
  private readonly rowPatchVersions = signal<ReadonlyMap<TreeKey, number>>(EMPTY_ROW_PATCHES);

  /**
   * 装饰层缓存：记录最近一次输出及其对应的结构行引用，用于稳定行对象身份；
   * `patches` 记录本轮已消费的行版本号（版本号变化 ⇒ 该行强制换新对象）。
   */
  private rowsCache: {
    structure: Row<T>[];
    rows: Row<T>[];
    patches: ReadonlyMap<TreeKey, number>;
  } | null = null;

  /**
   * 装饰层：在结构层之上做轻量增量合并。
   * 选中/焦点/勾选等“装饰状态”变化时，仅重建受影响的行的对象；
   * 其余行对象引用保持稳定，CDK Tree 依据 trackBy 复用而不重建节点，
   * 配合节点组件 OnPush 可显著降低装饰状态高频变化时的渲染成本。
   *
   * 同时为每行挂载轻量 {@link TreeNode} 视图（`row.node`）：视图只持有
   * `data / parent / depth / index` 等定位信息，状态经 {@link treeState} 实时读取，
   * 因此状态变化不需要重建视图；结构未变时视图引用同样保持稳定。
   */
  private rows = computed<Row<T>[]>(() => {
    const opts = this.optsSignal();
    const filterActive = this.filterActive();
    const stats = filterActive ? null : this.checkStats();
    // 复选框可见时才读取勾选集合：三态模式用于派生叶子状态，非三态模式直接决定各节点状态；
    // 未启用复选框或过滤期间（复选框隐藏）不建立多余依赖
    const checkedLeaves =
      opts.useCheckbox && !filterActive ? this.checkedIds() : EMPTY_KEY_SET;
    const structure = this.structureRows();
    const decoInput: RowDecorationInput<T> = {
      options: opts,
      selected: this.selectedIds(),
      checkedLeaves,
      activeId: this.focusId(),
      stats,
      filterActive,
    };

    const patches = this.rowPatchVersions();
    const cache = this.rowsCache;
    const structureChanged = !cache || cache.structure !== structure;
    const out = new Array<Row<T>>(structure.length);
    // 先序保证父级行先于子级行出现，故 node.parent 可在同一次顺序扫描内解析
    const nodes = new Map<TreeKey, TreeNode<T>>();
    for (let i = 0; i < structure.length; i++) {
      const base = structure[i];
      const deco = resolveRowDecoration<T>(base.id, decoInput);
      const prev = !structureChanged ? cache!.rows[i] : undefined;
      // 定点更新（updateRow）过的行：结构虽未变，也要换对象才能重新渲染该行
      const rowPatched = !!prev && patches.get(base.id) !== cache!.patches.get(base.id);
      let row: Row<T>;
      if (
        prev &&
        !rowPatched &&
        prev.id === base.id &&
        prev.selected === deco.selected &&
        prev.active === deco.active &&
        prev.checkboxState === deco.checkboxState
      ) {
        row = prev;
      } else {
        row = {
          ...base,
          ...deco,
          // 结构未变时复用上一轮视图（引用稳定，装饰变化不惊动节点视图）
          node:
            prev?.node ??
            new TreeNode<T>(
              base.data,
              base.id,
              base.parentId === null ? null : (nodes.get(base.parentId) ?? null),
              base.depth,
              base.indexInParent,
              this.treeState,
            ),
        };
      }
      if (row.node && !nodes.has(row.id)) nodes.set(row.id, row.node); // 与索引一致：重复 id 取首个
      out[i] = row;
    }
    this.rowsCache = { structure, rows: out, patches };
    return out;
  });

  /** 可见行按 id 的查找表（随 rows 变化一次性重建） */
  private readonly rowMap = computed<Map<TreeKey, Row<T>>>(() => {
    const map = new Map<TreeKey, Row<T>>();
    for (const row of this.rows()) {
      if (!map.has(row.id)) map.set(row.id, row); // 与原 find 语义一致：重复 id 取首个
    }
    return map;
  });

  readonly dataSource = computed(() => new ArrayDataSource(this.rows()));
  readonly cdkControl = computed<FlatTreeControl<Row<T>, TreeKey>>(() => {
    if (!this.cdkControlInstance) {
      this.cdkControlInstance = new FlatTreeControl<Row<T>, TreeKey>(
        (r) => r.depth,
        (r) => r.expanderVisible, // 与渲染层同一判据：非叶子且当前视图可展开
        { trackBy: (r) => r.id },
      );
    }
    return this.cdkControlInstance;
  });

  readonly isEmpty = computed(() => this.rows().length === 0);
  readonly treeRows = computed(() => this.rows());
  readonly rowCount = computed(() => this.rows().length);

  readonly trackByRow = (index: number, row: Row<T>): TreeKey => row.id;
  readonly rowExpansionKey = (row: Row<T>): TreeKey => row.id;

  /** 可投影模板集合：通过 contentChild 收集后传给行节点渲染 */
  readonly templates = computed<TreeTemplates<T>>(() => ({
    loadingTemplate: this.loadingRef(),
    treeNodeTemplate: this.treeNodeRef(),
  }));

  /** 当前规范化 options（供外部模板/调试） */
  get opts(): NormalizedTreeOptions<T> {
    return this.optsSignal();
  }

  // ---------------- 输入同步 / 数据同步 ----------------

  /** 当前生效的原始数据输入（nodes 未提供时退化为共享空数组） */
  private rawNodes(): T[] {
    return this.nodes() ?? EMPTY_DATA;
  }

  /**
   * 首屏渲染已完成：此后新增的行才带进入动画（见 {@link animateEnabled}）。
   */
  ngAfterViewInit(): void {
    this.animateReady.set(true);
  }

  /**
   * 输入变化时对齐视图与状态。视图重算由信号依赖自动驱动
   * （数据数组引用变化 → 依赖失效；原地修改 → 数据版本号递增），
   * 这里只负责 options 规范化与「初始状态字段」/状态裁剪的记账同步。
   */
  ngOnChanges(): void {
    const optsChanged = !sameOptionsInput(this.rawOptions, this.appliedOptions);
    const dataChanged = this.rawNodes() !== this.appliedRawData;
    if (!optsChanged && !dataChanged) return;
    if (optsChanged) {
      this.optsSignal.set(normalizeOptions<T>(this.rawOptions)); // 字段映射变化需重映射视图
      this.appliedOptions = this.rawOptions;
    }
    if (dataChanged) this.appliedRawData = this.rawNodes();
    this.applyNodeStateFlags();
    this.pruneState();
  }

  /**
   * 数据变更后的统一提交（signal 驱动自动重渲染）。
   * 数据为原地修改：各公共方法/懒加载在改动数据后调用 {@link bumpDataVersion}
   * 使视图失效；本方法负责强制物化一次行视图，并按需发出 `dataChange` 与写回
   * nodes 模型（载荷与数据源为同一引用，回写不会触发视图重算）。
   *
   * @param emitData 是否发出 `dataChange` 并回写 nodes 模型
   * @param prune 是否裁剪状态集合：**仅当本次操作可能移除了节点**时才需要为 true
   *   （删除、外部整体替换数据）。移动 / 插入 / 懒加载落位不会让已有 id 失效，
   *   跳过可省下一次 O(n) 的定位索引重建与状态集合遍历（索引会在下次按 id 查询时按需重建）。
   */
  private commit(emitData: boolean, prune = false): void {
    void this.rows();
    if (prune) this.pruneState();
    if (!emitData) return;
    const current = this.rawNodes();
    this.appliedRawData = current;
    this.nodes.set(current);
    this.dataChange.emit(current);
  }

  /** 数据已原地修改后调用：递增数据版本号，使依赖数据的 computed 失效重算（引用不变也生效） */
  private bumpDataVersion(): void {
    this.dataVersion.update((v) => v + 1);
  }

  /**
   * 定点更新已落地后调用：递增该 id 的行版本号。
   * 与 {@link bumpDataVersion} 的区别：只让 `rows` 重建这一行，结构层与其它行对象保持不变。
   */
  private bumpRowPatch(id: TreeKey): void {
    this.rowPatchVersions.update((m) => {
      const next = new Map(m);
      next.set(id, (next.get(id) ?? 0) + 1);
      return next;
    });
  }

  private optsOf(): NormalizedTreeOptions<T> {
    return this.optsSignal();
  }

  /**
   * 状态裁剪：剔除树中已不存在的 id。
   * 存在性判定走定位索引（O(1)），整体由 O(n + 状态数) 降为 O(状态数)。
   *
   * 只在「可能有节点被移除」时调用：删除，以及外部整体替换数据（{@link ngOnChanges}）
   * 或手动 {@link refresh}。移动 / 插入 / 懒加载落位不会让已有 id 失效，无需裁剪
   * —— 跳过它们可省下一次完整的定位索引重建（见 {@link commit} 的 `prune` 参数）。
   */
  private pruneState(): void {
    const nodeIndex = this.nodeIndex();
    const slim = (s: ReadonlySet<TreeKey>): ReadonlySet<TreeKey> => {
      let changed = false;
      const out = new Set<TreeKey>();
      for (const k of s) {
        if (nodeIndex.has(k)) out.add(k);
        else changed = true;
      }
      return changed ? out : s;
    };
    this.expandedIds.set(slim(this.expandedIds()));
    this.selectedIds.set(slim(this.selectedIds()));
    this.checkedIds.set(slim(this.checkedIds()));
    const loading = slim(this.loadingIds());
    this.loadingIds.set(loading);
    const lazyReq = slim(this.lazyRequested());
    this.lazyRequested.set(lazyReq);
    const leaves = slim(this.asyncLeaves());
    this.asyncLeaves.set(leaves);
    // 初始状态字段的记账：节点已被移除时一并清除，节点再次出现即可重新应用
    for (const id of this.expandedFlagApplied) {
      if (!nodeIndex.has(id)) this.expandedFlagApplied.delete(id);
    }
    for (const id of this.selectedFlagApplied) {
      if (!nodeIndex.has(id)) this.selectedFlagApplied.delete(id);
    }
    const focus = this.focusId();
    if (focus !== null && !nodeIndex.has(focus)) {
      this.focusId.set(null);
    }
  }

  /**
   * 应用数据里的「初始状态」字段标记：`isExpandedField`（默认 `'expanded'`）为真的节点
   * 并入展开集合，`isSelectedField`（默认 `'select'`）为真的节点并入选中集合。
   *
   * 每个节点只应用一次（按 id 记账，节点被移除后记账一并清除），因此：
   * 数据首次就绪、懒加载分支的子级加载完成时都会生效，而之后的数据刷新不会重复应用，
   * 也不会覆盖用户随后的展开/折叠与选择。
   *
   * 只并入、不覆盖，并且只写状态集合——不发 `expand` / `selectionChange`，也不回写数据源。
   * 例外：子级尚未加载的懒加载分支（{@link NormalizedTreeOptions.isLazyNode} 为真且无已加载子节点）
   * 标记展开后会真正发起一次加载，否则只会是「箭头朝下但没有子行」的空壳；
   * 该次加载与交互式展开同路径（见 {@link loadChildrenFor}），因此会发出
   * `expand` / `loadChildren` 并回写数据源。
   */
  private applyNodeStateFlags(): void {
    const opts = this.optsOf();
    const selectedOrigin = opts.useCheckbox?this.checkedIds:this.selectedIds;
    const expanded = new Set(this.expandedIds());
    const selected = new Set(selectedOrigin());
    /** 本次新标记展开、但子级尚未加载的懒加载分支（待真正拉取子级） */
    const pendingLoad: TreeKey[] = [];
    let expandedChanged = false;
    let selectedChanged = false;
    for (const { id, node } of this.nodeIndex().entries()) {
      const data = node as Record<string, unknown>;
      if (!this.expandedFlagApplied.has(id) && data[opts.isExpandedField]) {
        this.expandedFlagApplied.add(id);
        if (!expanded.has(id)) {
          expanded.add(id);
          expandedChanged = true;
        }
        // 懒加载未解析分支：仅并入展开集合不会产生子行，需真正发起加载
        if (!Array.isArray(opts.getChildren(node)) && !this.asyncLeaves().has(id) && opts.isLazyNode(node)) {
          pendingLoad.push(id);
        }
      }
      if (!this.selectedFlagApplied.has(id) && data[opts.isSelectedField]) {
        this.selectedFlagApplied.add(id);
        if (!selected.has(id)) {
          selected.add(id);
          selectedChanged = true;
        }
      }
    }
    if (expandedChanged) this.expandedIds.set(expanded);
    if (selectedChanged) selectedOrigin.set(selected);
    // 发起加载放在状态落定之后：加载完成后会再应用一次本方法（子级里的标记随之生效）
    for (const id of pendingLoad) {
      const node = this.findById(id);
      if (node !== null && !this.lazyRequested().has(id)) void this.loadChildrenForId(id, node);
    }
  }

  /** 按 id 取当前数据节点（O(1)） */
  private findById(id: TreeKey): T | null {
    return this.nodeIndex().node(id);
  }

  /** 按 id 取当前可见行（O(1)） */
  private rowById(id: TreeKey): Row<T> | undefined {
    return this.rowMap().get(id);
  }

  /** 由 id 集合取回节点数据，顺序与 walkNodes 先序一致（复用定位索引一次展开） */
  private nodesFromIds(ids: TreeKey[]): T[] {
    return this.nodeIndex().pick(ids);
  }

  // ==================== 行渲染绑定 ====================

  isLoading(row: Row<T>): boolean {
    return this.loadingIds().has(row.id);
  }

  /** 是否处于拖拽中（树根样式用；实现见 tree.drag.ts 控制器） */
  dragDropActive(): boolean {
    return this.dragCtrl.active();
  }

  /** 是否正被其它树的拖拽悬停（跨树接收高亮用；实现见 tree.drag.ts 控制器） */
  externalDropTargetActive(): boolean {
    return this.dragCtrl.externalActive();
  }

  /** 模板直接使用的行 API 对象（拖拽方法转交由 tree.drag.ts 控制器实现） */
  readonly rowApi: TreeRowApi<T> = {
    isDraggable: (row) => this.dragCtrl.isDraggable(row),
    isRowCollapsible: (row) => this.isRowCollapsible(row),
    onToggleExpand: (row) => this.onToggleExpand(row),
    onClick: (row, event) => this.onClick(row, event),
    onDoubleClick: (row, event) => this.onDoubleClick(row, event),
    onContextMenu: (row, event) => this.onContextMenu(row, event),
    onCheckboxChange: (row) => this.onCheckboxChange(row),
    onDelete: (row) => this.onDelete(row),
    isLoading: (row) => this.isLoading(row),
    dragDropActive: () => this.dragCtrl.active(),
    isDragging: (row) => this.dragCtrl.isDragging(row.id),
    onDragStart: (row, element) => this.dragCtrl.onDragStart(row, element),
    onDragMoved: (row, info) => this.dragCtrl.onDragMoved(row, info),
    onDragEnd: (row) => this.dragCtrl.onDragEnd(row),
    dragMarker: (row) => this.dragCtrl.markerFor(row.id),
    animateEntering: () => this.animateEnabled(),
  };

  // ==================== 拖拽（委托 tree.drag.ts） ====================

  /** 向拖拽控制器暴露树内部状态/能力的宿主适配 */
  private readonly dragHost = this.createDragHost();

  /** 构造拖拽宿主适配（用方法+闭包捕获组件 this，避免对象字面量 getter 丢失实例上下文） */
  private createDragHost(): TreeDragHost<T> {
    const tree = this;
    return {
      get rows() {
        return tree.rows();
      },
      get opts() {
        return tree.optsSignal();
      },
      readData: () => this.rawNodes(),
      readExpanded: () => this.expandedIds(),
      writeExpanded: (v) => this.expandedIds.set(v),
      readSelected: () => this.selectedIds(),
      dataOf: (ids) => this.nodesFromIds(ids),
      findById: (id) => this.findById(id),
      rowById: (id) => this.rowById(id),
      hasAnyId: (ids) => this.hasAnyId(ids),
      rootElement: () => this.viewRoot()?.nativeElement,
      ghostTemplate: () => this.dragGhostTemplateRef(),
      rowApi: this.rowApi,
      instance: tree,
      emitDragStart: (e) => this.dragStart.emit(e),
      emitDragEnd: (e) => this.dragEnd.emit(e),
    };
  }

  /** 拖拽控制器：承载拖拽状态 / 幽灵 / 落点与放置落位的全部逻辑 */
  private readonly dragCtrl = new TreeDragController<T>(this.dragHost, this.envInjector, this.dragRegistry);

  // ==================== 右键菜单（委托 tree.context-menu.ts） ====================

  /** 向菜单控制器暴露树内部状态/能力的宿主适配 */
  private readonly menuHost = this.createMenuHost();

  /** 右键菜单控制器：承载菜单浮层的创建 / 定位 / 关闭（内容由 #contextMenuTemplate 决定） */
  private readonly menuCtrl = new TreeContextMenuController<T>(
    this.menuHost,
    this.envInjector,
    this.overlay,
  );

  /** 右键菜单是否已打开（只读；可用于外部联动，如状态栏提示） */
  readonly contextMenuOpen = this.menuCtrl.open;

  /** 构造菜单宿主适配（用方法+闭包捕获组件 this，避免对象字面量 getter 丢失实例上下文） */
  private createMenuHost(): TreeContextMenuHost<T> {
    const tree = this;
    return {
      get opts() {
        return tree.optsSignal();
      },
      rowById: (id) => this.rowById(id),
      emitContextMenu: (e) => this.contextMenu.emit(e),
      menuTemplate: () => this.contextMenuTemplateRef(),
      rootElement: () => this.viewRoot()?.nativeElement,
      rowApi: this.rowApi,
    };
  }

  // ==================== 落点解析（纯计算）与执行（原地改数据） ====================

  /**
   * 每个会改动数据的动作都拆成两步，便于「受控」与「非受控」两种用法：
   * - `resolveXxx()`：**纯计算**——只做校验与落点归一化，返回计划，
   *   不改动数据、不触发视图、不发事件；
   * - `applyXxx(plan)`：按计划原地改数据、递增版本号、发出 `dataChange`。
   *
   * - 非受控（默认）：直接调组合版 `moveNodes` / `copyNodes` / `addNodes` / `removeNodes`，
   *   内部即 `resolve` + `apply`；
   * - 受控（数据归自己管）：只调 `resolveXxx()` 拿计划，自己改数据源
   *   （落位后按需 `refresh()`），**不要再调 `applyXxx`**，否则会重复落位。
   */

  /**
   * 解析「移动」落点：校验节点存在、目标行可见、落点不在被移动子树内。
   *
   * @returns 落点计划；任一校验不通过返回 `null`（数据保持不变）
   */
  resolveMove(
    ids: TreeKey[],
    targetRowId: TreeKey | null = null,
    position: DropPosition = 'after',
  ): TreeMovePlan | null {
    const list = [...new Set(ids)];
    if (!list.length) return null;
    const slot = resolveTargetSlot(this.rows(), targetRowId, position);
    if (!slot) return null;
    for (const id of list) {
      if (this.findById(id) === null) return null;
    }
    // 防止把节点移入自己的后代（会造成循环引用）
    if (slot.parentId !== null && this.insideMovedTrees(list, slot.parentId)) return null;
    return { ids: list, parentId: slot.parentId, anchor: slot.anchor, position, targetRowId };
  }

  /** 按 {@link TreeMovePlan} 执行移动（原地改数据；落点父级自动展开；发出 dataChange） */
  applyMove(plan: TreeMovePlan): boolean {
    if (!plan.ids.length) return false;
    moveNodes(this.rawNodes(), this.optsOf(), plan.ids, plan.parentId, plan.anchor);
    this.bumpDataVersion();
    this.expandParentAfterPlace(plan.parentId);
    this.commit(true);
    return true;
  }

  /**
   * 程序化「移动」：把本树内 ids 对应节点（含各自子树）移动到指定落点。
   * 库的拖拽本身不会改动数据——在 (dragEnd) 事件中按载荷拿到有效落点后，
   * 调用本方法即可完成一次树内重排。成功后发出 `dataChange`。
   *
   * 等价于 `resolveMove(...)` + `applyMove(...)`；需要自己管数据时请改用前者。
   *
   * @param targetRowId 目标行 id（需为当前可见行）；null 表示根级末尾
   * @param position    方位：before 插到目标之前 / after 插到目标之后 / child 作为目标的子节点（追加末尾）
   * @returns 是否实际执行。节点不存在、目标行不可见、落点位于被移动子树内等返回 false
   */
  moveNodes(ids: TreeKey[], targetRowId: TreeKey | null = null, position: DropPosition = 'after'): boolean {
    const plan = this.resolveMove(ids, targetRowId, position);
    return plan === null ? false : this.applyMove(plan);
  }

  /**
   * 解析「复制」落点：校验目标行可见、载荷子树与本树无 id 冲突。
   *
   * @returns 落点计划；校验不通过返回 `null`（数据保持不变）
   */
  resolveCopy(
    nodes: T[],
    targetRowId: TreeKey | null = null,
    position: DropPosition = 'after',
  ): TreeCopyPlan<T> | null {
    if (!nodes.length) return null;
    const slot = resolveTargetSlot(this.rows(), targetRowId, position);
    if (!slot) return null;
    if (this.payloadConflicts(nodes)) return null;
    return { nodes, parentId: slot.parentId, anchor: slot.anchor, position, targetRowId };
  }

  /** 按 {@link TreeCopyPlan} 执行复制（载荷深克隆后原地插入；落点父级自动展开；发出 dataChange） */
  applyCopy(plan: TreeCopyPlan<T>): boolean {
    if (!plan.nodes.length) return false;
    insertNodesTo(this.rawNodes(), this.optsOf(), plan.nodes, plan.parentId, plan.anchor);
    this.bumpDataVersion();
    this.expandParentAfterPlace(plan.parentId);
    this.commit(true);
    return true;
  }

  /**
   * 程序化「复制」：把外部数据节点（会被深克隆，不共享引用）插入本树指定落点，
   * 用于“把别处数据/另一棵树的数据复制进本树”。跨树拖拽的 (dragEnd) 载荷里
   * 会给出接收树实例（drop.targetTree），需要跨树 move/copy 时即调用其
   * copyNodes 把被拖节点插入目标树（move 再补一次 sourceTree.removeNodes）。
   * 成功后发出 `dataChange`。
   *
   * 本树中已存在载荷子树任意 id 时自动拒绝（防止键冲突）：跨树复制天然不冲突；
   * 如需“同树复制”，请先为载荷重新分配 id 再传入。
   *
   * 等价于 `resolveCopy(...)` + `applyCopy(...)`；需要自己管数据时请改用前者。
   *
   * @param targetRowId 目标行 id（需为当前可见行）；null 表示根级末尾
   * @param position    方位同 moveNodes
   * @returns 是否实际执行
   */
  copyNodes(nodes: T[], targetRowId: TreeKey | null = null, position: DropPosition = 'after'): boolean {
    const plan = this.resolveCopy(nodes, targetRowId, position);
    return plan === null ? false : this.applyCopy(plan);
  }

  /**
   * 解析「删除」：剔除不存在的 id，并给出将被移除的完整子树 id。
   *
   * @returns 删除计划；全部 id 均不存在时返回 `null`
   */
  resolveRemove(ids: TreeKey[]): TreeRemovePlan | null {
    const nodeIndex = this.nodeIndex();
    const hit = [...new Set(ids)].filter((id) => nodeIndex.has(id));
    if (!hit.length) return null;
    const opts = this.optsOf();
    const subtreeIds = new Set<TreeKey>();
    for (const id of hit) {
      const node = this.findById(id);
      if (node === null) continue;
      walkNodes([node], opts, (v) => {
        if (v.id !== null) subtreeIds.add(v.id);
      });
    }
    return { ids: hit, subtreeIds: [...subtreeIds] };
  }

  /** 按 {@link TreeRemovePlan} 执行删除（原地移除；两端状态集合一并裁剪） */
  applyRemove(plan: TreeRemovePlan): boolean {
    const { removed } = removeNodeIdsWithData(this.rawNodes(), this.optsOf(), plan.ids);
    if (!removed.length) return false;
    this.bumpDataVersion();
    this.commit(true, true); // 移除节点：需要裁剪已失效 id
    return true;
  }

  /**
   * 程序化「删除」：把 ids 对应节点（含各自子树）从本树移除，成功后发出 dataChange。
   * 供事件驱动流程使用：例如跨树“移动”= 目标树 copyNodes + 源树 removeNodes，
   * 在 (dragEnd) 中按载荷决定语义后自行编排。
   *
   * 等价于 `resolveRemove(...)` + `applyRemove(...)`；需要自己管数据时请改用前者。
   *
   * @returns 是否实际删除（全部 id 均不存在时返回 false）
   */
  removeNodes(ids: TreeKey[]): boolean {
    const plan = this.resolveRemove(ids);
    return plan === null ? false : this.applyRemove(plan);
  }

  /**
   * 解析「新增」：校验载荷非空、每个节点都有 id、与本树无键冲突、父级存在。
   *
   * @returns 落点计划；任一校验不通过返回 `null`（数据保持不变）
   */
  resolveAdd(
    nodes: T[],
    parentId: TreeKey | null = null,
    position: 'first' | 'end' | TreeKey = 'end',
  ): TreeAddPlan<T> | null {
    if (!nodes.length) return null;
    const ids = this.idsOfNodes(nodes);
    if (ids.length !== nodes.length) return null; // 存在缺 id 的节点
    const nodeIndex = this.nodeIndex();
    if (ids.some((id) => nodeIndex.has(id))) return null; // 键冲突
    if (parentId !== null && this.findById(parentId) === null) return null; // 父级不存在
    return { nodes, parentId, position };
  }

  /** 按 {@link TreeAddPlan} 执行新增（载荷深克隆后原地插入；落点父级自动展开） */
  applyAdd(plan: TreeAddPlan<T>): boolean {
    if (!plan.nodes.length) return false;
    insertNodesBatch(this.rawNodes(), this.optsOf(), plan.parentId, plan.nodes, plan.position);
    this.bumpDataVersion();
    this.expandParentAfterPlace(plan.parentId);
    this.commit(true);
    return true;
  }

  /**
   * 把一组节点插入到本树指定位置。
   *
   * 前置校验（任一不满足返回 false，数据不变）：
   * - 载荷非空，且每个节点都能按 `idField` 取到 id；
   * - 载荷 id 与本树现有 id 不冲突（键冲突会破坏 trackBy 与定位索引）；
   * - `parentId` 非空时，父节点在本树中存在。
   *
   * 落位后会自动展开落点父级，使新增节点立即可见。
   *
   * 等价于 `resolveAdd(...)` + `applyAdd(...)`；需要自己管数据时请改用前者。
   *
   * @param nodes      待新增节点（按顺序插入）
   * @param parentId   落点父级 id；null 表示根级
   * @param position   'first' 容器开头 / 'end' 容器末尾（默认）/ 某个兄弟 id（插到其之前）
   * @returns 是否实际插入
   */
  addNodes(nodes: T[], parentId: TreeKey | null = null, position: 'first' | 'end' | TreeKey = 'end'): boolean {
    const plan = this.resolveAdd(nodes, parentId, position);
    return plan === null ? false : this.applyAdd(plan);
  }

  /** 把落点父级加入展开集合（保持与拖拽落位一致：放入折叠容器时自动展开） */
  private expandParentAfterPlace(parentId: TreeKey | null): void {
    if (parentId === null || this.expandedIds().has(parentId)) return;
    this.expandedIds.set(new Set([...this.expandedIds(), parentId]));
  }

  /** candidate 是否落在 ids 任一节点的子树内（防止把节点挪进自身后代）；走索引 O(depth) */
  private insideMovedTrees(ids: TreeKey[], candidate: TreeKey): boolean {
    const nodeIndex = this.nodeIndex();
    for (const id of ids) {
      if (nodeIndex.isDescendantOf(id, candidate)) return true;
    }
    return false;
  }

  /** ids 中是否存在任一 id 落在当前数据内（跨树落点冲突校验，O(ids)） */
  private hasAnyId(ids: readonly TreeKey[]): boolean {
    const nodeIndex = this.nodeIndex();
    for (const id of ids) {
      if (nodeIndex.has(id)) return true;
    }
    return false;
  }

  /** 载荷子树与本树是否存在 id 冲突（键冲突会破坏 trackBy） */
  private payloadConflicts(nodes: T[]): boolean {
    const opts = this.optsOf();
    const nodeIndex = this.nodeIndex();
    let exists = false;
    // 只需遍历载荷（通常很小），本树一侧走索引 O(1) 判定
    walkNodes(nodes, opts, (v) => {
      if (!exists && v.id !== null && nodeIndex.has(v.id)) exists = true;
    });
    return exists;
  }

  // ==================== 展开 / 折叠 ====================

  /**
   * 切换行的展开/折叠。以“展开集合（expandedIds）是否含该行”为依据，
   * 与箭头是否可见（叶子不显示箭头）等 UI 展示条件无关——调用即切换：
   * - 过滤生效时：被过滤强制展开的分支（row.expanded 为 true）**不响应折叠**，
   *   箭头只作状态指示（点击/键盘/`toggleNode` 静默忽略），展开态保持过滤前的原样；
   * - 当前展开 → 折叠；当前折叠 → 展开；
   * - 懒加载未解析节点展开时会先发起加载，加载成功/为空后再落定展开态
   *   （过滤态下同样可用：加载出的新命中节点会补进过滤视图）；
   *   **例外**：子级尚未到位的行即便已在集合里（`expandAll` 会写入待拉取分支的展开意图）
   *   也不走折叠，仍按“加载/展开”处理——没有可视展开态可收回；
   * - 对不可切换的行（普通叶子等）调用不产生副作用。
   */
  onToggleExpand(row: Row<T>): void {
    // 扁平结果集（autoShow: false）：行不可展开，交互一并忽略（否则只会污染用户的展开集合）
    if (this.filterFlatMode()) return;
    // 过滤视图下“展开”由过滤逻辑决定：折叠无意义（会与过滤结果冲突），直接忽略
    if (this.filterActive() && row.expanded) return;
    const opts = this.optsOf();
    const pendingLazy = row.needLazyLoad && opts.isLazyNode(row.data);
    if (!pendingLazy && this.expandedIds().has(row.id)) {
      this.collapseRow(row);
      return;
    }
    this.expandRow(row);
  }

  /** 展开单行：懒加载节点先请求；可展开对象直接写入展开集合并发出 expand */
  private expandRow(row: Row<T>): void {
    const opts = this.optsOf();
    const { id } = row;

    // 需要懒加载：先调用加载器，加载完成后由 apply 统一写入展开态并发出事件；
    // 已请求/加载中的节点静默忽略，避免重复请求。
    // 先于「是否已在集合中」判断：expandAll 会把待拉取分支写进集合，这类行点击必须还能走到加载。
    const needLoad = row.needLazyLoad && !this.lazyRequested().has(id) && opts.isLazyNode(row.data);
    if (needLoad) {
      void this.loadChildrenFor(row);
      return;
    }

    if (this.expandedIds().has(id)) return;

    // 父节点一律可切换展开态：叶子直接忽略；
    // 空目录（已拉取且确认为空）也在此列 —— 无子级可展示，但展开/折叠语义仍然成立且不重复请求
    if (row.isLeaf) return;

    this.expandedIds.set(new Set([...this.expandedIds(), id]));
    this.expand.emit({ node: row.data, nodeId: id, isExpanded: true });
  }

  /** 折叠单行：仅当行当前处于展开态（expandedIds 含 id）时生效 */
  private collapseRow(row: Row<T>): void {
    const { id } = row;
    if (!this.expandedIds().has(id)) return;
    const next = new Set(this.expandedIds());
    next.delete(id);
    this.expandedIds.set(next);
    this.collapse.emit({ node: row.data, nodeId: id, isExpanded: false });
  }

  /** 语义化判断：该行是否“可发起展开”——父节点（`!isLeaf`）即可，叶子不可 */
  private isRowExpandable(row: Row<T>): boolean {
    if (this.filterFlatMode()) return false; // 扁平结果集：不展示箭头，不可展开也不触发懒加载
    return !row.isLeaf;
  }

  /**
   * 语义化判断：该行当前是否“可被折叠”。
   * 需同时满足：行处于展开态、当前视图展示箭头（`expanderVisible`）、且过滤未生效
   * ——过滤视图下命中的分支被强制展开呈现，折叠不可用（键盘左键据此回退到父级）。
   */
  private isRowCollapsible(row: Row<T>): boolean {
    return row.expanded && row.expanderVisible && !this.filterActive();
  }

  /**
   * 语义化判断：该行当前是否“可勾选”。
   * 与渲染层同一判据——`checkboxState === 'hidden'`（未启用复选框、或过滤期间自动隐藏）
   * 即不可勾选，此时键盘 Space 退回行点击语义（见 tree.navigation.ts）。
   */
  private isRowCheckable(row: Row<T>): boolean {
    return row.checkboxState !== 'hidden';
  }

  // ==================== 点击 / 选择 ====================

  onClick(row: Row<T>, event: MouseEvent): void {
    // this.focusRow(row.id);
    this.click.emit({ node: row.data, nodeId: row.id, event });
    const meta = event.ctrlKey || event.metaKey;
    if (event.shiftKey) {
      this.selectRange(row);
    } else if (meta) {
      this.toggleSelect(row);
      this.focusRow(row.id);
    } else if (this.optsOf().selectOnClick && !this.optsOf().useCheckbox) {
      this.selectOnly(row);
      this.focusRow(row.id);
    }
  }

  onDoubleClick(row: Row<T>, event: MouseEvent): void {
    this.focusRow(row.id);
    this.doubleClick.emit({ node: row.data, nodeId: row.id, event });
  }

  /**
   * 右键：转发给菜单控制器（先照常发出 `(contextMenu)` 事件，再决定是否弹出菜单）。
   * 菜单内容完全由 `#contextMenuTemplate` 决定——未投影模板时不弹菜单，只发事件，
   * 由使用方自行处理；实现见 tree.context-menu.ts。
   */
  onContextMenu(row: Row<T>, event: MouseEvent): void {
    this.focusRow(row.id);
    this.menuCtrl.onRowContextMenu(row, event);
  }

  /**
   * 在指定位置打开右键菜单（等价于用户在该行上右键）。
   * 未传坐标时以该行左下角为锚点。
   *
   * @param nodeId 目标行 id（须为当前可见行）
   * @param position 视口坐标；缺省按行位置定位
   * @returns 目标不可用（非可见行 / 未投影 `#contextMenuTemplate` / 该节点的菜单被配置关闭）时返回 false
   */
  openContextMenu(nodeId: TreeKey, position?: { x: number; y: number }): boolean {
    return this.menuCtrl.openForRow(nodeId, position);
  }

  /** 关闭当前右键菜单（未打开时静默忽略；实现见 tree.context-menu.ts） */
  closeContextMenu(): void {
    this.menuCtrl.close();
  }

  onCheckboxChange(row: Row<T>): void {
    const opts = this.optsOf();
    const cur = this.checkedIds();
    const next = new Set(cur);
    if (opts.useTriState) {
      // 三态级联：以叶子为单元整组勾选 / 取消（父级状态由子树统计派生）
      const leaves = collectSubtreeIds(row.data, opts);
      if (!leaves.length) return;
      const allChecked = leaves.every((l) => cur.has(l));
      leaves.forEach((l) => (allChecked ? next.delete(l) : next.add(l)));
    } else {
      // 非三态：父子互不联动，只切换该节点自身
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
    }
    this.checkedIds.set(next);
    this.selectionChange.emit({
      selectedNodes: this.checkedNodesList(),
      node: row.data,
      nodeId: row.id,
    });
  }

  private selectOnly(row: Row<T>): void {
    this.selectedIds.set(new Set([row.id]));
    this.selectionChange.emit({
      selectedNodes: this.selectedNodesList(),
      node: row.data,
      nodeId: row.id,
    });
  }

  private toggleSelect(row: Row<T>): void {
    if (!this.optsOf().multiSelect) {
      this.selectOnly(row);
      return;
    }
    const next = new Set(this.selectedIds());
    if (next.has(row.id)) next.delete(row.id);
    else next.add(row.id);
    this.selectedIds.set(next);
    this.selectionChange.emit({
      selectedNodes: this.selectedNodesList(),
      node: row.data,
      nodeId: row.id,
    });
  }

  private selectRange(row: Row<T>): void {
    const rows = this.rows();
    if (!this.optsOf().multiSelect) {
      this.selectOnly(row);
      return;
    }

    const from = rows.findIndex((r) => r.id === this.focusId());
    const to = rows.findIndex((r) => r.id === row.id);
    const formNode = rows[from];
    if (from < 0 || to < 0 || formNode.parentId !== rows[to].parentId ) {
      this.focusRow(row.id);
      this.selectOnly(row);
      return;
    }
    const next = new Set<TreeKey>();
    const [s, e] = [Math.min(from, to), Math.max(from, to)];
    for (let i = s; i <= e; i++) {
      const row = rows[i];
      if(row.parentId === formNode.parentId){
        next.add(row.id)
      }
    };
    this.selectedIds.set(next);
    this.selectionChange.emit({
      selectedNodes: this.selectedNodesList(),
      node: row.data,
      nodeId: row.id,
    });
  }

  private focusRow(id: TreeKey | null): void {
    this.focusId.set(id);
  }

  // ==================== 懒加载 ====================

  private loadChildrenFor(row: Row<T>): Promise<void> {
    return this.loadChildrenForId(row.id, row.data);
  }

  /**
   * 同上，直接以 id + 节点数据发起加载。
   * 交互式展开（{@link expandRow}）与「初始展开」字段路径（{@link applyNodeStateFlags}）共用。
   */
  private loadChildrenForId(id: TreeKey, nodeData: T): Promise<void> {
    const opts = this.optsOf();
    const req = new Set(this.lazyRequested());
    req.add(id);
    this.lazyRequested.set(req);
    const loading = new Set(this.loadingIds());
    loading.add(id);
    this.loadingIds.set(loading);

    // 唯一的懒加载来源：全局 loadChildren（children 字段只是数据槽，其值不作来源）
    const source = opts.loadChildren ? opts.loadChildren(nodeData) : null;
    // 完成信号：子级来源可能是同步数组 / Promise / Observable，统一在 apply 落定后 resolve，
    // 供 expandAllRecursive 逐层等待（普通交互路径不关心该 Promise）
    let settle!: () => void;
    const done = new Promise<void>((resolve) => (settle = resolve));
    const apply = (children: T[] | null): void => {
      const load = new Set(this.loadingIds());
      load.delete(id);
      this.loadingIds.set(load);
      if (children && children.length) {
        attachResolvedChildren(this.rawNodes(), opts, id, children);
        this.bumpDataVersion();
        this.expandedIds.set(new Set([...this.expandedIds(), id]));
        // 新子级落位后再应用一次初始状态字段（子级里标记为展开/选中的节点随之生效）
        this.applyNodeStateFlags();
        this.expand.emit({ node: nodeData, nodeId: id, isExpanded: true });
      } else {
        // 空目录：记为「已拉取且无子级」（关闭 needLazyLoad、不再重复请求），
        // 但仍是父节点——保持展开视觉态，折叠展开按钮也得留着，用户才能把它收回去
        const leaves = new Set(this.asyncLeaves());
        leaves.add(id);
        this.asyncLeaves.set(leaves);
        const opened = new Set(this.expandedIds());
        opened.add(id);
        this.expandedIds.set(opened);
        this.expand.emit({ node: nodeData, nodeId: id, isExpanded: true });
      }
      this.loadChildren.emit({ node: nodeData, nodeId: id, children });
      this.commit(true);
      settle();
    };

    if (Array.isArray(source)) {
      apply(source);
    } else if (source instanceof Promise) {
      source.then((r) => apply(Array.isArray(r) ? r : null)).catch(() => apply(null));
    } else if (isAsyncObject(source)) {
      const sub = (source as { subscribe: (next: (v: unknown) => void, error: () => void) => unknown }).subscribe(
        (r: unknown) => apply(Array.isArray(r) ? (r as T[]) : null),
        () => apply(null),
      );
      void sub;
    } else {
      apply(null);
    }
    return done;
  }

  // ==================== 删 ====================

  onDelete(row: Row<T>): void {
    const opts = this.optsOf();
    if (opts.confirmDelete && !opts.confirmDelete([row.data])) return;
    const { removed } = removeNodeIdsWithData(this.rawNodes(), opts, [row.id]);
    this.bumpDataVersion();
    this.deleteNode.emit({ nodes: removed, parent: row.parentData, parentId: row.parentId, position: 'child' });
    this.commit(true, true); // 移除节点：需要裁剪已失效 id
  }

  // ==================== 拖拽 ====================
  // 拖拽运行逻辑（拖拽状态 / 幽灵 / 落点指示 / 放置落位）已拆至
  // tree.drag.ts 的 TreeDragController，组件经 rowApi 与 dragCtrl 转发。

  ngOnDestroy(): void {
    this.menuCtrl.dispose();
    this.dragCtrl.dispose();
  }

  // ==================== 键盘导航（委托 tree.navigation.ts） ====================

  /** 向键盘导航控制器暴露树状态与行为的宿主适配 */
  private readonly navHost = this.createNavigationHost();

  /** 键盘导航控制器：承载方向键/回车等焦点移动与树操作（实现见 tree.navigation.ts） */
  private readonly navCtrl = new TreeNavigationController<T>(this.navHost);

  /** 构造导航宿主适配（闭包捕获组件 this，避免对象字面量 getter 丢失实例上下文） */
  private createNavigationHost(): TreeNavigationHost<T> {
    const tree = this;
    return {
      get rows() {
        return tree.rows();
      },
      get focusId() {
        return tree.focusId();
      },
      setFocusId: (id) => tree.focusId.set(id),
      rootElement: () => tree.viewRoot()?.nativeElement,
      isRowExpandable: (row) => tree.isRowExpandable(row),
      isRowCollapsible: (row) => tree.isRowCollapsible(row),
      isRowCheckable: (row) => tree.isRowCheckable(row),
      toggleCheck: (row) => tree.onCheckboxChange(row),
      toggleExpand: (row) => tree.onToggleExpand(row),
      click: (row, event) => tree.onClick(row, event as MouseEvent),
      deleteRow: (row) => tree.onDelete(row),
    };
  }

  /** 树根键盘事件入口（模板 (keydown) 绑定），实现见 tree.navigation.ts 控制器 */
  onTreeKeydown(event: KeyboardEvent): void {
    this.navCtrl.onKeydown(event);
  }

  // ==================== 公开 API ====================

  /**
   * 展开全部**父节点**：有子数据的分支、`children` 为空数组的分支、尚未拉取的懒加载分支
   * 一律进入展开态；并对**当前已知的待拉取分支各补一层子级**（真正发起加载），
   * 加载出来的新分支只作为折叠状态下钻的起点，不再继续往下展开 —— 要一路展开到最深层
   * 请用 {@link expandAllRecursive}。返回 void：内部异步执行，不阻塞调用方。
   */
  expandAll(): void {
    // 先落位展开集合：这样 Rows 才会包含原本藏在折叠分支里的待拉取节点
    this.expandLoadedBranches();
    for (const row of this.pendingVisibleRows()) void this.loadChildrenFor(row);
  }

  /**
   * 递归展开：在 {@link expandAll} 的基础上逐层推进 —— 每加载出一层就把新分支一并展开，
   * 直到没有新的待拉取项。返回 Promise：整棵树加载并展开完毕后 resolve。
   */
  async expandAllRecursive(): Promise<void> {
    for (;;) {
      this.expandLoadedBranches();
      const pending = this.pendingVisibleRows();
      if (!pending.length) return;
      await Promise.all(pending.map((row) => this.loadChildrenFor(row)));
    }
  }

  /**
   * 当前可见行里的「待拉取分支」：子级尚未到位且尚未请求过（请求过的一律静默跳过，避免重复请求）。
   * 只统计可见行 —— 尚未露出的深层分支等其祖先真正展开后才会进入 Rows。
   */
  private pendingVisibleRows(): Row<T>[] {
    const opts = this.optsOf();
    const requested = this.lazyRequested();
    return this.rows().filter(
      (row) => row.needLazyLoad && !requested.has(row.id) && opts.isLazyNode(row.data),
    );
  }

  /** 展开全部父节点（纯状态写入：不触发加载、不逐节点发事件） */
  private expandLoadedBranches(): void {
    const opts = this.optsOf();
    const next = new Set<TreeKey>();
    // 复用定位索引已物化的全量先序条目，避免再次递归遍历数据
    for (const { id, node } of this.nodeIndex().entries()) {
      // 父子判定与结构层（flattenStructure 的 hasChildren）保持一致：
      // children 字段存在（含空数组）即有子级槽位；或存在待拉取的子级来源（标记 / 全局 loadChildren）。
      // 因此「有子数据」「空目录」「待拉取分支」一律进入展开态，真正的叶子不入集合。
      const children = opts.getChildren(node);
      if (Array.isArray(children) || opts.isLazyNode(node)) next.add(id);
    }
    this.expandedIds.set(next);
    this.commit(false);
  }

  collapseAll(): void {
    this.expandedIds.set(new Set());
    this.commit(false);
  }

  /** 展开指定节点；懒加载节点会触发加载，已展开则忽略。仅对当前可见行有效。 */
  expandNode(id: TreeKey): void {
    const row = this.rowById(id);
    if (row) this.expandRow(row);
  }

  /** 折叠指定节点；已折叠则忽略。仅对当前可见行有效。 */
  collapseNode(id: TreeKey): void {
    const row = this.rowById(id);
    if (row) this.collapseRow(row);
  }

  /** 切换指定节点展开/折叠。仅对当前可见行有效。 */
  toggleNode(id: TreeKey): void {
    const row = this.rowById(id);
    if (row) this.onToggleExpand(row);
  }

  selectNode(id: TreeKey): void {
    const row = this.rowById(id);
    if (row) this.selectOnly(row);
  }

  filter(keyword: string): void {
    this.filterKw.set(keyword);
  }

  // -------------------- 状态持久化：读取 --------------------

  /**
   * 全部已展开节点的 id（按当前树先序排列，便于稳定持久化）。
   * 配合 `isExpandedField` 可在下次进入时还原展开状态。
   */
  getExpandedIds(): TreeKey[] {
    return this.idsInTreeOrder(this.expandedIds());
  }

  /** 全部已展开节点的数据（按先序排列）。 */
  getExpandedNodes(): T[] {
    return this.nodeIndex().pick(this.expandedIds());
  }

  /** 当前选中节点的 id（按先序排列）。 */
  getSelectedIds(): TreeKey[] {
    return this.idsInTreeOrder(this.selectedIds());
  }

  /** 当前选中节点的数据（按先序排列）。 */
  getSelectedNodes(): T[] {
    return this.selectedNodesList();
  }

  /**
   * 复选框模式下已勾选的 id（按先序排列）。
   * `useTriState` 为真（默认）时返回「已勾选子树内的 id」，为假时返回被勾选的节点 id。
   */
  getCheckedIds(): TreeKey[] {
    return this.idsInTreeOrder(this.checkedIds());
  }

  /** 同 `getCheckedIds`，返回节点数据（按先序排列）。 */
  getCheckedNodes(): T[] {
    return this.checkedNodesList();
  }

  // -------------------- 状态持久化：写入 --------------------

  /**
   * 整体替换「展开」状态（外部还原持久化的展开集合）。
   *
   * 只写入状态集合，**不**逐节点发出 `expand` / `collapse` 事件，
   * 也不回写数据源；树中不存在的 id 会被忽略（不会残留）。
   * 需要事件语义请改用 `expandNode` / `collapseNode` / `toggleNode`。
   */
  setExpanded(ids: readonly TreeKey[]): void {
    this.expandedIds.set(this.knownIdSet(ids));
    this.commit(false);
  }

  /** 同 `setExpanded`，但直接传节点数据（按 `idField` 取 id）。 */
  setExpandedNodes(nodes: readonly T[]): void {
    this.setExpanded(this.idsOfNodes(nodes));
  }

  /**
   * 整体替换「选中」状态（外部还原持久化的选中集合）。
   * 与 `setExpanded` 一样只写状态，不发出 `selectionChange`。
   */
  setSelected(ids: readonly TreeKey[]): void {
    this.selectedIds.set(this.knownIdSet(ids));
    this.commit(false);
  }

  /** 同 `setSelected`，但直接传节点数据。 */
  setSelectedNodes(nodes: readonly T[]): void {
    this.setSelected(this.idsOfNodes(nodes));
  }

  /**
   * 整体替换「复选框勾选」状态。
   * `useTriState` 为真（默认）时勾选单元是叶子，父级状态由统计自动派生（此时传入分支 id 不会显示为勾选）；
   * 为假时传入的每个 id 都直接呈勾选态。只写状态，不发出 `selectionChange`。
   */
  setChecked(ids: readonly TreeKey[]): void {
    this.checkedIds.set(this.knownIdSet(ids));
    this.commit(false);
  }

  /** 同 `setChecked`，但直接传节点数据。 */
  setCheckedNodes(nodes: readonly T[]): void {
    this.setChecked(this.idsOfNodes(nodes));
  }

  /** 清空全部状态集合（展开 / 选中 / 勾选） */
  clearState(): void {
    this.expandedIds.set(new Set());
    this.selectedIds.set(new Set());
    this.checkedIds.set(new Set());
    this.commit(false);
  }

  private selectedNodesList(): T[] {
    return this.nodesFromIds([...this.selectedIds()]);
  }

  private checkedNodesList(): T[] {
    // 勾选集合 → 先序节点数据（按先序）
    return this.nodeIndex().pick(this.checkedIds());
  }

  /** 把 id 集合按当前树先序排列（去重；顺序稳定，便于持久化） */
  private idsInTreeOrder(set: ReadonlySet<TreeKey>): TreeKey[] {
    const out: TreeKey[] = [];
    const seen = new Set<TreeKey>();
    for (const entry of this.nodeIndex().entries()) {
      if (set.has(entry.id) && !seen.has(entry.id)) {
        seen.add(entry.id);
        out.push(entry.id);
      }
    }
    return out;
  }

  /** 过滤掉树中不存在的 id，并去重（写状态集合前统一收口） */
  private knownIdSet(ids: readonly TreeKey[]): ReadonlySet<TreeKey> {
    const nodeIndex = this.nodeIndex();
    const out = new Set<TreeKey>();
    for (const id of ids) {
      if (nodeIndex.has(id)) out.add(id);
    }
    return out;
  }

  /** 节点数据数组 → id 数组（忽略缺 id 的项） */
  private idsOfNodes(nodes: readonly T[]): TreeKey[] {
    const opts = this.optsOf();
    const out: TreeKey[] = [];
    for (const node of nodes) {
      const id = opts.getId(node);
      if (id !== null) out.push(id);
    }
    return out;
  }

  /**
   * 取某节点的轻量 TreeNode 视图（`parent` / `depth` / `index` / `isExpanded` 等
   * 树语义 + `getState()` / `setState()` 状态存取）。
   *
   * 仅对**当前可见行**有效：节点被折叠/过滤而不可见时返回 null
   * （与 `expandNode` / `selectNode` 等按 id 接口的有效范围一致）。
   */
  nodeOf(id: TreeKey): TreeNode<T> | null {
    return this.rowById(id)?.node ?? null;
  }

  getData(): T[] {
    return this.snapshot();
  }

  snapshot(): T[] {
    return cloneData(this.rawNodes(), this.optsOf());
  }

  /**
   * 定点更新单个节点：把补丁字段就写到数据源的节点上，**只重建命中的那一行**。
   *
   * 与「整体替换 `[nodes]`」的区别：后者会重建内部模型（重算定位索引与结构行、
   * 重置懒加载簿记），并让所有可见行换新对象；改名、打标签这类展示字段的改动
   * 用本方法可以只让命中行重渲染，其余行的对象引用与视图保持稳定。
   *
   * ```ts
   * tree.updateRow('2', { name: '新名称' });              // 字段补丁
   * tree.updateRow('2', (n) => ({ name: `${n.name}(已归档)` })); // 按当前节点算补丁
   * tree.updateRow('2', { name: '临时' }, { emit: false });     // 静默更新
   * ```
   *
   * 约束与语义：
   * - 折叠中 / 被过滤隐藏的节点同样可更新（按内部索引定位，不要求当前可见）；
   * - 补丁改到 `id` / `children`（或让 `getId` 结果变化）属于结构变更：**整体回滚**
   *   并返回 `false`；增删移动请走新的 `[nodes]` 或 `moveNodes` / `copyNodes` / `removeNodes`；
   * - 补丁改到影响可见结构的判定（懒加载来源、过滤命中）时，退化为整树重算
   *   ——过滤视图下命中结果变了，可见行集合会同步刷新；
   * - `emit` 默认 `true`：发 `dataChange` 并回写 `[(nodes)]`（载荷即数据源引用）。
   *
   * @returns 是否执行了更新；`false` 表示节点不存在、补丁为空，或结构变更已回滚
   */
  updateRow(
    id: TreeKey,
    patch: TreeNodePatch<T> | ((node: T) => TreeNodePatch<T> | null | undefined),
    options?: UpdateRowOptions,
  ): boolean {
    const opts = this.optsOf();
    const node = this.nodeIndex().node(id);
    if (node === null) return false;

    const partial = (
      typeof patch === 'function' ? (patch as (n: T) => TreeNodePatch<T> | null | undefined)(node) : patch
    ) as Record<string, unknown> | null | undefined;
    if (!partial) return false;
    const keys = Object.keys(partial);
    if (!keys.length) return false;

    const record = node as unknown as Record<string, unknown>;
    // 补丁前快照：结构字段与补丁字段都要能整体回滚
    const before = new Map<string, { had: boolean; value: unknown }>();
    for (const k of keys) before.set(k, { had: k in record, value: record[k] });
    const prevId = opts.getId(node);
    const prevChildren = record[opts.childrenStorage];
    const prevLazy = opts.isLazyNode(node);
    const prevHasChildren = opts.getHasChildren(node);
    const kw = this.filterKw().trim();
    const prevMatch = kw ? opts.filterFn(node, kw) : false;

    for (const k of keys) record[k] = partial[k];

    const restore = (): void => {
      for (const [k, snap] of before) {
        if (snap.had) record[k] = snap.value;
        else delete record[k];
      }
    };
    // 结构字段被改动（含 idField 为函数、改名即改 id 的情形）：整体回滚，不落库也不动视图
    if (opts.getId(node) !== prevId || record[opts.childrenStorage] !== prevChildren) {
      restore();
      return false;
    }

    const structural =
      opts.isLazyNode(node) !== prevLazy ||
      opts.getHasChildren(node) !== prevHasChildren ||
      (kw ? opts.filterFn(node, kw) !== prevMatch : false);
    if (structural) {
      this.bumpDataVersion();
    } else {
      this.bumpRowPatch(id);
    }
    this.commit(options?.emit !== false);
    return true;
  }

  /** 数据已原地修改（引用不变）后调用：递增数据版本号触发视图重算，并同步状态记账 */
  refresh(): void {
    this.bumpDataVersion();
    this.applyNodeStateFlags();
    this.pruneState();
  }
}
