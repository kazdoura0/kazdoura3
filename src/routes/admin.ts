/** Admin API — protected by session auth */
import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import type { AppEnv, Printer, Category, Product, Currency, TableRow } from '../types'
import { requireAdmin, adminPassword, createSession, destroySession, timingSafeEqual } from '../lib/auth'
import { all, first, run, audit, getSettings, getMessages, getCurrencies, getPrinters, getCategories, getProducts, getTables } from '../lib/db'
import { toInt, toNum, toBool01, str, bad, notFound, conflict, HttpError } from '../lib/util'
import { enqueueTest } from '../lib/printing'
import { cancelCheck } from '../lib/orders'

const admin = new Hono<AppEnv>()

// ---------- Auth ----------
admin.post('/login', async (c) => {
  const expected = adminPassword(c.env)
  if (!expected) throw new HttpError(500, 'لم يتم ضبط كلمة مرور المدير (ADMIN_PASSWORD)', 'not_configured')
  const body = await c.req.json().catch(() => ({}))
  const pwd = str(body.password, 200)
  if (!pwd || !timingSafeEqual(pwd, expected)) {
    await new Promise((r) => setTimeout(r, 400))
    throw new HttpError(401, 'كلمة المرور غير صحيحة', 'bad_password')
  }
  const token = await createSession(c.env.DB, c.req.header('user-agent') || '')
  setCookie(c, 'kz_admin', token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 12 * 3600, secure: new URL(c.req.url).protocol === 'https:' })
  return c.json({ ok: true, token })
})

admin.post('/logout', requireAdmin, async (c) => {
  await destroySession(c.env.DB, c.get('adminToken') || '')
  deleteCookie(c, 'kz_admin', { path: '/' })
  return c.json({ ok: true })
})

admin.get('/me', requireAdmin, (c) => c.json({ ok: true }))

admin.use('/*', async (c, next) => {
  if (c.req.path.endsWith('/login')) return next()
  return requireAdmin(c, next)
})

// ---------- Overview ----------
admin.get('/overview', async (c) => {
  const db = c.env.DB
  const [settings, messages, currencies, printers, categories, products, tables] = await Promise.all([
    getSettings(db), getMessages(db), getCurrencies(db), getPrinters(db), getCategories(db), getProducts(db, true), getTables(db),
  ])
  const today = await first<{ n: number; t: number | null }>(db, "SELECT COUNT(*) n, SUM(total) t FROM sales WHERE sale_date=date('now')")
  const openChecks = await first<{ n: number }>(db, "SELECT COUNT(*) n FROM checks WHERE status IN ('open','billing')")
  const failedJobs = await first<{ n: number }>(db, "SELECT COUNT(*) n FROM print_jobs WHERE status='failed'")
  const pendingJobs = await first<{ n: number }>(db, "SELECT COUNT(*) n FROM print_jobs WHERE status IN ('pending','printing')")
  const allTables = await all<TableRow>(db, 'SELECT * FROM tables ORDER BY sort_order, number')
  const msgRows = await all<any>(db, 'SELECT key, label, value FROM messages ORDER BY rowid')
  return c.json({
    ok: true,
    settings,
    messages: msgRows,
    currencies,
    printers,
    categories,
    products,
    tables: allTables,
    stats: {
      today_sales_count: today?.n || 0,
      today_sales_total: today?.t || 0,
      open_checks: openChecks?.n || 0,
      failed_print_jobs: failedJobs?.n || 0,
      pending_print_jobs: pendingJobs?.n || 0,
      bridge_last_seen: settings.bridge_last_seen || null,
      bridge_agent: settings.bridge_agent || null,
    },
  })
})

