"""Home screen for Kartoza CloudBench TUI."""

from textual.app import ComposeResult
from textual.containers import Container, Horizontal
from textual.screen import Screen
from textual.widgets import Button, Label, Static


class StatusCard(Static):
    """A card showing status information."""

    DEFAULT_CSS = """
    StatusCard {
        width: 1fr;
        height: auto;
        min-height: 5;
        background: $surface;
        border: solid $primary;
        padding: 1;
        margin: 1;
    }

    StatusCard .card-title {
        text-style: bold;
        color: $primary;
    }

    StatusCard .card-value {
        text-style: bold;
        color: $success;
    }
    """

    def __init__(self, title: str, value: str, icon: str = "", **kwargs):
        """Initialize status card."""
        super().__init__(**kwargs)
        self.card_title = title
        self.card_value = value
        self.card_icon = icon

    def compose(self) -> ComposeResult:
        """Create card content."""
        yield Label(f"{self.card_icon} {self.card_title}", classes="card-title")
        yield Label(self.card_value, classes="card-value")


class HomeScreen(Screen):
    """Home dashboard screen."""

    DEFAULT_CSS = """
    HomeScreen {
        layout: vertical;
    }

    .dashboard-header {
        height: 3;
        padding: 1;
        background: $primary;
        text-align: center;
    }

    .dashboard-grid {
        layout: grid;
        grid-size: 3;
        padding: 1;
    }

    .quick-actions {
        height: auto;
        padding: 1;
        background: $surface;
        margin: 1;
    }

    .quick-actions Button {
        margin: 0 1;
    }

    .footer-text {
        dock: bottom;
        height: 1;
        text-align: center;
        color: $text-muted;
    }
    """

    BINDINGS = [
        ("escape", "app.pop_screen", "Back"),
    ]

    def compose(self) -> ComposeResult:
        """Create the home screen layout."""
        yield Static("Kartoza CloudBench Dashboard", classes="dashboard-header")

        with Container(classes="dashboard-grid"):
            yield StatusCard("GeoServer Connections", "0", icon="\uf0ac")
            yield StatusCard("PostgreSQL Services", "0", icon="\uf1c0")
            yield StatusCard("S3 Connections", "0", icon="\uf0c2")
            yield StatusCard("Active Syncs", "0", icon="\uf021")
            yield StatusCard("Cached Layers", "0", icon="\uf0c7")
            yield StatusCard("System Status", "OK", icon="\uf00c")

        with Horizontal(classes="quick-actions"):
            yield Button("Add Connection", id="btn-add-connection", variant="primary")
            yield Button("Upload Data", id="btn-upload", variant="success")
            yield Button("Sync Servers", id="btn-sync")
            yield Button("Settings", id="btn-settings")

        yield Static(
            "Made with \u2764 by Kartoza | https://kartoza.com",
            classes="footer-text",
        )

    def on_mount(self) -> None:
        """Refresh dashboard when mounted."""
        self._refresh_stats()

    def _refresh_stats(self) -> None:
        """Refresh dashboard statistics."""
        config = self.app.config_manager.config

        # Update connection counts
        cards = list(self.query(StatusCard))
        if len(cards) >= 3:
            cards[0].card_value = str(len(config.connections))
            cards[1].card_value = str(len(config.pg_services))
            cards[2].card_value = str(len(config.s3_connections))

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        button_id = event.button.id

        if button_id == "btn-add-connection":
            self.app.push_screen("connections")
        elif button_id == "btn-upload":
            self.app.notify("Upload feature coming soon", severity="information")
        elif button_id == "btn-sync":
            self.app.notify("Sync feature coming soon", severity="information")
        elif button_id == "btn-settings":
            self.app.push_screen("settings")
