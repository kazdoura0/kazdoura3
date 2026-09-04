// Admin panel browser test — Kazdoura
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://localhost:3000'
const PASS = 'kazdoura2026'
const errors = []
const fails = []
let n = 0
const ok = (name, cond, extra = '') => { n++; if (cond) console.log(`  ✓ ${name}`); else { fails.push(name); console.log(`  ✗ ${name} ${extra}`) } }

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-EG' })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
page.on('dialog', (d) => d.accept())

const shot = (name) => page.screenshot({ path: `./tests/ui/shots/admin-${name}.png`, fullPage: false })
const wait = (ms) => page.waitForTimeout(ms)

console.log('--- login')
await page.goto(BASE + '/admin')
await page.waitForSelector('#login-pass, .login-card input[type=password]', { timeout: 10000 })
const pwd = page.locator('input[type=password]').first()
await pwd.fill('wrong')
await page.locator('.login-card button[type=submit], .login-card button').first().click()
await wait(800)
ok('wrong password shows error', (await page.locator('.login-card').innerText()).length > 0 && !(await page.locator('.side').count()))
await pwd.fill(PASS)
await page.locator('.login-card button[type=submit], .login-card button').first().click()
await page.waitForSelector('.side', { timeout: 10000 })
ok('logged in, shell visible', await page.locator('.side .nav-btn').count() >= 10)
await shot('overview')

// visit every page
const pages = ['overview', 'products', 'categories', 'tables', 'printers', 'jobs', 'currencies', 'sales', 'messages', 'settings', 'audit']
for (const p of pages) {
  console.log('--- page', p)
  const before = errors.length
  await page.locator(`.nav-btn[data-page="${p}"]`).click()
  await wait(700)
  const txt = await page.locator('.content').innerText()
  ok(`page ${p} rendered`, txt.trim().length > 20 && errors.length === before, errors.slice(before).join(' | '))
  await shot(p)
}

// --- products: create with image
console.log('--- product create')
await page.locator('.nav-btn[data-page="products"]').click(); await wait(500)
const prodCountBefore = await page.locator('.content table tbody tr').count()
await page.locator('.content button:has-text("منتج جديد"), .content button:has-text("إضافة")').first().click()
await page.waitForSelector('.modal', { timeout: 5000 })
await page.locator('#f-name').fill('اختبار لاتيه')
await page.locator('#f-price').fill('3.5')
const desc = page.locator('#f-desc')
if (await desc.count()) await desc.first().fill('منتج تجريبي من اختبار المتصفح')
// image: build a tiny png
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8DwHwYYGBgY/gMAAAr8A/8Gz3+pAAAAAElFTkSuQmCC', 'base64')
const fileInput = page.locator('#f-file')
if (await fileInput.count()) await fileInput.setInputFiles({ name: 't.png', mimeType: 'image/png', buffer: png })
await wait(600)
await page.locator('#f-save').click()
await wait(1200)
const prodCountAfter = await page.locator('.content table tbody tr').count()
ok('product created', prodCountAfter === prodCountBefore + 1, `${prodCountBefore} -> ${prodCountAfter}`)
const rowTxt = await page.locator('.content').innerText().catch(() => '')
ok('new product in list', rowTxt.includes('اختبار لاتيه'), rowTxt.slice(0, 200).replace(/\s+/g, ' '))
const api = await page.evaluate(async () => (await fetch('/api/pos/bootstrap')).json())
const p = (api.products || []).find((x) => x.name === 'اختبار لاتيه')
ok('product visible in POS menu with image', !!p && (!p.image_url || p.image_url.startsWith('data:image')), JSON.stringify(p || {}).slice(0, 120))
await shot('products-after')

// toggle availability
const row = page.locator(`tr:has([data-avail="${p.id}"])`)
const sw = row.locator('label.switch').first()
if (await sw.count()) {
  await sw.click({ force: true }); await wait(800)
  const api2 = await page.evaluate(async () => (await fetch('/api/pos/bootstrap')).json())
  const p2 = (api2.products || []).find((x) => x.id === p.id)
  ok('availability toggle affects POS', !p2 || !p2.is_available, JSON.stringify(p2 || {}).slice(0, 100))
}

