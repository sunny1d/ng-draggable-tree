import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import { NgDraggableTreeComponent } from './ng-draggable-tree';
import type { TreeOptions } from './tree-options';

/**
 * 定点更新用例：`tree.updateRow(id, patch, options?)`
 * 只改展示字段时不重建整棵树（其余行对象引用保持稳定），结构变更整体回滚。
 */

interface DemoNode {
  id: string;
  name: string;
  tag?: string;
  hasChildren?: boolean;
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

function cloneFixture(data: DemoNode[]): DemoNode[] {
  return data.map((n) => ({ ...n, ...(n.children ? { children: cloneFixture(n.children) } : {}) }));
}

function setup(optionsOverride: Partial<TreeOptions<DemoNode>> = {}): {
  fixture: Fixture;
  tree: NgDraggableTreeComponent<DemoNode>;
  host: {
    nodes: ReturnType<typeof signal<DemoNode[]>>;
    changes: DemoNode[][];
  };
} {
  @Component({
    imports: [NgDraggableTreeComponent],
    template: `
      <ng-draggable-tree
        [nodes]="nodes()"
        [options]="options"
        [expandedIds]="expanded()"
        (dataChange)="onDataChange($event)"
      />
    `,
  })
  class Host {
    readonly nodes = signal<DemoNode[]>(cloneFixture(ROOTS));
    /** 初始展开根级，使 1-1 / 1-2 可见（1-1 自身折叠，1-1-1 不可见） */
    readonly expanded = signal<string[]>(['1']);
    readonly changes: DemoNode[][] = [];
    readonly options = {
      idField: 'id',
      displayField: 'name',
      childrenField: 'children',
      ...optionsOverride,
    } as TreeOptions<DemoNode>;

    onDataChange(data: DemoNode[]): void {
      this.changes.push(data);
    }
  }

  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  const host = fixture.componentInstance;
  const tree = fixture.debugElement.query(By.directive(NgDraggableTreeComponent))
    .componentInstance as unknown as NgDraggableTreeComponent<DemoNode>;
  return { fixture, tree, host: { nodes: host.nodes, changes: host.changes } };
}

async function flush(fixture: Fixture): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
}

const visibleIds = (tree: NgDraggableTreeComponent<DemoNode>): string[] =>
  tree.treeRows().map((r) => String(r.id));

const rowOf = (tree: NgDraggableTreeComponent<DemoNode>, id: string) =>
  tree.treeRows().find((r) => r.id === id);

function labelOf(fixture: Fixture, id: string): string {
  const el = fixture.debugElement.query(
    By.css(`.ng-draggable-tree-row[data-treeid="${id}"] .ng-draggable-tree-label`),
  );
  return (el?.nativeElement.textContent ?? '').trim();
}

