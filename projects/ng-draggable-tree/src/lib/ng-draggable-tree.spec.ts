import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NgDraggableTreeComponent } from './ng-draggable-tree';
import type { TreeOptions } from './tree-options';

interface DemoNode {
  id: string;
  name: string;
  children?: DemoNode[];
}

const ROOTS: DemoNode[] = [
  {
    id: '1',
    name: '项目',
    children: [
      { id: '1-1', name: 'src', children: [{ id: '1-1-1', name: 'main.ts' }] },
      { id: '1-2', name: 'docs' },
    ],
  },
  { id: '2', name: '文档' },
];

type Fixture = ComponentFixture<unknown>;

/** 懒加载用例数据：节点不含已加载的子级，由 loadChildren 在首次展开时提供 */
const LAZY_ROOTS: DemoNode[] = [
  { id: '1', name: '项目' },
  { id: '2', name: '文档' },
];

/**
 * 结构克隆夹具数据。组件「原地修改数据源」，共享的模块级常量必须按例复制，
 * 否则前一个用例的增删/移动会污染后续用例。
 */
function cloneFixture(data: DemoNode[]): DemoNode[] {
  return data.map((n) => ({
    ...n,
    ...(n.children ? { children: cloneFixture(n.children) } : {}),
  }));
}

function setup(
  optionsOverride: Partial<TreeOptions<DemoNode>> = {},
  roots: DemoNode[] = ROOTS,
): {
  fixture: Fixture;
  tree: NgDraggableTreeComponent<DemoNode>;
} {
  @Component({
    imports: [NgDraggableTreeComponent],
    template: `<ng-draggable-tree [nodes]="nodes()" [options]="options" />`,
  })
  class Host {
    readonly nodes = signal<DemoNode[]>(cloneFixture(roots));
    readonly options = {
      idField: 'id',
      displayField: 'name',
      childrenField: 'children',
      ...optionsOverride,
    } as TreeOptions<DemoNode>;
  }

  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  const tree = fixture.debugElement.query(By.directive(NgDraggableTreeComponent))
    .componentInstance as unknown as NgDraggableTreeComponent<DemoNode>;
  return { fixture, tree };
}

/** 投影了 #treeNodeTemplate 的宿主，用于验证自定义节点模板 */
function setupWithNodeTemplate(): {
  fixture: Fixture;
  tree: NgDraggableTreeComponent<DemoNode>;
} {
  @Component({
    imports: [NgDraggableTreeComponent],
    template: `
      <ng-draggable-tree [nodes]="nodes()" [options]="options">
        <ng-template #treeNodeTemplate let-node let-row="row">
          <span class="tpl-node-name">{{ node.name }}</span>
          <span class="tpl-node-depth">{{ row.depth }}</span>
        </ng-template>
      </ng-draggable-tree>
    `,
  })
  class Host {
    readonly nodes = signal<DemoNode[]>(cloneFixture(ROOTS));
    readonly options: TreeOptions<DemoNode> = {
      idField: 'id',
      displayField: 'name',
      childrenField: 'children',
    };
  }

  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  const tree = fixture.debugElement.query(By.directive(NgDraggableTreeComponent))
    .componentInstance as unknown as NgDraggableTreeComponent<DemoNode>;
  return { fixture, tree };
}

/** 投影了 #dragGhostTemplate 的宿主，用于验证自定义拖拽幽灵 */
function setupWithDragGhostTemplate(): {
  fixture: Fixture;
  tree: NgDraggableTreeComponent<DemoNode>;
} {
  @Component({
    imports: [NgDraggableTreeComponent],
    template: `
      <ng-draggable-tree [nodes]="nodes()" [options]="options">
        <ng-template #dragGhostTemplate let-node let-row="row" let-draggedNodes="draggedNodes">
          <span class="tpl-ghost-name">{{ node.name }}</span>
          <span class="tpl-ghost-depth">{{ row.depth }}</span>
          <span class="tpl-ghost-count">{{ draggedNodes.length }}</span>
        </ng-template>
      </ng-draggable-tree>
    `,
  })
  class Host {
    readonly nodes = signal<DemoNode[]>(cloneFixture(ROOTS));
    readonly options: TreeOptions<DemoNode> = {
      idField: 'id',
      displayField: 'name',
      childrenField: 'children',
      allowDrag: true,
    };
  }

  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  const tree = fixture.debugElement.query(By.directive(NgDraggableTreeComponent))
    .componentInstance as unknown as NgDraggableTreeComponent<DemoNode>;
  return { fixture, tree };
}

/** 渲染并冲刷若干帧（CDK Tree 数据连接为微任务） */
async function flush(fixture: Fixture): Promise<void> {
  fixture.detectChanges();
  await Promise.resolve();
  fixture.detectChanges();
  await Promise.resolve();
  fixture.detectChanges();
}

const rowsOf = (fixture: Fixture) => fixture.debugElement.queryAll(By.css('.ng-draggable-tree-row'));

function rowById(fixture: Fixture, id: string) {
  return rowsOf(fixture).find((r) => r.nativeElement.dataset['treeid'] === id);
}

