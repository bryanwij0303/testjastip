# Titiport Jastip — Extended (mirip fitur Jastipr.id)
# Local-first: Flask + SQLite. Docker-ready.
# Fitur: Admin multi-toko (multi-tenant), Order + PDF Invoice, Katalog + stok realtime,
#        Pengingat WhatsApp otomatis (WAHA) + scheduler.
# Landing: http://localhost:5000   Admin: http://localhost:5000/admin
# Default akun: toko "Titiport" / pass "titiport123"

import sqlite3, os, csv, io, json, requests
from datetime import datetime, timedelta
from flask import (Flask, render_template_string, request, redirect, url_for,
                   jsonify, session, Response, send_file)
from apscheduler.schedulers.background import BackgroundScheduler
from fpdf import FPDF
from fpdf.enums import XPos, YPos

# CRM via Google Workspace (wajib: Contacts + Gmail + Sheets)
try:
    import gws_crm
    GWS_OK = True
except Exception as _e:
    gws_crm = None
    GWS_OK = False
    print("gws_crm import failed:", _e)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "titiport-jastip-secret")
DB = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "orders.db"))
WAHA_URL = os.environ.get("WAHA_URL", "http://localhost:3001")
WAHA_KEY = os.environ.get("WAHA_KEY", "wa-secret-key")

KURS = 2750
FEE_TINGGI = 0.15
FEE_RENDAH = 0.10
SHIPPING = {
    "hancarry": {"label": "Hancarry (batch)", "rate": 250000, "unit": "per kg"},
    "udara":    {"label": "Cargo Udara", "rate": 235000, "unit": "per kg (mulai)"},
    "laut":     {"label": "Cargo Laut", "rate": 6500000, "unit": "per CBM (min 0.1 CBM)"},
}
STATUSES = ["menunggu", "diproses", "dikirim", "bayar", "batal"]

# ===================== DB INIT / MIGRATE =====================
def init_db():
    conn = sqlite3.connect(DB); c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT, wa TEXT, alamat TEXT,
        link TEXT, item_desc TEXT,
        cny_subtotal REAL, weight_kg REAL, volume_cbm REAL,
        shipping_method TEXT, fee_rate REAL, fee_rp REAL,
        barang_rp REAL, ongkir_rp REAL, total_rp REAL,
        status TEXT DEFAULT 'menunggu', created_at TEXT)''')
    # migrasi kolom multi-tenant / invoice / stok
    for col, typ in [("shop_id", "INTEGER DEFAULT 1"),
                     ("invoice_no", "TEXT"),
                     ("paid_at", "TEXT"),
                     ("product_id", "INTEGER")]:
        try:
            c.execute(f"ALTER TABLE orders ADD COLUMN {col} {typ}")
        except Exception:
            pass
    c.execute('''CREATE TABLE IF NOT EXISTS shops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT, wa TEXT, password TEXT,
        invoice_no_prefix TEXT DEFAULT 'INV', invoice_seq INTEGER DEFAULT 0,
        created_at TEXT)''')
    if not c.execute("SELECT id FROM shops WHERE id=1").fetchone():
        c.execute("INSERT INTO shops (id,name,wa,password,invoice_no_prefix) "
                  "VALUES (1,'Titiport','62812xxxx','titiport123','INV')")
    c.execute('''CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_id INTEGER, username TEXT, password TEXT, role TEXT DEFAULT 'staff',
        created_at TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_id INTEGER, sku TEXT, name TEXT, desc TEXT,
        price_cny REAL, price_rp REAL, stock INTEGER DEFAULT 0,
        category TEXT, photo TEXT, created_at TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_id INTEGER, order_id INTEGER, wa TEXT, sent_at TEXT, status TEXT)''')
    conn.commit(); conn.close()

init_db()

def conn_db():
    return sqlite3.connect(DB)

def authed():
    return session.get("admin") == True

def cur_shop():
    return session.get("shop_id", 1)

def cur_shop_name():
    conn = conn_db(); c = conn.cursor()
    r = c.execute("SELECT name FROM shops WHERE id=?", (cur_shop(),)).fetchone()
    conn.close()
    return r[0] if r else "Titiport"

# ===================== HELPERS =====================
def hitung(cny, weight, cbm, method):
    barang_rp = cny * KURS
    fee_rate = FEE_RENDAH if cny >= 1500 else FEE_TINGGI
    fee_rp = barang_rp * fee_rate
    if method == "hancarry":
        ongkir = max(weight, 0.1) * SHIPPING["hancarry"]["rate"]
    elif method == "udara":
        ongkir = max(weight, 0.1) * SHIPPING["udara"]["rate"]
    elif method == "laut":
        ongkir = max(cbm, 0.1) * SHIPPING["laut"]["rate"]
    else:
        ongkir = 0
    return {"barang_rp": int(barang_rp), "fee_rate": fee_rate, "fee_rp": int(fee_rp),
            "ongkir_rp": int(ongkir), "total_rp": int(barang_rp + fee_rp + ongkir)}

def fmt_rp(n):
    try:
        return "Rp " + format(int(n), ",")
    except Exception:
        return str(n)

def pdf_safe(s, maxlen=None):
    s = str(s)
    if maxlen:
        s = s[:maxlen]
    return s.encode("latin-1", "replace").decode("latin-1")

def next_inv(shop_id):
    conn = conn_db(); c = conn.cursor()
    row = c.execute("SELECT invoice_no_prefix,invoice_seq FROM shops WHERE id=?",
                    (shop_id,)).fetchone()
    prefix, seq = (row[0] or "INV", row[1] or 0)
    seq += 1
    c.execute("UPDATE shops SET invoice_seq=? WHERE id=?", (seq, shop_id))
    conn.commit(); conn.close()
    return f"{prefix}-{seq:03d}"

# ===================== WHATSAPP (WAHA) =====================
def send_wa(to, text):
    to = (to or "").strip().replace(" ", "").replace("-", "")
    if not to:
        return False
    if to.startswith("0"):
        to = "62" + to[1:]
    if not to.endswith("@c.us"):
        to = to + "@c.us"
    try:
        r = requests.post(f"{WAHA_URL}/api/sendText",
                          headers={"X-Api-Key": WAHA_KEY, "Content-Type": "application/json"},
                          json={"session": "default", "chatId": to, "text": text}, timeout=15)
        return r.status_code in (200, 201)
    except Exception as e:
        print("WAHA send error:", e)
        return False

def reminder_text(cname, inv_no, total):
    return (f"Halo Kak {cname or ''} 🙏\n"
            f"Invoice #{inv_no} sebesar {fmt_rp(total)} belum dibayar nih.\n"
            f"Yuk segera dibayar biar pesanan cepat diproses. "
            f"Terima kasih!")

def run_reminders():
    """Kirim pengingat ke order belum lunas, maks tiap 3 hari per order."""
    conn = conn_db(); c = conn.cursor()
    shops = c.execute("SELECT id,name,wa,invoice_no_prefix FROM shops").fetchall()
    for sid, name, swa, prefix in shops:
        rows = c.execute(
            "SELECT id,customer_name,wa,total_rp,invoice_no FROM orders "
            "WHERE shop_id=? AND status IN ('menunggu','diproses','dikirim') "
            "AND wa IS NOT NULL AND wa!=''", (sid,)).fetchall()
        for oid, cname, wa, total, inv in rows:
            last = c.execute("SELECT sent_at FROM reminders WHERE order_id=? "
                             "ORDER BY sent_at DESC LIMIT 1", (oid,)).fetchone()
            created = c.execute("SELECT created_at FROM orders WHERE id=?",
                                (oid,)).fetchone()
            base = (last[0] if last else (created[0] if created else None))
            if base:
                try:
                    d = datetime.fromisoformat(base)
                except Exception:
                    d = None
                if d and (datetime.now() - d).days < 3:
                    continue
            inv_no = inv or f"{prefix}-{oid:03d}"
            ok = send_wa(wa, reminder_text(cname, inv_no, total))
            c.execute("INSERT INTO reminders (shop_id,order_id,wa,sent_at,status) "
                      "VALUES (?,?,?,?,?)",
                      (sid, oid, wa, datetime.now().isoformat(),
                       "sent" if ok else "failed"))
            conn.commit()
    conn.close()
    print("reminder run done", datetime.now().isoformat())

# ===================== PDF INVOICE =====================
def invoice_pdf(oid):
    conn = conn_db(); c = conn.cursor()
    o = c.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone()
    if not o:
        conn.close(); return None
    sid = o[17] if len(o) > 17 and o[17] else 1
    shop = c.execute("SELECT name,wa FROM shops WHERE id=?", (sid,)).fetchone()
    conn.close()
    shop_name = shop[0] if shop else "Titiport"
    inv_no = o[18] if len(o) > 18 and o[18] else f"INV-{oid:03d}"
    created = o[16][:10] if o[16] else ""
    epw = 190  # effective page width (A4 - margins)
    pdf = FPDF(format="A4")
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_x(pdf.l_margin)
    pdf.cell(0, 10, pdf_safe(shop_name), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_x(pdf.l_margin)
    pdf.cell(0, 6, pdf_safe("Invoice " + inv_no), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(pdf.l_margin)
    pdf.cell(0, 6, pdf_safe("Tanggal: " + created), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(2)
    pdf.set_x(pdf.l_margin)
    pdf.cell(0, 6, pdf_safe("Kepada: " + str(o[1])), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(pdf.l_margin)
    pdf.cell(0, 6, pdf_safe("WA: " + str(o[2])), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(epw, 6, pdf_safe("Alamat: " + str(o[3])))
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(epw, 6, pdf_safe("Link: " + str(o[4])))
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_x(pdf.l_margin)
    cols = [("Item", 78), ("CNY", 22), ("Barang", 28), ("Fee", 24), ("Ongkir", 24), ("Total", 24)]
    for name, w in cols:
        pdf.cell(w, 8, pdf_safe(name), border=1)
    pdf.ln()
    pdf.set_font("Helvetica", "", 9)
    pdf.set_x(pdf.l_margin)
    pdf.cell(78, 8, pdf_safe(str(o[5]), 50), border=1)
    pdf.cell(22, 8, pdf_safe(str(o[6])), border=1)
    pdf.cell(28, 8, pdf_safe(fmt_rp(o[12])), border=1)
    pdf.cell(24, 8, pdf_safe(fmt_rp(o[11])), border=1)
    pdf.cell(24, 8, pdf_safe(fmt_rp(o[13])), border=1)
    pdf.cell(24, 8, pdf_safe(fmt_rp(o[14])), border=1)
    pdf.ln()
    pdf.ln(3)
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_x(pdf.l_margin)
    pdf.cell(0, 8, pdf_safe("TOTAL: " + fmt_rp(o[14])), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(epw, 5, pdf_safe(
        "Status: " + str(o[15]) +
        "\nTerima kasih telah order di " + shop_name +
        ". Silakan transfer sesuai total ke rekening Titiport."))
    out = io.BytesIO()
    pdf.output(out)
    out.seek(0)
    return out

# ===================== ROUTES: PUBLIC =====================
@app.route("/")
def landing():
    shop = request.args.get("shop", "")
    sid = 1
    if shop:
        conn = conn_db(); c = conn.cursor()
        r = c.execute("SELECT id FROM shops WHERE lower(name)=lower(?)", (shop,)).fetchone()
        if r:
            sid = r[0]
        conn.close()
    return render_template_string(LANDING_HTML, shop_id=sid)

@app.route("/katalog")
def katalog():
    shop = request.args.get("shop", "Titiport")
    conn = conn_db(); c = conn.cursor()
    r = c.execute("SELECT id FROM shops WHERE lower(name)=lower(?)", (shop,)).fetchone()
    sid = r[0] if r else 1
    rows = c.execute("SELECT name,desc,price_rp,stock,category FROM products "
                     "WHERE shop_id=? ORDER BY name", (sid,)).fetchall()
    conn.close()
    return render_template_string(KATALOG_HTML, rows=rows, shop=shop, fmt=fmt_rp)

@app.route("/api/hitung", methods=["POST"])
def api_hitung():
    d = request.json
    return jsonify(hitung(float(d.get("cny", 0)), float(d.get("weight", 0)),
                          float(d.get("cbm", 0)), d.get("method", "hancarry")))

@app.route("/api/order", methods=["POST"])
def api_order():
    d = request.json
    calc = hitung(float(d.get("cny", 0)), float(d.get("weight", 0)),
                  float(d.get("cbm", 0)), d.get("method", "hancarry"))
    sid = int(d.get("shop_id", 1) or 1)
    inv = next_inv(sid)
    pid = d.get("product_id")
    conn = conn_db(); c = conn.cursor()
    c.execute('''INSERT INTO orders (customer_name,wa,alamat,link,item_desc,
        cny_subtotal,weight_kg,volume_cbm,shipping_method,fee_rate,fee_rp,
        barang_rp,ongkir_rp,total_rp,status,created_at,shop_id,invoice_no,product_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
        (d.get("name"), d.get("wa"), d.get("alamat"), d.get("link"), d.get("item"),
         float(d.get("cny", 0)), float(d.get("weight", 0)), float(d.get("cbm", 0)),
         d.get("method"), calc["fee_rate"], calc["fee_rp"], calc["barang_rp"],
         calc["ongkir_rp"], calc["total_rp"], "menunggu", datetime.now().isoformat(),
         sid, inv, pid))
    # decrement stok jika dari katalog
    if pid:
        c.execute("UPDATE products SET stock = MAX(0, stock-1) WHERE id=? AND shop_id=?",
                  (int(pid), sid))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "total": calc["total_rp"], "invoice": inv})

