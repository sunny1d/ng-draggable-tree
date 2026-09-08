import type { TreeKey } from './tree.types';
import type { TreeRow } from './tree.model';

/* ============================= 控制器宿主接口 ============================= */

/**
 * 键盘导航控制器所需的树组件能力。由 `NgDraggableTreeComponent` 实现并注入，
 * 使控制器能够读取可见行与当前焦点、落定新焦点（含 DOM 聚焦/滚动），
 * 并把按键语义转发为展开/点击/删除等既有行为，而无需触碰组件私有成员。
 *
 * @internal
 */
export interface TreeNavigationHost<T> {
  /** 当前可见行（含展开/选中等装饰状态，按键处理时保持最新） */
  rows: TreeRow<T>[];
  /** 当前焦点行 id（键盘/范围选择锚点） */
  focusId: TreeKey | null;
  /** 写入焦点行 id */
  setFocusId(id: TreeKey): void;
  /** 树根 DOM 元素（#treeRoot） */
  rootElement(): HTMLElement | undefined;
  /** 该行是否可发起展开（懒加载节点在此可触发加载） */
  isRowExpandable(row: TreeRow<T>): boolean;
  /** 该行当前是否可被折叠（过滤视图下被强制展开的分支不可折叠） */
  isRowCollapsible(row: TreeRow<T>): boolean;
  /** 该行当前是否可勾选（复选框可见即 true；未启用复选框或过滤期间自动隐藏时为 false） */
  isRowCheckable(row: TreeRow<T>): boolean;
  /** 切换行勾选（父级三态级联等规则由组件内部处理） */
  toggleCheck(row: TreeRow<T>): void;
  /** 切换行展开/折叠 */
  toggleExpand(row: TreeRow<T>): void;
  /** 模拟点击（Space / Enter 复用点击语义：聚焦 + 单选/范围选） */
  click(row: TreeRow<T>, event: Event): void;
  /** 删除行（Delete 键） */
  deleteRow(row: TreeRow<T>): void;
}

/* ============================= 键盘导航控制器 ============================= */

/**
 * 键盘导航控制器：把树根容器收到的键盘事件映射为“行焦点移动 / 树操作”。
 * - 上下移动焦点、左右展开折叠/回到父级、Home/End、空格切换勾选（复选框模式，否则触发点击）、
 *   回车触发点击、删除；
 * - 焦点移动后同步 DOM 行聚焦与滚动到可视区；
 * - 仅通过 {@link TreeNavigationHost} 与树组件协作。
 *
 * @internal
 */
export class TreeNavigationController<T = unknown> {
  constructor(private readonly host: TreeNavigationHost<T>) {}

  /** 树根键盘事件入口（模板 (keydown) 绑定） */
  onKeydown(event: KeyboardEvent): void {
    const rows = this.host.rows;
    if (!rows.length) return;
    const curIndex = Math.max(0, rows.findIndex((r) => r.id === this.host.focusId));
    const row = rows[curIndex];
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (curIndex < rows.length - 1) this.moveFocusTo(curIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (curIndex > 0) this.moveFocusTo(curIndex - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (row) {
          // 有箭头（非叶子）且折叠/未加载 → 展开（懒加载节点在此发起请求）
          if (!row.expanded && !row.isLeaf && this.host.isRowExpandable(row)) {
            this.host.toggleExpand(row);
          } else if (row.expanded && curIndex < rows.length - 1) {
            this.moveFocusTo(curIndex + 1);
          }
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (row) {
          // 展开且可折叠 → 折叠；其余（叶子、过滤视图下被强制展开的分支）回到父级
          if (this.host.isRowCollapsible(row)) {
            this.host.toggleExpand(row);
          } else if (row.parentId !== null && curIndex > 0) {
            const p = rows.findIndex((r) => r.id === row.parentId);
            if (p >= 0) this.moveFocusTo(p);
          }
        }
        break;
      case ' ':
        event.preventDefault();
        if (!row) break;
        // 复选框模式下 Space 遵循树控件约定切换勾选（行的点击/选中语义留给 Enter）；
        // 复选框当前不可见（未启用 / 过滤期间自动隐藏）时退回点击语义
        if (this.host.isRowCheckable(row)) this.host.toggleCheck(row);
        else this.host.click(row, event);
        break;
      case 'Enter':
        event.preventDefault();
        if (row) this.host.click(row, event);
        break;
      case 'Home':
        event.preventDefault();
        this.moveFocusTo(0);
        break;
      case 'End':
        event.preventDefault();
        this.moveFocusTo(rows.length - 1);
        break;
      case 'Delete':
        if (row) this.host.deleteRow(row);
        break;
      default:
        break;
    }
  }

  /** 把焦点移到指定行：写入焦点 id，并聚焦/滚动对应行 DOM */
  private moveFocusTo(index: number): void {
    const rows = this.host.rows;
    if (index < 0 || index >= rows.length) return;
    this.host.setFocusId(rows[index].id);
    const rootEl = this.host.rootElement();
    if (rootEl) {
      const el = rootEl.querySelector<HTMLElement>(`[data-treeid="${cssEscape(String(rows[index].id))}"]`);
      el?.focus();
      el?.scrollIntoView({ block: 'nearest' });
    }
  }
}

/** 转义选择器元字符，使任意 id 都能安全用于 querySelector */
function cssEscape(value: string): string {
  return value.replace(/["\\\]]/g, (m) => `\\${m}`);
}
