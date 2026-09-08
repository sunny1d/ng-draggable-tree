import type { Observable } from 'rxjs';
import type {
  ChildrenAccessor,
  FieldOrFn,
  TreeDropFilter,
  TreeKey,
} from './tree.types';

/**
 * 树组件全局配置项。
 *
 * 通过 `<ng-draggable-tree [options]="options">` 传入。组件按「内容浅比较」判断配置是否变化：
 * 传入内容相同的新对象不会触发模型重建，只有实际字段值发生变化时才重映射工作树。
 */
export interface TreeOptions<T = unknown> {
  /**
   * 节点 id 字段名或取值函数，默认 `'id'`。
   * id 用于跨数据刷新保持展开/选中/拖拽状态，建议全局唯一。
   */
  idField?: FieldOrFn<T, TreeKey | null | undefined>;

  /** 节点显示文本字段名或取值函数，默认 `'name'`。 */
  displayField?: FieldOrFn<T, string>;

  /**
   * 子节点数组所在字段名，默认 `'children'`。**只接受字段名字符串**（不像 idField / displayField 能传函数）。
   *
   * 该字段的**值**决定子级来源：数组 = 已加载；函数 `(node) => …` = 调用它（返回值可为数组 /
   * `Promise` / `Observable`）；`Promise` / `Observable` = 首次展开时订阅取子级。详见「子节点懒加载」。
   */
  childrenField?: string;

  /**
   * “是否有子节点”标记字段名，默认 `'hasChildren'`。
   *
   * 只影响「是否显示展开箭头 / 是否按待加载分支处理」，**不提供子级来源**：
   * 值严格为 `true` → 待加载；严格为 `false` → 直接按叶子处理（即使配了 loadChildren）；
   * 字段缺失时看是否配了 {@link loadChildren}。
   */
  hasChildrenField?: string;

  /**
   * 全局懒加载函数。节点自身无 children 来源时启用（如整棵树都由后端驱动），
   * 在节点首次展开时调用，返回值可为 `T[] | Promise<T[]> | Observable<T[]>`。
   */
  loadChildren?: (node: T) => T[] | null | undefined | Promise<T[] | null | undefined> | Observable<T[] | null | undefined>;

  /** 每层缩进像素。默认 24。 */
  levelIndent?: number;

  /** 是否启用复选框。默认 false。 */
  useCheckbox?: boolean;

  /**
   * 三态级联：父级复选框自动联动全部后代，并在子级部分勾选时呈现半选态。
   * 设为 false 时父子互不联动（每行只切换自身，父级同样可被独立勾选，且没有半选态）。默认 true。
   */
  useTriState?: boolean;

  /** 是否启用多选（Ctrl/Cmd + 点击多选，Shift + 点击范围选）。默认 true。 */
  multiSelect?: boolean;

  /** 点击文字是否触发选中。默认 true。 */
  selectOnClick?: boolean;

  /**
   * 是否允许拖拽，或按「本次将被拖动的节点」返回布尔。默认 false。
   * 回调参数是节点数组：单选拖动时为 `[节点自身]`，多选拖动整组时为整组节点（先序）。
   */
  allowDrag?: boolean | ((nodes: T[]) => boolean);

  /** 放置校验。默认规则：禁止放入自身或自己的后代、禁止原地不动。 */
  allowDrop?: TreeDropFilter<T>;

  /**
   * 跨树拖拽参与方式，默认 `'disabled'`。`'move'` 与 `'copy'` 目前等价，都表示
   * 「本树参与跨树拖拽」——既能作为拖出源，也能作为其它启用跨树树的放置目标。
   *
   * 库本身不会再替你改动数据：松手时源树只会发出携带完整落点上下文的
   * `(dragEnd)` 事件（含源树/目标树组件实例、目标节点、方位与被拖节点），
   * 由使用方在事件处理中自行决定后续操作（如调用目标树 `copyNodes`、
   * 源树 `removeNodes` 完成一次“移动”，或走自己的后端流程）。
   *
   * 仅当「源树」与「目标树」都启用且 {@link dragGroup} 一致时，两树之间才能互拖。
   * 目标树的 `allowDrop` 仍会在拖拽过程与松手时参与校验；为防止 id 冲突，
   * 目标树中已存在与被拖子树相同的 id 时不允许放入。
   */
  crossTree?: 'move' | 'copy' | 'disabled';

