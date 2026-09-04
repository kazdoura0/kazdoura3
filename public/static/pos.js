/* كزدورة POS — tables → products → order → bill → pay */
(function () {
  'use strict'
  const { api, esc, money, toast, modal, uid, busy } = KZ

  const S = {
    boot: null,
    tables: [],
    products: [],
    categories: [],
    currencies: [],
    curMap: {},
    base: null,
    view: 'tables', // tables | order
    tableId: null,
    activeCat: null,
    check: null,
    items: [], // sent items
    printJobs: [],
    draft: {}, // product_id -> qty (unsent)
    online: true,
    sending: false,
    pendingRequestId: null,
    watchJobs: new Map(), // jobId -> tableId
  }
  const root = document.getElementById('app')

  // ---------- Draft persistence (survives refresh / app reopen)
  const DRAFT_KEY = 'kz_pos_drafts'
  function loadDrafts() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') } catch (_) { return {} } }
  function saveDraft() {
    const all = loadDrafts()
    if (S.tableId) {
      if (Object.keys(S.draft).length) all[S.tableId] = S.draft
      else delete all[S.tableId]
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(all))
  }
  const VIEW_KEY = 'kz_pos_view'
  function saveView() { localStorage.setItem(VIEW_KEY, JSON.stringify({ view: S.view, tableId: S.tableId, cat: S.activeCat })) }

  // Outbox: orders that were sent but response not received (network failure) — retried on load
  const OUTBOX_KEY = 'kz_pos_outbox'
  function loadOutbox() { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]') } catch (_) { return [] } }
  function saveOutbox(list) { localStorage.setItem(OUTBOX_KEY, JSON.stringify(list)) }

  // ---------- Data
  async function bootstrap() {
    const b = await api('/api/pos/bootstrap', { auth: false })
    S.boot = b
    S.tables = b.tables
    S.products = b.products
    S.categories = b.categories
    S.currencies = b.currencies
    S.curMap = {}
    b.currencies.forEach((c) => (S.curMap[c.code] = c))
    S.base = b.currencies.find((c) => c.is_base) || b.currencies[0]
    if (!S.activeCat || !S.categories.some((c) => c.id === S.activeCat)) S.activeCat = S.categories[0] ? S.categories[0].id : null
    document.title = (b.settings.store_name || 'كزدورة') + ' — نقطة البيع'
  }

  async function refreshTables() {
    try {
      const r = await api('/api/pos/tables', { auth: false, retries: 1 })
      S.tables = r.tables
      setOnline(true)
      if (S.view === 'tables') renderTables()
    } catch (e) { setOnline(false) }
  }

  async function loadCheck() {
    if (!S.tableId) return
    const r = await api('/api/pos/tables/' + S.tableId + '/check', { auth: false })
    S.check = r.check
    S.items = r.items
    S.printJobs = r.print_jobs || []
    const t = S.tables.find((x) => x.id === S.tableId)
    if (t) Object.assign(t, r.table)
  }

  function setOnline(v) {
    S.online = v
    const el = document.getElementById('conn')
    if (el) { el.classList.toggle('off', !v); el.querySelector('span').textContent = v ? 'متصل' : 'غير متصل' }
  }

  // ---------- Helpers
  const productById = (id) => S.products.find((p) => p.id === id)
  const catById = (id) => S.categories.find((c) => c.id === id)
  const tableById = (id) => S.tables.find((t) => t.id === id)
  function priceInBase(p) {
    const from = S.curMap[p.currency_code] || S.base
    return KZ.convert(p.price, from, S.base)
  }
  function draftTotal() {
    let t = 0
    for (const pid in S.draft) { const p = productById(+pid); if (p) t += priceInBase(p) * S.draft[pid] }
    return t
  }
  function draftCount() { return Object.values(S.draft).reduce((a, b) => a + b, 0) }
  const STATE_LABEL = { empty: 'فارغة', occupied: 'عليها طلبات', billing: 'جاهزة للحساب', awaiting_payment: 'بانتظار الدفع' }

  // ---------- Shell
  function renderShell() {
    const st = S.boot.settings
    root.innerHTML = `
      <header class="topbar">
        <div class="brand"><i class="fas fa-mug-hot"></i><span>${esc(st.store_name || 'كزدورة')} <small>${esc(st.store_subtitle || '')}</small></span></div>
        <div class="grow"></div>
        <button class="tb-btn ${S.view === 'tables' ? 'active' : ''}" id="nav-tables"><i class="fas fa-table-cells-large"></i> الطاولات</button>
        <span class="conn" id="conn"><i class="dot"></i><span>متصل</span></span>
        ${KZ.theme.button('tb-btn')}
      </header>
      <main class="pos-main" id="main"></main>`
    document.getElementById('nav-tables').addEventListener('click', () => goTables())
    KZ.theme.bind(root)
  }

  // ---------- Tables screen
  function renderTables() {
    if (S.view !== 'tables') return
    const main = document.getElementById('main')
    const drafts = loadDrafts()
    main.innerHTML = `
      <section class="tables-screen" id="tables-screen">
        <div class="legend">
          <span><i class="c-empty"></i> فارغة</span><span><i class="c-occ"></i> عليها طلبات</span><span><i class="c-bill"></i> جاهزة للحساب</span><span><i class="c-pay"></i> بانتظار الدفع</span>
        </div>
        <div class="tables-grid" id="tables-grid">
          ${S.tables.map((t) => {
            const chk = t.check
            const d = drafts[t.id]
            const dcount = d ? Object.values(d).reduce((a, b) => a + b, 0) : 0
            return `<button class="table-card ${t.status}" data-table="${t.id}" id="table-${t.number}">
              <span class="tstate">${STATE_LABEL[t.status] || t.status}</span>
              <span class="tnum">${t.number}</span>
              ${t.label ? `<span class="tlabel">${esc(t.label)}</span>` : ''}
              ${chk ? `<span class="tinfo">${chk.items} عنصر · ${money(chk.total, S.curMap[chk.currency_code] || S.base)}</span><span class="tlabel">${KZ.elapsed(chk.opened_at)}</span>` : dcount ? `<span class="tinfo muted">${dcount} غير مُرسل</span>` : `<span class="tlabel">${esc(S.boot.messages.pos_welcome || '')}</span>`}
            </button>`
          }).join('')}
        </div>
      </section>`
    main.querySelectorAll('.table-card').forEach((b) => b.addEventListener('click', () => openTable(+b.dataset.table)))
  }

  async function goTables() {
    S.view = 'tables'
    S.tableId = null
    saveView()
    document.getElementById('nav-tables').classList.add('active')
    renderTables()
    refreshTables()
  }

  // ---------- Order screen
  async function openTable(id) {
    S.tableId = id
    S.view = 'order'
    S.draft = loadDrafts()[id] || {}
    S.check = null
    S.items = []
    S.printJobs = []
    saveView()
    document.getElementById('nav-tables').classList.remove('active')
    renderOrder(true)
    try {
      await loadCheck()
      renderOrder()
      watchPrintJobs()
    } catch (e) {
      toast(e.message, 'error')
      setOnline(e.code !== 'network')
      renderOrder()
    }
  }

  function renderOrder(loading) {
    const main = document.getElementById('main')
    const t = tableById(S.tableId)
    if (!t) return goTables()
    const cats = S.categories
    const prods = S.products.filter((p) => (S.activeCat ? p.category_id === S.activeCat : true))
    main.innerHTML = `
      <section class="order-screen">
        <div class="catalog">
          <nav class="cat-tabs" id="cat-tabs">
            ${cats.map((c) => `<button class="cat-tab ${c.id === S.activeCat ? 'active' : ''}" data-cat="${c.id}"><i class="fas ${esc(c.icon || 'fa-tag')}"></i>${esc(c.name)}</button>`).join('')}
          </nav>
          <div class="products-grid" id="products-grid">
            ${prods.map((p) => `<button class="product-card ${p.is_available ? '' : 'unavailable'}" data-pid="${p.id}" ${p.is_available ? '' : 'disabled'}>
              ${S.draft[p.id] ? `<span class="pqty">${S.draft[p.id]}</span>` : ''}
              <div class="pimg" ${p.image_url ? `style="background-image:url('${esc(p.image_url)}')"` : ''}>${p.image_url ? '' : '<i class="fas fa-utensils"></i>'}</div>
              <div class="pbody"><span class="pname">${esc(p.name)}</span><span class="pprice">${money(priceInBase(p), S.base)}</span>${p.is_available ? '' : '<span class="small muted">غير متوفر</span>'}</div>
            </button>`).join('') || '<div class="empty"><i class="fas fa-box-open"></i>لا منتجات في هذا القسم</div>'}
          </div>
        </div>
        <aside class="ticket-pane" id="ticket-pane">
          <header class="ticket-head">
            <div><h2>طاولة ${t.number}</h2><span class="small muted">${STATE_LABEL[t.status]}${S.check ? ' · ' + KZ.elapsed(S.check.opened_at) : ''}</span></div>
            <div class="row">
              <button class="btn sm ghost" id="btn-back"><i class="fas fa-arrow-right"></i> الطاولات</button>
            </div>
          </header>
          <div class="ticket-body" id="ticket-body">${loading ? '<div class="empty"><i class="fas fa-spinner fa-spin"></i></div>' : renderTicketBody()}</div>
          <footer class="ticket-foot" id="ticket-foot">${renderTicketFoot()}</footer>
        </aside>
      </section>`
    main.querySelectorAll('.cat-tab').forEach((b) => b.addEventListener('click', () => { S.activeCat = +b.dataset.cat; saveView(); renderOrder() }))
    main.querySelectorAll('.product-card').forEach((b) => b.addEventListener('click', () => addDraft(+b.dataset.pid)))
    document.getElementById('btn-back').addEventListener('click', goTables)
    bindTicket()
  }

  function renderTicketBody() {
    const draftIds = Object.keys(S.draft)
    let html = ''
    if (draftIds.length) {
      html += `<div class="ticket-section"><span>طلب جديد (غير مُرسل)</span><span>${draftCount()} عنصر</span></div>`
      html += draftIds.map((pid) => {
        const p = productById(+pid)
        if (!p) return ''
        const q = S.draft[pid]
        return `<div class="line draft" data-pid="${pid}">
          <div class="lname">${esc(p.name)}<small>${money(priceInBase(p), S.base)}</small></div>
          <div class="qty-ctl"><button data-act="dec" aria-label="تقليل">${q === 1 ? '<i class="fas fa-trash-can" style="font-size:14px"></i>' : '−'}</button><span>${q}</span><button data-act="inc" aria-label="زيادة">+</button></div>
          <div class="lprice">${money(priceInBase(p) * q, S.base)}</div>
        </div>`
      }).join('')
    }
    if (S.items.length) {
      const orders = {}
      S.items.forEach((i) => { (orders[i.order_id] = orders[i.order_id] || []).push(i) })
      const seqOf = {}
      ;(S.check && S.printJobs) ? null : null
      const orderList = Object.keys(orders)
      html += `<div class="ticket-section"><span>الطلبات المُرسلة</span><span>${S.items.reduce((a, b) => a + b.qty, 0)} عنصر</span></div>`
      html += orderList.map((oid) => orders[oid].map((i) => `<div class="line sent" data-item="${i.id}">
          <div class="lname">${esc(i.product_name)}<small>${money(i.unit_price_base, S.curMap[S.check.currency_code] || S.base)}${i.category_name ? ' · ' + esc(i.category_name) : ''}</small></div>
          <div class="qty-ctl"><button data-act="dec" aria-label="تقليل">${i.qty === 1 ? '<i class="fas fa-trash-can" style="font-size:14px"></i>' : '−'}</button><span>${i.qty}</span><button data-act="inc" aria-label="زيادة">+</button></div>
          <div class="lprice">${money(i.line_total, S.curMap[S.check.currency_code] || S.base)}</div>
        </div>`).join('')).join('')
    }
    if (!html) html = `<div class="empty"><i class="fas fa-receipt"></i>اختر المنتجات لإضافتها إلى الطاولة</div>`
    return html
  }

  function renderTicketFoot() {
    const cur = S.check ? S.curMap[S.check.currency_code] || S.base : S.base
    const sent = S.check ? S.check.total : 0
    const dt = draftTotal()
    const hasDraft = draftCount() > 0
    const hasSent = S.items.length > 0
    const kitchenJobs = S.printJobs.filter((j) => j.job_type === 'kitchen').slice(0, 6)
    return `
      ${kitchenJobs.length ? `<div class="print-status" id="print-status">${kitchenJobs.map(pjBadge).join('')}</div>` : ''}
      <div class="total-row"><span>الإجمالي</span><span>${money(sent + dt, cur)}${hasDraft && hasSent ? `<span class="sub"> (مُرسل ${money(sent, cur)})</span>` : ''}</span></div>
      <div class="foot-actions">
        <button class="btn primary lg span2" id="btn-send" ${hasDraft && !S.sending ? '' : 'disabled'} data-busy-text="جارٍ الإرسال…"><i class="fas fa-paper-plane"></i> إرسال الطلب${hasDraft ? ` (${draftCount()})` : ''}</button>
        <button class="btn accent" id="btn-bill" ${hasSent ? '' : 'disabled'}><i class="fas fa-file-invoice"></i> الحساب</button>
        <button class="btn ${hasDraft ? 'outline-danger' : ''}" id="btn-clear" ${hasDraft ? '' : 'disabled'}><i class="fas fa-eraser"></i> مسح الجديد</button>
      </div>`
  }

  function pjBadge(j) {
    const icon = j.status === 'printed' ? 'fa-check' : j.status === 'failed' ? 'fa-triangle-exclamation' : 'fa-hourglass-half'
    const label = j.status === 'printed' ? 'طُبع' : j.status === 'failed' ? 'فشل' : j.status === 'printing' ? 'يطبع…' : 'بالانتظار'
    return `<span class="pj ${j.status}" data-job="${j.id}" title="${esc(j.last_error || '')}"><i class="fas ${icon}"></i>${esc(j.printer_name || 'بدون طابعة')}: ${label}${j.status === 'failed' && j.printer_name ? ` <button data-retry="${j.id}">إعادة</button>` : ''}</span>`
  }

  function bindTicket() {
    const body = document.getElementById('ticket-body')
    const foot = document.getElementById('ticket-foot')
    if (!body || !foot) return
    body.onclick = async (e) => {
      const btn = e.target.closest('button[data-act]')
      if (!btn) return
      const line = btn.closest('.line')
      const act = btn.dataset.act
      if (line.dataset.pid) {
        const pid = line.dataset.pid
        S.draft[pid] = (S.draft[pid] || 0) + (act === 'inc' ? 1 : -1)
        if (S.draft[pid] <= 0) delete S.draft[pid]
        saveDraft()
        renderOrder()
      } else if (line.dataset.item) {
        const it = S.items.find((i) => i.id === +line.dataset.item)
        if (!it) return
        const q = it.qty + (act === 'inc' ? 1 : -1)
        if (q <= 0 && !(await modal.confirm('حذف العنصر', `حذف «${it.product_name}» من الحساب؟`, { danger: true, ok: 'حذف' }))) return
        try {
          const r = await api('/api/pos/items/' + it.id, { method: 'PATCH', body: { qty: q }, auth: false })
          S.check = r.check || S.check
          S.items = r.items
          renderOrder()
        } catch (err) { toast(err.message, 'error') }
      }
    }
    foot.onclick = async (e) => {
      const retry = e.target.closest('[data-retry]')
      if (retry) {
        try { await api('/api/pos/print-jobs/' + retry.dataset.retry + '/retry', { method: 'POST', auth: false }); toast('تمت إعادة إرسال مهمة الطباعة', 'info'); S.watchJobs.set(retry.dataset.retry, S.tableId); await loadCheck(); renderOrder(); watchPrintJobs() } catch (err) { toast(err.message, 'error') }
        return
      }
      if (e.target.closest('#btn-send')) return sendOrder(e.target.closest('#btn-send'))
      if (e.target.closest('#btn-bill')) return openBill()
      if (e.target.closest('#btn-clear')) {
        if (await modal.confirm('مسح الطلب الجديد', 'سيتم مسح العناصر غير المُرسلة فقط.', { danger: true, ok: 'مسح' })) { S.draft = {}; saveDraft(); renderOrder() }
      }
    }
  }

  function addDraft(pid) {
    const p = productById(pid)
    if (!p || !p.is_available) return
    S.draft[pid] = (S.draft[pid] || 0) + 1
    saveDraft()
    renderOrder()
  }

  // ---------- Send order (idempotent, double-tap safe, outbox on network failure)
  async function sendOrder(btn) {
    if (S.sending || !draftCount()) return
    S.sending = true
    const items = Object.keys(S.draft).map((pid) => ({ product_id: +pid, qty: S.draft[pid] }))
    const reqId = S.pendingRequestId || uid('ord')
    S.pendingRequestId = reqId
    const payload = { client_request_id: reqId, items }
    const tableId = S.tableId
    // persist to outbox first so a crash mid-request can be recovered
    const ob = loadOutbox().filter((o) => o.client_request_id !== reqId)
    ob.push({ table_id: tableId, ...payload, at: Date.now() })
    saveOutbox(ob)
    await busy(btn, async () => {
      try {
        const r = await api('/api/pos/tables/' + tableId + '/orders', { method: 'POST', body: payload, auth: false, timeout: 20000 })
        saveOutbox(loadOutbox().filter((o) => o.client_request_id !== reqId))
        S.pendingRequestId = null
        S.draft = {}
        saveDraft()
        toast(r.duplicate ? 'هذا الطلب مُرسل مسبقاً' : S.boot.messages.order_sent_ok || 'تم إرسال الطلب بنجاح', 'success')
        r.print_jobs.forEach((j) => S.watchJobs.set(j.id, S.tableId))
        // browser-type printers: open print page
        r.print_jobs.filter((j) => j.printer_type === 'browser' && j.status === 'pending').forEach((j) => window.open('/print/job/' + j.id, '_blank', 'width=420,height=700'))
        const noPrinter = r.print_jobs.filter((j) => j.status === 'failed')
        if (noPrinter.length) toast('تنبيه: ' + noPrinter.map((j) => j.printer_name || 'قسم بدون طابعة').join('، ') + ' — لم تُطبع', 'warn', 5000)
        await loadCheck()
        setOnline(true)
        renderOrder()
        watchPrintJobs()
      } catch (e) {
        if (e.code === 'network' || e.status >= 500) {
          // keep in outbox; will retry automatically
          setOnline(e.code !== 'network')
          toast((S.boot.messages.order_sent_fail || 'تعذر إرسال الطلب') + ' — سيُعاد الإرسال تلقائياً', 'error')
        } else {
          saveOutbox(loadOutbox().filter((o) => o.client_request_id !== reqId))
          S.pendingRequestId = null
          toast(e.message || 'تعذر إرسال الطلب', 'error')
          if (e.code === 'product_unavailable' || e.code === 'product_missing') { try { await bootstrap() } catch (_) {} }
        }
      } finally {
        S.sending = false
        if (S.view === 'order' && S.tableId === tableId) renderOrder()
      }
    })
  }

  /** Retry outbox entries (network failed sends). Idempotent server side. */
  async function flushOutbox() {
    const ob = loadOutbox()
    if (!ob.length) return
    for (const o of ob) {
      try {
        const r = await api('/api/pos/tables/' + o.table_id + '/orders', { method: 'POST', body: { client_request_id: o.client_request_id, items: o.items }, auth: false, timeout: 20000 })
        saveOutbox(loadOutbox().filter((x) => x.client_request_id !== o.client_request_id))
        if (S.pendingRequestId === o.client_request_id) { S.pendingRequestId = null; S.draft = {}; saveDraft() }
        toast(r.duplicate ? 'تم التأكد من وصول الطلب السابق (طاولة ' + (tableById(o.table_id) || {}).number + ')' : 'تم إرسال الطلب المعلّق (طاولة ' + (tableById(o.table_id) || {}).number + ')', 'success')
        r.print_jobs.forEach((j) => S.watchJobs.set(j.id, o.table_id))
        if (S.view === 'order' && S.tableId === o.table_id) { await loadCheck(); renderOrder() }
      } catch (e) {
        if (e.code !== 'network' && !(e.status >= 500)) {
          saveOutbox(loadOutbox().filter((x) => x.client_request_id !== o.client_request_id))
          if (S.pendingRequestId === o.client_request_id) S.pendingRequestId = null
          toast('طلب معلّق رُفض: ' + e.message, 'error')
        }
      }
    }
  }

  // ---------- Print job watcher
  let watchTimer = null
  async function watchPrintJobs() {
    clearTimeout(watchTimer)
    const ids = Array.from(S.watchJobs.keys())
    if (!ids.length) return
    try {
      const r = await api('/api/pos/print-jobs?ids=' + ids.join(','), { auth: false, retries: 0 })
      let changed = false
      r.jobs.forEach((j) => {
        const forCurrentTable = S.watchJobs.get(j.id) === S.tableId && S.view === 'order'
        const ex = S.printJobs.find((x) => x.id === j.id)
        if (ex && ex.status !== j.status) { Object.assign(ex, j); changed = true }
        if (!ex && forCurrentTable) { S.printJobs.unshift(j); changed = true }
        if (j.status === 'printed' || j.status === 'failed' || j.status === 'cancelled') {
          S.watchJobs.delete(j.id)
          if (ex && ex.status !== j.status) toast(j.status === 'printed' ? `تمت الطباعة: ${j.printer_name}` : `${S.boot.messages.print_fail || 'تعذر الاتصال بالطابعة'}: ${j.printer_name}`, j.status === 'printed' ? 'success' : 'error')
        }
      })
      if (changed && S.view === 'order') {
        const ps = document.getElementById('ticket-foot')
        if (ps) { ps.innerHTML = renderTicketFoot(); bindTicket() }
      }
    } catch (_) {}
    if (S.watchJobs.size) watchTimer = setTimeout(watchPrintJobs, 2500)
  }

  // ---------- Bill & payment
  async function openBill() {
    try { await loadCheck() } catch (e) { return toast(e.message, 'error') }
    if (!S.check || !S.items.length) return toast('لا توجد طلبات مُرسلة على هذه الطاولة', 'warn')
    const t = tableById(S.tableId)
    const cur = S.curMap[S.check.currency_code] || S.base
    // aggregate
    const agg = {}
    S.items.forEach((i) => { const k = i.product_id + '|' + i.unit_price_base; (agg[k] = agg[k] || { ...i, qty: 0, line_total: 0 }); agg[k].qty += i.qty; agg[k].line_total += i.line_total })
    const lines = Object.values(agg)
    const others = S.currencies.filter((c) => c.code !== cur.code && c.is_active)
    const cashierJobs = S.printJobs.filter((j) => j.job_type === 'bill')
    const m = modal.open(`
      <header class="modal-head"><h3><i class="fas fa-file-invoice"></i> حساب طاولة ${t.number}</h3><button class="btn icon sm ghost" data-close><i class="fas fa-xmark"></i></button></header>
      <section class="modal-body bill">
        <div class="bl head"><span>المنتج</span><span class="n">الكمية</span><span class="n">السعر</span><span class="n">الإجمالي</span></div>
        ${lines.map((l) => `<div class="bl"><span>${esc(l.product_name)}</span><span class="n">${l.qty}</span><span class="n">${money(l.unit_price_base, cur)}</span><span class="n">${money(l.line_total, cur)}</span></div>`).join('')}
        ${S.check.discount ? `<div class="bsec" style="padding-top:8px"><span>خصم</span><span>− ${money(S.check.discount, cur)}</span></div>` : ''}
        <div class="btotal"><span>الإجمالي</span><span>${money(S.check.total, cur)}</span></div>
        ${others.map((c) => `<div class="bsec"><span>${esc(c.name)}</span><span>${money(KZ.convert(S.check.total, cur, c), c)}</span></div>`).join('')}
        <div class="print-status" id="bill-print-status" style="margin-top:12px">${cashierJobs.slice(0, 3).map(pjBadge).join('')}</div>
      </section>
      <footer class="modal-foot">
        <button class="btn" id="b-discount"><i class="fas fa-percent"></i> خصم</button>
        <span class="grow"></span>
        <button class="btn accent lg" id="b-print" data-busy-text="جارٍ إرسال الفاتورة…"><i class="fas fa-print"></i> طباعة الفاتورة</button>
        <button class="btn success lg" id="b-pay"><i class="fas fa-hand-holding-dollar"></i> تم الدفع</button>
      </footer>`, { size: 'lg' })
    m.querySelector('#b-print').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      try {
        const r = await api('/api/pos/checks/' + S.check.id + '/bill', { method: 'POST', auth: false })
        toast('أُرسلت الفاتورة إلى ' + (r.print_job.printer_name || 'طابعة الكاشير'), r.print_job.status === 'failed' ? 'error' : 'success')
        if (r.print_job.printer_type === 'browser' && r.print_job.status === 'pending') window.open('/print/job/' + r.print_job.id, '_blank', 'width=420,height=700')
        S.watchJobs.set(r.print_job.id, S.tableId)
        await loadCheck()
        const ps = m.querySelector('#bill-print-status')
        if (ps) ps.innerHTML = S.printJobs.filter((j) => j.job_type === 'bill').slice(0, 3).map(pjBadge).join('')
        // keep bill status updated inside the modal
        const tick = async () => {
          if (!document.body.contains(m)) return
          await watchPrintJobs()
          const ps2 = m.querySelector('#bill-print-status')
          if (ps2) ps2.innerHTML = S.printJobs.filter((j) => j.job_type === 'bill').slice(0, 3).map(pjBadge).join('')
          if (S.watchJobs.has(r.print_job.id)) setTimeout(tick, 2500)
        }
        setTimeout(tick, 2000)
        ps && ps.addEventListener('click', async (ev) => {
          const rb = ev.target.closest('[data-retry]')
          if (!rb) return
          try { await api('/api/pos/print-jobs/' + rb.dataset.retry + '/retry', { method: 'POST', auth: false }); S.watchJobs.set(rb.dataset.retry, S.tableId); toast('تمت إعادة المحاولة', 'info'); tick() } catch (err) { toast(err.message, 'error') }
        })
      } catch (e) { toast(e.message, 'error') }
    }))
    m.querySelector('#b-pay').addEventListener('click', () => openPay())
    m.querySelector('#b-discount').addEventListener('click', async () => {
      const v = prompt('قيمة الخصم (' + cur.code + '):', S.check.discount || 0)
      if (v === null) return
      try { await api('/api/pos/checks/' + S.check.id + '/discount', { method: 'POST', body: { discount: parseFloat(v) || 0 }, auth: false }); modal.close(); openBill() } catch (e) { toast(e.message, 'error') }
    })
  }

  function openPay() {
    const t = tableById(S.tableId)
    const cur = S.curMap[S.check.currency_code] || S.base
    const active = S.currencies.filter((c) => c.is_active)
    const reqId = uid('pay')
    const m = modal.open(`
      <header class="modal-head"><h3><i class="fas fa-hand-holding-dollar"></i> تسجيل الدفع — طاولة ${t.number}</h3><button class="btn icon sm ghost" data-close><i class="fas fa-xmark"></i></button></header>
      <section class="modal-body">
        <div class="btotal" style="display:flex;justify-content:space-between;font-size:26px;font-weight:800"><span>المطلوب</span><span id="p-total">${money(S.check.total, cur)}</span></div>
        <div class="pay-grid" style="margin-top:14px">
          <div class="field"><label>عملة الدفع</label><select class="input" id="p-cur">${active.map((c) => `<option value="${c.code}" ${c.code === cur.code ? 'selected' : ''}>${esc(c.name)} (${esc(c.symbol)})</option>`).join('')}</select></div>
          <div class="field"><label>طريقة الدفع</label><select class="input" id="p-method"><option value="cash">نقدي</option><option value="card">بطاقة</option><option value="transfer">تحويل</option></select></div>
        </div>
        <div class="field"><label>المبلغ المستلم (اختياري)</label><input class="input" id="p-received" type="number" inputmode="decimal" step="any" placeholder="لحساب الباقي"></div>
        <div class="change-box hidden" id="p-change"><span>الباقي</span><span id="p-change-v"></span></div>
      </section>
      <footer class="modal-foot">
        <button class="btn" data-close>رجوع</button>
        <button class="btn success lg" id="p-confirm" data-busy-text="جارٍ التسجيل…"><i class="fas fa-check"></i> تأكيد الدفع وإغلاق الطاولة</button>
      </footer>`, { sticky: true })
    const curSel = m.querySelector('#p-cur'), rec = m.querySelector('#p-received')
    const upd = () => {
      const pc = S.curMap[curSel.value] || cur
      const total = KZ.convert(S.check.total, cur, pc)
      m.querySelector('#p-total').textContent = money(total, pc)
      const r = parseFloat(rec.value)
      const box = m.querySelector('#p-change')
      if (Number.isFinite(r) && r >= total) { box.classList.remove('hidden'); m.querySelector('#p-change-v').textContent = money(r - total, pc) } else box.classList.add('hidden')
    }
    curSel.addEventListener('change', upd)
    rec.addEventListener('input', upd)
    m.querySelector('#p-confirm').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      try {
        const r = await api('/api/pos/checks/' + S.check.id + '/pay', { method: 'POST', auth: false, timeout: 20000, body: { client_request_id: reqId, method: m.querySelector('#p-method').value, currency_code: curSel.value, received: rec.value === '' ? null : parseFloat(rec.value) } })
        modal.close()
        toast(S.boot.messages.payment_ok || 'تم تسجيل الدفع وإغلاق الطاولة', 'success')
        if (r.change_given) toast('الباقي: ' + money(r.change_given, S.curMap[curSel.value] || cur), 'info', 5000)
        S.draft = {}; saveDraft()
        await refreshTables()
        goTables()
      } catch (err) {
        toast((S.boot.messages.payment_fail || 'لا يمكن إتمام الدفع') + ': ' + err.message, 'error')
      }
    }))
  }

  // ---------- Init
  async function init() {
    try {
      await bootstrap()
    } catch (e) {
      root.innerHTML = `<div class="boot"><i class="fas fa-plug-circle-xmark"></i><p>${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">إعادة المحاولة</button></div>`
      return
    }
    renderShell()
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null') } catch (_) {}
    if (saved && saved.cat) S.activeCat = S.categories.some((c) => c.id === saved.cat) ? saved.cat : S.activeCat
    if (saved && saved.view === 'order' && saved.tableId && tableById(saved.tableId)) {
      await refreshTables()
      openTable(saved.tableId)
    } else {
      S.view = 'tables'
      renderTables()
      refreshTables()
    }
    flushOutbox()
    // periodic refresh (tables list + catalog) — cheap, keeps multiple iPads in sync
    const every = Math.max(4, S.boot.settings.pos_refresh_seconds || 8) * 1000
    setInterval(async () => {
      if (document.hidden) return
      await refreshTables()
      flushOutbox()
      if (S.view === 'order' && S.tableId && !S.sending) {
        try { await loadCheck(); const body = document.getElementById('ticket-body'); if (body && !document.querySelector('#modal-root.open')) { body.innerHTML = renderTicketBody(); document.getElementById('ticket-foot').innerHTML = renderTicketFoot(); bindTicket() } } catch (_) {}
      }
    }, every)
    setInterval(async () => { if (document.hidden) return; try { const cats = S.activeCat; await bootstrap(); S.activeCat = cats || S.activeCat; if (S.view === 'order' && !document.querySelector('#modal-root.open')) renderOrder() } catch (_) {} }, 60000)
    window.addEventListener('online', () => { setOnline(true); flushOutbox(); refreshTables() })
    window.addEventListener('offline', () => setOnline(false))
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshTables(); flushOutbox() } })
  }
  init()
})()
