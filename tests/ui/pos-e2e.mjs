import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1024, height: 768 } });
const p = await ctx.newPage();
const errs = [];
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { errs.push(m.text()); console.log('[console.' + m.type() + ']', m.text()); } });
p.on('pageerror', e => { errs.push(e.message); console.log('[pageerror]', e.message); });
const shot = (n) => p.screenshot({ path: `./tests/ui/shots/${n}.png` });
const api = async (path) => (await (await fetch(BASE + path)).json());

// reset any leftovers on table 5 via admin cancel
const login = await (await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'kazdoura2026' }) })).json();
const tok = login.token;
const tbls = (await api('/api/pos/tables')).tables;
const t5 = tbls.find(t => t.number === 5);
if (t5.current_check_id) await fetch(BASE + `/api/admin/checks/${t5.current_check_id}/cancel`, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: '{}' });
const jobsBefore = (await (await fetch(BASE + '/api/admin/print-jobs?limit=1', { headers: { authorization: 'Bearer ' + tok } })).json());
console.log('jobs before:', jobsBefore.jobs?.length, jobsBefore.jobs?.[0]?.id);

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.click('#table-5');
await p.waitForSelector('#products-grid .product-card');
await shot('e2e-1-order-empty');
// bar category active by default? click products by name
const clickProd = async (name) => { await p.click(`.product-card:has-text("${name}")`); };
await clickProd('عصير برتقال');
await clickProd('قهوة');
await p.click('.cat-tab:has-text("معجنات")');
await clickProd('فطيرة جبنة');
await shot('e2e-2-drafts');
await p.click('#btn-send');
await p.waitForSelector('.line.sent', { timeout: 15000 });
await p.waitForTimeout(1500);
await shot('e2e-3-sent');

// verify print jobs via admin API
const jobs = (await (await fetch(BASE + '/api/admin/print-jobs?limit=10', { headers: { authorization: 'Bearer ' + tok } })).json()).jobs;
const check = (await api('/api/pos/tables')).tables.find(t => t.number === 5);
console.log('table5 status:', check.status, 'check', check.current_check_id);
const mine = jobs.filter(j => j.ref_type === 'order' && j.created_at >= (jobsBefore.jobs?.[0]?.created_at || ''));
for (const j of mine) { const pl = (await api('/api/pos/print-jobs/' + j.id)).job.payload; console.log(' job', j.printer_name, j.job_type, j.status, '→', pl.lines.map(l => l.name + 'x' + l.qty).join(', ')); }

// bill
await p.click('#btn-bill');
await p.waitForSelector('#b-print');
await shot('e2e-4-bill');
await p.click('#b-print');
await p.waitForTimeout(2500);
await shot('e2e-5-bill-printed');
const st = (await api('/api/pos/tables')).tables.find(t => t.number === 5);
console.log('after print bill, table status:', st.status);
const jobs2 = (await (await fetch(BASE + '/api/admin/print-jobs?limit=5', { headers: { authorization: 'Bearer ' + tok } })).json()).jobs;
console.log(' latest job:', jobs2[0].printer_name, jobs2[0].job_type, jobs2[0].status);

// pay
await p.click('#b-pay');
await p.waitForSelector('#p-confirm');
await p.fill('#p-received', '10');
await p.waitForTimeout(300);
await shot('e2e-6-pay');
await p.click('#p-confirm');
await p.waitForSelector('#tables-grid', { timeout: 15000 });
await p.waitForTimeout(1200);
await shot('e2e-7-after-pay');
const st2 = (await api('/api/pos/tables')).tables.find(t => t.number === 5);
console.log('after pay, table status:', st2.status, 'check:', st2.current_check_id);
const sales = (await (await fetch(BASE + '/api/admin/sales?limit=1', { headers: { authorization: 'Bearer ' + tok } })).json());
console.log('latest sale:', sales.sales?.[0]?.table_number, sales.sales?.[0]?.total, sales.sales?.[0]?.change_given);

// iPad portrait / narrow
await p.setViewportSize({ width: 768, height: 1024 });
await p.click('#table-3');
await p.waitForSelector('#products-grid .product-card');
await shot('e2e-8-ipad-order');
await p.setViewportSize({ width: 1440, height: 900 });
await shot('e2e-9-laptop-order');
console.log('errors:', errs.length);
await b.close();
