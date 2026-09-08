import { Component, signal, type DebugElement } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NgDraggableTreeComponent,
  type TreeDragEndEvent,
} from './ng-draggable-tree';
import type { TreeOptions } from './tree-options';
import { resolveTargetSlot, type TreeRow } from './tree.model';
import { transferNodes } from './tree.operations';

interface DemoNode {
  id: string;
  name: string;
  children?: DemoNode[];
}

const LEFT_ROOT: DemoNode[] = [
  {
    id: 'l1',
    name: '待归档源码',
    children: [{ id: 'l1-1', name: 'main.ts' }],
  },
  { id: 'l2', name: '文档' },
];

const RIGHT_ROOT: DemoNode[] = [
  {
    id: 'r1',
    name: '已发布目录',
    children: [{ id: 'r1-1', name: '说明.md' }],
  },
  { id: 'r2', name: '归档' },
];

/* ---------------------- DOM 几何桩（jsdom 无法布局） ---------------------- */

interface Layout {
  left: number;
  top: number;
  width: number;
  height: number;
  rowHeight: number;
  firstRowTop: number;
}

const LEFT_LAYOUT: Layout = { left: 0, top: 0, width: 260, height: 600, rowHeight: 28, firstRowTop: 40 };
const RIGHT_LAYOUT: Layout = { left: 320, top: 0, width: 260, height: 600, rowHeight: 28, firstRowTop: 40 };

function stubRect(el: Element, x: number, y: number, w: number, h: number): void {
  const rect = {
    x,
    y,
    left: x,
    top: y,
    right: x + w,
    bottom: y + h,
    width: w,
    height: h,
    toJSON: () => null,
  };
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => h });
  (el as HTMLElement).getBoundingClientRect = () => rect as unknown as DOMRect;
}

/** 给树根及全部行分配顺序递增的几何，模拟“两棵树并排”的版式 */
function layoutTree(rootEl: HTMLElement, layout: Layout): void {
  stubRect(rootEl, layout.left, layout.top, layout.width, layout.height);
  const rows = rootEl.querySelectorAll<HTMLElement>('.ng-draggable-tree-row');
  rows.forEach((row, i) => {
    stubRect(row, layout.left + 8, layout.firstRowTop + i * layout.rowHeight, layout.width - 16, layout.rowHeight);
  });
}

/** 指针：落在某树第一行的中部（child 方位） */
function pointInside(tree: 'left' | 'right'): { x: number; y: number } {
  const layout = tree === 'left' ? LEFT_LAYOUT : RIGHT_LAYOUT;
  return { x: layout.left + 60, y: layout.firstRowTop + layout.rowHeight / 2 };
}

/** 指针：落在某树第 rowIndex 行中部（非叶子行为 child；叶子行中部为 after） */
function pointOnRow(tree: 'left' | 'right', rowIndex: number): { x: number; y: number } {
  const layout = tree === 'left' ? LEFT_LAYOUT : RIGHT_LAYOUT;
  return { x: layout.left + 60, y: layout.firstRowTop + rowIndex * layout.rowHeight + layout.rowHeight / 2 };
}

/* ---------------------- 测试宿主 ---------------------- */

type Fixture = ComponentFixture<Host>;

/**
 * 组件直接接管并**就地改写**数据源（不做内部克隆），所以 Host 每次创建都要
 * 拿到左右两棵树的独立副本，避免用例之间互相污染。
 */
function cloneNodes(list: DemoNode[]): DemoNode[] {
  return list.map((n) => ({ ...n, ...(n.children ? { children: cloneNodes(n.children) } : {}) }));
}

@Component({
  imports: [NgDraggableTreeComponent],
  template: `
    <div class="x-left"><ng-draggable-tree [nodes]="leftNodes()" [options]="leftOpts" /></div>
    <div class="x-right"><ng-draggable-tree [nodes]="rightNodes()" [options]="rightOpts" /></div>
  `,
})
class Host {
  readonly leftNodes = signal<DemoNode[]>(cloneNodes(LEFT_ROOT));
  readonly rightNodes = signal<DemoNode[]>(cloneNodes(RIGHT_ROOT));
  leftOpts: TreeOptions<DemoNode> = makeOpts('move');
  rightOpts: TreeOptions<DemoNode> = makeOpts('move');
}