// ---------- Settings ----------
admin.put('/settings', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const allowed = ['store_name', 'store_subtitle', 'store_phone', 'store_address', 'receipt_logo_text', 'pos_refresh_seconds', 'bridge_poll_seconds', 'print_job_max_attempts', 'show_prices_in_secondary']
  const stmts: D1PreparedStatement[] = []
  for (const k of allowed) {
    if (body[k] === undefined) continue
    stmts.push(c.env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").bind(k, str(body[k], 500)))
  }
  if (stmts.length) await c.env.DB.batch(stmts)
  await audit(c.env.DB, 'update', 'settings', null, JSON.stringify(body).slice(0, 500))
  return c.json({ ok: true, settings: await getSettings(c.env.DB) })
})

// ---------- Messages ----------
admin.put('/messages', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const items: { key: string; value: string; label?: string }[] = Array.isArray(body.messages) ? body.messages : []
  const stmts = items
    .filter((m) => m && m.key)
    .map((m) =>
      c.env.DB.prepare("INSERT INTO messages (key, label, value, updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, label=COALESCE(NULLIF(excluded.label,''), messages.label), updated_at=datetime('now')").bind(str(m.key, 60), str(m.label || '', 100), str(m.value, 1000))
    )
  if (stmts.length) await c.env.DB.batch(stmts)
  await audit(c.env.DB, 'update', 'messages', null)
  return c.json({ ok: true, messages: await all(c.env.DB, 'SELECT key, label, value FROM messages ORDER BY rowid') })
})

// ---------- Currencies ----------
admin.post('/currencies', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const code = str(b.code, 6).toUpperCase()
  if (!/^[A-Z]{3,6}$/.test(code)) bad('رمز العملة غير صالح (مثال: USD)')
  const exists = await first(c.env.DB, 'SELECT code FROM currencies WHERE code=?', code)
  if (exists) conflict('العملة موجودة مسبقاً')
  const cnt = await first<{ n: number }>(c.env.DB, 'SELECT COUNT(*) n FROM currencies')
  const isBase = (cnt?.n || 0) === 0 ? 1 : 0
  await run(c.env.DB, 'INSERT INTO currencies (code, name, symbol, decimals, is_base, rate_to_base, is_active, sort_order) VALUES (?,?,?,?,?,?,?,?)', code, str(b.name, 60) || code, str(b.symbol, 10), Math.max(0, Math.min(4, toInt(b.decimals, 2))), isBase, isBase ? 1 : Math.max(0.0000000001, toNum(b.rate_to_base, 1)), toBool01(b.is_active), toInt(b.sort_order, 99))
  await run(c.env.DB, 'INSERT INTO exchange_rate_history (code, rate_to_base) VALUES (?,?)', code, toNum(b.rate_to_base, 1))
  await audit(c.env.DB, 'create', 'currency', code)
  return c.json({ ok: true, currencies: await getCurrencies(c.env.DB) }, 201)
})

admin.put('/currencies/:code', async (c) => {
  const db = c.env.DB
  const code = c.req.param('code').toUpperCase()
  const cur = await first<Currency>(db, 'SELECT * FROM currencies WHERE code=?', code)
  if (!cur) notFound('العملة غير موجودة')
  const b = await c.req.json().catch(() => ({}))
  const rate = b.rate_to_base === undefined ? cur.rate_to_base : Math.max(0.0000000001, toNum(b.rate_to_base, cur.rate_to_base))
  if (cur.is_base && b.rate_to_base !== undefined && rate !== 1) bad('سعر صرف العملة الأساسية يجب أن يكون 1')
  await run(db, "UPDATE currencies SET name=?, symbol=?, decimals=?, rate_to_base=?, is_active=?, sort_order=?, updated_at=datetime('now') WHERE code=?", str(b.name, 60) || cur.name, b.symbol === undefined ? cur.symbol : str(b.symbol, 10), b.decimals === undefined ? cur.decimals : Math.max(0, Math.min(4, toInt(b.decimals))), cur.is_base ? 1 : rate, b.is_active === undefined ? cur.is_active : toBool01(b.is_active), b.sort_order === undefined ? cur.sort_order : toInt(b.sort_order), code)
  if (rate !== cur.rate_to_base) await run(db, 'INSERT INTO exchange_rate_history (code, rate_to_base) VALUES (?,?)', code, rate)
  await audit(db, 'update', 'currency', code, JSON.stringify(b).slice(0, 300))
  return c.json({ ok: true, currencies: await getCurrencies(db) })
})