function clickOn(element: Element, type: string): void {
  element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('NgDraggableTreeComponent', () => {
  it('默认折叠渲染顶层行：非叶子带展开箭头、叶子仅留占位', async () => {
    const { fixture } = setup();
    await flush(fixture);
    const rows = rowsOf(fixture);
    expect(rows.length).toBe(2);
    // 非叶子（有子节点 / 待懒加载）一律显示箭头
    expect(rows[0].query(By.css('.ng-draggable-tree-toggle'))).not.toBeNull();
    // 叶子无箭头，仅保留等宽占位以对齐缩进
    expect(rows[1].query(By.css('.ng-draggable-tree-toggle'))).toBeNull();
    expect(rows[1].query(By.css('.ng-draggable-tree-toggle-spacer'))).not.toBeNull();
    fixture.destroy();
  });

  it('空数据：显示默认空态文案「暂无数据」', async () => {
    const { fixture } = setup({}, []);
    await flush(fixture);
    const empty = fixture.debugElement.query(By.css('.ng-draggable-tree-empty'));
    expect(empty.nativeElement.textContent.trim()).toBe('暂无数据');
    fixture.destroy();
  });

  it('空数据：options.emptyMessage 覆盖空态文案', async () => {
    const { fixture } = setup({ emptyMessage: '还没有节点' }, []);
    await flush(fixture);
    const empty = fixture.debugElement.query(By.css('.ng-draggable-tree-empty'));
    expect(empty.nativeElement.textContent.trim()).toBe('还没有节点');
    fixture.destroy();
  });

  it('options 引用变化但内容不变时不重建视图，内容变化时才重建', async () => {
    @Component({
      imports: [NgDraggableTreeComponent],
      template: `<ng-draggable-tree [nodes]="nodes()" [options]="options()" />`,
    })
    class Host {
      readonly nodes = signal<DemoNode[]>(cloneFixture(ROOTS));
      readonly options = signal<TreeOptions<DemoNode>>({
        idField: 'id',
        displayField: 'name',
        childrenField: 'children',
      });
    }

    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    const tree = fixture.debugElement.query(By.directive(NgDraggableTreeComponent))
      .componentInstance as unknown as NgDraggableTreeComponent<DemoNode>;
    await flush(fixture);

    const before = tree.treeRows();
    // 同内容的新对象：应跳过重建，行数组引用保持不变
    fixture.componentInstance.options.set({
      idField: 'id',
      displayField: 'name',
      childrenField: 'children',
    });
    await flush(fixture);
    expect(tree.treeRows()).toBe(before);

    // 内容真正变化：仍会重建
    fixture.componentInstance.options.set({
      idField: 'id',
      displayField: 'name',
      childrenField: 'children',
      levelIndent: 40,
    });
    await flush(fixture);
    expect(tree.treeRows()).not.toBe(before);
    fixture.destroy();
  });

  it('点击展开箭头后子行可见，再点折叠恢复', async () => {
    const { fixture } = setup();
    await flush(fixture);
    clickOn(rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-toggle'))!.nativeElement, 'click');
    await flush(fixture);
    expect(rowsOf(fixture).length).toBe(4);
    clickOn(rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-toggle'))!.nativeElement, 'click');
    await flush(fixture);
    expect(rowsOf(fixture).length).toBe(2);
    fixture.destroy();
  });

  it('单击选中行并发出 selectionChange', async () => {
    const { fixture, tree } = setup();
    const events: string[] = [];
    tree.selectionChange.subscribe((e) => events.push(String(e.nodeId)));
    await flush(fixture);
    clickOn(rowsOf(fixture)[1].nativeElement, 'click');
    await flush(fixture);
    expect(events).toContain('2');
    expect(rowsOf(fixture)[1].classes['is-selected']).toBe(true);
    fixture.destroy();
  });

  it('装饰状态（选中/勾选）变化不触发结构层重建：未受影响的行对象引用保持稳定', async () => {
    const { fixture, tree } = setup({ useCheckbox: true, selectOnClick: false });
    await flush(fixture);
    const before = tree.treeRows();
    expect(before.length).toBe(2);

    // 选中：仅被选中行按装饰态重建，其余行复用——结构层未因选中集合变化而重算
    tree.selectNode('2');
    await flush(fixture);
    const selected = tree.treeRows();
    expect(selected[0]).toBe(before[0]);
    expect(selected[1]).not.toBe(before[1]);
    expect(selected[1].selected).toBe(true);

    // 勾选：复选框三态统计虽然变化，同样不重建结构层
    tree.treeState.setState('checked', new Set(['2']));
    await flush(fixture);
    const checked = tree.treeRows();
    expect(checked[0]).toBe(selected[0]);
    expect(checked[1].checkboxState).toBe('checked');
    fixture.destroy();
  });

  it('复选框模式：父节点勾选联动叶子并支持取消', async () => {
    const { fixture } = setup({ useCheckbox: true, selectOnClick: false });
    await flush(fixture);
    clickOn(rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-toggle'))!.nativeElement, 'click');
    await flush(fixture);
    expect(rowById(fixture, '1-2')!.query(By.css('.ng-draggable-tree-checkbox-box'))!.classes['is-checked']).toBeFalsy();

    clickOn(rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-checkbox'))!.nativeElement, 'click');
    await flush(fixture);
    expect(rowById(fixture, '1-2')!.query(By.css('.ng-draggable-tree-checkbox-box'))!.classes['is-checked']).toBe(true);
    expect(rowById(fixture, '1')!.query(By.css('.ng-draggable-tree-checkbox-box'))!.classes['is-checked']).toBe(true);

    clickOn(rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-checkbox'))!.nativeElement, 'click');
    await flush(fixture);
    expect(rowById(fixture, '1-2')!.query(By.css('.ng-draggable-tree-checkbox-box'))!.classes['is-checked']).toBeFalsy();
    fixture.destroy();
  });

  it('懒加载：点击箭头首次展开时调用加载器并展示加载结果', async () => {
    const loader = vi.fn(async (node: DemoNode) => [
      { id: `${node.id}-c`, name: `${node.name} 的子级` },
    ]);
    const { fixture } = setup({ loadChildren: (node: DemoNode) => loader(node) }, LAZY_ROOTS);
    await flush(fixture);
    expect(rowsOf(fixture).length).toBe(2);
    clickOn(rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-toggle'))!.nativeElement, 'click');
    await flush(fixture);
    await flush(fixture);
    expect(loader).toHaveBeenCalledTimes(1);
    const rows = rowsOf(fixture);
    const texts = rows.map((r) =>
      (r.query(By.css('.ng-draggable-tree-label'))?.nativeElement.textContent ?? '').trim(),
    );
    expect(texts).toEqual(['项目', '项目 的子级', '文档']);
    fixture.destroy();
  });

  it('懒加载：已加载分支折叠后再展开直接命中缓存，不重复请求', async () => {
    const loader = vi.fn(async (node: DemoNode) => [
      { id: `${node.id}-c`, name: `${node.name} 的子级` },
    ]);
    const { fixture } = setup({ loadChildren: (node: DemoNode) => loader(node) }, LAZY_ROOTS);
    await flush(fixture);

    // 首次展开 → 触发加载并展示子级
    const caret = () => rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-toggle'))!;
    clickOn(caret().nativeElement, 'click');
    await flush(fixture);
    await flush(fixture);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(rowsOf(fixture).length).toBe(3);

    // 折叠
    clickOn(caret().nativeElement, 'click');
    await flush(fixture);
    expect(rowsOf(fixture).length).toBe(2);

    // 再次展开：加载器不再调用，子级即时可见
    clickOn(caret().nativeElement, 'click');
    await flush(fixture);
    await flush(fixture);
    expect(loader).toHaveBeenCalledTimes(1);
    const texts = rowsOf(fixture).map((r) =>
      (r.query(By.css('.ng-draggable-tree-label'))?.nativeElement.textContent ?? '').trim(),
    );
    expect(texts).toEqual(['项目', '项目 的子级', '文档']);
    fixture.destroy();
  });

  it('懒加载：返回空结果 → 仍是父节点（箭头保留），且不重复请求', async () => {
    const loader = vi.fn(async (_node: DemoNode) => [] as DemoNode[]);
    const { fixture } = setup({ loadChildren: (node: DemoNode) => loader(node) }, LAZY_ROOTS);
    await flush(fixture);
    // 展开前：待加载的父节点带箭头
    expect(rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-toggle'))).not.toBeNull();
    clickOn(rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-toggle'))!.nativeElement, 'click');
    await flush(fixture);
    await flush(fixture);
    expect(loader).toHaveBeenCalledTimes(1);
    // 无子级可展示
    expect(rowsOf(fixture).length).toBe(2);
    // 加载结果为空：仍是父节点，折叠展开按钮保留（用户可收回），但不再发起请求
    expect(rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-toggle'))).not.toBeNull();
    clickOn(rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-toggle'))!.nativeElement, 'click');
    await flush(fixture);
    clickOn(rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-toggle'))!.nativeElement, 'click');
    await flush(fixture);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(rowsOf(fixture).length).toBe(2);
    fixture.destroy();
  });

  it('懒加载：hasChildrenField 标记决定箭头显示，展开时按需拉取', async () => {
    const loader = vi.fn(async (node: DemoNode) => [
      { id: `${node.id}-c`, name: `${node.name} 的子级` },
    ]);

    @Component({
      imports: [NgDraggableTreeComponent],
      template: `<ng-draggable-tree [nodes]="nodes()" [options]="options" />`,
    })
    class HasChildrenHost {
      readonly nodes = signal<DemoNode[]>([
        { id: '1', name: '项目', hasChildren: true } as DemoNode,
        { id: '2', name: '文档', hasChildren: false } as DemoNode,
        { id: '3', name: '无标记' },
      ]);
      readonly options: TreeOptions<DemoNode> = {
        idField: 'id',
        displayField: 'name',
        childrenField: 'children',
        hasChildrenField: 'hasChildren',
        loadChildren: (node) => loader(node),
      };
    }

    TestBed.configureTestingModule({ imports: [HasChildrenHost] });
    const fixture = TestBed.createComponent(HasChildrenHost);
    await flush(fixture);
    const rows = rowsOf(fixture);
    // true → 加载前即显示箭头；false → 明确按叶子处理；无标记 → 仍由全局 loadChildren 兜底
    expect(rows[0].query(By.css('.ng-draggable-tree-toggle'))).not.toBeNull();
    expect(rows[1].query(By.css('.ng-draggable-tree-toggle'))).toBeNull();
    expect(rows[2].query(By.css('.ng-draggable-tree-toggle'))).not.toBeNull();

    // 展开后按需拉取子节点
    clickOn(rows[0].query(By.css('.ng-draggable-tree-toggle'))!.nativeElement, 'click');
    await flush(fixture);
    await flush(fixture);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(rowsOf(fixture).map((r) => r.nativeElement.dataset['treeid'])).toEqual([
      '1',
      '1-c',
      '2',
      '3',
    ]);
    fixture.destroy();
  });

  it('双向绑定 [(nodes)]：懒加载完成后原地写入数据源，并发出 dataChange 通知', async () => {
    @Component({
      imports: [NgDraggableTreeComponent],
      template: `<ng-draggable-tree [(nodes)]="data" [options]="options" />`,
    })
    class TwoWayHost {
      readonly data = signal<DemoNode[]>([
        { id: '1', name: '项目' },
        { id: '2', name: '文档' },
      ]);
      readonly options: TreeOptions<DemoNode> = {
        idField: 'id',
        displayField: 'name',
        childrenField: 'children',
        loadChildren: (node: DemoNode) =>
          Promise.resolve([{ id: `${node.id}-c`, name: `${node.name} 子级` }]),
      };
    }

    TestBed.configureTestingModule({ imports: [TwoWayHost] });
    const fixture = TestBed.createComponent(TwoWayHost);
    const host = fixture.componentInstance;
    const tree = fixture.debugElement.query(By.directive(NgDraggableTreeComponent))
      .componentInstance as unknown as NgDraggableTreeComponent<DemoNode>;
    const changes: DemoNode[][] = [];
    tree.dataChange.subscribe((list) => changes.push(list));
    await flush(fixture);
    expect(rowsOf(fixture).length).toBe(2);

    // 首次展开 → 异步拉取子级
    clickOn(rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-toggle'))!.nativeElement, 'click');
    await flush(fixture);
    await flush(fixture);

    // 数据源已被原地写入：加载出的子节点直接出现在绑定数组里（引用不变、内容更新）
    expect(host.data()[0].children?.map((n) => n.id)).toEqual(['1-c']);
    expect(rowsOf(fixture).length).toBe(3);
    // 通知载荷与数据源是同一引用（原地修改语义，不产生快照克隆）
    expect(changes.length).toBe(1);
    expect(changes[0]).toBe(host.data());
    // 快照可见已加载子级
    expect(tree.snapshot()[0].children?.length).toBe(1);
    fixture.destroy();
  });

  it('双向绑定 [(nodes)]：命令式改动（moveNodes）同样回写数据源', async () => {
    @Component({
      imports: [NgDraggableTreeComponent],
      template: `<ng-draggable-tree [(nodes)]="data" />`,
    })
    class TwoWayHost {
      readonly data = signal<DemoNode[]>([
        { id: '1', name: '项目', children: [{ id: '1-1', name: 'src' }] },
        { id: '2', name: '文档' },
      ]);
    }

    TestBed.configureTestingModule({ imports: [TwoWayHost] });
    const fixture = TestBed.createComponent(TwoWayHost);
    const host = fixture.componentInstance;
    const tree = fixture.debugElement.query(By.directive(NgDraggableTreeComponent))
      .componentInstance as unknown as NgDraggableTreeComponent<DemoNode>;
    await flush(fixture);

    expect(tree.moveNodes(['1-1'], '2', 'child')).toBe(true);
    await flush(fixture);

    expect(host.data()[1].children?.map((n) => n.id)).toEqual(['1-1']);
    expect(host.data()[0].children?.length ?? 0).toBe(0);
    // 目标节点自动展开以露出被移动的子树
    expect(rowsOf(fixture).length).toBe(3);
    fixture.destroy();
  });

  it('懒加载：空目录加载后仍是父节点，箭头保留且再切换不重复请求', async () => {
    const loader = vi.fn(async (_node: DemoNode) => [] as DemoNode[]);
    const { fixture, tree } = setup(
      { loadChildren: (node: DemoNode) => loader(node) },
      LAZY_ROOTS,
    );
    await flush(fixture);
    const toggleOf = () => rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-toggle'));
    // 加载前：待懒加载的父节点显示展开箭头
    expect(toggleOf()).not.toBeNull();

    // 首次展开 → 空目录：仍是父节点，折叠展开按钮保留（叶子不显示按钮）
    clickOn(toggleOf()!.nativeElement, 'click');
    await flush(fixture);
    await flush(fixture);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(rowsOf(fixture).length).toBe(2);
    expect(toggleOf()).not.toBeNull();

    // 语义层仍可折叠/展开，且不重复请求
    tree.toggleNode('1');
    await flush(fixture);
    tree.toggleNode('1');
    await flush(fixture);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(rowsOf(fixture).length).toBe(2);
    fixture.destroy();
  });

  it('toggleNode：叶子节点按切换语义处理，不因无箭头而顺带聚焦/选中', async () => {
    const { fixture, tree } = setup();
    const selected: string[] = [];
    tree.selectionChange.subscribe((e) => selected.push(String(e.nodeId)));
    await flush(fixture);
    // '2' 是顶层叶子（无展开箭头）
    tree.toggleNode('2');
    await flush(fixture);
    expect(rowsOf(fixture).length).toBe(2);
    expect(selected).toEqual([]);
    expect(tree.getSelectedNodes()).toEqual([]);
    fixture.destroy();
  });

  it('expandNode/collapseNode：懒加载节点触发加载后展开，折叠后再展开复用缓存', async () => {
    const loader = vi.fn(async (node: DemoNode) => [
      { id: `${node.id}-c`, name: `${node.name} 的子级` },
    ]);
    const { fixture, tree } = setup({ loadChildren: (node: DemoNode) => loader(node) }, LAZY_ROOTS);
    await flush(fixture);
    const idsOf = () => rowsOf(fixture).map((r) => r.nativeElement.dataset['treeid']);

    // 程序化展开 → 触发一次加载并展示子级
    tree.expandNode('1');
    await flush(fixture);
    await flush(fixture);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(idsOf()).toEqual(['1', '1-c', '2']);

    // 折叠后再次展开 → 命中缓存，不重复请求
    tree.collapseNode('1');
    await flush(fixture);
    expect(idsOf()).toEqual(['1', '2']);
    tree.expandNode('1');
    await flush(fixture);
    await flush(fixture);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(idsOf()).toEqual(['1', '1-c', '2']);
    fixture.destroy();
  });

  it('自定义节点模板：投影 treeNodeTemplate 后渲染自定义内容并可访问 row 上下文', async () => {
    const { fixture } = setupWithNodeTemplate();
    await flush(fixture);
    const names = fixture.debugElement
      .queryAll(By.css('.tpl-node-name'))
      .map((n) => n.nativeElement.textContent?.trim());
    expect(names).toEqual(['项目', '文档']);
    expect(fixture.debugElement.query(By.css('.ng-draggable-tree-label'))).toBeNull();
    expect(
      fixture.debugElement.queryAll(By.css('.tpl-node-depth')).map((d) => d.nativeElement.textContent?.trim()),
    ).toEqual(['0', '0']);

    // 展开后的子行同样使用自定义模板
    clickOn(rowsOf(fixture)[0].query(By.css('.ng-draggable-tree-toggle'))!.nativeElement, 'click');
    await flush(fixture);
    expect(
      fixture.debugElement.queryAll(By.css('.tpl-node-name')).map((n) => n.nativeElement.textContent?.trim()),
    ).toEqual(['项目', 'src', 'docs', '文档']);
    fixture.destroy();
  });

  it('提供 #dragGhostTemplate 时拖拽开始渲染自定义幽灵，拖拽结束清理', async () => {
    const { fixture, tree } = setupWithDragGhostTemplate();
    await flush(fixture);
    const row = tree.treeRows()[0];
    expect(row.data.name).toBe('项目');

    tree.rowApi.onDragStart(row, rowsOf(fixture)[0].nativeElement as HTMLElement);
    await flush(fixture);
    const ghost = document.body.querySelector('.ng-draggable-tree-drag-ghost-custom');
    expect(ghost).not.toBeNull();
    expect(document.body.querySelector('.tpl-ghost-name')?.textContent?.trim()).toBe('项目');
    expect(document.body.querySelector('.tpl-ghost-depth')?.textContent?.trim()).toBe('0');
    expect(document.body.querySelector('.tpl-ghost-count')?.textContent?.trim()).toBe('1');

    tree.rowApi.onDragEnd(row);
    await flush(fixture);
    expect(document.body.querySelector('.ng-draggable-tree-drag-ghost-custom')).toBeNull();
    expect(document.body.querySelector('.tpl-ghost-name')).toBeNull();
    fixture.destroy();
  });

  it('未提供 #dragGhostTemplate 时拖拽开始克隆被拖行作为幽灵，拖拽结束清理', async () => {
    const { fixture, tree } = setup({ allowDrag: true });
    await flush(fixture);
    const row = tree.treeRows()[0];

    tree.rowApi.onDragStart(row, rowsOf(fixture)[0].nativeElement as HTMLElement);
    await flush(fixture);
    const ghost = document.body.querySelector('.ng-draggable-tree-drag-ghost');
    expect(ghost).not.toBeNull();
    expect(ghost?.textContent).toContain('项目');
    // 单节点拖拽不显示数量角标
    expect(ghost?.querySelector('.ng-draggable-tree-drag-count')).toBeNull();

    tree.rowApi.onDragEnd(row);
    await flush(fixture);
    expect(document.body.querySelector('.ng-draggable-tree-drag-ghost')).toBeNull();
    fixture.destroy();
  });

  it('多选拖拽：缺省幽灵在右侧展示拖动的节点数角标', async () => {
    const { fixture, tree } = setup({ allowDrag: true, multiSelect: true });
    await flush(fixture);
    const els = rowsOf(fixture).map((r) => r.nativeElement as HTMLElement);
    els[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    els[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    await flush(fixture);
    expect(tree.getSelectedNodes().map((n) => n.id)).toEqual(['1', '2']);

    const row = tree.treeRows()[0];
    tree.rowApi.onDragStart(row, els[0]);
    await flush(fixture);
    const ghost = document.body.querySelector('.ng-draggable-tree-drag-ghost');
    expect(ghost).not.toBeNull();
    expect(ghost?.classList.contains('is-multi')).toBe(true);
    const badge = ghost?.querySelector('.ng-draggable-tree-drag-count');
    expect(badge).not.toBeNull();
    expect(badge?.textContent?.trim()).toBe('2');

    tree.rowApi.onDragEnd(row);
    await flush(fixture);
    expect(document.body.querySelector('.ng-draggable-tree-drag-ghost')).toBeNull();
    fixture.destroy();
  });

  it('allowDrag 回调收到本次被拖动的全部节点：单选为自身、多选为整组', async () => {
    const seen: string[][] = [];
    const grabbableIds = (f: Fixture) =>
      rowsOf(f)
        .filter((r) => r.nativeElement.classList.contains('is-grabbable'))
        .map((r) => r.nativeElement.dataset['treeid'] as string);

    const { fixture, tree } = setup({
      allowDrag: (nodes: DemoNode[]) => {
        seen.push(nodes.map((n) => n.id));
        return !nodes.some((n) => n.id === '2'); // 组里含 '2' 就整组禁拖
      },
      multiSelect: true,
    });
    await flush(fixture);

    // 未多选：每行只带自己 → '2' 禁拖、'1' 可拖
    expect(seen).toContainEqual(['1']);
    expect(seen).toContainEqual(['2']);
    expect(grabbableIds(fixture)).toEqual(['1']);

    // Ctrl 多选后整组拖动：两行都收到整组 → 整组禁拖
    const els = rowsOf(fixture).map((r) => r.nativeElement as HTMLElement);
    els[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    els[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    seen.length = 0;
    await flush(fixture);

    expect(tree.getSelectedNodes().map((n) => n.id)).toEqual(['1', '2']);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((ids) => ids.join() === '1,2')).toBe(true);
    expect(grabbableIds(fixture)).toEqual([]);

    fixture.destroy();
  });

  it('拖拽移动时幽灵跟随指针的 client 坐标（CDK pointerPosition 陈旧时也不偏移）', async () => {
    const { fixture, tree } = setup({ allowDrag: true });
    await flush(fixture);
    const row = tree.treeRows()[0];
    const source = rowsOf(fixture)[0].nativeElement as HTMLElement;

    tree.rowApi.onDragStart(row, source);
    await flush(fixture);
    const ghost = document.body.querySelector('.ng-draggable-tree-drag-ghost') as HTMLElement;
    expect(ghost).not.toBeNull();

    // 模拟页面已滚动 55/66px：CDK pointerPosition 退化成了 page 坐标（350+55, 220+66），
    // 而原生事件的 clientX/clientY 仍是视口坐标（350, 220）。幽灵必须跟随后者。
    const move = new MouseEvent('mousemove', { clientX: 350, clientY: 220, bubbles: true });
    tree.rowApi.onDragMoved(row, { pointerPosition: { x: 405, y: 286 }, event: move });
    await flush(fixture);

    expect(ghost.style.left).toBe('362px'); // 350 + 12
    expect(ghost.style.top).toBe('228px'); // 220 + 8

    tree.rowApi.onDragEnd(row);
    await flush(fixture);
    expect(document.body.querySelector('.ng-draggable-tree-drag-ghost')).toBeNull();
    fixture.destroy();
  });
});

describe('公共放置执行器 moveNodes / copyNodes', () => {
  const topLevelIds = (fixture: Fixture) =>
    rowsOf(fixture).map((r) => r.nativeElement.dataset['treeid'] as string);

  it('moveNodes：程序化把本树节点移到目标之前，改数据并发出 dataChange', async () => {
    const { fixture, tree } = setup({ allowDrag: true });
    let changed = 0;
    tree.dataChange.subscribe(() => changed++);
    await flush(fixture);
    expect(topLevelIds(fixture)).toEqual(['1', '2']);

    const moved = tree.moveNodes(['2'], '1', 'before');
    await flush(fixture);

    expect(moved).toBe(true);
    expect(topLevelIds(fixture)).toEqual(['2', '1']);
    expect(tree.getData().map((n) => n.id)).toEqual(['2', '1']);
    expect(changed).toBeGreaterThan(0);
    fixture.destroy();
  });

  it('moveNodes：目标行不可见/节点不存在时返回 false 且不改数据', async () => {
    const { fixture, tree } = setup({ allowDrag: true });
    await flush(fixture);

    // '1-1' 处于折叠父级下（不可见）——不作为公开执行器的目标行
    expect(tree.moveNodes(['2'], '1-1', 'before')).toBe(false);
    expect(tree.moveNodes(['ghost'], '1', 'child')).toBe(false);
    expect(topLevelIds(fixture)).toEqual(['1', '2']);
    fixture.destroy();
  });

  it('copyNodes：把外部载荷深克隆到根级并发出 dataChange；同 id 载荷重复放入被拒绝', async () => {
    const { fixture, tree } = setup({ allowDrag: true });
    let changed = 0;
    tree.dataChange.subscribe(() => changed++);
    await flush(fixture);

    const payload: DemoNode[] = [
      { id: 'ext-1', name: '外部目录', children: [{ id: 'ext-1-1', name: 'a.txt' }] },
    ];
    expect(tree.copyNodes(payload)).toBe(true);
    await flush(fixture);
    expect(topLevelIds(fixture)).toEqual(['1', '2', 'ext-1']);
    expect(tree.getData()[2].id).toBe('ext-1');
    expect(changed).toBeGreaterThan(0);

    // 载荷被深克隆，不共享引用
    payload[0].name = '外部目录(改动)';
    payload[0].children![0].name = 'a(改动)';
    await flush(fixture);
    const inserted = tree.getData()[2];
    expect(inserted.name).toBe('外部目录');
    expect(inserted.children![0].name).toBe('a.txt');

    // 目标树已含同 id → 拒绝再次放入（key 冲突保护）
    expect(tree.copyNodes([{ id: 'ext-1', name: '再来一份' } as DemoNode])).toBe(false);
    expect(tree.getData().length).toBe(3);
    fixture.destroy();
  });
});

/** 在自定义模板里使用 row.node（类 TreeNode 视图）的宿主 */
function setupWithNodeViewTemplate(): {
  fixture: Fixture;
  tree: NgDraggableTreeComponent<DemoNode>;
} {
  @Component({
    imports: [NgDraggableTreeComponent],
    template: `
      <ng-draggable-tree [nodes]="nodes()" [options]="options">
        <ng-template #treeNodeTemplate let-node let-row="row">
          <span class="tpl-node-id">{{ row.node.id }}</span>
          <span class="tpl-node-depth">{{ row.node.depth }}</span>
          <span class="tpl-node-index">{{ row.node.index }}</span>
          @if (row.node.parent; as parent) {
            <span class="tpl-node-parent">{{ parent.data.name }}</span>
          }
          @if (row.node.isExpanded) {
            <span class="tpl-node-opened">已展开</span>
          }
        </ng-template>
      </ng-draggable-tree>
    `,
  })
  class Host {
    readonly nodes = signal<DemoNode[]>(cloneFixture(ROOTS));
    readonly options: TreeOptions<DemoNode> = {
      idField: 'id',
      displayField: 'name',
      childrenField: 'children',
    };
  }

  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  const tree = fixture.debugElement.query(By.directive(NgDraggableTreeComponent))
    .componentInstance as unknown as NgDraggableTreeComponent<DemoNode>;
  return { fixture, tree };
}

describe('TreeNode 视图 / 状态门面（方案 B：索引 + 视图 + 状态）', () => {
  it('nodeOf 提供 parent / depth / index 树语义，状态实时读取', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);

    const root = tree.nodeOf('1')!;
    expect(root).not.toBeNull();
    expect(root.id).toBe('1');
    expect(root.depth).toBe(0);
    expect(root.index).toBe(0);
    expect(root.parent).toBeNull();
    expect(root.isExpanded).toBe(false);
    expect(root.getState()).toEqual({ expanded: false, selected: false, checked: false, loading: false });
    expect(tree.nodeOf('2')!.index).toBe(1);

    // 展开后子级可见：父子链在同一次行管线扫描内解析
    tree.expandNode('1');
    await flush(fixture);
    const rootAfter = tree.nodeOf('1')!;
    const child = tree.nodeOf('1-1')!;
    expect(child.parent).toBe(rootAfter);
    expect(child.depth).toBe(1);
    expect(child.index).toBe(0);
    expect(rootAfter.isExpanded).toBe(true);
    // 行模型上的视图与 nodeOf 一致
    expect(tree.treeRows()[1].node).toBe(child);
    fixture.destroy();
  });

  it('不可见行没有视图：折叠父级下的节点返回 null', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);
    expect(tree.nodeOf('1-1')).toBeNull(); // 父级未展开
    tree.expandNode('1');
    await flush(fixture);
    expect(tree.nodeOf('1-1')).not.toBeNull();
    tree.collapseNode('1');
    await flush(fixture);
    expect(tree.nodeOf('1-1')).toBeNull();
    fixture.destroy();
  });

  it('装饰状态变化不重建视图（结构未变时引用稳定）', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);
    const before = tree.nodeOf('2')!;
    tree.selectNode('2');
    await flush(fixture);
    const after = tree.nodeOf('2')!;
    expect(after).toBe(before);
    expect(after.isSelected).toBe(true); // 状态实时读，不依赖重建
    fixture.destroy();
  });

  it('node.setState 只写状态：不发 expand 事件、不改数据', async () => {
    const { fixture, tree } = setup();
    const expanded: unknown[] = [];
    tree.expand.subscribe((e) => expanded.push(e));
    await flush(fixture);

    tree.nodeOf('1')!.setState({ expanded: true });
    await flush(fixture);

    expect(tree.nodeOf('1')!.isExpanded).toBe(true);
    expect(tree.nodeOf('1-1')).not.toBeNull(); // 子级随之可见
    expect(expanded).toEqual([]); // 未走事件路径
    expect(tree.getData()[0].children!.length).toBe(2); // 数据不因状态变化而变
    fixture.destroy();
  });

  it('treeState 门面按种类读写集合状态（内部仍是 Set）', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);
    expect(tree.treeState.getState('expanded').size).toBe(0);

    tree.treeState.setState('expanded', new Set(['1']));
    await flush(fixture);
    expect(tree.treeState.hasState('expanded', '1')).toBe(true);
    expect(tree.nodeOf('1')!.isExpanded).toBe(true);

    expect(tree.treeState.mutateState('expanded', (draft) => draft.delete('1'))).toBe(true);
    expect(tree.treeState.mutateState('expanded', (draft) => draft.delete('1'))).toBe(false); // 无变化不写回
    await flush(fixture);
    expect(tree.nodeOf('1')!.isExpanded).toBe(false);
    fixture.destroy();
  });

  it('自定义模板可直接使用 row.node（AOT 类型检查通过）', async () => {
    const { fixture, tree } = setupWithNodeViewTemplate();
    await flush(fixture);
    expect(fixture.debugElement.queryAll(By.css('.tpl-node-id')).map((d) => d.nativeElement.textContent.trim()))
      .toEqual(['1', '2']);
    expect(fixture.debugElement.queryAll(By.css('.tpl-node-parent')).length).toBe(0); // 根级无 parent

    tree.expandNode('1');
    await flush(fixture);
    // '1-1' 的父级为 '项目'
    expect(fixture.debugElement.queryAll(By.css('.tpl-node-parent')).map((d) => d.nativeElement.textContent.trim()))
      .toEqual(['项目', '项目']);
    expect(fixture.debugElement.queryAll(By.css('.tpl-node-depth')).map((d) => d.nativeElement.textContent.trim()))
      .toEqual(['0', '1', '1', '0']);
    // '1' 已展开 → 模板里的 isExpanded 生效（row.node 状态实时读）
    expect(fixture.debugElement.queryAll(By.css('.tpl-node-opened')).length).toBe(1);
    fixture.destroy();
  });
});

describe('关键字过滤：autoShow 只显示命中节点自身', () => {
  it('祖先路径不出现，结果行无箭头、也不可展开', async () => {
    const { fixture, tree } = setup({ autoShow: false });
    await flush(fixture);

    tree.filter('main');
    await flush(fixture);

    const visibleIds = () => rowsOf(fixture).map((r) => r.nativeElement.dataset['treeid']);
    expect(visibleIds()).toEqual(['1-1-1']); // 祖先 '1' / '1-1' 不展示

    const el = () => rowById(fixture, '1-1-1')!.nativeElement as HTMLElement;
    expect(el().querySelector('.ng-draggable-tree-toggle')).toBeNull(); // 结果行不展示展开箭头
    expect(el().querySelector('.ng-draggable-tree-toggle-spacer')).not.toBeNull();
    expect(el().getAttribute('aria-expanded')).toBeNull();
    expect(tree.treeRows()[0].depth).toBe(2); // 仍按原始层级缩进，保留层级线索

    // 交互层同样不可展开：写入展开集合被忽略，可见行不变
    tree.onToggleExpand(tree.treeRows()[0]);
    await flush(fixture);
    expect(tree.getExpandedIds()).toEqual([]);
    expect(visibleIds()).toEqual(['1-1-1']);

    // 清空关键字后恢复完整树视图（展开态未被污染）
    tree.filter('');
    await flush(fixture);
    expect(visibleIds()).toEqual(['1', '2']);

    fixture.destroy();
  });
});

describe('关键字过滤：箭头显示与折叠禁用', () => {
  it('过滤态下命中的分支被强制展开并显示箭头，点击箭头不折叠', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);
    const collapseEvents: unknown[] = [];
    tree.collapse.subscribe((e) => collapseEvents.push(e));

    tree.filter('main');
    await flush(fixture);

    // '1' → 'src' → 'main.ts'：命中节点与其祖先路径可见，非叶子行被强制展开呈现
    const visibleIds = () => rowsOf(fixture).map((r) => r.nativeElement.dataset['treeid']);
    expect(visibleIds()).toEqual(['1', '1-1', '1-1-1']);
    const toggle = () => rowById(fixture, '1')!.query(By.css('.ng-draggable-tree-toggle'));
    const toggleEl = () => toggle()!.nativeElement as HTMLButtonElement;
    expect(toggle()).not.toBeNull(); // 非叶子：过滤视图同样显示箭头
    // 锁定态：箭头可见但不可折叠 → aria-disabled + is-locked（禁用手型光标）
    expect(toggleEl().classList.contains('is-locked')).toBe(true);
    expect(toggleEl().getAttribute('aria-disabled')).toBe('true');

    clickOn(toggle()!.nativeElement, 'click');
    await flush(fixture);

    // 折叠被忽略：可见行与展开集合都不变，也没有 collapse 事件
    expect(visibleIds()).toEqual(['1', '1-1', '1-1-1']);
    expect(tree.getExpandedIds()).toEqual([]);
    expect(collapseEvents).toEqual([]);

    // 过滤结束：展开态回到过滤前的原样（未被折叠过）
    tree.filter('');
    await flush(fixture);
    expect(visibleIds()).toEqual(['1', '2']);

    // 非过滤态下箭头恢复可折叠（锁定态与 aria-disabled 一并撤销）
    tree.expandNode('1');
    await flush(fixture);
    expect(visibleIds()).toEqual(['1', '1-1', '1-2', '2']);
    expect(toggleEl().classList.contains('is-locked')).toBe(false);
    expect(toggleEl().getAttribute('aria-disabled')).toBeNull();
    clickOn(toggle()!.nativeElement, 'click');
    await flush(fixture);
    expect(visibleIds()).toEqual(['1', '2']);
    fixture.destroy();
  });

  it('过滤态下左方向键不折叠，改为把焦点交回父级', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);
    const collapseEvents: unknown[] = [];
    tree.collapse.subscribe((e) => collapseEvents.push(e));

    tree.filter('main');
    await flush(fixture);

    // jsdom 未实现 scrollIntoView，而焦点移动会调用它 → 打桩
    const originalScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    const root = fixture.debugElement.query(By.css('.ng-draggable-tree-root')).nativeElement as HTMLElement;
    const activeId = () => (document.activeElement as HTMLElement | null)?.dataset['treeid'];
    const press = (key: string) => root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    try {
      press('ArrowDown'); // 焦点落到 'src'：过滤态下展开的分支
      expect(activeId()).toBe('1-1');

      press('ArrowLeft');
      // 分支不可折叠 → 回退语义：焦点回到父级
      expect(activeId()).toBe('1');
      expect(collapseEvents).toEqual([]);
      expect(tree.getExpandedIds()).toEqual([]);
    } finally {
      Element.prototype.scrollIntoView = originalScroll;
      fixture.destroy();
    }
  });

  it('过滤态下懒加载节点点击箭头仍可加载：命中的新子级补进过滤视图', async () => {
    const loader = vi.fn(async (node: DemoNode) => [{ id: `${node.id}-c`, name: `${node.name} 的子级` }]);
    const { fixture, tree } = setup({ loadChildren: (node: DemoNode) => loader(node) }, LAZY_ROOTS);
    await flush(fixture);

    // 关键字命中懒加载节点自身：可见但仍折叠（子级未加载）
    tree.filter('项目');
    await flush(fixture);
    expect(rowsOf(fixture).map((r) => r.nativeElement.dataset['treeid'])).toEqual(['1']);
    const toggle = () => rowById(fixture, '1')!.query(By.css('.ng-draggable-tree-toggle'));
    expect(toggle()).not.toBeNull();
    // 未展开的行（点击箭头即“展开/加载”）：不是锁定态，不标 aria-disabled
    expect(toggle()!.nativeElement.classList.contains('is-locked')).toBe(false);
    expect(toggle()!.nativeElement.getAttribute('aria-disabled')).toBeNull();

    clickOn(toggle()!.nativeElement, 'click');
    await flush(fixture);
    await flush(fixture);
    expect(loader).toHaveBeenCalledTimes(1);
    // 展开（懒加载）在过滤态下不被禁用：加载出的子级命中同一关键字 → 补进过滤视图
    expect(rowsOf(fixture).map((r) => r.nativeElement.dataset['treeid'])).toEqual(['1', '1-c']);
    expect(tree.getExpandedIds()).toEqual(['1']);
    fixture.destroy();
  });
});

describe('键盘 Space：复选框模式下切换勾选', () => {
  /** 树根键盘入口的测试夹具：焦点移动会调用 scrollIntoView，jsdom 未实现 → 打桩 */
  function keyboard(fixture: Fixture) {
    const originalScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    const root = fixture.debugElement.query(By.css('.ng-draggable-tree-root')).nativeElement as HTMLElement;
    return {
      press: (key: string) => root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })),
      restore: () => {
        Element.prototype.scrollIntoView = originalScroll;
      },
    };
  }

  it('Space 切换当前行勾选（父级联动叶子），再按一次取消', async () => {
    const { fixture, tree } = setup({ useCheckbox: true, selectOnClick: false });
    await flush(fixture);
    const kb = keyboard(fixture);
    try {
      kb.press(' '); // 焦点未建立时以首行（'1'）为当前行
      await flush(fixture);
      // 父级勾选 → 整棵子树 id 入集（叶子态由统计派生），父/子复选框均呈勾选
      expect(tree.getCheckedIds()).toEqual(['1', '1-1', '1-1-1', '1-2']);
      expect(rowById(fixture, '1')!.query(By.css('.ng-draggable-tree-checkbox-box'))!.classes['is-checked'])
        .toBe(true);

      kb.press(' ');
      await flush(fixture);
      expect(tree.getCheckedIds()).toEqual([]);
      expect(rowById(fixture, '1')!.query(By.css('.ng-draggable-tree-checkbox-box'))!.classes['is-checked'])
        .toBeFalsy();
    } finally {
      kb.restore();
      fixture.destroy();
    }
  });

  it('未启用复选框：Space 保持原有点击语义', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);
    const clicks: unknown[] = [];
    tree.click.subscribe((e) => clicks.push(e));
    const kb = keyboard(fixture);
    try {
      kb.press(' ');
      await flush(fixture);
      expect(clicks).toHaveLength(1);
      expect(tree.getCheckedIds()).toEqual([]);
    } finally {
      kb.restore();
      fixture.destroy();
    }
  });

  it('过滤期间复选框自动隐藏：Space 退回点击语义，不产生勾选', async () => {
    const { fixture, tree } = setup({ useCheckbox: true });
    await flush(fixture);
    tree.filter('main');
    await flush(fixture);
    const clicks: unknown[] = [];
    tree.click.subscribe((e) => clicks.push(e));
    const kb = keyboard(fixture);
    try {
      kb.press(' '); // 当前行 '1'：过滤态下复选框不可见 → 不可勾选
      await flush(fixture);
      expect(clicks).toHaveLength(1);
      expect(tree.getCheckedIds()).toEqual([]);
    } finally {
      kb.restore();
      fixture.destroy();
    }
  });
});

