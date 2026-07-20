# gws_crm.py — Titiport CRM via Google Workspace (gws CLI)
# Semua komunikasi CRM wajib lewat Google: Contacts (People API),
# Gmail (reminder + invoice), Sheets (ledger/share).
# Wrapper ini men-shell `gws` (sudah ter-otentikasi via `gws auth login`).
#
# Usage:
#   from gws_crm import contact_upsert, send_reminder_email, append_ledger, batch_sync_customers
#   contact_upsert("Budi", "62812000111", "budi@x.com", "Order INV-001")
#   send_reminder_email("budi@x.com", "Budi", "INV-001", 1831250)
#   append_ledger([["INV-001","Budi","1831250","menunggu"]])

import json, base64, os, subprocess, re, sqlite3, shutil

GWS = os.environ.get("GWS_BIN")
if not GWS:
    # resolve npm gws shim on Windows (gws.cmd) — node CLI
    npm = os.path.join(os.environ.get("APPDATA", ""), "npm")
    cand = os.path.join(npm, "gws.cmd")
    GWS = cand if os.path.exists(cand) else "gws"
# Windows npm shim needs cmd /c
USE_SHELL = GWS.endswith(".cmd")

def _run(parts, body=None, params=None):
    cmd = [GWS] + parts
    if params:
        cmd += ["--params", json.dumps(params)]
    if body:
        cmd += ["--json", json.dumps(body)]
    if USE_SHELL:
        cmd = ["cmd", "/c"] + cmd
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=60, shell=False)
    if p.returncode != 0:
        raise RuntimeError(f"gws {' '.join(parts)} failed: {p.stderr.strip() or p.stdout.strip()}")
    out = p.stdout.strip()
    if not out:
        return None
    try:
        return json.loads(out)
    except Exception:
        return out

def _wa_to_phone(wa):
    if not wa:
        return None
    w = re.sub(r"[^0-9]", "", wa)
    if w.startswith("0"):
        w = "62" + w[1:]
    if w.startswith("62") and len(w) >= 10:
        return "+" + w
    return None

def contact_search(name=None, email=None, phone=None):
    """Cari contact di Google Contacts. Return list of resourceNames."""
    q = name or email or phone or ""
    if not q:
        return []
    try:
        res = _run(["people", "people", "searchContacts"], params={"query": q, "readMask": "names,emailAddresses,phoneNumbers"})
    except Exception:
        return []
    return res.get("results", []) if isinstance(res, dict) else []

def contact_upsert(name, wa=None, email=None, note=None):
    """Buat/update contact. WA -> phoneNumber (E.164), email -> emailAddresses,
    note -> biography. Idempoten: kalau nama/email sama, update而不是 baru."""
    phone = _wa_to_phone(wa)
    existing = contact_search(name or email or phone)
    person = {"names": [{"givenName": name or "(tanpa nama)"}]}
    if phone:
        person["phoneNumbers"] = [{"value": phone, "type": "mobile"}]
    if email:
        person["emailAddresses"] = [{"value": email}]
    if note:
        person["biographies"] = [{"value": note}]
    # cek existing by email/phone lebih presisi
    target = None
    for r in existing:
        pn = r.get("person", {})
        ems = [e.get("value", "").lower() for e in pn.get("emailAddresses", [])]
        phs = [p.get("value", "") for p in pn.get("phoneNumbers", [])]
        if (email and email.lower() in ems) or (phone and phone in phs):
            target = r.get("person", {}).get("resourceName")
            break
    if target:
        try:
            _run(["people", target, "updateContact"],
                 body=person, params={"updatePersonFields": "names,emailAddresses,phoneNumbers,biographies"})
            return target
        except Exception as e:
            return f"update-failed:{e}"
    res = _run(["people", "people", "createContact"], body=person)
    if isinstance(res, dict):
        return res.get("resourceName", "created")
    return "created"

