# كزدورة (Kazdoura) — نظام محاسبة وإدارة كافتيريا

نظام كامل لإدارة كافتيريا يعمل على **iPad للعامل** و**لابتوب للكاشير/الإدارة**، مبني بـ Hono + TypeScript على Cloudflare Pages مع قاعدة بيانات Cloudflare D1، وواجهة عربية بالكامل (RTL) مصممة للّمس.

## نظرة عامة

- **الاسم**: كزدورة (Kazdoura)
- **الهدف**: تسجيل الطلبات من الطاولات، توزيعها آلياً على طابعات المطبخ/البار، طباعة الفاتورة عند الطلب فقط، تسجيل المبيعات، وإدارة كل شيء من لوحة تحكم محمية.
- **الحالة**: ✅ **منشور على الإنتاج** — https://kazdoura.pages.dev (مختبر: API 95/95 · نقطة البيع E2E · لوحة التحكم 31/31 · جسر الطباعة · السيناريو الإلزامي على قاعدة الإنتاج).

## الروابط

| ما | الرابط |
|---|---|
| **الإنتاج** | **https://kazdoura.pages.dev** |
| GitHub | https://github.com/kazdoura0/kazdoura3 |
| نقطة البيع (iPad / كاشير) | `/` |
| لوحة التحكم | `/admin` |
| صفحة طباعة عبر المتصفح | `/print/job/:id` |
| فحص الصحة | `/api/health` |

> بيانات الدخول المحلية موجودة في `.dev.vars` (انظر `.dev.vars.example`). في الإنتاج تُضبط `ADMIN_PASSWORD` و`BRIDGE_TOKEN` كأسرار (secrets).

## الميزات المنجزة

### نقطة البيع (`/`)
- شبكة طاولات بحالات ملونة: `فارغة` / `مشغولة` / `فاتورة مطبوعة` / `بانتظار الدفع`، مع مدة الجلوس.
- شاشة الطلب: تصنيفات ← منتجات (صورة/اسم/سعر بعملة المنتج) ← سلة مع كمية وملاحظات، إرسال دفعة واحدة.
- **توزيع تلقائي حسب التصنيف**: كل تصنيف مرتبط بطابعة؛ الطلب الواحد ينقسم إلى تذاكر منفصلة (طابعة 1 بار، طابعة 2 معجنات...). طابعة الكاشير (3) **لا تطبع إلا عند "طباعة الفاتورة"** صراحة.
- طباعة الفاتورة (تحوّل الطاولة إلى `فاتورة مطبوعة`)، خصم، تحديد عملة الدفع، **الدفع** ← تسجيل بيع، إغلاق الشيك، تصفير الطاولة، الاحتفاظ بالتاريخ.
- شارات حالة طباعة حيّة لكل مهمة (قيد الانتظار/تُطبع/طُبعت/فشلت) مع زر **إعادة المحاولة** — مقيّدة بالطاولة الحالية فقط.
- حماية من ضياع البيانات: معرّف فريد لكل طلب (`client_request_id`) يمنع التكرار، صندوق صادر (outbox) في `localStorage` يعيد الإرسال عند انقطاع الشبكة، تعطيل الأزرار أثناء الإرسال، إعادة المحاولة التلقائية، وآمن عند تحديث الصفحة.
- عرض الأسعار بعدة عملات مع التحويل حسب أسعار الصرف المعرّفة.
- **وضع نهاري/ليلي** (زر القمر/الشمس في الشريط العلوي) يُحفظ لكل جهاز، ويتبع إعداد النظام افتراضياً.
- لا يوجد أي رابط إلى لوحة التحكم من نقطة البيع (الوصول عبر `/admin` مباشرة فقط).

### لوحة التحكم (`/admin`) — محمية بكلمة مرور
- **نظرة عامة**: مبيعات اليوم، الطاولات المفتوحة، مهام الطباعة المعلّقة/الفاشلة، حالة الطابعات.
- **المنتجات**: إضافة/تعديل (اسم، صورة، وصف، سعر، عملة، تصنيف)، تفعيل/تعطيل (لا حذف للمنتجات المستخدمة)، ترتيب.
- **التصنيفات**: ربط كل تصنيف بطابعة، ترتيب، تعطيل.
- **الطابعات**: نوع `network` (ESC/POS عبر الجسر) أو `browser` (طباعة من المتصفح)، عرض 58/80مم، اختبار طباعة، حالة آخر اتصال.
- **مهام الطباعة**: قائمة كاملة مع إعادة/إلغاء.
- **الطاولات**: إضافة/تعديل/حذف، إلغاء شيك مفتوح.
- **العملات**: إضافة عملات، تعديل أسعار الصرف (مع سجل تاريخي)، تحديد العملة الأساسية.
- **المبيعات**: قائمة بفلاتر التاريخ، تفاصيل كل بيع (لقطة كاملة للأصناف والأسعار وسعر الصرف وقت البيع)، تقرير المنتجات.
- **الإعدادات**: اسم المتجر، تذييل الفاتورة، رسائل الواجهة، سجل التدقيق.
- تعمل على اللابتوب وعلى iPad (عرض 768)، مع وضع نهاري/ليلي (زر في أسفل القائمة الجانبية).
- تصدير المبيعات CSV متوافق مع Excel (BOM + CRLF، التاريخ والوقت المحلي في عمودَين `YYYY-MM-DD` و`HH:MM`).