// --- printers: test print for cashier
console.log('--- printer test')
// switch cashier printer (id 3) to browser type for the test
const origPrinter = await page.evaluate(async () => {
  const h = { Authorization: 'Bearer ' + localStorage.getItem('kz_admin_token'), 'Content-Type': 'application/json' }
  const ov = await (await fetch('/api/admin/overview', { headers: h })).json()
  const p = ov.printers.find((x) => x.id === 3)
  await fetch('/api/admin/printers/3', { method: 'PUT', headers: h, body: JSON.stringify({ ...p, type: 'browser' }) })
  return p
})
await page.locator('.nav-btn[data-page="printers"]').click(); await wait(800)
const cards = await page.locator('.printer-card').count()
ok('printer cards shown', cards >= 3, String(cards))
const [popup] = await Promise.all([
  ctx.waitForEvent('page', { timeout: 6000 }).catch(() => null),
  page.locator('[data-test="3"]').click(),
])
await wait(1500)
let jobsRes = await page.evaluate(async () => (await fetch('/api/admin/print-jobs?limit=5', { headers: { Authorization: 'Bearer ' + localStorage.getItem('kz_admin_token') } })).json())
const testJob = (jobsRes.jobs || []).find((j) => j.job_type === 'test')
ok('test job created', !!testJob, JSON.stringify(jobsRes).slice(0, 150))
if (popup) {
  popup.on('console', (m) => { if (m.type() === 'error') errors.push('POPUP ' + m.text()) })
  await popup.waitForSelector('#ticket .store', { timeout: 8000 }).catch(() => {})
  await popup.screenshot({ path: './tests/ui/shots/admin-print-popup.png' })
  const t = await popup.locator('#ticket').innerText()
  ok('browser print page rendered ticket', t.includes('اختبار') || t.includes('كزدورة'), t.slice(0, 80))
  await popup.locator('#btn-done').click()
  await wait(1000)
  const j = await page.evaluate(async (id) => (await fetch('/api/pos/print-jobs/' + id)).json(), testJob.id)
  ok('browser-done marks job printed', j.job && j.job.status === 'printed', JSON.stringify(j.job && { status: j.job.status, t: j.job.printer_type }))
  await popup.close().catch(() => {})
} else {
  console.log('  (no popup — printer may be network type)')
}
await shot('printers')
await page.evaluate(async (p) => {
  const h = { Authorization: 'Bearer ' + localStorage.getItem('kz_admin_token'), 'Content-Type': 'application/json' }
  await fetch('/api/admin/printers/3', { method: 'PUT', headers: h, body: JSON.stringify(p) })
}, origPrinter)

// --- jobs page shows the job
await page.locator('.nav-btn[data-page="jobs"]').click(); await wait(700)
ok('jobs table has rows', (await page.locator('.content table tbody tr').count()) > 0)

// --- currencies: rate save
console.log('--- currencies')
await page.locator('.nav-btn[data-page="currencies"]').click(); await wait(600)
const rateInput = page.locator('input[data-rate]').first()
ok('rate inputs exist', (await rateInput.count()) > 0)
if (await rateInput.count()) {
  const code = await rateInput.getAttribute('data-rate')
  const old = await rateInput.inputValue()
  const newV = (Number(old) * 1.01).toFixed(4)
  await rateInput.fill(newV)
  const saveBtn = page.locator(`[data-save="${code}"]`).first()
  if (await saveBtn.count()) await saveBtn.click(); else await rateInput.press('Enter')
  await wait(1000)
  const cur = await page.evaluate(async () => (await fetch('/api/pos/bootstrap')).json())
  const c = (cur.currencies || []).find((x) => x.code === code)
  ok('rate persisted', c && Math.abs(c.rate_to_base - Number(newV)) < 1e-6, `${code} ${c && c.rate_to_base} vs ${newV}`)
  // restore
  await rateInput.fill(old)
  if (await saveBtn.count()) await saveBtn.click(); else await rateInput.press('Enter')
  await wait(600)
}