/** 递归查找节点（按 id），用于断言数据源是否被就地改写 */
function findNode(roots: DemoNode[], id: string): DemoNode | null {
  for (const n of roots) {
    if (n.id === id) return n;
    if (n.children) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

describe('updateRow：定点更新单个节点', () => {
  it('展示字段就地写入数据源，并只重建命中的那一行', async () => {
    const { fixture, tree, host } = setup();
    await flush(fixture);
    const before = tree.treeRows();
    const prevTarget = rowOf(tree, '1-1');
    const prevSibling = rowOf(tree, '1-2');
    const prevRoot = rowOf(tree, '1');
    const prevTail = rowOf(tree, '2');

    const ok = tree.updateRow('1-1', { name: 'src(已归档)' });
    await flush(fixture);

    expect(ok).toBe(true);
    expect(findNode(host.nodes(), '1-1')?.name).toBe('src(已归档)');
    expect(labelOf(fixture, '1-1')).toContain('src(已归档)');
    // 命中行换对象（重新渲染），其余行对象引用保持稳定
    expect(rowOf(tree, '1-1')).not.toBe(prevTarget);
    expect(rowOf(tree, '1-2')).toBe(prevSibling);
    expect(rowOf(tree, '1')).toBe(prevRoot);
    expect(rowOf(tree, '2')).toBe(prevTail);
    expect(visibleIds(tree)).toEqual(before.map((r) => String(r.id)));
  });

  it('支持按当前节点计算补丁（函数式）与额外字段', async () => {
    const { fixture, tree, host } = setup();
    await flush(fixture);

    const ok = tree.updateRow('2', (node) => ({ name: `${node.name}(new)`, tag: 'archived' }));
    await flush(fixture);

    expect(ok).toBe(true);
    const node = findNode(host.nodes(), '2');
    expect(node?.name).toBe('文档(new)');
    expect(node?.tag).toBe('archived');
    expect(labelOf(fixture, '2')).toContain('文档(new)');
  });

  it('节点不存在 / 补丁为空：不执行也不发事件', async () => {
    const { fixture, tree, host } = setup();
    await flush(fixture);

    expect(tree.updateRow('nope', { name: 'x' })).toBe(false);
    expect(tree.updateRow('1-1', {})).toBe(false);
    await flush(fixture);

    expect(findNode(host.nodes(), '1-1')?.name).toBe('src');
    expect(host.changes.length).toBe(0);
  });

  it('补丁改动 id：整体回滚并返回 false', async () => {
    const { fixture, tree, host } = setup();
    await flush(fixture);

    const ok = tree.updateRow('1-1', { id: '9', name: '改名' });
    await flush(fixture);

    expect(ok).toBe(false);
    const node = findNode(host.nodes(), '1-1');
    expect(node?.id).toBe('1-1');
    expect(node?.name).toBe('src'); // 同一次补丁里的其它字段一并回滚
    expect(visibleIds(tree)).toEqual(['1', '1-1', '1-2', '2']);
    expect(labelOf(fixture, '1-1')).toContain('src');
    expect(host.changes.length).toBe(0);
  });

  it('补丁改动 children：整体回滚并返回 false', async () => {
    const { fixture, tree, host } = setup();
    await flush(fixture);
    const prevChildren = findNode(host.nodes(), '1')?.children;

    const ok = tree.updateRow('1', { children: [] as unknown as DemoNode[] });
    await flush(fixture);

    expect(ok).toBe(false);
    expect(findNode(host.nodes(), '1')?.children).toBe(prevChildren);
    expect(visibleIds(tree)).toEqual(['1', '1-1', '1-2', '2']);
    expect(host.changes.length).toBe(0);
  });

  it('折叠中（当前不可见）的节点同样可更新', async () => {
    const { fixture, tree, host } = setup();
    await flush(fixture);
    expect(visibleIds(tree)).toEqual(['1', '1-1', '1-2', '2']); // 1-1-1 未展开

    const ok = tree.updateRow('1-1-1', { name: 'index.ts' });
    expect(ok).toBe(true);
    expect(findNode(host.nodes(), '1-1-1')?.name).toBe('index.ts');

    tree.expandNode('1-1');
    await flush(fixture);
    expect(visibleIds(tree)).toEqual(['1', '1-1', '1-1-1', '1-2', '2']);
    expect(labelOf(fixture, '1-1-1')).toContain('index.ts');
  });

  it('emit 默认发 dataChange（载荷即数据源引用），false 时静默', async () => {
    const { fixture, tree, host } = setup();
    await flush(fixture);

    tree.updateRow('1-1', { name: 'A' });
    await flush(fixture);
    expect(host.changes.length).toBe(1);
    expect(host.changes[0]).toBe(host.nodes()); // 同一引用，不是快照

    tree.updateRow('1-1', { name: 'B' }, { emit: false });
    await flush(fixture);
    expect(host.changes.length).toBe(1); // 静默：数据已改，只是不发事件
    expect(labelOf(fixture, '1-1')).toContain('B');
  });

  it('过滤中命中结果变化：可见行集合同步重算', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);

    tree.filter('docs');
    await flush(fixture);
    expect(visibleIds(tree)).toEqual(['1', '1-2']); // 命中 1-2 + 祖先路径

    // 改名后不再命中：整树重算，可见行集合同步刷新
    expect(tree.updateRow('1-2', { name: '手册' })).toBe(true);
    await flush(fixture);
    expect(visibleIds(tree)).toEqual([]);
  });

  it('懒加载判定变化（hasChildren）：退化为整树重算，箭头随之出现', async () => {
    const { fixture, tree, host } = setup();
    await flush(fixture);
    expect(rowOf(tree, '1-2')?.expanderVisible).toBe(false);

    const ok = tree.updateRow('1-2', { hasChildren: true });
    await flush(fixture);

    expect(ok).toBe(true);
    expect(findNode(host.nodes(), '1-2')?.hasChildren).toBe(true);
    expect(rowOf(tree, '1-2')?.expanderVisible).toBe(true);
  });
});
