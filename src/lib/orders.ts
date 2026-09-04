/**
 * Core POS business logic: checks (table accounts), orders (rounds), items, bill, payment.
 * All multi-statement mutations use db.batch() which D1 executes atomically.
 */
import type { CheckRow, OrderItemRow, Product, Category, Currency, TableRow } from '../types'
import { all, first, run, getCheck, getCheckItems, getTable, getCurrencies, currencyMap, getBaseCurrency } from './db'
import { newId, nowIso, todayDate, roundMoney, convert, bad, notFound, conflict, HttpError } from './util'
import { enqueueKitchenTickets, enqueueBill, type CreatedJob } from './printing'

export interface IncomingItem {
  product_id: number
  qty: number
  note?: string
}

export interface CheckView {
  check: CheckRow | null
  table: TableRow
  items: OrderItemRow[]
  orders: { id: string; seq: number; created_at: string; status: string; note: string }[]
  print_jobs: { id: string; job_type: string; status: string; printer_name: string; last_error: string; ref_id: string; created_at: string }[]
}

async function recomputeTotals(db: D1Database, checkId: string): Promise<{ subtotal: number; total: number }> {
  const check = await getCheck(db, checkId)
  if (!check) notFound('الحساب غير موجود')
  const cur = (await first<Currency>(db, 'SELECT * FROM currencies WHERE code=?', check.currency_code)) || (await getBaseCurrency(db))
  const row = await first<{ s: number | null }>(db, 'SELECT SUM(line_total) s FROM order_items WHERE check_id=? AND is_voided=0', checkId)
  const subtotal = roundMoney(row?.s || 0, cur.decimals)
  const total = roundMoney(Math.max(0, subtotal - (check.discount || 0)), cur.decimals)
  await run(db, 'UPDATE checks SET subtotal=?, total=? WHERE id=?', subtotal, total, checkId)
  return { subtotal, total }
}

/** Get or create the open check for a table */
export async function ensureOpenCheck(db: D1Database, tableId: number): Promise<{ check: CheckRow; table: TableRow }> {
  const table = await getTable(db, tableId)
  if (!table || !table.is_active) notFound('الطاولة غير موجودة')
  if (table.current_check_id) {
    const c = await getCheck(db, table.current_check_id)
    if (c && (c.status === 'open' || c.status === 'billing')) return { check: c, table }
  }
  // Also guard against an orphan open check
  const orphan = await first<CheckRow>(db, "SELECT * FROM checks WHERE table_id=? AND status IN ('open','billing') ORDER BY opened_at DESC LIMIT 1", tableId)
  if (orphan) {
    await run(db, "UPDATE tables SET current_check_id=?, status=CASE WHEN status='empty' THEN 'occupied' ELSE status END, updated_at=datetime('now') WHERE id=?", orphan.id, tableId)
    return { check: orphan, table: { ...table, current_check_id: orphan.id } }
  }
  const base = await getBaseCurrency(db)
  const id = newId('chk')
  await db.batch([
    db.prepare('INSERT INTO checks (id, table_id, table_number, status, currency_code, opened_at) VALUES (?,?,?,?,?,?)').bind(id, tableId, table.number, 'open', base.code, nowIso()),
    db.prepare("UPDATE tables SET current_check_id=?, status='occupied', updated_at=datetime('now') WHERE id=?").bind(id, tableId),
  ])
  const check = (await getCheck(db, id))!
  return { check, table: { ...table, current_check_id: id, status: 'occupied' } }
}

