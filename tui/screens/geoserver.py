"""GeoServer browser screen for Kartoza CloudBench TUI."""

from textual.app import ComposeResult
from textual.containers import Container, Horizontal
from textual.screen import Screen
from textual.widgets import Button, Label, Select, Static, Tree

from apps.core.config import config_manager
from apps.geoserver.client import GeoServerClient


class ResourceTree(Tree):
    """Tree widget for browsing GeoServer resources."""

    DEFAULT_CSS = """
    ResourceTree {
        background: $surface;
        padding: 1;
    }
    """

    def __init__(self, **kwargs):
        """Initialize resource tree."""
        super().__init__("GeoServer Resources", **kwargs)


class GeoServerScreen(Screen):
    """Screen for browsing GeoServer resources."""

    DEFAULT_CSS = """
    GeoServerScreen {
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

    .resource-tree {
        width: 40%;
        border-right: solid $primary;
    }

    .detail-panel {
        width: 60%;
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

    def __init__(self, **kwargs):
        """Initialize screen."""
        super().__init__(**kwargs)
        self.current_connection_id: str | None = None
        self.client: GeoServerClient | None = None

    def compose(self) -> ComposeResult:
        """Create the GeoServer screen layout."""
        yield Static("GeoServer Browser", classes="screen-header")

        with Horizontal(classes="connection-selector"):
            yield Label("Connection: ")
            yield Select(
                [],
                id="connection-select",
                prompt="Select a connection...",
            )
            yield Button("Refresh", id="btn-refresh", variant="default")

        with Container(classes="browser-container"):
            yield ResourceTree(id="resource-tree", classes="resource-tree")
            yield Container(
                Static("Select a resource to view details", id="detail-content"),
                classes="detail-panel",
            )

        with Horizontal(classes="action-bar"):
            yield Button("Create Workspace", id="btn-create-ws")
            yield Button("Upload Data", id="btn-upload")
            yield Button("Delete", id="btn-delete", variant="error")

    def on_mount(self) -> None:
        """Load connections when screen mounts."""
        self._refresh_connections()

    def _refresh_connections(self) -> None:
        """Refresh the connection selector."""
        select = self.query_one("#connection-select", Select)
        config = config_manager.config

        options = [(conn.name, conn.id) for conn in config.connections]
        select.set_options(options)

        # Auto-select if only one connection
        if len(config.connections) == 1:
            select.value = config.connections[0].id
            self._load_connection(config.connections[0].id)

    def on_select_changed(self, event: Select.Changed) -> None:
        """Handle connection selection."""
        if event.select.id == "connection-select" and event.value:
            self._load_connection(str(event.value))

    def _load_connection(self, conn_id: str) -> None:
        """Load resources for a connection."""
        conn = config_manager.get_connection(conn_id)
        if not conn:
            return

        self.current_connection_id = conn_id
        self.client = GeoServerClient(conn)

        self._refresh_tree()

    def _refresh_tree(self) -> None:
        """Refresh the resource tree."""
        if not self.client:
            return

        tree = self.query_one("#resource-tree", ResourceTree)
        tree.clear()
        tree.root.expand()

        try:
            # Load workspaces
            workspaces = self.client.list_workspaces()

            for ws in workspaces:
                ws_name = ws.get("name", "Unknown")
                ws_node = tree.root.add(
                    f"\uf07b {ws_name}",
                    data={"type": "workspace", "name": ws_name},
                )

                # Add placeholder children (lazy loading)
                ws_node.add_leaf(
                    "\uf1c0 Data Stores",
                    data={"type": "datastores", "workspace": ws_name},
                )
                ws_node.add_leaf(
                    "\uf03e Coverage Stores",
                    data={"type": "coveragestores", "workspace": ws_name},
                )
                ws_node.add_leaf(
                    "\uf279 Layers",
                    data={"type": "layers", "workspace": ws_name},
                )
                ws_node.add_leaf(
                    "\uf1fc Styles",
                    data={"type": "styles", "workspace": ws_name},
                )
                ws_node.add_leaf(
                    "\uf5fd Layer Groups",
                    data={"type": "layergroups", "workspace": ws_name},
                )

        except Exception as e:
            self.app.notify(f"Error loading workspaces: {str(e)}", severity="error")

    def on_tree_node_selected(self, event: Tree.NodeSelected) -> None:
        """Handle tree node selection."""
        node_data = event.node.data
        if not node_data:
            return

        node_type = node_data.get("type")
        detail = self.query_one("#detail-content", Static)

        if node_type == "workspace":
            ws_name = node_data.get("name")
            detail.update(f"Workspace: {ws_name}\n\nDouble-click to expand")

        elif node_type == "layers":
            ws_name = node_data.get("workspace")
            self._show_layers(ws_name)

        elif node_type == "styles":
            ws_name = node_data.get("workspace")
            self._show_styles(ws_name)

    def _show_layers(self, workspace: str) -> None:
        """Show layers for a workspace."""
        if not self.client:
            return

        detail = self.query_one("#detail-content", Static)

        try:
            layers = self.client.list_layers(workspace)
            if not layers:
                detail.update(f"Workspace '{workspace}' has no layers")
                return

            text = f"Layers in {workspace}:\n\n"
            for layer in layers:
                name = layer.get("name", "Unknown")
                text += f"  \u2022 {name}\n"

            detail.update(text)

        except Exception as e:
            detail.update(f"Error loading layers: {str(e)}")

    def _show_styles(self, workspace: str) -> None:
        """Show styles for a workspace."""
        if not self.client:
            return

        detail = self.query_one("#detail-content", Static)

        try:
            styles = self.client.list_styles(workspace)
            if not styles:
                detail.update(f"Workspace '{workspace}' has no styles")
                return

            text = f"Styles in {workspace}:\n\n"
            for style in styles:
                name = style.get("name", "Unknown")
                text += f"  \u2022 {name}\n"

            detail.update(text)

        except Exception as e:
            detail.update(f"Error loading styles: {str(e)}")

    def action_refresh(self) -> None:
        """Refresh the tree."""
        self._refresh_tree()
        self.app.notify("Refreshed", severity="information")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "btn-refresh":
            self.action_refresh()
        elif event.button.id == "btn-upload":
            self.app.notify("Upload feature coming soon", severity="information")
        elif event.button.id == "btn-create-ws":
            self.app.notify("Create workspace feature coming soon", severity="information")
