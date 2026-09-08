import type { WritableSignal } from '@angular/core';
import type { TreeKey, TreeSetStateKind, TreeStateStore } from './tree.types';

/**
 * 全部「集合类状态」种类。新增一种状态只需：
 * 1. 在 {@link TreeSetStateKind} 里加一个名字；
 * 2. 在组件里挂一个对应的 `signal<ReadonlySet<TreeKey>>` 并登记进 `createTreeStateStore`。
 *
 * @internal
 */
export const TREE_SET_STATE_KINDS = [
  'expanded',
  'selected',
  'checked',
  'loading',
  'lazyRequested',
  'asyncLeaves',
] as const satisfies readonly TreeSetStateKind[];

/** 集合内容是否一致（尺寸 + 成员），用于避免无变化写回 */
function sameSet(a: ReadonlySet<TreeKey>, b: ReadonlySet<TreeKey>): boolean {
  if (a.size !== b.size) return false;
  for (const value of b) {
    if (!a.has(value)) return false;
  }
  return true;
}

/**
 * 以「种类 → signal」登记表实现的状态门面（内部存储仍是 `Set`）：
 * 各状态按自身粒度持有 signal，依赖它的 computed 失效范围保持不变，
 * 门面只把「读写入口」收敛到一处。
 *
 * @internal
 */
export function createTreeStateStore(
  signals: Record<TreeSetStateKind, WritableSignal<ReadonlySet<TreeKey>>>,
): TreeStateStore {
  return {
    getState: (kind) => signals[kind](),
    setState: (kind, value) => signals[kind].set(value),
    hasState: (kind, id) => signals[kind]().has(id),
    mutateState: (kind, mutate) => {
      const signal = signals[kind];
      const current = signal();
      const draft = new Set(current);
      mutate(draft);
      if (sameSet(current, draft)) return false;
      signal.set(draft);
      return true;
    },
  };
}
