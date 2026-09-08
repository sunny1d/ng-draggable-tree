import { describe, expect, it } from 'vitest';
import { normalizeOptions, type NormalizedTreeOptions } from './tree-options';
import type { TreeKey } from './tree.types';
import {
  type FlattenContext,
  buildCheckStats,
  collectSubtreeIds,
  flattenRows,
  flattenStructure,
  isDescendantId,
  resolveRowDecoration,
  walkNodes,
} from './tree.model';

interface DemoNode {
  id: string;
  name: string;
  children?: DemoNode[];
}

const ROOTS: DemoNode[] = [
  {
    id: '1',
    name: 'root-a',
    children: [
      { id: '1-1', name: 'leaf-a1' },
      { id: '1-2', name: 'node-b', children: [{ id: '1-2-1', name: 'deep' }] },
    ],
  },
  { id: '2', name: 'root-b' },
];

function optsOf(): NormalizedTreeOptions<DemoNode> {
  return normalizeOptions<DemoNode>({
    idField: 'id',
    displayField: 'name',
    childrenField: 'children',
  });
}

function ctxOf(overrides: Partial<FlattenContext<DemoNode>> = {}): FlattenContext<DemoNode> {
  const options = overrides.options ?? optsOf();
  return {
    options,
    roots: overrides.roots ?? ROOTS,
    expanded: overrides.expanded ?? new Set<TreeKey>(),
    selected: overrides.selected ?? new Set<TreeKey>(),
    checkedLeaves: overrides.checkedLeaves ?? new Set<TreeKey>(),
    asyncLeaves: overrides.asyncLeaves ?? new Set<TreeKey>(),
    activeId: overrides.activeId ?? null,
    keyword: overrides.keyword ?? '',
    isLazyNode: overrides.isLazyNode ?? options.isLazyNode,
  };
}

const allIds = (rows: { id: TreeKey }[]): string[] => rows.map((r) => String(r.id));

describe('walkNodes', () => {
  it('先序遍历全部已加载节点', () => {
    const out: TreeKey[] = [];
    walkNodes(ROOTS, optsOf(), (view) => out.push(view.id));
    expect(out).toEqual(['1', '1-1', '1-2', '1-2-1', '2']);
  });

  it('children 字段值为懒加载函数时不递归未加载子树', () => {
    const options = normalizeOptions<DemoNode>({ idField: 'id', displayField: 'name' });
    const node = { id: 'lazy', name: 'x', children: () => null } as unknown as DemoNode;
    const out: TreeKey[] = [];
    walkNodes([node], options, (view) => out.push(view.id));
    expect(out).toEqual(['lazy']);
  });
});

