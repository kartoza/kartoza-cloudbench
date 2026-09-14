"""S3 storage browser screen for Kartoza CloudBench TUI."""

from textual.app import ComposeResult
from textual.containers import Container, Horizontal
from textual.screen import Screen
from textual.widgets import Button, DataTable, Label, Select, Static, Tree

from apps.core.config import config_manager


class S3Screen(Screen):
    """Screen for browsing S3-compatible storage."""

    DEFAULT_CSS = """
    S3Screen {
        layout: vertical;
    }

    .screen-header {
        height: 3;
        padding: 1;
        background: $primary;
    }

    .connection-selector {
        height: 3;
        padding: 0 1;
        background: $surface;
    }

    .browser-container {
        layout: horizontal;
        height: 1fr;
    }

    .bucket-tree {
        width: 30%;
        border-right: solid $primary;
        padding: 1;
    }

    .objects-panel {
        width: 70%;
        padding: 1;
    }

    .action-bar {
        height: 3;
        padding: 0 1;
        background: $surface;
    }
    """

    BINDINGS = [
        ("escape", "app.pop_screen", "Back"),
        ("r", "refresh", "Refresh"),
    ]

    def compose(self) -> ComposeResult:
        """Create the S3 screen layout."""
        yield Static("S3 Storage Browser", classes="screen-header")

        with Horizontal(classes="connection-selector"):
            yield Label("Connection: ")
            yield Select([], id="s3-connection-select", prompt="Select S3 connection...")
            yield Button("Refresh", id="btn-refresh", variant="default")

        with Container(classes="browser-container"):
            yield Tree("Buckets", id="bucket-tree", classes="bucket-tree")
            yield Container(
                DataTable(id="objects-table"),
                classes="objects-panel",
            )

        with Horizontal(classes="action-bar"):
            yield Button("Create Bucket", id="btn-create-bucket")
            yield Button("Upload", id="btn-upload", variant="primary")
            yield Button("Download", id="btn-download")
            yield Button("Delete", id="btn-delete", variant="error")

    def on_mount(self) -> None:
        """Load S3 connections when screen mounts."""
        self._refresh_connections()

        # Setup objects table
        table = self.query_one("#objects-table", DataTable)
        table.add_columns("Name", "Size", "Last Modified", "Type")

    def _refresh_connections(self) -> None:
        """Refresh the S3 connection selector."""
        select = self.query_one("#s3-connection-select", Select)
        config = config_manager.config

        options = [(conn.name, conn.id) for conn in config.s3_connections]
        select.set_options(options)

    def on_select_changed(self, event: Select.Changed) -> None:
        """Handle connection selection."""
        if event.select.id == "s3-connection-select" and event.value:
            self._load_buckets(str(event.value))

    def _load_buckets(self, _conn_id: str) -> None:
        """Load buckets for a connection."""
        tree = self.query_one("#bucket-tree", Tree)
        tree.clear()
        tree.root.expand()

        # Note: Actual bucket loading would use boto3
        tree.root.add_leaf(
            "\uf0c2 (Connect to load buckets)",
            data={"type": "placeholder"},
        )

        self.app.notify("S3 browsing feature coming soon", severity="information")

    def action_refresh(self) -> None:
        """Refresh the current view."""
        self._refresh_connections()
        self.app.notify("Refreshed", severity="information")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "btn-refresh":
            self.action_refresh()
        else:
            self.app.notify("Feature coming soon", severity="information")
