# كزدورة — جسر الطباعة (Print Bridge)

برنامج صغير يعمل على جهاز داخل شبكة الكافيتيريا (الأفضل: لابتوب الكاشير) ويقوم بـ:

1. سحب مهام الطباعة المعلّقة من الخادم (`POST /api/bridge/claim`) — كل مهمة تُحجز مرة واحدة فقط (لا تكرار).
2. تحويل التذكرة إلى صورة (لأن الطابعات الحرارية لا تدعم تشكيل الحروف العربية) ثم إلى أوامر ESC/POS (`GS v 0`).
3. إرسالها عبر TCP إلى الطابعة (المنفذ 9100 عادةً).
4. إبلاغ الخادم بالنتيجة (`/result`) — نجاح ⇒ `printed`، فشل ⇒ إعادة محاولة تلقائية حتى الحد الأقصى ثم `failed` مع ظهور زر «إعادة» في نقطة البيع/لوحة التحكم.
5. نبضات دورية (`/heartbeat`) تُظهر في لوحة التحكم حالة كل طابعة (متصلة / غير متصلة) وآخر ظهور للجسر.

> الطابعات من نوع **متصفح** لا تحتاج الجسر؛ تُطبع من نافذة المتصفح مباشرة.

## المتطلبات
- Node.js 18 أو أحدث (Windows / macOS / Linux). `@napi-rs/canvas` يأتي مسبق البناء ولا يحتاج Python أو Visual Studio.
- الطابعات على نفس الشبكة المحلية مع IP ثابت، تدعم ESC/POS عبر TCP/9100 (أغلب طابعات 58/80 مم: Xprinter, Epson TM-T, Rongta, Sunmi…).
- الخطوط العربية مضمّنة في `fonts/` (Noto Kufi Arabic + Noto Sans — رخصة OFL).

## التشغيل
```bash
cd bridge
npm install
cp bridge.config.example.json bridge.config.json   # ثم عدّل server و token
npm start
```
أو عبر متغيرات البيئة:
```bash
# Windows (cmd)
set KZ_SERVER=https://your-app.pages.dev
set KZ_BRIDGE_TOKEN=xxxxx
node agent.js

# Linux / macOS
KZ_SERVER=https://your-app.pages.dev KZ_BRIDGE_TOKEN=xxxxx node agent.js
```
`KZ_BRIDGE_TOKEN` يجب أن يساوي السر `BRIDGE_TOKEN` المضبوط على الخادم (`wrangler pages secret put BRIDGE_TOKEN`).

### خيارات
| المفتاح | الوصف | الافتراضي |
|---|---|---|
| `server` / `KZ_SERVER` | عنوان التطبيق | — |
| `token` / `KZ_BRIDGE_TOKEN` | رمز الجسر | — |
| `agent` / `KZ_AGENT_NAME` | اسم يظهر في لوحة التحكم | اسم الجهاز |
| `poll_seconds` / `KZ_POLL_SECONDS` | فترة الاستطلاع | من إعدادات الخادم (3 ث) |
| `heartbeat_seconds` | فترة النبضات | 20 |
| `connect_timeout_ms` / `write_timeout_ms` | مهلات الاتصال | 4000 / 8000 |
| `beep_kitchen` | صفّارة عند طباعة طلب مطبخ | true |
| `dry_run` / `KZ_DRY_RUN=1` / `--dry-run` | لا يرسل للطابعة؛ يحفظ PNG في `out/` | false |

## التجربة بدون طابعة
```bash
node preview.js 80     # يولّد out/kitchen-80.png, bill-80.png, test-80.png + ملفات .bin (ESC/POS)
node preview.js 58
node agent.js --dry-run   # يسحب المهام الحقيقية ويحفظها كصور بدل الطباعة
```

## التشغيل الدائم
- **Windows**: أنشئ مهمة في Task Scheduler تعمل عند تسجيل الدخول: `node C:\kazdoura\bridge\agent.js`، أو استخدم `pm2`:
  ```bash
  npm i -g pm2
  pm2 start agent.js --name kz-bridge
  pm2 save && pm2 startup
  ```
- **Linux**: خدمة systemd أو pm2 بالطريقة نفسها.

## استكشاف الأخطاء
| الرسالة | السبب / الحل |
|---|---|
| `رمز الجسر غير صحيح (401)` | `KZ_BRIDGE_TOKEN` لا يطابق سر الخادم |
| `تعذر الاتصال بالطابعة x.x.x.x:9100 (ECONNREFUSED/EHOSTUNREACH)` | IP خاطئ أو الطابعة مطفأة أو جدار ناري. جرّب `telnet IP 9100` |
| `انتهت مهلة الاتصال` | الطابعة على شبكة أخرى / IP تغيّر (اضبط IP ثابتاً من الراوتر) |
| طباعة فارغة أو رموز غريبة | الطابعة لا تدعم `GS v 0` (نادر جداً) — تواصل معنا لتفعيل وضع `ESC *` |
| التذكرة مقطوعة من الجانب | عرض الورق في لوحة التحكم (58/80) لا يطابق الطابعة |

عند فشل الطابعة يدخل الجسر في فترة تهدئة 20 ثانية لتلك الطابعة ويُعيد المهام إلى «بالانتظار» دون استهلاك محاولة، ثم يحاول مجدداً.
