import type { NormalizedTreeOptions } from './tree-options';
import type { DropPosition, TreeKey } from './tree.types';
import type { TreeNode } from './tree.node';

/** 行模型：扁平化渲染单元。作为 cdk-tree 的渲染数据单元。 */
export interface TreeRow<T = unknown> {
  /** 可见行下标 */
  index: number;
  /** 节点原始数据 */
  data: T;
  /** 节点 id */
  id: TreeKey;
  /** 层级（根为 0） */
  depth: number;
  /** 直接父级数据；根节点为 null */
  parentData: T | null;
  /** 在父级数组（或根数组）中的下标 */
  indexInParent: number;
  /** 父级 id；根节点为 null */
  parentId: TreeKey | null;
  /**
   * 是否有子节点（是否是父节点）——**只看结构，不看数据是否到位**。
   * 两种情形都算“有子节点”：已有已加载的子节点（`children` 数组非空），
   * 或存在待拉取的子级来源（`hasChildrenField` 标记 / 全局 `loadChildren`）。
   * 因此加载前的分支、以及拉取结果为空的空目录，都是父节点。
   */
  hasChildren: boolean;
  /** 是否处于展开态：驱动箭头样式；有子节点时子级随之可见，空目录懒加载展开后同样保持展开态 */
  expanded: boolean;
  /**
   * 是否需要懒加载：是父节点（{@link hasChildren} 为真）但子节点尚未拉取，且未被确认为空目录。
   * 为真时首次展开会先发起一次加载（{@link NormalizedTreeOptions.isLazyNode} 所述来源）；
   * 不需要懒加载、或已加载过（含「拉取结果为空」的空目录）恒为 false，不再重复请求。
   */
  needLazyLoad: boolean;
  /**
   * 是否选中（装饰态）。结构层恒为占位 `false`，由装饰层填充；
   * 选中集合因此**不参与**结构层依赖，选中变化不会触发整树重算。
   */
  selected: boolean;
  /** 是否键盘激活（装饰态）。同 {@link selected}，结构层恒为占位 `false` */
  active: boolean;
  /** 自身命中过滤词（高亮用） */
  matched: boolean;
  /** 子树内是否存在命中（过滤时分支展示依据） */
  subtreeHasMatch: boolean;
  /** 复选框三态（装饰态）。结构层恒为占位 `'hidden'`，由装饰层填充 */
  checkboxState: 'checked' | 'indeterminate' | 'unchecked' | 'hidden';
  isLeaf: boolean;
  /**
   * 当前视图下是否展示展开箭头（视图派生，非结构语义）。
   * 正常视图等于 `!isLeaf`；过滤「只展示命中节点自身」（`TreeOptions.autoShow: false`）时恒为
   * false —— 该视图是结果集，行不可展开（子级只按自身命中独立成行，也不触发懒加载）。
   */
  expanderVisible: boolean;
  /**
   * 是否绘制连接线。连接线列数与“列宽”只由 depth 决定（第 i 列对应第 i 层祖先的箭头列），
   * 行可见即代表各祖先已展开，因此正常视图下每行都应画线；
   * 仅过滤等“层级被强制展示”的扁平化视图不画线，避免断裂的层级观感。
   */
  linesVisible: boolean;
  /**
   * 轻量 TreeNode 视图：树语义（`parent` / `depth` / `index` / `isExpanded` …）的访问入口。
   * 由组件行管线（装饰层）填充，结构未变时引用稳定；
   * 结构层 `flattenStructure` 的输出不含该字段（结构行不参与渲染）。
   */
  node?: TreeNode<T>;
}

/**
 * 组件实际渲染的行：必带 {@link TreeNode} 视图。模板上下文中的 `row` 即此类型，
 * 因此自定义模板可直接使用 `row.node`（如 `row.node.isExpanded`）。
 */
export interface TreeRowView<T = unknown> extends TreeRow<T> {
  node: TreeNode<T>;
}

/** 复选框统计：以叶子为勾选单元 */
export interface CheckStats {
  total: number;
  checked: number;
}

