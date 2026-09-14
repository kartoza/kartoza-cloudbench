"""Connections management screen for Kartoza CloudBench TUI."""

import httpx
from textual.app import ComposeResult
from textual.containers import Container, Horizontal
from textual.screen import Screen
from textual.widgets import Button, DataTable, Input, Label, Static

from apps.core.config import Connection, config_manager


class ConnectionForm(Container):
    """Form for adding/editing a connection."""

    DEFAULT_CSS = """
    ConnectionForm {
        layout: vertical;
        padding: 1;
        background: $surface;
        border: solid $primary;
        height: auto;
    }

    ConnectionForm Input {
        margin: 0 0 1 0;
    }

    ConnectionForm .form-row {
        height: auto;
        margin: 0 0 1 0;
    }

    ConnectionForm .form-label {
        width: 15;
    }

    ConnectionForm .buttons {
        height: 3;
        margin-top: 1;
    }
    """

    def compose(self) -> ComposeResult:
        """Create form content."""
        with Horizontal(classes="form-row"):
            yield Label("Name:", classes="form-label")
            yield Input(placeholder="My GeoServer", id="input-name")

        with Horizontal(classes="form-row"):
            yield Label("URL:", classes="form-label")
            yield Input(
                placeholder="http://localhost:8080/geoserver", id="input-url"
            )

        with Horizontal(classes="form-row"):
            yield Label("Username:", classes="form-label")
            yield Input(placeholder="admin", id="input-username")

        with Horizontal(classes="form-row"):
            yield Label("Password:", classes="form-label")
            yield Input(placeholder="geoserver", password=True, id="input-password")

        with Horizontal(classes="buttons"):
            yield Button("Test", id="btn-test", variant="default")
            yield Button("Save", id="btn-save", variant="primary")
            yield Button("Cancel", id="btn-cancel")


class ConnectionsScreen(Screen):
    """Screen for managing GeoServer connections."""

    DEFAULT_CSS = """
    ConnectionsScreen {
        layout: vertical;
    }

    .screen-header {
        height: 3;
        padding: 1;
        background: $primary;
    }

    .connections-table {
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
        ("a", "add_connection", "Add"),
        ("d", "delete_connection", "Delete"),
        ("t", "test_connection", "Test"),
    ]

    def compose(self) -> ComposeResult:
        """Create the connections screen layout."""
        yield Static("GeoServer Connections", classes="screen-header")

        table = DataTable(id="connections-table", classes="connections-table")
        table.add_columns("Name", "URL", "Username", "Status")
        yield table

        with Horizontal(classes="action-bar"):
            yield Button("Add", id="btn-add", variant="primary")
            yield Button("Edit", id="btn-edit")
            yield Button("Delete", id="btn-delete", variant="error")
            yield Button("Test", id="btn-test-selected")

        yield ConnectionForm(id="connection-form", classes="hidden")

    def on_mount(self) -> None:
        """Load connections when screen mounts."""
        self._refresh_table()

    def _refresh_table(self) -> None:
        """Refresh the connections table."""
        table = self.query_one("#connections-table", DataTable)
        table.clear()

        config = config_manager.config
        for conn in config.connections:
            status = "\u2713 Active" if conn.is_active else "Inactive"
            table.add_row(conn.name, conn.url, conn.username, status, key=conn.id)

    def action_add_connection(self) -> None:
        """Show the add connection form."""
        form = self.query_one("#connection-form")
        form.remove_class("hidden")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        button_id = event.button.id

        if button_id == "btn-add":
            self.action_add_connection()

        elif button_id == "btn-cancel":
            form = self.query_one("#connection-form")
            form.add_class("hidden")
            self._clear_form()

        elif button_id == "btn-test":
            self._test_connection()

        elif button_id == "btn-save":
            self._save_connection()

        elif button_id == "btn-delete":
            self._delete_selected()

        elif button_id == "btn-test-selected":
            self._test_selected()

    def _clear_form(self) -> None:
        """Clear the form inputs."""
        self.query_one("#input-name", Input).value = ""
        self.query_one("#input-url", Input).value = ""
        self.query_one("#input-username", Input).value = ""
        self.query_one("#input-password", Input).value = ""

    def _test_connection(self) -> None:
        """Test the connection from form values."""
        url = self.query_one("#input-url", Input).value
        username = self.query_one("#input-username", Input).value
        password = self.query_one("#input-password", Input).value

        if not all([url, username, password]):
            self.app.notify("Please fill in all fields", severity="error")
            return

        try:
            # Test connection
            base_url = url.rstrip("/")
            if not base_url.endswith("/geoserver") and "/geoserver" not in base_url:
                base_url += "/geoserver"

            with httpx.Client(timeout=10.0) as client:
                response = client.get(
                    f"{base_url}/rest/about/version.json",
                    auth=httpx.BasicAuth(username, password),
                )

                if response.status_code == 200:
                    self.app.notify("Connection successful!", severity="information")
                elif response.status_code == 401:
                    self.app.notify("Authentication failed", severity="error")
                else:
                    self.app.notify(
                        f"Connection failed: {response.status_code}", severity="error"
                    )

        except httpx.ConnectError:
            self.app.notify("Could not connect to server", severity="error")
        except Exception as e:
            self.app.notify(f"Error: {str(e)}", severity="error")

    def _save_connection(self) -> None:
        """Save the connection from form values."""
        name = self.query_one("#input-name", Input).value
        url = self.query_one("#input-url", Input).value
        username = self.query_one("#input-username", Input).value
        password = self.query_one("#input-password", Input).value

        if not all([name, url, username, password]):
            self.app.notify("Please fill in all fields", severity="error")
            return

        conn = Connection(name=name, url=url, username=username, password=password)
        config_manager.add_connection(conn)

        self.app.notify(f"Connection '{name}' saved", severity="information")
        self._clear_form()
        self.query_one("#connection-form").add_class("hidden")
        self._refresh_table()

    def _delete_selected(self) -> None:
        """Delete the selected connection."""
        table = self.query_one("#connections-table", DataTable)
        if table.cursor_row is None:
            self.app.notify("No connection selected", severity="warning")
            return

        row_key = table.get_row_at(table.cursor_row)
        if row_key:
            # Get connection ID from row key
            conn_id = str(list(table._data.keys())[table.cursor_row])
            config_manager.remove_connection(conn_id)
            self.app.notify("Connection deleted", severity="information")
            self._refresh_table()

    def _test_selected(self) -> None:
        """Test the selected connection."""
        table = self.query_one("#connections-table", DataTable)
        if table.cursor_row is None:
            self.app.notify("No connection selected", severity="warning")
            return

        # Get connection
        conn_id = str(list(table._data.keys())[table.cursor_row])
        conn = config_manager.get_connection(conn_id)
        if not conn:
            return

        try:
            base_url = conn.url.rstrip("/")
            with httpx.Client(timeout=10.0) as client:
                response = client.get(
                    f"{base_url}/rest/about/version.json",
                    auth=httpx.BasicAuth(conn.username, conn.password),
                )

                if response.status_code == 200:
                    self.app.notify(
                        f"Connection '{conn.name}' is working!", severity="information"
                    )
                else:
                    self.app.notify(
                        f"Connection failed: {response.status_code}", severity="error"
                    )

        except Exception as e:
            self.app.notify(f"Error: {str(e)}", severity="error")
