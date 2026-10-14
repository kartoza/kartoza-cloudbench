"""Browser tests against staging CloudBench, run through its real UI.

Log in once (valid 12 h), then run:

    .venv/bin/python tests/staging/browser_login.py
    .venv/bin/pytest tests/staging -m staging

Everything is discovered from staging itself (the connections already added,
the on-demand server types); .env.staging only holds switches. The tests
drive the UI the way a user does and check the result through the API.

Nothing is ever deleted: every DELETE request is blocked and fails the test
(staging's S3 bucket must never lose anything). What a run creates is named
``<STAGING_TEST_PREFIX><run id>_…``.
"""

import hashlib
import json
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

import pytest

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

REPO = Path(__file__).resolve().parents[2]
AUTH_FILE = REPO / ".staging-auth.json"
WORK_DIR = REPO / ".staging"  # git-ignored: asset cache, screenshots
TEST_DATA = REPO / "manual-test-data"
# GeoHosting's SSO token lives 12 h; leave a margin for a long run.
AUTH_MAX_AGE = 11 * 3600


def pytest_collection_modifyitems(config, items):
    """Mark everything here ``staging``; skip it all when not logged in."""
    here = Path(__file__).parent
    reason = None
    if sync_playwright is None:
        reason = "playwright is not installed"
    elif not AUTH_FILE.exists():
        reason = "not logged in: run tests/staging/browser_login.py"
    elif time.time() - json.loads(AUTH_FILE.read_text()).get("saved_at", 0) > AUTH_MAX_AGE:
        reason = "staging login expired: run tests/staging/browser_login.py again"
    for item in items:
        if here in Path(item.fspath).parents:
            item.add_marker(pytest.mark.staging)
            if reason:
                item.add_marker(pytest.mark.skip(reason=reason))


# ---------------------------------------------------------------------------
# Settings, API
# ---------------------------------------------------------------------------


def _load_env():
    values = {}
    path = REPO / ".env.staging"
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    return values


class Settings:
    def __init__(self):
        env = _load_env()
        self.prefix = env.get("STAGING_TEST_PREFIX") or "cbtest_"
        self.ondemand_enabled = env.get("STAGING_ONDEMAND_ENABLED", "true").lower() == "true"
        self.ondemand_server_id = env.get("STAGING_ONDEMAND_HETZNER_SERVER_ID") or None
        self.ondemand_max_jobs = int(env.get("STAGING_ONDEMAND_MAX_JOBS") or 1)
        self.job_timeout = int(env.get("STAGING_JOB_TIMEOUT_SECONDS") or 1800)
        self.headed = env.get("STAGING_HEADED", "false").lower() == "true"