  /**
   * 跨树拖拽分组标识。只有当两棵树的 `crossTree` 均非 disabled 且
   * `dragGroup` 相同时才会建立拖拽关联，避免同页不相干的多棵树互相接收节点。默认 ''。
   */
  dragGroup?: string;

  /** 是否绘制父子连接线。默认 false。 */
  showLine?: boolean;

  /**
   * 右键菜单开关。默认 `true`。菜单内容完全由 `#contextMenuTemplate` 决定，库没有内置菜单项：
   * - 未投影 `#contextMenuTemplate`：右键不弹菜单，也不阻止浏览器原生菜单，
   *   只发出 `contextMenu` 事件，由使用方自行决定右键后做什么；
   * - 已投影模板：右键即弹出该模板；传函数可按节点决定是否弹出（返回 false 时只发事件）；
   * - 传 `false`：关闭菜单（同样只发事件）。
   *
   */
  contextMenu?: boolean | ((node: T) => boolean);


  /** 自定义搜索匹配函数（node 是否匹配关键词）。默认按 displayField 文本不区分大小写包含匹配。 */
  filterFn?: (node: T, keyword: string) => boolean;

  /**
   * 过滤命中时的文本高亮方式，默认 `'keyword'`：
   * - `'keyword'`：**只高亮匹配词**——默认 label 路径把显示文本切成片段，
   *   命中的子串用 `<mark>` 包裹（`--ng-draggable-tree-highlight-bg` 上色）；
   *   自定义 `filterFn` 按非显示字段命中（如 code / 拼音）时定位不到子串，
   *   此时该行整段高亮兜底；祖先路径行（子级命中）的箭头会着色提示分支内有命中；
   * - `'label'`：整段 label 高亮，适用于需要自定义 CSS 上色的场景。
   *
   * 注意：`'keyword'` 模式下行上的 `is-match` 只作为类名钩子，不给整个 label 着色，
   * 需要自定义样式时用 `.is-match` / `.is-child-match` / `.ng-draggable-tree-hit`。
   * 自定义 `#treeNodeTemplate` 不受本选项控制，可用 `TreeHighlightPipe`
   * （或 `splitHighlight`）配合模板上下文里的 `keyword` 自行实现。
   */
  highlightMode?: 'keyword' | 'label';

  /**
   * 过滤时是否保留命中节点的**父子路径**（祖先链），默认 `true`：
   * - `true`：命中节点与其祖先路径一并展示，祖先分支被强制展开且不可折叠，
   *   便于看清命中项在树中的位置；子级中命中的节点同样可见；
   * - `false`：**只展示命中节点自身**——祖先路径不出现，深层命中节点会穿透未命中的
   *   中间层各自独立成行（结果集形式）。
   *
   * `false` 时的视图语义：结果行**不可展开**（不显示展开箭头，也不触发懒加载），
   * 因为有子级的行其子级只在「自身命中」时才独立成行；行仍按原始 `depth` 缩进以保留
   * 层级线索（需要完全扁平可按结果列表排布的话，用 `.is-filter-flat` 作用域覆盖行内边距）。
   *
   * 仅过滤生效（关键字非空）时有意义；清空关键字后恢复完整树视图。
   */
  autoShow?: boolean;

  /**
   * 初始展开字段名，默认 `'expanded'`：数据加载完成后，字段值为真（truthy）的节点自动展开。
   * 懒加载分支的子级加载完成后同样生效；每个节点只应用一次，不会覆盖用户随后的展开/折叠。
   * 子级尚未加载的懒加载分支（`isLazyNode` 为真且无已加载子节点）会因此真正发起一次加载，
   * 否则只会得到一个「展开但没有子行」的空壳；该次加载与交互展开同路径，会发出
   * `expand` / `loadChildren` 并回写数据源。
   */
  isExpandedField?: string;

  /**
   * 初始选中字段名，默认 `'select'`：数据加载完成后，字段值为真（truthy）的节点自动选中。
   * 同样每个节点只应用一次，不会覆盖用户随后的选择。
   */
  isSelectedField?: string;

  /** 删除节点前的确认回调。返回 false 取消删除。 */
  confirmDelete?: (nodes: T[]) => boolean;