describe('递归展开：expandAllRecursive', () => {
  /** 三层懒加载：1 → 1-1 → 1-1-1，末端返回空数组（标记为叶子）终止递归 */
  function makeLoader() {
    return vi.fn(async (node: DemoNode): Promise<DemoNode[]> => {
      if (node.id === '1') return [{ id: '1-1', name: '一级' }];
      if (node.id === '1-1') return [{ id: '1-1-1', name: '二级' }];
      return [];
    });
  }

  const visibleIds = (fixture: Fixture) =>
    rowsOf(fixture).map((r) => r.nativeElement.dataset['treeid']);

  it('逐层加载并展开到最深层，await 后整棵树已就位', async () => {
    const loader = makeLoader();
    const { fixture, tree } = setup({ loadChildren: (node: DemoNode) => loader(node) }, LAZY_ROOTS);
    await flush(fixture);
    expect(visibleIds(fixture)).toEqual(['1', '2']); // 初始只有根层

    await tree.expandAllRecursive();
    await flush(fixture);

    // 三层全部加载并展开（'2' 加载为空 → 记为叶子但保持展开态）
    expect(visibleIds(fixture)).toEqual(['1', '1-1', '1-1-1', '2']);
    expect(tree.getExpandedIds()).toEqual(['1', '1-1', '1-1-1', '2']);
    // 每个懒加载分支只请求一次
    expect(loader.mock.calls.map(([n]) => n.id).sort()).toEqual(['1', '1-1', '1-1-1', '2']);
    fixture.destroy();
  });

  it('重复调用幂等：已请求过的分支不重复加载', async () => {
    const loader = makeLoader();
    const { fixture, tree } = setup({ loadChildren: (node: DemoNode) => loader(node) }, LAZY_ROOTS);
    await flush(fixture);

    await tree.expandAllRecursive();
    await flush(fixture);
    await tree.expandAllRecursive();
    await flush(fixture);

    expect(loader).toHaveBeenCalledTimes(4);
    expect(visibleIds(fixture)).toEqual(['1', '1-1', '1-1-1', '2']);
    fixture.destroy();
  });

  it('expandAll 只给待拉取分支补一层，不继续下钻', async () => {
    const loader = makeLoader();
    const { fixture, tree } = setup({ loadChildren: (node: DemoNode) => loader(node) }, LAZY_ROOTS);
    await flush(fixture);
    expect(visibleIds(fixture)).toEqual(['1', '2']); // 初始只有根层，两个都待拉取

    // 不 await：expandAll 返回 void，内部异步推进 —— 多轮 flush 等其全部落定
    tree.expandAll();
    await flush(fixture);
    await flush(fixture);
    await flush(fixture);
    await flush(fixture);

    // 只请求当时可见的待拉取分支（'1' / '2'）；'1' 加载出的 '1-1' 不再往下请求
    expect(loader.mock.calls.map(([n]) => n.id).sort()).toEqual(['1', '2']);
    // '1-1' 已就位但仍是折叠态（有自己的箭头），与展开着的 '1' / '2' 区分开
    expect(visibleIds(fixture)).toEqual(['1', '1-1', '2']);
    expect(tree.getExpandedIds()).toEqual(['1', '2']);

    // 再走递归版本才一层层铺到最后一层
    await tree.expandAllRecursive();
    await flush(fixture);
    expect(loader.mock.calls.map(([n]) => n.id).sort()).toEqual(['1', '1-1', '1-1-1', '2']);
    expect(visibleIds(fixture)).toEqual(['1', '1-1', '1-1-1', '2']);
    expect(tree.getExpandedIds()).toEqual(['1', '1-1', '1-1-1', '2']);
    fixture.destroy();
  });

  it('expandAll 覆盖全部父节点：含 children 为空与拉取结果为空的分支', async () => {
    const roots: DemoNode[] = [
      { id: '1', name: '有子级', children: [{ id: '1-1', name: '子级' }] },
      { id: '2', name: '空 children', children: [] },
      { id: '3', name: '拉取为空', hasChildren: true } as DemoNode,
      { id: '4', name: '明确叶子', hasChildren: false } as DemoNode,
    ];
    const loader = vi.fn(async (_node: DemoNode) => [] as DemoNode[]);
    const { fixture, tree } = setup(
      { hasChildrenField: 'hasChildren', loadChildren: (node: DemoNode) => loader(node) },
      roots,
    );
    await flush(fixture);

    tree.expandAll();
    await flush(fixture);
    await flush(fixture);
    await flush(fixture);
    await flush(fixture);

    // '2'（空数组）与 '3'（标记待拉取）都会走一次加载；'1-1' 无标记但有全局 loadChildren → 也拉取一次
    expect(loader.mock.calls.map(([n]) => n.id).sort()).toEqual(['1-1', '2', '3']);
    // 拉取为空的分支仍是父节点：与 '1'（有子数据）、'2'（空数组）同样进入展开集合；
    // '4' 明确标记 hasChildren: false → 叶子，不入集合
    expect(tree.getExpandedIds()).toEqual(['1', '1-1', '2', '3']);
    fixture.destroy();
  });
});

