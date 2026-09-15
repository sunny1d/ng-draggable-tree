# ng-draggable-tree

基于 `@angular/cdk/tree` 的 Angular 树形组件。扁平化渲染、三态复选框、子节点懒加载、
拖拽排序与实时过滤。

**数据模型**：组件直接接管 `[nodes]` 传入的数组并**就地改写**。数据源变动（传入新的数组引用）
即**整树重构**：重建结构与定位索引、重置懒加载簿记，并按 id 保留展开 / 选中 / 勾选 / 焦点状态；
而**展开 / 折叠不重构树**（唯一例外是展开触发懒加载并拿到子节点）。需要与数据源隔离的
副本请用 `tree.snapshot()`。

- 兼容 Angular >= 22.1.0（signal API 构建；本仓库使用 Angular 22 验证）
- 渲染核心：`CdkTree` + `FlatTreeControl` + `ArrayDataSource`

## 安装

```bash
npm install ng-draggable-tree
# 需要 peer 依赖
npm install @angular/core @angular/common @angular/cdk rxjs
```

仓库内联调试：`npm run build:lib` 后由 tsconfig paths 指向 `dist/ng-draggable-tree`。

## 最小示例

```ts
import { Component, signal } from '@angular/core';
import { NgDraggableTreeComponent, type TreeOptions } from 'ng-draggable-tree';

interface Node {
  id: string;
  name: string;
  children?: Node[];
}

@Component({
  selector: 'app-demo',
  imports: [NgDraggableTreeComponent],
  template: '<ng-draggable-tree [nodes]="nodes" [options]="options" />',
})
export class Demo {
  readonly nodes = signal<Node[]>([
    { id: '1', name: '项目', children: [{ id: '1-1', name: 'src' }, { id: '1-2', name: 'docs' }] },
    { id: '2', name: '回收站' },
  ]);

  readonly options: TreeOptions<Node> = {
    idField: 'id',              // id 字段
    displayField: 'name',       // 显示字段
    childrenField: 'children',  // 子节点数组所在字段
    hasChildrenField: 'hasChildren', // 是否还有子节点（懒加载标记）
    showLine: true,
    useCheckbox: true,          // 三态复选框
  };
}
```

## 输入

| 输入 | 类型 | 说明 |
| --- | --- | --- |
| `nodes` | `T[]` | 根节点数组 |
| `options` | `TreeOptions<T>` | 全局配置。按**内容浅比较**判断变化：内容相同的新对象不重建模型，实际字段值变化时才重映射工作树 |
| `expandedIds` | `Iterable<TreeKey> \| null` | 展开状态（**可选受控**，`model`）。传入即外部为真源，内部变化经 `expandedIdsChange` 回写，可 `[(expandedIds)]` 双向接管；默认 `null` = 组件自管。按 id **集合内容**比较（与顺序 / 数组或 Set / 引用无关），内容一致时不回写 |
| `selectedIds` | `Iterable<TreeKey> \| null` | 选中状态（可选受控），语义同 `expandedIds` |
| `checkedIds` | `Iterable<TreeKey> \| null` | 勾选状态（可选受控），语义同 `expandedIds`。`useTriState` 为真（默认）时回写的是**叶子 id 集合**（父级由统计派生，外部只需存叶子） |

id 用于跨刷新保持「展开 / 选中 / 复选框 / 焦点」状态，建议全局唯一（缺失 id 的行会被忽略）。

