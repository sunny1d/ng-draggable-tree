import { Component, input, output } from '@angular/core';

/** 示例页通用的事件日志面板 */
@Component({
  selector: 'app-event-log',
  standalone: true,
  template: `
    <div class="log-card">
      <div class="log-card-head">
        <span class="log-card-title">事件日志</span>
        <button type="button" class="btn btn-ghost btn-sm" (click)="clear.emit()">清空</button>
      </div>
      <div class="log-card-body">
        @if (entries().length === 0) {
          <div class="log-empty">暂无事件，去树上试试吧</div>
        } @else {
          @for (item of entries(); track $index) {
            <div class="log-line">{{ item }}</div>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class EventLogPanel {
  readonly entries = input<string[]>([]);
  readonly clear = output<void>();
}