# ===================== ROUTES: AUTH =====================
@app.route("/admin")
def admin():
    if not authed():
        return render_template_string(ADMIN_LOGIN_HTML)
    status_filter = request.args.get("status", "")
    sid = cur_shop()
    conn = conn_db(); c = conn.cursor()
    if status_filter:
        rows = c.execute("SELECT * FROM orders WHERE shop_id=? AND status=? ORDER BY id DESC",
                         (sid, status_filter)).fetchall()
    else:
        rows = c.execute("SELECT * FROM orders WHERE shop_id=? ORDER BY id DESC",
                         (sid,)).fetchall()
    conn.close()
    return render_template_string(ADMIN_HTML, orders=rows, fmt=fmt_rp,
                                  statuses=STATUSES, current=status_filter,
                                  shop_name=cur_shop_name())

@app.route("/admin/login", methods=["POST"])
def admin_login():
    shop = request.form.get("shop", "").strip()
    pw = request.form.get("pass", "")
    conn = conn_db(); c = conn.cursor()
    r = c.execute("SELECT id FROM shops WHERE lower(name)=lower(?) AND password=?",
                  (shop, pw)).fetchone()
    if not r:
        r = c.execute("SELECT shop_id FROM accounts WHERE username=? AND password=?",
                      (shop, pw)).fetchone()
    conn.close()
    if r:
        session["admin"] = True
        session["shop_id"] = r[0]
        return redirect("/admin")
    return "Toko / password salah", 403

@app.route("/admin/logout")
def admin_logout():
    session.clear()
    return redirect("/admin")

# ===================== ROUTES: DASHBOARD / TRACKER =====================
@app.route("/dashboard")
def dashboard():
    if not authed():
        return redirect("/admin")
    sid = cur_shop()
    conn = conn_db(); c = conn.cursor()
    rows = c.execute("SELECT * FROM orders WHERE shop_id=? ORDER BY id DESC", (sid,)).fetchall()
    conn.close()
    total_orders = len(rows)
    total_barang = sum(r[12] or 0 for r in rows)
    total_fee = sum(r[11] or 0 for r in rows)
    total_ongkir = sum(r[13] or 0 for r in rows)
    total_all = sum(r[14] or 0 for r in rows)
    by_status = {}
    for r in rows:
        st = r[15]; by_status[st] = by_status.get(st, 0) + 1
    outstanding = sum(r[14] or 0 for r in rows if r[15] in ("menunggu", "diproses", "dikirim"))
    paid = sum(r[14] or 0 for r in rows if r[15] == "bayar")
    batal = sum(r[14] or 0 for r in rows if r[15] == "batal")
    cust = {}
    for r in rows:
        nm = r[1] or "?"
        cust[nm] = cust.get(nm, {"n": 0, "v": 0})
        cust[nm]["n"] += 1; cust[nm]["v"] += (r[14] or 0)
    top_cust = sorted(cust.items(), key=lambda x: -x[1]["v"])[:5]
    kpi = dict(total_orders=total_orders, total_barang=total_barang, total_fee=total_fee,
               total_ongkir=total_ongkir, total_all=total_all, by_status=by_status,
               outstanding=outstanding, paid=paid, batal=batal, top_cust=top_cust)
    return render_template_string(DASHBOARD_HTML, kpi=kpi, fmt=fmt_rp, orders=rows, statuses=STATUSES)