## TreeOptions

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `idField` | `'id'` | id 字段名或 `(node) => TreeKey` |
| `displayField` | `'name'` | 显示文本字段名或取值函数 |
| `childrenField` | `'children'` | 标记“子节点数组”的字段名 **只接受字段名字符串** |
| `hasChildrenField` | `'hasChildren'` | 标记“是否有子节点”的字段名。|
| `loadChildren` | - | 全局懒加载函数：当 `childrenField` 字段里拿不到任何来源时用它兜底（整棵树都由后端驱动的场景）。返回值可为 `T[]` / `Promise<T[]>` / `Observable<T[]>` |
| `levelIndent` | `24` | 每层缩进 px |
| `useCheckbox` | `false` | 启用复选框 |
| `useTriState` | `true` | 三态级联：父节点勾选联动全部后代、子级部分勾选时父级半选（配合 `useCheckbox`）。置 `false` 后父子互不联动——每行只切换自身、没有半选态 |
| `multiSelect` | `true` | Ctrl/Meta 多选、Shift 范围选 |
| `selectOnClick` | `true` | 点击文字是否选中行 |
| `allowDrag` | `false` | 允许拖拽；或 `(nodes: T[]) => boolean`（参数即本次被拖动的全部节点：多选拖动时为整组） |
| `allowDrop` | 内置 | 放置校验：`(ctx: TreeDropTarget<T>) => boolean`，默认禁止放入自身/后代 |
| `crossTree` | `'disabled'` | 跨树拖拽参与开关：`'move'` / `'copy'` / `'disabled'`。`'move'` 与 `'copy'` 都只表示「本树参与跨树拖拽」——库不替你改动数据，具体 move 还是 copy 由使用方在 `(dragEnd)` 里决定 |
| `dragGroup` | `''` | 跨树分组标识，只有 `crossTree` 启用且 `dragGroup` 相同的两棵树才能互拖 |
| `showLine` | `false` | 父子连接线 |
| `contextMenu` | `true` | 右键菜单开关：`true` 有模板即弹出、`(node) => boolean` 按节点判定、`false` 只发 `contextMenu` 事件。**未投影 `#contextMenuTemplate` 时一律不弹菜单** |
| `filterFn` | displayField 文本 | `(node, keyword) => boolean` 自定义过滤命中规则；缺省按 **`displayField` 文本**不区分大小写包含匹配 |
| `highlightMode` | `'keyword'` | 过滤命中高亮方式：`'keyword'` 只高亮匹配词（命中子串用 `<mark>`），`'label'` 整段 label 高亮（旧行为） |
| `autoShow` | `true` | 过滤时是否保留命中节点的**父子路径**：`true` 保留（祖先路径一并展示并强制展开）；`false` 只展示命中节点自身（扁平结果集，行不可展开、不触发懒加载） |
| `isExpandedField` | `'expanded'` | 初始展开字段名：数据加载完成后，字段值为真（truthy）的节点自动展开，懒加载分支的子级加载完成后同样生效；子级尚未加载的懒加载分支会因此真正发起一次加载 |
| `isSelectedField` | `'select'` | 初始选中字段名：数据加载完成后，字段值为真（truthy）的节点自动选中 |
| `confirmDelete` | - | 删除前确认，返回 `false` 取消 |
| `animate` | `true` | 展开动画：行淡入 + 箭头旋转过渡；关闭后所有变化即时呈现 |
| `dir` | `'ltr'` | `'ltr' | 'rtl'` |
| `emptyMessage` | `'暂无数据'` | 空态文案 |

`isExpandedField` / `isSelectedField` 指向数据里的布尔字段：**数据就绪后**（含懒加载分支的子级加载完成）
字段值为真的节点自动展开 / 选中；静态子级只并入状态集合，不发出 `expand` / `selectionChange`，也不回写数据源。
每个节点只应用一次——用户随后的展开、折叠、选择不会被之后的数据刷新覆盖。

例外：被标记展开的节点若子级尚未加载（懒加载未解析分支），只写展开集合会得到一个「箭头朝下却没有子行」
的空壳，因此会真正发起一次加载——与交互式展开同路径，所以会发出 `expand` / `loadChildren` 并回写数据源；
加载出的子级里若同样带展开标记，会继续级联加载。

## 输出（事件）

所有事件都带 `nodeId`；结构形如：

```ts
interface TreeNodeEvent<T>     { node: T; nodeId: TreeKey | null; event?: Event }
interface TreeExpansionEvent<T>{ node: T; nodeId: TreeKey | null; isExpanded: boolean }
interface TreeSelectionEvent<T>{ selectedNodes: T[]; node: T; nodeId: TreeKey | null }
interface TreeDropEvent<T>     { nodes: T[]; parent: T | null; parentId: TreeKey | null;
                                    position: 'before' | 'after' | 'child' }  // deleteNode 载荷
interface TreeDragEvent<T>     { node: T; nodeId: TreeKey | null; draggedNodes: T[]; event?: Event }
interface TreeDragEndEvent<T> extends TreeDragEvent<T> {
  draggedIds: TreeKey[];           // 被拖拽顶层节点 id（与 draggedNodes 一一对应）
  drop: TreeDropResult<T>;         // 落点上下文：库不改数据，落位决策所需信息都从这里取
}
interface TreeDropResult<T> {
  dropped: boolean;                // 是否落在有效落点（false = 本次拖放未生效、数据不变）
  external: boolean;               // 是否跨树放置
  sourceTree: NgDraggableTreeComponent<T>;                 // 源树组件实例（可调用公开方法）
  targetTree: NgDraggableTreeComponent<T> | null;          // 跨树放置时为接收树实例
  targetRowId: TreeKey | null;     // 落点所在行 id；null = 根级末尾
  target: T | null;
  position: 'before' | 'after' | 'child' | null;            // 方位；dropped=false 时为 null
  parentId: TreeKey | null;
  parent: T | null;
}
interface TreeLoadChildrenEvent<T> { node: T; nodeId: TreeKey | null; children: T[] | null }
```

