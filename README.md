# ng-draggable-tree（workspace）

基于 `@angular/cdk/tree` 的 Angular 树形组件库及其示例应用（Angular 22 单仓库）。

| 目录 | 说明 |
| --- | --- |
| `projects/ng-draggable-tree` | 组件库源码（`NgDraggableTreeComponent`）与单元测试 |
| `src/` | 示例应用：多路由真实交互 Demo（基础 / 复选 / 懒加载 / 拖拽 / 过滤） |
| `dist/ng-draggable-tree` | `ng build ng-draggable-tree` 产物|

## 特性

- 扁平化 + `CdkTree` / `ArrayDataSource` 渲染，节点数量大也可用虚拟滚动扩展
- 复选框级联：三态级联（`useCheckbox` + `useTriState`，叶子为勾选单元，父节点派生半选态）或关闭三态后各节点独立勾选
- 删除：`Delete` 键删除节点（含子树），可用 `confirmDelete` 做删除前确认
- 子节点懒加载：用 `hasChildrenField` 标记“还有子节点” + `loadChildren` 拉取（`childrenField` **只能**是字段名字符串；首次展开拉取并缓存，结果**就地写入**数据源中的该节点（发 `loadChildren` / `dataChange`）
- 拖拽排序：行拖拽 + `allowDrop` 自定义放置规则 + 多选整组拖动（内置克隆幽灵会在右侧显示节点数角标）；松手不自动改动数据——`(dragEnd)` 携带完整落点上下文，由你调用公开执行器 `moveNodes` 落位
- 跨树拖拽：同一 `dragGroup` 且 `crossTree` 启用的两棵树可互相拖入（悬停高亮与落点指示、空树根级放入）；move / copy 语义由 `(dragEnd)` 处理器自行编排（`targetTree.copyNodes` + `sourceTree.removeNodes`）
- 实时过滤：`filter()` 收窄可见分支、**只高亮匹配词**（默认；`highlightMode: 'label'` 可切回整标签高亮）、默认保留祖先路径（`autoShow: false` 可改为只显示命中节点自身）、可自定义 `filterFn`；过滤期间被强制展开的分支不可折叠（箭头只作状态指示），清空后恢复原展开态
- 右键菜单：内容完全由 `<ng-template #contextMenuTemplate>` 决定（库不内置菜单项，未投影模板时不弹菜单、也不阻止浏览器原生菜单，只发 `(contextMenu)` 事件交给使用方处理）；由 CDK Overlay 承载，自动视口翻转、无遮罩（菜单外元素照常可点，单击 / 双击 / 右键 / 滚动即关闭）
- **数据模型：直接接管 `[nodes]` 并就地改写**（不克隆、不回写输入）；数据源变动（新数组引用）整树重构并按 id 保留状态，**展开 / 折叠不重构树**（仅懒加载落位例外）；结构变更发 `dataChange`（载荷即数据源引用），需要隔离副本时用 `tree.snapshot()`
- 中文内置文本、全局 CSS 变量主题、`dir: rtl` 支持

## 快速上手

```ts
import { Component, signal } from '@angular/core';
import { NgDraggableTreeComponent, type TreeOptions } from 'ng-draggable-tree';

interface Node { id: string; name: string; children?: Node[]; }

@Component({
  selector: 'app-demo',
  imports: [NgDraggableTreeComponent],
  template: '<ng-draggable-tree [nodes]="nodes()" [options]="options" />',
})
export class Demo {
  readonly nodes = signal<Node[]>([
    { id: '1', name: '项目', children: [{ id: '1-1', name: 'src' }] },
    { id: '2', name: '文档' },
  ]);

  readonly options: TreeOptions<Node> = {
    idField: 'id',
    displayField: 'name',
    childrenField: 'children',        // 子节点数组所在字段
    hasChildrenField: 'hasChildren',  // 标记“还有子节点”的字段（懒加载用）
    showLine: true,
  };
}
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm start` | 启动示例应用（`ng serve ngx-cdk-tree-workspace`） |
| `npm run build:lib` | 构建组件库（输出到 `dist/ng-draggable-tree`） |
| `npm run build:demo` | 构建示例应用 |
| `npm test` | 运行全部测试 |
| `npm run test:lib` | 运行库单元测试（Vitest） |
| `npm run pack:lib` | 构建库并本地打包 `.tgz`，便于 `npm install <tgz>` 试装 |
| `npm run publish:lib` | 构建并发布到 npm（执行前请确认已登录与版本号） |

> 示例应用在仓库内指向 `projects/ng-draggable-tree/src` 以便随时调试库源码。


## 文档

- 库完整 API 文档见 [`projects/ng-draggable-tree/README.md`](projects/ng-draggable-tree/README.md)
- 交互示例：`npm start` 后访问各路由 `/basic`、`/checkbox`、`/lazy`、`/drag`、`/filter`