@app.route("/tracker")
def tracker():
    if not authed():
        return redirect("/admin")
    sid = cur_shop()
    conn = conn_db(); c = conn.cursor()
    rows = c.execute("SELECT * FROM orders WHERE shop_id=? ORDER BY id DESC", (sid,)).fetchall()
    conn.close()
    total_orders = len(rows)
    total_barang = sum(r[12] or 0 for r in rows)
    total_fee = sum(r[11] or 0 for r in rows)
    total_ongkir = sum(r[13] or 0 for r in rows)
    total_all = sum(r[14] or 0 for r in rows)
    by_status = {}
    for r in rows:
        st = r[15]; by_status[st] = by_status.get(st, 0) + 1
    outstanding = sum(r[14] or 0 for r in rows if r[15] in ("menunggu", "diproses", "dikirim"))
    paid = sum(r[14] or 0 for r in rows if r[15] == "bayar")
    batal = sum(r[14] or 0 for r in rows if r[15] == "batal")
    cust = {}
    for r in rows:
        nm = r[1] or "?"
        cust[nm] = cust.get(nm, {"n": 0, "v": 0})
        cust[nm]["n"] += 1; cust[nm]["v"] += (r[14] or 0)
    top_cust = sorted(cust.items(), key=lambda x: -x[1]["v"])[:5]
    kpi = dict(total_orders=total_orders, total_barang=total_barang, total_fee=total_fee,
               total_ongkir=total_ongkir, total_all=total_all, by_status=by_status,
               outstanding=outstanding, paid=paid, batal=batal, top_cust=top_cust)
    return render_template_string(TRACKER_HTML, kpi=kpi, fmt=fmt_rp, orders=rows)

# ===================== ROUTES: ORDER CRUD =====================
@app.route("/admin/update/<int:oid>", methods=["POST"])
def admin_update(oid):
    if not authed():
        return "no", 403
    status = request.json.get("status")
    conn = conn_db(); c = conn.cursor()
    c.execute("UPDATE orders SET status=? WHERE id=? AND shop_id=?",
              (status, oid, cur_shop()))
    if status == "bayar":
        c.execute("UPDATE orders SET paid_at=? WHERE id=? AND paid_at IS NULL",
                  (datetime.now().isoformat(), oid))
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route("/admin/edit/<int:oid>", methods=["GET", "POST"])
def admin_edit(oid):
    if not authed():
        return redirect("/admin")
    sid = cur_shop()
    conn = conn_db(); c = conn.cursor()
    if request.method == "POST":
        d = request.form
        calc = hitung(float(d.get("cny", 0)), float(d.get("weight", 0)),
                      float(d.get("cbm", 0)), d.get("method", "hancarry"))
        c.execute('''UPDATE orders SET customer_name=?,wa=?,alamat=?,link=?,item_desc=?,
            cny_subtotal=?,weight_kg=?,volume_cbm=?,shipping_method=?,fee_rate=?,fee_rp=?,
            barang_rp=?,ongkir_rp=?,total_rp=?,status=?
            WHERE id=? AND shop_id=?''',
            (d.get("name"), d.get("wa"), d.get("alamat"), d.get("link"), d.get("item"),
             float(d.get("cny", 0)), float(d.get("weight", 0)), float(d.get("cbm", 0)),
             d.get("method"), calc["fee_rate"], calc["fee_rp"], calc["barang_rp"],
             calc["ongkir_rp"], calc["total_rp"], d.get("status", "menunggu"), oid, sid))
        conn.commit(); conn.close()
        return redirect("/admin")
    o = c.execute("SELECT * FROM orders WHERE id=? AND shop_id=?", (oid, sid)).fetchone()
    conn.close()
    if not o:
        return "not found", 404
    return render_template_string(ADMIN_EDIT_HTML, o=o, statuses=STATUSES, SHIPPING=SHIPPING)

@app.route("/admin/delete/<int:oid>", methods=["POST"])
def admin_delete(oid):
    if not authed():
        return "no", 403
    conn = conn_db(); c = conn.cursor()
    c.execute("DELETE FROM orders WHERE id=? AND shop_id=?", (oid, cur_shop()))
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route("/admin/export")
def admin_export():
    if not authed():
        return redirect("/admin")
    sid = cur_shop()
    conn = conn_db(); c = conn.cursor()
    rows = c.execute("SELECT * FROM orders WHERE shop_id=? ORDER BY id DESC", (sid,)).fetchall()
    conn.close()
    cols = ["id", "customer_name", "wa", "alamat", "link", "item_desc", "cny_subtotal",
            "weight_kg", "volume_cbm", "shipping_method", "fee_rate", "fee_rp", "barang_rp",
            "ongkir_rp", "total_rp", "status", "created_at", "shop_id", "invoice_no", "paid_at", "product_id"]
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(cols)
    for r in rows:
        w.writerow(r)
    return Response(out.getvalue(), mimetype="text/csv",
                   headers={"Content-Disposition": "attachment; filename=titiport_orders.csv"})

@app.route("/admin/invoice/<int:oid>")
def admin_invoice(oid):
    if not authed():
        return redirect("/admin")
    out = invoice_pdf(oid)
    if not out:
        return "not found", 404
    return send_file(out, mimetype="application/pdf", as_attachment=True,
                     download_name=f"invoice-{oid}.pdf")

# ===================== ROUTES: PRODUK / KATALOG =====================
@app.route("/admin/products", methods=["GET", "POST"])
def admin_products():
    if not authed():
        return redirect("/admin")
    sid = cur_shop()
    conn = conn_db(); c = conn.cursor()
    if request.method == "POST":
        d = request.form
        price_cny = float(d.get("price_cny", 0) or 0)
        price_rp = float(d.get("price_rp", 0) or 0)
        c.execute('''INSERT INTO products (shop_id,sku,name,desc,price_cny,price_rp,stock,category,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)''',
            (sid, d.get("sku"), d.get("name"), d.get("desc"), price_cny, price_rp,
             int(float(d.get("stock", 0) or 0)), d.get("category"),
             datetime.now().isoformat()))
        conn.commit()
    rows = c.execute("SELECT * FROM products WHERE shop_id=? ORDER BY id DESC", (sid,)).fetchall()
    conn.close()
    return render_template_string(PRODUCTS_HTML, products=rows, fmt=fmt_rp, shop_name=cur_shop_name())

@app.route("/admin/product/edit/<int:pid>", methods=["GET", "POST"])
def admin_product_edit(pid):
    if not authed():
        return redirect("/admin")
    sid = cur_shop()
    conn = conn_db(); c = conn.cursor()
    if request.method == "POST":
        d = request.form
        c.execute('''UPDATE products SET sku=?,name=?,desc=?,price_cny=?,price_rp=?,stock=?,category=?
            WHERE id=? AND shop_id=?''',
            (d.get("sku"), d.get("name"), d.get("desc"),
             float(d.get("price_cny", 0) or 0), float(d.get("price_rp", 0) or 0),
             int(float(d.get("stock", 0) or 0)), d.get("category"), pid, sid))
        conn.commit(); conn.close()
        return redirect("/admin/products")
    p = c.execute("SELECT * FROM products WHERE id=? AND shop_id=?", (pid, sid)).fetchone()
    conn.close()
    if not p:
        return "not found", 404
    return render_template_string(PRODUCT_EDIT_HTML, p=p, fmt=fmt_rp)

