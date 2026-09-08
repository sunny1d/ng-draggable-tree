import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface Feature {
  title: string;
  desc: string;
  path: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './home-page.html',
})
export class HomePage {
  readonly features: Feature[] = [
    {
      title: '基础树与键盘导航',
      desc: '静态层级数据渲染、父子连接线与展开箭头，支持方向键 / Enter / Delete 等完整键盘交互。',
      path: '/basic',
    },
    {
      title: '复选框与三态级联',
      desc: '父节点勾选自动联动全部叶子、自动呈现半选态；selectedNodes 输出便于读取勾选结果。',
      path: '/checkbox',
    },
    {
      title: '子节点懒加载',
      desc: 'hasChildrenField 标记“还有子节点”，children 字段值为 Promise / Observable 或配置 loadChildren，首次展开才拉取并缓存。',
      path: '/lazy',
    },
    {
      title: '拖拽排序与放置校验',
      desc: '基于 CDK DragDrop 的行拖拽，allowDrop 自定义放置规则，支持多选整组拖拽与视觉落点指示。',
      path: '/drag',
    },
    {
      title: '实时过滤与高亮',
      desc: '调用 filter API 即时收窄可见分支，只高亮匹配词、祖先路径自动保留，还可自定义 filterFn 匹配规则。',
      path: '/filter',
    },
  ];
}
