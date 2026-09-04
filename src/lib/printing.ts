/**
 * Print job creation. Jobs are queued in D1 and consumed by:
 *  - the Print Bridge (network printers, ESC/POS over TCP 9100), or
 *  - the browser (type='browser' printers render /print/job/:id and window.print()).
 */
import type { Printer, TicketDoc, TicketLine, Currency, CheckRow, OrderItemRow } from '../types'
import { all, first, run, getSettings, getMessages, getCurrencies, currencyMap } from './db'
import { newId, nowIso, roundMoney, convert } from './util'

export interface CreatedJob {
  id: string
  printer_id: number | null
  printer_name: string
  printer_type: string
  status: string
  job_type: string
}

export async function enqueueJob(
  db: D1Database,
  printer: Printer | null,
  jobType: 'kitchen' | 'bill' | 'test',
  refType: string | null,
  refId: string | null,
  doc: TicketDoc,
  maxAttempts = 5
): Promise<CreatedJob> {
  const id = newId('pj')
  // no printer configured -> job created as failed so the UI shows it clearly
  const status = printer && printer.is_active ? 'pending' : 'failed'
  const lastError = printer ? (printer.is_active ? '' : 'الطابعة معطّلة') : 'لا توجد طابعة مرتبطة بهذا القسم'
  await run(
    db,
    `INSERT INTO print_jobs (id, printer_id, printer_name, job_type, ref_type, ref_id, payload, status, max_attempts, last_error)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id,
    printer?.id ?? null,
    printer?.name ?? '',
    jobType,
    refType,
    refId,
    JSON.stringify(doc),
    status,
    maxAttempts,
    lastError
  )
  return { id, printer_id: printer?.id ?? null, printer_name: printer?.name ?? '', printer_type: printer?.type ?? 'none', status, job_type: jobType }
}

/** Build kitchen tickets: one per printer, from a list of new order items */
export async function enqueueKitchenTickets(
  db: D1Database,
  items: OrderItemRow[],
  ctx: { table_number: number; order_seq: number; order_id: string; check_id: string; note?: string }
): Promise<CreatedJob[]> {
  const [settings, messages, printers] = await Promise.all([
    getSettings(db),
    getMessages(db),
    all<Printer>(db, 'SELECT * FROM printers'),
  ])
  const pmap = new Map(printers.map((p) => [p.id, p]))
  const groups = new Map<string, OrderItemRow[]>()
  for (const it of items) {
    const key = it.printer_id === null ? 'none' : String(it.printer_id)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(it)
  }
  const maxAttempts = parseInt(settings.print_job_max_attempts || '5', 10) || 5
  const jobs: CreatedJob[] = []
  for (const [key, list] of groups) {
    const printer = key === 'none' ? null : pmap.get(parseInt(key, 10)) || null
    // Never send kitchen tickets to cashier printer even if misconfigured: still route to the category printer as configured.
    const lines: TicketLine[] = list.map((i) => ({ name: i.product_name, qty: i.qty, note: i.note || undefined }))
    const doc: TicketDoc = {
      kind: 'kitchen',
      title: printer?.name || 'قسم غير محدد',
      header: messages.kitchen_header || 'طلب جديد',
      store_name: settings.store_name || 'كزدورة',
      table_number: ctx.table_number,
      order_seq: ctx.order_seq,
      order_id: ctx.order_id,
      check_id: ctx.check_id,
      created_at: nowIso(),
      lines,
      footer: ctx.note || '',
      paper_width: printer?.paper_width || 80,
    }
    jobs.push(await enqueueJob(db, printer, 'kitchen', 'order', ctx.order_id, doc, maxAttempts))
  }
  return jobs
}

/** Build the cashier bill for a check and queue to the cashier printer */
export async function enqueueBill(db: D1Database, check: CheckRow, items: OrderItemRow[]): Promise<CreatedJob> {
  const [settings, messages, currencies] = await Promise.all([getSettings(db), getMessages(db), getCurrencies(db, true)])
  const cmap = currencyMap(currencies)
  const cur: Currency = cmap[check.currency_code] || currencies[0]
  const cashier = await first<Printer>(db, "SELECT * FROM printers WHERE role='cashier' AND is_active=1 ORDER BY sort_order, id LIMIT 1")
  const lines: TicketLine[] = aggregateLines(items).map((i) => ({
    name: i.product_name,
    qty: i.qty,
    unit_price: i.unit_price_base,
    line_total: roundMoney(i.unit_price_base * i.qty, cur.decimals),
  }))
  const secondary = settings.show_prices_in_secondary === '1'
    ? currencies.filter((c) => c.code !== cur.code).map((c) => ({ code: c.code, symbol: c.symbol, decimals: c.decimals, amount: convert(check.total, cur, c) }))
    : []
  const doc: TicketDoc = {
    kind: 'bill',
    title: 'فاتورة',
    header: messages.bill_header || '',
    footer: messages.bill_footer || '',
    store_name: settings.store_name || 'كزدورة',
    table_number: check.table_number,
    check_id: check.id,
    created_at: nowIso(),
    lines,
    currency: { code: cur.code, symbol: cur.symbol, decimals: cur.decimals },
    subtotal: check.subtotal,
    discount: check.discount,
    total: check.total,
    secondary_totals: secondary,
    paper_width: cashier?.paper_width || 80,
  }
  const maxAttempts = parseInt(settings.print_job_max_attempts || '5', 10) || 5
  return enqueueJob(db, cashier, 'bill', 'check', check.id, doc, maxAttempts)
}

export async function enqueueTest(db: D1Database, printer: Printer): Promise<CreatedJob> {
  const settings = await getSettings(db)
  const doc: TicketDoc = {
    kind: 'test',
    title: 'اختبار الطابعة',
    store_name: settings.store_name || 'كزدورة',
    created_at: nowIso(),
    lines: [{ name: printer.name, qty: 1 }, { name: `النوع: ${printer.type} — ${printer.host || ''}:${printer.port || ''}`, qty: 1 }],
    footer: 'إذا قرأت هذه الورقة فالطابعة تعمل بشكل صحيح',
    paper_width: printer.paper_width || 80,
  }
  return enqueueJob(db, printer, 'test', 'printer', String(printer.id), doc, 2)
}

/** Merge lines with same product+price into one line (for bills) */
export function aggregateLines(items: OrderItemRow[]) {
  const m = new Map<string, OrderItemRow & { qty: number }>()
  for (const it of items) {
    const k = `${it.product_id}|${it.product_name}|${it.unit_price_base}`
    const ex = m.get(k)
    if (ex) ex.qty += it.qty
    else m.set(k, { ...it })
  }
  return Array.from(m.values())
}
