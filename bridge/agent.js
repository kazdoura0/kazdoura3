#!/usr/bin/env node
/**
 * Kazdoura Print Bridge — local print agent
 * ------------------------------------------
 * Runs on any machine inside the cafeteria network (the cashier laptop is ideal).
 * It connects the cloud app to the physical ESC/POS printers:
 *
 *   loop every N seconds:
 *     POST /api/bridge/claim      → get pending jobs for network printers (atomically claimed)
 *     render ticket → ESC/POS raster → TCP <printer host>:<port> (default 9100)
 *     POST /api/bridge/jobs/:id/result   { ok, error }
 *   every ~20s:
 *     probe each printer's TCP port, POST /api/bridge/heartbeat with reachability
 *
 * Config (env vars or bridge.config.json next to this file):
 *   KZ_SERVER         https://your-app.pages.dev   (required)
 *   KZ_BRIDGE_TOKEN   must equal the server's BRIDGE_TOKEN secret (required)
 *   KZ_AGENT_NAME     label shown in the admin panel (default: hostname)
 *   KZ_DRY_RUN=1      render + save PNGs to ./out instead of sending to printers (testing)
 *   KZ_POLL_SECONDS   override polling interval
 */
'use strict'
const fs = require('fs')
const os = require('os')
const net = require('net')
const path = require('path')
const { buildEscPos, renderTicket } = require('./ticket')

// ---------- config
let fileCfg = {}
try { fileCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'bridge.config.json'), 'utf8')) } catch (_) {}
const CFG = {
  server: (process.env.KZ_SERVER || fileCfg.server || '').replace(/\/+$/, ''),
  token: process.env.KZ_BRIDGE_TOKEN || fileCfg.token || '',
  agent: process.env.KZ_AGENT_NAME || fileCfg.agent || os.hostname(),
  dryRun: process.env.KZ_DRY_RUN === '1' || fileCfg.dry_run === true || process.argv.includes('--dry-run'),
  pollSeconds: Number(process.env.KZ_POLL_SECONDS || fileCfg.poll_seconds || 0) || 0,
  connectTimeoutMs: Number(fileCfg.connect_timeout_ms || 4000),
  writeTimeoutMs: Number(fileCfg.write_timeout_ms || 8000),
  heartbeatSeconds: Number(fileCfg.heartbeat_seconds || 20),
  beepKitchen: fileCfg.beep_kitchen !== false,
}
if (!CFG.server || !CFG.token) {
  console.error('✖ يجب ضبط KZ_SERVER و KZ_BRIDGE_TOKEN (متغيرات بيئة أو bridge.config.json). راجع bridge/README.md')
  process.exit(1)
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ---------- http helper (Node 18+ has global fetch)
async function api(p, body) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(CFG.server + p, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CFG.token, 'User-Agent': 'kazdoura-bridge/1.0' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
    const txt = await res.text()
    let data = {}
    try { data = JSON.parse(txt) } catch (_) { data = { ok: false, error: txt.slice(0, 200) } }
    if (res.status === 401) throw new Error('رمز الجسر (BRIDGE_TOKEN) غير صحيح — الخادم رفض الاتصال (401)')
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  } finally { clearTimeout(t) }
}

// ---------- printer I/O
function sendToPrinter(host, port, bytes) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket()
    let done = false
    const finish = (err) => { if (done) return; done = true; clearTimeout(ct); clearTimeout(wt); sock.destroy(); err ? reject(err) : resolve() }
    const ct = setTimeout(() => finish(new Error(`انتهت مهلة الاتصال بالطابعة ${host}:${port}`)), CFG.connectTimeoutMs)
    let wt
    sock.once('error', (e) => finish(new Error(`تعذر الاتصال بالطابعة ${host}:${port} (${e.code || e.message})`)))
    sock.connect(port, host, () => {
      clearTimeout(ct)
      wt = setTimeout(() => finish(new Error(`انتهت مهلة الإرسال إلى الطابعة ${host}:${port}`)), CFG.writeTimeoutMs)
      sock.write(bytes, (err) => {
        if (err) return finish(err)
        // give the printer a moment to drain its buffer before closing
        sock.end()
        setTimeout(() => finish(), 300)
      })
    })
  })
}

function probe(host, port) {
  return new Promise((resolve) => {
    const s = new net.Socket()
    const t = setTimeout(() => { s.destroy(); resolve({ online: false, error: 'timeout' }) }, 2500)
    s.once('error', (e) => { clearTimeout(t); s.destroy(); resolve({ online: false, error: e.code || e.message }) })
    s.connect(port, host, () => { clearTimeout(t); s.destroy(); resolve({ online: true }) })
  })
}

