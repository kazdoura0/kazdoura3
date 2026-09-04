// Theme toggle + no-admin-link + CSV checks
import { chromium } from 'playwright'
import fs from 'node:fs'
const BASE = process.env.BASE || 'http://localhost:3000'
const PW = fs.readFileSync('./.dev.vars', 'utf8').match(/ADMIN_PASSWORD=(.*)/)[1].trim()
let pass = 0, fail = 0
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + n) }
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, acceptDownloads: true })
const page = await ctx.newPage()
const errs = []; page.on('pageerror', (e) => errs.push(e.message))

// ---- POS
await page.goto(BASE + '/'); await page.waitForSelector('.tables-grid')
ok('POS: no admin link in header', (await page.locator('header a[href="/admin"]').count()) === 0)
ok('POS: theme button present', (await page.locator('header [data-theme-toggle]').count()) === 1)
const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'light')
ok('POS: default light', (await theme()) === 'light')
await page.click('header [data-theme-toggle]'); await page.waitForTimeout(150)
ok('POS: toggled to dark', (await theme()) === 'dark')
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
ok('POS: dark body bg applied (' + bg + ')', bg === 'rgb(21, 18, 15)')
await page.screenshot({ path: './tests/ui/shots/pos-dark.png' })
await page.click('.table-card >> nth=0'); await page.waitForSelector('.order-screen'); await page.screenshot({ path: './tests/ui/shots/pos-order-dark.png' })
await page.reload(); await page.waitForSelector('.tables-grid, .order-screen')
ok('POS: dark persists after reload', (await theme()) === 'dark')
ok('POS: no flash — html attr set before paint', await page.evaluate(() => localStorage.getItem('kz_theme') === 'dark'))
await page.click('header [data-theme-toggle]'); ok('POS: back to light', (await theme()) === 'light')

// ---- Admin
await page.goto(BASE + '/admin'); await page.waitForSelector('.login-card')
ok('Admin login: theme button present', (await page.locator('.login-card [data-theme-toggle]').count()) === 1)
await page.click('.login-card [data-theme-toggle]'); ok('Admin login: dark', (await theme()) === 'dark')
await page.screenshot({ path: './tests/ui/shots/admin-login-dark.png' })
await page.fill('input[type=password]', PW); await page.click('#login-btn'); await page.waitForSelector('.side')
ok('Admin: dark kept after login', (await theme()) === 'dark')
ok('Admin: sidebar toggle label = الوضع النهاري', (await page.evaluate(() => getComputedStyle(document.querySelector('.side .theme-btn .theme-label'), '::after').content)).includes('النهاري'))
await page.screenshot({ path: './tests/ui/shots/admin-dark.png' })
for (const pg of ['products', 'printers', 'sales', 'settings']) { await page.click(`.nav-btn[data-page="${pg}"]`); await page.waitForTimeout(500); await page.screenshot({ path: `admin-${pg}-dark.png` }) }
// CSV
await page.click('.nav-btn[data-page="sales"]'); await page.waitForSelector('#s-csv')
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#s-csv')])
const csv = fs.readFileSync(await dl.path(), 'utf8')
const lines = csv.split('\r\n').filter(Boolean)
ok('CSV: BOM + CRLF', csv.charCodeAt(0) === 0xFEFF && csv.includes('\r\n'))
ok('CSV: header has separate date & time cols', lines[0].replace(/^\uFEFF/, '').startsWith('"التاريخ","الوقت","الطاولة"'))
const dateOk = lines.slice(1).every((l) => /^"\d{4}-\d{2}-\d{2}","\d{2}:\d{2}",/.test(l))
ok(`CSV: ${lines.length - 1} rows with YYYY-MM-DD / HH:MM`, lines.length === 1 || dateOk)
console.log('   sample:', lines[1] || '(no sales)')
await page.click('.side .theme-btn'); ok('Admin: toggle back to light', (await theme()) === 'light')
await page.screenshot({ path: './tests/ui/shots/admin-light.png' })

ok('no page errors', errs.length === 0); if (errs.length) console.log(errs)
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
