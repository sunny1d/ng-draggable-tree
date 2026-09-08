import { Routes } from '@angular/router';
import { BasicDemo } from './pages/basic-demo';
import { CheckboxDemo } from './pages/checkbox-demo';
import { LazyDemo } from './pages/lazy-demo';
import { DragDemo } from './pages/drag-demo';
import { FilterDemo } from './pages/filter-demo';
import { CrossDemo } from './pages/cross-demo';

export const routes: Routes = [
  { path: '', component: BasicDemo },
  { path: 'checkbox', component: CheckboxDemo },
  { path: 'lazy', component: LazyDemo },
  { path: 'drag', component: DragDemo },
  { path: 'filter', component: FilterDemo },
  { path: 'cross', component: CrossDemo },
  { path: '**', redirectTo: '' },
];