/** Set base currency: rates of others are re-expressed relative to new base */
admin.post('/currencies/:code/set-base', async (c) => {
  const db = c.env.DB
  const code = c.req.param('code').toUpperCase()
  const list = await getCurrencies(db)
  const target = list.find((x) => x.code === code)
  if (!target) notFound('العملة غير موجودة')
  const factor = target.rate_to_base // 1 target = factor old-base
  const stmts = list.map((cur) => {
    const newRate = cur.code === code ? 1 : cur.rate_to_base / factor
    return db.prepare("UPDATE currencies SET is_base=?, rate_to_base=?, updated_at=datetime('now') WHERE code=?").bind(cur.code === code ? 1 : 0, newRate, cur.code)
  })
  await db.batch(stmts)
  await audit(db, 'set_base', 'currency', code)
  return c.json({ ok: true, currencies: await getCurrencies(db) })
})

admin.delete('/currencies/:code', async (c) => {
  const db = c.env.DB
  const code = c.req.param('code').toUpperCase()
  const cur = await first<Currency>(db, 'SELECT * FROM currencies WHERE code=?', code)
  if (!cur) notFound('العملة غير موجودة')
  if (cur.is_base) bad('لا يمكن حذف العملة الأساسية')
  const used = await first<{ n: number }>(db, 'SELECT COUNT(*) n FROM products WHERE currency_code=? AND is_deleted=0', code)
  if ((used?.n || 0) > 0) conflict(`لا يمكن حذف العملة: مستخدمة في ${used!.n} منتج`)
  await run(db, 'DELETE FROM currencies WHERE code=?', code)
  await audit(db, 'delete', 'currency', code)
  return c.json({ ok: true, currencies: await getCurrencies(db) })
})

// ---------- Printers ----------
function printerBody(b: any, prev?: Printer) {
  const type = str(b.type ?? prev?.type ?? 'network', 20)
  if (!['network', 'browser'].includes(type)) bad('نوع الطابعة غير صالح')
  const role = str(b.role ?? prev?.role ?? 'kitchen', 20)
  if (!['kitchen', 'cashier'].includes(role)) bad('دور الطابعة غير صالح')
  const name = str(b.name ?? prev?.name, 80)
  if (!name) bad('اسم الطابعة مطلوب')
  return {
    name,
    type,
    host: str(b.host ?? prev?.host ?? '', 120),
    port: Math.max(1, Math.min(65535, toInt(b.port ?? prev?.port ?? 9100, 9100))),
    paper_width: [58, 80].includes(toInt(b.paper_width ?? prev?.paper_width ?? 80)) ? toInt(b.paper_width ?? prev?.paper_width ?? 80) : 80,
    role,
    is_active: b.is_active === undefined ? (prev?.is_active ?? 1) : toBool01(b.is_active),
    sort_order: toInt(b.sort_order ?? prev?.sort_order ?? 99),
  }
}

admin.post('/printers', async (c) => {
  const p = printerBody(await c.req.json().catch(() => ({})))
  const r = await run(c.env.DB, 'INSERT INTO printers (name, type, host, port, paper_width, role, is_active, sort_order) VALUES (?,?,?,?,?,?,?,?)', p.name, p.type, p.host, p.port, p.paper_width, p.role, p.is_active, p.sort_order)
  await audit(c.env.DB, 'create', 'printer', r.meta.last_row_id)
  return c.json({ ok: true, id: r.meta.last_row_id, printers: await getPrinters(c.env.DB) }, 201)
})

