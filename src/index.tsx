import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppEnv } from './types'
import { HttpError } from './lib/util'
import pos from './routes/pos'
import admin from './routes/admin'
import bridge from './routes/bridge'
import { posPage } from './pages/pos'
import { adminPage } from './pages/admin'
import { printPage } from './pages/print'

const app = new Hono<AppEnv>()

app.use('/api/*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }))
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await next()
})

// Central error handling: friendly Arabic message + technical details in logs
app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ ok: false, error: err.message, code: err.code }, err.status as any)
  }
  console.error('Unhandled error', c.req.method, c.req.path, err)
  const msg = String((err as any)?.message || err)
  const isDb = /D1|SQLITE|database/i.test(msg)
  return c.json({ ok: false, error: isDb ? 'حدث خطأ أثناء حفظ البيانات' : 'حدث خطأ غير متوقع', code: 'internal', details: msg.slice(0, 300) }, 500)
})
app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ ok: false, error: 'المسار غير موجود' }, 404) : c.html('<h1 style="font-family:sans-serif;text-align:center;margin-top:20vh">404 — الصفحة غير موجودة</h1>', 404)))

// APIs
app.route('/api/pos', pos)
app.route('/api/admin', admin)
app.route('/api/bridge', bridge)
app.get('/api/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ ok: true, db: true, time: new Date().toISOString() })
  } catch (e) {
    return c.json({ ok: false, db: false, error: String(e) }, 500)
  }
})

// Pages
app.get('/', (c) => c.html(posPage()))
app.get('/pos', (c) => c.redirect('/'))
app.get('/admin', (c) => c.html(adminPage()))
app.get('/print/job/:id', (c) => c.html(printPage(c.req.param('id'))))

export default app
