CREATE TABLE IF NOT EXISTS cap_sessions(nonce TEXT PRIMARY KEY, key TEXT, issued INTEGER, expires INTEGER, ip_hash TEXT);
CREATE TABLE IF NOT EXISTS captures(id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT DEFAULT (datetime('now')), source TEXT DEFAULT 'app_capture',
 status TEXT, reasons TEXT, store_id INTEGER, store_name TEXT, chain TEXT, product_key TEXT, product_name TEXT, ticket_name TEXT, ticket_code TEXT,
 shelf_price REAL, was_price REAL, unit_price REAL, unit_basis TEXT, special TEXT, pct_label REAL, save_label REAL,
 online_price REAL, online_was REAL, national_median REAL, national_median_regular REAL, match_score REAL,
 ai_json TEXT, img BLOB, img_hash TEXT UNIQUE, cap_ts INTEGER, lat REAL, lng REAL, acc REAL, nonce TEXT, device TEXT, ip_hash TEXT);
CREATE INDEX IF NOT EXISTS cap_status ON captures(status);