| 输出 | 触发时机 |
| --- | --- |
| `expand` / `collapse` | 节点展开 / 折叠 |
| `selectionChange` | 选中变化或复选框变化。选中变化（点击 / `Space` / `selectNode`）时 `selectedNodes` 为**已选中**节点；复选框变化时 `selectedNodes` 为**已勾选**节点（三态级联时是已勾选子树内的节点） |
| `click` / `doubleClick` | 行鼠标事件 |
| `contextMenu` | 行右键，载荷 `{ node, nodeId, event }`。**始终发出**：未投影 `#contextMenuTemplate` 时不会弹菜单，右键行为完全由本事件决定；有模板时本事件也可用于埋点、记录右键位置等（见「右键菜单」） |
| `dragStart` | 拖拽开始（携带被拖节点） |
| `dragEnd` | 拖拽结束：只在<b>源树</b>发一次，载荷含完整落点上下文（源/目标树实例、目标节点、方位、被拖节点）；库不自动改动数据 |
| `deleteNode` | 删除节点（含子树），载荷为 `TreeDropEvent<T>` |
| `addNode` | 批量新增节点成功（`addNodes` 内部触发），携带写入数据源的实际引用 |
| `loadChildren` | 懒加载分支解析完成（含空结果） |
| `nodesChange` | `nodes` 的 `model` 输出。内部变更是原地改写（引用不变），因此**不会**触发它；只有你自己给 `[(nodes)]` 写入新数组时才发出 |
| `expandedIdsChange` / `selectedIdsChange` / `checkedIdsChange` | 受控输入对应的回写输出（`expandedIds` / `selectedIds` / `checkedIds` 是 `model`）；内容一致时不发 |
| `dataChange` | 内部结构变更（懒加载落位 / 移动 / 复制 / 删除 / `updateRow`）后发出，**载荷即数据源的引用**（不是快照） |

## 公开方法

```ts
tree.expandAll();            // 展开所有已加载分支（纯状态写入，不发起加载）
tree.expandAllRecursive(): Promise<void>; // 递归展开：逐层触发懒加载并展开到最深层
tree.collapseAll();          // 全部折叠
tree.expandNode(id);         // 展开指定节点（懒加载节点会触发加载）
tree.collapseNode(id);       // 折叠指定节点
tree.toggleNode(id);         // 切换指定节点展开/折叠
tree.selectNode(id);         // 选中指定行
tree.filter(keyword);        // 实时过滤（传空串还原）
tree.getExpandedIds(): TreeKey[];  // 当前展开 id
tree.getSelectedIds(): TreeKey[];  // 当前选中 id
tree.getCheckedIds(): TreeKey[];   // 已勾选 id（三态级联时为已勾选子树内的叶子 id）
tree.getSelectedNodes(): T[]; // 当前选中数据
tree.getCheckedNodes(): T[]; // 已勾选节点数据（三态级联时为已勾选子树内的节点）
tree.setExpanded(ids): void; tree.setSelected(ids): void; tree.setChecked(ids): void; // 直接写状态集合
tree.clearState(): void;     // 清空展开 / 选中 / 勾选等状态
tree.getData(): T[];         // 深克隆副本（与 snapshot() 等价；数据源引用就是你传入的那个数组）
tree.snapshot(): T[];        // 深克隆快照（与数据源完全隔离）
tree.refresh(): void;        // 外部就地改动数据源后手动通知（重算索引/结构，不重置懒加载簿记）
tree.updateRow(id, patch, options?): boolean; // 定点更新单个节点：只重建命中的那一行（不重建整棵树）
tree.rowCount(): number;     // 当前可见行数（computed）
tree.openContextMenu(id, position?): boolean; // 在 (x, y) 打开右键菜单；缺省锚定该行左下角（未投影 #contextMenuTemplate 时返回 false）
tree.closeContextMenu(): void; // 关闭当前右键菜单
tree.contextMenuOpen(): boolean; // 右键菜单是否已打开
tree.nodeOf(id): TreeNode<T> | null; // 取可见行的 TreeNode 视图（parent/depth/index + getState/setState）
tree.moveNodes(ids, targetRowId?, position?): boolean; // 落位执行器：树内重排（dragEnd 载荷到手后调用）
tree.copyNodes(nodes, targetRowId?, position?): boolean; // 落位执行器：深克隆插入（跨树 move/copy 的目标侧）
tree.removeNodes(ids): boolean; // 删除 ids（含子树），供跨树 move 移除源树等流程使用
tree.addNodes(nodes, parentId?, position?): boolean; // 新增：parentId 为 null 加到根级；position 为 'end'（默认）/ 'first' / 某个兄弟 id（插到其之前）
```

## 常见场景

### 子节点懒加载

```ts
const options: TreeOptions<Node> = {
  idField: 'id',
  displayField: 'name',
  childrenField: 'children',        // 子节点数组所在字段，默认 'children'
  hasChildrenField: 'hasChildren',  // 标记“还有子节点”的字段，默认 'hasChildren'
  loadChildren: (node) =>
    fetch(`/api/${node.id}/children`).then((r) => r.json()) as Promise<Node[]>,
};
```