def send_reminder_email(to, name, inv_no, total, due=None):
    """Kirim email pengingat pembayaran via Gmail (HTML). Return message id."""
    if not to:
        return None
    due_txt = f" (jatuh tempo {due})" if due else ""
    html = f"""<div style="font-family:Segoe UI,sans-serif;color:#222">
<p>Halo Kak {name or ''},</p>
<p>Mohon maaf mengingatkan bahwa invoice <b>{inv_no}</b> sebesar
<b>Rp {total:,}</b>{due_txt} masih menunggu pembayaran.</p>
<p>Silakan melakukan transfer sesuai total agar pesanan dapat segera diproses.
Terima kasih telah berbelanja di Titiport 🙏</p>
</div>"""
    raw = (
        f"From: me\r\nTo: {to}\r\nSubject: Pengingat Pembayaran {inv_no}\r\n"
        f"MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n{html}"
    )
    b64 = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")
    res = _run(["gmail", "users", "messages", "send"],
               body={"raw": b64}, params={"userId": "me"})
    if isinstance(res, dict):
        return res.get("id")
    return None

SHEET_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "crm_sheet.txt")

def _load_sheet_id():
    if os.environ.get("CRM_SHEET_ID"):
        return os.environ["CRM_SHEET_ID"]
    if os.path.exists(SHEET_CACHE):
        with open(SHEET_CACHE) as f:
            v = f.read().strip()
            if v:
                return v
    return None

def _save_sheet_id(sid):
    with open(SHEET_CACHE, "w") as f:
        f.write(sid)
    os.environ["CRM_SHEET_ID"] = sid

def append_ledger(values, spreadsheet_id=None):
    """Tambah baris ke Google Sheets (CRM ledger). Pakai sheet tersimpan / buat baru."""
    sid = spreadsheet_id or _load_sheet_id()
    if not sid:
        sh = _run(["sheets", "spreadsheets", "create"],
                  body={"properties": {"title": "Titiport CRM Ledger"}})
        sid = sh.get("spreadsheetId")
        _run(["sheets", "spreadsheets", "values", "update"],
             body={"values": [["Invoice", "Customer", "WA", "Total", "Status", "Tanggal"]]},
             params={"spreadsheetId": sid, "range": "A1", "valueInputOption": "RAW"})
        _save_sheet_id(sid)
        rng = _run(["sheets", "spreadsheets", "values", "append"],
                   body={"values": [values]},
                   params={"spreadsheetId": sid, "range": "A1", "valueInputOption": "RAW"})
        return {"spreadsheetId": sid, "created": True,
                "updated": (rng or {}).get("updates", {}).get("updatedRows")}
    # dedupe: jangan append kalau invoice sudah ada di sheet
    try:
        existing = _run(["sheets", "spreadsheets", "values", "get"],
                        params={"spreadsheetId": sid, "range": "A2:A"})
        inv = values[0]
        for row in (existing or {}).get("values", []):
            if row and row[0] == inv:
                return {"spreadsheetId": sid, "updated": 0, "dup": True}
    except Exception:
        pass
    rng = _run(["sheets", "spreadsheets", "values", "append"],
               body={"values": [values]},
               params={"spreadsheetId": sid, "range": "A1", "valueInputOption": "RAW"})
    return {"spreadsheetId": sid, "updated": (rng or {}).get("updates", {}).get("updatedRows")}

def batch_sync_customers(db_path, sheet_id=None):
    """Sinkronisasi semua customer unik dari orders.db -> Google Contacts + Sheets ledger."""
    con = sqlite3.connect(db_path); cur = con.cursor()
    rows = cur.execute("SELECT customer_name,wa,status,total_rp,invoice_no,created_at FROM orders").fetchall()
    con.close()
    seen = {}
    for name, wa, status, total, inv, created in rows:
        key = (name or "?")
        if key in seen:
            continue
        seen[key] = True
        try:
            contact_upsert(name, wa, note=f"Titiport customer. Invoice {inv} ({status}).")
        except Exception as e:
            print("contact err", name, e)
        try:
            append_ledger([inv or "", name or "", wa or "", total or 0, status or "", (created or "")[:10]], sheet_id)
        except Exception as e:
            print("sheet err", name, e)
    return {"synced": len(seen), "sheet_id": _load_sheet_id()}

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("usage: gws_crm.py [test|sync]")
        sys.exit(1)
    if sys.argv[1] == "test":
        print("contact:", contact_upsert("Test CRM", "62812000111", "testcrm@example.com", "smoke test"))
        print("email:", send_reminder_email("testcrm@example.com", "Test CRM", "INV-999", 100000))
    elif sys.argv[1] == "sync":
        DB = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "orders.db"))
        print(batch_sync_customers(DB))