export async function getCheckView(db: D1Database, tableId: number): Promise<CheckView> {
  const table = await getTable(db, tableId)
  if (!table) notFound('الطاولة غير موجودة')
  let check: CheckRow | null = null
  if (table.current_check_id) check = await getCheck(db, table.current_check_id)
  if (check && (check.status === 'paid' || check.status === 'cancelled')) check = null
  if (!check) return { check: null, table, items: [], orders: [], print_jobs: [] }
  const [items, orders, jobs] = await Promise.all([
    getCheckItems(db, check.id),
    all<{ id: string; seq: number; created_at: string; status: string; note: string }>(db, 'SELECT id, seq, created_at, status, note FROM orders WHERE check_id=? ORDER BY seq', check.id),
    all<any>(
      db,
      `SELECT id, job_type, status, printer_name, last_error, ref_id, created_at FROM print_jobs
       WHERE (ref_type='order' AND ref_id IN (SELECT id FROM orders WHERE check_id=?)) OR (ref_type='check' AND ref_id=?)
       ORDER BY created_at DESC LIMIT 50`,
      check.id,
      check.id
    ),
  ])
  return { check, table, items, orders, print_jobs: jobs }
}

/**
 * Create an order (round) on a table. Idempotent by client_request_id.
 * Snapshots product name/price/category/printer at time of order.
 */