describe('flattenRows', () => {
  it('默认全部折叠时仅渲染顶层行', () => {
    const rows = flattenRows(ctxOf());
    expect(allIds(rows)).toEqual(['1', '2']);
    expect(rows[0].depth).toBe(0);
    expect(rows[0].isLeaf).toBe(false); // 非叶子 → 展示展开箭头
    expect(rows[1].isLeaf).toBe(true);
  });

  it('传入 expanded 后按层展开并计算深度', () => {
    const l1 = flattenRows(ctxOf({ expanded: new Set(['1']) }));
    expect(allIds(l1)).toEqual(['1', '1-1', '1-2', '2']);
    expect(l1[1].depth).toBe(1);

    const l2 = flattenRows(ctxOf({ expanded: new Set(['1', '1-2']) }));
    expect(allIds(l2)).toEqual(['1', '1-1', '1-2', '1-2-1', '2']);
    expect(l2[3].depth).toBe(2);
    expect(l2[1].expanded).toBe(false);
  });

  it('懒加载模式：待加载节点非叶子（展示箭头）', () => {
    const lazyOptions = normalizeOptions<DemoNode>({
      idField: 'id',
      displayField: 'name',
      loadChildren: () => null,
    });
    const rows = flattenRows(ctxOf({ options: lazyOptions, roots: [{ id: 'L', name: '待加载' }] }));
    expect(rows[0].isLeaf).toBe(false);
    expect(rows[0].expanded).toBe(false);
  });

  it('hasChildrenField 标记有子节点：未加载时按非叶子处理，确认为空后转为叶子', () => {
    const options = normalizeOptions<DemoNode>({
      idField: 'id',
      displayField: 'name',
      hasChildrenField: 'hasChildren',
    });
    const roots = [{ id: 'P', name: '父', hasChildren: true } as DemoNode];

    // 未加载：非叶子 → 展示展开箭头
    const pending = flattenRows(ctxOf({ options, roots }));
    expect(pending[0].isLeaf).toBe(false);

    // 加载结果为空（已记录 asyncLeaves）：按叶子处理，不再显示展开按钮
    const empty = flattenStructure(ctxOf({ options, roots, asyncLeaves: new Set(['P']) }));
    expect(empty[0].isLeaf).toBe(true);
  });

  it('hasChildrenField 支持自定义字段名，非 true 视为叶子', () => {
    const options = normalizeOptions<DemoNode>({
      idField: 'id',
      displayField: 'name',
      hasChildrenField: 'hasChild',
    });
    const rows = flattenStructure(
      ctxOf({
        options,
        roots: [
          { id: 'A', name: 'a', hasChild: true } as DemoNode,
          { id: 'B', name: 'b', hasChild: false } as DemoNode,
          { id: 'C', name: 'c' },
        ],
      }),
    );
    expect(rows.map((r) => r.isLeaf)).toEqual([false, true, true]);
  });

  it('关键字过滤：命中节点与其祖先可见', () => {
    const rows = flattenRows(ctxOf({ keyword: 'deep' }));
    expect(allIds(rows)).toEqual(['1', '1-2', '1-2-1']);
    expect(rows[2].matched).toBe(true);
    expect(rows[1].subtreeHasMatch).toBe(true);
    expect(rows[0].subtreeHasMatch).toBe(true);
  });

  it('关键字过滤 autoShow: false：只展示命中节点自身，穿透未命中的中间层', () => {
    const options = normalizeOptions<DemoNode>({
      idField: 'id',
      displayField: 'name',
      autoShow: false,
    });
    const rows = flattenStructure(ctxOf({ options, keyword: 'deep' }));
    expect(allIds(rows)).toEqual(['1-2-1']); // 祖先与兄弟都不出现
    expect(rows[0].depth).toBe(2); // 仍按原始层级缩进
    expect(rows[0].matched).toBe(true);
    expect(rows[0].subtreeHasMatch).toBe(false); // 结果集不含「祖先路径行」
    expect(rows[0].expanded).toBe(false);
    expect(rows[0].expanderVisible).toBe(false); // 结果行不可展开
    expect(rows[0].linesVisible).toBe(false);
  });

  it('关键字过滤 autoShow: false：命中父级不连带展开，自身命中的父子各自成行', () => {
    const options = normalizeOptions<DemoNode>({
      idField: 'id',
      displayField: 'name',
      autoShow: false,
    });
    const roots: DemoNode[] = [
      {
        id: 'r',
        name: 'root',
        children: [{ id: 'r1', name: 'rooty', children: [{ id: 'r2', name: 'deep' }] }],
      },
    ];
    const rows = flattenStructure(ctxOf({ options, roots, keyword: 'root' }));
    // 'r' 与 'r1' 自身命中 → 各自独立成行；'r2' 未命中 → 不出现
    expect(allIds(rows)).toEqual(['r', 'r1']);
    expect(rows[0].expanded).toBe(false);
    expect(rows[0].expanderVisible).toBe(false);
    expect(rows[1].depth).toBe(1);
  });

  it('关键字过滤 autoShow 默认 true：保持保留路径的既有行为', () => {
    const rows = flattenStructure(ctxOf({ keyword: 'deep' }));
    expect(allIds(rows)).toEqual(['1', '1-2', '1-2-1']);
    // 非叶子祖先被强制展开呈现：箭头可见但不可折叠（交互层据 isRowCollapsible 判定）
    expect(rows[1].subtreeHasMatch).toBe(true);
    expect(rows[1].expanded).toBe(true);
    expect(rows[1].expanderVisible).toBe(true);
    expect(rows[2].expanderVisible).toBe(false); // 叶子无箭头
  });
});

describe('连接线 linesVisible', () => {
  // app 是 src 的最后一个子级：连接线列只由 depth 驱动，与是否为最后兄弟无关
  const GUIDE_ROOTS: DemoNode[] = [
    {
      id: 'p1',
      name: 'p1',
      children: [
        {
          id: 'src',
          name: 'src',
          children: [
            { id: 'main', name: 'main' },
            {
              id: 'app',
              name: 'app',
              children: [
                { id: 'home', name: 'home' },
                { id: 'app-html', name: 'app-html' },
              ],
            },
          ],
        },
        { id: 'doc', name: 'doc' },
      ],
    },
    { id: 'p2', name: 'p2' },
  ];

  it('正常展开视图：每个可见行都标记需要画连接线', () => {
    const rows = flattenRows(
      ctxOf({ roots: GUIDE_ROOTS, expanded: new Set(['p1', 'src', 'app']) }),
    );
    expect(allIds(rows)).toEqual(['p1', 'src', 'main', 'app', 'home', 'app-html', 'doc', 'p2']);
    // 行可见即祖先均已展开，竖线按 depth 生成的列绘制，全部行均需要连接线
    expect(rows.every((r) => r.linesVisible)).toBe(true);
  });

  it('过滤视图：层级被强制展示，不画连接线', () => {
    const rows = flattenRows(ctxOf({ roots: GUIDE_ROOTS, keyword: 'home' }));
    expect(allIds(rows)).toEqual(['p1', 'src', 'app', 'home']);
    expect(rows.every((r) => r.linesVisible === false)).toBe(true);
  });
});

