"""E2E tests for application navigation."""

import pytest

try:
    from playwright.sync_api import Page, expect

    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    Page = None
    expect = None


pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(not PLAYWRIGHT_AVAILABLE, reason="Playwright not installed"),
]


class TestHomePage:
    """E2E tests for the home page."""

    def test_home_page_loads(self, page: Page, base_url: str) -> None:
        """Test that the home page loads successfully."""
        page.goto(base_url)

        # Wait for the page to load
        page.wait_for_load_state("networkidle")

        # Check that the page title is correct
        expect(page).to_have_title("Kartoza CloudBench")

    def test_sidebar_visible(self, page: Page, base_url: str) -> None:
        """Test that the sidebar is visible."""
        page.goto(base_url)
        page.wait_for_load_state("networkidle")

        # Check for sidebar elements
        # This depends on the actual UI structure


class TestConnectionsPage:
    """E2E tests for the connections page."""

    def test_connections_list_loads(self, page: Page, base_url: str) -> None:
        """Test that the connections list loads."""
        page.goto(base_url)
        page.wait_for_load_state("networkidle")

        # Navigate to connections or check if tree is visible

    def test_add_connection_dialog(self, page: Page, base_url: str) -> None:
        """Test the add connection dialog."""
        page.goto(base_url)
        page.wait_for_load_state("networkidle")

        # Click add connection button
        # Fill in the form
        # Submit and verify


class TestProviderNavigation:
    """E2E tests for provider navigation."""

    def test_geoserver_section_visible(self, page: Page, base_url: str) -> None:
        """Test that GeoServer section is visible when enabled."""
        page.goto(base_url)
        page.wait_for_load_state("networkidle")

        # Check for GeoServer node in tree

    def test_postgres_section_visible(self, page: Page, base_url: str) -> None:
        """Test that PostgreSQL section is visible when enabled."""
        page.goto(base_url)
        page.wait_for_load_state("networkidle")

        # Check for PostgreSQL node in tree

    def test_experimental_sections_hidden(self, page: Page, base_url: str) -> None:
        """Test that experimental sections are hidden by default."""
        page.goto(base_url)
        page.wait_for_load_state("networkidle")

        # Check that S3, Iceberg, etc. are not visible


class TestTreeNavigation:
    """E2E tests for tree navigation."""

    def test_tree_expand_collapse(self, page: Page, base_url: str) -> None:
        """Test expanding and collapsing tree nodes."""
        page.goto(base_url)
        page.wait_for_load_state("networkidle")

        # Click on a tree node to expand
        # Verify children are visible
        # Click again to collapse
        # Verify children are hidden

    def test_tree_keyboard_navigation(self, page: Page, base_url: str) -> None:
        """Test keyboard navigation in tree."""
        page.goto(base_url)
        page.wait_for_load_state("networkidle")

        # Use arrow keys to navigate
        # Verify selection changes