admin.put('/printers/:id', async (c) => {
  const id = toInt(c.req.param('id'))
  const prev = await first<Printer>(c.env.DB, 'SELECT * FROM printers WHERE id=?', id)
  if (!prev) notFound('الطابعة غير موجودة')
  const p = printerBody(await c.req.json().catch(() => ({})), prev)
  await run(c.env.DB, "UPDATE printers SET name=?, type=?, host=?, port=?, paper_width=?, role=?, is_active=?, sort_order=?, updated_at=datetime('now') WHERE id=?", p.name, p.type, p.host, p.port, p.paper_width, p.role, p.is_active, p.sort_order, id)
  await audit(c.env.DB, 'update', 'printer', id)
  return c.json({ ok: true, printers: await getPrinters(c.env.DB) })
})

admin.delete('/printers/:id', async (c) => {
  const id = toInt(c.req.param('id'))
  const prev = await first<Printer>(c.env.DB, 'SELECT * FROM printers WHERE id=?', id)
  if (!prev) notFound('الطابعة غير موجودة')
  const used = await first<{ n: number }>(c.env.DB, 'SELECT COUNT(*) n FROM categories WHERE printer_id=?', id)
  if ((used?.n || 0) > 0) conflict(`الطابعة مرتبطة بـ ${used!.n} قسم — غيّر طابعة الأقسام أولاً`)
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE print_jobs SET status='cancelled' WHERE printer_id=? AND status IN ('pending','printing')").bind(id),
    c.env.DB.prepare('DELETE FROM printers WHERE id=?').bind(id),
  ])
  await audit(c.env.DB, 'delete', 'printer', id)
  return c.json({ ok: true, printers: await getPrinters(c.env.DB) })
})

admin.post('/printers/:id/test', async (c) => {
  const id = toInt(c.req.param('id'))
  const p = await first<Printer>(c.env.DB, 'SELECT * FROM printers WHERE id=?', id)
  if (!p) notFound('الطابعة غير موجودة')
  const job = await enqueueTest(c.env.DB, p)
  return c.json({ ok: true, print_job: job })
})

admin.get('/print-jobs', async (c) => {
  const status = str(c.req.query('status'), 20)
  const limit = Math.min(200, toInt(c.req.query('limit'), 100))
  const rows = status
    ? await all<any>(c.env.DB, 'SELECT id, printer_id, printer_name, job_type, ref_type, ref_id, status, attempts, max_attempts, last_error, claimed_by, printed_at, created_at FROM print_jobs WHERE status=? ORDER BY created_at DESC LIMIT ?', status, limit)
    : await all<any>(c.env.DB, 'SELECT id, printer_id, printer_name, job_type, ref_type, ref_id, status, attempts, max_attempts, last_error, claimed_by, printed_at, created_at FROM print_jobs ORDER BY created_at DESC LIMIT ?', limit)
  return c.json({ ok: true, jobs: rows })
})

admin.post('/print-jobs/:id/retry', async (c) => {
  await run(c.env.DB, "UPDATE print_jobs SET status='pending', attempts=0, claimed_by=NULL, claimed_at=NULL, last_error='', updated_at=datetime('now') WHERE id=? AND printer_id IS NOT NULL", c.req.param('id'))
  return c.json({ ok: true })
})
admin.post('/print-jobs/:id/cancel', async (c) => {
  await run(c.env.DB, "UPDATE print_jobs SET status='cancelled', updated_at=datetime('now') WHERE id=? AND status IN ('pending','failed','printing')", c.req.param('id'))
  return c.json({ ok: true })
})

// ---------- Categories ----------
admin.post('/categories', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const name = str(b.name, 80)
  if (!name) bad('اسم القسم مطلوب')
  const printerId = b.printer_id ? toInt(b.printer_id) : null
  if (printerId) {
    const p = await first(c.env.DB, 'SELECT id FROM printers WHERE id=?', printerId)
    if (!p) bad('الطابعة غير موجودة')
  }
  const r = await run(c.env.DB, 'INSERT INTO categories (name, slug, icon, printer_id, sort_order, is_active) VALUES (?,?,?,?,?,?)', name, str(b.slug, 40) || null, str(b.icon, 40), printerId, toInt(b.sort_order, 99), toBool01(b.is_active))
  await audit(c.env.DB, 'create', 'category', r.meta.last_row_id)
  return c.json({ ok: true, id: r.meta.last_row_id, categories: await getCategories(c.env.DB) }, 201)
})

