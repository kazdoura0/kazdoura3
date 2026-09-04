/* Kazdoura — browser print page
 * Loads a print job, renders the ticket, triggers window.print(),
 * then reports the result back so the job leaves the "printing" state.
 */
;(function () {
  const root = document.getElementById('ticket')
  const jobId = root.dataset.job
  const bar = document.getElementById('print-bar')
  const btnPrint = document.getElementById('btn-print')
  const btnDone = document.getElementById('btn-done')
  const btnFail = document.getElementById('btn-fail')
  const hint = document.createElement('div')
  hint.className = 'hint'
  bar.appendChild(hint)

  let job = null
  let reported = false
  const auto = new URLSearchParams(location.search).get('auto') !== '0'

  const e = KZ.esc
  const n = (v, cur) => KZ.money(v, cur)

  function renderDoc(d) {
    const cls = ['ticket', d.kind, d.paper_width === 58 ? 'w58' : 'w80']
    root.className = cls.join(' ')
    const cur = d.currency || { symbol: '', decimals: 2, code: '' }
    let h = ''
    h += `<div class="store">${e(d.store_name || 'كزدورة')}</div>`
    if (d.kind === 'kitchen') {
      h += `<div class="title">${e(d.title)}</div>`
      h += `<div class="hdr">${e(d.header || 'طلب جديد')}</div>`
      h += `<div class="meta"><span>طاولة <b class="tbl">${e(d.table_number)}</b></span><span>طلب #${e(d.order_seq || '')}<br>${e(KZ.fmtDateTime(d.created_at))}</span></div>`
      h += `<div class="sep"></div><table class="lines">`
      for (const l of d.lines || []) {
        h += `<tr><td class="qty">${e(l.qty)} ×</td><td>${e(l.name)}${l.note ? `<span class="note">${e(l.note)}</span>` : ''}</td></tr>`
      }
      h += `</table><div class="sep"></div>`
      if (d.footer) h += `<div class="foot">${e(d.footer)}</div>`
    } else if (d.kind === 'bill') {
      h += `<div class="title">${e(d.header || d.title || 'فاتورة')}</div>`
      h += `<div class="meta"><span>طاولة <b class="tbl">${e(d.table_number)}</b></span><span>${e(KZ.fmtDateTime(d.created_at))}</span></div>`
      h += `<div class="sep"></div><table class="lines">`
      for (const l of d.lines || []) {
        h += `<tr><td class="qty">${e(l.qty)} ×</td><td>${e(l.name)}${l.note ? `<span class="note">${e(l.note)}</span>` : ''}</td><td class="amt">${e(n(l.line_total ?? (l.unit_price || 0) * l.qty, cur))}</td></tr>`
      }
      h += `</table><div class="sep"></div>`
      if (d.discount && d.discount > 0) {
        h += `<div class="tot"><span>المجموع</span><span class="n">${e(n(d.subtotal, cur))}</span></div>`
        h += `<div class="tot"><span>خصم</span><span class="n">- ${e(n(d.discount, cur))}</span></div>`
      }
      h += `<div class="tot grand"><span>الإجمالي</span><span class="n">${e(n(d.total ?? d.subtotal, cur))}</span></div>`
      for (const s of d.secondary_totals || []) {
        h += `<div class="tot sec"><span>≈ ${e(s.code)}</span><span class="n">${e(n(s.amount, s))}</span></div>`
      }
      if (d.footer) h += `<div class="foot">${e(d.footer)}</div>`
      if (d.check_id) h += `<div class="small">${e(d.check_id)}</div>`
    } else {
      h += `<div class="hdr">${e(d.header || 'اختبار طباعة')}</div>`
      h += `<div class="title">${e(d.title)}</div>`
      h += `<div class="meta"><span>${e(KZ.fmtDateTime(d.created_at))}</span></div>`
      for (const l of d.lines || []) h += `<div>${e(l.qty)} × ${e(l.name)}</div>`
      if (d.footer) h += `<div class="foot">${e(d.footer)}</div>`
    }
    h += `<div class="small">${e(jobId)}</div>`
    root.innerHTML = h
    document.title = (d.kind === 'bill' ? 'فاتورة' : d.kind === 'kitchen' ? 'طلب' : 'اختبار') + (d.table_number ? ' — طاولة ' + d.table_number : '')
  }

  async function report(ok, error) {
    if (reported) return
    reported = true
    try {
      await KZ.api('/api/pos/print-jobs/' + encodeURIComponent(jobId) + '/browser-done', { method: 'POST', body: { ok, error: error || '' } })
      hint.className = 'hint ' + (ok ? 'ok' : 'bad')
      hint.textContent = ok ? 'تم تسجيل الطباعة بنجاح — يمكنك إغلاق هذه النافذة.' : 'سُجّلت المهمة كفاشلة.'
      btnDone.disabled = true
      btnFail.disabled = true
      if (ok) setTimeout(() => { try { window.close() } catch (_) {} }, 1200)
    } catch (err) {
      reported = false
      hint.className = 'hint bad'
      hint.textContent = 'تعذّر إبلاغ الخادم: ' + (err.message || err)
    }
  }

  function doPrint() {
    if (!job) return
    hint.className = 'hint'
    hint.textContent = 'إن اكتملت الطباعة اضغط "تمت الطباعة"، أو "فشلت" إن لم تخرج الورقة.'
    // afterprint fires on both print & cancel in most browsers; we cannot know which, so let the user confirm.
    window.print()
  }

  async function load() {
    try {
      const r = await KZ.api('/api/pos/print-jobs/' + encodeURIComponent(jobId))
      job = r.job
      renderDoc(job.payload)
      if (job.printer_type && job.printer_type !== 'browser') {
        hint.className = 'hint bad'
        hint.textContent = 'هذه المهمة مرتبطة بطابعة شبكية (' + (job.printer_name || '') + ') ويطبعها جسر الطباعة، لكن يمكنك طباعتها من هنا كنسخة احتياطية.'
        btnDone.disabled = true
        btnFail.disabled = true
      } else if (job.status === 'printed') {
        hint.className = 'hint ok'
        hint.textContent = 'هذه المهمة مطبوعة مسبقاً (' + KZ.fmtDateTime(job.printed_at) + '). إعادة الطباعة لن تغيّر حالتها.'
        btnDone.disabled = true
        btnFail.disabled = true
      } else if (auto) {
        setTimeout(doPrint, 300)
      }
    } catch (err) {
      root.innerHTML = `<p class="err">${e(err.message || 'تعذّر تحميل المهمة')}</p>`
      btnPrint.disabled = true
      btnDone.disabled = true
    }
  }

  btnPrint.addEventListener('click', doPrint)
  btnDone.addEventListener('click', () => report(true))
  btnFail.addEventListener('click', () => report(false, 'فشل الطباعة من المتصفح'))
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && job && !reported && !btnDone.disabled) report(true)
  })
  load()
})()
