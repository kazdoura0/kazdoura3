/** Admin session auth + bridge token auth */
import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AppEnv } from '../types'
import { first, run } from './db'
import { randomToken, HttpError } from './util'

const SESSION_HOURS = 12

export function adminPassword(env: AppEnv['Bindings']): string {
  return env.ADMIN_PASSWORD || ''
}

export async function createSession(db: D1Database, userAgent: string): Promise<string> {
  const token = randomToken(32)
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)
  await run(db, 'INSERT INTO admin_sessions (token, expires_at, user_agent) VALUES (?,?,?)', token, expires, userAgent.slice(0, 200))
  // opportunistic cleanup
  await run(db, "DELETE FROM admin_sessions WHERE expires_at < datetime('now')")
  return token
}

export async function validateSession(db: D1Database, token: string): Promise<boolean> {
  if (!token || token.length < 20) return false
  const row = await first<{ token: string }>(
    db,
    "SELECT token FROM admin_sessions WHERE token=? AND expires_at > datetime('now')",
    token
  )
  return !!row
}

export async function destroySession(db: D1Database, token: string) {
  if (token) await run(db, 'DELETE FROM admin_sessions WHERE token=?', token)
}

function extractToken(c: Context<AppEnv>): string {
  const auth = c.req.header('authorization') || ''
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim()
  return getCookie(c, 'kz_admin') || ''
}

/** Middleware: require valid admin session */
export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const token = extractToken(c)
  const ok = await validateSession(c.env.DB, token)
  if (!ok) throw new HttpError(401, 'يجب تسجيل الدخول كمدير', 'unauthorized')
  c.set('adminToken', token)
  await next()
}

/** Middleware: require bridge token (print agent) */
export async function requireBridge(c: Context<AppEnv>, next: Next) {
  const expected = c.env.BRIDGE_TOKEN || ''
  const auth = c.req.header('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : c.req.query('token') || ''
  if (!expected || token !== expected) throw new HttpError(401, 'رمز جسر الطباعة غير صحيح', 'unauthorized')
  await next()
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