/**
 * 结构层扁平化上下文：只依赖树的「结构状态」（数据 + 展开 + 过滤），
 * **不接收**选中/焦点/勾选等装饰状态 —— 结构层不需要它们（输出行的装饰字段恒为占位），
 * 把依赖排除在外可避免装饰状态变化触发整树重算。
 */
export interface StructureContext<T = unknown> {
  options: NormalizedTreeOptions<T>;
  roots: T[];
  expanded: ReadonlySet<TreeKey>;
  /** 过滤关键词；空串=不过滤 */
  keyword?: string;
  /**
   * 已拉取且确认为「子级为空」的懒加载父节点集合。
   * 只用于关闭 {@link TreeRow.needLazyLoad}（不再重复请求）与保持展开视觉态，
   * **不影响父节点身份**：这些节点仍是父节点，照常展示折叠展开按钮。
   */
  asyncLeaves?: ReadonlySet<TreeKey>;
  /** 逐节点判断是否具备懒加载子节点来源（hasChildrenField 标记 / 全局 loadChildren） */
  isLazyNode?: (node: T) => boolean;
}

/** 结构层 + 装饰信息一次性应用（装饰信息在此仅用于输出行字段） */
export interface FlattenContext<T = unknown> extends StructureContext<T> {
  selected: ReadonlySet<TreeKey>;
  checkedLeaves: ReadonlySet<TreeKey>;
  activeId: TreeKey | null;
}

/** 复选框三态装饰的输入 */
export interface DecorationContext<T = unknown> {
  options: NormalizedTreeOptions<T>;
  selected: ReadonlySet<TreeKey>;
  checkedLeaves: ReadonlySet<TreeKey>;
  activeId: TreeKey | null;
}

export interface TreeNodeView<T = unknown> {
  data: T;
  id: TreeKey;
  parent: T | null;
  depth: number;
  indexInParent: number;
  children: T[] | null;
}

function readChildren<T>(node: T, options: NormalizedTreeOptions<T>): T[] | null {
  const value = options.getChildren(node);
  return Array.isArray(value) ? value : null;
}

/** 先序遍历全部已加载节点 */
export function walkNodes<T>(
  roots: T[],
  options: NormalizedTreeOptions<T>,
  visit: (view: TreeNodeView<T>) => void,
): void {
  const walk = (list: T[], parent: T | null, depth: number): void => {
    for (let i = 0; i < list.length; i++) {
      const data = list[i];
      const id = options.getId(data);
      const children = readChildren(data, options);
      if (id !== null) visit({ data, id, parent, depth, indexInParent: i, children });
      if (children && children.length) walk(children, data, depth + 1);
    }
  };
  walk(roots, null, 0);
}

/**
 * 自底向上统计每个节点的叶子数量与已勾选叶子数量。
 * O(n)；复选框渲染时调用。
 */
export function buildCheckStats<T>(
  roots: T[],
  options: NormalizedTreeOptions<T>,
  checkedLeaves: ReadonlySet<TreeKey>,
): Map<TreeKey, CheckStats> {
  const stats = new Map<TreeKey, CheckStats>();
  const post = (list: T[]): { total: number; checked: number } => {
    let total = 0;
    let checked = 0;
    for (const data of list) {
      const id = options.getId(data);
      const children = readChildren(data, options);
      if (children && children.length) {
        const sub = post(children);
        total += sub.total;
        checked += sub.checked;
        if (id !== null) stats.set(id, { total: sub.total, checked: sub.checked });
      } else {
        total += 1;
        const on = id !== null && checkedLeaves.has(id);
        if (on) checked += 1;
        if (id !== null) stats.set(id, { total: 1, checked: on ? 1 : 0 });
      }
    }
    return { total, checked };
  };
  post(roots);
  return stats;
}

/**
 * 过滤集合：命中节点 id => true；祖先路径节点 id => false。
 * `keepPath` 为 false（`autoShow: false`，只展示命中节点自身）时不写入祖先条目 ——
 * 该视图没有「因后代命中而展示」的分支行，可见性完全由 `get(id) === true` 决定。
 * 两种模式都要递归整棵树才能找到深层命中，成本一致。
 */
