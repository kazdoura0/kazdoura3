/**
 * Print Bridge API — consumed by the local print agent (bridge/agent.js).
 * The agent polls for pending jobs, claims them, prints via TCP 9100 (ESC/POS), reports results,
 * and sends heartbeats with printer reachability.
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireBridge } from '../lib/auth'
import { all, first, run, getSettings } from '../lib/db'
import { str, toInt } from '../lib/util'

const bridge = new Hono<AppEnv>()
bridge.use('*', requireBridge)

/** Printers config for the agent (only network printers) */
bridge.get('/config', async (c) => {
  const printers = await all<any>(c.env.DB, "SELECT id, name, type, host, port, paper_width, role, is_active FROM printers WHERE type='network' ORDER BY id")
  const settings = await getSettings(c.env.DB)
  return c.json({ ok: true, printers, poll_seconds: toInt(settings.bridge_poll_seconds, 3), store_name: settings.store_name })
})

/** Claim pending jobs (atomic per job via conditional UPDATE) */
bridge.post('/claim', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => ({}))
  const agent = str(body.agent, 80) || 'bridge'
  const limit = Math.min(20, Math.max(1, toInt(body.limit, 10)))
  // release stale claims (>2 minutes)
  await run(db, "UPDATE print_jobs SET status='pending', claimed_by=NULL, claimed_at=NULL WHERE status='printing' AND claimed_at < datetime('now','-2 minutes')")
  const candidates = await all<{ id: string }>(
    db,
    `SELECT pj.id FROM print_jobs pj JOIN printers p ON p.id=pj.printer_id
     WHERE pj.status='pending' AND p.type='network' AND p.is_active=1 AND pj.attempts < pj.max_attempts
     ORDER BY pj.created_at LIMIT ?`,
    limit
  )
  const claimed: any[] = []
  for (const cnd of candidates) {
    const r = await run(db, "UPDATE print_jobs SET status='printing', claimed_by=?, claimed_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status='pending'", agent, cnd.id)
    if (r.meta.changes === 1) {
      const job = await first<any>(
        db,
        `SELECT pj.id, pj.printer_id, pj.job_type, pj.payload, pj.attempts, pj.max_attempts, p.host, p.port, p.paper_width, p.name printer_name
         FROM print_jobs pj JOIN printers p ON p.id=pj.printer_id WHERE pj.id=?`,
        cnd.id
      )
      if (job) claimed.push({ ...job, payload: JSON.parse(job.payload) })
    }
  }
  return c.json({ ok: true, jobs: claimed })
})

/** Report job result */
bridge.post('/jobs/:id/result', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => ({}))
  const id = c.req.param('id')
  const job = await first<any>(db, 'SELECT id, attempts, max_attempts, printer_id FROM print_jobs WHERE id=?', id)
  if (!job) return c.json({ ok: false, error: 'not found' }, 404)
  const attempts = job.attempts + 1
  if (body.ok) {
    await run(db, "UPDATE print_jobs SET status='printed', attempts=?, printed_at=datetime('now'), last_error='', updated_at=datetime('now') WHERE id=?", attempts, id)
    if (job.printer_id) await run(db, "UPDATE printers SET last_status='online', last_error='', last_seen_at=datetime('now') WHERE id=?", job.printer_id)
  } else {
    const err = str(body.error, 300) || 'فشل غير معروف'
    const final = attempts >= job.max_attempts
    // if not final -> back to pending for a retry on next poll
    await run(db, "UPDATE print_jobs SET status=?, attempts=?, last_error=?, claimed_by=NULL, claimed_at=NULL, updated_at=datetime('now') WHERE id=?", final ? 'failed' : 'pending', attempts, err, id)
    if (job.printer_id) await run(db, "UPDATE printers SET last_status='error', last_error=?, last_seen_at=datetime('now') WHERE id=?", err, job.printer_id)
  }
  return c.json({ ok: true })
})

/** Release a claimed job back to pending WITHOUT consuming an attempt (printer temporarily unreachable) */
bridge.post('/jobs/:id/release', async (c) => {
  const r = await run(
    c.env.DB,
    "UPDATE print_jobs SET status='pending', claimed_by=NULL, claimed_at=NULL, updated_at=datetime('now') WHERE id=? AND status='printing'",
    c.req.param('id')
  )
  return c.json({ ok: true, released: r.meta.changes === 1 })
})

/** Heartbeat: agent reports reachability of each printer */
bridge.post('/heartbeat', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => ({}))
  const statuses: { id: number; online: boolean; error?: string }[] = Array.isArray(body.printers) ? body.printers : []
  const stmts = statuses.map((s) =>
    db
      .prepare("UPDATE printers SET last_status=?, last_error=?, last_seen_at=datetime('now') WHERE id=?")
      .bind(s.online ? 'online' : 'offline', s.online ? '' : str(s.error, 200), toInt(s.id))
  )
  stmts.push(db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('bridge_last_seen', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").bind(new Date().toISOString()))
  stmts.push(db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('bridge_agent', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").bind(str(body.agent, 80) || 'bridge'))
  await db.batch(stmts)
  return c.json({ ok: true })
})

export default bridge
