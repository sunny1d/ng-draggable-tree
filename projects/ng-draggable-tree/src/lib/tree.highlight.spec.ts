import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import { splitHighlight } from './tree.highlight';
import { NgDraggableTreeComponent } from './ng-draggable-tree';
import type { TreeOptions } from './tree-options';

describe('splitHighlight', () => {
  it('未过滤（空关键字）时原样返回单个未命中片段', () => {
    expect(splitHighlight('abc', '')).toEqual([{ text: 'abc', hit: false }]);
    expect(splitHighlight('abc', '   ')).toEqual([{ text: 'abc', hit: false }]);
    expect(splitHighlight('', 'a')).toEqual([{ text: '', hit: false }]);
  });

  it('不区分大小写地切出命中片段，且保留原文大小写', () => {
    expect(splitHighlight('Hello World', 'wor')).toEqual([
      { text: 'Hello ', hit: false },
      { text: 'Wor', hit: true },
      { text: 'ld', hit: false },
    ]);
  });

  it('标出全部出现位置', () => {
    expect(splitHighlight('aXaXa', 'a')).toEqual([
      { text: 'a', hit: true },
      { text: 'X', hit: false },
      { text: 'a', hit: true },
      { text: 'X', hit: false },
      { text: 'a', hit: true },
    ]);
  });

  it('关键字按字面量处理，不当作正则元字符', () => {
    expect(splitHighlight('f(x)*y', '(x)*')).toEqual([
      { text: 'f', hit: false },
      { text: '(x)*', hit: true },
      { text: 'y', hit: false },
    ]);
    expect(splitHighlight('a+b', '+')).toEqual([
      { text: 'a', hit: false },
      { text: '+', hit: true },
      { text: 'b', hit: false },
    ]);
  });

  it('长度不守恒的 Unicode 小写化也能定位原文（不切成半个字符、不产生空片段）', () => {
    // 'İ'.toLowerCase() 为两个字符（i + 组合点），下标不能直接按小写串计算
    const segments = splitHighlight('İstanbul', 'i');
    expect(segments).toEqual([
      { text: 'İ', hit: true },
      { text: 'stanbul', hit: false },
    ]);
  });

  it('命中判据来自自定义 filterFn（文本内无该子串）时按兜底整段高亮', () => {
    const fallback = splitHighlight('style', 'zzz', true);
    expect(fallback).toEqual([{ text: 'style', hit: true }]);
    // 非自身命中的行不应兜底（避免无关行整段变黄）
    expect(splitHighlight('style', 'zzz', false)).toEqual([{ text: 'style', hit: false }]);
  });
});

interface DemoNode {
  id: string;
  name: string;
  children?: DemoNode[];
}

const ROOTS: DemoNode[] = [
  {
    id: '1',
    name: 'html',
    children: [
      { id: '1-1', name: 'html-body' },
      { id: '1-2', name: 'script' },
    ],
  },
  { id: '2', name: 'style' },
];

function setup(optionsOverride: Partial<TreeOptions<DemoNode>> = {}): {
  fixture: ReturnType<typeof TestBed.createComponent>;
  tree: NgDraggableTreeComponent<DemoNode>;
} {
  @Component({
    imports: [NgDraggableTreeComponent],
    template: `<ng-draggable-tree [nodes]="nodes()" [options]="options" />`,
  })
  class Host {
    readonly nodes = signal<DemoNode[]>(ROOTS);
    readonly options = {
      idField: 'id',
      displayField: 'name',
      childrenField: 'children',
      ...optionsOverride,
    } as TreeOptions<DemoNode>;
  }

  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  const tree = fixture.debugElement.query(By.directive(NgDraggableTreeComponent))
    .componentInstance as unknown as NgDraggableTreeComponent<DemoNode>;
  fixture.detectChanges();
  return { fixture, tree };
}

function hitTexts(fixture: ReturnType<typeof TestBed.createComponent>): string[] {
  const marks = fixture.nativeElement.querySelectorAll('mark.ng-draggable-tree-hit');
  return Array.from(marks as ArrayLike<HTMLElement>).map((m) => m.textContent ?? '');
}

describe('过滤命中词高亮（默认 highlightMode: keyword）', () => {
  it('只高亮匹配词，且不破坏 label 原文与空白', () => {
    const { fixture, tree } = setup();
    tree.filter('html');
    fixture.detectChanges();

    expect(hitTexts(fixture)).toEqual(['html', 'html']);

    const labels = fixture.nativeElement.querySelectorAll('.ng-draggable-tree-label');
    expect(Array.from(labels as ArrayLike<HTMLElement>).map((l) => l.textContent)).toEqual([
      'html',
      'html-body',
    ]);
  });

  it('分支内含命中的祖先行带 is-child-match 类', () => {
    const { fixture, tree } = setup();
    tree.filter('body');
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.ng-draggable-tree-row');
    expect(rows.length).toBe(2); // 祖先 'html' + 命中行 'html-body'
    expect(rows[0].classList.contains('is-child-match')).toBe(true);
    expect(rows[0].classList.contains('is-match')).toBe(false);
    expect(rows[1].classList.contains('is-match')).toBe(true);
    expect(hitTexts(fixture)).toEqual(['body']);
  });

  it('自定义 filterFn 按非显示字段命中时整段兜底高亮', () => {
    const { fixture, tree } = setup({ filterFn: (node) => node.id === '2' });
    tree.filter('zzz');
    fixture.detectChanges();

    expect(hitTexts(fixture)).toEqual(['style']);
  });

  it('highlightMode: label 时保持整标签高亮（无 mark）', () => {
    const { fixture, tree } = setup({ highlightMode: 'label' });
    tree.filter('html');
    fixture.detectChanges();

    expect(hitTexts(fixture)).toEqual([]);
    const first = fixture.nativeElement.querySelector('.ng-draggable-tree-label') as HTMLElement;
    expect(first.classList.contains('is-highlight')).toBe(true);
    expect(first.textContent).toBe('html');
  });
});