function buildFilterSet<T>(
  roots: T[],
  options: NormalizedTreeOptions<T>,
  kw: string,
  keepPath: boolean,
): Map<TreeKey, boolean> {
  const shown = new Map<TreeKey, boolean>();
  const mark = (list: T[]): boolean => {
    let any = false;
    for (const data of list) {
      const id = options.getId(data);
      if (id === null) continue;
      const self = options.filterFn(data, kw);
      const children = readChildren(data, options);
      const childHit = children && children.length ? mark(children) : false;
      if (self || childHit) {
        any = true;
        if (self) {
          shown.set(id, true);
        } else if (keepPath && !shown.has(id)) {
          shown.set(id, false);
        }
      }
    }
    return any;
  };
  mark(roots);
  return shown;
}

/**
 * 结构层扁平化：仅依据树结构/展开/过滤等生成可见行（纯函数）。
 * 输出行的装饰字段（selected/active/checkboxState）一律为占位值，
 * 由装饰层（`resolveRowDecoration` / 组件级增量装饰层）填充 ——
 * 结构层因此不建立对装饰状态的依赖，装饰状态变化不会触发整树重建。
 */
export function flattenStructure<T>(ctx: StructureContext<T>): TreeRow<T>[] {
  const { options, roots, expanded, keyword, asyncLeaves } = ctx;

  const kw = keyword?.trim() ?? '';
  const filterActive = kw.length > 0;
  // autoShow（默认 true）保留命中节点的父子路径；false 时只展示命中节点自身（扁平结果集）
  const flatFilter = filterActive && !options.autoShow;
  const filterSet = filterActive ? buildFilterSet(roots, options, kw, !flatFilter) : null;

  const rows: TreeRow<T>[] = [];

  interface Frame {
    data: T;
    id: TreeKey;
    depth: number;
    parent: T | null;
    parentId: TreeKey | null;
    indexInParent: number;
  }

  const stack: Frame[] = [];
  const pushChildren = (children: T[] | null, parent: T | null, parentId: TreeKey | null, depth: number): void => {
    if (!children) return;
    for (let i = children.length - 1; i >= 0; i--) {
      const data = children[i];
      const id = options.getId(data);
      if (id === null) continue;
      stack.push({ data, id, depth, parent, parentId, indexInParent: i });
    }
  };
  pushChildren(roots, null, null, 0);

  while (stack.length) {
    const frame = stack.pop()!;
    const { data, id, depth, parent, parentId, indexInParent } = frame;
    const children = readChildren(data, options);
    // 已加载的子节点是否非空：有数据才真正论“能展示几行”，与「是不是父节点」无关
    const loadedChildren = !!children && children.length > 0;

    const selfMatch = filterSet ? filterSet.get(id) === true : false;
    const subtreeMatch = filterSet ? filterSet.has(id) : false;
    // 可见性：保留路径时「自身或后代命中」即展示（祖先借子树命中呈现）；结果集模式只展示自身命中
    const visible = !filterSet || (flatFilter ? selfMatch : subtreeMatch);

    // 结果集模式必须无条件下钻：本行不展示时，命中的深层节点仍要各自独立成行
    if (flatFilter) pushChildren(children, data, id, depth + 1);
    if (!visible) continue;

    // 待拉取的子级来源：hasChildrenField 标记 / 全局 loadChildren（children 字段值本身不是来源）
    const hasLazySource = ctx.isLazyNode?.(data) === true;
    // 唯一的父子判定：已有已加载子节点，或存在待拉取的子级来源。
    // 只取决于「有没有子级」，与子节点数据是否到位无关（加载前的分支、空目录都仍是父节点）
    const hasChildren = loadedChildren || hasLazySource;
    // 需要懒加载：是父节点但子节点尚未到位，且未被确认为空目录（确认为空后不再重复请求）
    const needLazyLoad = !loadedChildren && hasLazySource && !asyncLeaves?.has(id);
    // 是否真正向下展示子节点（决定是否遍历子级）
    // 结果集模式的行不展开：子级只按「自身命中」独立成行（已在上面无条件下钻）
    const baseRevealing = flatFilter
      ? false
      : loadedChildren && (filterActive ? subtreeMatch : expanded.has(id));
    // 已确认无子节点的懒加载父子点：用户展开过后保持“展开”视觉态（无子级可遍历）
    const emptyOpened =
      !filterActive && !loadedChildren && !!asyncLeaves?.has(id) && expanded.has(id);
    const revealing = baseRevealing || emptyOpened;

    rows.push({
      index: rows.length,
      data,
      id,
      depth,
      parentData: parent,
      parentId,
      indexInParent,
      hasChildren,
      needLazyLoad,
      expanded: revealing,
      // 装饰字段一律占位：结构层不依赖选中/勾选集合，装饰变化不触发整树重算
      selected: false,
      active: false,
      matched: selfMatch,
      // 祖先路径行只在保留路径的视图里存在；结果集不含任何「因后代命中而展示」的行
      subtreeHasMatch: flatFilter ? false : subtreeMatch,
      checkboxState: 'hidden',
      // 叶子只由「是不是父节点」决定：无子节点即叶子（忽略加载状态与加载结果）
      isLeaf: !hasChildren,
      // 父节点一律展示折叠展开按钮；唯一例外是「只展示命中节点自身」的过滤结果集
      // （该视图是扁平结果集，行不可展开，交互与懒加载一并禁用）
      expanderVisible: hasChildren && !flatFilter,
      linesVisible: !filterActive,
    });

    if (revealing) {
      if (filterActive && children) {
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i];
          const cid = options.getId(child);
          if (cid !== null && filterSet!.has(cid)) {
            stack.push({ data: child, id: cid, depth: depth + 1, parent: data, parentId: id, indexInParent: i });
          }
        }
      } else {
        pushChildren(children, data, id, depth + 1);
      }
    }
  }

  for (let i = 0; i < rows.length; i++) {
    rows[i].index = i;
  }
  return rows;
}

