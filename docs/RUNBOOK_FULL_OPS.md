# Titiport Full Ops — Runbook
Workflow end-to-end: WAHA → n8n → Ollama → Apps Script → Sheets dashboard.
Gunakan file `workflow_wa_agent.json` untuk import manual di UI n8n.

## Prerequisites
- Docker stack UP: `cd C:\Users\user\titiport-stack && docker compose up -d`
- n8n login: `admin@titiport.local` / `titiport123`
- Ollama model `qwen2.5:1.5b` installed
- Apps Script deployed (`Anyone`, `Execute as Me`) dari `appsscript/Code.js`
- Sheet ID: `105hC8dryir_u2N7PEUvDmfR7JpS2PRg4Nn3kv13vPXQ`

## Steps
1. Buka http://localhost:5678
2. Import workflow dari `workflow_wa_agent.json` (atau manual rebuild)
3. Jika error 'Unused Respond to Webhook', ubah Webhook `responseMode` menjadi `lastNode` via UI.
4. Activate workflow
5. Test WA inbound via WAHA webhook simulator → harus muncul order baru di Sheets + dashboard Apps Script

## Notes
- n8n butuh akses ke `host.docker.internal:11434` (Ollama)
- WAHA memanggil webhook path `/webhook/wa-agent`
- Status travaial: **Docker UP, n8n reachable, Apps Script UP**
