import { layout } from './layout'
export function posPage(): string {
  return layout({
    title: 'كزدورة — نقطة البيع',
    styles: ['/static/pos.css'],
    scripts: ['/static/api.js', '/static/pos.js'],
    bodyClass: 'pos-body',
    body: `<div id="app" class="pos-app"><div class="boot"><i class="fas fa-mug-hot"></i><p>جارٍ تحميل كزدورة…</p></div></div>
<div id="toast-root" class="toast-root" aria-live="polite"></div>
<div id="modal-root"></div>`,
  })
}