/** 单行装饰状态（选中/焦点/复选框三态） */
export interface RowDecoration {
  selected: boolean;
  active: boolean;
  checkboxState: TreeRow['checkboxState'];
}

/** 装饰解析输入：stats 需调用方按需缓存（仅在三态级联时才需要构建） */
export interface RowDecorationInput<T = unknown> {
  options: NormalizedTreeOptions<T>;
  selected: ReadonlySet<TreeKey>;
  /**
   * 勾选集合：`useTriState` 为真时为「已勾选子树内的 id」（分支状态由 `stats` 派生），
   * 为假时即「被勾选的节点 id」（直接决定该节点自身的状态）。
   */
  checkedLeaves: ReadonlySet<TreeKey>;
  activeId: TreeKey | null;
  stats: Map<TreeKey, CheckStats> | null;
  filterActive: boolean;
}

/** 解析单个可见行的装饰状态（纯函数，供装饰层与 flattenRows 共用） */
export function resolveRowDecoration<T>(id: TreeKey, input: RowDecorationInput<T>): RowDecoration {
  const { options, selected, checkedLeaves, activeId, stats } = input;
  const deco: RowDecoration = { selected: selected.has(id), active: activeId === id, checkboxState: 'hidden' };
  if (!options.useCheckbox || input.filterActive) return deco;
  if (!options.useTriState) {
    // 非三态：各勾各的——父级不派生后代状态，也没有半选态（stats 为 null）
    deco.checkboxState = checkedLeaves.has(id) ? 'checked' : 'unchecked';
    return deco;
  }
  const s = stats?.get(id);
  if (s && s.total > 0) {
    deco.checkboxState = s.checked === 0 ? 'unchecked' : s.checked === s.total ? 'checked' : 'indeterminate';
  } else {
    // 懒加载等场景：叶子状态直接由勾选集合决定
    deco.checkboxState = checkedLeaves.has(id) ? 'checked' : 'unchecked';
  }
  return deco;
}

/**
 * 装饰层全量应用（一次性）。
 * 组件内部性能路径请使用基于结构行缓存 + 增量比较的装饰层，
 * 避免选中/焦点/勾选变化触发整树重建。
 */
export function applyRowDecoration<T>(row: TreeRow<T>, deco: RowDecoration): void {
  row.selected = deco.selected;
  row.active = deco.active;
  row.checkboxState = deco.checkboxState;
}

