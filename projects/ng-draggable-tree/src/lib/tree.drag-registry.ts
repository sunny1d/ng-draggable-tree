import { Injectable } from '@angular/core';
import type { DropPosition, TreeKey } from './tree.types';

/**
 * 一次“跨树拖拽”的源侧会话载荷。
 *
 * 数据为「源树工作树克隆」中分离出来的最顶层节点（含完整子树）的深拷贝，
 * 因此接收树可以把载荷直接插入自己的克隆数据，而不会与源树共享对象引用。
 *
 * @internal
 */
export interface CrossTreeDragSession {
  /** 被拖拽的最顶层节点克隆（含完整子树，已按树先序去重排序） */
  nodes: unknown[];
  /** 最顶层节点 id */
  ids: TreeKey[];
  /** 被拖拽整棵子树（含全部后代）的 id 集合，用于接收树的重叠冲突检测 */
  subtreeIds: TreeKey[];
  /** 源树 options.dragGroup */
  group: string;
}

/**
 * 参与跨树拖拽的“树拖拽控制器”能力视图（抹去泛型后的运行期接口）。
 * 由各树的 `TreeDragController` 构造时封装并注册到 {@link TreeDragRegistry}。
 *
 * @internal
 */
export interface CrossTreeParticipant {
  /** 该树当前的跨树配置 */
  crossTreeMode(): 'move' | 'copy' | 'disabled';
  /** 该树的跨树分组 */
  group(): string;
  /** 该树是否正忙于自身节点的拖拽 */
  isBusy(): boolean;
  /** 视口坐标是否落在该树根元素区域内 */
  containsPoint(point: { x: number; y: number }): boolean;
  /**
   * 源侧广播指针移动：更新/清除本树的跨树落点标记。
   * 返回本树是否接管本次悬停（指针落在本树区域内），源侧据此判定
   * 「指针是否已在别的树上方」，无需自己再做一次几何判定。
   */
  handleExternalPointerMove(point: { x: number; y: number }, session: CrossTreeDragSession): boolean;
  /**
   * 目标树解析一次外部放置（指针停留处的标记必须有效）。
   * 只“算出落点并回报给源树”，不修改任何数据——是否真正落位由使用方
   * 依据源树发出的 dragEnd 载荷决定并调用公开执行器。
   */
  resolveExternalDrop(session: CrossTreeDragSession): CrossTreeDropResolution;
  /** 结束/取消接收外部拖拽，清除标记与外部会话 */
  clearExternalState(): void;
}

/**
 * 目标树一次外部放置的解析结果（库不改动数据，仅描述“落在哪”）。
 * ok=true 表示落点有效；targetRowId/position/target/parent 描述落点位置，
 * tree 为接收树组件实例（供 dragEnd 事件载荷向使用方暴露）。
 */
export interface CrossTreeDropResolution {
  ok: boolean;
  /** 落点所在的目标行 id；null 表示根级末尾 */
  targetRowId: TreeKey | null;
  /** 方位；ok=false 时为 null */
  position: DropPosition | null;
  /** 目标行节点数据；根级末尾时为 null */
  target: unknown | null;
  /** 解析出的父级 id（before/after → 目标行原父级；child → 目标行自身；根级末尾 → null） */
  parentId: TreeKey | null;
  /** 父级节点数据 */
  parent: unknown | null;
  /** 接收树组件实例 */
  tree: unknown;
}

/**
 * 跨树拖拽注册表：收集页面内所有启用了跨树拖拽的树拖拽控制器，
 * 供源树在指针移动/松手时向“同组且启用”的目标树广播坐标与会话。
 *
 * 使用 `providedIn: 'root'` 单例，同一注入上下文中的多棵树天然共享，
 * 无需使用方手工接线。
 *
 * @internal
 */
@Injectable({ providedIn: 'root' })
export class TreeDragRegistry {
  private readonly members = new Set<CrossTreeParticipant>();

  /** 注册一棵树（控制器构造时调用） */
  register(participant: CrossTreeParticipant): void {
    this.members.add(participant);
  }

  /** 注销一棵树（控制器销毁时调用） */
  unregister(participant: CrossTreeParticipant): void {
    this.members.delete(participant);
  }

  /** 遍历当前全部参与者（返回前复制一份，允许回调中安全注销） */
  forEach(visit: (participant: CrossTreeParticipant) => void): void {
    for (const member of [...this.members]) {
      visit(member);
    }
  }
}
