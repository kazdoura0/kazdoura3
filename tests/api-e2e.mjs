/**
 * API-level end-to-end test for كزدورة.
 * Usage: node tests/api-e2e.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:3000'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'kazdoura2026'
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || 'bridge-secret-2026'

let passed = 0, failed = 0
const fails = []
function ok(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`) } else { failed++; fails.push(msg); console.log(`  ❌ ${msg}`) }
}
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined })
  let json = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, json }
}
const rid = () => 'req_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
const BH = { Authorization: `Bearer ${BRIDGE_TOKEN}` }

console.log('\n=== المرحلة 1-4: البيانات، المنتجات، الأقسام، الطاولات ===')
const boot = await api('/api/pos/bootstrap')
ok(boot.status === 200 && boot.json.ok, 'bootstrap يعمل')
ok(boot.json.products.length >= 9, `المنتجات محمّلة (${boot.json.products.length})`)
ok(boot.json.categories.length >= 2, 'الأقسام محمّلة')
ok(boot.json.tables.length >= 10, 'الطاولات محمّلة')
ok(boot.json.currencies.length >= 3, 'العملات محمّلة')
const byName = (n) => boot.json.products.find((p) => p.name === n)
const juice = byName('عصير برتقال'), coffee = byName('قهوة'), cheese = byName('فطيرة جبنة')
ok(juice && coffee && cheese, 'المنتجات المطلوبة للسيناريو موجودة')
const table5 = boot.json.tables.find((t) => t.number === 5)
ok(!!table5, 'الطاولة 5 موجودة')
const barCat = boot.json.categories.find((c) => c.slug === 'bar'), pastryCat = boot.json.categories.find((c) => c.slug === 'pastry')
ok(barCat.printer_id === 1 && pastryCat.printer_id === 2, 'ربط الأقسام بالطابعات: البار→1، المعجنات→2')

const login = await api('/api/admin/login', { method: 'POST', body: { password: ADMIN_PASSWORD } })
ok(login.status === 200 && login.json.token, 'تسجيل دخول المدير')
const AH = { Authorization: `Bearer ${login.json.token}` }
const bad = await api('/api/admin/login', { method: 'POST', body: { password: 'wrong' } })
ok(bad.status === 401, 'رفض كلمة مرور خاطئة')
const noauth = await api('/api/admin/overview')
ok(noauth.status === 401, 'حماية لوحة التحكم بدون توكن')
{
  const v = await api(`/api/pos/tables/${table5.id}/check`)
  if (v.json.check) await api(`/api/admin/checks/${v.json.check.id}/cancel`, { method: 'POST', headers: AH, body: { reason: 'test reset' } })
}

console.log('\n=== المرحلة 5-6: إنشاء الطلب وتقسيمه حسب الأقسام ===')
const reqId = rid()
const order = await api(`/api/pos/tables/${table5.id}/orders`, { method: 'POST', body: { client_request_id: reqId, items: [{ product_id: juice.id, qty: 1 }, { product_id: coffee.id, qty: 1 }, { product_id: cheese.id, qty: 1 }] } })
ok(order.status === 201 && order.json.ok, 'إنشاء الطلب على الطاولة 5')
ok(order.json.items.length === 3, 'ثلاثة عناصر في الطلب')
ok(order.json.print_jobs.length === 2, `تقسيم الطلب إلى ${order.json.print_jobs.length} تذكرة (متوقع 2)`)
const j1 = order.json.print_jobs.find((j) => j.printer_id === 1), j2 = order.json.print_jobs.find((j) => j.printer_id === 2), j3 = order.json.print_jobs.find((j) => j.printer_id === 3)
ok(!!j1, 'تذكرة للطابعة 1 (البار)')
ok(!!j2, 'تذكرة للطابعة 2 (المعجنات)')
ok(!j3, 'لا تذكرة للطابعة 3 (الكاشير)')
const jd1 = await api(`/api/pos/print-jobs/${j1.id}`)
const names1 = jd1.json.job.payload.lines.map((l) => l.name).sort()
ok(JSON.stringify(names1) === JSON.stringify(['عصير برتقال', 'قهوة'].sort()), 'Printer 1: عصير برتقال + قهوة')
const jd2 = await api(`/api/pos/print-jobs/${j2.id}`)
ok(jd2.json.job.payload.lines.length === 1 && jd2.json.job.payload.lines[0].name === 'فطيرة جبنة', 'Printer 2: فطيرة جبنة')
ok(jd1.json.job.payload.table_number === 5, 'التذكرة تحمل رقم الطاولة 5')

console.log('\n=== المرحلة 12: منع الطلب المكرر ===')
const dup = await api(`/api/pos/tables/${table5.id}/orders`, { method: 'POST', body: { client_request_id: reqId, items: [{ product_id: juice.id, qty: 1 }] } })
ok(dup.status === 200 && dup.json.duplicate === true && dup.json.order_id === order.json.order_id, 'الطلب المكرر يعيد نفس الطلب')
const par = await Promise.all([1, 2, 3].map(() => api(`/api/pos/tables/${table5.id}/orders`, { method: 'POST', body: { client_request_id: 'par_' + reqId, items: [{ product_id: coffee.id, qty: 2 }] } })))
ok(new Set(par.map((r) => r.json.order_id)).size === 1 && par.every((r) => r.json.ok), 'ثلاث طلبات متزامنة بنفس المعرّف → طلب واحد')
const viewAfter = await api(`/api/pos/tables/${table5.id}/check`)
ok(viewAfter.json.items.length === 4, `عناصر الحساب: ${viewAfter.json.items.length} (متوقع 4)`)
ok(viewAfter.json.table.status === 'occupied', 'حالة الطاولة: عليها طلبات')
ok((await api(`/api/pos/tables/${table5.id}/orders`, { method: 'POST', body: { client_request_id: rid(), items: [] } })).status === 400, 'رفض طلب فارغ')
ok((await api(`/api/pos/tables/${table5.id}/orders`, { method: 'POST', body: { items: [{ product_id: juice.id, qty: 1 }] } })).status === 400, 'رفض طلب بدون معرّف')

console.log('\n=== المرحلة 7: نظام الطباعة (الجسر) ===')
const cfg = await api('/api/bridge/config', { headers: BH })
ok(cfg.status === 200 && cfg.json.printers.length >= 3, 'إعدادات الجسر')
ok((await api('/api/bridge/config', { headers: { Authorization: 'Bearer nope' } })).status === 401, 'رفض توكن جسر خاطئ')
const claim = await api('/api/bridge/claim', { method: 'POST', headers: BH, body: { agent: 'test-agent', limit: 10 } })
const claimedIds = claim.json.jobs.map((j) => j.id)
ok(claimedIds.includes(j1.id) && claimedIds.includes(j2.id), 'الجسر استلم تذكرتي القسمين')
ok(claim.json.jobs.find((j) => j.id === j1.id).host === '192.168.1.201', 'المهمة تحمل عنوان الطابعة')
const claim2 = await api('/api/bridge/claim', { method: 'POST', headers: BH, body: { agent: 'test-agent-2', limit: 10 } })
ok(!claim2.json.jobs.some((j) => j.id === j1.id), 'لا يمكن استلام نفس المهمة مرتين')
await api(`/api/bridge/jobs/${j1.id}/result`, { method: 'POST', headers: BH, body: { ok: true } })
await api(`/api/bridge/jobs/${j2.id}/result`, { method: 'POST', headers: BH, body: { ok: false, error: 'ECONNREFUSED' } })
for (const j of claim2.json.jobs) await api(`/api/bridge/jobs/${j.id}/result`, { method: 'POST', headers: BH, body: { ok: true } })
let st = await api(`/api/pos/print-jobs?ids=${j1.id},${j2.id}`)
const s1 = st.json.jobs.find((j) => j.id === j1.id), s2 = st.json.jobs.find((j) => j.id === j2.id)
ok(s1.status === 'printed', 'حالة الطباعة: نجاح للطابعة 1')
ok(s2.status === 'pending' && s2.attempts === 1 && s2.last_error === 'ECONNREFUSED', 'فشل الطباعة → إعادة محاولة تلقائية')
for (let i = 0; i < 6; i++) {
  const c = await api('/api/bridge/claim', { method: 'POST', headers: BH, body: { agent: 'x', limit: 10 } })
  for (const j of c.json.jobs) await api(`/api/bridge/jobs/${j.id}/result`, { method: 'POST', headers: BH, body: { ok: false, error: 'timeout' } })
}
st = await api(`/api/pos/print-jobs?ids=${j2.id}`)
ok(st.json.jobs[0].status === 'failed', 'بعد استنفاد المحاولات → failed')
const retry = await api(`/api/pos/print-jobs/${j2.id}/retry`, { method: 'POST' })
st = await api(`/api/pos/print-jobs?ids=${j2.id}`)
ok(retry.json.ok && st.json.jobs[0].status === 'pending', 'إعادة المحاولة يدوياً → pending')
{
  const c = await api('/api/bridge/claim', { method: 'POST', headers: BH, body: { agent: 'x', limit: 10 } })
  for (const j of c.json.jobs) await api(`/api/bridge/jobs/${j.id}/result`, { method: 'POST', headers: BH, body: { ok: true } })
}
ok((await api('/api/bridge/heartbeat', { method: 'POST', headers: BH, body: { agent: 'x', printers: [{ id: 1, online: true }, { id: 2, online: false, error: 'unreachable' }] } })).json.ok, 'heartbeat مقبول')

console.log('\n=== تعديل الكميات ===')
const view = await api(`/api/pos/tables/${table5.id}/check`)
const coffeeItem = view.json.items.find((i) => i.product_id === coffee.id && i.qty === 1)
const upd = await api(`/api/pos/items/${coffeeItem.id}`, { method: 'PATCH', body: { qty: 3 } })
ok(upd.json.item.qty === 3 && upd.json.item.line_total === 4.5, 'زيادة الكمية إلى 3 → 4.5')
ok((await api(`/api/pos/items/${coffeeItem.id}`, { method: 'PATCH', body: { qty: 2 } })).json.item.qty === 2, 'تقليل الكمية إلى 2')
const extraCoffee = view.json.items.find((i) => i.product_id === coffee.id && i.qty === 2)
ok((await api(`/api/pos/items/${extraCoffee.id}`, { method: 'PATCH', body: { qty: 0 } })).json.item.is_voided === 1, 'حذف عنصر من الطلب')
const v2 = await api(`/api/pos/tables/${table5.id}/check`)
ok(Math.abs(v2.json.check.total - 7.5) < 0.001, `الإجمالي: ${v2.json.check.total} (متوقع 7.5)`)

console.log('\n=== المرحلة 8-9: الحساب وطابعة الكاشير ===')
const bill = await api(`/api/pos/checks/${v2.json.check.id}/bill`, { method: 'POST' })
ok(bill.status === 200 && bill.json.print_job.printer_id === 3, 'الفاتورة → Printer 3 فقط')
const billDoc = await api(`/api/pos/print-jobs/${bill.json.print_job.id}`)
ok(billDoc.json.job.payload.kind === 'bill' && Math.abs(billDoc.json.job.payload.total - 7.5) < 0.001, 'الفاتورة تحتوي الإجمالي الصحيح')
ok(billDoc.json.job.payload.lines.length === 3, 'الفاتورة تجمع العناصر (3 أسطر)')
ok(billDoc.json.job.payload.header.length > 0 && billDoc.json.job.payload.footer.length > 0, 'رسائل الفاتورة من قاعدة البيانات')
ok(billDoc.json.job.payload.secondary_totals.length === 2, 'الإجمالي بالعملات الأخرى')
const v3 = await api(`/api/pos/tables/${table5.id}/check`)
ok(v3.json.table.status === 'awaiting_payment' && v3.json.check.status === 'billing', 'حالة الطاولة: بانتظار الدفع')
const allJobs = await api('/api/admin/print-jobs?limit=100', { headers: AH })
ok(allJobs.json.jobs.filter((j) => j.printer_id === 3 && j.job_type === 'kitchen').length === 0, 'لم تصل أي تذكرة قسم إلى طابعة الكاشير')

console.log('\n=== المرحلة 10: الدفع ===')
const payRid = rid()
const pay = await api(`/api/pos/checks/${v2.json.check.id}/pay`, { method: 'POST', body: { client_request_id: payRid, method: 'cash', received: 10 } })
ok(pay.status === 200 && pay.json.ok && !pay.json.duplicate, 'تسجيل الدفع')
ok(Math.abs(pay.json.change_given - 2.5) < 0.001, 'الباقي محسوب: 2.5')
const pay2 = await api(`/api/pos/checks/${v2.json.check.id}/pay`, { method: 'POST', body: { client_request_id: payRid } })
ok(pay2.json.duplicate === true && pay2.json.sale_id === pay.json.sale_id, 'الدفع المكرر لا يسجل عملية جديدة')
ok((await api(`/api/pos/checks/${v2.json.check.id}/pay`, { method: 'POST', body: { client_request_id: rid() } })).json.duplicate === true, 'الدفع على حساب مدفوع → duplicate')
const v4 = await api(`/api/pos/tables/${table5.id}/check`)
ok(v4.json.table.status === 'empty' && v4.json.check === null && v4.json.items.length === 0, 'الطاولة صُفّرت وعادت فارغة')
const newOrder = await api(`/api/pos/tables/${table5.id}/orders`, { method: 'POST', body: { client_request_id: rid(), items: [{ product_id: juice.id, qty: 1 }] } })
ok(newOrder.status === 201 && newOrder.json.check_id !== v2.json.check.id, 'يمكن فتح حساب جديد بعد الدفع')
await api(`/api/admin/checks/${newOrder.json.check_id}/cancel`, { method: 'POST', headers: AH, body: { reason: 'cleanup' } })

console.log('\n=== المرحلة 11: سجل المبيعات ===')
const sales = await api('/api/admin/sales?limit=20', { headers: AH })
const sale = sales.json.sales.find((s) => s.id === pay.json.sale_id)
ok(!!sale, 'العملية موجودة في سجل المبيعات بعد تصفير الطاولة')
ok(sale.table_number === 5 && Math.abs(sale.total - 7.5) < 0.001 && sale.items.length === 3, 'تفاصيل العملية (طاولة 5، 7.5، 3 عناصر)')
ok(sale.payment_status === 'paid' && sale.currency_code === 'USD', 'حالة الدفع والعملة')
const saleDetail = await api(`/api/admin/sales/${sale.id}`, { headers: AH })
ok(saleDetail.json.orders.length === 2 && saleDetail.json.payments.length === 1, 'تفاصيل العملية: طلبان ودفعة واحدة')
ok(saleDetail.json.print_jobs.some((j) => j.job_type === 'bill'), 'سجل طباعة الفاتورة مرتبط بالعملية')

console.log('\n=== المرحلة 12: لوحة التحكم — المنتجات ===')
const cp = await api('/api/admin/products', { method: 'POST', headers: AH, body: { name: 'منتج اختبار', price: 4.25, currency_code: 'USD', category_id: barCat.id, description: 'وصف' } })
ok(cp.status === 201 && cp.json.product.name === 'منتج اختبار', 'إنشاء منتج')
const pid = cp.json.id
const up = await api(`/api/admin/products/${pid}`, { method: 'PUT', headers: AH, body: { price: 5, description: 'وصف جديد', image_url: 'data:image/png;base64,iVBORw0KGgo=', category_id: pastryCat.id } })
ok(up.json.product.price === 5 && up.json.product.description === 'وصف جديد' && up.json.product.category_id === pastryCat.id && up.json.product.image_url.startsWith('data:image'), 'تعديل السعر/الوصف/الصورة/القسم')
ok((await api(`/api/admin/products/${pid}`, { method: 'PUT', headers: AH, body: { is_available: 0 } })).json.product.is_available === 0, 'تعطيل منتج')
const tryDisabled = await api(`/api/pos/tables/${table5.id}/orders`, { method: 'POST', body: { client_request_id: rid(), items: [{ product_id: pid, qty: 1 }] } })
ok(tryDisabled.status === 400 && tryDisabled.json.code === 'product_unavailable', 'لا يمكن طلب منتج معطّل')
ok((await api(`/api/admin/products/${pid}`, { method: 'PUT', headers: AH, body: { is_available: 1 } })).json.product.is_available === 1, 'إعادة تفعيل منتج')
ok((await api(`/api/admin/products/${pid}`, { method: 'PUT', headers: AH, body: { price: -3 } })).status === 400, 'رفض سعر سالب')
ok((await api('/api/admin/products/reorder', { method: 'POST', headers: AH, body: { ids: [pid, juice.id] } })).json.ok, 'إعادة ترتيب المنتجات')
ok((await api(`/api/admin/products/${pid}`, { method: 'DELETE', headers: AH })).json.ok, 'حذف منتج')
ok(!(await api('/api/pos/bootstrap')).json.products.some((p) => p.id === pid), 'المنتج المحذوف لا يظهر في POS')

console.log('\n=== الأقسام ===')
const cc = await api('/api/admin/categories', { method: 'POST', headers: AH, body: { name: 'قسم اختبار', printer_id: 1 } })
ok(cc.status === 201, 'إضافة قسم')
const cid = cc.json.id
const uc = await api(`/api/admin/categories/${cid}`, { method: 'PUT', headers: AH, body: { name: 'قسم معدل', printer_id: 2 } })
ok(uc.json.categories.find((c) => c.id === cid).name === 'قسم معدل' && uc.json.categories.find((c) => c.id === cid).printer_id === 2, 'تعديل القسم وطابعته')
const cp2 = await api('/api/admin/products', { method: 'POST', headers: AH, body: { name: 'منتج قسم', price: 1, currency_code: 'USD', category_id: cid } })
const o2 = await api(`/api/pos/tables/${table5.id}/orders`, { method: 'POST', body: { client_request_id: rid(), items: [{ product_id: cp2.json.id, qty: 1 }] } })
ok(o2.json.print_jobs[0].printer_id === 2, 'تغيير طابعة القسم ينعكس على التوجيه تلقائياً')
await api(`/api/admin/checks/${o2.json.check_id}/cancel`, { method: 'POST', headers: AH, body: { reason: 'cleanup' } })
ok((await api(`/api/admin/categories/${cid}`, { method: 'DELETE', headers: AH })).status === 409, 'منع حذف قسم يحتوي منتجات')
await api(`/api/admin/products/${cp2.json.id}`, { method: 'DELETE', headers: AH })
ok((await api(`/api/admin/categories/${cid}`, { method: 'DELETE', headers: AH })).json.ok, 'حذف قسم فارغ')

console.log('\n=== الطابعات ===')
const pr = await api('/api/admin/printers', { method: 'POST', headers: AH, body: { name: 'طابعة اختبار', type: 'network', host: '10.0.0.5', port: 9100, role: 'kitchen' } })
ok(pr.status === 201, 'إضافة طابعة')
const prid = pr.json.id
const upr = await api(`/api/admin/printers/${prid}`, { method: 'PUT', headers: AH, body: { name: 'طابعة معدلة', paper_width: 58 } })
ok(upr.json.printers.find((p) => p.id === prid).name === 'طابعة معدلة' && upr.json.printers.find((p) => p.id === prid).paper_width === 58, 'تعديل طابعة')
const tp = await api(`/api/admin/printers/${prid}/test`, { method: 'POST', headers: AH })
ok(tp.json.print_job.job_type === 'test' && tp.json.print_job.status === 'pending', 'اختبار الطابعة')
await api(`/api/admin/print-jobs/${tp.json.print_job.id}/cancel`, { method: 'POST', headers: AH })
ok((await api(`/api/admin/printers/${prid}`, { method: 'DELETE', headers: AH })).json.ok, 'حذف طابعة')
ok((await api('/api/admin/printers/1', { method: 'DELETE', headers: AH })).status === 409, 'منع حذف طابعة مرتبطة بقسم')

console.log('\n=== المرحلة 13: العملات وأسعار الصرف ===')
ok((await api('/api/admin/currencies', { method: 'POST', headers: AH, body: { code: 'EUR', name: 'يورو', symbol: '€', decimals: 2, rate_to_base: 1.1 } })).status === 201, 'إضافة عملة')
ok((await api('/api/admin/currencies/EUR', { method: 'PUT', headers: AH, body: { rate_to_base: 1.2 } })).json.currencies.find((c) => c.code === 'EUR').rate_to_base === 1.2, 'تعديل سعر الصرف')
const pe = await api('/api/admin/products', { method: 'POST', headers: AH, body: { name: 'منتج يورو', price: 10, currency_code: 'EUR', category_id: barCat.id } })
const oe = await api(`/api/pos/tables/${table5.id}/orders`, { method: 'POST', body: { client_request_id: rid(), items: [{ product_id: pe.json.id, qty: 1 }] } })
ok(Math.abs(oe.json.items[0].unit_price_base - 12) < 0.001, 'تحويل العملة: 10 EUR → 12 USD')
await api(`/api/admin/checks/${oe.json.check_id}/cancel`, { method: 'POST', headers: AH, body: { reason: 'cleanup' } })
ok((await api('/api/admin/currencies/EUR', { method: 'DELETE', headers: AH })).status === 409, 'منع حذف عملة مستخدمة')
await api(`/api/admin/products/${pe.json.id}`, { method: 'DELETE', headers: AH })
ok((await api('/api/admin/currencies/USD', { method: 'DELETE', headers: AH })).status === 400, 'منع حذف العملة الأساسية')
ok((await api('/api/admin/currencies/EUR', { method: 'DELETE', headers: AH })).json.ok, 'حذف عملة غير مستخدمة')

console.log('\n=== الرسائل والإعدادات والطاولات ===')
const um = await api('/api/admin/messages', { method: 'PUT', headers: AH, body: { messages: [{ key: 'bill_footer', value: 'تذييل جديد للاختبار' }] } })
ok(um.json.messages.find((m) => m.key === 'bill_footer').value === 'تذييل جديد للاختبار', 'تغيير رسالة')
await api('/api/admin/messages', { method: 'PUT', headers: AH, body: { messages: [{ key: 'bill_footer', value: 'شكراً لزيارتكم — نتمنى لكم يوماً سعيداً' }] } })
ok((await api('/api/admin/settings', { method: 'PUT', headers: AH, body: { store_phone: '0900000000' } })).json.settings.store_phone === '0900000000', 'تعديل الإعدادات')
const at = await api('/api/admin/tables', { method: 'POST', headers: AH, body: { number: 99, label: 'تراس' } })
ok(at.status === 201, 'إضافة طاولة')
const tid = at.json.id
ok((await api(`/api/admin/tables/${tid}`, { method: 'PUT', headers: AH, body: { label: 'تراس خارجي', seats: 6 } })).json.tables.find((t) => t.id === tid).label === 'تراس خارجي', 'تعديل طاولة')
ok((await api('/api/admin/tables', { method: 'POST', headers: AH, body: { number: 99 } })).status === 409, 'منع تكرار رقم الطاولة')
ok((await api(`/api/admin/tables/${tid}`, { method: 'DELETE', headers: AH })).json.ok, 'حذف طاولة')
ok((await api('/api/admin/tables', { method: 'POST', headers: AH, body: { count: 12 } })).json.tables.filter((t) => t.is_active).length === 12, 'تحديد عدد الطاولات = 12')
await api('/api/admin/tables', { method: 'POST', headers: AH, body: { count: 10 } })
const ov = await api('/api/admin/overview', { headers: AH })
ok(ov.json.ok && ov.json.stats && ov.json.products && ov.json.printers, 'نظرة عامة للوحة التحكم')
const lo = await api('/api/admin/logout', { method: 'POST', headers: AH })
ok(lo.json.ok && (await api('/api/admin/overview', { headers: AH })).status === 401, 'تسجيل الخروج يلغي الجلسة')

console.log('\n=== المرحلة 14: الأخطاء ===')
const nf = await api('/api/pos/tables/99999/check')
ok(nf.status === 404 && nf.json.error, 'طاولة غير موجودة → 404 برسالة عربية')
const badJson = await fetch(BASE + `/api/pos/tables/${table5.id}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
ok(badJson.status === 400, 'JSON غير صالح → 400')
ok((await api('/api/nothing')).status === 404, 'مسار API غير موجود → 404')

console.log(`\n==== النتيجة: ${passed} نجاح، ${failed} فشل ====`)
if (fails.length) { console.log('الفاشلة:'); fails.forEach((f) => console.log(' - ' + f)) }
process.exit(failed ? 1 : 0)