export async function createOrder(
  db: D1Database,
  tableId: number,
  incoming: IncomingItem[],
  clientRequestId: string,
  note = ''
): Promise<{ order_id: string; seq: number; check_id: string; duplicate: boolean; print_jobs: CreatedJob[]; items: OrderItemRow[] }> {
  if (!clientRequestId || clientRequestId.length < 8) bad('معرّف الطلب مفقود', 'missing_request_id')
  if (!Array.isArray(incoming) || incoming.length === 0) bad('الطلب فارغ', 'empty_order')

  // Idempotency: if we already processed this request, return the same result
  const existing = await first<{ id: string; seq: number; check_id: string }>(db, 'SELECT id, seq, check_id FROM orders WHERE client_request_id=?', clientRequestId)
  if (existing) {
    const items = await all<OrderItemRow>(db, 'SELECT * FROM order_items WHERE order_id=?', existing.id)
    const jobs = await all<any>(db, "SELECT id, printer_id, printer_name, status, job_type FROM print_jobs WHERE ref_type='order' AND ref_id=?", existing.id)
    return { order_id: existing.id, seq: existing.seq, check_id: existing.check_id, duplicate: true, print_jobs: jobs, items }
  }

  const { check, table } = await ensureOpenCheck(db, tableId)
  if (check.status !== 'open' && check.status !== 'billing') conflict('لا يمكن إضافة طلبات على حساب مغلق')

  // Load catalog snapshot
  const ids = Array.from(new Set(incoming.map((i) => parseInt(String(i.product_id), 10)).filter((n) => Number.isFinite(n))))
  if (!ids.length) bad('منتجات غير صالحة')
  const placeholders = ids.map(() => '?').join(',')
  const products = await all<Product>(db, `SELECT * FROM products WHERE id IN (${placeholders})`, ...ids)
  const pmap = new Map(products.map((p) => [p.id, p]))
  const categories = await all<Category>(db, 'SELECT * FROM categories')
  const cmap = new Map(categories.map((c) => [c.id, c]))
  const currencies = currencyMap(await getCurrencies(db))
  const checkCur = currencies[check.currency_code] || (await getBaseCurrency(db))

  // Validate
  const rows: Omit<OrderItemRow, 'id' | 'order_id' | 'created_at'>[] = []
  for (const inc of incoming) {
    const pid = parseInt(String(inc.product_id), 10)
    const qty = Math.max(1, Math.min(99, parseInt(String(inc.qty), 10) || 1))
    const p = pmap.get(pid)
    if (!p || p.is_deleted) bad(`المنتج غير موجود (#${pid})`, 'product_missing')
    if (!p.is_available) bad(`المنتج «${p.name}» غير متوفر حالياً`, 'product_unavailable')
    const cat = p.category_id ? cmap.get(p.category_id) : undefined
    const pcur = currencies[p.currency_code] || checkCur
    const unitBase = convert(p.price, pcur, checkCur)
    rows.push({
      check_id: check.id,
      product_id: p.id,
      product_name: p.name,
      category_id: cat?.id ?? null,
      category_name: cat?.name ?? '',
      printer_id: cat?.printer_id ?? null,
      unit_price: p.price,
      currency_code: p.currency_code,
      unit_price_base: unitBase,
      qty,
      line_total: roundMoney(unitBase * qty, checkCur.decimals),
      note: (inc.note || '').toString().slice(0, 200),
      is_voided: 0,
    })
  }

  const seqRow = await first<{ m: number | null }>(db, 'SELECT MAX(seq) m FROM orders WHERE check_id=?', check.id)
  const seq = (seqRow?.m || 0) + 1
  const orderId = newId('ord')
  const createdAt = nowIso()

  const stmts: D1PreparedStatement[] = [
    db
      .prepare('INSERT INTO orders (id, client_request_id, check_id, table_id, table_number, seq, status, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(orderId, clientRequestId, check.id, table.id, table.number, seq, 'sent', note.slice(0, 300), createdAt),
  ]
  for (const r of rows) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO order_items (order_id, check_id, product_id, product_name, category_id, category_name, printer_id, unit_price, currency_code, unit_price_base, qty, line_total, note, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .bind(orderId, r.check_id, r.product_id, r.product_name, r.category_id, r.category_name, r.printer_id, r.unit_price, r.currency_code, r.unit_price_base, r.qty, r.line_total, r.note, createdAt)
    )
  }
  stmts.push(db.prepare("UPDATE tables SET status='occupied', updated_at=datetime('now') WHERE id=? AND status IN ('empty','occupied')").bind(table.id))
  stmts.push(db.prepare("UPDATE checks SET status='open' WHERE id=? AND status='billing'").bind(check.id))

  try {
    await db.batch(stmts)
  } catch (e: any) {
    // Unique violation on client_request_id => concurrent duplicate; return the stored one
    if (String(e?.message || e).includes('UNIQUE')) {
      const dup = await first<{ id: string; seq: number; check_id: string }>(db, 'SELECT id, seq, check_id FROM orders WHERE client_request_id=?', clientRequestId)
      if (dup) {
        const items = await all<OrderItemRow>(db, 'SELECT * FROM order_items WHERE order_id=?', dup.id)
        const jobs = await all<any>(db, "SELECT id, printer_id, printer_name, status, job_type FROM print_jobs WHERE ref_type='order' AND ref_id=?", dup.id)
        return { order_id: dup.id, seq: dup.seq, check_id: dup.check_id, duplicate: true, print_jobs: jobs, items }
      }
    }
    throw e
  }

  await recomputeTotals(db, check.id)
  const items = await all<OrderItemRow>(db, 'SELECT * FROM order_items WHERE order_id=?', orderId)
  const jobs = await enqueueKitchenTickets(db, items, { table_number: table.number, order_seq: seq, order_id: orderId, check_id: check.id, note })
  return { order_id: orderId, seq, check_id: check.id, duplicate: false, print_jobs: jobs, items }
}

/** Change qty of an existing item (qty<=0 voids it) — only while check is open/billing */
export async function updateItemQty(db: D1Database, itemId: number, qty: number): Promise<OrderItemRow | null> {
  const item = await first<OrderItemRow>(db, 'SELECT * FROM order_items WHERE id=?', itemId)
  if (!item) notFound('العنصر غير موجود')
  const check = await getCheck(db, item.check_id)
  if (!check || (check.status !== 'open' && check.status !== 'billing')) conflict('الحساب مغلق')
  const cur = (await first<Currency>(db, 'SELECT * FROM currencies WHERE code=?', check.currency_code)) || (await getBaseCurrency(db))
  const q = Math.max(0, Math.min(99, Math.floor(qty)))
  if (q === 0) {
    await run(db, 'UPDATE order_items SET is_voided=1 WHERE id=?', itemId)
  } else {
    await run(db, 'UPDATE order_items SET qty=?, line_total=? WHERE id=?', q, roundMoney(item.unit_price_base * q, cur.decimals), itemId)
  }
  await recomputeTotals(db, check.id)
  return first<OrderItemRow>(db, 'SELECT * FROM order_items WHERE id=?', itemId)
}