admin.put('/categories/:id', async (c) => {
  const id = toInt(c.req.param('id'))
  const prev = await first<Category>(c.env.DB, 'SELECT * FROM categories WHERE id=?', id)
  if (!prev) notFound('القسم غير موجود')
  const b = await c.req.json().catch(() => ({}))
  const printerId = b.printer_id === undefined ? prev.printer_id : b.printer_id ? toInt(b.printer_id) : null
  if (printerId) {
    const p = await first(c.env.DB, 'SELECT id FROM printers WHERE id=?', printerId)
    if (!p) bad('الطابعة غير موجودة')
  }
  await run(c.env.DB, "UPDATE categories SET name=?, slug=?, icon=?, printer_id=?, sort_order=?, is_active=?, updated_at=datetime('now') WHERE id=?", str(b.name ?? prev.name, 80) || prev.name, b.slug === undefined ? prev.slug : str(b.slug, 40) || null, b.icon === undefined ? prev.icon : str(b.icon, 40), printerId, b.sort_order === undefined ? prev.sort_order : toInt(b.sort_order), b.is_active === undefined ? prev.is_active : toBool01(b.is_active), id)
  await audit(c.env.DB, 'update', 'category', id, JSON.stringify(b).slice(0, 300))
  return c.json({ ok: true, categories: await getCategories(c.env.DB) })
})

admin.delete('/categories/:id', async (c) => {
  const id = toInt(c.req.param('id'))
  const prev = await first<Category>(c.env.DB, 'SELECT * FROM categories WHERE id=?', id)
  if (!prev) notFound('القسم غير موجود')
  const used = await first<{ n: number }>(c.env.DB, 'SELECT COUNT(*) n FROM products WHERE category_id=? AND is_deleted=0', id)
  if ((used?.n || 0) > 0) conflict(`لا يمكن حذف القسم: يحتوي ${used!.n} منتج — انقل المنتجات أولاً`)
  await run(c.env.DB, 'DELETE FROM categories WHERE id=?', id)
  await audit(c.env.DB, 'delete', 'category', id)
  return c.json({ ok: true, categories: await getCategories(c.env.DB) })
})

admin.post('/categories/reorder', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const ids: number[] = Array.isArray(b.ids) ? b.ids.map((x: any) => toInt(x)) : []
  if (ids.length) await c.env.DB.batch(ids.map((id, i) => c.env.DB.prepare('UPDATE categories SET sort_order=? WHERE id=?').bind(i + 1, id)))
  return c.json({ ok: true, categories: await getCategories(c.env.DB) })
})

// ---------- Products ----------
async function productBody(db: D1Database, b: any, prev?: Product) {
  const name = str(b.name ?? prev?.name, 120)
  if (!name) bad('اسم المنتج مطلوب')
  const price = b.price === undefined ? prev?.price ?? 0 : toNum(b.price, NaN)
  if (!Number.isFinite(price) || price < 0) bad('السعر غير صالح')
  const currency = str(b.currency_code ?? prev?.currency_code ?? '', 6).toUpperCase()
  const cur = await first(db, 'SELECT code FROM currencies WHERE code=?', currency)
  if (!cur) bad('العملة غير موجودة')
  const categoryId = b.category_id === undefined ? prev?.category_id ?? null : b.category_id ? toInt(b.category_id) : null
  if (categoryId) {
    const cat = await first(db, 'SELECT id FROM categories WHERE id=?', categoryId)
    if (!cat) bad('القسم غير موجود')
  }
  return {
    name,
    description: b.description === undefined ? prev?.description ?? '' : str(b.description, 500),
    image_url: b.image_url === undefined ? prev?.image_url ?? '' : str(b.image_url, 400000), // may be a data URL
    price,
    currency_code: currency,
    category_id: categoryId,
    is_available: b.is_available === undefined ? prev?.is_available ?? 1 : toBool01(b.is_available),
    sort_order: b.sort_order === undefined ? prev?.sort_order ?? 99 : toInt(b.sort_order),
  }
}