function makeOpts(crossTree: 'move' | 'copy'): TreeOptions<DemoNode> {
  return {
    idField: 'id',
    displayField: 'name',
    childrenField: 'children',
    allowDrag: true,
    crossTree,
    dragGroup: 'groupA',
  };
}

function flush(fixture: Fixture): Promise<void> {
  fixture.detectChanges();
  return Promise.resolve()
    .then(() => fixture.detectChanges())
    .then(() => Promise.resolve())
    .then(() => fixture.detectChanges());
}

function treesOf(fixture: Fixture): DebugElement[] {
  return fixture.debugElement.queryAll(By.directive(NgDraggableTreeComponent));
}

function treeRoot(tree: DebugElement): HTMLElement {
  return tree.query(By.css('.ng-draggable-tree-root'))!.nativeElement as HTMLElement;
}

function rowEl(rootEl: HTMLElement, id: string): HTMLElement {
  return rootEl.querySelector(`[data-treeid="${id}"]`) as HTMLElement;
}

function idsFlat(nodes: DemoNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...(n.children ? idsFlat(n.children) : [])]);
}

function setup(leftOpts?: Partial<TreeOptions<DemoNode>>, rightOpts?: Partial<TreeOptions<DemoNode>>): {
  fixture: Fixture;
  left: NgDraggableTreeComponent<DemoNode>;
  right: NgDraggableTreeComponent<DemoNode>;
  leftRoot: HTMLElement;
  rightRoot: HTMLElement;
} {
  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.leftOpts = { ...makeOpts('move'), ...leftOpts };
  fixture.componentInstance.rightOpts = { ...makeOpts('move'), ...rightOpts };
  const [leftEl, rightEl] = treesOf(fixture);
  const left = leftEl.componentInstance as NgDraggableTreeComponent<DemoNode>;
  const right = rightEl.componentInstance as NgDraggableTreeComponent<DemoNode>;
  return {
    fixture,
    left,
    right,
    leftRoot: treeRoot(leftEl),
    rightRoot: treeRoot(rightEl),
  };
}

afterEach(() => {
  TestBed.resetTestingModule();
});

/** 订阅一棵树的 dragEnd，记录事件序列（断言「只在源树发 dragEnd」时用） */
function recordEvents(
  tree: NgDraggableTreeComponent<DemoNode>,
): { ends: TreeDragEndEvent<DemoNode>[] } {
  const ends: TreeDragEndEvent<DemoNode>[] = [];
  tree.dragEnd.subscribe((e) => ends.push(e));
  return { ends };
}