`childrenField` 本身只能是**字段名字符串**（不像 `idField` / `displayField` 能传取值函数），
可变的只是该字段的**值**。

**子级来源**按以下顺序解析，均为「首次展开才拉取、之后复用缓存」：

1. `childrenField` 指向的字段值：数组（已加载，直接用） 
2. 以上拿不到来源时，才用全局 `loadChildren`

**一次性展开整棵懒加载树**：`expandAll()` 只展开已加载分支（不发起请求），所以对懒加载树只能
展开当前已就位的那一层。要“一直展开到最深层”请用 `expandAllRecursive()`：

```ts
await tree.expandAllRecursive();   // 层内并发、层间串行，全部落定后 resolve
```

它逐层对**尚未请求过**的懒加载分支拉取子级；已请求过的分支（含返回空数组的）不会重复请求，因此可安全地
重复调用。由于每次加载子节点成功都会回写数据源，加载过程中会依次发出多次 `loadChildren` / `dataChange`。

### 复选框：三态级联 / 独立勾选

```ts
const options: TreeOptions<Node> = {
  useCheckbox: true,
  useTriState: true,   // 默认；置 false 即「各勾各的」
};
```

- `useTriState: true`（默认）：以叶子为勾选单元，勾选父节点会整组勾选 / 取消其子树，
  父节点状态由后代统计派生（全选 → 勾选，部分 → 半选 indeterminate）；
- `useTriState: false`：父子互不联动，点击任一节点只切换**它自己**，父节点同样可被独立勾选，
  且不会出现半选态。此时 `getCheckedIds()` 返回的就是被勾选的节点 id；
- 两种模式都经 `(selectionChange)` 输出 `selectedNodes`（`getCheckedIds()` / `getCheckedNodes()`
  可按需取值），键盘 `Space` 与鼠标点击行为一致；
- 过滤期间复选框自动隐藏（`checkboxState === 'hidden'`），此时 `Space` 退回行点击语义。

> 切换 `useTriState` 会改变勾选集合的语义（三态下集合内是「已勾选子树内的 id」），
> 运行期切换时建议一并重置勾选状态（`tree.setChecked([])` / `tree.clearState()`）。

### 拖拽与放置校验

```ts
const options: TreeOptions<Node> = {
  // 参数是本次被拖动的全部节点（多选整组拖动时不止一个），组内有 root 就整组禁拖
  allowDrag: (nodes) => !nodes.some((n) => n.type === 'root'),
  allowDrop: (ctx) => {
    if (ctx.isSelf || ctx.isDescendant) return false;   // 自身/后代（内置默认也拦截）
    if (ctx.position === 'child' && ctx.target?.type === 'leaf') return false;
    return true;
  },
};
```

### 跨树拖拽（两棵树之间搬运）

默认一棵树的拖拽只作用于自身。要让两棵树之间能互相拖动节点，需满足三个条件：

1. 两棵树的 `options.crossTree` 都不是 `'disabled'`（`'move'` 与 `'copy'` 目前等价，仅表示「本树参与跨树拖拽」）；
2. 两棵树的 `options.dragGroup` 相同（避免同页不相干的多棵树互相接收）；
3. 两棵树使用同一套节点数据类型，且节点 id 全局不重复。

行为要点：

- 拖拽悬停到目标树时，目标树整树高亮（`.is-cross-drag-target`）并按行显示落点指示；
- 目标树自己的 `allowDrop` 依旧参与校验（例如“文件不能作为容器”仍然生效）；
- 目标树为空时，拖到树内空白区域按「根级末尾」放入；
- 目标树已存在与被拖子树相同的 id 时，本次放置会被判定为无效落点（`drop.dropped = false`，防止行 key 冲突）；
- 松手后库**不会**改动任何数据：`(dragEnd)` 只在源树发一次，载荷里 `drop.external` 为 `true`，
  并给出接收树实例（`drop.targetTree`）、落点行/方位、被拖节点（`draggedNodes`）与指针事件（含 Ctrl/⌘）。

**move / copy 的语义完全由使用方决定**：`crossTree` 只是参与开关；真正如何落位写在
`(dragEnd)` 处理器里——参考实现：Ctrl/⌘ 拖放 = copy，否则默认 move；树内放置恒为 move
（同树复制会重复 id，不受支持）：

