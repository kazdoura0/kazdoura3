-- Default data (editable from admin panel)
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('store_name', 'كزدورة'),
  ('store_subtitle', 'كافيتيريا'),
  ('store_phone', ''),
  ('store_address', ''),
  ('receipt_logo_text', 'كزدورة'),
  ('default_table_count', '10'),
  ('pos_refresh_seconds', '8'),
  ('bridge_poll_seconds', '3'),
  ('print_job_max_attempts', '5'),
  ('show_prices_in_secondary', '1');

INSERT OR IGNORE INTO messages (key, label, value) VALUES
  ('bill_header', 'ترويسة الفاتورة', 'أهلاً وسهلاً بكم في كزدورة'),
  ('bill_footer', 'تذييل الفاتورة', 'شكراً لزيارتكم — نتمنى لكم يوماً سعيداً'),
  ('kitchen_header', 'ترويسة تذكرة القسم', 'طلب جديد'),
  ('pos_welcome', 'رسالة ترحيب الواجهة', 'اختر طاولة للبدء'),
  ('order_sent_ok', 'تم إرسال الطلب', 'تم إرسال الطلب بنجاح'),
  ('order_sent_fail', 'تعذر إرسال الطلب', 'تعذر إرسال الطلب، حاول مرة أخرى'),
  ('print_fail', 'فشل الطباعة', 'تعذر الاتصال بالطابعة'),
  ('payment_ok', 'تم الدفع', 'تم تسجيل الدفع وإغلاق الطاولة'),
  ('payment_fail', 'فشل الدفع', 'لا يمكن إتمام الدفع الآن');

INSERT OR IGNORE INTO currencies (code, name, symbol, decimals, is_base, rate_to_base, is_active, sort_order) VALUES
  ('USD', 'دولار أمريكي', '$', 2, 1, 1, 1, 1),
  ('TRY', 'ليرة تركية', '₺', 2, 0, 0.03, 1, 2),
  ('SYP', 'ليرة سورية', 'ل.س', 0, 0, 0.0000769, 1, 3);

INSERT OR IGNORE INTO printers (id, name, type, host, port, paper_width, role, sort_order) VALUES
  (1, 'طابعة البار / المشروبات', 'network', '192.168.1.201', 9100, 80, 'kitchen', 1),
  (2, 'طابعة المعجنات', 'network', '192.168.1.202', 9100, 80, 'kitchen', 2),
  (3, 'طابعة الكاشير', 'network', '192.168.1.203', 9100, 80, 'cashier', 3);

INSERT OR IGNORE INTO categories (id, name, slug, icon, printer_id, sort_order) VALUES
  (1, 'المشروبات / البار', 'bar', 'fa-mug-hot', 1, 1),
  (2, 'المعجنات', 'pastry', 'fa-bread-slice', 2, 2);

INSERT OR IGNORE INTO products (id, name, description, price, currency_code, category_id, sort_order) VALUES
  (1, 'عصير برتقال', 'عصير برتقال طبيعي طازج', 2.5, 'USD', 1, 1),
  (2, 'قهوة', 'قهوة عربية', 1.5, 'USD', 1, 2),
  (3, 'شاي', 'شاي أحمر', 1.0, 'USD', 1, 3),
  (4, 'نسكافيه', 'نسكافيه بالحليب', 2.0, 'USD', 1, 4),
  (5, 'ماء', 'قارورة ماء 500 مل', 0.5, 'USD', 1, 5),
  (6, 'فطيرة جبنة', 'فطيرة جبنة ساخنة', 2.0, 'USD', 2, 1),
  (7, 'فطيرة زعتر', 'فطيرة زعتر بزيت الزيتون', 1.5, 'USD', 2, 2),
  (8, 'كرواسان', 'كرواسان بالزبدة', 1.75, 'USD', 2, 3),
  (9, 'بيتزا صغيرة', 'بيتزا شخصية بالخضار', 3.0, 'USD', 2, 4);

INSERT OR IGNORE INTO tables (number, label, sort_order) VALUES
  (1,'',1),(2,'',2),(3,'',3),(4,'',4),(5,'',5),(6,'',6),(7,'',7),(8,'',8),(9,'',9),(10,'',10);