### جسر الطباعة (`bridge/`) — طباعة مباشرة حقيقية
وكيل Node.js يعمل على أي جهاز في شبكة المحل (لابتوب الكاشير مثلاً):
- يسحب المهام من الخادم (`/api/bridge/claim`) برمز `BRIDGE_TOKEN`.
- يرسم التذكرة عربياً بخط Noto Kufi Arabic (مضمّن) إلى صورة أحادية اللون ويرسلها كـ **ESC/POS raster** (`GS v 0`) عبر TCP منفذ 9100، ثم قطع الورق.
- إعادة محاولة، تهدئة 20 ثانية لكل طابعة غير متاحة (مع إعادة المهمة للطابور دون استهلاك محاولة)، نبضات heartbeat مع فحص وصول الطابعة، وضع `--dry-run` يحفظ التذاكر كصور PNG.
- تفاصيل التشغيل في [`bridge/README.md`](bridge/README.md).

## واجهات البرمجة (API)

جميع الأخطاء تعود بصيغة `{ ok:false, error:"رسالة عربية", code }`.

### نقطة البيع `/api/pos`
| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/bootstrap` | الإعدادات + العملات + التصنيفات + المنتجات + الطاولات |
| GET | `/tables` | الطاولات مع حالاتها ومجاميعها |
| GET | `/tables/:id/check` | الشيك المفتوح للطاولة بأصنافه |
| POST | `/tables/:id/orders` | إرسال طلب `{client_request_id, items:[{product_id, qty, note}]}` → تذاكر مطبخ |
| PATCH | `/items/:id` | تعديل كمية/إلغاء صنف |
| POST | `/checks/:id/bill` | طباعة الفاتورة على طابعة الكاشير `{client_request_id}` |
| POST | `/checks/:id/billing` | تحديد عملة الدفع |
| POST | `/checks/:id/discount` | خصم |
| POST | `/checks/:id/pay` | الدفع وإغلاق الشيك وتصفير الطاولة `{client_request_id, currency, amount}` |
| GET | `/print-jobs?ids=` | حالة مهام الطباعة |
| GET | `/print-jobs/:id` | مهمة واحدة مع محتوى التذكرة (لصفحة الطباعة) |
| POST | `/print-jobs/:id/retry` | إعادة محاولة |
| POST | `/print-jobs/:id/browser-done` | نتيجة الطباعة من المتصفح `{ok, error}` |

### الإدارة `/api/admin` (Bearer token أو كوكي `kz_admin`)
`POST /login` · `POST /logout` · `GET /me` · `GET /overview` · `PUT /settings` · `PUT /messages` ·
`POST|PUT|DELETE /currencies[/:code]` · `POST /currencies/:code/set-base` ·
`POST|PUT|DELETE /printers[/:id]` · `POST /printers/:id/test` · `GET /print-jobs` · `POST /print-jobs/:id/retry|cancel` ·
`POST|PUT|DELETE /categories[/:id]` · `POST /categories/reorder` ·
`POST|PUT|DELETE /products[/:id]` · `POST /products/reorder` ·
`POST|PUT|DELETE /tables[/:id]` · `POST /checks/:id/cancel` · `GET /checks/open` ·
`GET /sales` · `GET /sales/:id` · `GET /reports/products` · `GET /audit`

### جسر الطباعة `/api/bridge` (Bearer `BRIDGE_TOKEN`)
`GET /config` · `POST /claim` · `POST /jobs/:id/result` · `POST /jobs/:id/release` · `POST /heartbeat`

## بنية البيانات (Cloudflare D1)

`settings` · `messages` · `currencies` + `exchange_rate_history` · `printers` · `categories` (→ printer) · `products` (→ category, currency) · `tables` · `checks` (open/billing/paid/cancelled) · `orders` (idempotent عبر `client_request_id`) · `order_items` · `print_jobs` (pending→printing→printed/failed/cancelled، مع `payload` JSON للتذكرة) · `payments` · `sales` (لقطة كاملة للبيع) · `admin_sessions` · `audit_log`.

الترحيلات في `migrations/` (`0001_initial_schema.sql`, `0002_seed_defaults.sql` تحوي طابعات/تصنيفات/منتجات/طاولات افتراضية).

**تدفق البيانات**: iPad → `POST /tables/:id/orders` → معاملة D1 واحدة (`batch`) تنشئ الطلب والأصناف ومهام الطباعة مجمّعة حسب الطابعة → الجسر يسحب المهام ويطبع ويبلّغ النتيجة → الواجهة تستطلع الحالة وتعرضها.

## دليل الاستخدام

**العامل (iPad)**: افتح `/` → اضغط الطاولة → اختر التصنيف والمنتجات → عدّل الكميات/الملاحظات → **إرسال الطلب**. تُطبع التذاكر تلقائياً على طابعات المطبخ/البار.

**الكاشير**: من نفس الشاشة على الطاولة → **طباعة الفاتورة** (طابعة الكاشير فقط) → استلم المبلغ → **دفع** (اختر العملة) → تُصفّر الطاولة ويُسجّل البيع.

**الإدارة**: اكتب `https://kazdoura.pages.dev/admin` مباشرة في المتصفح → كلمة المرور → إدارة المنتجات/التصنيفات/الطابعات/العملات، متابعة الطباعة، والتقارير.

