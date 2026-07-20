# rag.py — Titiport RAG pipeline (local-first)
# Embed: Ollama nomic-embed-text | Generate: Ollama qwen2.5:1.5b
# Vector store: SQLite (cosine similarity di Python, no native ext needed)
#
# Sources:
#   A) orders   — auto-embed dari orders.db (jastip)
#   B) policy   — file docs/policy.md (aturan Titiport)
#   C) products — scrape + embed link Taobao/1688 (manual add)
#
# CLI:
#   python rag.py embed          # re-embed semua source
#   python rag.py ask "pertanyaan"   # retrieve + generate
#   python rag.py add-product "url" "deskripsi"
#   python rag.py stats

import sqlite3, os, json, requests, sys
from datetime import datetime

OLLAMA = "http://127.0.0.1:11434"
EMBED_MODEL = "nomic-embed-text"
GEN_MODEL = "qwen2.5:1.5b"
RAG_DB = os.environ.get("RAG_DB_PATH", os.path.join(os.path.dirname(__file__), "rag.db"))
ORDERS_DB = os.path.join(os.path.dirname(__file__), "orders.db")
POLICY_FILE = os.path.join(os.path.dirname(__file__), "docs", "policy.md")
TOP_K = 4

POLICY_DEFAULT = """# Policy Titiport

## Fee
Fee layanan: 15% untuk subtotal di bawah 1000 CNY. 10% untuk subtotal 1500 CNY ke atas. Antara 1000-1499 CNY mengikuti 15%. Fee dihitung dari nilai barang dalam Rupiah (CNY x kurs).

## Kurs
Kurs tetap Rp 2.750 per CNY. Tidak berubah kecuali ada pengumuman resmi.

## Shipping
Hancarry (batch): Rp 250.000 per kg. Cargo Udara: mulai Rp 235.000 per kg. Cargo Laut: Rp 6.500.000 per CBM (minimal 0,1 CBM). Ongkir dikomunikasikan dan dibill terpisah setelah berat/volume diukur di gudang Titiport.

## Sourcing
Barang branded dicari dari official store sebagai acuan harga, pembelian aktual lewat Taobao/1688 official store. Non-branded dicari toko dengan review terbanyak + rating tertinggi. CS wajib kirim reference image Taobao/1688 sebelum menanyakan pilihan customer.

## Pre-Quote
Sebelum quote wajib ada: detail produk (model/nama/link), data diri (nama/alamat/telp), metode shipping. Tanpa itu, tidak boleh quote.

## Konfirmasi Order
Sebelum order final: konfirmasi model/warna/tipe/ukuran eksplisit, sertakan link + gambar referensi, info "once order tidak bisa refund".

## Refund
Barang yang sudah di-order tidak bisa refund (kecuali tidak tersedia di seller). Ongkir tidak bisa refund.

## Estimasi Waktu
Estimasi pengiriman China→Indonesia: 10-21 hari kerja tergantung metode shipping dan custom.
"""

# ---------- embed ----------
def embed(text):
    r = requests.post(f"{OLLAMA}/api/embeddings",
                       json={"model": EMBED_MODEL, "prompt": text}, timeout=60)
    return r.json()["embedding"]