class Api:
    """CloudBench's API, with the token the browser login saved. GET only."""

    def __init__(self, auth):
        self.base = auth["api_base"]
        self.token = auth["token"]

    def get(self, path, ok=(200,)):
        url = self.base + urllib.parse.quote(path, safe="/?=&")
        request = urllib.request.Request(url, headers={"Authorization": f"Token {self.token}"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                status, body = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, body = error.code, error.read()
        if status not in ok:
            raise AssertionError(f"GET {path} -> {status}: {body[:300]!r}")
        return json.loads(body) if body else None


@pytest.fixture(scope="session")
def settings():
    return Settings()


@pytest.fixture(scope="session")
def auth():
    return json.loads(AUTH_FILE.read_text())


@pytest.fixture(scope="session")
def api(auth):
    return Api(auth)


@pytest.fixture(scope="session")
def run_id(settings):
    """Prefix for everything this run creates, e.g. ``cbtest_1013_2045``."""
    return f"{settings.prefix}{datetime.now():%m%d_%H%M}"


@pytest.fixture(scope="session")
def staging(api):
    """What staging has: the connections (GeoHosting's first) and the servers."""
    by_geohosting = lambda items: sorted(  # noqa: E731
        items, key=lambda c: not str(c.get("id", "")).startswith("geohosting_")
    )
    tools = api.get("/s3/conversion/tools")["tools"]
    return {
        "geoservers": by_geohosting(api.get("/connections")),
        "geonodes": by_geohosting(api.get("/geonode/connections")),
        "pg_services": api.get("/pg/services"),
        "s3": api.get("/s3/connections"),
        "frontend_config": api.get("/frontend-config/"),
        "cloudnativegis": tools.get("cloudnativegis", {}),
    }


@pytest.fixture
def data_file(tmp_path, run_id):
    """Copy a file from manual-test-data/ under a run-specific name."""

    def copy(relative):
        source = TEST_DATA / relative
        if not source.exists():
            pytest.skip(f"{relative} missing: run manual-test-data/generate.py")
        target = tmp_path / f"{run_id}_{source.name}"
        shutil.copy(source, target)
        return target

    return copy


# ---------------------------------------------------------------------------
# Browser
# ---------------------------------------------------------------------------


def _serve_static(route):
    """Serve /assets and /cesium from a local cache, fetching each file once.

    A fresh browser profile has to download ~10 MB of JS, and Chrome gives up
    on long downloads over a slow link (ERR_NETWORK_CHANGED); urllib doesn't.
    """
    cache = WORK_DIR / "asset-cache"
    url = route.request.url.split("?")[0]
    path = cache / hashlib.sha1(url.encode()).hexdigest()
    if not path.exists():
        for _ in range(3):
            try:
                with urllib.request.urlopen(url, timeout=300) as response:
                    body = response.read()
                    content_type = response.headers.get("content-type", "")
                break
            except OSError:
                continue
        else:
            return route.continue_()
        cache.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        path.with_suffix(".type").write_text(content_type)
    route.fulfill(
        body=path.read_bytes(),
        content_type=path.with_suffix(".type").read_text() or "application/octet-stream",
    )


@pytest.fixture(scope="session")
def browser(settings):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not settings.headed, channel="chrome")
        yield browser
        browser.close()


class App:
    """A logged-in CloudBench page plus the helpers the tests share."""

    READY = (
        "document.body && document.body.innerText.includes('Connections') "
        "&& !document.body.innerText.includes('Loading server status')"
    )

    def __init__(self, page, auth, shots_dir):
        self.page = page
        self.auth = auth
        self.shots_dir = shots_dir
        self.blocked = []
        # API requests the browser itself gave up on ("Failed to fetch").
        self.failed_requests = []
        self.retries = []

    def open(self):
        for attempt in range(4):
            try:
                self.page.goto(
                    f"{self.auth['app_url']}?token={self.auth['token']}", wait_until="commit"
                )
                self.page.wait_for_function(self.READY, timeout=60000)
                self.page.wait_for_timeout(1000)
                return
            except Exception:
                if attempt == 3:
                    raise
                self.page.wait_for_timeout(3000)

    def shot(self, name):
        self.shots_dir.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(self.shots_dir / f"{name}.png"))

    @property
    def dialog(self):
        return self.page.locator("section[role=dialog]").last

    def tree_node(self, name, timeout=30000):
        """The tree row's label for ``name`` (a connection, schema, workspace…).

        The tree is the left-hand panel; the same name can also be on a
        dashboard card, so take the match that sits on the left.
        """
        matches = self.page.get_by_text(name, exact=True)
        deadline = time.monotonic() + timeout / 1000
        while time.monotonic() < deadline:
            for match in matches.all():
                box = match.bounding_box()
                if box and box["x"] < 400:
                    return match
            self.page.wait_for_timeout(500)
        raise AssertionError(f"{name!r} is not in the connection tree")

    def row_action(self, name, label):
        """A row's hover button (``Import Data``, ``Open Admin``…) in the tree."""
        node = self.tree_node(name)
        node.hover()
        row = node.locator(f"xpath=ancestor::*[.//button[@aria-label='{label}']][1]")
        return row.get_by_role("button", name=label, exact=True).first

    def tools_upload(self):
        """Tools → Upload Data, for whatever is selected in the tree."""
        self.page.locator("[aria-haspopup=menu]").filter(has_text="Tools").first.click()
        self.page.get_by_role("menuitem", name="Upload Data").click()

    def network_retry(self, flow, attempts=3):
        """Run ``flow``; if it fails because the browser dropped an API request
        (net::ERR_…, shown as "Failed to fetch"), reload and run it again.

        Any other failure, from CloudBench or the server behind it, is
        raised as it is.
        """
        for attempt in range(1, attempts + 1):
            seen = len(self.failed_requests)
            try:
                return flow()
            except Exception as error:
                dropped = self.failed_requests[seen:]
                if not dropped or attempt == attempts:
                    if dropped:
                        raise AssertionError(f"{error}\nrequests dropped: {dropped}") from error
                    raise
                self.retries.append(dropped)
                print(f"attempt {attempt}: browser dropped {dropped}; retrying")
                self.shot(f"dropped_{attempt}")
                self.open()

    def wait_text(self, pattern, timeout=60000, scope=None):
        """Wait until ``pattern`` (regex) shows up; return the text that matched."""
        locator = (scope or self.page).get_by_text(re.compile(pattern)).first
        locator.wait_for(timeout=timeout)
        return locator.inner_text()


@pytest.fixture
def app(browser, auth, run_id, request):
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    test_name = re.sub(r"[^\w.\[\]-]+", "_", request.node.name)
    app = App(page, auth, WORK_DIR / "screenshots" / run_id / test_name)

    def guard(route):
        # Never delete anything on staging (its S3 bucket especially).
        if route.request.method == "DELETE":
            app.blocked.append(route.request.url)
            return route.abort()
        return route.continue_()

    page.route("**/assets/**", _serve_static)
    page.route("**/cesium/**", _serve_static)
    page.route("**/api/**", guard)
    page.on(
        "requestfailed",
        lambda r: (
            app.failed_requests.append(
                f"{r.method} {r.url.split('?')[0].split('/api/')[-1]}: {r.failure}"
            )
            if "/api/" in r.url and "ERR_ABORTED" not in (r.failure or "")
            else None
        ),
    )
    app.open()
    yield app
    app.shot("zz_end")
    context.close()
    if app.retries:
        request.node.user_properties.append(("network_retries", app.retries))
    assert not app.blocked, f"a DELETE was attempted (and blocked): {app.blocked}"
