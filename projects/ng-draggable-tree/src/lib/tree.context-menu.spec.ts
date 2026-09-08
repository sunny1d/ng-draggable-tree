import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, describe, expect, it } from 'vitest';
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
      { id: '1-1', name: 'src' },
      { id: '1-2', name: 'docs' },
    ],
  },
  { id: '2', name: '文档' },
];

type Fixture = ComponentFixture<unknown>;

/** 结构克隆夹具数据：组件按新语义「原地修改数据源」，共享常量必须按例复制 */
function cloneFixture(data: DemoNode[]): DemoNode[] {
  return data.map((n) => ({
    ...n,
    ...(n.children ? { children: cloneFixture(n.children) } : {}),
  }));
}

const BASE_OPTIONS: TreeOptions<DemoNode> = {
  idField: 'id',
  displayField: 'name',
  childrenField: 'children',
};

/** 未投影 #contextMenuTemplate：右键不应弹出任何菜单，只发 contextMenu 事件 */
function setup(optionsOverride: Partial<TreeOptions<DemoNode>> = {}): {
  fixture: Fixture;
  tree: NgDraggableTreeComponent<DemoNode>;
} {
  @Component({
    imports: [NgDraggableTreeComponent],
    template: `<ng-draggable-tree [nodes]="nodes()" [options]="options" />`,
  })
  class Host {
    readonly nodes = signal<DemoNode[]>(cloneFixture(ROOTS));
    readonly options = { ...BASE_OPTIONS, ...optionsOverride } as TreeOptions<DemoNode>;
  }

  return mount(Host);
}

/** 投影了 #contextMenuTemplate：菜单内容完全由模板决定 */
function setupWithTemplate(optionsOverride: Partial<TreeOptions<DemoNode>> = {}): {
  fixture: Fixture;
  tree: NgDraggableTreeComponent<DemoNode>;
} {
  @Component({
    imports: [NgDraggableTreeComponent],
    template: `
      <ng-draggable-tree [nodes]="nodes()" [options]="options">
        <ng-template #contextMenuTemplate let-node let-row="row" let-api="api" let-close="close" let-event="event">
          <div class="tpl-menu">
            <span class="tpl-menu-name">{{ node.name }}</span>
            <span class="tpl-menu-depth">{{ row.depth }}</span>
            <span class="tpl-menu-event">{{ event ? 'event' : 'programmatic' }}</span>
            <button type="button" class="tpl-menu-toggle" (click)="api.onToggleExpand(row); close()">展开</button>
            <button type="button" class="tpl-menu-delete" (click)="api.onDelete(row); close()">删除</button>
            <button type="button" class="tpl-menu-close" (click)="close()">关闭</button>
          </div>
        </ng-template>
      </ng-draggable-tree>
    `,
  })
  class Host {
    readonly nodes = signal<DemoNode[]>(cloneFixture(ROOTS));
    readonly options = { ...BASE_OPTIONS, ...optionsOverride } as TreeOptions<DemoNode>;
  }

  return mount(Host);
}

function mount(host: unknown): {
  fixture: Fixture;
  tree: NgDraggableTreeComponent<DemoNode>;
} {
  TestBed.configureTestingModule({ imports: [host as never] });
  const fixture = TestBed.createComponent(host as never) as Fixture;
  const tree = fixture.debugElement.query(By.directive(NgDraggableTreeComponent))
    .componentInstance as unknown as NgDraggableTreeComponent<DemoNode>;
  return { fixture, tree };
}

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

/** 在指定行上右键 */
function rightClick(fixture: Fixture, id: string): void {
  const row = rowById(fixture, id);
  row!.nativeElement.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }),
  );
}

const templateMenu = (): HTMLElement | null => document.querySelector('.tpl-menu');
const menuName = (): string => templateMenu()!.querySelector('.tpl-menu-name')!.textContent!.trim();
const menuEventKind = (): string =>
  templateMenu()!.querySelector('.tpl-menu-event')!.textContent!.trim();

function clickElement(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  expect(el).not.toBeNull();
  el!.click();
}

afterEach(() => {
  TestBed.resetTestingModule();
  // Overlay 容器挂在 body 上，逐个用例清理，避免菜单 DOM 跨用例残留
  document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
});

