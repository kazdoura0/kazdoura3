/** Public POS API (workers on iPad / cashier). */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getTables, getCategories, getProducts, getCurrencies, getSettings, getMessages, first, all, getCheck, getPrinters } from '../lib/db'
import { createOrder, getCheckView, updateItemQty, printBill, payCheck, markBilling, setDiscount } from '../lib/orders'
import { toInt, toNum, str, bad } from '../lib/util'

const pos = new Hono<AppEnv>()

/** Bootstrap payload: everything the POS needs in one request */
pos.get('/bootstrap', async (c) => {
  const db = c.env.DB
  const [tables, categories, products, currencies, settings, messages, printers] = await Promise.all([
    getTables(db),
    getCategories(db),
    getProducts(db),
    getCurrencies(db, true),
    getSettings(db),
    getMessages(db),
    getPrinters(db),
  ])
  return c.json({
    ok: true,
    tables,
    categories: categories.filter((x) => x.is_active),
    products,
    currencies,
    settings: {
      store_name: settings.store_name,
      store_subtitle: settings.store_subtitle,
      pos_refresh_seconds: toInt(settings.pos_refresh_seconds, 8),
      show_prices_in_secondary: settings.show_prices_in_secondary === '1',
    },
    messages,
    printers: printers.map((p) => ({ id: p.id, name: p.name, type: p.type, role: p.role, is_active: p.is_active, last_status: p.last_status, last_seen_at: p.last_seen_at })),
    server_time: new Date().toISOString(),
  })
})

pos.get('/tables', async (c) => {
  const tables = await getTables(c.env.DB)
  const open = await all<{ id: string; table_id: number; total: number; currency_code: string; opened_at: string; status: string; items: number }>(
    c.env.DB,
    `SELECT c.id, c.table_id, c.total, c.currency_code, c.opened_at, c.status,
            (SELECT COALESCE(SUM(qty),0) FROM order_items oi WHERE oi.check_id=c.id AND oi.is_voided=0) items
     FROM checks c WHERE c.status IN ('open','billing')`
  )
  const byTable = new Map(open.map((o) => [o.table_id, o]))
  return c.json({
    ok: true,
    tables: tables.map((t) => ({ ...t, check: byTable.get(t.id) || null })),
    server_time: new Date().toISOString(),
  })
})

pos.get('/tables/:id/check', async (c) => {
  const view = await getCheckView(c.env.DB, toInt(c.req.param('id')))
  return c.json({ ok: true, ...view })
})

pos.post('/tables/:id/orders', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) bad('بيانات غير صالحة')
  const items = Array.isArray(body.items) ? body.items : []
  const res = await createOrder(c.env.DB, toInt(c.req.param('id')), items, str(body.client_request_id, 100), str(body.note, 300))
  return c.json({ ok: true, ...res }, res.duplicate ? 200 : 201)
})

pos.patch('/items/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const item = await updateItemQty(c.env.DB, toInt(c.req.param('id')), toNum(body.qty, 1))
  const view = item ? await getCheckView(c.env.DB, (await getCheck(c.env.DB, item.check_id))!.table_id) : null
  return c.json({ ok: true, item, check: view?.check || null, items: view?.items || [] })
})

pos.post('/checks/:id/bill', async (c) => {
  const job = await printBill(c.env.DB, c.req.param('id'))
  return c.json({ ok: true, print_job: job })
})

pos.post('/checks/:id/billing', async (c) => {
  await markBilling(c.env.DB, c.req.param('id'))
  return c.json({ ok: true })
})

pos.post('/checks/:id/discount', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const t = await setDiscount(c.env.DB, c.req.param('id'), toNum(body.discount, 0))
  return c.json({ ok: true, ...t })
})

pos.post('/checks/:id/pay', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await payCheck(c.env.DB, c.req.param('id'), str(body.client_request_id, 100), {
    method: str(body.method, 30) || 'cash',
    received: body.received === undefined || body.received === null || body.received === '' ? undefined : toNum(body.received),
    currency_code: str(body.currency_code, 10) || undefined,
  })
  return c.json({ ok: true, ...res })
})

/** Print job status polling (for UI feedback) */
pos.get('/print-jobs', async (c) => {
  const ids = (c.req.query('ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50)
  if (!ids.length) return c.json({ ok: true, jobs: [] })
  const jobs = await all<any>(
    c.env.DB,
    `SELECT id, printer_id, printer_name, job_type, status, attempts, last_error, printed_at, created_at FROM print_jobs WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids
  )
  return c.json({ ok: true, jobs })
})

/** Job payload for browser-type printers (rendered by /print/job/:id) */
pos.get('/print-jobs/:id', async (c) => {
  const job = await first<any>(c.env.DB,
    'SELECT j.*, p.type AS printer_type, p.name AS printer_name FROM print_jobs j LEFT JOIN printers p ON p.id=j.printer_id WHERE j.id=?',
    c.req.param('id'))
  if (!job) return c.json({ ok: false, error: 'المهمة غير موجودة' }, 404)
  return c.json({ ok: true, job: { ...job, payload: JSON.parse(job.payload) } })
})

/** Retry a failed job (worker can retry from POS) */
pos.post('/print-jobs/:id/retry', async (c) => {
  const db = c.env.DB
  const job = await first<any>(db, 'SELECT id, status, printer_id FROM print_jobs WHERE id=?', c.req.param('id'))
  if (!job) return c.json({ ok: false, error: 'المهمة غير موجودة' }, 404)
  const printer = job.printer_id ? await first<any>(db, 'SELECT id, is_active FROM printers WHERE id=?', job.printer_id) : null
  if (!printer || !printer.is_active) return c.json({ ok: false, error: 'لا توجد طابعة فعّالة لهذه المهمة' }, 409)
  await db
    .prepare("UPDATE print_jobs SET status='pending', attempts=0, claimed_by=NULL, claimed_at=NULL, last_error='', updated_at=datetime('now') WHERE id=?")
    .bind(job.id)
    .run()
  return c.json({ ok: true })
})

/** Browser-print completion callback */
pos.post('/print-jobs/:id/browser-done', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ok = !!body.ok
  await c.env.DB
    .prepare(`UPDATE print_jobs SET status=?, attempts=attempts+1, printed_at=CASE WHEN ? THEN datetime('now') ELSE printed_at END, last_error=?, updated_at=datetime('now') WHERE id=? AND (SELECT type FROM printers WHERE id=print_jobs.printer_id)='browser'`)
    .bind(ok ? 'printed' : 'failed', ok ? 1 : 0, ok ? '' : str(body.error, 300) || 'أُلغيت الطباعة من المتصفح', c.req.param('id'))
    .run()
  return c.json({ ok: true })
})

export default pos
