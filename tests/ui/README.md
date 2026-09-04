# اختبارات المتصفح (Playwright)

```bash
npm i -D playwright && npx playwright install chromium   # مرة واحدة
mkdir -p tests/ui/shots
node tests/ui/pos-e2e.mjs      # سيناريو الطاولة 5 كاملاً عبر واجهة نقطة البيع
node tests/ui/admin-e2e.mjs    # لوحة التحكم: دخول، كل الصفحات، منتج بصورة، طابعة، عملات، مبيعات، إعدادات، iPad
```
يفترض أن الخادم يعمل على http://localhost:3000 (أو مرّر `BASE=...`).

# طابعة وهمية لاختبار الجسر
```bash
node tests/fake-printer.mjs 9100   # تستقبل بيانات ESC/POS وتسجّل حجمها
```
