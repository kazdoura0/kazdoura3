/* Shared frontend utilities: API client, toasts, modals, money formatting, ids */
(function () {
  'use strict'

  const KZ = (window.KZ = window.KZ || {})

  KZ.uid = function (prefix) {
    const t = Date.now().toString(36)
    let r = ''
    if (window.crypto && crypto.getRandomValues) {
      const a = new Uint8Array(8)
      crypto.getRandomValues(a)
      r = Array.from(a, (b) => b.toString(36)).join('')
    } else r = Math.random().toString(36).slice(2)
    return (prefix || 'id') + '_' + t + r
  }

  KZ.token = {
    get() { return localStorage.getItem('kz_admin_token') || '' },
    set(t) { t ? localStorage.setItem('kz_admin_token', t) : localStorage.removeItem('kz_admin_token') },
  }

  /**
   * fetch wrapper. Resolves with JSON body (ok:true) or throws Error with .status/.code/.message (Arabic).
   * options: { method, body, headers, timeout, retries, auth }
   */
  KZ.api = async function (path, opts) {
    opts = opts || {}
    const method = opts.method || 'GET'
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {})
    if (opts.auth !== false && KZ.token.get()) headers['Authorization'] = 'Bearer ' + KZ.token.get()
    const retries = opts.retries === undefined ? (method === 'GET' ? 2 : 0) : opts.retries
    const timeout = opts.timeout || 15000
    let lastErr
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      try {
        const res = await fetch(path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: ctrl.signal, cache: 'no-store' })
        clearTimeout(timer)
        let data = null
        try { data = await res.json() } catch (_) { data = null }
        if (!res.ok || !data || data.ok === false) {
          const err = new Error((data && data.error) || (res.status === 401 ? 'يجب تسجيل الدخول' : res.status >= 500 ? 'حدث خطأ في الخادم' : 'تعذر تنفيذ العملية'))
          err.status = res.status
          err.code = data && data.code
          err.details = data && data.details
          err.data = data
          if (res.status >= 500 && attempt < retries) { lastErr = err; await KZ.sleep(400 * (attempt + 1)); continue }
          throw err
        }
        return data
      } catch (e) {
        clearTimeout(timer)
        if (e.name === 'AbortError' || e instanceof TypeError) {
          const err = new Error('تعذر الاتصال بالخادم — تحقق من الشبكة')
          err.status = 0
          err.code = 'network'
          lastErr = err
          if (attempt < retries) { await KZ.sleep(500 * (attempt + 1)); continue }
          throw err
        }
        throw e
      }
    }
    throw lastErr
  }

  KZ.sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // ---- Theme (light / dark). Persisted per device in localStorage; applied early by inline script in layout.
  KZ.theme = {
    get() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light' },
    set(t) {
      document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light')
      try { localStorage.setItem('kz_theme', t) } catch (_) {}
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', t === 'dark' ? '#0f0d0b' : '#1f1b16')
    },
    toggle() { KZ.theme.set(KZ.theme.get() === 'dark' ? 'light' : 'dark'); return KZ.theme.get() },
    /** HTML for a toggle button; call KZ.theme.bind(el) after insertion */
    button(cls) { return `<button class="${cls || 'btn icon'} theme-btn" type="button" data-theme-toggle title="الوضع الليلي / النهاري" aria-label="تبديل الوضع الليلي"><i class="fas fa-moon"></i><i class="fas fa-sun"></i></button>` },
    bind(root) { (root || document).querySelectorAll('[data-theme-toggle]').forEach((b) => { if (!b._kzTheme) { b._kzTheme = true; b.addEventListener('click', () => KZ.theme.toggle()) } }) }
  }

  KZ.esc = function (s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  KZ.money = function (amount, cur) {
    cur = cur || { symbol: '', decimals: 2, code: '' }
    const d = Math.max(0, Math.min(4, cur.decimals === undefined ? 2 : cur.decimals))
    const n = Number(amount || 0)
    const f = Math.pow(10, d)
    const v = (Math.round((n + Number.EPSILON) * f) / f).toFixed(d)
    return v + ' ' + (cur.symbol || cur.code || '')
  }

  KZ.convert = function (amount, from, to) {
    if (!from || !to || from.code === to.code) return amount
    return (amount * (from.rate_to_base || 1)) / (to.rate_to_base || 1)
  }

  KZ.fmtTime = function (iso) {
    if (!iso) return ''
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
    if (isNaN(d)) return iso
    return d.toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
  }
  KZ.fmtDateTime = function (iso) {
    if (!iso) return ''
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
    if (isNaN(d)) return iso
    return d.toLocaleString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }
  /** Local date/time parts for spreadsheets: { date: 'YYYY-MM-DD', time: 'HH:MM' } */
  KZ.csvDate = function (iso) {
    if (!iso) return { date: '', time: '' }
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
    if (isNaN(d)) return { date: iso, time: '' }
    const p = (n) => String(n).padStart(2, '0')
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` }
  }
  KZ.elapsed = function (iso) {
    if (!iso) return ''
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
    const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000))
    if (m < 1) return 'الآن'
    if (m < 60) return m + ' د'
    return Math.floor(m / 60) + ' س ' + (m % 60) + ' د'
  }

  // ---- Toasts
  KZ.toast = function (msg, type, ms) {
    const root = document.getElementById('toast-root')
    if (!root) return
    const el = document.createElement('div')
    el.className = 'toast ' + (type || 'info')
    const icon = type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-xmark' : type === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-info'
    el.innerHTML = '<i class="fas ' + icon + '"></i><span>' + KZ.esc(msg) + '</span>'
    root.appendChild(el)
    requestAnimationFrame(() => el.classList.add('show'))
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300) }, ms || (type === 'error' ? 4500 : 2600))
  }

  // ---- Modal
  KZ.modal = {
    open(html, opts) {
      opts = opts || {}
      const root = document.getElementById('modal-root')
      root.innerHTML = '<div class="modal-backdrop"><div class="modal ' + (opts.size || '') + '" role="dialog" aria-modal="true">' + html + '</div></div>'
      root.classList.add('open')
      const bd = root.querySelector('.modal-backdrop')
      if (!opts.sticky) bd.addEventListener('click', (e) => { if (e.target === bd) KZ.modal.close() })
      root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => KZ.modal.close()))
      return root.querySelector('.modal')
    },
    close() {
      const root = document.getElementById('modal-root')
      root.classList.remove('open')
      root.innerHTML = ''
      if (KZ.modal.onClose) { const f = KZ.modal.onClose; KZ.modal.onClose = null; f() }
    },
    confirm(title, text, opts) {
      opts = opts || {}
      return new Promise((resolve) => {
        const m = KZ.modal.open(
          '<header class="modal-head"><h3>' + KZ.esc(title) + '</h3></header><section class="modal-body"><p>' + KZ.esc(text) + '</p></section>' +
          '<footer class="modal-foot"><button class="btn" data-close>' + KZ.esc(opts.cancel || 'إلغاء') + '</button><button class="btn ' + (opts.danger ? 'danger' : 'primary') + '" id="m-ok">' + KZ.esc(opts.ok || 'تأكيد') + '</button></footer>'
        )
        KZ.modal.onClose = () => resolve(false)
        m.querySelector('#m-ok').addEventListener('click', () => { KZ.modal.onClose = null; KZ.modal.close(); resolve(true) })
      })
    },
  }

  /** Guard a button against double clicks while an async fn runs */
  KZ.busy = async function (btn, fn) {
    if (!btn || btn.dataset.busy === '1') return
    btn.dataset.busy = '1'
    const prev = btn.innerHTML
    btn.disabled = true
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + (btn.dataset.busyText || 'جارٍ التنفيذ…')
    try { return await fn() } finally {
      btn.disabled = false
      btn.innerHTML = prev
      delete btn.dataset.busy
    }
  }

  KZ.debounce = function (fn, ms) { let t; return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(null, a), ms) } }
})()