describe('复选框：useTriState = false', () => {
  /** 树根键盘入口夹具：焦点移动会调用 scrollIntoView，jsdom 未实现 → 打桩 */
  function keyboardOf(fixture: Fixture) {
    const originalScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    const root = fixture.debugElement.query(By.css('.ng-draggable-tree-root')).nativeElement as HTMLElement;
    return {
      press: (key: string) => root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })),
      restore: () => {
        Element.prototype.scrollIntoView = originalScroll;
      },
    };
  }

  const boxOf = (fixture: Fixture, id: string) =>
    rowById(fixture, id)!.query(By.css('.ng-draggable-tree-checkbox-box'))!;
  const boxClasses = (fixture: Fixture, id: string) => boxOf(fixture, id).classes;
  const checkboxOf = (fixture: Fixture, id: string) =>
    rowById(fixture, id)!.query(By.css('.ng-draggable-tree-checkbox'))!.nativeElement;
  const expandRow = async (fixture: Fixture, id: string) => {
    clickOn(rowById(fixture, id)!.query(By.css('.ng-draggable-tree-toggle'))!.nativeElement, 'click');
    await flush(fixture);
  };

  it('点击父复选框只切换自身，不联动后代', async () => {
    const { fixture, tree } = setup({ useCheckbox: true, useTriState: false, selectOnClick: false });
    await flush(fixture);
    await expandRow(fixture, '1');

    clickOn(checkboxOf(fixture, '1'), 'click');
    await flush(fixture);
    expect(tree.getCheckedIds()).toEqual(['1']); // 不再整棵子树入集
    expect(boxClasses(fixture, '1')['is-checked']).toBe(true);
    expect(boxClasses(fixture, '1-1')['is-checked']).toBeFalsy();
    expect(boxClasses(fixture, '1-2')['is-checked']).toBeFalsy();

    clickOn(checkboxOf(fixture, '1'), 'click');
    await flush(fixture);
    expect(tree.getCheckedIds()).toEqual([]);
    fixture.destroy();
  });

  it('不存在半选态：父级状态与后代互不影响', async () => {
    const { fixture, tree } = setup({ useCheckbox: true, useTriState: false, selectOnClick: false });
    await flush(fixture);
    await expandRow(fixture, '1');

    // 勾选子级 '1-2'：父级 '1' 既不勾选也不半选
    clickOn(checkboxOf(fixture, '1-2'), 'click');
    await flush(fixture);
    expect(tree.getCheckedIds()).toEqual(['1-2']);
    expect(boxClasses(fixture, '1')['is-checked']).toBeFalsy();
    expect(boxClasses(fixture, '1')['is-indeterminate']).toBeFalsy();
    expect(boxClasses(fixture, '1-2')['is-checked']).toBe(true);

    // 父级可独立勾选 / 取消，且不影响已勾选的子级
    clickOn(checkboxOf(fixture, '1'), 'click');
    await flush(fixture);
    expect(tree.getCheckedIds()).toEqual(['1', '1-2']);
    clickOn(checkboxOf(fixture, '1'), 'click');
    await flush(fixture);
    expect(tree.getCheckedIds()).toEqual(['1-2']);
    fixture.destroy();
  });

  it('Space 只切换当前行勾选（键盘路径同样受 useTriState 控制）', async () => {
    const { fixture, tree } = setup({ useCheckbox: true, useTriState: false, selectOnClick: false });
    await flush(fixture);
    const kb = keyboardOf(fixture);
    try {
      kb.press(' ');
      await flush(fixture);
      expect(tree.getCheckedIds()).toEqual(['1']);
      expect(boxClasses(fixture, '1')['is-checked']).toBe(true);
    } finally {
      kb.restore();
      fixture.destroy();
    }
  });

  it('setChecked：非三态下分支可被独立勾选', async () => {
    const { fixture, tree } = setup({ useCheckbox: true, useTriState: false });
    await flush(fixture);
    tree.setChecked(['1']);
    await flush(fixture);
    expect(boxClasses(fixture, '1')['is-checked']).toBe(true);
    expect(boxClasses(fixture, '1')['is-indeterminate']).toBeFalsy();
    expect(tree.getCheckedIds()).toEqual(['1']);
    fixture.destroy();
  });

  it('setChecked：三态下分支状态由叶子统计派生，传入分支 id 不显示为勾选', async () => {
    const { fixture, tree } = setup({ useCheckbox: true });
    await flush(fixture);
    tree.setChecked(['1']);
    await flush(fixture);
    expect(boxClasses(fixture, '1')['is-checked']).toBeFalsy();
    fixture.destroy();
  });
});

