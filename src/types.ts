export type Bindings = {
  DB: D1Database
  ADMIN_PASSWORD?: string
  BRIDGE_TOKEN?: string
}

export type AppEnv = { Bindings: Bindings; Variables: { adminToken?: string } }

export interface Currency {
  code: string
  name: string
  symbol: string
  decimals: number
  is_base: number
  rate_to_base: number
  is_active: number
  sort_order: number
}

export interface Printer {
  id: number
  name: string
  type: 'network' | 'browser'
  host: string
  port: number
  paper_width: number
  role: 'kitchen' | 'cashier'
  is_active: number
  last_seen_at: string | null
  last_status: string
  last_error: string
  sort_order: number
}

export interface Category {
  id: number
  name: string
  slug: string | null
  icon: string
  printer_id: number | null
  sort_order: number
  is_active: number
}

export interface Product {
  id: number
  name: string
  description: string
  image_url: string
  price: number
  currency_code: string
  category_id: number | null
  is_available: number
  is_deleted: number
  sort_order: number
}

export interface TableRow {
  id: number
  number: number
  label: string
  seats: number
  status: 'empty' | 'occupied' | 'billing' | 'awaiting_payment'
  current_check_id: string | null
  is_active: number
  sort_order: number
}

export interface CheckRow {
  id: string
  table_id: number
  table_number: number
  status: 'open' | 'billing' | 'paid' | 'cancelled'
  currency_code: string
  subtotal: number
  discount: number
  total: number
  bill_printed_at: string | null
  bill_print_count: number
  opened_at: string
  closed_at: string | null
  note: string
}

export interface OrderItemRow {
  id: number
  order_id: string
  check_id: string
  product_id: number | null
  product_name: string
  category_id: number | null
  category_name: string
  printer_id: number | null
  unit_price: number
  currency_code: string
  unit_price_base: number
  qty: number
  line_total: number
  note: string
  is_voided: number
  created_at: string
}

export interface TicketLine {
  name: string
  qty: number
  unit_price?: number
  line_total?: number
  note?: string
}

export interface TicketDoc {
  kind: 'kitchen' | 'bill' | 'test'
  title: string
  header?: string
  footer?: string
  store_name: string
  table_number?: number
  order_seq?: number
  order_id?: string
  check_id?: string
  created_at: string
  lines: TicketLine[]
  currency?: { code: string; symbol: string; decimals: number }
  subtotal?: number
  discount?: number
  total?: number
  secondary_totals?: { code: string; symbol: string; amount: number; decimals: number }[]
  paper_width: number
}