  /** 展开动画：新增行淡入、展开箭头旋转过渡（收起时行直接移除）。默认 true。 */
  animate?: boolean;

  /** 方向：'ltr' | 'rtl'。 */
  dir?: 'ltr' | 'rtl';

  /** 空数据文案（数据源为空时展示）。默认 `'暂无数据'`。 */
  emptyMessage?: string;
}

/** 懒加载已落定（结果已写入数据）的非枚举标记键 */
export const TREE_LAZY_LOADED = Symbol('ngxDraggableTree.lazyLoaded');

/** 标准化后的配置：字段访问器统一为函数 */
export interface NormalizedTreeOptions<T = unknown> {
  getId: (node: T) => TreeKey | null;
  getChildren: ChildrenAccessor<T>;
  getDisplay: (node: T) => string;
  /** 子节点数组的物理存储字段名（默认 'children'）；懒加载结果同样写回该字段 @internal */
  childrenStorage: string;
  /** id 字段的物理存储键（idField 为函数时为 null，此时节点数据需自带稳定 id） */
  idStorage: string | null;
  /**
   * 由 hasChildrenField 读取“是否还有子节点”：仅当字段值严格为 `true` 时为 true。
   * 子节点尚未加载时用于判定展开按钮与懒加载来源。
   */
  getHasChildren: (node: T) => boolean;
  /** 某节点是否具备“首次展开拉取”的潜在子节点来源（字段函数 / 字段 Promise|Observable / hasChildrenField 标记 / 全局 loadChildren） */
  isLazyNode: (node: T) => boolean;
  levelIndent: number;
  useCheckbox: boolean;
  useTriState: boolean;
  multiSelect: boolean;
  selectOnClick: boolean;
  allowDrag: boolean | ((nodes: T[]) => boolean);
  allowDrop: TreeDropFilter<T>;
  /** 跨树拖拽参与语义（见 TreeOptions.crossTree：move/copy 等价，仅表示启用） */
  crossTree: 'move' | 'copy' | 'disabled';
  /** 跨树拖拽分组（见 TreeOptions.dragGroup） */
  dragGroup: string;
  showLine: boolean;
  /** 右键菜单开关（true / 按节点判定 / false=只发事件）；未提供模板时始终不弹菜单，见 TreeOptions.contextMenu */
  contextMenu: boolean | ((node: T) => boolean);
  filterFn: (node: T, keyword: string) => boolean;
  /** 过滤命中高亮方式（见 TreeOptions.highlightMode，默认 'keyword'） */
  highlightMode: 'keyword' | 'label';
  /** 过滤时是否保留命中节点的父子路径（见 TreeOptions.autoShow，默认 true） */
  autoShow: boolean;
  /** 初始展开字段名（见 TreeOptions.isExpandedField，默认 'expanded'）：字段值为真即展开，懒加载未解析分支会真正发起加载 */
  isExpandedField: string;
  /** 初始选中字段名（见 TreeOptions.isSelectedField，默认 'select'）：字段值为真即选中 */
  isSelectedField: string;
  confirmDelete: ((nodes: T[]) => boolean) | null;
  loadChildren: ((node: T) => unknown) | null;
  animate: boolean;
  dir: 'ltr' | 'rtl';
  /** 空数据文案（见 TreeOptions.emptyMessage，默认 '暂无数据'） */
  emptyMessage: string;
}

/** 是否异步源 */
export function isAsyncChildren(v: unknown): v is Promise<unknown> | Observable<unknown> {
  return !!v && (typeof (v as Promise<unknown>).then === 'function' || typeof (v as Observable<unknown>).subscribe === 'function');
}

/** 按字段名或函数解析访问器；两者皆无时使用 defaultName */
function accessor<T, R>(spec: FieldOrFn<T, R> | undefined, defaultName: string): (node: T) => R {
  if (typeof spec === 'function') {
    return spec;
  }
  const name = typeof spec === 'string' && spec.length > 0 ? spec : defaultName;
  return (node: T) => (node as Record<string, R>)[name];
}

const defaultDropFilter: TreeDropFilter = (ctx) => !ctx.isSelf && !ctx.isDescendant;

