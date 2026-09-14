"""Playwright E2E test configuration and fixtures."""

import os
import subprocess
import time
from collections.abc import Generator

import pytest

try:
    from playwright.sync_api import Browser, BrowserContext, Page, expect

    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    Page = None
    expect = None
    Browser = None
    BrowserContext = None


# Playwright pytest-playwright configuration
@pytest.fixture(scope="session")
def browser_context_args(browser_context_args: dict) -> dict:
    """Configure browser context for all tests."""
    return {
        **browser_context_args,
        "viewport": {"width": 1280, "height": 720},
        "ignore_https_errors": True,
    }


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args: dict) -> dict:
    """Configure browser launch arguments."""
    return {
        **browser_type_launch_args,
        "headless": True,
        "slow_mo": 0,  # Increase for debugging
    }


@pytest.fixture(scope="session")
def app_server() -> Generator[str, None, None]:
    """Start the application server for E2E tests.

    Starts the Django development server and waits for it to be ready.
    """
    if not PLAYWRIGHT_AVAILABLE:
        pytest.skip("Playwright not installed")

    # Start the server
    env = os.environ.copy()
    env["DJANGO_SETTINGS_MODULE"] = "cloudbench.settings.testing"

    server_process = subprocess.Popen(
        [
            "python",
            "-m",
            "uvicorn",
            "cloudbench.asgi:application",
            "--host",
            "127.0.0.1",
            "--port",
            "8888",
        ],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # Wait for server to start
    base_url = "http://127.0.0.1:8888"
    max_retries = 30
    for _ in range(max_retries):
        try:
            import httpx

            response = httpx.get(f"{base_url}/health/", timeout=1)
            if response.status_code == 200:
                break
        except Exception:
            pass
        time.sleep(0.5)
    else:
        server_process.kill()
        pytest.fail("Server failed to start")

    yield base_url

    # Clean up
    server_process.terminate()
    server_process.wait(timeout=5)


@pytest.fixture
def base_url(app_server: str) -> str:
    """Return the base URL for the application."""
    return app_server


@pytest.fixture
def authenticated_page(page: Page, base_url: str) -> Page:
    """Return a page with any required authentication."""
    # For now, no authentication is required
    return page