export async function setDiscount(db: D1Database, checkId: string, discount: number) {
  const check = await getCheck(db, checkId)
  if (!check || (check.status !== 'open' && check.status !== 'billing')) conflict('الحساب مغلق')
  await run(db, 'UPDATE checks SET discount=? WHERE id=?', Math.max(0, discount), checkId)
  return recomputeTotals(db, checkId)
}

/** Print bill to cashier printer; marks check as billing and table as awaiting payment */
export async function printBill(db: D1Database, checkId: string): Promise<CreatedJob> {
  const check = await getCheck(db, checkId)
  if (!check) notFound('الحساب غير موجود')
  if (check.status === 'paid' || check.status === 'cancelled') conflict('الحساب مغلق مسبقاً')
  await recomputeTotals(db, checkId)
  const fresh = (await getCheck(db, checkId))!
  const items = await getCheckItems(db, checkId)
  if (!items.length) bad('لا توجد عناصر في الحساب', 'empty_check')
  const job = await enqueueBill(db, fresh, items)
  await db.batch([
    db.prepare("UPDATE checks SET status='billing', bill_printed_at=?, bill_print_count=bill_print_count+1 WHERE id=?").bind(nowIso(), checkId),
    db.prepare("UPDATE tables SET status='awaiting_payment', updated_at=datetime('now') WHERE id=?").bind(fresh.table_id),
  ])
  return job
}

/** Mark table as ready for billing (visual state) */
export async function markBilling(db: D1Database, checkId: string) {
  const check = await getCheck(db, checkId)
  if (!check || (check.status !== 'open' && check.status !== 'billing')) conflict('الحساب مغلق')
  await db.batch([
    db.prepare("UPDATE checks SET status='billing' WHERE id=?").bind(checkId),
    db.prepare("UPDATE tables SET status='billing', updated_at=datetime('now') WHERE id=? AND status<>'awaiting_payment'").bind(check.table_id),
  ])
}

/**
 * Record payment, write the immutable sale, close the check, reset the table.
 * Idempotent by client_request_id.
 */
