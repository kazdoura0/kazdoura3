/* كزدورة — لوحة التحكم */
(function () {
  'use strict'
  const { api, esc, toast, modal, busy, money } = KZ
  const $ = (s, r) => (r || document).querySelector(s)
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s))

  const A = { page: localStorage.getItem('kz_admin_page') || 'overview', d: null, printJobs: [], sales: null }
  const PAGES = [
    { id: 'overview', icon: 'fa-gauge-high', label: 'نظرة عامة' },
    { id: 'products', icon: 'fa-mug-hot', label: 'المنتجات' },
    { id: 'categories', icon: 'fa-layer-group', label: 'الأقسام' },
    { id: 'tables', icon: 'fa-table-cells-large', label: 'الطاولات' },
    { id: 'printers', icon: 'fa-print', label: 'الطابعات' },
    { id: 'jobs', icon: 'fa-list-check', label: 'مهام الطباعة' },
    { id: 'currencies', icon: 'fa-coins', label: 'العملات والصرف' },
    { id: 'sales', icon: 'fa-chart-line', label: 'سجل المبيعات' },
    { id: 'messages', icon: 'fa-message', label: 'الرسائل' },
    { id: 'settings', icon: 'fa-sliders', label: 'الإعدادات' },
    { id: 'audit', icon: 'fa-clock-rotate-left', label: 'سجل النشاط' },
  ]

  const base = () => (A.d.currencies || []).find((c) => c.is_base) || { code: 'USD', symbol: '$', decimals: 2, rate_to_base: 1 }
  const curOf = (code) => (A.d.currencies || []).find((c) => c.code === code) || base()
  const printerName = (id) => { const p = (A.d.printers || []).find((x) => x.id === id); return p ? p.name : '—' }
  const catName = (id) => { const c = (A.d.categories || []).find((x) => x.id === id); return c ? c.name : 'بدون قسم' }
  const onoff = (v) => `<span class="badge ${v ? 'ok' : 'muted'}">${v ? 'مفعّل' : 'معطّل'}</span>`
  const sw = (id, checked, label) => `<label class="check-row"><span class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="sl"></span></span><span>${esc(label)}</span></label>`
  const field = (label, inner, cls) => `<div class="field ${cls || ''}"><label>${esc(label)}</label>${inner}</div>`
  const jobBadge = (s) => ({ pending: 'بالانتظار', printing: 'تُطبع', printed: 'طُبعت', failed: 'فشلت', cancelled: 'ألغيت' }[s] || s)
  const tableStatus = (s) => ({ empty: 'فارغة', occupied: 'عليها طلبات', billing: 'جاهزة للحساب', awaiting_payment: 'بانتظار الدفع' }[s] || s)

  // ---------- Boot / auth
  async function init() {
    if (KZ.token.get()) {
      try { await api('/api/admin/me'); await load(); renderShell(); return } catch (e) { if (e.code !== 'network') KZ.token.set('') }
    }
    renderLogin()
  }

  function renderLogin(err) {
    $('#app').innerHTML = `<div class="login-wrap"><form class="login-card" id="login-form" autocomplete="off">
      <div class="logo"><i class="fas fa-mug-hot"></i><div><h1>كزدورة</h1><p>لوحة التحكم</p></div></div>
      ${field('كلمة مرور المدير', '<input class="input" type="password" id="pwd" required autofocus autocomplete="current-password">')}
      ${err ? `<p class="small" style="color:var(--danger)">${esc(err)}</p>` : ''}
      <button class="btn primary lg block" id="login-btn" data-busy-text="جارٍ الدخول…"><i class="fas fa-right-to-bracket"></i> دخول</button>
      <div class="row" style="justify-content:space-between"><a class="btn ghost" href="/">الذهاب إلى نقطة البيع</a>${KZ.theme.button('btn ghost icon')}</div>
    </form></div>`
    KZ.theme.bind($('#app'))
    $('#login-form').addEventListener('submit', (e) => {
      e.preventDefault()
      busy($('#login-btn'), async () => {
        try {
          const r = await api('/api/admin/login', { method: 'POST', body: { password: $('#pwd').value }, auth: false })
          KZ.token.set(r.token)
          await load(); renderShell()
        } catch (err) { renderLogin(err.message) }
      })
    })
  }

  async function load() { A.d = await api('/api/admin/overview') }

  async function logout() {
    try { await api('/api/admin/logout', { method: 'POST' }) } catch (_) {}
    KZ.token.set(''); renderLogin()
  }

  // ---------- Shell
  function renderShell() {
    const st = A.d.stats
    $('#app').innerHTML = `<div class="admin-shell">
      <aside class="side" id="side">
        <div class="brand"><i class="fas fa-mug-hot"></i><div><strong>${esc(A.d.settings.store_name || 'كزدورة')}</strong><small>لوحة التحكم</small></div></div>
        ${PAGES.map((p) => `<button class="nav-btn ${A.page === p.id ? 'active' : ''}" data-page="${p.id}"><i class="fas ${p.icon}"></i>${p.label}${p.id === 'jobs' && st.failed_print_jobs ? `<span class="cnt">${st.failed_print_jobs}</span>` : ''}</button>`).join('')}
        <div class="spacer"></div>
        <div class="foot">
          <a class="nav-btn" href="/" target="_blank"><i class="fas fa-cash-register"></i>نقطة البيع</a>
          <button class="nav-btn theme-btn" type="button" data-theme-toggle><i class="fas fa-moon"></i><i class="fas fa-sun"></i><span class="theme-label"></span></button>
          <button class="nav-btn" id="btn-logout"><i class="fas fa-right-from-bracket"></i>تسجيل الخروج</button>
        </div>
      </aside>
      <div>
        <div class="topbar-mobile"><button class="btn icon" id="btn-menu"><i class="fas fa-bars"></i></button><strong>${esc(PAGES.find((p) => p.id === A.page)?.label || '')}</strong><span></span></div>
        <main class="content" id="content"></main>
      </div></div>`
    $$('.nav-btn[data-page]').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)))
    $('#btn-logout').addEventListener('click', logout)
    KZ.theme.bind($('#side'))
    $('#btn-menu').addEventListener('click', () => { $('#side').classList.add('open'); const bd = document.createElement('div'); bd.className = 'side-backdrop'; bd.addEventListener('click', () => { $('#side').classList.remove('open'); bd.remove() }); document.body.appendChild(bd) })
    renderPage()
  }

  async function go(page) {
    A.page = page
    localStorage.setItem('kz_admin_page', page)
    $$('.nav-btn[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page))
    $('#side').classList.remove('open'); $$('.side-backdrop').forEach((b) => b.remove())
    const tb = $('.topbar-mobile strong'); if (tb) tb.textContent = PAGES.find((p) => p.id === page)?.label || ''
    try { await load() } catch (e) { if (e.status === 401) return renderLogin('انتهت الجلسة، الرجاء الدخول مجدداً'); toast(e.message, 'error') }
    renderPage()
  }

  function renderPage() {
    const c = $('#content')
    c.innerHTML = ''
    const fn = { overview, products, categories, tables, printers, jobs, currencies, sales, messages, settings, audit }[A.page] || overview
    Promise.resolve(fn(c)).catch((e) => { toast(e.message, 'error'); if (e.status === 401) renderLogin('انتهت الجلسة') })
  }

  const head = (icon, title, actions) => `<header class="page-head"><h2><i class="fas ${icon}"></i>${esc(title)}</h2><div class="actions">${actions || ''}</div></header>`

  async function refreshAnd(fn) { await load(); renderPage(); if (fn) fn() }

  function handleErr(e) { toast(e.message, 'error'); if (e.status === 401) renderLogin('انتهت الجلسة') }

  // ---------- Overview
  async function overview(c) {
    const st = A.d.stats
    const b = base()
    const openChecks = (await api('/api/admin/checks/open')).checks
    const bridgeOn = st.bridge_last_seen && (Date.now() - new Date(st.bridge_last_seen.replace(' ', 'T') + 'Z').getTime()) < 60000
    c.innerHTML = head('fa-gauge-high', 'نظرة عامة', `<button class="btn" id="ov-refresh"><i class="fas fa-rotate"></i> تحديث</button>`) + `
      <div class="stats">
        <div class="stat ok"><i class="fas fa-sack-dollar"></i><div><div class="v">${money(st.today_sales_total, b)}</div><div class="l">مبيعات اليوم (${st.today_sales_count} فاتورة)</div></div></div>
        <div class="stat"><i class="fas fa-receipt"></i><div><div class="v">${st.open_checks}</div><div class="l">حسابات مفتوحة</div></div></div>
        <div class="stat ${st.pending_print_jobs ? 'warn' : ''}"><i class="fas fa-hourglass-half"></i><div><div class="v">${st.pending_print_jobs}</div><div class="l">مهام طباعة بالانتظار</div></div></div>
        <div class="stat ${st.failed_print_jobs ? 'danger' : ''}"><i class="fas fa-triangle-exclamation"></i><div><div class="v">${st.failed_print_jobs}</div><div class="l">مهام طباعة فاشلة</div></div></div>
        <div class="stat ${bridgeOn ? 'ok' : 'danger'}"><i class="fas fa-plug"></i><div><div class="v">${bridgeOn ? 'متصل' : 'غير متصل'}</div><div class="l">جسر الطباعة ${st.bridge_last_seen ? '· آخر اتصال ' + KZ.elapsed(st.bridge_last_seen) : ''}</div></div></div>
        <div class="stat"><i class="fas fa-mug-hot"></i><div><div class="v">${A.d.products.filter((p) => !p.is_deleted).length}</div><div class="l">منتج · ${A.d.categories.length} قسم · ${A.d.tables.filter((t) => t.is_active).length} طاولة</div></div></div>
      </div>
      <div class="grid-2">
        <section class="card"><h3><i class="fas fa-receipt"></i> الحسابات المفتوحة الآن</h3>
          ${openChecks.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>طاولة</th><th>الحالة</th><th>عناصر</th><th>الإجمالي</th><th>منذ</th><th></th></tr></thead><tbody>
          ${openChecks.map((k) => `<tr><td><strong>${k.table_number}</strong></td><td>${k.status === 'billing' ? 'بانتظار الدفع' : 'مفتوح'}</td><td class="num">${k.items}</td><td class="num">${money(k.total, b)}</td><td>${KZ.elapsed(k.opened_at)}</td>
            <td class="acts"><button class="btn sm outline-danger" data-cancel="${k.id}" data-t="${k.table_number}"><i class="fas fa-ban"></i> إلغاء</button></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty"><i class="fas fa-check"></i><p>لا توجد حسابات مفتوحة</p></div>'}
        </section>
        <section class="card"><h3><i class="fas fa-table-cells-large"></i> حالة الطاولات</h3>
          <div class="tables-admin">${A.d.tables.filter((t) => t.is_active).map((t) => `<div class="tcard"><div class="n">${t.number}</div><span class="badge st ${t.status === 'empty' ? 'muted' : t.status === 'awaiting_payment' ? 'ok' : 'warn'}">${tableStatus(t.status)}</span></div>`).join('')}</div>
        </section>
      </div>`
    $('#ov-refresh').addEventListener('click', () => go('overview'))
    $$('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await modal.confirm(`إلغاء حساب طاولة ${b.dataset.t}`, 'سيتم إلغاء جميع الطلبات غير المدفوعة وإعادة الطاولة إلى فارغة. لا يُسجَّل أي بيع.', { ok: 'إلغاء الحساب', danger: true }))) return
      try { await api('/api/admin/checks/' + b.dataset.cancel + '/cancel', { method: 'POST', body: { reason: 'admin' } }); toast('تم إلغاء الحساب', 'success'); go('overview') } catch (e) { handleErr(e) }
    }))
  }

  // ---------- Products
  async function products(c) {
    const list = A.d.products.filter((p) => !p.is_deleted)
    const cats = A.d.categories
    const filterCat = A.prodCat || ''
    const q = (A.prodQ || '').trim()
    const shown = list.filter((p) => (!filterCat || String(p.category_id) === filterCat) && (!q || p.name.includes(q)))
    c.innerHTML = head('fa-mug-hot', 'المنتجات', `<button class="btn primary" id="p-add"><i class="fas fa-plus"></i> منتج جديد</button>`) + `
      <div class="filters">
        ${field('بحث', `<input class="input" id="p-q" value="${esc(q)}" placeholder="اسم المنتج">`)}
        ${field('القسم', `<select class="input" id="p-cat"><option value="">كل الأقسام</option>${cats.map((k) => `<option value="${k.id}" ${filterCat === String(k.id) ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>`)}
        <span class="muted small">${shown.length} من ${list.length} منتج</span>
      </div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>المنتج</th><th>القسم</th><th>السعر</th><th>متاح</th><th>ترتيب</th><th></th></tr></thead><tbody id="p-body">
      ${shown.length ? shown.map((p) => `<tr data-id="${p.id}" class="${p.is_available ? '' : 'inactive'}">
        <td><div class="thumb">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : '<i class="fas fa-utensils"></i>'}</div></td>
        <td><strong>${esc(p.name)}</strong>${p.description ? `<div class="small muted">${esc(p.description)}</div>` : ''}</td>
        <td>${esc(catName(p.category_id))}</td>
        <td class="num">${money(p.price, curOf(p.currency_code))}</td>
        <td><label class="switch"><input type="checkbox" data-avail="${p.id}" ${p.is_available ? 'checked' : ''}><span class="sl"></span></label></td>
        <td class="num">${p.sort_order}</td>
        <td class="acts"><button class="btn sm" data-edit="${p.id}"><i class="fas fa-pen"></i></button><button class="btn sm outline-danger" data-del="${p.id}"><i class="fas fa-trash-can"></i></button></td>
      </tr>`).join('') : '<tr><td colspan="7"><div class="empty"><p>لا توجد منتجات</p></div></td></tr>'}
      </tbody></table></div>`
    $('#p-add').addEventListener('click', () => productForm())
    $('#p-q').addEventListener('input', KZ.debounce((e) => { A.prodQ = e.target.value; products(c); $('#p-q').focus(); $('#p-q').setSelectionRange(99, 99) }, 250))
    $('#p-cat').addEventListener('change', (e) => { A.prodCat = e.target.value; products(c) })
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => productForm(list.find((p) => p.id === +b.dataset.edit))))
    $$('[data-avail]').forEach((i) => i.addEventListener('change', async () => {
      try { await api('/api/admin/products/' + i.dataset.avail, { method: 'PUT', body: { is_available: i.checked } }); toast(i.checked ? 'المنتج متاح الآن' : 'تم إيقاف المنتج', 'success'); await load() } catch (e) { i.checked = !i.checked; handleErr(e) }
    }))
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const p = list.find((x) => x.id === +b.dataset.del)
      if (!(await modal.confirm('حذف المنتج', `هل تريد حذف "${p.name}"؟ لن يظهر في نقطة البيع، وتبقى المبيعات السابقة محفوظة.`, { ok: 'حذف', danger: true }))) return
      try { await api('/api/admin/products/' + p.id, { method: 'DELETE' }); toast('تم حذف المنتج', 'success'); refreshAnd() } catch (e) { handleErr(e) }
    }))
  }

  function productForm(p) {
    p = p || {}
    const cats = A.d.categories
    const curs = A.d.currencies.filter((x) => x.is_active || x.code === p.currency_code)
    const m = modal.open(`<header class="modal-head"><h3>${p.id ? 'تعديل منتج' : 'منتج جديد'}</h3><button class="btn icon sm ghost" data-close><i class="fas fa-xmark"></i></button></header>
      <form class="modal-body" id="pf"><div class="form-grid">
        ${field('اسم المنتج *', `<input class="input" id="f-name" required value="${esc(p.name || '')}">`, 'span2')}
        ${field('القسم *', `<select class="input" id="f-cat" required>${cats.map((k) => `<option value="${k.id}" ${p.category_id === k.id ? 'selected' : ''}>${esc(k.name)} → ${esc(printerName(k.printer_id))}</option>`).join('')}</select>`, 'span2')}
        ${field('السعر *', `<input class="input" id="f-price" type="number" step="any" min="0" required value="${p.price ?? ''}">`)}
        ${field('العملة', `<select class="input" id="f-cur">${curs.map((x) => `<option value="${x.code}" ${(p.currency_code || base().code) === x.code ? 'selected' : ''}>${esc(x.name)} (${esc(x.symbol)})</option>`).join('')}</select>`)}
        ${field('الوصف', `<textarea class="input" id="f-desc" rows="2">${esc(p.description || '')}</textarea>`, 'span2')}
        <div class="span2"><label class="small muted">الصورة</label><div class="img-pick"><div class="preview" id="f-prev">${p.image_url ? `<img src="${esc(p.image_url)}">` : '<i class="fas fa-image fa-2x"></i>'}</div>
          <div style="display:grid;gap:6px"><input type="file" id="f-file" accept="image/*" hidden><button type="button" class="btn sm" id="f-pick"><i class="fas fa-upload"></i> اختيار صورة</button><button type="button" class="btn sm ghost" id="f-clear">إزالة</button><span class="small muted">تُضغط تلقائياً (≤ 600px)</span></div></div></div>
        ${field('ترتيب العرض', `<input class="input" id="f-sort" type="number" value="${p.sort_order ?? 99}">`)}
        <div class="field"><label>&nbsp;</label>${sw('f-avail', p.is_available === undefined ? true : !!p.is_available, 'متاح للبيع')}</div>
      </div></form>
      <footer class="modal-foot"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="f-save" data-busy-text="جارٍ الحفظ…"><i class="fas fa-check"></i> حفظ</button></footer>`, { size: 'lg', sticky: true })
    let image = p.image_url || ''
    $('#f-pick', m).addEventListener('click', () => $('#f-file', m).click())
    $('#f-clear', m).addEventListener('click', () => { image = ''; $('#f-prev', m).innerHTML = '<i class="fas fa-image fa-2x"></i>' })
    $('#f-file', m).addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return
      try { image = await compressImage(f, 600, 0.82); $('#f-prev', m).innerHTML = `<img src="${image}">` } catch (err) { toast('تعذر قراءة الصورة', 'error') }
    })
    const save = () => busy($('#f-save', m), async () => {
      const form = $('#pf', m); if (!form.reportValidity()) return
      const body = { name: $('#f-name', m).value.trim(), category_id: +$('#f-cat', m).value, price: +$('#f-price', m).value, currency_code: $('#f-cur', m).value, description: $('#f-desc', m).value.trim(), image_url: image, sort_order: +$('#f-sort', m).value || 99, is_available: $('#f-avail', m).checked }
      try {
        if (p.id) await api('/api/admin/products/' + p.id, { method: 'PUT', body }); else await api('/api/admin/products', { method: 'POST', body })
        modal.close(); toast('تم حفظ المنتج', 'success'); refreshAnd()
      } catch (e) { handleErr(e) }
    })
    $('#f-save', m).addEventListener('click', save)
    $('#pf', m).addEventListener('submit', (e) => { e.preventDefault(); save() })
  }

  function compressImage(file, max, q) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height))
        const cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s)
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
        URL.revokeObjectURL(url)
        resolve(cv.toDataURL('image/jpeg', q))
      }
      img.onerror = reject
      img.src = url
    })
  }

  // ---------- Categories
  async function categories(c) {
    const cats = A.d.categories
    const countBy = (id) => A.d.products.filter((p) => !p.is_deleted && p.category_id === id).length
    c.innerHTML = head('fa-layer-group', 'الأقسام', `<button class="btn primary" id="c-add"><i class="fas fa-plus"></i> قسم جديد</button>`) + `
      <p class="muted small" style="margin-bottom:12px">كل قسم مرتبط بطابعة واحدة — عند إرسال الطلب تُطبع عناصر القسم على طابعته تلقائياً.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>القسم</th><th>الطابعة</th><th>المنتجات</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${cats.map((k, i) => `<tr class="${k.is_active ? '' : 'inactive'}"><td class="num">${i + 1}</td><td><i class="fas ${esc(k.icon || 'fa-tag')}" style="color:var(--brand);width:22px"></i> <strong>${esc(k.name)}</strong></td>
        <td>${k.printer_id ? esc(printerName(k.printer_id)) : '<span class="badge danger">بدون طابعة</span>'}</td><td class="num">${countBy(k.id)}</td><td>${onoff(k.is_active)}</td>
        <td class="acts"><button class="btn sm" data-up="${k.id}" ${i === 0 ? 'disabled' : ''}><i class="fas fa-arrow-up"></i></button><button class="btn sm" data-down="${k.id}" ${i === cats.length - 1 ? 'disabled' : ''}><i class="fas fa-arrow-down"></i></button><button class="btn sm" data-edit="${k.id}"><i class="fas fa-pen"></i></button><button class="btn sm outline-danger" data-del="${k.id}"><i class="fas fa-trash-can"></i></button></td></tr>`).join('')}
      </tbody></table></div>`
    $('#c-add').addEventListener('click', () => categoryForm())
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => categoryForm(cats.find((k) => k.id === +b.dataset.edit))))
    const reorder = async (id, dir) => {
      const ids = cats.map((k) => k.id); const i = ids.indexOf(id); const j = i + dir
      if (j < 0 || j >= ids.length) return
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
      try { await api('/api/admin/categories/reorder', { method: 'POST', body: { ids } }); refreshAnd() } catch (e) { handleErr(e) }
    }
    $$('[data-up]').forEach((b) => b.addEventListener('click', () => reorder(+b.dataset.up, -1)))
    $$('[data-down]').forEach((b) => b.addEventListener('click', () => reorder(+b.dataset.down, 1)))
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const k = cats.find((x) => x.id === +b.dataset.del)
      if (!(await modal.confirm('حذف القسم', `حذف "${k.name}"؟ يجب أن يكون القسم خالياً من المنتجات.`, { ok: 'حذف', danger: true }))) return
      try { await api('/api/admin/categories/' + k.id, { method: 'DELETE' }); toast('تم حذف القسم', 'success'); refreshAnd() } catch (e) { handleErr(e) }
    }))
  }

  function categoryForm(k) {
    k = k || {}
    const icons = ['fa-mug-hot', 'fa-bread-slice', 'fa-pizza-slice', 'fa-ice-cream', 'fa-burger', 'fa-cookie-bite', 'fa-wine-glass', 'fa-bowl-food', 'fa-cake-candles', 'fa-leaf', 'fa-tag']
    const m = modal.open(`<header class="modal-head"><h3>${k.id ? 'تعديل قسم' : 'قسم جديد'}</h3><button class="btn icon sm ghost" data-close><i class="fas fa-xmark"></i></button></header>
      <form class="modal-body" id="cf"><div class="form-grid">
        ${field('اسم القسم *', `<input class="input" id="c-name" required value="${esc(k.name || '')}">`, 'span2')}
        ${field('الطابعة *', `<select class="input" id="c-printer" required><option value="">— اختر —</option>${A.d.printers.map((p) => `<option value="${p.id}" ${k.printer_id === p.id ? 'selected' : ''}>${esc(p.name)}${p.is_active ? '' : ' (معطّلة)'}</option>`).join('')}</select>`, 'span2')}
        ${field('الأيقونة', `<select class="input" id="c-icon">${icons.map((ic) => `<option value="${ic}" ${(k.icon || 'fa-tag') === ic ? 'selected' : ''}>${ic.replace('fa-', '')}</option>`).join('')}</select>`)}
        <div class="field"><label>&nbsp;</label>${sw('c-active', k.is_active === undefined ? true : !!k.is_active, 'مفعّل')}</div>
      </div></form>
      <footer class="modal-foot"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="c-save" data-busy-text="جارٍ الحفظ…"><i class="fas fa-check"></i> حفظ</button></footer>`, { sticky: true })
    const save = () => busy($('#c-save', m), async () => {
      if (!$('#cf', m).reportValidity()) return
      const body = { name: $('#c-name', m).value.trim(), printer_id: +$('#c-printer', m).value || null, icon: $('#c-icon', m).value, is_active: $('#c-active', m).checked }
      try {
        if (k.id) await api('/api/admin/categories/' + k.id, { method: 'PUT', body }); else await api('/api/admin/categories', { method: 'POST', body })
        modal.close(); toast('تم حفظ القسم', 'success'); refreshAnd()
      } catch (e) { handleErr(e) }
    })
    $('#c-save', m).addEventListener('click', save)
    $('#cf', m).addEventListener('submit', (e) => { e.preventDefault(); save() })
  }

  // ---------- Tables
  async function tables(c) {
    const list = A.d.tables
    const active = list.filter((t) => t.is_active)
    c.innerHTML = head('fa-table-cells-large', 'الطاولات', `<button class="btn" id="t-count"><i class="fas fa-hashtag"></i> تحديد عدد الطاولات</button><button class="btn primary" id="t-add"><i class="fas fa-plus"></i> طاولة</button>`) + `
      <p class="muted small" style="margin-bottom:12px">${active.length} طاولة مفعّلة. لا يمكن تعطيل أو حذف طاولة عليها حساب مفتوح.</p>
      <div class="tables-admin">${list.map((t) => `<div class="tcard ${t.is_active ? '' : 'inactive'}">
        <div class="n">${t.number}</div>${t.label ? `<div class="small">${esc(t.label)}</div>` : ''}
        <span class="badge st ${t.status === 'empty' ? 'muted' : 'warn'}">${t.is_active ? tableStatus(t.status) : 'معطّلة'}</span>
        <div class="acts"><button class="btn sm" data-edit="${t.id}"><i class="fas fa-pen"></i></button>
          <button class="btn sm ${t.is_active ? 'outline-danger' : 'success'}" data-toggle="${t.id}" title="${t.is_active ? 'تعطيل' : 'تفعيل'}"><i class="fas ${t.is_active ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
          <button class="btn sm outline-danger" data-del="${t.id}"><i class="fas fa-trash-can"></i></button></div>
      </div>`).join('')}</div>`
    $('#t-count').addEventListener('click', () => {
      const m = modal.open(`<header class="modal-head"><h3>عدد الطاولات</h3></header><section class="modal-body">${field('العدد الكلي للطاولات (1 – 200)', `<input class="input" id="tc" type="number" min="1" max="200" value="${active.length}">`)}<p class="small muted">سيتم إنشاء الطاولات الناقصة وتعطيل الزائدة.</p></section>
        <footer class="modal-foot"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="tc-ok">تطبيق</button></footer>`)
      $('#tc-ok', m).addEventListener('click', () => busy($('#tc-ok', m), async () => {
        try { await api('/api/admin/tables', { method: 'POST', body: { count: +$('#tc', m).value } }); modal.close(); toast('تم تحديث الطاولات', 'success'); refreshAnd() } catch (e) { handleErr(e) }
      }))
    })
    $('#t-add').addEventListener('click', () => tableForm())
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => tableForm(list.find((t) => t.id === +b.dataset.edit))))
    $$('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const t = list.find((x) => x.id === +b.dataset.toggle)
      try { await api('/api/admin/tables/' + t.id, { method: 'PUT', body: { is_active: !t.is_active } }); refreshAnd() } catch (e) { handleErr(e) }
    }))
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const t = list.find((x) => x.id === +b.dataset.del)
      if (!(await modal.confirm('حذف الطاولة', `حذف طاولة ${t.number}؟`, { ok: 'حذف', danger: true }))) return
      try { await api('/api/admin/tables/' + t.id, { method: 'DELETE' }); toast('تم', 'success'); refreshAnd() } catch (e) { handleErr(e) }
    }))
  }

  function tableForm(t) {
    t = t || {}
    const m = modal.open(`<header class="modal-head"><h3>${t.id ? 'تعديل طاولة' : 'طاولة جديدة'}</h3><button class="btn icon sm ghost" data-close><i class="fas fa-xmark"></i></button></header>
      <form class="modal-body" id="tf"><div class="form-grid">
        ${field('رقم الطاولة *', `<input class="input" id="t-num" type="number" min="1" required value="${t.number || ''}">`)}
        ${field('عدد المقاعد', `<input class="input" id="t-seats" type="number" min="1" value="${t.seats || 4}">`)}
        ${field('تسمية (اختياري)', `<input class="input" id="t-label" value="${esc(t.label || '')}" placeholder="مثال: تراس، VIP">`, 'span2')}
      </div></form>
      <footer class="modal-foot"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="t-save"><i class="fas fa-check"></i> حفظ</button></footer>`, { sticky: true })
    const save = () => busy($('#t-save', m), async () => {
      if (!$('#tf', m).reportValidity()) return
      const body = { number: +$('#t-num', m).value, seats: +$('#t-seats', m).value || 4, label: $('#t-label', m).value.trim() }
      try {
        if (t.id) await api('/api/admin/tables/' + t.id, { method: 'PUT', body }); else await api('/api/admin/tables', { method: 'POST', body })
        modal.close(); toast('تم حفظ الطاولة', 'success'); refreshAnd()
      } catch (e) { handleErr(e) }
    })
    $('#t-save', m).addEventListener('click', save)
    $('#tf', m).addEventListener('submit', (e) => { e.preventDefault(); save() })
  }

  // ---------- Printers
  async function printers(c) {
    const st = A.d.stats
    const bridgeOn = st.bridge_last_seen && (Date.now() - new Date(st.bridge_last_seen.replace(' ', 'T') + 'Z').getTime()) < 60000
    const origin = location.origin
    c.innerHTML = head('fa-print', 'الطابعات', `<button class="btn primary" id="pr-add"><i class="fas fa-plus"></i> طابعة</button>`) + `
      <div class="bridge-box ${bridgeOn ? 'on' : ''}"><span class="dot"></span><div class="grow"><strong>جسر الطباعة (Print Bridge)</strong>
        <div class="small muted">${bridgeOn ? `متصل — ${esc(st.bridge_agent || '')} · آخر إشارة ${KZ.elapsed(st.bridge_last_seen)}` : st.bridge_last_seen ? `غير متصل — آخر إشارة ${KZ.fmtDateTime(st.bridge_last_seen)}` : 'لم يتصل بعد. شغّل البرنامج على جهاز الكاشير المتصل بشبكة الطابعات.'}</div></div>
        <button class="btn sm" id="pr-help"><i class="fas fa-circle-question"></i> طريقة التشغيل</button>
        <pre id="pr-cmd" class="hidden">cd bridge
npm install
set KZ_SERVER=${origin}
set KZ_BRIDGE_TOKEN=&lt;BRIDGE_TOKEN&gt;
node agent.js</pre></div>
      <div class="printer-cards">${A.d.printers.map((p) => `<article class="printer-card ${p.is_active ? p.last_status : ''}">
        <div class="ph"><div><h4>${esc(p.name)}</h4><span class="badge ${p.role === 'cashier' ? 'ok' : 'info'}">${p.role === 'cashier' ? 'كاشير (فواتير)' : 'مطبخ (طلبات)'}</span> ${onoff(p.is_active)}</div>
          <span class="badge ${p.last_status === 'online' ? 'ok' : p.last_status === 'unknown' ? 'muted' : 'danger'}">${{ online: 'متصلة', offline: 'غير متصلة', error: 'خطأ', unknown: 'غير معروف' }[p.last_status] || p.last_status}</span></div>
        <div class="meta">
          <div>النوع: ${p.type === 'network' ? `شبكة (ESC/POS) <code>${esc(p.host)}:${p.port}</code>` : 'طباعة عبر المتصفح'}</div>
          <div>عرض الورق: ${p.paper_width} مم</div>
          ${p.last_seen_at ? `<div class="small muted">آخر فحص: ${KZ.fmtDateTime(p.last_seen_at)}</div>` : ''}
          ${p.last_error ? `<div class="small" style="color:var(--danger)">${esc(p.last_error)}</div>` : ''}
        </div>
        <div class="pf"><button class="btn sm accent" data-test="${p.id}"><i class="fas fa-vial"></i> طباعة تجريبية</button><button class="btn sm" data-edit="${p.id}"><i class="fas fa-pen"></i> تعديل</button><button class="btn sm outline-danger" data-del="${p.id}"><i class="fas fa-trash-can"></i></button></div>
      </article>`).join('')}</div>`
    $('#pr-help').addEventListener('click', () => $('#pr-cmd').classList.toggle('hidden'))
    $('#pr-add').addEventListener('click', () => printerForm())
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => printerForm(A.d.printers.find((p) => p.id === +b.dataset.edit))))
    $$('[data-test]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      try {
        const r = await api('/api/admin/printers/' + b.dataset.test + '/test', { method: 'POST' })
        const p = A.d.printers.find((x) => x.id === +b.dataset.test)
        if (p.type === 'browser') window.open('/print/job/' + r.print_job.id, '_blank', 'width=420,height=700')
        if (r.print_job.status === 'failed') toast(r.print_job.last_error || 'فشل إنشاء مهمة الطباعة', 'error')
        else { toast('أُرسلت صفحة تجريبية — تابع الحالة في مهام الطباعة', 'success'); watchJob(r.print_job.id) }
      } catch (e) { handleErr(e) }
    })))
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const p = A.d.printers.find((x) => x.id === +b.dataset.del)
      if (!(await modal.confirm('حذف الطابعة', `حذف "${p.name}"؟ يجب ألا تكون مرتبطة بأي قسم.`, { ok: 'حذف', danger: true }))) return
      try { await api('/api/admin/printers/' + p.id, { method: 'DELETE' }); toast('تم حذف الطابعة', 'success'); refreshAnd() } catch (e) { handleErr(e) }
    }))
  }

  async function watchJob(id) {
    for (let i = 0; i < 20; i++) {
      await KZ.sleep(2500)
      try {
        const r = await api('/api/pos/print-jobs/' + id, { auth: false })
        if (r.job.status === 'printed') { toast('تمت الطباعة التجريبية بنجاح ✓', 'success'); if (A.page === 'printers') go('printers'); return }
        if (r.job.status === 'failed') { toast('فشلت الطباعة: ' + (r.job.last_error || ''), 'error', 6000); if (A.page === 'printers') go('printers'); return }
      } catch (_) {}
    }
  }

  function printerForm(p) {
    p = p || {}
    const m = modal.open(`<header class="modal-head"><h3>${p.id ? 'تعديل طابعة' : 'طابعة جديدة'}</h3><button class="btn icon sm ghost" data-close><i class="fas fa-xmark"></i></button></header>
      <form class="modal-body" id="prf"><div class="form-grid">
        ${field('اسم الطابعة *', `<input class="input" id="pr-name" required value="${esc(p.name || '')}" placeholder="مثال: طابعة البار">`, 'span2')}
        ${field('الدور', `<select class="input" id="pr-role"><option value="kitchen" ${p.role !== 'cashier' ? 'selected' : ''}>مطبخ — تستقبل طلبات الأقسام</option><option value="cashier" ${p.role === 'cashier' ? 'selected' : ''}>كاشير — تستقبل الفواتير فقط</option></select>`, 'span2')}
        ${field('النوع', `<select class="input" id="pr-type"><option value="network" ${p.type !== 'browser' ? 'selected' : ''}>شبكة ESC/POS (عبر جسر الطباعة)</option><option value="browser" ${p.type === 'browser' ? 'selected' : ''}>متصفح (نافذة طباعة)</option></select>`)}
        ${field('عرض الورق', `<select class="input" id="pr-paper"><option value="80" ${(p.paper_width || 80) == 80 ? 'selected' : ''}>80 مم</option><option value="58" ${p.paper_width == 58 ? 'selected' : ''}>58 مم</option></select>`)}
        <div id="net-fields" class="span2 form-grid" style="grid-column:span 2">
          ${field('عنوان IP *', `<input class="input" id="pr-host" dir="ltr" value="${esc(p.host || '')}" placeholder="192.168.1.201">`)}
          ${field('المنفذ', `<input class="input" id="pr-port" dir="ltr" type="number" value="${p.port || 9100}">`)}
        </div>
        <div class="field span2">${sw('pr-active', p.is_active === undefined ? true : !!p.is_active, 'مفعّلة')}</div>
      </div></form>
      <footer class="modal-foot"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="pr-save"><i class="fas fa-check"></i> حفظ</button></footer>`, { size: 'lg', sticky: true })
    const typeSel = $('#pr-type', m)
    const upd = () => $('#net-fields', m).classList.toggle('hidden', typeSel.value !== 'network')
    typeSel.addEventListener('change', upd); upd()
    const save = () => busy($('#pr-save', m), async () => {
      if (!$('#prf', m).reportValidity()) return
      const body = { name: $('#pr-name', m).value.trim(), role: $('#pr-role', m).value, type: typeSel.value, paper_width: +$('#pr-paper', m).value, host: $('#pr-host', m).value.trim(), port: +$('#pr-port', m).value || 9100, is_active: $('#pr-active', m).checked }
      if (body.type === 'network' && !/^[\w.\-]+$/.test(body.host)) return toast('أدخل عنوان IP صالحاً للطابعة', 'error')
      try {
        if (p.id) await api('/api/admin/printers/' + p.id, { method: 'PUT', body }); else await api('/api/admin/printers', { method: 'POST', body })
        modal.close(); toast('تم حفظ الطابعة', 'success'); refreshAnd()
      } catch (e) { handleErr(e) }
    })
    $('#pr-save', m).addEventListener('click', save)
    $('#prf', m).addEventListener('submit', (e) => { e.preventDefault(); save() })
  }

  // ---------- Print jobs
  async function jobs(c) {
    const status = A.jobStatus || ''
    const r = await api('/api/admin/print-jobs?limit=150' + (status ? '&status=' + status : ''))
    const list = r.jobs
    c.innerHTML = head('fa-list-check', 'مهام الطباعة', `<button class="btn" id="j-refresh"><i class="fas fa-rotate"></i> تحديث</button>`) + `
      <div class="filters">${field('الحالة', `<select class="input" id="j-status"><option value="">الكل</option>${['pending', 'printing', 'printed', 'failed', 'cancelled'].map((s) => `<option value="${s}" ${status === s ? 'selected' : ''}>${jobBadge(s)}</option>`).join('')}</select>`)}
        ${list.some((j) => j.status === 'failed') ? `<button class="btn accent" id="j-retry-all"><i class="fas fa-rotate-right"></i> إعادة كل الفاشلة</button>` : ''}
        <span class="muted small">${list.length} مهمة</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الوقت</th><th>الطابعة</th><th>النوع</th><th>الحالة</th><th>محاولات</th><th>الخطأ</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((j) => `<tr><td class="small">${KZ.fmtDateTime(j.created_at)}</td><td>${esc(j.printer_name)}</td><td>${{ kitchen: 'طلب مطبخ', bill: 'فاتورة', test: 'تجريبي' }[j.job_type] || j.job_type}</td>
        <td><span class="badge status-${j.status}">${jobBadge(j.status)}</span></td><td class="num">${j.attempts}/${j.max_attempts}</td><td class="small" style="color:var(--danger);max-width:260px">${esc(j.last_error || '')}</td>
        <td class="acts"><button class="btn sm" data-view="${j.id}" title="عرض"><i class="fas fa-eye"></i></button>${j.status === 'failed' || j.status === 'cancelled' ? `<button class="btn sm accent" data-retry="${j.id}"><i class="fas fa-rotate-right"></i></button>` : ''}${['pending', 'failed', 'printing'].includes(j.status) ? `<button class="btn sm outline-danger" data-cancel="${j.id}"><i class="fas fa-ban"></i></button>` : ''}</td></tr>`).join('') : '<tr><td colspan="7"><div class="empty"><p>لا توجد مهام</p></div></td></tr>'}
      </tbody></table></div>`
    $('#j-refresh').addEventListener('click', () => jobs(c))
    $('#j-status').addEventListener('change', (e) => { A.jobStatus = e.target.value; jobs(c) })
    const retry = async (id) => { await api('/api/admin/print-jobs/' + id + '/retry', { method: 'POST' }) }
    $$('[data-retry]').forEach((b) => b.addEventListener('click', async () => { try { await retry(b.dataset.retry); toast('أُعيدت المهمة إلى قائمة الانتظار', 'success'); jobs(c) } catch (e) { handleErr(e) } }))
    const ra = $('#j-retry-all'); if (ra) ra.addEventListener('click', () => busy(ra, async () => { try { for (const j of list.filter((x) => x.status === 'failed')) await retry(j.id); toast('تمت إعادة كل المهام الفاشلة', 'success'); jobs(c) } catch (e) { handleErr(e) } }))
    $$('[data-cancel]').forEach((b) => b.addEventListener('click', async () => { try { await api('/api/admin/print-jobs/' + b.dataset.cancel + '/cancel', { method: 'POST' }); jobs(c) } catch (e) { handleErr(e) } }))
    $$('[data-view]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await api('/api/pos/print-jobs/' + b.dataset.view, { auth: false })
        const d = r.job.payload
        modal.open(`<header class="modal-head"><h3>${esc(d.title || 'تذكرة')}</h3><button class="btn icon sm ghost" data-close><i class="fas fa-xmark"></i></button></header><section class="modal-body">
          <div class="small muted">${esc(r.job.printer_name)} · ${KZ.fmtDateTime(r.job.created_at)}${d.table_number ? ' · طاولة ' + d.table_number : ''}</div>
          <table class="tbl" style="margin-top:10px"><tbody>${(d.lines || []).map((l) => `<tr><td>${esc(l.name)}${l.note ? `<div class="small muted">${esc(l.note)}</div>` : ''}</td><td class="num">× ${l.qty}</td>${l.line_total !== undefined ? `<td class="num">${money(l.line_total, d.currency)}</td>` : ''}</tr>`).join('')}</tbody></table>
          ${d.total !== undefined ? `<p style="text-align:end;font-weight:800;font-size:18px;margin-top:8px">الإجمالي: ${money(d.total, d.currency)}</p>` : ''}
          ${r.job.printer_type === 'browser' && r.job.status !== 'printed' ? `<a class="btn accent block" style="margin-top:12px" target="_blank" href="/print/job/${r.job.id}"><i class="fas fa-print"></i> فتح صفحة الطباعة</a>` : ''}
        </section>`)
      } catch (e) { handleErr(e) }
    }))
  }

  // ---------- Currencies
  async function currencies(c) {
    const list = A.d.currencies
    const b = base()
    c.innerHTML = head('fa-coins', 'العملات وأسعار الصرف', `<button class="btn primary" id="cu-add"><i class="fas fa-plus"></i> عملة</button>`) + `
      <p class="muted small" style="margin-bottom:12px">سعر الصرف = قيمة وحدة واحدة من العملة بعملة الأساس (${esc(b.name)}). مثال: 1 ليرة تركية = 0.03 دولار.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرمز</th><th>الاسم</th><th>العلامة</th><th>سعر الصرف (إلى ${esc(b.symbol)})</th><th>1 ${esc(b.symbol)} =</th><th>خانات</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${list.map((x) => `<tr class="${x.is_active ? '' : 'inactive'}"><td><strong dir="ltr">${x.code}</strong> ${x.is_base ? '<span class="cur-base">الأساس</span>' : ''}</td><td>${esc(x.name)}</td><td>${esc(x.symbol)}</td>
        <td class="num">${x.is_base ? '1' : `<input class="input" dir="ltr" type="number" step="any" min="0" data-rate="${x.code}" value="${x.rate_to_base}" style="max-width:170px;min-height:40px">`}</td>
        <td class="num" dir="ltr">${x.is_base ? '1' : (1 / x.rate_to_base).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${esc(x.symbol)}</td><td class="num">${x.decimals}</td><td>${onoff(x.is_active)}</td>
        <td class="acts">${x.is_base ? '' : `<button class="btn sm success" data-save="${x.code}" title="حفظ السعر"><i class="fas fa-floppy-disk"></i></button><button class="btn sm" data-base="${x.code}" title="اجعلها الأساس"><i class="fas fa-star"></i></button>`}<button class="btn sm" data-edit="${x.code}"><i class="fas fa-pen"></i></button>${x.is_base ? '' : `<button class="btn sm outline-danger" data-del="${x.code}"><i class="fas fa-trash-can"></i></button>`}</td></tr>`).join('')}
      </tbody></table></div>`
    $('#cu-add').addEventListener('click', () => currencyForm())
    $$('[data-edit]').forEach((btn) => btn.addEventListener('click', () => currencyForm(list.find((x) => x.code === btn.dataset.edit))))
    $$('[data-save]').forEach((btn) => btn.addEventListener('click', () => busy(btn, async () => {
      const v = +$(`[data-rate="${btn.dataset.save}"]`).value
      if (!(v > 0)) return toast('سعر الصرف يجب أن يكون أكبر من صفر', 'error')
      try { await api('/api/admin/currencies/' + btn.dataset.save, { method: 'PUT', body: { rate_to_base: v } }); toast('تم تحديث سعر الصرف', 'success'); refreshAnd() } catch (e) { handleErr(e) }
    })))
    $$('[data-rate]').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') $(`[data-save="${i.dataset.rate}"]`).click() }))
    $$('[data-base]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await modal.confirm('تغيير العملة الأساسية', `جعل ${btn.dataset.base} العملة الأساسية؟ سيُعاد حساب أسعار الصرف الأخرى نسبةً إليها. أسعار المنتجات تبقى بعملاتها.`, { ok: 'تغيير' }))) return
      try { await api('/api/admin/currencies/' + btn.dataset.base + '/set-base', { method: 'POST' }); toast('تم تغيير العملة الأساسية', 'success'); refreshAnd() } catch (e) { handleErr(e) }
    }))
    $$('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await modal.confirm('حذف العملة', `حذف ${btn.dataset.del}؟`, { ok: 'حذف', danger: true }))) return
      try { await api('/api/admin/currencies/' + btn.dataset.del, { method: 'DELETE' }); toast('تم حذف العملة', 'success'); refreshAnd() } catch (e) { handleErr(e) }
    }))
  }

  function currencyForm(x) {
    x = x || {}
    const m = modal.open(`<header class="modal-head"><h3>${x.code ? 'تعديل عملة' : 'عملة جديدة'}</h3><button class="btn icon sm ghost" data-close><i class="fas fa-xmark"></i></button></header>
      <form class="modal-body" id="cuf"><div class="form-grid">
        ${field('الرمز (ISO) *', `<input class="input" id="cu-code" dir="ltr" required maxlength="6" pattern="[A-Za-z]{3,6}" value="${esc(x.code || '')}" ${x.code ? 'readonly' : ''} placeholder="USD">`)}
        ${field('الاسم *', `<input class="input" id="cu-name" required value="${esc(x.name || '')}" placeholder="دولار أمريكي">`)}
        ${field('العلامة', `<input class="input" id="cu-sym" value="${esc(x.symbol || '')}" placeholder="$">`)}
        ${field('الخانات العشرية', `<input class="input" id="cu-dec" type="number" min="0" max="4" value="${x.decimals ?? 2}">`)}
        ${x.is_base ? '' : field(`سعر الصرف (1 وحدة = ? ${esc(base().symbol)})`, `<input class="input" id="cu-rate" dir="ltr" type="number" step="any" min="0" value="${x.rate_to_base ?? ''}" required>`, 'span2')}
        <div class="field span2">${sw('cu-active', x.is_active === undefined ? true : !!x.is_active, 'مفعّلة (تظهر في شاشة الدفع)')}</div>
      </div></form>
      <footer class="modal-foot"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="cu-save"><i class="fas fa-check"></i> حفظ</button></footer>`, { sticky: true })
    const save = () => busy($('#cu-save', m), async () => {
      if (!$('#cuf', m).reportValidity()) return
      const body = { code: $('#cu-code', m).value.trim().toUpperCase(), name: $('#cu-name', m).value.trim(), symbol: $('#cu-sym', m).value.trim(), decimals: +$('#cu-dec', m).value, is_active: $('#cu-active', m).checked }
      const rate = $('#cu-rate', m); if (rate) body.rate_to_base = +rate.value
      try {
        if (x.code) await api('/api/admin/currencies/' + x.code, { method: 'PUT', body }); else await api('/api/admin/currencies', { method: 'POST', body })
        modal.close(); toast('تم حفظ العملة', 'success'); refreshAnd()
      } catch (e) { handleErr(e) }
    })
    $('#cu-save', m).addEventListener('click', save)
    $('#cuf', m).addEventListener('submit', (e) => { e.preventDefault(); save() })
  }

  // ---------- Sales
  async function sales(c) {
    const today = new Date().toISOString().slice(0, 10)
    const f = A.salesF || { from: today, to: today, table: '' }
    A.salesF = f
    const qs = new URLSearchParams(); if (f.from) qs.set('from', f.from); if (f.to) qs.set('to', f.to); if (f.table) qs.set('table', f.table)
    const [r, rep] = await Promise.all([api('/api/admin/sales?' + qs), api('/api/admin/reports/products?' + qs)])
    const b = base()
    const maxDay = Math.max(1, ...r.daily.map((d) => d.t || 0))
    c.innerHTML = head('fa-chart-line', 'سجل المبيعات', `<button class="btn" id="s-csv"><i class="fas fa-file-csv"></i> تصدير CSV</button>`) + `
      <div class="filters">
        ${field('من', `<input class="input" type="date" id="s-from" value="${f.from}">`)}${field('إلى', `<input class="input" type="date" id="s-to" value="${f.to}">`)}
        ${field('طاولة', `<input class="input" type="number" id="s-table" min="1" value="${f.table}" placeholder="الكل" style="max-width:110px">`)}
        <button class="btn primary" id="s-go"><i class="fas fa-filter"></i> عرض</button>
        <button class="btn" data-range="today">اليوم</button><button class="btn" data-range="week">7 أيام</button><button class="btn" data-range="month">30 يوم</button><button class="btn" data-range="all">الكل</button>
      </div>
      <div class="stats">
        <div class="stat ok"><i class="fas fa-sack-dollar"></i><div><div class="v">${money(r.summary.total, b)}</div><div class="l">إجمالي المبيعات</div></div></div>
        <div class="stat"><i class="fas fa-receipt"></i><div><div class="v">${r.summary.count}</div><div class="l">فاتورة</div></div></div>
        <div class="stat"><i class="fas fa-utensils"></i><div><div class="v">${r.summary.items}</div><div class="l">عنصر مبيع</div></div></div>
        <div class="stat"><i class="fas fa-divide"></i><div><div class="v">${money(r.summary.count ? r.summary.total / r.summary.count : 0, b)}</div><div class="l">متوسط الفاتورة</div></div></div>
      </div>
      <div class="grid-2" style="margin-bottom:16px">
        <section class="card"><h3><i class="fas fa-calendar-days"></i> حسب اليوم</h3><div class="daily">${r.daily.length ? r.daily.map((d) => `<div class="d"><span dir="ltr">${d.sale_date}</span><span class="bar"><i style="width:${Math.round(((d.t || 0) / maxDay) * 100)}%"></i></span><span class="cnt muted small">${d.n} فاتورة</span><strong class="num">${money(d.t, b)}</strong></div>`).join('') : '<p class="muted">لا بيانات</p>'}</div></section>
        <section class="card"><h3><i class="fas fa-ranking-star"></i> الأكثر مبيعاً</h3>${rep.products.length ? `<table class="tbl"><thead><tr><th>المنتج</th><th>القسم</th><th>كمية</th><th>الإجمالي</th></tr></thead><tbody>${rep.products.slice(0, 12).map((p) => `<tr><td>${esc(p.name)}</td><td class="small muted">${esc(p.category || '')}</td><td class="num">${p.qty}</td><td class="num">${money(p.total, b)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">لا بيانات</p>'}</section>
      </div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الوقت</th><th>طاولة</th><th>عناصر</th><th>خصم</th><th>الإجمالي</th><th>الدفع</th><th></th></tr></thead><tbody>
      ${r.sales.length ? r.sales.map((s) => `<tr><td class="small">${KZ.fmtDateTime(s.paid_at)}</td><td><strong>${s.table_number}</strong></td><td class="num">${s.items_count}</td><td class="num">${s.discount ? money(s.discount, b) : '—'}</td><td class="num"><strong>${money(s.total, curOf(s.currency_code))}</strong></td><td>${{ cash: 'نقدي', card: 'بطاقة', transfer: 'تحويل' }[s.payment_method] || s.payment_method}</td>
        <td class="acts"><button class="btn sm" data-sale="${s.id}"><i class="fas fa-eye"></i> تفاصيل</button></td></tr>`).join('') : '<tr><td colspan="7"><div class="empty"><p>لا مبيعات في هذه الفترة</p></div></td></tr>'}
      </tbody></table></div>`
    const apply = () => { A.salesF = { from: $('#s-from').value, to: $('#s-to').value, table: $('#s-table').value }; sales(c) }
    $('#s-go').addEventListener('click', apply)
    $$('[data-range]').forEach((btn) => btn.addEventListener('click', () => {
      const d = new Date(); const to = d.toISOString().slice(0, 10)
      const days = { today: 0, week: 6, month: 29 }[btn.dataset.range]
      if (btn.dataset.range === 'all') A.salesF = { from: '', to: '', table: '' }
      else { d.setDate(d.getDate() - days); A.salesF = { from: d.toISOString().slice(0, 10), to, table: $('#s-table').value } }
      sales(c)
    }))
    $('#s-csv').addEventListener('click', () => {
      // Excel-friendly CSV: UTF-8 BOM, CRLF, local date & time in separate unambiguous columns (YYYY-MM-DD / HH:MM)
      const PM = { cash: 'نقدي', card: 'بطاقة', transfer: 'تحويل' }
      const rows = [['التاريخ', 'الوقت', 'الطاولة', 'عدد العناصر', 'المجموع الفرعي', 'الخصم', 'الإجمالي', 'العملة', 'طريقة الدفع', 'المنتجات']]
      r.sales.forEach((s) => { const dt = KZ.csvDate(s.paid_at); rows.push([dt.date, dt.time, s.table_number, s.items_count, Number(s.subtotal || 0), Number(s.discount || 0), Number(s.total || 0), s.currency_code, PM[s.payment_method] || s.payment_method || '', s.items.map((i) => `${i.name} ×${i.qty}`).join(' | ')]) })
      const cell = (v) => typeof v === 'number' ? String(v) : `"${String(v ?? '').replace(/"/g, '""')}"`
      const csv = '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `kazdoura-sales-${f.from || 'all'}_${f.to || ''}.csv`; a.click()
    })
    $$('[data-sale]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        const d = await api('/api/admin/sales/' + btn.dataset.sale)
        const s = d.sale; const cur = curOf(s.currency_code)
        modal.open(`<header class="modal-head"><h3>فاتورة طاولة ${s.table_number}</h3><button class="btn icon sm ghost" data-close><i class="fas fa-xmark"></i></button></header>
          <section class="modal-body sale-detail">
            <div class="small muted">فُتح ${KZ.fmtDateTime(s.opened_at)} · دُفع ${KZ.fmtDateTime(s.paid_at)} · ${d.orders.length} طلب</div>
            <table class="tbl lines"><thead><tr><th>المنتج</th><th>القسم</th><th>كمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${s.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="small muted">${esc(i.category || '')}</td><td class="num">${i.qty}</td><td class="num">${money(i.unit_price, cur)}</td><td class="num">${money(i.line_total, cur)}</td></tr>`).join('')}</tbody></table>
            <div style="text-align:end"><div>المجموع: ${money(s.subtotal, cur)}</div>${s.discount ? `<div>الخصم: −${money(s.discount, cur)}</div>` : ''}<div style="font-size:20px;font-weight:800">الإجمالي: ${money(s.total, cur)}</div>
            ${Object.keys(s.rates || {}).filter((k) => k !== cur.code).map((k) => { const rc = A.d.currencies.find((x) => x.code === k); return `<div class="small muted">${esc(rc ? rc.name : k)}: ${money(s.total / (s.rates[k] || 1), rc || { symbol: k, decimals: 0 })}</div>` }).join('')}</div>
            <h4 style="margin-top:14px">الدفعات</h4>${d.payments.map((p) => `<div class="small">${{ cash: 'نقدي', card: 'بطاقة', transfer: 'تحويل' }[p.method] || p.method} · ${money(p.amount, curOf(p.currency_code))}${p.received ? ` · مستلم ${money(p.received, curOf(p.currency_code))} · باقي ${money(p.change_given, curOf(p.currency_code))}` : ''}</div>`).join('')}
            <h4 style="margin-top:14px">مهام الطباعة</h4>${d.print_jobs.length ? d.print_jobs.map((j) => `<div class="small">${esc(j.printer_name)} · ${{ kitchen: 'طلب', bill: 'فاتورة', test: 'تجريبي' }[j.job_type]} · <span class="badge status-${j.status}">${jobBadge(j.status)}</span></div>`).join('') : '<p class="small muted">—</p>'}
          </section>`, { size: 'lg' })
      } catch (e) { handleErr(e) }
    }))
  }

  // ---------- Messages
  async function messages(c) {
    const list = A.d.messages
    c.innerHTML = head('fa-message', 'الرسائل والنصوص', `<button class="btn primary" id="m-save" data-busy-text="جارٍ الحفظ…"><i class="fas fa-floppy-disk"></i> حفظ الكل</button>`) + `
      <p class="muted small" style="margin-bottom:12px">نصوص الفواتير وتذاكر المطبخ ورسائل نقطة البيع. يمكن استخدام أسطر متعددة.</p>
      <div class="msg-list">${list.map((m) => `<div class="msg-item"><label for="msg-${m.key}">${esc(m.label || m.key)} <code>${m.key}</code></label><textarea class="input" id="msg-${m.key}" data-key="${m.key}" rows="2">${esc(m.value)}</textarea></div>`).join('')}</div>`
    $('#m-save').addEventListener('click', () => busy($('#m-save'), async () => {
      const msgs = $$('[data-key]').map((t) => ({ key: t.dataset.key, value: t.value }))
      try { await api('/api/admin/messages', { method: 'PUT', body: { messages: msgs } }); toast('تم حفظ الرسائل', 'success'); await load() } catch (e) { handleErr(e) }
    }))
  }

  // ---------- Settings
  async function settings(c) {
    const s = A.d.settings
    c.innerHTML = head('fa-sliders', 'الإعدادات', `<button class="btn primary" id="st-save" data-busy-text="جارٍ الحفظ…"><i class="fas fa-floppy-disk"></i> حفظ</button>`) + `
      <div class="grid-2">
        <section class="card"><h3><i class="fas fa-store"></i> بيانات المحل</h3><div style="display:grid;gap:10px">
          ${field('اسم المحل', `<input class="input" id="st-store_name" value="${esc(s.store_name || '')}">`)}
          ${field('وصف قصير', `<input class="input" id="st-store_subtitle" value="${esc(s.store_subtitle || '')}">`)}
          ${field('الهاتف', `<input class="input" id="st-store_phone" dir="ltr" value="${esc(s.store_phone || '')}">`)}
          ${field('العنوان', `<input class="input" id="st-store_address" value="${esc(s.store_address || '')}">`)}
        </div></section>
        <section class="card"><h3><i class="fas fa-gears"></i> التشغيل</h3><div style="display:grid;gap:10px">
          ${field('تحديث شاشة الطاولات كل (ثانية)', `<input class="input" id="st-pos_refresh_seconds" type="number" min="3" max="120" value="${esc(s.pos_refresh_seconds || 8)}">`)}
          ${field('فحص جسر الطباعة كل (ثانية)', `<input class="input" id="st-bridge_poll_seconds" type="number" min="1" max="60" value="${esc(s.bridge_poll_seconds || 3)}">`)}
          ${field('أقصى محاولات طباعة للمهمة', `<input class="input" id="st-print_job_max_attempts" type="number" min="1" max="20" value="${esc(s.print_job_max_attempts || 5)}">`)}
          <div class="field">${sw('st-show_prices_in_secondary', s.show_prices_in_secondary === '1' || s.show_prices_in_secondary === 1, 'إظهار الإجمالي بالعملات الأخرى في الفاتورة')}</div>
        </div></section>
        <section class="card"><h3><i class="fas fa-shield-halved"></i> الأمان</h3>
          <p class="small muted">كلمة مرور المدير ورمز جسر الطباعة تُضبط كمتغيرات بيئة (ADMIN_PASSWORD, BRIDGE_TOKEN) على الخادم ولا تُخزَّن في قاعدة البيانات. جلسة الدخول صالحة 12 ساعة.</p>
        </section>
        <section class="card"><h3><i class="fas fa-circle-info"></i> معلومات</h3>
          <div class="small" style="display:grid;gap:4px"><div>الرابط: <code dir="ltr">${esc(location.origin)}</code></div><div>نقطة البيع: <a href="/" target="_blank">${esc(location.origin)}/</a></div><div>${A.d.products.filter((p) => !p.is_deleted).length} منتج · ${A.d.categories.length} قسم · ${A.d.printers.length} طابعة · ${A.d.currencies.length} عملة</div></div>
        </section>
      </div>`
    $('#st-save').addEventListener('click', () => busy($('#st-save'), async () => {
      const body = {}
      ;['store_name', 'store_subtitle', 'store_phone', 'store_address', 'pos_refresh_seconds', 'bridge_poll_seconds', 'print_job_max_attempts'].forEach((k) => { body[k] = $('#st-' + k).value.trim() })
      body.show_prices_in_secondary = $('#st-show_prices_in_secondary').checked ? '1' : '0'
      try { await api('/api/admin/settings', { method: 'PUT', body }); toast('تم حفظ الإعدادات', 'success'); await load(); const b = $('.side .brand strong'); if (b) b.textContent = A.d.settings.store_name } catch (e) { handleErr(e) }
    }))
  }

  // ---------- Audit
  async function audit(c) {
    const r = await api('/api/admin/audit')
    const names = { create: 'إنشاء', update: 'تعديل', delete: 'حذف', cancel: 'إلغاء', set_base: 'عملة أساسية', bulk_set: 'تحديد عدد', login: 'دخول' }
    const ents = { product: 'منتج', category: 'قسم', table: 'طاولة', printer: 'طابعة', currency: 'عملة', settings: 'إعدادات', messages: 'رسائل', check: 'حساب' }
    c.innerHTML = head('fa-clock-rotate-left', 'سجل النشاط') + `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الوقت</th><th>الإجراء</th><th>العنصر</th><th>المعرّف</th><th>تفاصيل</th></tr></thead><tbody>
      ${r.log.map((l) => `<tr><td class="small">${KZ.fmtDateTime(l.created_at)}</td><td>${names[l.action] || l.action}</td><td>${ents[l.entity] || l.entity}</td><td class="small" dir="ltr">${esc(l.entity_id || '')}</td><td class="small muted" style="max-width:360px;word-break:break-all">${esc(l.details || '')}</td></tr>`).join('')}
    </tbody></table></div>`
  }

  document.addEventListener('DOMContentLoaded', init)
})()
