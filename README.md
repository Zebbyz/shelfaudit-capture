# Shelf Audit Capture

iPhone-first PWA. Live camera only (no file picker). Each capture is HMAC-signed in the app with a short-lived server-issued key (nonce, time, location, store, SHA-256 of the JPEG). The server rejects unknown/expired tokens, bad signatures, old photos and duplicates. Workers AI vision reads the ticket, the Function matches it by ticket code then name, compares shelf vs that store's online price vs national median, checks unit price / save / % off, and saves to D1 `shelfaudit.captures` (source `app_capture`). Bad or unsure reads are saved as `needs_check` and stay out of the dataset.

- `python3 build_data.py` builds `public/cd/` lookup data from the national scrape DB (not committed, about 190 MB).
- Deploy: `npx wrangler pages deploy public --project-name shelfaudit-capture --branch main`
- `SA_ADMIN_TOKEN=... python3 pull_captures.py` writes `shelfaudit/data/app_captures.json`.
