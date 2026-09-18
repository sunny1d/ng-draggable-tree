/** 示例应用共享的数据模型与数据集 */

export interface FileNode {
  id: string;
  name: string;
  icon?:string;
  hasChildren?: boolean;
  kind: 'folder' | 'file';
  children?: FileNode[];
}

export interface DictNode {
  id: string;
  name: string;
  kind: 'group' | 'permission';
  children?: DictNode[];
  select?:boolean
}

export interface LazyNode {
  id: string;
  name: string;
  children?: LazyNode[];
  /** 是否还有未加载的子节点（懒加载标记，对应 TreeOptions.hasChildrenField） */
  hasChildren?: boolean;

  expanded?:boolean;

  select?:boolean;
}

let seq = 0;

/** 生成演示用的自增唯一 id */
export function makeId(prefix = 'node'): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** 带毫秒时间戳的日志前缀 */
export function timeNow(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

/** 文件目录树（各示例共用） */
export function fileTree(): FileNode[] {
  return [
    {
      id: 'p1',
      name: '应用演示',
      kind: 'folder',
      icon:'folder',
      children: [
        {
          id: 'p1-src',
          name: 'src',
          kind: 'folder',
          icon:'folder',
          children: [
            { id: 'p1-main', name: 'main.ts', kind: 'file',  icon:'block' },
            { id: 'p1-style', name: 'styles.scss', kind: 'file',  icon:'blocktocall' },
            {
              id: 'p1-app',
              name: 'app',
              kind: 'folder',
              icon:'3dgrid',
              children: [
                { id: 'p1-home', name: 'home.component.ts', kind: 'file',  icon:'single' },
                { id: 'p1-app-html', name: 'app.component.html', kind: 'file',  icon:'singlegrid' },
              ],
            },
          ],
        },
        {
          id: 'p1-doc',
          name: 'docs',
          kind: 'folder',
          icon:'folder',
          children: [{ id: 'p1-api', name: 'api.md',  icon:'condition', kind: 'file' }],
        },
        { id: 'p1-json', name: 'angular.json', kind: 'file',  icon:'rank' },
      ],
    },
    {
      id: 'p2',
      name: 'ng-draggable-tree 库',
      kind: 'folder',
      icon:'folder',
      children: [
        {
          id: 'p2-lib',
          name: 'lib',
          kind: 'folder',
          icon:'page',
          children: [
            { id: 'p2-core', name: 'ng-draggable-tree.ts',icon:'single', kind: 'file' },
            { id: 'p2-node', name: 'ng-draggable-tree-node.ts',icon:'multi', kind: 'file' },
            { id: 'p2-model', name: 'tree.model.ts',icon:'media', kind: 'file' },
            { id: 'p2-ops', name: 'tree.operations.ts',icon:'numericlist', kind: 'file' },
          ],
        },
        { id: 'p2-pkg', name: 'ng-package.json',icon:'opentextlist', kind: 'file' },
      ],
    },
    {
      id: 'p3',
      name: '参考资料',
      kind: 'folder',
      icon:'page',
      children: [
        { id: 'p3-readme', name: 'README.md',icon:'opentextlist', kind: 'file' },
        { id: 'p3-cdk', name: 'CDK Tree 说明.md',icon:'numericlist', kind: 'file' },
      ],
    },
     {
      id: 'p4',
      name: '空目录',
      kind: 'folder',
      icon:'page',
      hasChildren:true,
      children:[]
    },
  ];
}

/** 权限字典树（复选框示例） */
export function permissionTree(): DictNode[] {
  return [
    {
      id: 'perm',
      name: '系统权限',
      kind: 'group',
      select:true,
      children: [
        {
          id: 'perm-data',
          name: '数据权限',
          kind: 'group',
          children: [
            { id: 'd1', name: '查看全部客户', kind: 'permission' },
            { id: 'd2', name: '导出客户名单', kind: 'permission' },
            { id: 'd3', name: '删除客户档案', kind: 'permission' },
          ],
        },
        {
          id: 'perm-user',
          name: '用户管理',
          kind: 'group',
          children: [
            { id: 'u1', name: '新建用户', kind: 'permission' },
            { id: 'u2', name: '重置密码', kind: 'permission' },
            { id: 'u3', name: '停用账号', kind: 'permission' },
          ],
        },
        {
          id: 'perm-sys',
          name: '系统设置',
          kind: 'group',
          children: [
            { id: 's1', name: '修改全局参数', kind: 'permission' },
            { id: 's2', name: '发布公告', kind: 'permission' },
          ],
        },
      ],
    },
    {
      id: 'menu',
      name: '菜单可见性',
      kind: 'group',
      children: [
        { id: 'm1', name: '工作台', kind: 'permission' },
        { id: 'm2', name: '报表中心', kind: 'permission' },
        { id: 'm3', name: '操作审计', kind: 'permission' },
      ],
    },
  ];
}

/** 懒加载示例的初始节点（id 每次重置都重新生成，便于清空加载状态） */
export function lazySeed(seq: number = 0): LazyNode[] {
  // 不预置 children 数组，只用 hasChildren 标记“还有下一层”：展开时再由 loadChildren 拉取
  return [{ id: `dc-root-${seq}`, name: '数据中心', hasChildren: true }];
}

/**
 * 跨树拖拽示例：左侧“资料库”。id 与右侧目标树完全不相交，
 * 这是跨树 move / copy 的前提（目标树不允许出现重复 id）。
 */
export function crossDemoSource(): FileNode[] {
  return [
    {
      id: 'src-design',
      name: '设计稿',
      kind: 'folder',
      icon: 'folder',
      children: [
        { id: 'src-design-login', name: '登录页.fig', kind: 'file', icon: 'block' },
        { id: 'src-design-pass', name: '忘记密码.fig', kind: 'file', icon: 'block' },
        { id: 'src-design-dash', name: '看板首页.sketch', kind: 'file', icon: 'block' },
        { id: 'src-design-pro', name: '项目列表.sketch', kind: 'file', icon: 'block' },
        { id: 'src-design-pers', name: '个人信息.fig', kind: 'file', icon: 'block' },
        { id: 'src-design-about', name: '关于.sketch', kind: 'file', icon: 'block' },
      ],
    },
    {
      id: 'src-copy',
      name: '文案素材',
      kind: 'folder',
      icon: 'folder',
      children: [
        { id: 'src-copy-slogan', name: '卖点文案.md', kind: 'file', icon: 'block' },
        { id: 'src-copy-note', name: '投稿说明.txt', kind: 'file', icon: 'block' },
      ],
    },
    { id: 'src-release', name: '发布清单.xlsx', kind: 'file', icon: 'block' },
  ];
}

/**
 * 跨树拖拽示例：右侧“已发布目录”。id 与左侧数据域互不相交。
 */
export function crossDemoTarget(): FileNode[] {
  return [
    {
      id: 'dst-archive',
      name: '2026-09 归档',
      kind: 'folder',
      icon: 'folder',
      children: [{ id: 'dst-archive-note', name: '归档说明.md', kind: 'file', icon: 'block' }],
    },
    { id: 'dst-version', name: '版本说明.md', kind: 'file', icon: 'block' },
  ];
}
