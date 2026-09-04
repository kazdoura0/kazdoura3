/**
 * Kazdoura Print Bridge — ticket renderer
 * Renders a TicketDoc (same JSON the server stores in print_jobs.payload) to a
 * monochrome bitmap via @napi-rs/canvas, then encodes it as ESC/POS raster
 * (GS v 0). Rendering to an image is the only reliable way to print shaped
 * Arabic text on ESC/POS printers regardless of the printer's code pages.
 */
'use strict'
const path = require('path')
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas')

// Bundled font (OFL) so results are identical on Windows / macOS / Linux
const FONT_DIR = path.join(__dirname, 'fonts')
try {
  GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoKufiArabic-Regular.ttf'), 'KZ')
  GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoKufiArabic-Bold.ttf'), 'KZ')
  // Latin digits / punctuation / currency symbols fallback (Kufi lacks ×, /, :, ₺ …)
  GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSans-Regular.ttf'), 'KZLatin')
  GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSans-Bold.ttf'), 'KZLatin')
} catch (e) {
  console.warn('[ticket] could not register bundled fonts:', e.message)
}
const FAMILY = '"KZ", "KZLatin", "Noto Kufi Arabic", "Noto Sans", "Segoe UI", "Arial", sans-serif'

const DOTS = { 58: 384, 80: 576 } // printable dots at 203 dpi

function money(amount, cur) {
  cur = cur || { symbol: '', decimals: 2, code: '' }
  const d = Math.max(0, Math.min(4, cur.decimals === undefined ? 2 : cur.decimals))
  const f = Math.pow(10, d)
  const v = (Math.round((Number(amount || 0) + Number.EPSILON) * f) / f).toFixed(d)
  return v + ' ' + (cur.symbol || cur.code || '')
}

function fmtDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (isNaN(d)) return iso
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Word-wrap a string to fit maxWidth using ctx.measureText */
function wrap(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w
    if (ctx.measureText(t).width <= maxWidth || !cur) cur = t
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

/**
 * Render doc → { canvas, width, height }
 * Layout is done in two passes: first measure (using a tall scratch canvas), then draw.
 */
function renderTicket(doc, opts = {}) {
  const width = DOTS[doc.paper_width] || DOTS[80]
  const pad = 8
  const inner = width - pad * 2
  const scale = width / 576 // font scale relative to 80mm
  const F = (px, bold) => `${bold ? 'bold ' : ''}${Math.round(px * scale)}px ${FAMILY}`

  // ---- pass 1: build a list of draw ops with heights
  const ops = []
  let y = pad
  const meas = createCanvas(width, 100).getContext('2d')

  const text = (str, { size = 26, bold = false, align = 'right', dir = 'rtl', gap = 6, x } = {}) => {
    meas.font = F(size, bold)
    const lineH = Math.round(size * scale * 1.45)
    for (const ln of wrap(meas, str, inner)) {
      ops.push({ t: 'text', s: ln, font: F(size, bold), align, dir, x, y })
      y += lineH
    }
    y += gap
  }
  const sep = (dashed = true, thick = 2) => { ops.push({ t: 'sep', dashed, thick, y: y + 4 }); y += 10 + thick }
  const row = (left, right, { size = 26, bold = false, gap = 4 } = {}) => {
    // right = Arabic label (RTL, right aligned), left = number (LTR, left aligned)
    meas.font = F(size, bold)
    const lineH = Math.round(size * scale * 1.45)
    ops.push({ t: 'text', s: right, font: F(size, bold), align: 'right', dir: 'rtl', y })
    ops.push({ t: 'text', s: left, font: F(size, bold), align: 'left', dir: 'ltr', y })
    y += lineH + gap
  }
  const lineItem = (qty, name, note, amount, { size = 28, bold = true } = {}) => {
    meas.font = F(size, bold)
    const lineH = Math.round(size * scale * 1.45)
    const qtyStr = `${qty} ×`
    const qtyW = Math.ceil(meas.measureText(qtyStr).width) + 12
    const amtW = amount ? Math.ceil(meas.measureText(amount).width) + 12 : 0
    const nameW = inner - qtyW - amtW
    const lines = wrap(meas, name, nameW)
    ops.push({ t: 'text', s: qtyStr, font: F(size, bold), align: 'right', dir: 'rtl', y })
    lines.forEach((ln, i) => ops.push({ t: 'text', s: ln, font: F(size, bold), align: 'right', dir: 'rtl', x: width - pad - qtyW, y: y + i * lineH }))
    if (amount) ops.push({ t: 'text', s: amount, font: F(size - 2, false), align: 'left', dir: 'ltr', y })
    y += lines.length * lineH
    if (note) {
      meas.font = F(size - 6, false)
      const nh = Math.round((size - 6) * scale * 1.4)
      for (const ln of wrap(meas, '- ' + note, nameW)) { ops.push({ t: 'text', s: ln, font: F(size - 6, false), align: 'right', dir: 'rtl', x: width - pad - qtyW, y }); y += nh }
    }
    y += 6
  }

  const cur = doc.currency || { symbol: '', decimals: 2 }
  text(doc.store_name || 'كزدورة', { size: 34, bold: true, align: 'center', gap: 2 })

  if (doc.kind === 'kitchen') {
    text(doc.title || '', { size: 26, bold: true, align: 'center', gap: 2 })
    sep(true, 3)
    text(doc.header || 'طلب جديد', { size: 38, bold: true, align: 'center', gap: 2 })
    sep(true, 3)
    row(`#${doc.order_seq || ''}`, `طاولة ${doc.table_number ?? ''}`, { size: 44, bold: true })
    text(fmtDateTime(doc.created_at), { size: 22, align: 'left', dir: 'ltr', gap: 2 })
    sep(true, 2)
    for (const l of doc.lines || []) lineItem(l.qty, l.name, l.note, null, { size: 32, bold: true })
    sep(true, 2)
    if (doc.footer) text(doc.footer, { size: 22, align: 'center' })
  } else if (doc.kind === 'bill') {
    text(doc.header || doc.title || 'فاتورة', { size: 28, bold: true, align: 'center', gap: 2 })
    row(fmtDateTime(doc.created_at), `طاولة ${doc.table_number ?? ''}`, { size: 30, bold: true })
    sep(true, 2)
    for (const l of doc.lines || []) {
      const amt = money(l.line_total !== undefined ? l.line_total : (l.unit_price || 0) * l.qty, cur)
      lineItem(l.qty, l.name, l.note, amt, { size: 26, bold: false })
    }
    sep(true, 2)
    if (doc.discount && doc.discount > 0) {
      row(money(doc.subtotal, cur), 'المجموع', { size: 26 })
      row('- ' + money(doc.discount, cur), 'خصم', { size: 26 })
    }
    sep(false, 3)
    row(money(doc.total !== undefined ? doc.total : doc.subtotal, cur), 'الإجمالي', { size: 36, bold: true })
    for (const s of doc.secondary_totals || []) row(money(s.amount, s), `~ ${s.code}`, { size: 24 })
    sep(true, 2)
    if (doc.footer) text(doc.footer, { size: 24, align: 'center' })
    if (doc.check_id) text(doc.check_id, { size: 16, align: 'center', dir: 'ltr', gap: 0 })
  } else {
    sep(true, 3)
    text(doc.header || 'اختبار طباعة', { size: 34, bold: true, align: 'center' })
    text(doc.title || '', { size: 26, align: 'center' })
    text(fmtDateTime(doc.created_at), { size: 22, align: 'center', dir: 'ltr' })
    sep(true, 2)
    for (const l of doc.lines || []) text(`${l.qty} × ${l.name}`, { size: 24 })
    sep(true, 2)
    if (doc.footer) text(doc.footer, { size: 22, align: 'center' })
  }
  y += pad

  // ---- pass 2: draw (height rounded up to multiple of 8 for raster encoding)
  const height = Math.ceil(y / 8) * 8
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#000'
  ctx.textBaseline = 'top'
  for (const op of ops) {
    if (op.t === 'sep') {
      ctx.fillStyle = '#000'
      if (op.dashed) { for (let x = pad; x < width - pad; x += 12) ctx.fillRect(x, op.y, 7, op.thick) }
      else ctx.fillRect(pad, op.y, inner, op.thick)
      continue
    }
    ctx.font = op.font
    ctx.direction = op.dir
    ctx.textAlign = op.align
    const x = op.x !== undefined ? op.x : op.align === 'right' ? width - pad : op.align === 'left' ? pad : width / 2
    ctx.fillText(op.s, x, op.y)
  }
  return { canvas, width, height }
}

/** Canvas → ESC/POS raster bytes (GS v 0), 1 = black */
function canvasToRaster(canvas, threshold = 160) {
  const { width, height } = canvas
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data
  const bytesPerRow = Math.ceil(width / 8)
  const bitmap = Buffer.alloc(bytesPerRow * height, 0)
  for (let yy = 0; yy < height; yy++) {
    for (let xx = 0; xx < width; xx++) {
      const i = (yy * width + xx) * 4
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
      if (lum < threshold) bitmap[yy * bytesPerRow + (xx >> 3)] |= 0x80 >> (xx & 7)
    }
  }
  const chunks = []
  // Some printers choke on very tall single raster commands → split into bands of 256 rows
  const BAND = 256
  for (let start = 0; start < height; start += BAND) {
    const rows = Math.min(BAND, height - start)
    const hdr = Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8])
    chunks.push(hdr, bitmap.subarray(start * bytesPerRow, (start + rows) * bytesPerRow))
  }
  return Buffer.concat(chunks)
}

const ESC = {
  init: Buffer.from([0x1b, 0x40]),
  alignCenter: Buffer.from([0x1b, 0x61, 0x01]),
  alignLeft: Buffer.from([0x1b, 0x61, 0x00]),
  feed: (n) => Buffer.from([0x1b, 0x64, n & 0xff]),
  cutFull: Buffer.from([0x1d, 0x56, 0x00]),
  cutPartial: Buffer.from([0x1d, 0x56, 0x01]),
  beep: Buffer.from([0x1b, 0x42, 0x02, 0x02]), // some kitchen printers support ESC B n t
  drawer: Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]),
}

/** Build the full ESC/POS byte stream for a job */
function buildEscPos(doc, opts = {}) {
  const { canvas } = renderTicket(doc, opts)
  const parts = [ESC.init, ESC.alignLeft, canvasToRaster(canvas), ESC.feed(opts.feedLines ?? 4)]
  if (opts.beep) parts.push(ESC.beep)
  parts.push(opts.partialCut ? ESC.cutPartial : ESC.cutFull)
  if (opts.openDrawer) parts.push(ESC.drawer)
  return Buffer.concat(parts)
}

module.exports = { renderTicket, canvasToRaster, buildEscPos, ESC, DOTS }