export async function payCheck(
  db: D1Database,
  checkId: string,
  clientRequestId: string,
  opts: { method?: string; received?: number; currency_code?: string } = {}
): Promise<{ sale_id: string; duplicate: boolean; total: number; currency_code: string; change_given: number | null }> {
  if (!clientRequestId || clientRequestId.length < 8) bad('معرّف العملية مفقود', 'missing_request_id')
  const dupPay = await first<{ id: string; check_id: string; change_given: number | null }>(db, 'SELECT id, check_id, change_given FROM payments WHERE client_request_id=?', clientRequestId)
  if (dupPay) {
    const sale = await first<{ id: string; total: number; currency_code: string }>(db, 'SELECT id, total, currency_code FROM sales WHERE check_id=?', dupPay.check_id)
    return { sale_id: sale?.id || '', duplicate: true, total: sale?.total || 0, currency_code: sale?.currency_code || '', change_given: dupPay.change_given }
  }
  const check = await getCheck(db, checkId)
  if (!check) notFound('الحساب غير موجود')
  if (check.status === 'paid') {
    const sale = await first<{ id: string; total: number; currency_code: string }>(db, 'SELECT id, total, currency_code FROM sales WHERE check_id=?', checkId)
    return { sale_id: sale?.id || '', duplicate: true, total: check.total, currency_code: check.currency_code, change_given: null }
  }
  if (check.status === 'cancelled') conflict('الحساب ملغى')

  await recomputeTotals(db, checkId)
  const fresh = (await getCheck(db, checkId))!
  const items = await getCheckItems(db, checkId)
  if (!items.length) bad('لا يمكن الدفع لحساب فارغ', 'empty_check')

  const currencies = await getCurrencies(db)
  const cmap = currencyMap(currencies)
  const checkCur = cmap[fresh.currency_code] || (await getBaseCurrency(db))
  const payCur = cmap[opts.currency_code || ''] || checkCur
  const totalInPayCur = convert(fresh.total, checkCur, payCur)
  const received = typeof opts.received === 'number' && Number.isFinite(opts.received) ? opts.received : null
  const change = received !== null ? roundMoney(Math.max(0, received - totalInPayCur), payCur.decimals) : null
  const method = (opts.method || 'cash').slice(0, 30)

  const paymentId = newId('pay')
  const saleId = newId('sale')
  const paidAt = nowIso()
  const itemsSnapshot = items.map((i) => ({
    product_id: i.product_id,
    name: i.product_name,
    category: i.category_name,
    qty: i.qty,
    unit_price: i.unit_price_base,
    line_total: i.line_total,
    note: i.note,
  }))
  const rates: Record<string, number> = {}
  for (const c of currencies) rates[c.code] = c.rate_to_base

  const stmts = [
    db
      .prepare('INSERT INTO payments (id, client_request_id, check_id, amount, currency_code, amount_base, method, received, change_given, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(paymentId, clientRequestId, checkId, totalInPayCur, payCur.code, fresh.total, method, received, change, paidAt),
    db
      .prepare(
        `INSERT INTO sales (id, check_id, table_number, items_json, items_count, subtotal, discount, total, currency_code, rates_json, payment_method, payment_status, opened_at, paid_at, sale_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(saleId, checkId, fresh.table_number, JSON.stringify(itemsSnapshot), items.reduce((a, b) => a + b.qty, 0), fresh.subtotal, fresh.discount, fresh.total, fresh.currency_code, JSON.stringify(rates), method, 'paid', fresh.opened_at, paidAt, paidAt.slice(0, 10)),
    db.prepare("UPDATE checks SET status='paid', closed_at=? WHERE id=?").bind(paidAt, checkId),
    db.prepare("UPDATE tables SET status='empty', current_check_id=NULL, updated_at=datetime('now') WHERE id=? AND current_check_id=?").bind(fresh.table_id, checkId),
  ]
  try {
    await db.batch(stmts)
  } catch (e: any) {
    if (String(e?.message || e).includes('UNIQUE')) {
      const sale = await first<{ id: string; total: number; currency_code: string }>(db, 'SELECT id, total, currency_code FROM sales WHERE check_id=?', checkId)
      if (sale) return { sale_id: sale.id, duplicate: true, total: sale.total, currency_code: sale.currency_code, change_given: null }
    }
    throw e
  }
  return { sale_id: saleId, duplicate: false, total: fresh.total, currency_code: fresh.currency_code, change_given: change }
}

/** Cancel an open check with no payment (admin/void) */
export async function cancelCheck(db: D1Database, checkId: string, reason = '') {
  const check = await getCheck(db, checkId)
  if (!check) notFound('الحساب غير موجود')
  if (check.status === 'paid') conflict('لا يمكن إلغاء حساب مدفوع')
  await db.batch([
    db.prepare("UPDATE checks SET status='cancelled', closed_at=?, note=? WHERE id=?").bind(nowIso(), reason.slice(0, 300), checkId),
    db.prepare("UPDATE tables SET status='empty', current_check_id=NULL, updated_at=datetime('now') WHERE id=? AND current_check_id=?").bind(check.table_id, checkId),
    db.prepare("UPDATE print_jobs SET status='cancelled' WHERE status='pending' AND ((ref_type='check' AND ref_id=?) OR (ref_type='order' AND ref_id IN (SELECT id FROM orders WHERE check_id=?)))").bind(checkId, checkId),
  ])
}

export { HttpError, todayDate }