describe('拖放为事件驱动：库不自动落位，dragEnd 携带完整落点由使用方执行', () => {
  it('树内拖放：dragEnd 载荷给出本树落点，数据不变；页面 moveNodes 后完成移动', async () => {
    const { fixture, left, right, leftRoot, rightRoot } = setup();
    const leftRec = recordEvents(left);
    await flush(fixture);
    // 展开 l1 让 l1-1 可见，行序：l1(0) / l1-1(1) / l2(2)
    left.expandNode('l1');
    await flush(fixture);
    layoutTree(leftRoot, LEFT_LAYOUT);
    layoutTree(rightRoot, RIGHT_LAYOUT);

    const leftBefore = left.snapshot();
    const sourceRow = left.treeRows()[0]; // l1（含子节点 l1-1）
    left.rowApi.onDragStart(sourceRow, rowEl(leftRoot, 'l1'));
    // 指针移到本树第 3 行 l2 中部：l2 是叶子行，只给 before/after，中部解析为 after
    const point = pointOnRow('left', 2);
    left.rowApi.onDragMoved(
      sourceRow,
      { event: new MouseEvent('mousemove', { clientX: point.x, clientY: point.y }), pointerPosition: point } as never,
    );
    await flush(fixture);
    expect(rowEl(leftRoot, 'l2').classList.contains('is-drop-after')).toBe(true);

    left.rowApi.onDragEnd(sourceRow);
    await flush(fixture);

    // 载荷：本树内、有效、after 到 l2，未执行任何数据改动
    expect(leftRec.ends).toHaveLength(1);
    const end = leftRec.ends[0];
    expect(end.draggedIds).toEqual(['l1']);
    const d = end.drop;
    expect(d.dropped).toBe(true);
    expect(d.external).toBe(false);
    expect(d.sourceTree).toBe(left);
    expect(d.targetTree).toBeNull();
    expect(d.targetRowId).toBe('l2');
    expect(d.position).toBe('after');
    expect(d.parentId).toBeNull(); // after 落点的父级即目标行原父级：l2 在根级
    expect(d.target?.id).toBe('l2');
    // 数据从载荷的树实例读取：树内放置没有目标树，源树快照即落位前数据
    expect(d.sourceTree.snapshot()).toEqual(leftBefore);
    expect(left.snapshot()).toEqual(leftBefore);

    // 使用方在 dragEnd 中调用 moveNodes：l1 子树跟到 l2 之后（根级重排，子树原样带过去）
    expect(left.moveNodes(end.draggedIds, d.targetRowId, d.position!)).toBe(true);
    const data = left.getData();
    expect(data.map((n) => n.id)).toEqual(['l2', 'l1']);
    expect(data[1].children?.map((c) => c.id)).toEqual(['l1-1']);
    fixture.destroy();
  });

  it('载荷自带两棵树实例：直接取数即可算出 transferNodes 结果', async () => {
    const { fixture, left, right, leftRoot, rightRoot } = setup();
    const leftRec = recordEvents(left);
    await flush(fixture);
    layoutTree(leftRoot, LEFT_LAYOUT);
    layoutTree(rightRoot, RIGHT_LAYOUT);

    const sourceRow = left.treeRows()[0]; // l1
    left.rowApi.onDragStart(sourceRow, rowEl(leftRoot, 'l1'));
    const point = pointInside('right');
    left.rowApi.onDragMoved(sourceRow, {
      event: new MouseEvent('mousemove', { clientX: point.x, clientY: point.y }),
      pointerPosition: point,
    } as never);
    await flush(fixture);
    left.rowApi.onDragEnd(sourceRow);
    await flush(fixture);

    const end = leftRec.ends[0];
    const d = end.drop;
    // 落点解析所需信息与两棵树数据都来自载荷本身
    const slot = resolveTargetSlot(right.treeRows(), d.targetRowId, d.position!)!;
    const moved = transferNodes(
      d.sourceTree.getData(),
      d.sourceTree.opts,
      d.targetTree!.getData(),
      d.targetTree!.opts,
      end.draggedIds,
      slot.parentId,
      slot.anchor,
    );
    expect(moved).not.toBeNull();
    expect(idsFlat(moved!.sourceRoots)).toEqual(['l2']);
    expect(idsFlat(moved!.targetRoots)).toEqual(['r1', 'r1-1', 'l1', 'l1-1', 'r2']);
    // transferNodes 只作用于传入数组（此处为 getData() 快照克隆），树内数据要由使用方写回
    expect(idsFlat(left.getData())).toEqual(['l1', 'l1-1', 'l2']);
    expect(idsFlat(right.getData())).toEqual(['r1', 'r1-1', 'r2']);
    fixture.destroy();
  });

  it('跨树 move：dragEnd 只在源树发（含目标树实例/落点/被拖节点），未执行前两树数据不变；页面 copyNodes+removeNodes 完成移动', async () => {
    const { fixture, left, right, leftRoot, rightRoot } = setup();
    const leftRec = recordEvents(left);
    const rightRec = recordEvents(right);
    await flush(fixture);
    layoutTree(leftRoot, LEFT_LAYOUT);
    layoutTree(rightRoot, RIGHT_LAYOUT);

    const leftBefore = left.snapshot();
    const rightBefore = right.snapshot();
    const sourceRow = left.treeRows()[0]; // l1
    left.rowApi.onDragStart(sourceRow, rowEl(leftRoot, 'l1'));
    const point = pointInside('right');
    const pointerEvent = new MouseEvent('mousemove', { clientX: point.x, clientY: point.y, ctrlKey: true });
    left.rowApi.onDragMoved(
      sourceRow,
      { event: pointerEvent, pointerPosition: point } as never,
    );
    await flush(fixture);

    // 悬停阶段：目标树高亮 + r1 显示 child 落点
    expect(right.externalDropTargetActive()).toBe(true);
    expect(rightRoot.classList.contains('is-cross-drag-target')).toBe(true);
    expect(rowEl(rightRoot, 'r1').classList.contains('is-drop-child')).toBe(true);

    left.rowApi.onDragEnd(sourceRow);
    await flush(fixture);

    // 松手后即时清理接收态
    expect(right.externalDropTargetActive()).toBe(false);
    expect(rightRoot.classList.contains('is-cross-drag-target')).toBe(false);
    expect(rowEl(rightRoot, 'r1').classList.contains('is-drop-child')).toBe(false);

    // dragEnd 只在源树输出；事件携带跨树落点（含目标树组件实例）与指针修饰键
    expect(leftRec.ends).toHaveLength(1);
    expect(rightRec.ends).toEqual([]);
    const end = leftRec.ends[0];
    expect(end.draggedIds).toEqual(['l1']);
    expect(end.draggedNodes.map((n) => n.id)).toEqual(['l1']);
    expect((end.event as MouseEvent).ctrlKey).toBe(true);
    const d = end.drop;
    expect(d.dropped).toBe(true);
    expect(d.external).toBe(true);
    expect(d.sourceTree).toBe(left);
    expect(d.targetTree).toBe(right);
    // 载荷里的两棵树实例可即时取到「落位前」数据：源树仍含 l1 子树，目标树尚未含 l1
    expect(idsFlat(d.sourceTree.getData())).toEqual(['l1', 'l1-1', 'l2']);
    expect(idsFlat(d.targetTree!.getData())).toEqual(['r1', 'r1-1', 'r2']);
    // snapshot() 返回深克隆：改动取到的数据不会污染树内数据（getData 则返回数据源本身）
    const pulled = d.sourceTree.snapshot();
    pulled[0].name = '注入';
    expect(left.getData()[0].name).toBe('待归档源码');
    expect(d.targetRowId).toBe('r1');
    expect(d.position).toBe('child');
    expect(d.parentId).toBe('r1');
    expect(d.target?.id).toBe('r1');
    expect(d.parent?.id).toBe('r1');

    // 库未自动改动任何数据
    expect(left.snapshot()).toEqual(leftBefore);
    expect(right.snapshot()).toEqual(rightBefore);

    // 使用方依据 dragEnd 语义自行执行：目标树插入（copyNodes），move 再移除源树
    expect(right.copyNodes(end.draggedNodes, d.targetRowId, d.position!)).toBe(true);
    expect(left.removeNodes(end.draggedIds)).toBe(true);
    expect(idsFlat(left.getData())).not.toContain('l1');
    const rightData = right.getData();
    expect(idsFlat(rightData)).toContain('l1');
    expect(idsFlat(rightData)).toContain('l1-1');
    expect(rightData[0].id).toBe('r1');
    expect(rightData[0].children?.map((c) => c.id)).toEqual(['r1-1', 'l1']);
    fixture.destroy();
  });

  it('跨树 copy：dragEnd 后仅执行 copyNodes，源树保留；id 已存在时拖放本身被判定无效', async () => {
    const { fixture, left, right, leftRoot, rightRoot } = setup(
      { crossTree: 'copy' },
      { crossTree: 'copy' },
    );
    const leftRec = recordEvents(left);
    await flush(fixture);
    layoutTree(leftRoot, LEFT_LAYOUT);
    layoutTree(rightRoot, RIGHT_LAYOUT);

    const sourceRow = left.treeRows()[0];
    const drag = (row: TreeRow<DemoNode>) => {
      const point = pointInside('right');
      left.rowApi.onDragStart(row, rowEl(leftRoot, String(row.id)));
      left.rowApi.onDragMoved(
        row,
        { event: new MouseEvent('mousemove', { clientX: point.x, clientY: point.y }), pointerPosition: point } as never,
      );
      left.rowApi.onDragEnd(row);
    };

    // 第一次：dragEnd 说明有效落点，但数据未动；页面执行 copyNodes 后源树保留
    drag(sourceRow);
    await flush(fixture);
    const firstEnd = leftRec.ends[0];
    expect(firstEnd.drop.dropped).toBe(true);
    expect(firstEnd.drop.external).toBe(true);
    expect(idsFlat(right.getData())).not.toContain('l1'); // 未自动复制
    expect(right.copyNodes(firstEnd.draggedNodes, firstEnd.drop.targetRowId, firstEnd.drop.position!)).toBe(true);
    const afterFirst = right.getData();
    expect(idsFlat(afterFirst)).toContain('l1');
    expect(idsFlat(left.getData())).toContain('l1'); // copy 保留源树

    // 第二次：目标树已含相同 id → 松手时即判定为无效落点（dropped=false，数据不变）；
    // 即便绕开 dragEnd 直接对重复 id 调用 copyNodes，执行器也会拒绝
    const rightBefore = right.snapshot();
    drag(sourceRow);
    await flush(fixture);
    const secondEnd = leftRec.ends[1];
    expect(secondEnd.drop.dropped).toBe(false);
    expect(secondEnd.drop.external).toBe(true);
    expect(right.snapshot()).toEqual(rightBefore);
    const dupPayload = left.getData().filter((n) => n.id === 'l1');
    expect(right.copyNodes(dupPayload, 'r1', 'child')).toBe(false);
    expect(right.snapshot()).toEqual(rightBefore);
    expect(idsFlat(left.getData())).toContain('l1');
    fixture.destroy();
  });

  it('空目标树：dragEnd 给出根级末尾落点，页面 copyNodes 后按根放入', async () => {
    const { fixture, left, right, leftRoot, rightRoot } = setup();
    const leftRec = recordEvents(left);
    fixture.componentInstance.rightNodes.set([]);
    await flush(fixture);
    layoutTree(leftRoot, LEFT_LAYOUT);
    layoutTree(rightRoot, RIGHT_LAYOUT);

    const sourceRow = left.treeRows()[0];
    left.rowApi.onDragStart(sourceRow, rowEl(leftRoot, 'l1'));
    const point = { x: RIGHT_LAYOUT.left + 60, y: 260 };
    left.rowApi.onDragMoved(
      sourceRow,
      { event: new MouseEvent('mousemove', { clientX: point.x, clientY: point.y }), pointerPosition: point } as never,
    );
    await flush(fixture);
    expect(right.externalDropTargetActive()).toBe(true);

    left.rowApi.onDragEnd(sourceRow);
    await flush(fixture);

    const end = leftRec.ends[0];
    const d = end.drop;
    expect(d.dropped).toBe(true);
    expect(d.external).toBe(true);
    expect(d.targetRowId).toBeNull(); // 根级末尾
    expect(d.position).toBe('after');
    expect(d.parentId).toBeNull();
    expect(d.target).toBeNull();
    expect(right.snapshot()).toEqual([]); // 空目标树未被自动改动

    expect(right.copyNodes(end.draggedNodes, d.targetRowId, d.position!)).toBe(true);
    const rightData = right.getData();
    expect(rightData.map((n) => n.id)).toEqual(['l1']);
    expect(idsFlat(rightData)).toContain('l1-1');
    fixture.destroy();
  });

  it('未启用跨树的目标树不接收：dragEnd 判定无效，源树数据保持原样', async () => {
    const { fixture, left, right, leftRoot, rightRoot } = setup(
      { crossTree: 'move' },
      { crossTree: 'disabled' },
    );
    const leftRec = recordEvents(left);
    const rightRec = recordEvents(right);
    await flush(fixture);
    layoutTree(leftRoot, LEFT_LAYOUT);
    layoutTree(rightRoot, RIGHT_LAYOUT);

    const leftBefore = left.snapshot();
    const sourceRow = left.treeRows()[0];
    left.rowApi.onDragStart(sourceRow, rowEl(leftRoot, 'l1'));
    const point = pointInside('right');
    left.rowApi.onDragMoved(
      sourceRow,
      { event: new MouseEvent('mousemove', { clientX: point.x, clientY: point.y }), pointerPosition: point } as never,
    );
    await flush(fixture);

    // 目标树不应出现外部悬停高亮与行落点
    expect(right.externalDropTargetActive()).toBe(false);
    expect(rightRoot.classList.contains('is-cross-drag-target')).toBe(false);
    expect(rowEl(rightRoot, 'r1').classList.contains('is-drop-child')).toBe(false);

    left.rowApi.onDragEnd(sourceRow);
    await flush(fixture);

    // 只在源树发 dragEnd，且判定无效；两树数据都未被改动
    expect(leftRec.ends).toHaveLength(1);
    expect(leftRec.ends[0].drop.dropped).toBe(false);
    expect(leftRec.ends[0].drop.external).toBe(false);
    expect(rightRec.ends).toEqual([]);
    expect(left.snapshot()).toEqual(leftBefore);
    expect(idsFlat(right.getData())).not.toContain('l1');
    fixture.destroy();
  });
});