```ts
// 模板：监听源树与目标树的 dragEnd（各管自己被拖出/被放入的落位）
// 数据源被就地改写，不需要 (dataChange) 回写；需要感知变化再加 (dataChange)
<ng-draggable-tree [nodes]="leftNodes()"  [options]="sourceOpts" (dragEnd)="onSourceDragEnd($event)"  />
<ng-draggable-tree [nodes]="rightNodes()" [options]="targetOpts" (dragEnd)="onTargetDragEnd($event)"  />

// 页面：dragEnd 处理器示例（左右两棵树挂同一套逻辑，side 区分）
type End = TreeDragEndEvent<Node>;
function onDragEnd(side: 'left' | 'right', e: End): void {
  const d = e.drop;
  if (!d.dropped) return;                              // 无效落点：直接忽略，数据没变
  if (!d.external) {                                   // 树内重排
    const tree = side === 'left' ? leftTree() : rightTree();
    tree?.moveNodes(e.draggedIds, d.targetRowId, d.position);
    return;
  }
  // 跨树：目标树已由 d.targetTree 给出；wantCopy 决定 move 还是 copy
  const wantCopy = (e.event as MouseEvent | undefined)?.ctrlKey
    || (e.event as MouseEvent | undefined)?.metaKey;   // 按修饰键/业务规则自行决定
  const inserted = d.targetTree!.copyNodes(e.draggedNodes, d.targetRowId, d.position);
  if (inserted && !wantCopy) d.sourceTree.removeNodes(e.draggedIds); // move = 插入后移除源树
}
```

`drop` 载荷（`TreeDropResult`）里 `sourceTree` / `targetTree` 是组件实例，可直接调用其公开方法；
`targetRowId` / `position` / `parentId` 描述落点；`event` 含修饰键，可做任意定制规则。
真正数据更新后库发出 `(dataChange)`（载荷即数据源引用）告知数据已变更。

**程序化触发 move / copy / remove（不经过拖拽）**：每棵树实例暴露公开执行器，
成功后发出 `(dataChange)`：

```ts
// 同树重排：把节点 2 移到节点 1 之前
tree.moveNodes(['2'], '1', 'before');

// 跨树复制：把另一棵树（或其快照）的节点克隆插入本树根级
rightTree.copyNodes(sourceNodes, null, 'after'); // sourceNodes 会被深克隆；同 id 冲突返回 false

// 跨树移动的“移除源树”一侧
sourceTree.removeNodes(['2']);                    // 删掉 ids（含子树），成功后发 dataChange
```

### 实时过滤

```ts
// template: (input) 绑定 input 事件调用 tree.filter(value)
tree.filter('关键 词');
```

过滤期间：**只高亮匹配词**；其祖先路径强制展开并保留；无关分支整支裁剪；复选框自动隐藏。
被强制展开的分支**不可折叠**——箭头仍显示（非叶子），但点击 / 键盘折叠都会被静默忽略
（`toggleNode` 同理），避免“看似折叠、实则与过滤结果冲突”；清空关键字后展开态恢复过滤前的原样。
可折叠性由 `TreeRowApi.isRowCollapsible(row)` 给出（行模板可复用），渲染层的锁定箭头带
`is-locked` 类与 `aria-disabled="true"`，并用禁用手型光标替代 pointer。
懒加载节点在过滤期间仍可点击箭头加载（加载出的新命中节点会补进过滤视图）。
可用 `filterFn` 自定义匹配（如同时对多个字段、做拼音匹配等）。

命中高亮由 `highlightMode` 决定（默认 `'keyword'`）：

- `'keyword'`：默认 label 路径把显示文本按关键字切成片段，**只有命中的子串**渲染为
  `<mark class="ng-draggable-tree-hit">`（配色取 `--ng-draggable-tree-highlight-bg`），
  整段 label 不再着色；关键字按**字面量**匹配（不当作正则），不区分大小写，全部出现位置都会标出。
  分支内含命中（自身或后代）的行，箭头会着强调色，避免只剩“词高亮”后失去分支定位线索。
  自定义 `filterFn` 若按非显示字段命中（code / 拼音 / 其它字段等），显示文本里定位不到子串，
  此时该行**整段高亮兜底**，不会出现“行显示了却毫无命中提示”；
- `'label'`：整段 label 高亮（旧行为，`is-highlight` + `--ng-draggable-tree-highlight-bg`）。

> `'keyword'` 模式下 `is-match` 不再给整个 label 着色（类名钩子仍保留在行上），
> 需要自定义样式时用 `.is-match` / `.is-child-match` / `.ng-draggable-tree-hit`。
> 自定义 `#treeNodeTemplate` 不受 `highlightMode` 影响，可用 `TreeHighlightPipe`
> 配合模板上下文里的 `keyword` 自行实现（见「自定义节点模板」）。

命中**范围**由 `autoShow` 决定（默认 `true`）：

- `true`：保留命中节点的**父子路径**——祖先路径一并展示、被强制展开且不可折叠，便于看清命中项在树中的位置；
- `false`：**只展示命中节点自身**——祖先路径不出现，深层命中节点会穿透未命中的中间层各自独立成行（结果集形式）。
  此时结果行不可展开（不显示展开箭头、不触发懒加载）：该视图没有「展开出后代」的语义，子级只在自身命中时独立成行。
  行仍按原始 `depth` 缩进以保留层级线索，需要完全扁平可按结果列表排布时，在 `.is-filter-flat` 作用域内覆盖行内边距。