describe('右键菜单', () => {
  it('未投影 #contextMenuTemplate：右键不弹菜单、不阻止原生菜单，只发 contextMenu 事件', async () => {
    const { fixture, tree } = setup();
    const emitted: string[] = [];
    tree.contextMenu.subscribe((e) => emitted.push(String(e.nodeId)));
    await flush(fixture);

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 60,
    });
    rowById(fixture, '2')!.nativeElement.dispatchEvent(event);
    await flush(fixture);

    expect(emitted).toEqual(['2']); // 事件照常发出，右键做什么由使用方决定
    expect(event.defaultPrevented).toBe(false); // 没有菜单可弹 → 保留浏览器原生菜单
    expect(templateMenu()).toBeNull();
    expect(document.querySelector('.ng-draggable-tree-menu-panel')).toBeNull();
    expect(tree.contextMenuOpen()).toBe(false);

    // 程序化打开同样无内容可渲染
    expect(tree.openContextMenu('2')).toBe(false);
    expect(tree.contextMenuOpen()).toBe(false);
    fixture.destroy();
  });

  it('#contextMenuTemplate 完全接管菜单内容，并拿到 node / row / api / close / event 上下文', async () => {
    const { fixture, tree } = setupWithTemplate();
    await flush(fixture);
    tree.expandNode('1'); // 先展开，才能右键到子行（row 上下文取真实行模型）
    await flush(fixture);

    rightClick(fixture, '1-1');
    await flush(fixture);

    const menu = templateMenu();
    expect(menu).not.toBeNull();
    expect(menuName()).toBe('src');
    expect(menu!.querySelector('.tpl-menu-depth')!.textContent!.trim()).toBe('1');
    expect(menuEventKind()).toBe('event');

    clickElement('.tpl-menu-close');
    await flush(fixture);
    expect(templateMenu()).toBeNull();
    expect(tree.contextMenuOpen()).toBe(false);
    fixture.destroy();
  });

  it('菜单项可借 api 完成操作后 close() 关闭菜单（展开 / 删除）', async () => {
    const { fixture, tree } = setupWithTemplate();
    await flush(fixture);

    rightClick(fixture, '1');
    await flush(fixture);
    expect(menuName()).toBe('项目');

    clickElement('.tpl-menu-toggle');
    await flush(fixture);
    expect(tree.treeRows().length).toBe(4); // 1-1 / 1-2 已展开
    expect(templateMenu()).toBeNull();
    expect(tree.contextMenuOpen()).toBe(false);

    rightClick(fixture, '2');
    await flush(fixture);
    clickElement('.tpl-menu-delete');
    await flush(fixture);
    expect(templateMenu()).toBeNull();
    expect(tree.snapshot().map((n) => n.id)).toEqual(['1']);
    fixture.destroy();
  });

  it('options.contextMenu 传函数：仅命中节点弹出（其余仍发 contextMenu 事件）', async () => {
    const { fixture, tree } = setupWithTemplate({ contextMenu: (node) => node.id === '1' });
    const emitted: string[] = [];
    tree.contextMenu.subscribe((e) => emitted.push(String(e.nodeId)));
    await flush(fixture);

    rightClick(fixture, '2');
    await flush(fixture);
    expect(templateMenu()).toBeNull();
    expect(emitted).toEqual(['2']);

    rightClick(fixture, '1');
    await flush(fixture);
    expect(templateMenu()).not.toBeNull();
    expect(emitted).toEqual(['2', '1']);
    fixture.destroy();
  });

  it('options.contextMenu 传 false：不弹菜单，仅发 contextMenu 事件', async () => {
    const { fixture, tree } = setupWithTemplate({ contextMenu: false });
    const emitted: string[] = [];
    tree.contextMenu.subscribe((e) => emitted.push(String(e.nodeId)));
    await flush(fixture);

    rightClick(fixture, '1');
    await flush(fixture);
    expect(templateMenu()).toBeNull();
    expect(tree.contextMenuOpen()).toBe(false);
    expect(emitted).toEqual(['1']);
    fixture.destroy();
  });

  it('程序化 openContextMenu / closeContextMenu，且菜单上下文标记为 programmatic', async () => {
    const { fixture, tree } = setupWithTemplate();
    await flush(fixture);

    expect(tree.openContextMenu('2')).toBe(true);
    await flush(fixture);
    expect(menuEventKind()).toBe('programmatic');
    expect(tree.contextMenuOpen()).toBe(true);

    tree.closeContextMenu();
    await flush(fixture);
    expect(templateMenu()).toBeNull();
    expect(tree.contextMenuOpen()).toBe(false);

    expect(tree.openContextMenu('missing')).toBe(false);
    fixture.destroy();
  });

  it('菜单不挂蒙版，按 Escape 关闭菜单', async () => {
    const { fixture, tree } = setupWithTemplate();
    await flush(fixture);

    rightClick(fixture, '1');
    await flush(fixture);
    expect(templateMenu()).not.toBeNull();
    expect(document.querySelector('.cdk-overlay-backdrop')).toBeNull(); // 无蒙版：不遮挡页面

    templateMenu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush(fixture);
    expect(templateMenu()).toBeNull();
    expect(tree.contextMenuOpen()).toBe(false);
    fixture.destroy();
  });

  it('无蒙版：菜单外的单击照常命中目标元素，并关闭菜单', async () => {
    const { fixture, tree } = setupWithTemplate();
    await flush(fixture);

    rightClick(fixture, '1');
    await flush(fixture);
    expect(tree.contextMenuOpen()).toBe(true);

    // 单击另一行：行自身的选中逻辑照常执行（事件不被菜单拦截、不 preventDefault）
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    rowById(fixture, '2')!.nativeElement.dispatchEvent(click);
    await flush(fixture);

    expect(click.defaultPrevented).toBe(false);
    expect(tree.getSelectedIds()).toEqual(['2']);
    expect(templateMenu()).toBeNull();
    expect(tree.contextMenuOpen()).toBe(false);
    fixture.destroy();
  });

  it('无蒙版：在菜单外的行上按下鼠标即关闭菜单（拖拽行时菜单不遮挡）', async () => {
    const { fixture, tree } = setupWithTemplate({ allowDrag: true });
    await flush(fixture);

    rightClick(fixture, '1');
    await flush(fixture);
    expect(tree.contextMenuOpen()).toBe(true);

    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    rowById(fixture, '2')!.nativeElement.dispatchEvent(down);
    await flush(fixture);

    expect(down.defaultPrevented).toBe(false);
    expect(templateMenu()).toBeNull();
    expect(tree.contextMenuOpen()).toBe(false);
    fixture.destroy();
  });

  it('无蒙版：菜单外的双击照常命中目标元素，并关闭菜单', async () => {
    const { fixture, tree } = setupWithTemplate();
    const dblClicked: string[] = [];
    tree.doubleClick.subscribe((e) => dblClicked.push(String(e.nodeId)));
    await flush(fixture);

    rightClick(fixture, '1');
    await flush(fixture);

    const row = rowById(fixture, '2')!.nativeElement;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flush(fixture);

    expect(dblClicked).toEqual(['2']);
    expect(templateMenu()).toBeNull();
    expect(tree.contextMenuOpen()).toBe(false);
    fixture.destroy();
  });

  it('无蒙版：菜单外右键另一行时菜单移到该行；菜单内右键不关闭', async () => {
    const { fixture, tree } = setupWithTemplate();
    await flush(fixture);

    rightClick(fixture, '1');
    await flush(fixture);
    expect(menuName()).toBe('项目');

    // 菜单内右键：面板内的右键不应关闭菜单
    const inMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    templateMenu()!.dispatchEvent(inMenu);
    await flush(fixture);
    expect(inMenu.defaultPrevented).toBe(false);
    expect(templateMenu()).not.toBeNull();
    expect(tree.contextMenuOpen()).toBe(true);

    // 菜单外右键另一行：当前菜单关闭，该行弹出自己的菜单
    rowById(fixture, '2')!.nativeElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 260 }),
    );
    await flush(fixture);
    expect(templateMenu()).not.toBeNull();
    expect(menuName()).toBe('文档');
    expect(tree.contextMenuOpen()).toBe(true);
    fixture.destroy();
  });

  it('滚动页面 / 树容器关闭菜单，菜单面板自身滚动不关闭', async () => {
    const { fixture, tree } = setupWithTemplate();
    await flush(fixture);

    rightClick(fixture, '1');
    await flush(fixture);
    expect(tree.contextMenuOpen()).toBe(true);

    // 菜单面板自身滚动：不关闭
    templateMenu()!.dispatchEvent(new Event('scroll'));
    await flush(fixture);
    expect(templateMenu()).not.toBeNull();
    expect(tree.contextMenuOpen()).toBe(true);

    // 树容器滚动：关闭
    fixture.nativeElement.dispatchEvent(new Event('scroll'));
    await flush(fixture);
    expect(templateMenu()).toBeNull();
    expect(tree.contextMenuOpen()).toBe(false);

    // 页面滚动：关闭
    rightClick(fixture, '1');
    await flush(fixture);
    expect(tree.contextMenuOpen()).toBe(true);
    document.dispatchEvent(new Event('scroll'));
    await flush(fixture);
    expect(templateMenu()).toBeNull();
    expect(tree.contextMenuOpen()).toBe(false);
    fixture.destroy();
  });

  it('组件销毁时菜单一并释放', async () => {
    const { fixture } = setupWithTemplate();
    await flush(fixture);
    rightClick(fixture, '1');
    await flush(fixture);
    expect(templateMenu()).not.toBeNull();

    fixture.destroy();
    expect(templateMenu()).toBeNull();
  });
});