// ---------- job processing
async function processJob(job) {
  const doc = job.payload
  const opts = { beep: CFG.beepKitchen && job.job_type === 'kitchen', partialCut: false }
  log(`⇢ job ${job.id} (${job.job_type}) → ${job.printer_name} @ ${job.host}:${job.port}`)
  try {
    if (!job.host) throw new Error('الطابعة بلا عنوان IP')
    if (CFG.dryRun) {
      const outDir = path.join(__dirname, 'out')
      fs.mkdirSync(outDir, { recursive: true })
      const { canvas } = renderTicket(doc)
      const file = path.join(outDir, `${job.id}.png`)
      fs.writeFileSync(file, canvas.toBuffer('image/png'))
      log(`  (dry run) saved ${file}`)
    } else {
      const bytes = buildEscPos(doc, opts)
      await sendToPrinter(job.host, Number(job.port) || 9100, bytes)
    }
    await api(`/api/bridge/jobs/${job.id}/result`, { ok: true, agent: CFG.agent })
    log(`  ✓ printed ${job.id}`)
  } catch (e) {
    log(`  ✖ ${job.id}: ${e.message}`)
    if (/تعذر الاتصال|انتهت مهلة/.test(e.message)) cooldownUntil.set(job.printer_id, Date.now() + COOLDOWN_MS)
    try { await api(`/api/bridge/jobs/${job.id}/result`, { ok: false, error: e.message, agent: CFG.agent }) } catch (e2) { log('  ! could not report result:', e2.message) }
  }
}

let printers = []
let pollSeconds = 3
let stopping = false
// per-printer cooldown after a connection failure, so an offline printer isn't hammered every poll
const cooldownUntil = new Map()
const COOLDOWN_MS = 20000

async function loadConfig() {
  const r = await api('/api/bridge/config')
  printers = r.printers || []
  if (!CFG.pollSeconds) pollSeconds = Math.max(1, Number(r.poll_seconds) || 3)
  else pollSeconds = CFG.pollSeconds
  return r
}

async function heartbeat() {
  try {
    const statuses = await Promise.all(printers.filter((p) => p.is_active).map(async (p) => {
      const r = p.host ? await probe(p.host, Number(p.port) || 9100) : { online: false, error: 'no host' }
      if (!r.online) cooldownUntil.set(p.id, Date.now() + COOLDOWN_MS)
      return { id: p.id, online: r.online, error: r.error }
    }))
    await api('/api/bridge/heartbeat', { agent: CFG.agent, printers: statuses, version: '1.0.0' })
    for (const s of statuses) if (s.online) cooldownUntil.delete(s.id)
    const off = statuses.filter((s) => !s.online)
    if (off.length) log('♥ heartbeat — offline:', off.map((s) => `${printers.find((p) => p.id === s.id)?.name} (${s.error})`).join(', '))
  } catch (e) { log('♥ heartbeat failed:', e.message) }
}

async function pollOnce() {
  const r = await api('/api/bridge/claim', { agent: CFG.agent, limit: 10 })
  // print sequentially per printer so tickets don't interleave; different printers in parallel
  const byPrinter = new Map()
  for (const j of r.jobs || []) { if (!byPrinter.has(j.printer_id)) byPrinter.set(j.printer_id, []); byPrinter.get(j.printer_id).push(j) }
  await Promise.all([...byPrinter.entries()].map(async ([pid, list]) => {
    for (const j of list) {
      if ((cooldownUntil.get(pid) || 0) > Date.now()) {
        // printer recently unreachable: release the job back without consuming an attempt
        await api(`/api/bridge/jobs/${j.id}/release`, { agent: CFG.agent }).catch(() => {})
        continue
      }
      await processJob(j)
    }
  }))
  return (r.jobs || []).filter((j) => (cooldownUntil.get(j.printer_id) || 0) <= Date.now()).length
}

async function main() {
  log(`Kazdoura Print Bridge — agent "${CFG.agent}"${CFG.dryRun ? ' [DRY RUN]' : ''}`)
  log(`server: ${CFG.server}`)
  let backoff = 2
  while (!stopping) {
    try { await loadConfig(); break } catch (e) {
      log(`✖ config: ${e.message} — retry in ${backoff}s`)
      await sleep(backoff * 1000); backoff = Math.min(60, backoff * 2)
    }
  }
  log(`printers: ${printers.map((p) => `${p.name}@${p.host}:${p.port}${p.is_active ? '' : ' (معطلة)'}`).join(' | ') || 'none'}; poll every ${pollSeconds}s`)
  await heartbeat()
  let lastHb = Date.now(), lastCfg = Date.now(), failures = 0
  while (!stopping) {
    try {
      const n = await pollOnce()
      failures = 0
      if (n) continue // drain quickly when busy
    } catch (e) {
      failures++
      log(`✖ poll: ${e.message}`)
    }
    if (Date.now() - lastHb > CFG.heartbeatSeconds * 1000) { await heartbeat(); lastHb = Date.now() }
    if (Date.now() - lastCfg > 60000) { try { await loadConfig(); lastCfg = Date.now() } catch (_) {} }
    await sleep(Math.min(30, pollSeconds * Math.min(8, 1 + failures)) * 1000)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
process.on('SIGINT', () => { stopping = true; log('stopping…'); setTimeout(() => process.exit(0), 200) })
process.on('SIGTERM', () => { stopping = true; setTimeout(() => process.exit(0), 200) })
process.on('unhandledRejection', (e) => log('unhandled:', e && e.message))

main().catch((e) => { console.error(e); process.exit(1) })