> 两种模式都保留 `matched`（自身命中）判定与命中词高亮；`false` 时不产生「祖先路径行」，
> 因此 `subtreeHasMatch`（模板里的 `is-child-match`）在该视图下恒为 false。

### 数据源与变更通知

组件在 `[nodes]` 传入的数组上**就地改写**（不克隆、也不回写输入），所以事件是“通知”而非“新数据”：

```html
<ng-draggable-tree [nodes]="nodes()" [options]="options" (dataChange)="onDataChanged()" />
```

- 移动 / 复制 / 删除 / 懒加载落位后，`dataChange` 带着**数据源本身的引用**发出：你手里的数组已经是新的，无需 `nodes.set(...)`；
- 有派生状态（统计、JSON 预览等）依赖数据时，在 `(dataChange)` 里手动刷新（如 `version.update(v => v + 1)`）；
- 外部就地改数据（`data().push(node)`）后想通知组件，调用 `tree.refresh()`；
- 需要一份与数据源隔离的深克隆副本：`tree.snapshot()`（`tree.getData()` 同样是深克隆，不是数据源引用——
  引用就是你传给 `[nodes]` 的那个数组，或 `(dataChange)` 的载荷）。

### 定点更新单个节点（不重建整棵树）

外部整体替换 `[nodes]` 会重建内部模型：重算定位索引与结构行、重置懒加载簿记，
并让**所有**可见行换新对象（整树重渲染）。若只是改名、打标签这类**展示字段**的修改，
用 `updateRow` 定点改写：只有命中那一行会换新对象并重渲染，其余行的对象引用与视图保持稳定。

```ts
// 字段补丁
tree.updateRow('2', { name: '新名称', disabled: true });

// 或按当前节点算补丁（参数是工作树中的节点，返回补丁对象）
tree.updateRow('2', (node) => ({ name: `${node.name}(已归档)` }));

// 就地改写但不发 dataChange（静默更新）
tree.updateRow('2', { name: '临时' }, { emit: false });
```

- 返回 `false` 表示未执行：节点不存在，或补丁改动了 `id` / `children`（结构变更会被整体回滚）。
- 折叠中 / 被过滤隐藏的节点同样可以更新（按内部索引定位，不要求当前可见）；
  过滤中若命中结果变化，可见行集合会同步重算。
- `emit` 默认 `true`：照常发 `(dataChange)`；传 `false` 则静默改写
  （数据已在数据源上就地更新，仅少了事件通知）。
- 增删、移动等结构变更请用新的 `[nodes]`，或 `moveNodes` / `copyNodes` / `removeNodes`。

### 自定义节点模板

在 `<ng-draggable-tree>` 内投影一个 `<ng-template #treeNodeTemplate>` 即可自定义每行的主内容区
（节点的label，不包含箭头、复选框）。缺省时按 `displayField` 显示文本。

```html
<ng-draggable-tree [nodes]="nodes()" [options]="options">
  <ng-template #treeNodeTemplate let-node let-row="row">
    <span class="file-icon">📄</span>
    <span>{{ node.name }}</span>
    @if (row.depth > 0 && row.selected) {
      <span class="tag">已选中</span>
    }
  </ng-template>
</ng-draggable-tree>
```

模板上下文（即 `TreeNodeTemplateContext<T>`）：

| 变量 | 说明 |
| --- | --- |
| `$implicit`（let-node） | 节点原始数据 |
| `node` | 同上，节点原始数据 |
| `row` | 当前行模型（`depth/expanded/isLeaf/expanderVisible/selected/active/matched` 等）；`row.node` 为 TreeNode 视图 |
| `api` | 行行为 API（`onToggleExpand`、`onClick`、`onDelete`…），供模板内自定义交互。`onToggleExpand` 与箭头可见性无关：调用即切换，不可切换的行静默忽略 |
| `keyword` | 当前过滤关键字（未过滤时为空串），配合 `treeHighlight` 管道做「只高亮匹配词」 |

自定义模板里复用命中词高亮（`TreeHighlightPipe` 已包含在组件里，模板无需额外 import）：

```html
<ng-template #treeNodeTemplate let-node let-row="row" let-keyword="keyword">
  <span class="file-icon">📄</span>
  <span>@for (seg of node.name | treeHighlight : keyword : row.matched; track $index) {@if (seg.hit) {<mark>{{ seg.text }}</mark>} @else {<span>{{ seg.text }}</span>}}</span>
</ng-template>
```

> 第三个参数是该行是否自身命中：显示文本里定位不到关键字时（自定义 `filterFn` 按其它字段命中）
> 整段高亮兜底。也可直接用纯函数 `splitHighlight(text, keyword, fallback)` 自行渲染。
> 片段渲染请用插值输出，不要拼接 HTML —— 库不做 innerHTML，天然无注入风险。

### 右键菜单（`#contextMenuTemplate`）

