import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import { NgDraggableTreeComponent } from './ng-draggable-tree';
import type { TreeOptions } from './tree-options';

/**
 * `TreeOptions.animate` 用例：进入动画只作用于「新增的行」
 * ——首屏渲染的行不播放，`animate: false` 时完全关闭。
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
      { id: '1-1', name: 'src' },
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

function setup(
  extra: TreeOptions<DemoNode> = {},
): { fixture: Fixture; tree: NgDraggableTreeComponent<DemoNode> } {
  @Component({
    imports: [NgDraggableTreeComponent],
    template: `<ng-draggable-tree [nodes]="nodes()" [options]="options" />`,
  })
  class Host {
    readonly nodes = signal<DemoNode[]>(cloneFixture(ROOTS));
    readonly options: TreeOptions<DemoNode> = {
      idField: 'id',
      displayField: 'name',
      childrenField: 'children',
      ...extra,
    };
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

/** 当前带进入动画标记的行 id（按 DOM 顺序） */
function enteringIds(fixture: Fixture): string[] {
  return fixture.debugElement
    .queryAll(By.css('.ng-draggable-tree-row.is-entering'))
    .map((el) => el.nativeElement.getAttribute('data-treeid') ?? '');
}

function rootEl(fixture: Fixture): HTMLElement {
  return fixture.debugElement.query(By.css('.ng-draggable-tree-root')).nativeElement;
}

describe('TreeOptions.animate：展开动画', () => {
  it('默认开启：树根带 is-animated，首屏渲染的行不播放进入动画', async () => {
    const { fixture } = setup();
    await flush(fixture);

    expect(rootEl(fixture).classList.contains('is-animated')).toBe(true);
    expect(enteringIds(fixture)).toEqual([]);
  });

  it('展开新增的行带进入动画，已存在的行不重播', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);

    tree.expandNode('1');
    await flush(fixture);

    expect(tree.treeRows().map((r) => r.id)).toEqual(['1', '1-1', '1-2', '2']);
    expect(enteringIds(fixture)).toEqual(['1-1', '1-2']);
  });

  it('折叠后重新展开：行重新挂载，再次带进入动画', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);

    tree.expandNode('1');
    await flush(fixture);

    tree.collapseNode('1');
    await flush(fixture);
    expect(tree.treeRows().map((r) => r.id)).toEqual(['1', '2']);
    expect(enteringIds(fixture)).toEqual([]);

    tree.expandNode('1');
    await flush(fixture);
    expect(enteringIds(fixture)).toEqual(['1-1', '1-2']);
  });

  it('animate: false：树根无 is-animated，新增行也无进入动画', async () => {
    const { fixture, tree } = setup({ animate: false });
    await flush(fixture);

    tree.expandNode('1');
    await flush(fixture);

    expect(tree.treeRows().map((r) => r.id)).toEqual(['1', '1-1', '1-2', '2']);
    expect(rootEl(fixture).classList.contains('is-animated')).toBe(false);
    expect(enteringIds(fixture)).toEqual([]);
  });
});
