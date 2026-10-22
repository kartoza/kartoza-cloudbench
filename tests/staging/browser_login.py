"""Log in to staging once, by hand, and keep CloudBench's token for the tests.

Opens a visible browser on STAGING_CLOUDBENCH_URL (from .env.staging). Log in
to GeoHosting and open CloudBench. As soon as the CloudBench frame makes an
authenticated API call, its token (GeoHosting's SSO token, valid 12 h) and
API base are saved to .staging-auth.json (git-ignored) and the browser
closes.

    .venv/bin/python tests/staging/browser_login.py
"""

import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
OUTPUT = REPO / ".staging-auth.json"
TIMEOUT_SECONDS = 600


def load_env(path):
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def main():
    env = load_env(REPO / ".env.staging")
    start_url = env.get("STAGING_CLOUDBENCH_URL") or os.environ.get("STAGING_CLOUDBENCH_URL")
    if not start_url:
        sys.exit("STAGING_CLOUDBENCH_URL is not set in .env.staging")

    found = {}
    # API bases that answered /api/frontend-config/ like CloudBench does.
    # GeoHosting's own frontend also sends "Token …", so a token only counts
    # when it goes to one of these.
    cloudbench_bases = set()
    candidates = []

    def api_base_of(url):
        parts = urlsplit(url)
        return f"{parts.scheme}://{parts.netloc}{parts.path.split('/api/')[0]}/api"

    def on_response(response):
        request = response.request
        if "/api/" not in request.url or response.status != 200:
            return
        if request.url.split("?")[0].endswith("/api/frontend-config/"):
            try:
                if "createGeoServerUrl" in response.json():
                    cloudbench_bases.add(api_base_of(request.url))
            except Exception:
                pass
            return
        auth = request.headers.get("authorization", "")
        if auth.startswith("Token "):
            frame = request.frame
            app_url = frame.url.split("?")[0] if frame else None
            candidates.append((api_base_of(request.url), auth.removeprefix("Token "), app_url))

    state_path = REPO / ".staging-browser-state.json"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel="chrome")
        context = browser.new_context(
            viewport={"width": 1400, "height": 900},
            # Reuse an earlier GeoHosting login, if there is one.
            storage_state=str(state_path) if state_path.exists() else None,
        )
        context.on("response", on_response)
        page = context.new_page()
        # The dashboard keeps requests open, so "load" may never come.
        page.goto(start_url, wait_until="commit")
        print("Log in to GeoHosting (if asked) and open CloudBench…", flush=True)

        deadline = time.monotonic() + TIMEOUT_SECONDS
        while not found and time.monotonic() < deadline:
            if not browser.is_connected() or not context.pages:
                break
            for base, token, app_url in candidates:
                if base in cloudbench_bases:
                    found.update(token=token, api_base=base, app_url=app_url)
                    break
            context.pages[0].wait_for_timeout(1000)
        if browser.is_connected():
            # Cookies/localStorage, so the GeoHosting login can be reused.
            context.storage_state(path=str(state_path))
            browser.close()

    if not found:
        sys.exit("No authenticated CloudBench request seen; nothing saved.")
    found["saved_at"] = int(time.time())
    OUTPUT.write_text(json.dumps(found, indent=2))
    OUTPUT.chmod(0o600)
    print(f"Saved CloudBench token for {found['api_base']} to {OUTPUT.name}")


if __name__ == "__main__":
    main()
