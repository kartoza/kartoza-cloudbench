"""Build .staging-auth.json from a token copied out of your own browser.

Faster than the Playwright login when you already have CloudBench open:

1. In the browser tab with CloudBench open, open DevTools (F12).
2. Application tab -> Storage -> Local Storage -> the
   `cloudbench.geohosting.sta.do.kartoza.com` origin.
3. Copy the value of the `token` key.
4. Save it, on its own, into a file named `.staging-token` at the repo root
   (git-ignored). No quotes, no "Token " prefix.
5. Run:  .venv/bin/python tests/staging/token_from_file.py

The token is checked against the API before anything is saved.
"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TOKEN_FILE = REPO / ".staging-token"
AUTH_FILE = REPO / ".staging-auth.json"
API_BASE = "https://cloudbench.geohosting.sta.do.kartoza.com/api"
APP_URL = "https://cloudbench.geohosting.sta.do.kartoza.com/"


def main():
    if not TOKEN_FILE.exists():
        sys.exit(f"Put the CloudBench token in {TOKEN_FILE.name} first (see this file's header).")
    token = TOKEN_FILE.read_text().strip().removeprefix("Token ").strip()
    if not token:
        sys.exit(f"{TOKEN_FILE.name} is empty.")

    request = urllib.request.Request(
        API_BASE + "/connections", headers={"Authorization": f"Token {token}"}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
    except OSError as error:
        sys.exit(f"Could not reach staging: {error}")
    if status != 200:
        sys.exit(f"That token was rejected (HTTP {status}). Copy a fresh one and try again.")

    AUTH_FILE.write_text(
        json.dumps(
            {
                "token": token,
                "api_base": API_BASE,
                "app_url": APP_URL,
                "saved_at": int(time.time()),
            },
            indent=2,
        )
    )
    AUTH_FILE.chmod(0o600)
    print(f"Token accepted and saved to {AUTH_FILE.name}. You can delete {TOKEN_FILE.name} now.")


if __name__ == "__main__":
    main()