admin.post('/products', async (c) => {
  const p = await productBody(c.env.DB, await c.req.json().catch(() => ({})))
  const r = await run(c.env.DB, 'INSERT INTO products (name, description, image_url, price, currency_code, category_id, is_available, sort_order) VALUES (?,?,?,?,?,?,?,?)', p.name, p.description, p.image_url, p.price, p.currency_code, p.category_id, p.is_available, p.sort_order)
  await audit(c.env.DB, 'create', 'product', r.meta.last_row_id, p.name)
  return c.json({ ok: true, id: r.meta.last_row_id, product: await first(c.env.DB, 'SELECT * FROM products WHERE id=?', r.meta.last_row_id) }, 201)
})

admin.put('/products/:id', async (c) => {
  const id = toInt(c.req.param('id'))
  const prev = await first<Product>(c.env.DB, 'SELECT * FROM products WHERE id=? AND is_deleted=0', id)
  if (!prev) notFound('المنتج غير موجود')
  const p = await productBody(c.env.DB, await c.req.json().catch(() => ({})), prev)
  await run(c.env.DB, "UPDATE products SET name=?, description=?, image_url=?, price=?, currency_code=?, category_id=?, is_available=?, sort_order=?, updated_at=datetime('now') WHERE id=?", p.name, p.description, p.image_url, p.price, p.currency_code, p.category_id, p.is_available, p.sort_order, id)
  await audit(c.env.DB, 'update', 'product', id, JSON.stringify({ ...p, image_url: p.image_url ? '[image]' : '' }).slice(0, 400))
  return c.json({ ok: true, product: await first(c.env.DB, 'SELECT * FROM products WHERE id=?', id) })
})

admin.delete('/products/:id', async (c) => {
  const id = toInt(c.req.param('id'))
  const prev = await first<Product>(c.env.DB, 'SELECT * FROM products WHERE id=? AND is_deleted=0', id)
  if (!prev) notFound('المنتج غير موجود')
  // soft delete keeps historical order_items snapshots intact
  await run(c.env.DB, "UPDATE products SET is_deleted=1, is_available=0, updated_at=datetime('now') WHERE id=?", id)
  await audit(c.env.DB, 'delete', 'product', id, prev.name)
  return c.json({ ok: true })
})

admin.post('/products/reorder', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const ids: number[] = Array.isArray(b.ids) ? b.ids.map((x: any) => toInt(x)) : []
  if (ids.length) await c.env.DB.batch(ids.map((id, i) => c.env.DB.prepare('UPDATE products SET sort_order=? WHERE id=?').bind(i + 1, id)))
  return c.json({ ok: true })
})