// --- sales detail
console.log('--- sales')
await page.locator('.nav-btn[data-page="sales"]').click(); await wait(800)
const saleRows = await page.locator('.content table tbody tr').count()
ok('sales rows present', saleRows > 0)
if (saleRows) {
  const btn = page.locator('[data-sale]').first()
  await btn.click(); await wait(800)
  const m = await page.locator('.modal').innerText().catch(() => '')
  ok('sale detail modal opens', m.length > 20, m.slice(0, 60))
  await shot('sale-detail')
  await page.keyboard.press('Escape'); await wait(300)
  const closeBtn = page.locator('.modal [data-close]').first()
  if (await closeBtn.count()) await closeBtn.click({ force: true }).catch(() => {})
}

// --- settings save
console.log('--- settings')
await page.locator('.nav-btn[data-page="settings"]').click(); await wait(600)
const sub = page.locator('#st-store_subtitle')
if (await sub.count()) {
  const old = await sub.inputValue()
  await sub.fill('اختبار متصفح')
  await page.locator('#st-save').first().click(); await wait(900)
  const s = await page.evaluate(async () => (await fetch('/api/admin/overview', { headers: { Authorization: 'Bearer ' + localStorage.getItem('kz_admin_token') } })).json())
  ok('settings saved', JSON.stringify(s).includes('اختبار متصفح'))
  await sub.fill(old); await page.locator('#st-save').first().click(); await wait(600)
}

// --- iPad width
console.log('--- ipad width')
await page.setViewportSize({ width: 768, height: 1024 })
await page.locator('.nav-btn[data-page="overview"]').click().catch(() => {})
await wait(500)
await shot('ipad-overview')
const topbar = await page.locator('.topbar-mobile').isVisible().catch(() => false)
ok('mobile topbar visible on iPad portrait', topbar)
if (topbar) {
  await page.locator('.topbar-mobile button').first().click(); await wait(400)
  ok('sidebar opens', await page.locator('.side.open').count() === 1)
  await page.locator('.side.open .nav-btn[data-page="products"]').click(); await wait(600)
  await shot('ipad-products')
}

// --- POS stale badge retest (1024 landscape)
console.log('--- POS stale badge')
await page.setViewportSize({ width: 1024, height: 768 })
await page.goto(BASE + '/'); await page.waitForSelector('#tables-grid .table-card, #tables-grid [data-table]', { timeout: 10000 })
await page.locator('#table-7').click(); await wait(600)
await page.locator('.cat-tab[data-cat]').first().click().catch(() => {})
await page.locator('.product-card[data-pid]').first().click(); await wait(200)
await page.locator('#btn-send').click(); await wait(1500)
const ps1 = await page.locator('#print-status').innerText().catch(() => '')
ok('print status shown for table 7', ps1.trim().length > 0, ps1)
await page.locator('#btn-back').click(); await wait(500)
await page.locator('#table-8').click(); await wait(600)
const ps2 = await page.locator('#print-status').innerText().catch(() => '')
ok('no stale print status on empty table 8', ps2.trim().length === 0, ps2)
await page.locator('#btn-back').click(); await wait(300)
// clean: cancel table 7 check via admin API
await page.evaluate(async () => {
  const h = { Authorization: 'Bearer ' + localStorage.getItem('kz_admin_token'), 'Content-Type': 'application/json' }
  const r = await (await fetch('/api/admin/checks/open', { headers: h })).json()
  for (const c of r.checks || []) if (c.table_number === 7) await fetch('/api/admin/checks/' + c.id + '/cancel', { method: 'POST', headers: h, body: JSON.stringify({ reason: 'test' }) })
})

await page.evaluate(async (id) => { await fetch('/api/admin/products/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + localStorage.getItem('kz_admin_token') } }) }, p.id)
console.log(`\n${n - fails.length}/${n} passed; console errors: ${errors.length}`)
if (errors.length) console.log(errors.slice(0, 10).join('\n'))
if (fails.length) console.log('FAILED:', fails.join(', '))
await browser.close()
process.exit(fails.length || errors.length ? 1 : 0)
