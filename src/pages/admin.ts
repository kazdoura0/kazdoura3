import { layout } from './layout'
export function adminPage(): string {
  return layout({
    title: 'كزدورة — لوحة التحكم',
    styles: ['/static/admin.css'],
    scripts: ['/static/api.js', '/static/admin.js'],
    bodyClass: 'admin-body',
    body: `<div id="app" class="admin-app"><div class="boot"><i class="fas fa-gear fa-spin"></i><p>جارٍ تحميل لوحة التحكم…</p></div></div>
<div id="toast-root" class="toast-root" aria-live="polite"></div>
<div id="modal-root"></div>`,
  })
}
