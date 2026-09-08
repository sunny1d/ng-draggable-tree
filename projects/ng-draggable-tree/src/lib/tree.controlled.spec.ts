import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import { NgDraggableTreeComponent } from './ng-draggable-tree';
import type { TreeKey } from './tree.types';
import type { TreeOptions } from './tree-options';

/**
 * 可选受控状态用例：`[expandedIds]` / `[selectedIds]` / `[checkedIds]` + `*Change`。
 * 未绑定时组件自管（既有用例已覆盖），绑定后外部为真源、内部改动回写。
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

function cloneFixture(data: DemoNode[]): DemoNode[] {
  return data.map((n) => ({ ...n, ...(n.children ? { children: cloneFixture(n.children) } : {}) }));
}

/** 受控宿主：外部持有展开/勾选集合，并在 change 里回写自己的 signal */
function setup(optionsOverride: Partial<TreeOptions<DemoNode>> = {}): {
  fixture: Fixture;
  tree: NgDraggableTreeComponent<DemoNode>;
  host: {
    expanded: ReturnType<typeof signal<string[]>>;
    checked: ReturnType<typeof signal<string[]>>;
    selected: ReturnType<typeof signal<string[]>>;
    changes: ReturnType<typeof signal<string[][]>>;
    forceExpanded: ReturnType<typeof signal<string[] | null>>;
  };
} {
  @Component({
    imports: [NgDraggableTreeComponent],
    template: `
      <ng-draggable-tree
        [nodes]="nodes()"
        [options]="options"
        [expandedIds]="expanded()"
        (expandedIdsChange)="onExpandedChange($event)"
        [checkedIds]="checked()"
        (checkedIdsChange)="onCheckedChange($event)"
        [selectedIds]="selected()"
        (selectedIdsChange)="onSelectedChange($event)"
      />
    `,
  })
  class Host {
    readonly nodes = signal<DemoNode[]>(cloneFixture(ROOTS));
    readonly expanded = signal<string[]>(['1']);
    readonly checked = signal<string[]>([]);
    readonly selected = signal<string[]>([]);
    /** 每次 change 的快照，用于验证「相同内容不重复回写」 */
    readonly changes = signal<string[][]>([]);
    /** 非空时：忽略 change，强制把展开集合写回该值（模拟外部拒绝/校验） */
    readonly forceExpanded = signal<string[] | null>(null);
    readonly options: TreeOptions<DemoNode> = {
      idField: 'id',
      displayField: 'name',
      childrenField: 'children',
      ...optionsOverride,
    };

    onExpandedChange(v: Iterable<TreeKey> | null): void {
      const next = [...(v ?? [])].map(String);
      this.changes.update((c) => [...c, next]);
      this.expanded.set(this.forceExpanded() ?? next);
    }

    onCheckedChange(v: Iterable<TreeKey> | null): void {
      this.checked.set([...(v ?? [])].map(String));
    }

    onSelectedChange(v: Iterable<TreeKey> | null): void {
      this.selected.set([...(v ?? [])].map(String));
    }
  }

  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  const host = fixture.componentInstance as unknown as InstanceType<typeof Host>;
  const tree = fixture.debugElement.query(By.directive(NgDraggableTreeComponent))
    .componentInstance as unknown as NgDraggableTreeComponent<DemoNode>;
  return {
    fixture,
    tree,
    host: {
      expanded: host.expanded,
      checked: host.checked,
      selected: host.selected,
      changes: host.changes,
      forceExpanded: host.forceExpanded,
    },
  };
}

async function flush(fixture: Fixture): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
}

const rowIds = (tree: NgDraggableTreeComponent<DemoNode>): string[] => tree.treeRows().map((r) => String(r.id));

