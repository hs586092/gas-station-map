"""
road_links.json -> Supabase REST API 직접 업로드
Vercel을 거치지 않고 service_role key로 직접 삽입

사용법: python scripts/upload-road-links-direct.py
"""

import json
import os
import sys
import ssl
import urllib.request

# macOS Python SSL 인증서 문제 우회
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

# 환경변수 또는 .env.local에서 읽기
def load_env():
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    env = {}
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k] = v
    return env

env = load_env()
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_KEY:
    print("ERROR: SUPABASE_URL or SERVICE_KEY not found")
    sys.exit(1)

DATA_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "road_links.json")

print(f"Loading {DATA_FILE} ...")
with open(DATA_FILE, "r") as f:
    links = json.load(f)
print(f"Total: {len(links):,} links")

BATCH_SIZE = 500
inserted = 0
errors = 0

for i in range(0, len(links), BATCH_SIZE):
    batch = links[i:i + BATCH_SIZE]
    body = json.dumps(batch).encode("utf-8")

    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/road_links",
        data=body,
        method="POST",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as resp:
            inserted += len(batch)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"  ERROR batch {i}: {e.code} {error_body[:200]}")
        errors += 1
    except Exception as e:
        print(f"  ERROR batch {i}: {e}")
        errors += 1

    if (i // BATCH_SIZE + 1) % 20 == 0 or i + BATCH_SIZE >= len(links):
        pct = min(100, (i + BATCH_SIZE) * 100 // len(links))
        print(f"  Progress: {inserted:,} / {len(links):,} ({pct}%) - errors: {errors}")

print(f"\nDone! Inserted: {inserted:,}, Errors: {errors}")