/** 将 TreeOptions 标准化为纯函数形式，供模型与渲染统一调用 */
export function normalizeOptions<T>(options: TreeOptions<T> | null | undefined): NormalizedTreeOptions<T> {
  const o = options ?? {};

  const getIdRaw = accessor<T, TreeKey | null | undefined>(o.idField, 'id');
  const getId: (n: T) => TreeKey | null = (node) => {
    const v = getIdRaw(node);
    return v === undefined || v === null ? null : v;
  };

  const getDisplayRaw = accessor<T, string>(o.displayField, 'name');
  const getDisplay: (n: T) => string = (node) => {
    const v = getDisplayRaw(node);
    return v === null || v === undefined ? '' : String(v);
  };

  // 默认过滤：按 displayField 文本做不区分大小写的包含匹配。必须与渲染层读同一份文本，
  // 否则会出现「显示的是 displayField、匹配的是 name」的错位（高亮也会定位不到子串）。
  const defaultFilterFn = (node: T, keyword: string): boolean =>
    getDisplay(node).toLowerCase().includes(keyword.toLowerCase());

  // 子节点数组所在字段名：字符串即字段名，缺省 'children'
  const childrenStorage: string =
    typeof o.childrenField === 'string' && o.childrenField.length > 0 ? o.childrenField : 'children';
  const idStorage: string | null = typeof o.idField === 'function' ? null : o.idField ?? 'id';

  const getChildren: ChildrenAccessor<T> = (node) => {
    const value = (node as unknown as Record<PropertyKey, unknown>)[childrenStorage];
    if (Array.isArray(value)) {
      return value as T[];
    }
    if (value === undefined || value === null) {
      return null;
    }
    // 字段值本身为 Promise/Observable => 逐节点懒加载
    return isAsyncChildren(value)
      ? (value as Promise<T[] | null | undefined> | Observable<T[] | null | undefined>)
      : null;
  };

  // “是否有子节点”标记：仅严格 true 视为有子节点，字段缺失按叶子处理
  const getHasChildrenRaw = accessor<T, unknown>(o.hasChildrenField, 'hasChildren');
  const getHasChildren = (node: T): boolean => getHasChildrenRaw(node) === true;

  const isLazyNode = (node: T): boolean => {
    const raw = (node as unknown as Record<PropertyKey, unknown>)[childrenStorage];
    // 字段值为函数 / Promise / Observable：逐节点懒加载
    if (typeof raw === 'function' || isAsyncChildren(raw)) return true;
    // 数据显式标记“有/无子节点”时以标记为准：true 待加载，false 直接当叶子
    const flag = getHasChildrenRaw(node);
    if (flag === true) return true;
    if (flag === false) return false;
    // 无标记时由全局加载器兜底（整棵树由后端驱动）
    return !!o.loadChildren;
  };

  // 初始状态字段名：数据就绪后由组件读取节点上的字段值（真值即展开/选中），缺省 expanded / select
  const isExpandedField =
    typeof o.isExpandedField === 'string' && o.isExpandedField.length > 0 ? o.isExpandedField : 'expanded';
  const isSelectedField =
    typeof o.isSelectedField === 'string' && o.isSelectedField.length > 0 ? o.isSelectedField : 'select';

  return {
    getId,
    getChildren,
    getDisplay,
    childrenStorage,
    idStorage,
    getHasChildren,
    isLazyNode,
    levelIndent: o.levelIndent ?? 24,
    useCheckbox: o.useCheckbox ?? false,
    useTriState: o.useTriState ?? true,
    multiSelect: o.multiSelect ?? true,
    selectOnClick: o.selectOnClick ?? true,
    allowDrag: o.allowDrag ?? false,
    allowDrop: o.allowDrop ?? defaultDropFilter,
    crossTree: o.crossTree ?? 'disabled',
    dragGroup: o.dragGroup ?? '',
    showLine: o.showLine ?? false,
    contextMenu: o.contextMenu ?? true,
    filterFn: o.filterFn ?? defaultFilterFn,
    highlightMode: o.highlightMode === 'label' ? 'label' : 'keyword',
    autoShow: o.autoShow ?? true,
    isExpandedField,
    isSelectedField,
    confirmDelete: o.confirmDelete ?? null,
    loadChildren: o.loadChildren ?? null,
    animate: o.animate ?? true,
    dir: o.dir ?? 'ltr',
    emptyMessage:
      typeof o.emptyMessage === 'string' && o.emptyMessage.length > 0 ? o.emptyMessage : '暂无数据',
  };
}
