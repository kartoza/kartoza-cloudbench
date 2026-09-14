"""PostgreSQL browser screen for Kartoza CloudBench TUI."""

from textual.app import ComposeResult
from textual.containers import Horizontal
from textual.screen import Screen
from textual.widgets import Button, DataTable, Static

from apps.core.config import config_manager


class PostgresScreen(Screen):
    """Screen for browsing PostgreSQL/PostGIS services."""

    DEFAULT_CSS = """
    PostgresScreen {
        layout: vertical;
    }

    .screen-header {
        height: 3;
        padding: 1;
        background: $primary;
    }

    .services-table {
        height: 1fr;
        margin: 1;
    }

    .action-bar {
        height: 3;
        padding: 0 1;
        background: $surface;
    }
    """

    BINDINGS = [
        ("escape", "app.pop_screen", "Back"),
        ("a", "add_service", "Add"),
        ("r", "refresh", "Refresh"),
    ]

    def compose(self) -> ComposeResult:
        """Create the PostgreSQL screen layout."""
        yield Static("PostgreSQL Services (from pg_service.conf)", classes="screen-header")

        table = DataTable(id="services-table", classes="services-table")
        table.add_columns("Service Name", "Host", "Database", "Status")
        yield table

        with Horizontal(classes="action-bar"):
            yield Button("Add Service", id="btn-add", variant="primary")
            yield Button("Browse Schema", id="btn-browse")
            yield Button("Import Data", id="btn-import")
            yield Button("Refresh", id="btn-refresh")

    def on_mount(self) -> None:
        """Load services when screen mounts."""
        self._refresh_table()

    def _refresh_table(self) -> None:
        """Refresh the services table."""
        table = self.query_one("#services-table", DataTable)
        table.clear()

        # Load from config
        config = config_manager.config
        for service in config.pg_services:
            status = "Parsed" if service.is_parsed else "Not Parsed"
            # Note: Actual connection params come from pg_service.conf
            table.add_row(service.name, "-", "-", status, key=service.name)

    def action_refresh(self) -> None:
        """Refresh the table."""
        self._refresh_table()
        self.app.notify("Refreshed", severity="information")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "btn-refresh":
            self.action_refresh()
        elif event.button.id == "btn-add":
            self.app.notify("Add service feature coming soon", severity="information")
        elif event.button.id == "btn-browse":
            self.app.notify("Schema browser coming soon", severity="information")
        elif event.button.id == "btn-import":
            self.app.notify("Data import feature coming soon", severity="information")
