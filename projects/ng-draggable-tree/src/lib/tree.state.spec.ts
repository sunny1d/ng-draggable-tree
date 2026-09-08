import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { createTreeStateStore } from './tree.state';
import { TreeNode } from './tree.node';
import type { TreeKey, TreeSetStateKind } from './tree.types';

/** 造一个与组件同构的状态门面（6 类集合状态各一个 signal） */
function storeOf(): {
  store: ReturnType<typeof createTreeStateStore>;
  signals: Record<TreeSetStateKind, ReturnType<typeof signal<ReadonlySet<TreeKey>>>>;
} {
  const signals: Record<TreeSetStateKind, ReturnType<typeof signal<ReadonlySet<TreeKey>>>> = {
    expanded: signal<ReadonlySet<TreeKey>>(new Set()),
    selected: signal<ReadonlySet<TreeKey>>(new Set()),
    checked: signal<ReadonlySet<TreeKey>>(new Set()),
    loading: signal<ReadonlySet<TreeKey>>(new Set()),
    lazyRequested: signal<ReadonlySet<TreeKey>>(new Set()),
    asyncLeaves: signal<ReadonlySet<TreeKey>>(new Set()),
  };
  return { store: createTreeStateStore(signals), signals };
}

describe('createTreeStateStore', () => {
  it('按种类读写集合状态，各状态互相隔离', () => {
    const { store } = storeOf();
    store.setState('expanded', new Set(['1']));
    expect([...store.getState('expanded')]).toEqual(['1']);
    expect(store.getState('selected').size).toBe(0);
    expect(store.hasState('expanded', '1')).toBe(true);
    expect(store.hasState('expanded', '2')).toBe(false);
  });

  it('mutateState 复制后写回（不可变更新），无变化时不写回', () => {
    const { store, signals } = storeOf();
    const before = signals.expanded();
    expect(store.mutateState('expanded', (draft) => draft.delete('missing'))).toBe(false);
    expect(signals.expanded()).toBe(before); // 引用未变 → 不触发重算

    expect(store.mutateState('expanded', (draft) => draft.add('1'))).toBe(true);
    expect(signals.expanded()).not.toBe(before);
    expect([...store.getState('expanded')]).toEqual(['1']);
    expect([...before]).toEqual([]); // 原集合未被原地修改
  });
});

describe('TreeNode 视图', () => {
  it('getter 实时读状态集合，不缓存快照', () => {
    const { store } = storeOf();
    const node = new TreeNode({ id: '1' }, '1', null, 0, 0, store);
    expect(node.getState()).toEqual({ expanded: false, selected: false, checked: false, loading: false });

    store.setState('expanded', new Set(['1']));
    store.setState('loading', new Set(['1']));
    expect(node.isExpanded).toBe(true);
    expect(node.isLoading).toBe(true);
    expect(node.getState()).toEqual({ expanded: true, selected: false, checked: false, loading: true });
  });

  it('setState 只写传入字段，并可多次调用', () => {
    const { store } = storeOf();
    const node = new TreeNode({ id: '1' }, '1', null, 0, 0, store);

    node.setState({ selected: true });
    node.setState({ expanded: true, loading: true });
    expect(node.getState()).toEqual({ expanded: true, selected: true, checked: false, loading: true });

    node.setState({ expanded: false });
    expect(node.isExpanded).toBe(false);
    expect(store.getState('expanded').size).toBe(0);
  });

  it('持有树语义：data / parent / depth / index', () => {
    const { store } = storeOf();
    const root = new TreeNode({ id: '1', name: 'A' }, '1', null, 0, 0, store);
    const child = new TreeNode({ id: '1-1', name: 'A1' }, '1-1', root, 1, 2, store);
    expect(child.parent).toBe(root);
    expect(child.depth).toBe(1);
    expect(child.index).toBe(2); // 父级数组下标
    expect(child.data.name).toBe('A1');
  });
});
