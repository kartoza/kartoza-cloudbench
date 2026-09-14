"""Main Textual application for Kartoza CloudBench TUI."""

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container
from textual.widgets import Footer, Header, Static, Tree

from apps.core.config import ConfigManager

from .screens.connections import ConnectionsScreen
from .screens.geoserver import GeoServerScreen
from .screens.home import HomeScreen
from .screens.postgres import PostgresScreen
from .screens.s3 import S3Screen
from .screens.settings import SettingsScreen


class Sidebar(Container):
    """Navigation sidebar with resource tree."""

    DEFAULT_CSS = """
    Sidebar {
        width: 30;
        dock: left;
        background: $surface;
        border-right: solid $primary;
    }

    Sidebar Tree {
        padding: 1;
    }
    """

    def compose(self) -> ComposeResult:
        """Create sidebar content."""
        tree: Tree[dict] = Tree("CloudBench", id="nav-tree")
        tree.root.expand()

        # Add navigation nodes
        connections = tree.root.add("GeoServer Connections", data={"type": "geoserver"})
        connections.add_leaf("Add Connection...", data={"type": "add_connection"})

        postgres = tree.root.add("PostgreSQL Services", data={"type": "postgres"})
        postgres.add_leaf("Add Service...", data={"type": "add_pg_service"})

        s3 = tree.root.add("S3 Storage", data={"type": "s3"})
        s3.add_leaf("Add Connection...", data={"type": "add_s3"})

        # External services
        external = tree.root.add("External Services", data={"type": "external"})
        external.add_leaf("QFieldCloud", data={"type": "qfieldcloud"})
        external.add_leaf("Mergin Maps", data={"type": "mergin"})
        external.add_leaf("GeoNode", data={"type": "geonode"})
        external.add_leaf("Iceberg", data={"type": "iceberg"})

        yield tree


class MainContent(Container):
    """Main content area that displays different screens."""

    DEFAULT_CSS = """
    MainContent {
        width: 1fr;
        background: $background;
        padding: 1;
    }
    """

    def compose(self) -> ComposeResult:
        """Create main content."""
        yield Static("Welcome to Kartoza CloudBench", id="welcome")


class StatusBar(Static):
    """Status bar showing connection status and other info."""

    DEFAULT_CSS = """
    StatusBar {
        dock: bottom;
        height: 1;
        background: $surface;
        color: $text-muted;
        padding: 0 1;
    }
    """

    def compose(self) -> ComposeResult:
        """Create status bar content."""
        yield Static("Ready | Made with \u2764 by Kartoza", id="status-text")


class CloudBenchApp(App):
    """Kartoza CloudBench Terminal User Interface.

    A beautiful TUI for managing GeoServer, PostgreSQL/PostGIS, and
    cloud-native geospatial infrastructure.
    """

    TITLE = "Kartoza CloudBench"
    SUB_TITLE = "Geospatial Infrastructure Management"

    CSS = """
    Screen {
        layout: horizontal;
    }

    #main-container {
        width: 100%;
        height: 100%;
    }

    Header {
        background: $primary;
    }

    Footer {
        background: $surface;
    }

    .hidden {
        display: none;
    }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit", show=True),
        Binding("h", "push_screen('home')", "Home", show=True),
        Binding("c", "push_screen('connections')", "Connections", show=True),
        Binding("g", "push_screen('geoserver')", "GeoServer", show=True),
        Binding("p", "push_screen('postgres')", "PostgreSQL", show=True),
        Binding("s", "push_screen('s3')", "S3 Storage", show=True),
        Binding("?", "push_screen('settings')", "Settings", show=True),
        Binding("r", "refresh", "Refresh", show=True),
        Binding("f1", "toggle_sidebar", "Toggle Sidebar", show=False),
    ]

    SCREENS = {
        "home": HomeScreen,
        "connections": ConnectionsScreen,
        "geoserver": GeoServerScreen,
        "postgres": PostgresScreen,
        "s3": S3Screen,
        "settings": SettingsScreen,
    }

    def __init__(self, config_path: str | None = None, debug: bool = False):
        """Initialize the CloudBench TUI.

        Args:
            config_path: Optional path to config file
            debug: Enable debug mode
        """
        super().__init__()
        self.config_path = config_path
        self.debug_mode = debug
        self._config_manager = ConfigManager()

    @property
    def config_manager(self) -> ConfigManager:
        """Get the configuration manager."""
        return self._config_manager

    def compose(self) -> ComposeResult:
        """Create the application layout."""
        yield Header()
        yield Container(
            Sidebar(id="sidebar"),
            MainContent(id="main-content"),
            id="main-container",
        )
        yield Footer()

    def on_mount(self) -> None:
        """Initialize the application when mounted."""
        # Load connections into the sidebar tree
        self._refresh_sidebar()

    def _refresh_sidebar(self) -> None:
        """Refresh the sidebar tree with current connections."""
        tree = self.query_one("#nav-tree", Tree)

        # Clear existing connection nodes and re-add
        config = self._config_manager.config

        # Find the GeoServer connections node
        for node in tree.root.children:
            if node.data and node.data.get("type") == "geoserver":
                # Remove existing connection children
                node.remove_children()

                # Add connections
                for conn in config.connections:
                    icon = "\u2713 " if conn.is_active else "  "
                    node.add_leaf(
                        f"{icon}{conn.name}",
                        data={"type": "connection", "id": conn.id},
                    )

                node.add_leaf("Add Connection...", data={"type": "add_connection"})
                break

    def on_tree_node_selected(self, event: Tree.NodeSelected) -> None:
        """Handle tree node selection."""
        node_data = event.node.data
        if not node_data:
            return

        node_type = node_data.get("type")

        if node_type == "connection":
            # Show GeoServer connection details
            self.push_screen("geoserver")

        elif node_type == "add_connection":
            # Show add connection dialog
            self.push_screen("connections")

        elif node_type == "postgres":
            self.push_screen("postgres")

        elif node_type == "s3":
            self.push_screen("s3")

    def action_toggle_sidebar(self) -> None:
        """Toggle the sidebar visibility."""
        sidebar = self.query_one("#sidebar")
        sidebar.toggle_class("hidden")

    def action_refresh(self) -> None:
        """Refresh the current view."""
        self._refresh_sidebar()
        self.notify("Refreshed", severity="information")


def run_app(config_path: str | None = None, debug: bool = False) -> None:
    """Run the CloudBench TUI application.

    Args:
        config_path: Optional path to config file
        debug: Enable debug mode
    """
    app = CloudBenchApp(config_path=config_path, debug=debug)
    app.run()


if __name__ == "__main__":
    run_app()