describe('可选受控状态：expandedIds / selectedIds / checkedIds', () => {
  it('外部传入展开集合即为初始展开态（外部是真源）', async () => {
    const { fixture, tree } = setup();
    await flush(fixture);

    expect(rowIds(tree)).toEqual(['1', '1-1', '1-2', '2']);

    fixture.destroy();
  });

  it('内部展开/折叠回写 expandedIdsChange，外部随之更新', async () => {
    const { fixture, tree, host } = setup();
    await flush(fixture);

    tree.collapseNode('1');
    await flush(fixture);
    expect(host.expanded()).toEqual([]);
    expect(rowIds(tree)).toEqual(['1', '2']);

    tree.expandNode('1');
    await flush(fixture);
    expect(host.expanded()).toEqual(['1']);
    expect(rowIds(tree)).toEqual(['1', '1-1', '1-2', '2']);

    fixture.destroy();
  });

  it('外部改输入 → 内部跟着变（受控覆盖，含多层展开）', async () => {
    const { fixture, tree, host } = setup();
    await flush(fixture);

    host.expanded.set(['1', '1-1']);
    await flush(fixture);
    expect(rowIds(tree)).toEqual(['1', '1-1', '1-1-1', '1-2', '2']);

    host.expanded.set([]);
    await flush(fixture);
    expect(rowIds(tree)).toEqual(['1', '2']);

    fixture.destroy();
  });

  it('内容相同的新引用不产生重复回写（按 id 集合内容比较）', async () => {
    const { fixture, tree, host } = setup();
    await flush(fixture);
    const before = host.changes().length;

    // 每轮新数组、但内容一致：不应触发任何回写，也不应改变行
    host.expanded.set(['1']);
    await flush(fixture);
    host.expanded.set([...host.expanded()]);
    await flush(fixture);

    expect(host.changes().length).toBe(before);
    expect(rowIds(tree)).toEqual(['1', '1-1', '1-2', '2']);

    fixture.destroy();
  });

  it('外部可在 change 里改写：折叠被拒绝后内部回到原状态', async () => {
    const { fixture, tree, host } = setup();
    await flush(fixture);

    // 外部始终把展开集合钉在 ['1','1-1']
    host.expanded.set(['1', '1-1']);
    await flush(fixture);
    host.forceExpanded.set(['1', '1-1']);

    tree.collapseNode('1');
    await flush(fixture);

    expect(host.expanded()).toEqual(['1', '1-1']);
    expect(rowIds(tree)).toEqual(['1', '1-1', '1-1-1', '1-2', '2']);

    fixture.destroy();
  });

  it('checkedIds 受控：任意写入路径（含 treeState 门面）都回写', async () => {
    const { fixture, tree, host } = setup({ useCheckbox: true });
    await flush(fixture);

    // 门面直写（绕过事件路径）同样回写
    tree.treeState.setState('checked', new Set(['1-1-1']));
    await flush(fixture);
    expect(host.checked()).toEqual(['1-1-1']);

    // 公开方法写入同样回写
    tree.setChecked(['1-1-1', '1-2']);
    await flush(fixture);
    expect(host.checked().sort()).toEqual(['1-1-1', '1-2']);

    fixture.destroy();
  });

  it('selectedIds 受控：双向都生效', async () => {
    const { fixture, tree, host } = setup();
    await flush(fixture);

    // 内部选中 → 回写外部
    tree.selectNode('1');
    await flush(fixture);
    expect(host.selected()).toEqual(['1']);

    // 外部改输入 → 内部跟随
    host.selected.set(['2']);
    await flush(fixture);
    expect([...tree.treeState.getState('selected')]).toEqual(['2']);

    fixture.destroy();
  });

  it('checkedIds 受控：外部改输入 → 内部勾选态随之变化', async () => {
    const { fixture, tree, host } = setup({ useCheckbox: true });
    await flush(fixture);

    host.checked.set(['1-1-1']);
    await flush(fixture);
    expect(tree.treeState.hasState('checked', '1-1-1')).toBe(true);

    host.checked.set([]);
    await flush(fixture);
    expect(tree.treeState.hasState('checked', '1-1-1')).toBe(false);

    fixture.destroy();
  });
});
