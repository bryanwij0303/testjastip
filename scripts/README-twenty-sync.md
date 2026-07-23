# Titiport → Twenty Sync

Script: `scripts/sync-twenty.js`

## Setup
- Tambah env di `.env.local` atau Vercel/Railway:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `TWENTY_API_KEY` = `TwentyAPI <token>`
  - `TWENTY_WORKSPACE_ID` = `69fbaebc-5e32-486f-8527-24ec2330c419`
- Jalankan SQL migration `migrations/20250723_crm_mappings.sql` ke Supabase.

## Run
```bash
node scripts/sync-twenty.js            # default: 1 jam terakhir
node scripts/sync-twenty.js 2026-07-23T15:00:00Z
```

## Mapping
- `orders` → `people` + `opportunities` + `notes`
- Stage: menunggu → NEW_LEAD, dikerjakan → NEGOTIATION, selesai → WON, batal → LOST
- Idempoten: simpan `twenty_*_id` di `crm_mappings`.

## Custom Twenty fields yang perlu dibuat manual
- opportunities: `amount` (NUMBER), `currency` (TEXT), `tracking_number` (TEXT), `carrier` (TEXT)
- notes: `direction` (TEXT)
