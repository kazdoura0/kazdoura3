-- كزدورة — Initial schema
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL DEFAULT '',
  decimals INTEGER NOT NULL DEFAULT 0,
  is_base INTEGER NOT NULL DEFAULT 0,
  rate_to_base REAL NOT NULL DEFAULT 1, -- 1 unit of this currency = rate_to_base units of base
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exchange_rate_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  rate_to_base REAL NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS printers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'network', -- network | browser
  host TEXT DEFAULT '',
  port INTEGER DEFAULT 9100,
  paper_width INTEGER NOT NULL DEFAULT 80, -- mm (58|80)
  role TEXT NOT NULL DEFAULT 'kitchen', -- kitchen | cashier
  is_active INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  last_status TEXT DEFAULT 'unknown', -- unknown | online | offline | error
  last_error TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  icon TEXT DEFAULT '',
  printer_id INTEGER REFERENCES printers(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  is_available INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL UNIQUE,
  label TEXT DEFAULT '',
  seats INTEGER DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'empty', -- empty | occupied | billing | awaiting_payment
  current_check_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A "check" is the open account of a table (one per table at a time)
CREATE TABLE IF NOT EXISTS checks (
  id TEXT PRIMARY KEY,
  table_id INTEGER NOT NULL REFERENCES tables(id),
  table_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | billing | paid | cancelled
  currency_code TEXT NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  bill_printed_at TEXT,
  bill_print_count INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_checks_table ON checks(table_id, status);
CREATE INDEX IF NOT EXISTS idx_checks_closed ON checks(closed_at);

-- An order is a batch of items sent from the POS at once (a "round")
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  client_request_id TEXT UNIQUE, -- idempotency key
  check_id TEXT NOT NULL REFERENCES checks(id),
  table_id INTEGER NOT NULL,
  table_number INTEGER NOT NULL,
  seq INTEGER NOT NULL DEFAULT 1, -- round number within the check
  status TEXT NOT NULL DEFAULT 'sent', -- sent | cancelled
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_check ON orders(check_id);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  check_id TEXT NOT NULL,
  product_id INTEGER,
  -- snapshot
  product_name TEXT NOT NULL,
  category_id INTEGER,
  category_name TEXT DEFAULT '',
  printer_id INTEGER,
  unit_price REAL NOT NULL,
  currency_code TEXT NOT NULL,
  unit_price_base REAL NOT NULL, -- converted to check currency at time of order
  qty INTEGER NOT NULL DEFAULT 1,
  line_total REAL NOT NULL,
  note TEXT DEFAULT '',
  is_voided INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_items_check ON order_items(check_id);

CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  printer_id INTEGER REFERENCES printers(id) ON DELETE SET NULL,
  printer_name TEXT DEFAULT '',
  job_type TEXT NOT NULL, -- kitchen | bill | test
  ref_type TEXT, -- order | check
  ref_id TEXT,
  payload TEXT NOT NULL, -- JSON ticket document
  status TEXT NOT NULL DEFAULT 'pending', -- pending | printing | printed | failed | cancelled
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT DEFAULT '',
  claimed_by TEXT,
  claimed_at TEXT,
  printed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, printer_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_ref ON print_jobs(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  client_request_id TEXT UNIQUE,
  check_id TEXT NOT NULL REFERENCES checks(id),
  amount REAL NOT NULL,
  currency_code TEXT NOT NULL,
  amount_base REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  received REAL,
  change_given REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Immutable sales ledger (one row per closed check)
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  check_id TEXT NOT NULL UNIQUE REFERENCES checks(id),
  table_number INTEGER NOT NULL,
  items_json TEXT NOT NULL, -- snapshot of items
  items_count INTEGER NOT NULL,
  subtotal REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  currency_code TEXT NOT NULL,
  rates_json TEXT NOT NULL DEFAULT '{}', -- exchange rates snapshot
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_status TEXT NOT NULL DEFAULT 'paid',
  opened_at TEXT NOT NULL,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  sale_date TEXT NOT NULL -- YYYY-MM-DD for reports
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  user_agent TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL DEFAULT 'admin',
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
