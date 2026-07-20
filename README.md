# Titiport Business Tracker
Local-first Jastip tracker + Google Sheets cloud dashboard.

## Stack
- Flask + SQLite (`app.py`) — lokal tracker
- RAG (`rag.py`) — CS assistant via Ollama
- Docker Compose — containerized
- Apps Script (`appsscript/Code.js`) — cloud dashboard di Sheets
- n8n workflow — automation lite

## Dev
```bash
cd C:\Users\user\titiport-jastip
docker compose up -d --build
```

Akses lokal: `http://localhost:5000/tracker`
Akses cloud: Apps Script Web App URL

## Notes
- Admin pass: `titiport123`
- Ollama model: `qwen2.5:1.5b` + `nomic-embed-text`
- Cloudflare quick tunnel: see `cloudflared.log` (not committed)
