#!/usr/bin/env node
/** Render sample tickets to PNG without a printer:  node preview.js [58|80] */
const fs = require('fs'); const path = require('path')
const { renderTicket, buildEscPos } = require('./ticket')
const w = Number(process.argv[2]) || 80
const now = new Date().toISOString()
const docs = {
  kitchen: { kind: 'kitchen', title: 'طابعة البار / المشروبات', header: 'طلب جديد', store_name: 'كزدورة', table_number: 5, order_seq: 1, created_at: now, paper_width: w,
    lines: [{ name: 'عصير برتقال', qty: 1 }, { name: 'قهوة', qty: 2, note: 'بدون سكر' }, { name: 'شاي أخضر بالنعناع الطازج مع عسل', qty: 1 }] },
  bill: { kind: 'bill', title: 'طابعة الكاشير', header: 'فاتورة', footer: 'شكراً لزيارتكم — كزدورة', store_name: 'كزدورة', table_number: 5, created_at: now, paper_width: w, check_id: 'chk_example123',
    currency: { code: 'USD', symbol: '$', decimals: 2 }, lines: [{ name: 'عصير برتقال', qty: 1, unit_price: 2.5, line_total: 2.5 }, { name: 'قهوة', qty: 1, unit_price: 1.5, line_total: 1.5 }, { name: 'فطيرة جبنة', qty: 1, unit_price: 2, line_total: 2 }],
    subtotal: 6, discount: 0.5, total: 5.5, secondary_totals: [{ code: 'TRY', symbol: '₺', amount: 183.33, decimals: 2 }] },
  test: { kind: 'test', title: 'طابعة الكاشير', header: 'اختبار الطابعة', footer: 'إذا قرأت هذه الورقة فالطابعة تعمل بشكل صحيح', store_name: 'كزدورة', created_at: now, paper_width: w, lines: [{ name: 'النوع: شبكة 192.168.1.203:9100', qty: 1 }] },
}
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true })
for (const [k, d] of Object.entries(docs)) {
  const { canvas, width, height } = renderTicket(d)
  fs.writeFileSync(path.join(out, `${k}-${w}.png`), canvas.toBuffer('image/png'))
  const bytes = buildEscPos(d, { beep: k === 'kitchen' })
  fs.writeFileSync(path.join(out, `${k}-${w}.bin`), bytes)
  console.log(`${k}: ${width}x${height}px, ${bytes.length} bytes → out/${k}-${w}.png`)
}