菜单内容**完全由 `<ng-template #contextMenuTemplate>` 决定**：
未投影模板时右键不弹菜单、也不阻止浏览器原生菜单，只发出 `(contextMenu)` 事件。

投影 `<ng-template #contextMenuTemplate>` 即可接管菜单内容：

```html
<ng-draggable-tree [nodes]="nodes()" [options]="options">
  <ng-template #contextMenuTemplate let-node let-row="row" let-api="api" let-close="close">
    <div class="my-menu">
      <button type="button" (click)="rename(node); close()">重命名</button>
      <button type="button" (click)="api.onDelete(row); close()">删除</button>
    </div>
  </ng-template>
</ng-draggable-tree>
```

模板上下文（即 `TreeContextMenuTemplateContext<T>`）：

| 变量 | 说明 |
| --- | --- |
| `$implicit`（let-node） | 右键命中的节点原始数据 |
| `node` | 同上，节点原始数据 |
| `row` | 命中行的行模型（`depth / expanded / selected / isLeaf` 等）；`row.node` 为 TreeNode 视图 |
| `api` | 行行为 API（`onToggleExpand` / `onDelete` / `selectOnly`…），与行模板一致 |
| `close` | 关闭菜单。自定义菜单项执行完操作后请调用它 |
| `event` | 触发菜单的原始 `MouseEvent`；由 `tree.openContextMenu()` 打开时为 `null` |

行为与样式：

- 菜单挂在 CDK Overlay 层（`document.body > .cdk-overlay-container`），不会被树容器的
  `overflow` / 定位裁剪，并按视口空间自动翻转（右下 → 右上 → 左下 → 左上）；
- 菜单**没有遮罩**：菜单之外的页面元素照常可操作 
  按 `Esc`、或滚动页面 / 任意容器都会关闭菜单（菜单面板自身的滚动除外）；
- 自定义内容的样式请写全局 CSS（或 `ViewEncapsulation.None`）——菜单不在你的组件 DOM 树内。
  面板容器类为 `.ng-draggable-tree-menu-panel`；库另提供 `.ng-draggable-tree-menu` /
  `.ng-draggable-tree-menu-item`（含 `.is-danger`）等样式类，自定义菜单内容可直接复用，
  也可用 `.ng-draggable-tree-menu-custom` 重设自定义内容容器观感；
  树的主题变量（`--ng-draggable-tree-*`）会内联到菜单宿主，暗色主题下同样生效；
- 程序化控制：`tree.openContextMenu(nodeId, { x, y })` / `tree.closeContextMenu()` /
  `tree.contextMenuOpen()`；未投影模板时 `openContextMenu()` 返回 `false`；
- 右键**始终**发出 `(contextMenu)` 事件（无论是否弹菜单）；有模板但想对某些节点不弹浮层时，
  把 `contextMenu` 设为 `false` 或传函数按节点判定即可。

### 懒加载 loading 模板

懒加载进行中同样可用 `#loadingTemplate` 替换内置 spinner：

```html
<ng-draggable-tree [nodes]="nodes()" [options]="options">
  <ng-template #loadingTemplate let-node let-index="index">
    <span>正在加载 {{ node.name }}…</span>
  </ng-template>
</ng-draggable-tree>
```

上下文含 `$implicit/node`（节点数据）、`row`（行模型）与 `index`（可见行下标）。

### 自定义拖拽幽灵模板

启用拖拽（`allowDrag`）后，拖动行时会有一个跟随指针的“幽灵”。缺省情况下组件会
克隆被拖拽行作为幽灵快照（Ctrl/Cmd 多选整组拖动时，快照右侧会自动附加一个节点数
角标，提示本次共拖动几行）；你可以在树内投影 `<ng-template #dragGhostTemplate>`
用 Angular 模板完全接管幽灵外观：

```html
<ng-draggable-tree [nodes]="nodes()" [options]="options">
  <ng-template #dragGhostTemplate let-node let-row="row" let-draggedNodes="draggedNodes">
    <span class="my-ghost">
      📄 {{ node.name }}
      @if (draggedNodes.length > 1) {
        <em>等 {{ draggedNodes.length }} 项</em>
      }
    </span>
  </ng-template>
</ng-draggable-tree>
```

幽灵被渲染在 `document.body` 上的固定层（避免被树容器裁剪），因此：
- 幽灵的样式请写全局 CSS 或使用 `body > .ng-draggable-tree-drag-ghost` 等选择器；
- 组件会把树的主题 CSS 变量（`--ng-draggable-tree-*`）内联到幽灵宿主，可直接复用。

模板上下文（即 `TreeDragGhostTemplateContext<T>`）：