describe('结构层 flattenStructure / 装饰层解耦', () => {
  it('结构层不接收装饰状态：装饰集合非空也不改变结构输出与占位', () => {
    const base = ctxOf({ expanded: new Set(['1']) });
    const s1 = flattenStructure(base);
    // 结构行装饰字段一律为占位值
    expect(s1.every((r) => !r.selected && !r.active && r.checkboxState === 'hidden')).toBe(true);
    // 装饰集合非空（选中/勾选/焦点）同样不参与结构层：行 id 序列与占位值都不受影响
    const decorated: FlattenContext<DemoNode> = {
      ...base,
      expanded: new Set(['1', '1-2']),
      selected: new Set<TreeKey>(['1-1']),
      checkedLeaves: new Set<TreeKey>(['1-2-1']),
      activeId: '2',
    };
    const s2 = flattenStructure(decorated);
    expect(allIds(s2)).toEqual(['1', '1-1', '1-2', '1-2-1', '2']);
    expect(s2.every((r) => !r.selected && !r.active && r.checkboxState === 'hidden')).toBe(true);
  });

  it('resolveRowDecoration 还原 flattenRows 的装饰语义（勾选/选中/焦点/过滤）', () => {
    const options = optsOf();
    const ctx = ctxOf({
      options: { ...options, useCheckbox: true } as typeof options,
      expanded: new Set(['1']),
      selected: new Set(['1-1']),
      checkedLeaves: new Set(['1-1']),
      activeId: '1-2',
    });
    const rows = flattenRows(ctx);
    const structure = flattenStructure(ctx);
    const stats = buildCheckStats(ROOTS, options, new Set(['1-1']));
    const decoInput = {
      options: { ...options, useCheckbox: true } as typeof options,
      selected: ctx.selected,
      checkedLeaves: ctx.checkedLeaves,
      activeId: ctx.activeId,
      stats,
      filterActive: false,
    };
    expect(structure.length).toBe(rows.length);
    structure.forEach((row, i) => {
      expect(resolveRowDecoration(row.id, decoInput)).toEqual({
        selected: rows[i].selected,
        active: rows[i].active,
        checkboxState: rows[i].checkboxState,
      });
    });
  });

  it('异步空叶子：记录过 expanded 后行保持展开态，无子级可展示', () => {
    const lazyOptions = normalizeOptions<DemoNode>({
      idField: 'id',
      displayField: 'name',
      loadChildren: () => null,
    });
    const base = ctxOf({
      options: lazyOptions,
      roots: [{ id: 'E', name: '空目录' }],
      asyncLeaves: new Set(['E']),
    });
    // 未记录展开 → 折叠态
    const closed = flattenStructure(ctxOf({ ...base, expanded: new Set() }));
    expect(closed[0].expanded).toBe(false);
    // 展开过（空目录）→ 保持展开态，且仍无子级渲染
    const opened = flattenStructure(ctxOf({ ...base, expanded: new Set(['E']) }));
    expect(opened[0].expanded).toBe(true);
    expect(allIds(opened)).toEqual(['E']);
  });

  it('过滤时复选框隐藏：装饰层与 flattenRows 一致输出 hidden', () => {
    const options = { ...optsOf(), useCheckbox: true } as NormalizedTreeOptions<DemoNode>;
    const ctx = ctxOf({ options, keyword: 'deep' });
    const rows = flattenRows(ctx);
    const structure = flattenStructure(ctx);
    const decoInput = {
      options,
      selected: ctx.selected,
      checkedLeaves: ctx.checkedLeaves,
      activeId: ctx.activeId,
      stats: null,
      filterActive: true,
    };
    structure.forEach((row, i) => {
      expect(resolveRowDecoration(row.id, decoInput).checkboxState).toBe('hidden');
      expect(rows[i].checkboxState).toBe('hidden');
    });
  });
});

