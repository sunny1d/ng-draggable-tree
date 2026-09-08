import type { NormalizedTreeOptions, TreeOptions } from './tree-options';
import type { TreeKey } from './tree.types';

/**
 * 树组件内部使用的通用纯函数。与拖拽 / 键盘导航等“行为控制器”不同，
 * 本模块只提供无状态的计算与树数据变换，便于独立测试。
 *
 * @internal
 */

/** 判断未知值是否为异步可等待对象（Promise 或含 subscribe 的对象，如 RxJS Observable） */
export function isAsyncObject(v: unknown): boolean {
  if (!v || (typeof v !== 'object' && typeof v !== 'function')) return false;
  return (
    typeof (v as { then?: unknown }).then === 'function' ||
    typeof (v as { subscribe?: unknown }).subscribe === 'function'
  );
}

/**
 * 浅比较两份「原始」options 输入是否等价：键集合一致 + 各项 `===`（函数按引用比较）。
 * 用于跳过「内容未变但引用已变」的重复配置，避免无谓的整树重建。
 *
 * 注意：不能在标准化后的 {@link NormalizedTreeOptions} 上做这个比较——
 * normalizeOptions 每次都会生成全新的访问器闭包（getId / getChildren / getDisplay / ...），
 * 深比较必然判定为“已变化”。此外被忽略的 `undefined` 值等价于“未设置”。
 */
export function sameOptionsInput<T>(
  a: TreeOptions<T> | null | undefined,
  b: TreeOptions<T> | null | undefined,
): boolean {
  if (a === b) return true;
  const ao = (a ?? {}) as Record<string, unknown>;
  const bo = (b ?? {}) as Record<string, unknown>;
  const keys = Object.keys(ao).filter((k) => ao[k] !== undefined);
  if (keys.length !== Object.keys(bo).filter((k) => bo[k] !== undefined).length) return false;
  for (const k of keys) {
    if (ao[k] !== bo[k]) return false;
  }
  return true;
}

/** 将懒加载结果就地写入节点 children（原地修改数据，调用方随后递增数据版本号） */
export function attachResolvedChildren<T>(
  roots: T[],
  opts: NormalizedTreeOptions<T>,
  id: TreeKey,
  children: T[],
): void {
  const apply = (list: T[]): boolean => {
    for (const node of list) {
      if (opts.getId(node) === id) {
        writeChildren(node, children, opts);
        return true;
      }
      const childArr = opts.getChildren(node);
      if (Array.isArray(childArr) && childArr.length && apply(childArr as T[])) return true;
    }
    return false;
  };
  apply(roots);
}

function writeChildren<T>(node: T, children: T[], opts: NormalizedTreeOptions<T>): void {
  (node as Record<string, unknown>)[opts.childrenStorage] = children;
}