describe('初始状态字段：isExpandedField / isSelectedField', () => {
  /** 带初始状态标记的节点数据（默认字段 expanded / select，另有两个自定义字段名） */
  interface FlagNode extends DemoNode {
    expanded?: unknown;
    select?: unknown;
    open?: unknown;
    picked?: unknown;
  }

  const FLAGGED_ROOTS: FlagNode[] = [
    {
      id: '1',
      name: '项目',
      expanded: true,
      children: [
        { id: '1-1', name: 'src', children: [{ id: '1-1-1', name: 'main.ts' }] },
        { id: '1-2', name: 'docs' },
      ],
    },
    { id: '2', name: '文档', select: true },
  ];

  const visibleIds = (fixture: Fixture) =>
    rowsOf(fixture).map((r) => r.nativeElement.dataset['treeid'] as string);

  it('数据就绪后按默认字段 expanded / select 自动展开与选中', async () => {
    const { fixture, tree } = setup({}, FLAGGED_ROOTS);
    await flush(fixture);

    expect(tree.getExpandedIds()).toEqual(['1']);
    expect(visibleIds(fixture)).toEqual(['1', '1-1', '1-2', '2']);
    expect(tree.getSelectedIds()).toEqual(['2']);
    expect(rowById(fixture, '2')!.classes['is-selected']).toBe(true);
    fixture.destroy();
  });

  it('只写状态不发事件：不触发 expand / selectionChange', async () => {
    const { fixture, tree } = setup({}, FLAGGED_ROOTS);
    const events: unknown[] = [];
    tree.expand.subscribe((e) => events.push(e));
    tree.collapse.subscribe((e) => events.push(e));
    tree.selectionChange.subscribe((e) => events.push(e));

    await flush(fixture);
    expect(tree.getExpandedIds()).toEqual(['1']);
    expect(tree.getSelectedIds()).toEqual(['2']);
    expect(events).toEqual([]);
    fixture.destroy();
  });

  it('可用 isExpandedField / isSelectedField 指定自定义字段名', async () => {
    const roots: FlagNode[] = [
      { id: '1', name: '项目', open: true, picked: true, children: [{ id: '1-1', name: 'src' }] },
      { id: '2', name: '文档' },
    ];
    const { fixture, tree } = setup({ isExpandedField: 'open', isSelectedField: 'picked' }, roots);
    await flush(fixture);

    expect(tree.getExpandedIds()).toEqual(['1']);
    expect(tree.getSelectedIds()).toEqual(['1']);
    fixture.destroy();
  });

  it('字段缺失或为假值时保持默认状态', async () => {
    const roots: FlagNode[] = [
      { id: '1', name: '项目', expanded: false, select: 0, children: [{ id: '1-1', name: 'src' }] },
      { id: '2', name: '文档' },
    ];
    const { fixture, tree } = setup({}, roots);
    await flush(fixture);

    expect(tree.getExpandedIds()).toEqual([]);
    expect(tree.getSelectedIds()).toEqual([]);
    expect(visibleIds(fixture)).toEqual(['1', '2']);
    fixture.destroy();
  });

  it('每个节点只应用一次：用户折叠 / 取消选中后，数据重建不会再次应用', async () => {
    const { fixture, tree } = setup({}, FLAGGED_ROOTS);
    await flush(fixture);
    expect(tree.getExpandedIds()).toEqual(['1']);

    tree.collapseNode('1');
    tree.setSelected([]);
    await flush(fixture);
    expect(tree.getExpandedIds()).toEqual([]);
    expect(tree.getSelectedIds()).toEqual([]);

    tree.refresh();
    await flush(fixture);
    expect(tree.getExpandedIds()).toEqual([]);
    expect(tree.getSelectedIds()).toEqual([]);
    fixture.destroy();
  });

  it('懒加载子级加载完成后，子级里的初始状态字段同样生效', async () => {
    const child: FlagNode = {
      id: '1-c',
      name: '子级',
      expanded: true,
      select: true,
      children: [{ id: '1-c-1', name: '孙级' }],
    };
    const { fixture, tree } = setup({ loadChildren: () => [child] }, LAZY_ROOTS);
    await flush(fixture);
    expect(visibleIds(fixture)).toEqual(['1', '2']);

    tree.expandNode('1'); // 首次展开：触发懒加载
    await flush(fixture);
    await flush(fixture);

    expect(tree.getExpandedIds()).toEqual(['1', '1-c']);
    expect(tree.getSelectedIds()).toEqual(['1-c']);
    expect(visibleIds(fixture)).toEqual(['1', '1-c', '1-c-1', '2']);
    fixture.destroy();
  });

  it('标记展开的懒加载分支子级未加载时：真正发起加载（并级联到子级）', async () => {
    const source: Record<string, FlagNode[]> = {
      '1': [{ id: '1-c', name: '子级', expanded: true }],
      '1-c': [{ id: '1-c-1', name: '孙级' }],
    };
    const loadChildren = vi.fn((n: DemoNode): FlagNode[] => source[n.id] ?? []);
    const { fixture, tree } = setup({ loadChildren }, LAZY_ROOTS);
    await flush(fixture);
    expect(visibleIds(fixture)).toEqual(['1', '2']);

    const loadEvents: string[] = [];
    const expandEvents: string[] = [];
    tree.loadChildren.subscribe((e) => loadEvents.push(String(e.nodeId)));
    tree.expand.subscribe((e) => expandEvents.push(String(e.nodeId)));

    tree.expandNode('1'); // 首次展开：触发懒加载，1-c 带初始展开标记但自身子级未加载
    await flush(fixture);
    await flush(fixture);

    // 1-c 的初始展开标记真正拉取了孙级，而不是只留一个「展开但没有子行」的空壳
    expect(loadChildren.mock.calls.map((c) => c[0].id)).toEqual(['1', '1-c']);
    expect(loadEvents.sort()).toEqual(['1', '1-c']);
    expect(expandEvents.sort()).toEqual(['1', '1-c']);
    expect(tree.getExpandedIds()).toEqual(['1', '1-c']);
    expect(visibleIds(fixture)).toEqual(['1', '1-c', '1-c-1', '2']);
    fixture.destroy();
  });
});


