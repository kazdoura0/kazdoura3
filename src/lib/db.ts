/** Thin data-access helpers over D1 */
import type { Currency, Printer, Category, Product, TableRow, CheckRow, OrderItemRow } from '../types'

export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...params).all<T>()
  return r.results || []
}
export async function first<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  const r = await db.prepare(sql).bind(...params).first<T>()
  return (r as T) ?? null
}
export async function run(db: D1Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params).run()
}

// ---- Settings & messages
export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings')
  const o: Record<string, string> = {}
  for (const r of rows) o[r.key] = r.value
  return o
}
export async function getMessages(db: D1Database): Promise<Record<string, string>> {
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM messages')
  const o: Record<string, string> = {}
  for (const r of rows) o[r.key] = r.value
  return o
}

// ---- Currencies
export async function getCurrencies(db: D1Database, activeOnly = false): Promise<Currency[]> {
  return all<Currency>(
    db,
    `SELECT * FROM currencies ${activeOnly ? 'WHERE is_active=1' : ''} ORDER BY is_base DESC, sort_order, code`
  )
}
export async function getBaseCurrency(db: D1Database): Promise<Currency> {
  const c = await first<Currency>(db, 'SELECT * FROM currencies WHERE is_base=1 LIMIT 1')
  if (c) return c
  const any = await first<Currency>(db, 'SELECT * FROM currencies ORDER BY sort_order LIMIT 1')
  if (any) return any
  return { code: 'USD', name: 'USD', symbol: '$', decimals: 2, is_base: 1, rate_to_base: 1, is_active: 1, sort_order: 0 }
}
export function currencyMap(list: Currency[]): Record<string, Currency> {
  const m: Record<string, Currency> = {}
  for (const c of list) m[c.code] = c
  return m
}

// ---- Catalog
export async function getPrinters(db: D1Database): Promise<Printer[]> {
  return all<Printer>(db, 'SELECT * FROM printers ORDER BY sort_order, id')
}
export async function getCategories(db: D1Database): Promise<Category[]> {
  return all<Category>(db, 'SELECT * FROM categories ORDER BY sort_order, id')
}
export async function getProducts(db: D1Database, includeDeleted = false): Promise<Product[]> {
  return all<Product>(
    db,
    `SELECT * FROM products ${includeDeleted ? '' : 'WHERE is_deleted=0'} ORDER BY category_id, sort_order, id`
  )
}

// ---- Tables & checks
export async function getTables(db: D1Database): Promise<TableRow[]> {
  return all<TableRow>(db, 'SELECT * FROM tables WHERE is_active=1 ORDER BY sort_order, number')
}
export async function getTable(db: D1Database, id: number): Promise<TableRow | null> {
  return first<TableRow>(db, 'SELECT * FROM tables WHERE id=?', id)
}
export async function getCheck(db: D1Database, id: string): Promise<CheckRow | null> {
  return first<CheckRow>(db, 'SELECT * FROM checks WHERE id=?', id)
}
export async function getCheckItems(db: D1Database, checkId: string): Promise<OrderItemRow[]> {
  return all<OrderItemRow>(
    db,
    'SELECT * FROM order_items WHERE check_id=? AND is_voided=0 ORDER BY created_at, id',
    checkId
  )
}

export async function audit(db: D1Database, action: string, entity: string, entityId: string | number | null, details = '') {
  try {
    await run(
      db,
      'INSERT INTO audit_log (actor, action, entity, entity_id, details) VALUES (?,?,?,?,?)',
      'admin',
      action,
      entity,
      entityId === null ? null : String(entityId),
      details.slice(0, 2000)
    )
  } catch (e) {
    console.error('audit failed', e)
  }
}