/** 核心扁平化：结构层 + 装饰一次性应用 */
export function flattenRows<T>(ctx: FlattenContext<T>): TreeRow<T>[] {
  const rows = flattenStructure<T>(ctx);
  const kw = ctx.keyword?.trim() ?? '';
  const filterActive = kw.length > 0;
  const stats =
    ctx.options.useCheckbox && ctx.options.useTriState && !filterActive
      ? buildCheckStats(ctx.roots, ctx.options, ctx.checkedLeaves)
      : null;
  const input: RowDecorationInput<T> = {
    options: ctx.options,
    selected: ctx.selected,
    checkedLeaves: ctx.checkedLeaves,
    activeId: ctx.activeId,
    stats,
    filterActive,
  };
  for (const row of rows) {
    applyRowDecoration(row, resolveRowDecoration<T>(row.id, input));
  }
  return rows;
}

/** 收集某节点整棵子树 id（含自身） */
export function collectSubtreeIds<T>(node: T, options: NormalizedTreeOptions<T>): TreeKey[] {
  const out: TreeKey[] = [];
  const stack: T[] = [node];
  while (stack.length) {
    const current = stack.pop()!;
    const cid = options.getId(current);
    if (cid !== null) out.push(cid);
    const children = readChildren(current, options);
    if (children) {
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }
  return out;
}

/** 判断 id 是否位于 subtreeRoot 的后代中（不含自身） */
export function isDescendantId<T>(
  subtreeRoot: T,
  options: NormalizedTreeOptions<T>,
  maybeDescendantId: TreeKey,
): boolean {
  const stack: T[] = [subtreeRoot];
  while (stack.length) {
    const current = stack.pop()!;
    const children = readChildren(current, options);
    if (children) {
      for (const child of children) {
        const cid = options.getId(child);
        if (cid === maybeDescendantId) return true;
        stack.push(child);
      }
    }
  }
  return false;
}

/** 按 id 查找节点（包含其父级信息），找不到返回 null */
export function findNodeById<T>(
  roots: T[],
  options: NormalizedTreeOptions<T>,
  targetId: TreeKey,
): TreeNodeView<T> | null {
  let result: TreeNodeView<T> | null = null;
  const walk = (list: T[] | null, parent: T | null, depth: number): boolean => {
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const data = list[i];
      const id = options.getId(data);
      if (id === targetId) {
        result = { data, id, parent, depth, indexInParent: i, children: readChildren(data, options) };
        return true;
      }
      if (walk(readChildren(data, options), data, depth + 1)) return true;
    }
    return false;
  };
  walk(roots, null, 0);
  return result;
}

/** 由行模型解析出的数据层落点：父容器 id + 锚点兄弟 id（anchor 为 null 表示追加到容器末尾） */
export interface TreeTargetSlot {
  parentId: TreeKey | null;
  anchor: TreeKey | null;
}

/**
 * 把「目标行 + 方位」解析成数据层落点（父容器 id + 锚点兄弟 id）。
 * - targetRowId 为 null：根级末尾（仅对 position 为 after/before 有意义，均视为末尾追加）；
 * - position 为 child：落点为该行的子容器末尾；
 * - before：落点为该行的前一个兄弟位置；after：紧随其后（找不到后续兄弟则追加末尾）。
 * 目标行不在 rows（当前可见行）中时返回 null。
 */
export function resolveTargetSlot<T>(
  rows: TreeRow<T>[],
  targetRowId: TreeKey | null,
  position: DropPosition,
): TreeTargetSlot | null {
  if (targetRowId === null) {
    return { parentId: null, anchor: null };
  }
  const targetRow = rows.find((r) => r.id === targetRowId);
  if (!targetRow) return null;
  if (position === 'child') {
    return { parentId: targetRow.id, anchor: null };
  }
  if (position === 'before') {
    return { parentId: targetRow.parentId, anchor: targetRow.id };
  }
  const idx = rows.findIndex((r) => r.id === targetRow.id);
  const next = rows.slice(idx + 1).find((r) => r.parentId === targetRow.parentId);
  if (next) {
    return { parentId: next.parentId, anchor: next.id };
  }
  return { parentId: targetRow.parentId, anchor: null };
}
