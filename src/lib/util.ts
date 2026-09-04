/** Shared helpers: ids, time, errors, money */
import type { Currency } from '../types'

export function newId(prefix: string): string {
  const t = Date.now().toString(36)
  const r = crypto.getRandomValues(new Uint8Array(6))
  const rs = Array.from(r, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10)
  return `${prefix}_${t}${rs}`
}

export function randomToken(bytes = 32): string {
  const r = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = 'error') {
    super(message)
    this.status = status
    this.code = code
  }
}

export function bad(message: string, code = 'bad_request'): never {
  throw new HttpError(400, message, code)
}
export function notFound(message = 'غير موجود'): never {
  throw new HttpError(404, message, 'not_found')
}
export function conflict(message: string): never {
  throw new HttpError(409, message, 'conflict')
}

export function toInt(v: unknown, def = 0): number {
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : def
}
export function toNum(v: unknown, def = 0): number {
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : def
}
export function toBool01(v: unknown, def = 1): number {
  if (v === undefined || v === null || v === '') return def
  if (typeof v === 'boolean') return v ? 1 : 0
  const s = String(v).toLowerCase()
  return s === '1' || s === 'true' || s === 'on' ? 1 : 0
}
export function str(v: unknown, max = 500): string {
  if (v === undefined || v === null) return ''
  return String(v).trim().slice(0, max)
}

/** Round money to currency decimals */
export function roundMoney(amount: number, decimals: number): number {
  const f = Math.pow(10, Math.max(0, Math.min(4, decimals)))
  return Math.round((amount + Number.EPSILON) * f) / f
}

/** Convert amount from one currency to another using rate_to_base */
export function convert(amount: number, from: Currency, to: Currency): number {
  if (from.code === to.code) return roundMoney(amount, to.decimals)
  const inBase = amount * (from.rate_to_base || 1)
  const out = inBase / (to.rate_to_base || 1)
  return roundMoney(out, to.decimals)
}

export function formatMoney(amount: number, cur: { symbol: string; decimals: number; code: string }): string {
  const n = roundMoney(amount, cur.decimals).toFixed(cur.decimals)
  return `${n} ${cur.symbol || cur.code}`
}
