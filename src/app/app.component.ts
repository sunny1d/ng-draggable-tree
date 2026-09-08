import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

interface NavItem {
  path: string;
  label: string;
  exact?: boolean;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class App {
  protected readonly nav: NavItem[] = [
    { path: '/', label: '基础树', exact: true },
    { path: '/checkbox', label: '复选框' },
    { path: '/lazy', label: '懒加载' },
    { path: '/drag', label: '拖拽' },
    { path: '/filter', label: '过滤' },
    { path: '/cross', label: '跨树拖拽' },
  ];
}