// ---------- Tables ----------
admin.post('/tables', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const db = c.env.DB
  if (b.count !== undefined) {
    // bulk: ensure tables 1..count exist (activate/deactivate accordingly)
    const count = Math.max(1, Math.min(200, toInt(b.count, 10)))
    const existing = await all<TableRow>(db, 'SELECT * FROM tables')
    const byNum = new Map(existing.map((t) => [t.number, t]))
    const stmts: D1PreparedStatement[] = []
    for (let n = 1; n <= count; n++) {
      const t = byNum.get(n)
      if (!t) stmts.push(db.prepare('INSERT INTO tables (number, label, sort_order) VALUES (?,?,?)').bind(n, '', n))
      else if (!t.is_active) stmts.push(db.prepare("UPDATE tables SET is_active=1, updated_at=datetime('now') WHERE id=?").bind(t.id))
    }
    for (const t of existing) {
      if (t.number > count && t.is_active) {
        if (t.current_check_id) conflict(`الطاولة ${t.number} عليها حساب مفتوح — أغلقه قبل تقليل عدد الطاولات`)
        stmts.push(db.prepare("UPDATE tables SET is_active=0, updated_at=datetime('now') WHERE id=?").bind(t.id))
      }
    }
    if (stmts.length) await db.batch(stmts)
    await audit(db, 'bulk_set', 'table', null, `count=${count}`)
    return c.json({ ok: true, tables: await all(db, 'SELECT * FROM tables ORDER BY sort_order, number') })
  }
  const number = toInt(b.number, 0)
  if (number <= 0) bad('رقم الطاولة غير صالح')
  const ex = await first<TableRow>(db, 'SELECT * FROM tables WHERE number=?', number)
  if (ex) {
    if (ex.is_active) conflict('رقم الطاولة مستخدم')
    await run(db, "UPDATE tables SET is_active=1, label=?, seats=?, updated_at=datetime('now') WHERE id=?", str(b.label, 40), toInt(b.seats, 4), ex.id)
    return c.json({ ok: true, id: ex.id, tables: await all(db, 'SELECT * FROM tables ORDER BY sort_order, number') })
  }
  const r = await run(db, 'INSERT INTO tables (number, label, seats, sort_order) VALUES (?,?,?,?)', number, str(b.label, 40), toInt(b.seats, 4), toInt(b.sort_order, number))
  await audit(db, 'create', 'table', r.meta.last_row_id)
  return c.json({ ok: true, id: r.meta.last_row_id, tables: await all(db, 'SELECT * FROM tables ORDER BY sort_order, number') }, 201)
})

admin.put('/tables/:id', async (c) => {
  const id = toInt(c.req.param('id'))
  const prev = await first<TableRow>(c.env.DB, 'SELECT * FROM tables WHERE id=?', id)
  if (!prev) notFound('الطاولة غير موجودة')
  const b = await c.req.json().catch(() => ({}))
  const number = b.number === undefined ? prev.number : toInt(b.number)
  if (number <= 0) bad('رقم الطاولة غير صالح')
  if (number !== prev.number) {
    const dup = await first(c.env.DB, 'SELECT id FROM tables WHERE number=? AND id<>?', number, id)
    if (dup) conflict('رقم الطاولة مستخدم')
  }
  const active = b.is_active === undefined ? prev.is_active : toBool01(b.is_active)
  if (!active && prev.current_check_id) conflict('لا يمكن تعطيل طاولة عليها حساب مفتوح')
  await run(c.env.DB, "UPDATE tables SET number=?, label=?, seats=?, is_active=?, sort_order=?, updated_at=datetime('now') WHERE id=?", number, b.label === undefined ? prev.label : str(b.label, 40), b.seats === undefined ? prev.seats : toInt(b.seats, 4), active, b.sort_order === undefined ? prev.sort_order : toInt(b.sort_order), id)
  await audit(c.env.DB, 'update', 'table', id)
  return c.json({ ok: true, tables: await all(c.env.DB, 'SELECT * FROM tables ORDER BY sort_order, number') })
})

admin.delete('/tables/:id', async (c) => {
  const id = toInt(c.req.param('id'))
  const prev = await first<TableRow>(c.env.DB, 'SELECT * FROM tables WHERE id=?', id)
  if (!prev) notFound('الطاولة غير موجودة')
  if (prev.current_check_id) conflict('لا يمكن حذف طاولة عليها حساب مفتوح')
  const hist = await first<{ n: number }>(c.env.DB, 'SELECT COUNT(*) n FROM checks WHERE table_id=?', id)
  if ((hist?.n || 0) > 0) await run(c.env.DB, "UPDATE tables SET is_active=0, updated_at=datetime('now') WHERE id=?", id)
  else await run(c.env.DB, 'DELETE FROM tables WHERE id=?', id)
  await audit(c.env.DB, 'delete', 'table', id)
  return c.json({ ok: true, tables: await all(c.env.DB, 'SELECT * FROM tables ORDER BY sort_order, number') })
})

/** Force-close (cancel) an open check from admin */
admin.post('/checks/:id/cancel', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  await cancelCheck(c.env.DB, c.req.param('id'), str(b.reason, 300))
  await audit(c.env.DB, 'cancel', 'check', c.req.param('id'), str(b.reason, 300))
  return c.json({ ok: true })
})