describe('buildCheckStats', () => {
  it('为每个节点写入其下叶子数与已勾选叶子数', () => {
    const options = optsOf();
    const stats = buildCheckStats(ROOTS, options, new Set(['1-1', '1-2-1']));
    expect(stats.get('1')).toEqual({ total: 2, checked: 2 });
    expect(stats.get('1-2')).toEqual({ total: 1, checked: 1 });
    expect(stats.get('1-1')).toEqual({ total: 1, checked: 1 });
    expect(stats.get('1-2-1')).toEqual({ total: 1, checked: 1 });
    expect(stats.get('2')).toEqual({ total: 1, checked: 0 });
    expect(stats.has('missing')).toBe(false);
  });

  it('区分全部未勾选与部分勾选', () => {
    const options = optsOf();
    const none = buildCheckStats(ROOTS, options, new Set());
    expect(none.get('1')).toEqual({ total: 2, checked: 0 });
    const partial = buildCheckStats(ROOTS, options, new Set(['1-2-1']));
    expect(partial.get('1-2')).toEqual({ total: 1, checked: 1 });
    expect(partial.get('1')).toEqual({ total: 2, checked: 1 });
    expect(partial.get('1-1')).toEqual({ total: 1, checked: 0 });
  });
});

describe('collectSubtreeIds / isDescendantId', () => {
  it('收集节点子树 id（含自身）并按树序输出', () => {
    const ids = collectSubtreeIds(ROOTS[0], optsOf());
    expect(ids).toEqual(['1', '1-1', '1-2', '1-2-1']);
  });

  it('isDescendantId 正确识别后代关系', () => {
    const options = optsOf();
    expect(isDescendantId(ROOTS[0], options, '1-2-1')).toBe(true);
    expect(isDescendantId(ROOTS[0], options, '2')).toBe(false);
    expect(isDescendantId(ROOTS[0], options, '1')).toBe(false);
  });
});

describe('resolveRowDecoration：useTriState', () => {
  const checkOptions = (useTriState: boolean) =>
    normalizeOptions<DemoNode>({
      idField: 'id',
      displayField: 'name',
      childrenField: 'children',
      useCheckbox: true,
      useTriState,
    });
  const inputOf = (useTriState: boolean, checked: string[]) => ({
    options: checkOptions(useTriState),
    selected: new Set<TreeKey>(),
    checkedLeaves: new Set<TreeKey>(checked),
    activeId: null,
    stats: useTriState
      ? buildCheckStats(ROOTS, checkOptions(true), new Set<TreeKey>(checked))
      : null,
    filterActive: false,
  });

  it('三态（默认）：分支状态由后代统计派生，并出现半选态', () => {
    const input = inputOf(true, ['1-2-1']);
    expect(resolveRowDecoration('1', input).checkboxState).toBe('indeterminate');
    expect(resolveRowDecoration('1-2', input).checkboxState).toBe('checked');
    expect(resolveRowDecoration('1-1', input).checkboxState).toBe('unchecked');
  });

  it('非三态：各节点状态只取自身是否在勾选集合中，无半选态', () => {
    const input = inputOf(false, ['1', '1-2-1']);
    expect(resolveRowDecoration('1', input).checkboxState).toBe('checked'); // 分支自身勾选
    expect(resolveRowDecoration('1-1', input).checkboxState).toBe('unchecked');
    expect(resolveRowDecoration('1-2', input).checkboxState).toBe('unchecked'); // 不因后代勾选而派生
    expect(resolveRowDecoration('1-2-1', input).checkboxState).toBe('checked');
  });

  it('flattenRows：非三态不构建统计，父级勾选态与后代无关', () => {
    const rows = flattenRows(
      ctxOf({
        options: checkOptions(false),
        expanded: new Set<TreeKey>(['1', '1-2']),
        checkedLeaves: new Set<TreeKey>(['1-2-1']),
      }),
    );
    const state = new Map(rows.map((r) => [r.id, r.checkboxState]));
    expect(state.get('1')).toBe('unchecked');
    expect(state.get('1-2')).toBe('unchecked');
    expect(state.get('1-2-1')).toBe('checked');
    expect(rows.some((r) => r.checkboxState === 'indeterminate')).toBe(false);
  });

  it('关闭 useCheckbox 时一律 hidden（与 useTriState 无关）', () => {
    const input = {
      ...inputOf(false, ['1']),
      options: normalizeOptions<DemoNode>({ idField: 'id', displayField: 'name', useTriState: false }),
    };
    expect(resolveRowDecoration('1', input).checkboxState).toBe('hidden');
  });
});
