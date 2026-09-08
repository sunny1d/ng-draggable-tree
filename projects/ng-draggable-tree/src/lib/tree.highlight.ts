import { Pipe, type PipeTransform } from '@angular/core';

/**
 * 命中词高亮片段。渲染层对 `hit` 为 true 的片段用 `<mark>` 包裹，
 * 其余片段按原样输出（纯文本插值，不经过 innerHTML，无注入风险）。
 */
export interface TreeHighlightSegment {
  text: string;
  hit: boolean;
}

/**
 * 逐码点小写化，并记录每个小写字符在**原文**中的起止下标
 * （`map[i]` = 小写串第 i 个字符所属码点的起始下标，`endMap[i]` = 该码点的结束下标）。
 *
 * 不能直接用 `String.toLowerCase()` 的结果下标去切原文：小写化并不保证长度守恒
 * （如 `'İ'` 小写为两个字符 `i̇`），按小写串下标切原文可能切在半个字符上。
 * 逐码点处理可保证下标映射自洽；极端上下文相关转换（如希腊语尾 sigma）下
 * 匹配可能定位不到，届时由 {@link splitHighlight} 的兜底分支处理。
 */
function lowerByCodePoint(source: string): { lower: string; map: number[]; endMap: number[] } {
  let lower = '';
  const map: number[] = [];
  const endMap: number[] = [];
  let offset = 0;
  for (const ch of source) {
    const low = ch.toLowerCase();
    const end = offset + ch.length;
    for (let i = 0; i < low.length; i++) {
      map.push(offset);
      endMap.push(end);
    }
    lower += low;
    offset = end;
  }
  return { lower, map, endMap };
}

/**
 * 把显示文本按过滤关键字切分为「命中 / 未命中」片段（纯函数，无依赖）。
 *
 * 匹配规则与默认 `filterFn` 一致：不区分大小写的**字面量**包含匹配（关键字不做正则，
 * 因此 `(`、`*`、`\` 等字符不会被当作元字符）。全部出现位置都会被标为命中。
 *
 * `highlightWholeWhenMissing` 为 true 时（即该行确为自身命中），若显示文本里定位不到
 * 关键字（自定义 `filterFn` 可能按 code / 拼音 / 其它字段命中），则退化为整段命中，
 * 避免出现「行显示了却毫无命中提示」。
 *
 * @param text   待切分的显示文本
 * @param keyword 过滤关键字；空串或纯空白表示未过滤，返回单个未命中片段
 * @param highlightWholeWhenMissing 定位不到关键字时是否整段高亮兜底
 */
export function splitHighlight(
  text: string,
  keyword: string | null | undefined,
  highlightWholeWhenMissing = false,
): TreeHighlightSegment[] {
  const source = text ?? '';
  const needleText = (keyword ?? '').trim();
  if (!needleText || !source) return [{ text: source, hit: false }];

  const { lower, map, endMap } = lowerByCodePoint(source);
  const needle = lowerByCodePoint(needleText).lower;
  if (!needle) return [{ text: source, hit: false }];

  const segments: TreeHighlightSegment[] = [];
  let cursor = 0;
  let at = lower.indexOf(needle);
  while (at !== -1) {
    const next = at + needle.length;
    // 起止都换算回码点边界：命中片段可能只覆盖某个码点小写后的一个字符
    const start = map[at];
    const end = endMap[next - 1];
    if (start > cursor) segments.push({ text: source.slice(cursor, start), hit: false });
    segments.push({ text: source.slice(start, end), hit: true });
    cursor = end;
    at = lower.indexOf(needle, next);
  }

  if (segments.length === 0) {
    // 关键字不在显示文本中：命中判据来自自定义 filterFn（按 code / 拼音 / 其它字段等）
    return [{ text: source, hit: !!highlightWholeWhenMissing }];
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), hit: false });
  return segments;
}

/**
 * 命中词高亮管道（纯管道，按 `(text, keyword, fallback)` 记忆化）。
 *
 * 仅供**默认 label 路径**与使用方在 `#treeNodeTemplate` 中复用：
 *
 * ```html
 * <span>
 *   @for (seg of node.name | treeHighlight : keyword : row.matched; track $index) {
 *     @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { {{ seg.text }} }
 *   }
 * </span>
 * ```
 *
 * 模板上下文已提供 `keyword`（见 `TreeNodeTemplateContext`），可直接绑定。
 */
@Pipe({ name: 'treeHighlight', standalone: true, pure: true })
export class TreeHighlightPipe implements PipeTransform {
  transform(
    text: string,
    keyword: string | null | undefined,
    highlightWholeWhenMissing = false,
  ): TreeHighlightSegment[] {
    return splitHighlight(text, keyword, highlightWholeWhenMissing);
  }
}