admin.get('/checks/open', async (c) => {
  const rows = await all<any>(c.env.DB, "SELECT c.*, (SELECT COALESCE(SUM(qty),0) FROM order_items oi WHERE oi.check_id=c.id AND oi.is_voided=0) items FROM checks c WHERE c.status IN ('open','billing') ORDER BY c.opened_at")
  return c.json({ ok: true, checks: rows })
})

// ---------- Sales ----------
admin.get('/sales', async (c) => {
  const from = str(c.req.query('from'), 10)
  const to = str(c.req.query('to'), 10)
  const table = toInt(c.req.query('table'), 0)
  const limit = Math.min(500, toInt(c.req.query('limit'), 200))
  const where: string[] = []
  const params: unknown[] = []
  if (from) { where.push('sale_date >= ?'); params.push(from) }
  if (to) { where.push('sale_date <= ?'); params.push(to) }
  if (table) { where.push('table_number = ?'); params.push(table) }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = await all<any>(c.env.DB, `SELECT * FROM sales ${w} ORDER BY paid_at DESC LIMIT ?`, ...params, limit)
  const sum = await first<{ n: number; t: number | null; items: number | null }>(c.env.DB, `SELECT COUNT(*) n, SUM(total) t, SUM(items_count) items FROM sales ${w}`, ...params)
  const daily = await all<any>(c.env.DB, `SELECT sale_date, COUNT(*) n, SUM(total) t FROM sales ${w} GROUP BY sale_date ORDER BY sale_date DESC LIMIT 60`, ...params)
  return c.json({
    ok: true,
    sales: rows.map((r) => ({ ...r, items: JSON.parse(r.items_json), rates: JSON.parse(r.rates_json || '{}') })),
    summary: { count: sum?.n || 0, total: sum?.t || 0, items: sum?.items || 0 },
    daily,
  })
})

admin.get('/sales/:id', async (c) => {
  const s = await first<any>(c.env.DB, 'SELECT * FROM sales WHERE id=?', c.req.param('id'))
  if (!s) notFound('العملية غير موجودة')
  const orders = await all<any>(c.env.DB, 'SELECT * FROM orders WHERE check_id=? ORDER BY seq', s.check_id)
  const payments = await all<any>(c.env.DB, 'SELECT * FROM payments WHERE check_id=?', s.check_id)
  const jobs = await all<any>(c.env.DB, "SELECT id, printer_name, job_type, status, attempts, last_error, printed_at, created_at FROM print_jobs WHERE (ref_type='check' AND ref_id=?) OR (ref_type='order' AND ref_id IN (SELECT id FROM orders WHERE check_id=?)) ORDER BY created_at", s.check_id, s.check_id)
  return c.json({ ok: true, sale: { ...s, items: JSON.parse(s.items_json), rates: JSON.parse(s.rates_json || '{}') }, orders, payments, print_jobs: jobs })
})

/** Top products report */
admin.get('/reports/products', async (c) => {
  const from = str(c.req.query('from'), 10)
  const to = str(c.req.query('to'), 10)
  const where: string[] = ["c.status='paid'"]
  const params: unknown[] = []
  if (from) { where.push('substr(c.closed_at,1,10) >= ?'); params.push(from) }
  if (to) { where.push('substr(c.closed_at,1,10) <= ?'); params.push(to) }
  const rows = await all<any>(
    c.env.DB,
    `SELECT oi.product_name name, oi.category_name category, SUM(oi.qty) qty, SUM(oi.line_total) total
     FROM order_items oi JOIN checks c ON c.id=oi.check_id WHERE oi.is_voided=0 AND ${where.join(' AND ')}
     GROUP BY oi.product_name, oi.category_name ORDER BY qty DESC LIMIT 100`,
    ...params
  )
  return c.json({ ok: true, products: rows })
})

admin.get('/audit', async (c) => {
  const rows = await all<any>(c.env.DB, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT 200')
  return c.json({ ok: true, log: rows })
})

export default admin
