import { layout } from './layout'
/** Browser-print page for printers of type 'browser' — renders a ticket then calls window.print() */
export function printPage(jobId: string): string {
  return layout({
    title: 'طباعة',
    styles: ['/static/print.css'],
    scripts: ['/static/api.js', '/static/print.js'],
    bodyClass: 'print-body',
    body: `<main id="ticket" class="ticket" data-job="${jobId.replace(/[^a-zA-Z0-9_\-]/g, '')}"><p class="muted">جارٍ تحميل التذكرة…</p></main>
<nav id="print-bar" class="print-bar no-print"><button id="btn-print" class="btn primary"><i class="fas fa-print"></i> طباعة</button><button id="btn-done" class="btn">تمت الطباعة</button><button id="btn-fail" class="btn danger">فشلت</button></nav>`,
  })
}
