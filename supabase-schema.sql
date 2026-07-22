-- Titiport schema for Supabase
BEGIN;

CREATE TABLE IF NOT EXISTS public.orders (
  order_id text PRIMARY KEY,
  trip_id integer DEFAULT 1,
  customer_name text,
  customer_wa text,
  item_desc text,
  cny_subtotal numeric DEFAULT 0,
  weight_kg numeric DEFAULT 0,
  volume_cbm numeric DEFAULT 0,
  shipping_method text DEFAULT '',
  fee_rate numeric DEFAULT 0.08,
  fee_rp numeric DEFAULT 0,
  barang_rp numeric DEFAULT 0,
  ongkir_rp numeric DEFAULT 0,
  total_rp numeric DEFAULT 0,
  status text DEFAULT 'menunggu',
  created_at timestamptz DEFAULT now(),
  invoice_no text DEFAULT '',
  paid_at timestamptz,
  notes text DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.trips (
  trip_id serial PRIMARY KEY,
  trip_name text NOT NULL,
  country text,
  currency_code text,
  rate numeric,
  execution_rate numeric DEFAULT 1.0,
  status text DEFAULT 'active'
);

INSERT INTO public.trips (trip_name, country, currency_code, rate, execution_rate, status)
VALUES ('China Taobao', 'CN', 'CNY', 2200, 1.0, 'active')
ON CONFLICT DO NOTHING;

COMMIT;