**جسر الطباعة**: على جهاز داخل شبكة المحل:
```bash
cd bridge && npm install
cp bridge.config.example.json bridge.config.json   # عدّل server و token
npm start            # أو npm run dry-run للتجربة بدون طابعة
```

## التطوير المحلي

```bash
npm install
npm run db:migrate:local      # ينشئ SQLite محلية في .wrangler/
npm run build
pm2 start ecosystem.config.cjs   # يشغّل wrangler pages dev على 3000
curl http://localhost:3000/api/health
```
ضع `ADMIN_PASSWORD` و`BRIDGE_TOKEN` في `.dev.vars` (انظر `.dev.vars.example`).

## الاختبارات

| الأمر | ماذا يفعل | آخر نتيجة |
|---|---|---|
| `npm run test:api` | 95 فحص API: السيناريو الإلزامي (طاولة 5: عصير برتقال + قهوة + فطيرة جبنة → P1 عصير+قهوة، P2 فطيرة، P3 لا شيء؛ طباعة الفاتورة → P3 فقط؛ الدفع → تصفير + بيع في التاريخ)، idempotency، أخطاء عربية، الإدارة، الجسر | ✅ 95/95 |
| `npm run test:ui` | Playwright: نفس السيناريو عبر واجهة نقطة البيع + لوحة التحكم كاملة (لابتوب + iPad) + الثيم/CSV | ✅ 0 أخطاء · 31/31 · 17/17 |
| `node tests/fake-printer.mjs 9100` | طابعة ESC/POS وهمية للتحقق من الجسر | ✅ raster 576 نقطة + قطع |

راجع `tests/ui/README.md` لتثبيت Playwright.

## النشر (Cloudflare Pages)

- **المنصة**: Cloudflare Pages + D1
- **التقنيات**: Hono · TypeScript · Vite · Wrangler 4 · Vanilla JS · D1 (SQLite)
- **الحالة**: ✅ نشط — مشروع Pages `kazdoura`، قاعدة D1 `kazdoura-production` (ENAM)، الأسرار `ADMIN_PASSWORD` و`BRIDGE_TOKEN` مضبوطة
- **GitHub**: https://github.com/kazdoura0/kazdoura3 (فرع `main`)

إعادة النشر بعد أي تعديل (يلزم `CLOUDFLARE_API_TOKEN` في البيئة):
```bash
npm run db:migrate:prod                                  # فقط إن أُضيفت ترحيلات جديدة
npm run build && npx wrangler pages deploy dist --project-name kazdoura --branch main
```
تغيير كلمة مرور الإدارة: `echo "القيمة" | npx wrangler pages secret put ADMIN_PASSWORD --project-name kazdoura` ثم إعادة النشر — أو من لوحة Cloudflare: Workers & Pages → kazdoura → Settings → Variables and Secrets → ADMIN_PASSWORD → Edit → Retry deployment.

جسر الطباعة في المحل: `server = https://kazdoura.pages.dev` و`token = BRIDGE_TOKEN`.

## ما لم يُنفَّذ بعد / خطوات مقترحة

- ربط Cloudflare Pages بمستودع GitHub للنشر التلقائي مع كل push، وربط دومين خاص.
- أدوار مستخدمين متعددة (عامل/كاشير/مدير) بدل كلمة مرور إدارية واحدة.
- دعم درج النقود وطابعات USB/Bluetooth في الجسر (البنية جاهزة: `openDrawer` في `ticket.js`).
- تصدير التقارير (CSV/Excel) وتقارير الورديات.
- إشعارات صوتية على iPad عند فشل الطباعة.

_آخر تحديث: 2026-09-04_