| 变量 | 说明 |
| --- | --- |
| `$implicit`（let-node） | 被拖拽起始节点的原始数据 |
| `node` | 同上 |
| `row` | 起始节点的行模型（`depth / selected / isLeaf` 等）；`row.node` 为 TreeNode 视图 |
| `api` | 行行为 API（与行模板一致） |
| `draggedNodes` | 本次拖拽的全部节点（Ctrl/Cmd 多选拖拽时数量大于 1），可据此显示“N 项”角标 |

### 行模型与 TreeNode 视图（`row.node`）

行模型 `TreeRow<T>` 除 `depth / expanded / isLeaf / expanderVisible / selected / checked …` 等展示字段外，
还挂了一个轻量 **TreeNode 视图** `row.node`，把「节点在树中的位置 + 状态」以树语义暴露出来：

| 成员 | 说明 |
| --- | --- |
| `data` | 节点原始数据（工作树中的引用，不是副本） |
| `id` | 节点 id |
| `parent` | 父节点视图；根节点为 `null` |
| `depth` | 层级（根为 0） |
| `index` | 在父级数组（或根数组）中的下标 |
| `isExpanded` / `isSelected` / `isChecked` / `isLoading` | 状态 getter，**实时**读取状态集合（不做快照） |
| `getState()` | 一次取回 `{ expanded, selected, checked, loading }` |
| `setState(patch)` | 按字段写状态（只改状态集合，**不发事件、不改数据**） |

```html
<ng-template #treeNodeTemplate let-node let-row="row">
  {{ node.name }}
  @if (row.node.parent; as parent) {
    <span class="tag">上级：{{ parent.data.name }}</span>
  }
  @if (row.node.isExpanded) {
    <span class="tag">展开中</span>
  }
</ng-template>
```

模板之外可用 `tree.nodeOf(id)` 取同一视图；节点因折叠/过滤而不可见时返回 `null`
（与 `expandNode` / `selectNode` 等按 id 接口的有效范围一致）。

## 主题

组件使用 CSS 变量，可在全局覆盖（类名作用域）：

```css
.ng-draggable-tree-root {
  --ng-draggable-tree-font: inherit;                  /* 字体 */
  --ng-draggable-tree-fg: #333;                       /* 文字 */
  --ng-draggable-tree-fg-muted: #999;                 /* 次级文字（空态 / 图标等） */
  --ng-draggable-tree-bg: transparent;                /* 背景 */
  --ng-draggable-tree-row-hover: rgba(0,0,0,.05);     /* 行 hover */
  --ng-draggable-tree-row-active: rgba(13,110,253,.1);/* 焦点行 */
  --ng-draggable-tree-row-selected: rgba(13,110,253,.18); /* 选中行 */
  --ng-draggable-tree-accent: #0d6efd;                /* 强调色（选中 / 焦点 / 复选框 / 命中分支箭头） */
  --ng-draggable-tree-border: #d9d9d9;                /* 连接线 / 边框 */
  --ng-draggable-tree-radius: 4px;                    /* 圆角 */
  --ng-draggable-tree-size: 40px;                     /* 行高 */
  --ng-draggable-tree-arrow-width: 16px;              /* 箭头 / 缩进宽度单位 */
  --ng-draggable-tree-highlight-bg: rgba(255,213,0,.45); /* 命中高亮底色 */
  --ng-draggable-tree-drop: #0d6efd;                  /* 拖拽落点指示色 */
  --ng-draggable-tree-menu-bg: #fff;                  /* 右键菜单背景 */
}
```

过滤命中相关：`--ng-draggable-tree-highlight-bg`（高亮底色）· `--ng-draggable-tree-accent`
（命中分支箭头 / 旧 `is-match` 整标签着色）；命中词元素为 `.ng-draggable-tree-hit`。
（内置暗色主题同样只是覆盖上面这组变量，见 `tree.styles.scss`。）

## 键盘操作

`↑/↓` 移动焦点 · `→` 展开（或进入子级） · `←` 折叠（或返回父级；过滤视图下必为返回父级） ·
`Space` 切换勾选（`useCheckbox` 且该行复选框可见时；否则等同选中） · `Enter` 选中 ·
`Home/End` 首末行 · `Delete` 删除。

空格键在复选框模式下遵循树控件约定「切换勾选」（行的选中语义交给 `Enter`）；过滤期间复选框
自动隐藏，此时 `Space` 退回选中语义，不会产生不可见控件上的勾选。

## 单元测试

库单元测试使用 Vitest（`@angular/build:unit-test`）：

```bash
ng test ng-draggable-tree --watch=false
```

覆盖 `tree.model.ts`（扁平化/复选统计/子树集合/后代判断）、`tree.operations.ts`
（增删改移等纯函数）与组件真实渲染行为（展开、复选框、拖拽与键盘删除等）。

## 在本地工程直接消费

```bash
npm run build:lib        # 产出 dist/ng-draggable-tree
npm run pack:lib         # 或打包 tgz
npm install ../dist/ng-draggable-tree/ng-draggable-tree-*.tgz   # 在目标应用安装
```