# ---------- vector store ----------
def init_rag():
    conn = sqlite3.connect(RAG_DB); c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT, ref_id TEXT, text TEXT,
        embedding TEXT, created_at TEXT)""")
    conn.commit(); conn.close()

def add_chunk(source, ref_id, text, emb):
    conn = sqlite3.connect(RAG_DB); c = conn.cursor()
    c.execute("INSERT INTO chunks (source,ref_id,text,embedding,created_at) VALUES (?,?,?,?,?)",
              (source, ref_id, text, json.dumps(emb), datetime.now().isoformat()))
    conn.commit(); conn.close()

def all_chunks():
    conn = sqlite3.connect(RAG_DB); c = conn.cursor()
    rows = c.execute("SELECT id,source,ref_id,text,embedding FROM chunks").fetchall()
    conn.close(); return rows

def cosine(a, b):
    dot = sum(x*y for x,y in zip(a,b))
    na = sum(x*x for x in a)**0.5
    nb = sum(x*x for x in b)**0.5
    return dot/(na*nb) if na and nb else 0

def retrieve(query_emb, k=TOP_K):
    rows = all_chunks()
    scored = []
    for rid, src, ref, text, emb in rows:
        sim = cosine(query_emb, json.loads(emb))
        scored.append((sim, src, ref, text))
    scored.sort(reverse=True)
    return scored[:k]

# ---------- sources ----------
def embed_orders():
    if not os.path.exists(ORDERS_DB):
        print("orders.db not found, skip"); return 0
    conn = sqlite3.connect(ORDERS_DB); c = conn.cursor()
    rows = c.execute("SELECT id,customer_name,item_desc,cny_subtotal,shipping_method,total_rp,status,created_at FROM orders").fetchall()
    conn.close()
    n=0
    for r in rows:
        oid, name, item, cny, method, total, status, created = r
        text = f"Order #{oid} | Customer: {name} | Item: {item} | Subtotal: {cny} CNY | Shipping: {method} | Total: Rp {total:,} | Status: {status} | Tanggal: {created[:10]}"
        add_chunk("orders", str(oid), text, embed(text)); n+=1
    print(f"embedded {n} orders"); return n

def embed_policy():
    os.makedirs(os.path.dirname(POLICY_FILE), exist_ok=True)
    if not os.path.exists(POLICY_FILE) or os.path.getsize(POLICY_FILE) == 0:
        with open(POLICY_FILE, "w", encoding="utf-8") as f:
            f.write(POLICY_DEFAULT)
    with open(POLICY_FILE, encoding="utf-8") as f:
        content = f.read()
    sections = [s for s in content.split("\n## ") if s.strip()]
    n=0
    for i, sec in enumerate(sections):
        text = ("## " + sec).strip()
        if len(text) < 20: continue
        add_chunk("policy", f"sec{i}", text, embed(text)); n+=1
    print(f"embedded {n} policy sections"); return n

def add_product(url, desc):
    text = f"PRODUK: {desc}\nURL: {url}"
    add_chunk("products", url, text, embed(text))
    print(f"embedded product: {url}")

# ---------- generate ----------
def ask(query):
    q_emb = embed(query)
    hits = retrieve(q_emb)
    if not hits:
        return "Maaf, saya belum punya data untuk pertanyaan itu. Coba tanyakan soal order, policy, atau produk Titiport."
    ctx = "\n\n".join(f"[{s.upper()} #{r}] {t}" for sim, s, r, t in hits)
    prompt = f"""Kamu CS Titiport (jasa titip beli China). Jawab pertanyaan customer HANYA berdasarkan konteks di bawah.
Jangan boleh nambah info di luar konteks. Bahasa sopan, sapaan Kak/Bro, no AI-speak.

KONTEKS:
{ctx}

PERTANYAAN: {query}

JAWABAN:"""
    r = requests.post(f"{OLLAMA}/api/generate",
                      json={"model": GEN_MODEL, "prompt": prompt, "stream": False}, timeout=120)
    return r.json()["response"]

# ---------- CLI ----------
if __name__ == "__main__":
    init_rag()
    if len(sys.argv) < 2:
        print("usage: python rag.py [embed|ask|add-product|stats] ..."); sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "embed":
        embed_orders(); embed_policy(); print("DONE embed")
    elif cmd == "ask":
        q = " ".join(sys.argv[2:])
        print(ask(q))
    elif cmd == "add-product":
        add_product(sys.argv[2], sys.argv[3] if len(sys.argv)>3 else "")
    elif cmd == "stats":
        rows = all_chunks()
        from collections import Counter
        cnt = Counter(r[1] for r in rows)
        print("chunks:", dict(cnt))
    else:
        print("unknown cmd")
