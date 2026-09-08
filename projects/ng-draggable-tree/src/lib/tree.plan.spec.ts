import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import { NgDraggableTreeComponent } from './ng-draggable-tree';

/**
 * 落点计划（resolve / apply 分离）用例：
 * `resolveXxx` 必须是纯计算——不改动数据源、不触发视图；
 * `applyXxx` 才真正落位；组合版（moveNodes 等）与两者等价。
 */

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

/** 组件原地修改数据源：共享常量必须按例克隆，避免用例间污染 */
function cloneFixture(data: DemoNode[]): DemoNode[] {
  return data.map((n) => ({ ...n, ...(n.children ? { children: cloneFixture(n.children) } : {}) }));
}

function setup(): { fixture: Fixture; tree: NgDraggableTreeComponent<DemoNode> } {
  @Component({
    imports: [NgDraggableTreeComponent],
    template: `<ng-draggable-tree [nodes]="nodes()" [options]="options" />`,
  })
  class Host {
    readonly nodes = signal<DemoNode[]>(cloneFixture(ROOTS));
    readonly options = { idField: 'id', displayField: 'name', childrenField: 'children' };
  }

  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  const tree = fixture.debugElement.query(By.directive(NgDraggableTreeComponent))
    .componentInstance as unknown as NgDraggableTreeComponent<DemoNode>;
  return { fixture, tree };
}

async function flush(fixture: Fixture): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
}

/** 先序展开 id 列表，用于断言整体结构 */
function idsFlat(nodes: DemoNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...(n.children ? idsFlat(n.children) : [])]);
}

describe('resolve / apply：计算与落位分离', () => {
  it('resolveMove 只算不改：返回归一化落点，数据与视图均不变', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);

    const before = tree.snapshot();
    const plan = tree.resolveMove(['2'], '1', 'before');

    expect(plan).not.toBeNull();
    expect(plan!.ids).toEqual(['2']);
    expect(plan!.parentId).toBeNull(); // 根级
    expect(plan!.anchor).toBe('1'); // 插到 '1' 之前
    expect(plan!.position).toBe('before');
    expect(plan!.targetRowId).toBe('1');
    // 纯计算：数据源与行视图都没动
    expect(tree.snapshot()).toEqual(before);
    expect(tree.treeRows().map((r) => r.id)).toEqual(['1', '2']);

    fixture.destroy();
  });

  it('applyMove 按计划落位（组合版 moveNodes 与之等价）', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);

    const plan = tree.resolveMove(['2'], '1', 'before')!;
    expect(tree.applyMove(plan)).toBe(true);
    expect(idsFlat(tree.getData())).toEqual(['2', '1', '1-1', '1-1-1', '1-2']);
    // 落点父级为根级时不涉及展开；根级重排后行序同步
    expect(tree.treeRows().map((r) => r.id)).toEqual(['2', '1']);

    fixture.destroy();
  });

  it('resolveMove 校验：节点不存在 / 落入自身子树 → null', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);
    tree.expandNode('1');
    await flush(fixture);

    expect(tree.resolveMove(['nope'], '1', 'after')).toBeNull();
    expect(tree.resolveMove([], '1', 'after')).toBeNull();
    // 1-1 是 1 的后代：把 1 移进 1-1 会形成环
    expect(tree.resolveMove(['1'], '1-1', 'child')).toBeNull();
    // 目标行不可见（1-1-1 未展开）
    expect(tree.resolveMove(['2'], '1-1-1', 'after')).toBeNull();

    fixture.destroy();
  });

  it('resolveCopy / applyCopy：载荷深克隆插入，键冲突时 resolve 返回 null', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);
    tree.expandNode('1');
    await flush(fixture);

    const payload: DemoNode[] = [{ id: 'x', name: '新增' }];
    const plan = tree.resolveCopy(payload, '1-1', 'child');
    expect(plan).not.toBeNull();
    expect(plan!.parentId).toBe('1-1');
    expect(plan!.anchor).toBeNull();
    expect(tree.snapshot()).toEqual(ROOTS); // 未落位

    expect(tree.applyCopy(plan!)).toBe(true);
    const inserted = tree.getData()[0].children![0].children!;
    expect(inserted.map((n) => n.id)).toEqual(['1-1-1', 'x']);
    // 载荷被克隆：树内对象与传入对象不共享
    expect(inserted[1]).not.toBe(payload[0]);

    // 键冲突：本树已存在 1-1
    expect(tree.resolveCopy([{ id: '1-1', name: '重名' }], '1', 'child')).toBeNull();

    fixture.destroy();
  });

  it('resolveAdd / applyAdd：按 position 落位并自动展开父级', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);
    tree.expandNode('1');
    await flush(fixture);

    const plan = tree.resolveAdd([{ id: 'n1', name: '新节点' }], '1-1', 'first');
    expect(plan).not.toBeNull();
    expect(plan!.parentId).toBe('1-1');
    expect(plan!.position).toBe('first');
    expect(tree.snapshot()).toEqual(ROOTS);

    expect(tree.applyAdd(plan!)).toBe(true);
    expect(tree.getData()[0].children![0].children!.map((n) => n.id)).toEqual(['n1', '1-1-1']);
    // 落点父级自动展开，使新增节点立即可见
    expect(tree.treeRows().map((r) => r.id)).toContain('n1');

    // 缺 id / 键冲突 / 父级不存在
    expect(tree.resolveAdd([{ id: '1-1', name: '冲突' }], null)).toBeNull();
    expect(tree.resolveAdd([{ id: 'ghost', name: '无父' }], 'nope')).toBeNull();

    fixture.destroy();
  });

  it('resolveRemove 给出完整子树 id；applyRemove 才真正删除', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);

    const plan = tree.resolveRemove(['1-1', 'nope']);
    expect(plan).not.toBeNull();
    expect(plan!.ids).toEqual(['1-1']); // 不存在的 id 被剔除
    expect(plan!.subtreeIds).toEqual(['1-1', '1-1-1']);
    expect(tree.snapshot()).toEqual(ROOTS); // 未落位

    expect(tree.applyRemove(plan!)).toBe(true);
    expect(idsFlat(tree.getData())).toEqual(['1', '1-2', '2']);

    // 全部 id 均不存在 → null
    expect(tree.resolveRemove(['nope'])).toBeNull();

    fixture.destroy();
  });

  it('组合版与 resolve+apply 等价（moveNodes / copyNodes / addNodes / removeNodes 行为不变）', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);

    expect(tree.moveNodes(['2'], '1', 'before')).toBe(true);
    expect(idsFlat(tree.getData())).toEqual(['2', '1', '1-1', '1-1-1', '1-2']);
    expect(tree.addNodes([{ id: 'n1', name: '新' }], '2', 'end')).toBe(true);
    expect(tree.copyNodes([{ id: 'n2', name: '新2' }], null)).toBe(true);
    expect(tree.removeNodes(['1-1'])).toBe(true);
    expect(idsFlat(tree.getData())).toEqual(['2', 'n1', '1', '1-2', 'n2']);

    fixture.destroy();
  });
});
