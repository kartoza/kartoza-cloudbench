"""Settings screen for Kartoza CloudBench TUI."""

from textual.app import ComposeResult
from textual.containers import Container, Horizontal
from textual.screen import Screen
from textual.widgets import Button, Input, Label, Select, Static

from apps.core.config import config_manager


class SettingsScreen(Screen):
    """Screen for application settings."""

    DEFAULT_CSS = """
    SettingsScreen {
        layout: vertical;
    }

    .screen-header {
        height: 3;
        padding: 1;
        background: $primary;
    }

    .settings-container {
        padding: 2;
    }

    .setting-row {
        height: 3;
        margin: 0 0 1 0;
    }

    .setting-label {
        width: 20;
    }

    .setting-value {
        width: 1fr;
    }

    .section-header {
        text-style: bold;
        margin: 1 0;
        color: $primary;
    }

    .footer-text {
        dock: bottom;
        height: 3;
        text-align: center;
        padding: 1;
        background: $surface;
    }

    .action-bar {
        height: 3;
        padding: 0 1;
        background: $surface;
    }
    """

    BINDINGS = [
        ("escape", "app.pop_screen", "Back"),
        ("s", "save", "Save"),
    ]

    def compose(self) -> ComposeResult:
        """Create the settings screen layout."""
        yield Static("Settings", classes="screen-header")

        with Container(classes="settings-container"):
            yield Static("Appearance", classes="section-header")

            with Horizontal(classes="setting-row"):
                yield Label("Theme:", classes="setting-label")
                yield Select(
                    [("Default", "default"), ("Dark", "dark"), ("Light", "light")],
                    id="theme-select",
                    value="default",
                )

            yield Static("Monitoring", classes="section-header")

            with Horizontal(classes="setting-row"):
                yield Label("Ping Interval (s):", classes="setting-label")
                yield Input(value="60", id="ping-interval", type="integer")

            yield Static("Data", classes="section-header")

            with Horizontal(classes="setting-row"):
                yield Label("Default Path:", classes="setting-label")
                yield Input(id="default-path", placeholder="/home/user/data")

        with Horizontal(classes="action-bar"):
            yield Button("Save", id="btn-save", variant="primary")
            yield Button("Reset to Defaults", id="btn-reset")
            yield Button("Cancel", id="btn-cancel")

        yield Static(
            "Made with \u2764 by Kartoza | https://kartoza.com | Donate: GitHub Sponsors",
            classes="footer-text",
        )

    def on_mount(self) -> None:
        """Load current settings."""
        config = config_manager.config

        # Set current values
        self.query_one("#theme-select", Select).value = config.theme
        self.query_one("#ping-interval", Input).value = str(config.ping_interval_secs)
        self.query_one("#default-path", Input).value = config.last_local_path

    def action_save(self) -> None:
        """Save settings."""
        self._save_settings()

    def _save_settings(self) -> None:
        """Save the current settings."""
        theme = self.query_one("#theme-select", Select).value
        ping_interval = self.query_one("#ping-interval", Input).value
        default_path = self.query_one("#default-path", Input).value

        try:
            config = config_manager.config
            config.theme = str(theme) if theme else "default"
            config.ping_interval_secs = int(ping_interval) if ping_interval else 60
            config.last_local_path = default_path

            config_manager.save()
            self.app.notify("Settings saved", severity="information")

        except Exception as e:
            self.app.notify(f"Error saving settings: {str(e)}", severity="error")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "btn-save":
            self._save_settings()
        elif event.button.id == "btn-cancel":
            self.app.pop_screen()
        elif event.button.id == "btn-reset":
            self.query_one("#theme-select", Select).value = "default"
            self.query_one("#ping-interval", Input).value = "60"
            self.app.notify("Reset to defaults (not saved)", severity="information")