@app.route("/admin/product/delete/<int:pid>", methods=["POST"])
def admin_product_delete(pid):
    if not authed():
        return "no", 403
    conn = conn_db(); c = conn.cursor()
    c.execute("DELETE FROM products WHERE id=? AND shop_id=?", (pid, cur_shop()))
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route("/admin/product/stock/<int:pid>/<int:delta>", methods=["POST"])
def admin_product_stock(pid, delta):
    if not authed():
        return "no", 403
    conn = conn_db(); c = conn.cursor()
    c.execute("UPDATE products SET stock = MAX(0, stock + ?) WHERE id=? AND shop_id=?",
              (delta, pid, cur_shop()))
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route("/admin/product/order/<int:pid>", methods=["POST"])
def admin_product_order(pid):
    """Buat order dari stok (ready stok) -> decrement 1, status menunggu."""
    if not authed():
        return "no", 403
    sid = cur_shop()
    conn = conn_db(); c = conn.cursor()
    p = c.execute("SELECT id,name,price_cny,price_rp,stock FROM products WHERE id=? AND shop_id=?",
                  (pid, sid)).fetchone()
    if not p:
        conn.close(); return jsonify({"ok": False, "msg": "produk tidak ada"})
    if (p[4] or 0) <= 0:
        conn.close(); return jsonify({"ok": False, "msg": "stok habis"})
    inv = next_inv(sid)
    c.execute('''INSERT INTO orders (customer_name,wa,alamat,link,item_desc,
        cny_subtotal,weight_kg,volume_cbm,shipping_method,fee_rate,fee_rp,
        barang_rp,ongkir_rp,total_rp,status,created_at,shop_id,invoice_no,product_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
        ("", "", "", "", p[1], p[2], 0, 0, "hancarry", 0, 0,
         p[3], 0, p[3], "menunggu", datetime.now().isoformat(), sid, inv, pid))
    c.execute("UPDATE products SET stock = MAX(0, stock-1) WHERE id=? AND shop_id=?",
              (pid, sid))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "invoice": inv})

# ===================== ROUTES: PENGINGAT WA =====================
@app.route("/admin/reminders")
def admin_reminders():
    if not authed():
        return redirect("/admin")
    sid = cur_shop()
    conn = conn_db(); c = conn.cursor()
    rows = c.execute("SELECT r.id,r.order_id,r.wa,r.sent_at,r.status,o.invoice_no "
                     "FROM reminders r LEFT JOIN orders o ON o.id=r.order_id "
                     "WHERE r.shop_id=? ORDER BY r.sent_at DESC LIMIT 100", (sid,)).fetchall()
    conn.close()
    return render_template_string(REMINDERS_HTML, rows=rows)

@app.route("/admin/remind/<int:oid>", methods=["POST"])
def admin_remind(oid):
    if not authed():
        return jsonify({"ok": False, "msg": "no"}), 403
    sid = cur_shop()
    conn = conn_db(); c = conn.cursor()
    o = c.execute("SELECT customer_name,wa,total_rp,invoice_no FROM orders "
                  "WHERE id=? AND shop_id=?", (oid, sid)).fetchone()
    if not o:
        conn.close(); return jsonify({"ok": False, "msg": "order tidak ada"})
    if not o[1]:
        conn.close(); return jsonify({"ok": False, "msg": "WA kosong"})
    prefix = c.execute("SELECT invoice_no_prefix FROM shops WHERE id=?", (sid,)).fetchone()[0]
    inv_no = o[3] or f"{prefix}-{oid:03d}"
    ok = send_wa(o[1], reminder_text(o[0], inv_no, o[2]))
    c.execute("INSERT INTO reminders (shop_id,order_id,wa,sent_at,status) VALUES (?,?,?,?,?)",
              (sid, oid, o[1], datetime.now().isoformat(), "sent" if ok else "failed"))
    conn.commit(); conn.close()
    return jsonify({"ok": ok, "msg": "Terkirim" if ok else "WAHA mati / gagal"})

@app.route("/admin/remind-all", methods=["POST"])
def admin_remind_all():
    if not authed():
        return jsonify({"ok": False, "msg": "no"}), 403
    sid = cur_shop()
    conn = conn_db(); c = conn.cursor()
    rows = c.execute("SELECT id,customer_name,wa,total_rp,invoice_no FROM orders "
                    "WHERE shop_id=? AND status IN ('menunggu','diproses','dikirim') "
                    "AND wa IS NOT NULL AND wa!=''", (sid,)).fetchall()
    prefix = c.execute("SELECT invoice_no_prefix FROM shops WHERE id=?", (sid,)).fetchone()[0]
    sent = 0; failed = 0
    for oid, cname, wa, total, inv in rows:
        inv_no = inv or f"{prefix}-{oid:03d}"
        ok = send_wa(wa, reminder_text(cname, inv_no, total))
        c.execute("INSERT INTO reminders (shop_id,order_id,wa,sent_at,status) VALUES (?,?,?,?,?)",
                  (sid, oid, wa, datetime.now().isoformat(), "sent" if ok else "failed"))
        sent += 1 if ok else 0; failed += 0 if ok else 1
    conn.commit(); conn.close()
    return jsonify({"ok": True, "sent": sent, "failed": failed})

# ===================== ROUTES: MULTI-TENANT (TOKO) =====================
@app.route("/admin/shops", methods=["GET", "POST"])
def admin_shops():
    if not authed():
        return redirect("/admin")
    conn = conn_db(); c = conn.cursor()
    if request.method == "POST":
        d = request.form
        c.execute("INSERT INTO shops (name,wa,password,invoice_no_prefix,created_at) "
                  "VALUES (?,?,?,?,?)",
                  (d.get("name"), d.get("wa"), d.get("password"),
                   d.get("prefix", "INV"), datetime.now().isoformat()))
        conn.commit()
    rows = c.execute("SELECT id,name,wa,invoice_no_prefix,invoice_seq FROM shops ORDER BY id").fetchall()
    conn.close()
    return render_template_string(SHOPS_HTML, shops=rows)

# ===================== RAG =====================
@app.route("/api/rag", methods=["POST"])
def api_rag():
    if not authed():
        return jsonify({"answer": "Login dulu."})
    q = (request.json or {}).get("q", "")
    if not q:
        return jsonify({"answer": "Pertanyaan kosong."})
    import subprocess, sys
    try:
        res = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "rag.py"),
                              "ask", q], capture_output=True, text=True, timeout=150)
        ans = res.stdout.strip() or res.stderr.strip() or "Gagal memproses."
    except Exception as e:
        ans = f"Error: {e}"
    return jsonify({"answer": ans})

# ===================== TEMPLATES =====================
LANDING_HTML = """
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Titiport — Jasa Titip Beli China</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:Segoe UI,system-ui,sans-serif}
body{background:#0f1115;color:#e8eaed}
.wrap{max-width:560px;margin:0 auto;padding:24px}
.hd{text-align:center;padding:32px 0 16px}
.hd h1{font-size:28px;color:#ff7a45}
.hd p{color:#9aa0a6;margin-top:8px}
.card{background:#1a1d23;border:1px solid #2a2e36;border-radius:14px;padding:20px;margin:16px 0}
label{display:block;font-size:13px;color:#bdc1c6;margin:12px 0 6px}
input,select,textarea{width:100%;padding:11px;border-radius:9px;border:1px solid #2a2e36;
  background:#0f1115;color:#e8eaed;font-size:14px}
input:focus,select:focus,textarea:focus{outline:none;border-color:#ff7a45}
.row{display:flex;gap:12px}.row>div{flex:1}
.btn{width:100%;padding:13px;margin-top:18px;border:none;border-radius:10px;
  background:#ff7a45;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
.btn:hover{background:#ff905f}
.btn2{background:#2a2e36}
.res{margin-top:16px;padding:16px;background:#0f1115;border-radius:10px;
  border:1px solid #2a2e36;display:none}
.res.show{display:block}
.res .line{display:flex;justify-content:space-between;padding:6px 0;
  border-bottom:1px dashed #2a2e36;font-size:14px}
.res .tot{color:#ff7a45;font-weight:700;font-size:17px;margin-top:8px}
.note{font-size:12px;color:#9aa0a6;margin-top:10px;line-height:1.5}
.nav{text-align:center;margin-top:8px}.nav a{color:#6bb8ff;text-decoration:none;font-size:13px;margin:0 8px}
</style></head><body><div class="wrap">
<div class="hd"><h1>📦 Titiport</h1><p>Jasa Titip Beli dari China — Taobao / 1688</p></div>
<div class="card">
<form id="f" onsubmit="return false">
  <label>Nama Lengkap</label><input id="name" placeholder="Budi Santoso">
  <label>Nomor WhatsApp</label><input id="wa" placeholder="62812xxxx">
  <label>Link Produk (Taobao/1688)</label>
  <input id="link" placeholder="https://item.taobao.com/...">
  <label>Deskripsi Barang</label>
  <textarea id="item" rows="2" placeholder="Nama model, warna, ukuran"></textarea>
  <div class="row">
    <div><label>Subtotal (CNY)</label><input id="cny" type="number" value="500"></div>
    <div><label>Berat (kg)</label><input id="weight" type="number" value="1"></div>
  </div>
  <label>Volume (CBM) — Cargo Laut</label>
  <input id="cbm" type="number" value="0.1" step="0.1">
  <label>Metode Shipping</label>
  <select id="method">
    <option value="hancarry">Hancarry (batch) — Rp 250rb/kg</option>
    <option value="udara">Cargo Udara — Rp 235rb/kg (mulai)</option>
    <option value="laut">Cargo Laut — Rp 6,5jt/CBM</option>
  </select>
  <label>Alamat Tujuan</label>
  <textarea id="alamat" rows="2" placeholder="Jalan, kota, kode pos"></textarea>
  <input type="hidden" id="shop_id" value="{{ shop_id }}">
  <button class="btn" onclick="hitung()">Hitung Estimasi</button>
  <button class="btn btn2" onclick="order()">Kirim Pesanan</button>
</form>
<div class="res" id="res"></div>
<div class="note">💡 Fee: 15% (<1000 CNY) · 10% (≥1500 CNY). Kurs Rp 2.750/CNY.
Ongkir dibill terpisah setelah berat diukur di gudang.</div>
</div>
<div class="nav"><a href="/katalog?shop=Titiport">🛍 Lihat Katalog</a> · <a href="/admin">🔐 Admin</a></div>
</div>
<script>
function data(){return {name:name.value,wa:wa.value,link:link.value,item:item.value,
  cny:+cny.value,weight:+weight.value,cbm:+cbm.value,method:method.value,alamat:alamat.value,shop_id:+shop_id.value};}
function show(r){const e=res;e.classList.add('show');
  e.innerHTML=`<div class="line"><span>Barang (${data().cny} CNY)</span><span>${fmt(r.barang_rp)}</span></div>
  <div class="line"><span>Fee ${(r.fee_rate*100).toFixed(0)}%</span><span>${fmt(r.fee_rp)}</span></div>
  <div class="line"><span>Ongkir (est)</span><span>${fmt(r.ongkir_rp)}</span></div>
  <div class="line tot"><span>TOTAL ESTIMASI</span><span>${fmt(r.total_rp)}</span></div>`;}
function fmt(n){return 'Rp '+n.toLocaleString('id-ID');}
async function hitung(){const r=await fetch('/api/hitung',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(data())}).then(x=>x.json());show(r);}
async function order(){const r=await fetch('/api/order',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(data())}).then(x=>x.json());
  if(r.ok){alert('Pesanan terkirim! Invoice: '+r.invoice+'\\nTotal: '+fmt(r.total)+'\\nAdmin akan konfirmasi via WA.');res.classList.remove('show');}}
</script></body></html>
"""

ADMIN_LOGIN_HTML = """
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Admin Titiport</title>
<style>body{background:#0f1115;color:#e8eaed;font-family:Segoe UI,sans-serif;
display:flex;height:100vh;align-items:center;justify-content:center}
.box{background:#1a1d23;border:1px solid #2a2e36;padding:32px;border-radius:14px;width:340px}
h2{color:#ff7a45;margin-bottom:16px}
input{width:100%;padding:11px;border-radius:9px;border:1px solid #2a2e36;
background:#0f1115;color:#e8eaed;margin-bottom:12px}
button{width:100%;padding:11px;border:none;border-radius:9px;background:#ff7a45;color:#fff;font-weight:600;cursor:pointer}
.note{font-size:12px;color:#9aa0a6;margin-top:10px;text-align:center}
</style></head><body><div class="box">
<h2>🔐 Login Toko</h2>
<form method="POST" action="/admin/login">
<input name="shop" placeholder="Nama Toko (mis. Titiport)">
<input name="pass" type="password" placeholder="Password">
<button>Masuk</button></form>
<div class="note">Default: Titiport / titiport123</div></div></body></html>
"""

ADMIN_HTML = """
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Titiport — Orders</title>
<style>
*{box-sizing:border-box;font-family:Segoe UI,system-ui,sans-serif}
body{background:#0f1115;color:#e8eaed;padding:20px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px}
.top h1{color:#ff7a45;font-size:22px}
a.log{color:#9aa0a6;text-decoration:none;font-size:13px;margin:0 4px}
.bar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
.bar a{padding:6px 12px;border-radius:20px;background:#1a1d23;border:1px solid #2a2e36;
  color:#bdc1c6;text-decoration:none;font-size:13px}
.bar a.act{background:#ff7a45;color:#fff;border-color:#ff7a45}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:9px 7px;text-align:left;border-bottom:1px solid #2a2e36}
th{color:#9aa0a6;font-weight:600;position:sticky;top:0;background:#0f1115}
.badge{padding:4px 9px;border-radius:20px;font-size:11px;font-weight:600}
.menunggu{background:#3a2f12;color:#ffce6b}.diproses{background:#10324a;color:#6bb8ff}
.dikirim{background:#103a2a;color:#6bffb0}.bayar{background:#3a1212;color:#ff8b8b}.batal{background:#2a2a2a;color:#888}
select{padding:5px;border-radius:7px;background:#1a1d23;color:#e8eaed;border:1px solid #2a2e36}
.total{color:#ff7a45;font-weight:700}
.actbtn{background:none;border:none;color:#6bb8ff;cursor:pointer;font-size:13px;margin-right:6px}
.actbtn.del{color:#ff8b8b}.actbtn.inv{color:#ffce6b}
.wrap{overflow-x:auto}
</style></head><body>
<div class="top"><h1>📋 Daftar Order ({{ orders|length }}) — {{ shop_name }}</h1>
<div><a class="log" href="/admin/products">🛍 Produk</a> <a class="log" href="/katalog?shop={{ shop_name }}">🌐 Katalog</a>
<a class="log" href="/admin/reminders">🔔 Pengingat</a> <a class="log" href="/admin/shops">🏪 Toko</a>
<a class="log" href="/admin/crm">🔗 CRM</a>
<a class="log" href="/dashboard">📊 Dashboard</a> <a class="log" href="/admin/export">⬇ CSV</a>
<a class="log" href="/admin/logout">Logout</a></div></div>
<div class="bar">
<a class="{{ 'act' if not current }}" href="/admin">Semua</a>
{% for s in statuses %}<a class="{{ 'act' if current==s }}" href="/admin?status={{s}}">{{s}}</a>{% endfor %}
</div>
<div class="wrap"><table><tr><th>#</th><th>Inv</th><th>Customer</th><th>WA</th><th>Item</th><th>CNY</th><th>Method</th>
<th>Barang</th><th>Fee</th><th>Ongkir</th><th>Total</th><th>Status</th><th>Aksi</th></tr>
{% for o in orders %}
<tr>
<td>{{ o[0] }}</td><td>{{ o[18] or ('INV-%03d'%o[0]) }}</td><td>{{ o[1] }}</td><td>{{ o[2] }}</td><td>{{ o[5][:20] }}</td>
<td>{{ o[6] }}</td><td>{{ o[9] }}</td>
<td>{{ fmt(o[12]) }}</td><td>{{ fmt(o[11]) }}</td><td>{{ fmt(o[13]) }}</td>
<td class="total">{{ fmt(o[14]) }}</td>
<td><span class="badge {{ o[15] }}">{{ o[15] }}</span></td>
<td>
<a class="actbtn inv" href="/admin/invoice/{{ o[0] }}" target="_blank">🧾 Invoice</a>
<button class="actbtn" onclick="remind({{ o[0] }})">🔔 Remind</button>
<button class="actbtn" style="color:#ffce6b" onclick="emailRemind({{ o[0] }})">📧 Email</button>
<a class="actbtn" href="/admin/edit/{{ o[0] }}">✏ Edit</a>
<button class="actbtn del" onclick="del({{ o[0] }})">🗑</button>
<select onchange="upd({{ o[0] }},this.value)">
{% for s in statuses %}<option value="{{s}}" {{ 'selected' if o[15]==s }}>{{s}}</option>{% endfor %}
</select>
</td>
</tr>
{% endfor %}
</table></div>
<div class="card" style="margin-top:20px">
<h3 style="color:#ff7a45;margin-bottom:12px">🤖 CS Assistant (RAG)</h3>
<textarea id="raq" rows="2" style="width:100%;padding:10px;border-radius:9px;border:1px solid #2a2e36;background:#0f1115;color:#e8eaed" placeholder="Tanya soal policy, order, atau produk..."></textarea>
<button class="btn btn2" style="margin-top:10px;width:auto;padding:10px 18px" onclick="ragAsk()">Tanya AI</button>
<div id="ragout" style="margin-top:12px;padding:12px;background:#0f1115;border-radius:9px;border:1px solid #2a2e36;display:none;white-space:pre-wrap;font-size:14px"></div>
</div>
<script>
async function upd(id,st){await fetch('/admin/update/'+id,{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({status:st})});location.reload();}
async function del(id){if(!confirm('Hapus order #'+id+'?'))return;
  await fetch('/admin/delete/'+id,{method:'POST'});location.reload();}
async function remind(id){if(!confirm('Kirim pengingat WA ke #'+id+'?'))return;
  const r=await fetch('/admin/remind/'+id,{method:'POST'});const d=await r.json();
  alert(d.ok? 'Terkirim!':('Gagal: '+(d.msg||'WAHA mati?')));}
async function emailRemind(id){const email=prompt('Email customer untuk pengingat #'+id+'?');
  if(!email)return;
  const r=await fetch('/admin/crm/email/'+id,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email})});const d=await r.json();
  alert(d.ok? 'Email terkirim!':('Gagal: '+(d.msg||'')));}
async function ragAsk(){const q=raq.value;if(!q)return;
  const r=await fetch('/api/rag',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({q})});const d=await r.json();
  ragout.style.display='block';ragout.textContent=d.answer;}
</script></body></html>
"""

ADMIN_EDIT_HTML = """
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Edit Order</title>
<style>body{background:#0f1115;color:#e8eaed;font-family:Segoe UI,sans-serif;padding:24px}
.box{max-width:480px;margin:0 auto;background:#1a1d23;border:1px solid #2a2e36;padding:24px;border-radius:14px}
h2{color:#ff7a45;margin-bottom:16px}
label{display:block;font-size:13px;color:#bdc1c6;margin:10px 0 5px}
input,select,textarea{width:100%;padding:10px;border-radius:9px;border:1px solid #2a2e36;background:#0f1115;color:#e8eaed}
button{width:100%;padding:12px;margin-top:18px;border:none;border-radius:9px;background:#ff7a45;color:#fff;font-weight:600;cursor:pointer}
a{color:#6bb8ff;text-decoration:none;font-size:13px}
</style></head><body><div class="box">
<h2>✏ Edit Order #{{ o[0] }}</h2>
<form method="POST">
<label>Nama</label><input name="name" value="{{ o[1] }}">
<label>WA</label><input name="wa" value="{{ o[2] }}">
<label>Link</label><input name="link" value="{{ o[4] }}">
<label>Item</label><textarea name="item" rows="2">{{ o[5] }}</textarea>
<label>Subtotal CNY</label><input name="cny" type="number" step="0.01" value="{{ o[6] }}">
<label>Berat (kg)</label><input name="weight" type="number" step="0.1" value="{{ o[7] }}">
<label>Volume CBM</label><input name="cbm" type="number" step="0.1" value="{{ o[8] }}">
<label>Method</label><select name="method">
{% for k,v in SHIPPING.items() %}<option value="{{k}}" {{ 'selected' if o[9]==k }}>{{v.label}}</option>{% endfor %}
</select>
<label>Status</label><select name="status">
{% for s in statuses %}<option value="{{s}}" {{ 'selected' if o[15]==s }}>{{s}}</option>{% endfor %}
</select>
<label>Alamat</label><textarea name="alamat" rows="2">{{ o[3] }}</textarea>
<button>💾 Simpan</button>
</form><p style="margin-top:12px"><a href="/admin">← Kembali</a></p></div></body></html>
"""

DASHBOARD_HTML = """
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Titiport — Dashboard</title>
<style>
*{box-sizing:border-box;font-family:Segoe UI,system-ui,sans-serif}
body{background:#0f1115;color:#e8eaed;padding:20px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.top h1{color:#ff7a45;font-size:22px}
a.link{color:#9aa0a6;text-decoration:none;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.kpi{background:#1a1d23;border:1px solid #2a2e36;border-radius:12px;padding:16px}
.kpi .v{font-size:20px;font-weight:700;color:#ff7a45}.kpi .l{font-size:12px;color:#9aa0a6;margin-top:4px}
.kpi.ok .v{color:#6bffb0}.kpi.warn .v{color:#ffce6b}
.sec{background:#1a1d23;border:1px solid #2a2e36;border-radius:12px;padding:16px;margin-bottom:16px}
.sec h3{color:#ff7a45;margin-bottom:12px;font-size:15px}
.stbar{display:flex;gap:8px;flex-wrap:wrap}
.chip{background:#0f1115;border:1px solid #2a2e36;border-radius:20px;padding:6px 12px;font-size:13px}
.chip b{color:#ff7a45}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:8px 6px;text-align:left;border-bottom:1px solid #2a2e36}
.total{color:#ff7a45;font-weight:700}
</style></head><body>
<div class="top"><h1>📊 Dashboard</h1><a class="link" href="/admin">← Admin</a></div>
<div class="grid">
<div class="kpi"><div class="v">{{ kpi.total_orders }}</div><div class="l">Total Order</div></div>
<div class="kpi"><div class="v">{{ fmt(kpi.total_all) }}</div><div class="l">Total GMV</div></div>
<div class="kpi ok"><div class="v">{{ fmt(kpi.total_fee) }}</div><div class="l">Total Fee (Laba)</div></div>
<div class="kpi"><div class="v">{{ fmt(kpi.total_ongkir) }}</div><div class="l">Total Ongkir</div></div>
<div class="kpi warn"><div class="v">{{ fmt(kpi.outstanding) }}</div><div class="l">Outstanding</div></div>
<div class="kpi ok"><div class="v">{{ fmt(kpi.paid) }}</div><div class="l">Sudah Bayar</div></div>
</div>
<div class="sec"><h3>Pipeline per Status</h3><div class="stbar">
{% for st, n in kpi.by_status.items() %}<span class="chip">{{ st }}: <b>{{ n }}</b></span>{% endfor %}
</div></div>
<div class="sec"><h3>Top Customers</h3>
<table><tr><th>Customer</th><th>Orders</th><th>GMV</th></tr>
{% for nm, d in kpi.top_cust %}<tr><td>{{ nm }}</td><td>{{ d.n }}</td><td class="total">{{ fmt(d.v) }}</td></tr>{% endfor %}
</table></div>
</body></html>
"""

TRACKER_HTML = """
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Titiport — Business Tracker</title>
<style>
*{box-sizing:border-box;font-family:Segoe UI,system-ui,sans-serif}
body{background:#0f1115;color:#e8eaed;padding:20px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.top h1{color:#ff7a45;font-size:22px}
a.link{color:#9aa0a6;text-decoration:none;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.kpi{background:#1a1d23;border:1px solid #2a2e36;border-radius:12px;padding:16px}
.kpi .v{font-size:20px;font-weight:700;color:#ff7a45}.kpi .l{font-size:12px;color:#9aa0a6;margin-top:4px}
.kpi.ok .v{color:#6bffb0}.kpi.warn .v{color:#ffce6b}
.sec{background:#1a1d23;border:1px solid #2a2e36;border-radius:12px;padding:16px;margin-bottom:16px}
.sec h3{color:#ff7a45;margin-bottom:12px;font-size:15px}
.stbar{display:flex;gap:8px;flex-wrap:wrap}
.chip{background:#0f1115;border:1px solid #2a2e36;border-radius:20px;padding:6px 12px;font-size:13px}
.chip b{color:#ff7a45}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:8px 6px;text-align:left;border-bottom:1px solid #2a2e36}
.total{color:#ff7a45;font-weight:700}
</style></head><body>
<div class="top"><h1>📊 Business Tracker</h1><a class="link" href="/admin">← Admin</a></div>
<div class="grid">
<div class="kpi"><div class="v">{{ kpi.total_orders }}</div><div class="l">Total Order</div></div>
<div class="kpi"><div class="v">{{ fmt(kpi.total_all) }}</div><div class="l">Total GMV</div></div>
<div class="kpi ok"><div class="v">{{ fmt(kpi.total_fee) }}</div><div class="l">Total Fee (Laba)</div></div>
<div class="kpi"><div class="v">{{ fmt(kpi.total_ongkir) }}</div><div class="l">Total Ongkir Dibill</div></div>
<div class="kpi warn"><div class="v">{{ fmt(kpi.outstanding) }}</div><div class="l">Outstanding</div></div>
<div class="kpi ok"><div class="v">{{ fmt(kpi.paid) }}</div><div class="l">Sudah Bayar</div></div>
</div>
<div class="sec"><h3>Pipeline per Status</h3><div class="stbar">
{% for st, n in kpi.by_status.items() %}<span class="chip">{{ st }}: <b>{{ n }}</b></span>{% endfor %}
</div></div>
<div class="sec"><h3>Top Customers</h3>
<table><tr><th>Customer</th><th>Orders</th><th>GMV</th></tr>
{% for nm, d in kpi.top_cust %}<tr><td>{{ nm }}</td><td>{{ d.n }}</td><td class="total">{{ fmt(d.v) }}</td></tr>{% endfor %}
</table></div>
<div class="sec"><h3>Recent Orders</h3>
<table><tr><th>#</th><th>Customer</th><th>Item</th><th>CNY</th><th>Total</th><th>Status</th></tr>
{% for o in orders[:15] %}<tr><td>{{ o[0] }}</td><td>{{ o[1] }}</td><td>{{ o[5][:25] }}</td>
<td>{{ o[6] }}</td><td class="total">{{ fmt(o[14]) }}</td><td>{{ o[15] }}</td></tr>{% endfor %}
</table></div>
</body></html>
"""

PRODUCTS_HTML = """
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Produk — {{ shop_name }}</title>
<style>body{background:#0f1115;color:#e8eaed;font-family:Segoe UI,sans-serif;padding:20px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.top h1{color:#ff7a45;font-size:22px}
a.log{color:#9aa0a6;text-decoration:none;font-size:13px;margin:0 4px}
.card{background:#1a1d23;border:1px solid #2a2e36;border-radius:14px;padding:18px;margin-bottom:16px}
label{display:block;font-size:13px;color:#bdc1c6;margin:8px 0 5px}
input,textarea{width:100%;padding:10px;border-radius:9px;border:1px solid #2a2e36;background:#0f1115;color:#e8eaed}
.row{display:flex;gap:10px}.row>div{flex:1}
button{padding:10px 16px;margin-top:12px;border:none;border-radius:9px;background:#ff7a45;color:#fff;font-weight:600;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
th,td{padding:9px 7px;text-align:left;border-bottom:1px solid #2a2e36}
.badge{padding:4px 9px;border-radius:20px;font-size:11px;font-weight:600}
.stok-ok{background:#103a2a;color:#6bffb0}.stok-low{background:#3a2f12;color:#ffce6b}.stok-0{background:#3a1212;color:#ff8b8b}
.actbtn{background:none;border:none;color:#6bb8ff;cursor:pointer;font-size:13px;margin-right:6px}
.actbtn.del{color:#ff8b8b}
</style></head><body>
<div class="top"><h1>🛍 Katalog Produk — {{ shop_name }}</h1>
<div><a class="log" href="/admin">← Admin</a> <a class="log" href="/katalog?shop={{ shop_name }}">🌐 Lihat Katalog</a></div></div>
<div class="card">
<h3 style="color:#ff7a45;margin-bottom:8px">Tambah Produk</h3>
<form method="POST">
<div class="row"><div><label>SKU</label><input name="sku" placeholder="SKU-001"></div>
<div><label>Kategori</label><input name="category" placeholder="Skincare"></div></div>
<label>Nama</label><input name="name" placeholder="Nama produk">
<label>Deskripsi</label><textarea name="desc" rows="2"></textarea>
<div class="row"><div><label>Harga CNY</label><input name="price_cny" type="number" step="0.01" value="0"></div>
<div><label>Harga Rp (jual)</label><input name="price_rp" type="number" value="0"></div>
<div><label>Stok</label><input name="stock" type="number" value="0"></div></div>
<button>➕ Tambah</button></form></div>
<table><tr><th>#</th><th>SKU</th><th>Nama</th><th>Kategori</th><th>Harga Rp</th><th>Stok</th><th>Aksi</th></tr>
{% for p in products %}
<tr>
<td>{{ p[0] }}</td><td>{{ p[2] }}</td><td>{{ p[3] }}</td><td>{{ p[8] }}</td>
<td>{{ fmt(p[6]) }}</td>
<td>{% set s = p[7] %}{% if s>5 %}<span class="badge stok-ok">{{ s }}</span>
{% elif s>0 %}<span class="badge stok-low">{{ s }}</span>
{% else %}<span class="badge stok-0">0 (habis)</span>{% endif %}</td>
<td>
<button class="actbtn" onclick="stk({{ p[0] }},1)">+1</button>
<button class="actbtn" onclick="stk({{ p[0] }},-1)">-1</button>
<button class="actbtn" onclick="orderFrom({{ p[0] }})">🛒 Order</button>
<a class="actbtn" href="/admin/product/edit/{{ p[0] }}">✏</a>
<button class="actbtn del" onclick="del({{ p[0] }})">🗑</button>
</td>
</tr>
{% endfor %}
</table>
<script>
async function stk(id,d){await fetch('/admin/product/stock/'+id+'/'+d,{method:'POST'});location.reload();}
async function orderFrom(id){if(!confirm('Buat order dari stok (-1)?'))return;
  const r=await fetch('/admin/product/order/'+id,{method:'POST'}).then(x=>x.json());
  alert(r.ok?('Order dibuat: '+r.invoice):('Gagal: '+(r.msg||'')));location.reload();}
async function del(id){if(!confirm('Hapus produk #'+id+'?'))return;
  await fetch('/admin/product/delete/'+id,{method:'POST'});location.reload();}
</script></body></html>
"""

PRODUCT_EDIT_HTML = """
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Edit Produk</title>
<style>body{background:#0f1115;color:#e8eaed;font-family:Segoe UI,sans-serif;padding:24px}
.box{max-width:480px;margin:0 auto;background:#1a1d23;border:1px solid #2a2e36;padding:24px;border-radius:14px}
h2{color:#ff7a45;margin-bottom:16px}
label{display:block;font-size:13px;color:#bdc1c6;margin:10px 0 5px}
input,textarea{width:100%;padding:10px;border-radius:9px;border:1px solid #2a2e36;background:#0f1115;color:#e8eaed}
.row{display:flex;gap:10px}.row>div{flex:1}
button{width:100%;padding:12px;margin-top:18px;border:none;border-radius:9px;background:#ff7a45;color:#fff;font-weight:600;cursor:pointer}
a{color:#6bb8ff;text-decoration:none;font-size:13px}
</style></head><body><div class="box">
<h2>✏ Edit Produk #{{ p[0] }}</h2>
<form method="POST">
<div class="row"><div><label>SKU</label><input name="sku" value="{{ p[2] }}"></div>
<div><label>Kategori</label><input name="category" value="{{ p[8] }}"></div></div>
<label>Nama</label><input name="name" value="{{ p[3] }}">
<label>Deskripsi</label><textarea name="desc" rows="2">{{ p[4] }}</textarea>
<div class="row"><div><label>Harga CNY</label><input name="price_cny" type="number" step="0.01" value="{{ p[5] }}"></div>
<div><label>Harga Rp</label><input name="price_rp" type="number" value="{{ p[6] }}"></div>
<div><label>Stok</label><input name="stock" type="number" value="{{ p[7] }}"></div></div>
<button>💾 Simpan</button>
</form><p style="margin-top:12px"><a href="/admin/products">← Kembali</a></p></div></body></html>
"""

KATALOG_HTML = """
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Katalog — {{ shop }}</title>
<style>body{background:#0f1115;color:#e8eaed;font-family:Segoe UI,sans-serif;padding:20px}
.top{text-align:center;padding:20px 0}.top h1{color:#ff7a45;font-size:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;max-width:900px;margin:0 auto}
.card{background:#1a1d23;border:1px solid #2a2e36;border-radius:12px;padding:16px}
.card h3{color:#ff7a45;font-size:15px;margin-bottom:6px}
.card .cat{font-size:12px;color:#9aa0a6}
.card .pr{font-size:16px;font-weight:700;margin-top:8px}
.card .st{font-size:12px;margin-top:6px}
.badge{padding:3px 8px;border-radius:20px;font-size:11px;font-weight:600}
.stok-ok{background:#103a2a;color:#6bffb0}.stok-low{background:#3a2f12;color:#ffce6b}.stok-0{background:#3a1212;color:#ff8b8b}
a.back{color:#6bb8ff;text-decoration:none;display:block;text-align:center;margin-top:20px}
</style></head><body>
<div class="top"><h1>🛍 Katalog {{ shop }}</h1><p style="color:#9aa0a6">Stok realtime</p></div>
<div class="grid">
{% for name,desc,price_rp,stock,cat in rows %}
<div class="card">
<h3>{{ name }}</h3>
<div class="cat">{{ cat or '—' }}{% if desc %} · {{ desc[:40] }}{% endif %}</div>
<div class="pr">{{ fmt(price_rp) }}</div>
<div class="st">{% if stock>5 %}<span class="badge stok-ok">Stok: {{ stock }}</span>
{% elif stock>0 %}<span class="badge stok-low">Stok: {{ stock }}</span>
{% else %}<span class="badge stok-0">Habis</span>{% endif %}</div>
</div>
{% endfor %}
</div>
<a class="back" href="/">← Order di Titiport</a></body></html>
"""

REMINDERS_HTML = """
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Pengingat WA</title>
<style>body{background:#0f1115;color:#e8eaed;font-family:Segoe UI,sans-serif;padding:20px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.top h1{color:#ff7a45;font-size:22px}
a.log{color:#9aa0a6;text-decoration:none;font-size:13px}
button{padding:10px 16px;border:none;border-radius:9px;background:#ff7a45;color:#fff;font-weight:600;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}
th,td{padding:9px 7px;text-align:left;border-bottom:1px solid #2a2e36}
.badge{padding:4px 9px;border-radius:20px;font-size:11px;font-weight:600}
.sent{background:#103a2a;color:#6bffb0}.failed{background:#3a1212;color:#ff8b8b}
.note{font-size:12px;color:#9aa0a6;margin-top:12px;line-height:1.6}
</style></head><body>
<div class="top"><h1>🔔 Log Pengingat WA</h1><a class="log" href="/admin">← Admin</a></div>
<button onclick="remindAll()">📣 Kirim ke semua order belum lunas</button>
<div class="note">Scheduler otomatis jalan tiap hari 09:00 (maks 1x per 3 hari per order) — butuh WAHA nyala di {{ waha }}.</div>
<table><tr><th>#</th><th>Order</th><th>WA</th><th>Waktu</th><th>Status</th></tr>
{% for r in rows %}
<tr><td>{{ r[0] }}</td><td>{{ r[5] or ('#'+r[1]|string) }}</td><td>{{ r[2] }}</td><td>{{ r[3][:19] }}</td>
<td><span class="badge {{ r[4] }}">{{ r[4] }}</span></td></tr>
{% endfor %}
</table>
<script>
async function remindAll(){if(!confirm('Kirim pengingat ke SEMUA order belum lunas?'))return;
  const r=await fetch('/admin/remind-all',{method:'POST'}).then(x=>x.json());
  if(r.ok)alert('Terkirim: '+r.sent+' | Gagal: '+r.failed+(r.failed? ' (WAHA mati?)':''));
  else alert('Gagal');}
</script></body></html>
""".replace("{{ waha }}", WAHA_URL)

SHOPS_HTML = """
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Toko</title>
<style>body{background:#0f1115;color:#e8eaed;font-family:Segoe UI,sans-serif;padding:20px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.top h1{color:#ff7a45;font-size:22px}
a.log{color:#9aa0a6;text-decoration:none;font-size:13px}
.card{background:#1a1d23;border:1px solid #2a2e36;border-radius:14px;padding:18px;margin-bottom:16px}
label{display:block;font-size:13px;color:#bdc1c6;margin:8px 0 5px}
input{width:100%;padding:10px;border-radius:9px;border:1px solid #2a2e36;background:#0f1115;color:#e8eaed}
.row{display:flex;gap:10px}.row>div{flex:1}
button{padding:10px 16px;margin-top:12px;border:none;border-radius:9px;background:#ff7a45;color:#fff;font-weight:600;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
th,td{padding:9px 7px;text-align:left;border-bottom:1px solid #2a2e36}
</style></head><body>
<div class="top"><h1>🏪 Multi-Tenant (Toko)</h1><a class="log" href="/admin">← Admin</a></div>
<div class="card">
<h3 style="color:#ff7a45;margin-bottom:8px">Tambah Toko Baru</h3>
<form method="POST">
<div class="row"><div><label>Nama Toko</label><input name="name" placeholder="Jastip Mawar"></div>
<div><label>WA Pengirim (62...)</label><input name="wa" placeholder="62812xxxx"></div></div>
<div class="row"><div><label>Password Login</label><input name="password" placeholder="pass"></div>
<div><label>Prefix Invoice</label><input name="prefix" value="INV"></div></div>
<button>➕ Buat Toko</button></form></div>
<table><tr><th>#</th><th>Nama</th><th>WA</th><th>Prefix</th><th>Seq</th></tr>
{% for s in shops %}<tr><td>{{ s[0] }}</td><td>{{ s[1] }}</td><td>{{ s[2] }}</td><td>{{ s[3] }}</td><td>{{ s[4] }}</td></tr>{% endfor %}
</table>
<p style="color:#9aa0a6;font-size:12px;margin-top:12px">Login per toko: pakai Nama Toko + password di halaman /admin.</p>
</body></html>
"""

CRM_HTML = """
<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>CRM — Google Workspace</title>
<style>body{background:#0f1115;color:#e8eaed;font-family:Segoe UI,sans-serif;padding:20px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.top h1{color:#ff7a45;font-size:22px}
a.log{color:#9aa0a6;text-decoration:none;font-size:13px}
.card{background:#1a1d23;border:1px solid #2a2e36;border-radius:14px;padding:18px;margin-bottom:16px}
button{padding:11px 18px;border:none;border-radius:9px;background:#ff7a45;color:#fff;font-weight:600;cursor:pointer;font-size:14px}
.badge{padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600}
.ok{background:#103a2a;color:#6bffb0}.no{background:#3a1212;color:#ff8b8b}
.note{font-size:12px;color:#9aa0a6;margin-top:10px;line-height:1.6}
</style></head><body>
<div class="top"><h1>🔗 CRM — Google Workspace</h1><a class="log" href="/admin">← Admin</a></div>
<div class="card">
<h3 style="color:#ff7a45;margin-bottom:10px">Status Integrasi</h3>
<p>gws CLI: {% if gws_ok %}<span class="badge ok">TERHUBUNG</span>{% else %}<span class="badge no">OFFLINE</span>{% endif %}</p>
<p class="note">CRM wajib lewat Google: Customer → Google Contacts, Reminder/Invoice → Gmail, Ledger → Google Sheets.</p>
<button onclick="sync()">🔄 Sync Semua Customer ke Google Contacts + Sheets</button>
<div id="out" style="margin-top:12px;font-size:14px"></div>
</div>
<p class="note">Setelah sync pertama, Spreadsheet ID otomatis tersimpan di env CRM_SHEET_ID (ledger akan nempel di sheet yang sama).</p>
<script>
async function sync(){const r=await fetch('/admin/crm/sync',{method:'POST'}).then(x=>x.json());
  out.textContent = r.ok? ('Sukses! '+r.synced+' customer disinkron.') : ('Gagal: '+(r.msg||''));}
</script></body></html>
"""

# ===================== SCHEDULER =====================
@app.route("/admin/crm/sync", methods=["POST"])
def admin_crm_sync():
    if not authed():
        return jsonify({"ok": False, "msg": "no"}), 403
    if not GWS_OK:
        return jsonify({"ok": False, "msg": "gws_crm tidak tersedia"})
    DB = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "orders.db"))
    try:
        res = gws_crm.batch_sync_customers(DB, os.environ.get("CRM_SHEET_ID"))
        return jsonify({"ok": True, **res})
    except Exception as e:
        return jsonify({"ok": False, "msg": str(e)})

@app.route("/admin/crm/email/<int:oid>", methods=["POST"])
def admin_crm_email(oid):
    if not authed():
        return jsonify({"ok": False, "msg": "no"}), 403
    if not GWS_OK:
        return jsonify({"ok": False, "msg": "gws_crm tidak tersedia"})
    sid = cur_shop()
    conn = conn_db(); c = conn.cursor()
    o = c.execute("SELECT customer_name,wa,total_rp,invoice_no,status,created_at FROM orders "
                  "WHERE id=? AND shop_id=?", (oid, sid)).fetchone()
    conn.close()
    if not o:
        return jsonify({"ok": False, "msg": "order tidak ada"})
    email = (request.json or {}).get("email") or request.form.get("email")
    if not email:
        return jsonify({"ok": False, "msg": "email customer kosong"})
    prefix = c.execute("SELECT invoice_no_prefix FROM shops WHERE id=?", (sid,)).fetchone()[0] if False else ""
    inv_no = o[3] or f"INV-{oid:03d}"
    try:
        mid = gws_crm.send_reminder_email(email, o[0], inv_no, o[2], o[4])
        return jsonify({"ok": bool(mid), "msg": "Email terkirim" if mid else "gagal"})
    except Exception as e:
        return jsonify({"ok": False, "msg": str(e)})

@app.route("/admin/crm")
def admin_crm():
    if not authed():
        return redirect("/admin")
    return render_template_string(CRM_HTML, gws_ok=GWS_OK)

# ===================== SCHEDULER =====================
def start_scheduler():
    sched = BackgroundScheduler()
    sched.add_job(run_reminders, "cron", hour=9, minute=0)
    sched.start()
    print("scheduler started")

if __name__ == "__main__":
    if not app.debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        try:
            start_scheduler()
        except Exception as e:
            print("scheduler error:", e)
    app.run(host="0.0.0.0", port=5000, debug=True)
