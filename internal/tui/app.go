package tui

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
	"github.com/kartoza/kartoza-geoserver-client/internal/preview"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/components"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/screens"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/styles"
)

// Screen represents the current screen
type Screen int

const (
	ScreenDashboard Screen = iota
	ScreenMain
	ScreenConnections
	ScreenUpload
	ScreenHelp
	ScreenSync
)

// CRUDOperation represents the type of CRUD operation
type CRUDOperation int

const (
	CRUDNone CRUDOperation = iota
	CRUDCreate
	CRUDEdit
	CRUDDelete
)

// Panel represents which panel is active
type Panel int

const (
	PanelLeft Panel = iota
	PanelRight
)

// AppKeyMap defines the global key bindings
type AppKeyMap struct {
	Quit        key.Binding
	Tab         key.Binding
	Help        key.Binding
	Connections key.Binding
	Upload      key.Binding
	Refresh     key.Binding
	Escape      key.Binding
	Sync        key.Binding
	Search      key.Binding
}

// DefaultAppKeyMap returns the default key bindings
func DefaultAppKeyMap() AppKeyMap {
	return AppKeyMap{
		Quit: key.NewBinding(
			key.WithKeys("q", "ctrl+c"),
			key.WithHelp("q", "quit"),
		),
		Tab: key.NewBinding(
			key.WithKeys("tab"),
			key.WithHelp("tab", "switch panel"),
		),
		Help: key.NewBinding(
			key.WithKeys("?", "f1"),
			key.WithHelp("?", "help"),
		),
		Connections: key.NewBinding(
			key.WithKeys("c"),
			key.WithHelp("c", "connections"),
		),
		Upload: key.NewBinding(
			key.WithKeys("u"),
			key.WithHelp("u", "upload"),
		),
		Refresh: key.NewBinding(
			key.WithKeys("r", "ctrl+r"),
			key.WithHelp("r", "refresh"),
		),
		Escape: key.NewBinding(
			key.WithKeys("esc"),
			key.WithHelp("esc", "back"),
		),
		Sync: key.NewBinding(
			key.WithKeys("S"),
			key.WithHelp("S", "sync servers"),
		),
		Search: key.NewBinding(
			key.WithKeys("ctrl+k", "/"),
			key.WithHelp("Ctrl+K", "search"),
		),
	}
}

// Messages
type (
	workspacesLoadedMsg     struct{ workspaces []models.Workspace }
	dataStoresLoadedMsg     struct{ node *models.TreeNode; stores []models.DataStore }
	coverageStoresLoadedMsg struct{ node *models.TreeNode; stores []models.CoverageStore }
	stylesLoadedMsg         struct{ node *models.TreeNode; styles []models.Style }
	layerGroupsLoadedMsg    struct{ node *models.TreeNode; groups []models.LayerGroup }
	layersLoadedMsg         struct{ node *models.TreeNode; layers []models.Layer }
	connectionTestMsg       struct{ success bool; err error; version string }
	uploadCompleteMsg       struct{ success bool; err error }
	errMsg                  struct{ err error }
	// CRUD operation messages
	crudCompleteMsg struct{ success bool; err error; operation string }
	// Settings loaded message
	settingsLoadedMsg struct {
		contact      *models.GeoServerContact
		connectionID string
		connName     string
		err          error
	}
	// Settings saved message
	settingsSavedMsg struct {
		success bool
		err     error
	}
	// Connection workspaces loaded message (for multi-connection tree)
	connectionWorkspacesLoadedMsg struct {
		node       *models.TreeNode
		workspaces []models.Workspace
		err        error
	}
)

// App is the main TUI application
type App struct {
	config            *config.Config
	version           string
	clients           map[string]*api.Client // Map of connection ID -> client
	fileBrowser       *components.FileBrowser
	treeView          *components.TreeView
	connectionsScreen *screens.ConnectionsScreen
	syncScreen        *screens.SyncScreen
	dashboardScreen   *screens.DashboardScreen
	screen            Screen
	activePanel       Panel
	keyMap            AppKeyMap
	width             int
	height            int
	spinner           spinner.Model
	loading           bool
	statusMsg         string
	errorMsg          string
	showHelp          bool

	// CRUD dialog state
	crudDialog    *components.Dialog
	crudOperation CRUDOperation
	crudNode      *models.TreeNode
	crudNodeType  models.NodeType

	// Store wizard state
	storeWizard *components.StoreWizard

	// Workspace wizard state
	workspaceWizard *components.WorkspaceWizard

	// Resource wizard state (for layers and stores)
	resourceWizard *components.ResourceWizard

	// Upload state
	pendingUploadFiles        []models.LocalFile
	pendingUploadWorkspace    string
	pendingUploadConnectionID string

	// Last uploaded resource info (for focusing after refresh)
	lastUploadedWorkspace    string
	lastUploadedStoreNames   []string
	lastUploadedConnectionID string

	// Tree state preservation
	savedTreeState components.TreeState

	// Pending CRUD command (set by dialog callbacks, executed when dialog closes)
	pendingCRUDCmd tea.Cmd

	// Info dialog state
	infoDialog *components.InfoDialog

	// Progress dialog state
	progressDialog *components.ProgressDialog

	// Track newly created items for focusing after refresh
	newlyCreatedPath string

	// Preview server for layer preview
	previewServer *preview.Server

	// Cache wizard state
	cacheWizard *components.CacheWizard

	// Settings wizard state
	settingsWizard *components.SettingsWizard

	// Style wizard state
	styleWizard *components.StyleWizard

	// WYSIWYG Style editor state
	styleEditor *components.StyleEditor

	// Layer group wizard state
	layerGroupWizard *components.LayerGroupWizard

	// Map preview state
	mapPreview *components.MapPreview

	// Search modal state
	searchModal *components.SearchModal
}

// NewApp creates a new TUI application
func NewApp(cfg *config.Config, version string) *App {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = styles.LoadingStyle

	app := &App{
		config:            cfg,
		version:           version,
		clients:           make(map[string]*api.Client),
		fileBrowser:       components.NewFileBrowser(cfg.LastLocalPath),
		treeView:          components.NewTreeView(),
		connectionsScreen: screens.NewConnectionsScreen(cfg),
		syncScreen:        screens.NewSyncScreen(cfg),
		dashboardScreen:   screens.NewDashboardScreen(cfg),
		screen:            ScreenDashboard, // Start with dashboard
		activePanel:       PanelLeft,
		keyMap:            DefaultAppKeyMap(),
		spinner:           s,
	}

	// Set the left panel as active by default
	app.fileBrowser.SetActive(true)
	app.treeView.SetActive(false)

	// Create clients for all connections
	for i := range cfg.Connections {
		conn := &cfg.Connections[i]
		app.clients[conn.ID] = api.NewClient(conn)
	}

	// Mark as connected if we have any connections
	if len(cfg.Connections) > 0 {
		app.treeView.SetConnected(true, "GeoServer Connections")
	}

	return app
}

// Init initializes the TUI
func (a *App) Init() tea.Cmd {
	cmds := []tea.Cmd{
		a.spinner.Tick,
		a.dashboardScreen.Init(), // Initialize dashboard
	}

	// Build initial tree with all connections
	if len(a.config.Connections) > 0 {
		a.buildConnectionsTree()
	}

	return tea.Batch(cmds...)
}

// Update handles messages
func (a *App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		a.width = msg.Width
		a.height = msg.Height
		a.updateSizes()
		return a, nil

	case tea.KeyMsg:
		// If we have a progress dialog open, forward keys there first
		if a.progressDialog != nil && a.progressDialog.IsVisible() {
			var cmd tea.Cmd
			a.progressDialog, cmd = a.progressDialog.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			return a, tea.Batch(cmds...)
		}

		// If we have an info dialog open, forward keys there first
		if a.infoDialog != nil && a.infoDialog.IsVisible() {
			var cmd tea.Cmd
			a.infoDialog, cmd = a.infoDialog.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if dialog was closed
			if !a.infoDialog.IsVisible() {
				a.infoDialog = nil
			}
			return a, tea.Batch(cmds...)
		}

		// If we have a store wizard open, forward keys there first
		if a.storeWizard != nil && a.storeWizard.IsVisible() {
			var cmd tea.Cmd
			a.storeWizard, cmd = a.storeWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed
			if !a.storeWizard.IsVisible() {
				a.storeWizard = nil
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			}
			return a, tea.Batch(cmds...)
		}

		// If we have a workspace wizard open, forward keys there first
		if a.workspaceWizard != nil && a.workspaceWizard.IsVisible() {
			var cmd tea.Cmd
			a.workspaceWizard, cmd = a.workspaceWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed
			if !a.workspaceWizard.IsVisible() {
				a.workspaceWizard = nil
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			}
			return a, tea.Batch(cmds...)
		}

		// If we have a resource wizard open, forward keys there first
		if a.resourceWizard != nil && a.resourceWizard.IsVisible() {
			var cmd tea.Cmd
			a.resourceWizard, cmd = a.resourceWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed
			if !a.resourceWizard.IsVisible() {
				a.resourceWizard = nil
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			}
			return a, tea.Batch(cmds...)
		}

		// If we have a cache wizard open, forward keys there first
		if a.cacheWizard != nil && a.cacheWizard.IsVisible() {
			var cmd tea.Cmd
			a.cacheWizard, cmd = a.cacheWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed
			if !a.cacheWizard.IsVisible() {
				a.cacheWizard = nil
			}
			return a, tea.Batch(cmds...)
		}

		// If we have a settings wizard open, forward keys there first
		if a.settingsWizard != nil && a.settingsWizard.IsVisible() {
			var cmd tea.Cmd
			a.settingsWizard, cmd = a.settingsWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed
			if !a.settingsWizard.IsVisible() {
				a.settingsWizard = nil
			}
			return a, tea.Batch(cmds...)
		}

		// If we have a style wizard open, forward keys there first
		if a.styleWizard != nil && a.styleWizard.IsVisible() {
			var cmd tea.Cmd
			a.styleWizard, cmd = a.styleWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed
			if !a.styleWizard.IsVisible() {
				a.styleWizard = nil
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			}
			return a, tea.Batch(cmds...)
		}

		// If we have a WYSIWYG style editor open, forward keys there first
		if a.styleEditor != nil && a.styleEditor.IsVisible() {
			var cmd tea.Cmd
			a.styleEditor, cmd = a.styleEditor.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if editor was closed
			if !a.styleEditor.IsVisible() {
				a.styleEditor = nil
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			}
			return a, tea.Batch(cmds...)
		}

		// If we have a layer group wizard open and active, forward keys there first
		if a.layerGroupWizard != nil && a.layerGroupWizard.IsActive() {
			var cmd tea.Cmd
			a.layerGroupWizard, cmd = a.layerGroupWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed
			if !a.layerGroupWizard.IsVisible() {
				a.layerGroupWizard = nil
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			}
			return a, tea.Batch(cmds...)
		}

		// If we have a map preview open, forward keys there first
		if a.mapPreview != nil && a.mapPreview.IsVisible() {
			var cmd tea.Cmd
			a.mapPreview, cmd = a.mapPreview.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if preview was closed
			if !a.mapPreview.IsVisible() {
				a.mapPreview = nil
			}
			return a, tea.Batch(cmds...)
		}

		// If we have a search modal open, forward keys there first
		if a.searchModal != nil && a.searchModal.IsVisible() {
			var cmd tea.Cmd
			a.searchModal, cmd = a.searchModal.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if modal was closed
			if !a.searchModal.IsVisible() {
				a.searchModal = nil
			}
			return a, tea.Batch(cmds...)
		}

		// If we have a CRUD dialog open, forward keys there first
		if a.crudDialog != nil && a.crudDialog.IsVisible() {
			var cmd tea.Cmd
			a.crudDialog, cmd = a.crudDialog.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if dialog was closed
			if !a.crudDialog.IsVisible() {
				a.crudDialog = nil
				a.crudOperation = CRUDNone
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			}
			return a, tea.Batch(cmds...)
		}

		// If we're in the connections screen and editing a field, forward keys there first
		if a.screen == ScreenConnections && a.connectionsScreen.IsEditingField() {
			var cmd tea.Cmd
			a.connectionsScreen, cmd = a.connectionsScreen.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			return a, tea.Batch(cmds...)
		}

		// Handle global keys
		switch {
		case key.Matches(msg, a.keyMap.Quit):
			// Save config before quitting
			a.config.LastLocalPath = a.fileBrowser.CurrentPath()
			_ = a.config.Save()
			return a, tea.Quit

		case key.Matches(msg, a.keyMap.Tab):
			if a.screen == ScreenDashboard {
				// Switch to main screen from dashboard
				a.screen = ScreenMain
				return a, nil
			} else if a.screen == ScreenMain {
				a.switchPanel()
				return a, nil
			}

		case key.Matches(msg, a.keyMap.Help):
			a.showHelp = !a.showHelp
			return a, nil

		case key.Matches(msg, a.keyMap.Escape):
			if a.showHelp {
				a.showHelp = false
				return a, nil
			}
			// Navigate back: Dashboard <- Main <- Other screens
			if a.screen == ScreenMain {
				a.screen = ScreenDashboard
				return a, a.dashboardScreen.TriggerRefresh()
			} else if a.screen != ScreenDashboard {
				a.screen = ScreenMain
				return a, nil
			}

		case key.Matches(msg, a.keyMap.Connections):
			if a.screen == ScreenMain || a.screen == ScreenDashboard {
				a.screen = ScreenConnections
				return a, nil
			}

		case key.Matches(msg, a.keyMap.Upload):
			if a.screen == ScreenMain || a.screen == ScreenDashboard {
				return a, a.handleUpload()
			}

		case key.Matches(msg, a.keyMap.Refresh):
			if a.screen == ScreenDashboard {
				return a, a.dashboardScreen.TriggerRefresh()
			} else if a.screen == ScreenMain {
				if a.activePanel == PanelLeft {
					a.fileBrowser.Refresh()
				} else if len(a.clients) > 0 {
					// Rebuild the tree with all connections
					a.buildConnectionsTree()
					a.treeView.Refresh()
				}
				return a, nil
			}

		case key.Matches(msg, a.keyMap.Sync):
			if a.screen == ScreenMain || a.screen == ScreenDashboard {
				a.screen = ScreenSync
				return a, a.syncScreen.Init()
			}

		case key.Matches(msg, a.keyMap.Search):
			// Open search modal
			return a, a.openSearchModal()

		}

		// Handle screen-specific keys
		if a.screen == ScreenDashboard && !a.showHelp {
			var cmd tea.Cmd
			a.dashboardScreen, cmd = a.dashboardScreen.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		} else if a.screen == ScreenConnections && !a.showHelp {
			var cmd tea.Cmd
			a.connectionsScreen, cmd = a.connectionsScreen.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Rebuild tree when connections are changed
			if len(a.config.Connections) != len(a.clients) {
				// Update clients map
				a.clients = make(map[string]*api.Client)
				for i := range a.config.Connections {
					conn := &a.config.Connections[i]
					a.clients[conn.ID] = api.NewClient(conn)
				}
				// Rebuild tree
				a.buildConnectionsTree()
				a.treeView.SetConnected(len(a.clients) > 0, "GeoServer Connections")
			}
		} else if a.screen == ScreenSync && !a.showHelp {
			var cmd tea.Cmd
			a.syncScreen, cmd = a.syncScreen.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		} else if a.screen == ScreenMain && !a.showHelp {
			if a.activePanel == PanelLeft {
				var cmd tea.Cmd
				a.fileBrowser, cmd = a.fileBrowser.Update(msg)
				if cmd != nil {
					cmds = append(cmds, cmd)
				}
			} else {
				var cmd tea.Cmd
				a.treeView, cmd = a.treeView.Update(msg)
				if cmd != nil {
					cmds = append(cmds, cmd)
				}

				// Check if we need to load children for the selected node
				if key.Matches(msg, key.NewBinding(key.WithKeys("enter", "l", "right"))) {
					if node := a.treeView.SelectedNode(); node != nil && !node.IsLoaded && !node.IsLoading {
						cmd = a.loadNodeChildren(node)
						if cmd != nil {
							cmds = append(cmds, cmd)
						}
					}
				}
			}
		}

	case spinner.TickMsg:
		var cmd tea.Cmd
		a.spinner, cmd = a.spinner.Update(msg)
		cmds = append(cmds, cmd)

	case connectionWorkspacesLoadedMsg:
		msg.node.IsLoading = false
		if msg.err != nil {
			msg.node.HasError = true
			msg.node.ErrorMsg = msg.err.Error()
			a.treeView.Refresh()
			return a, nil
		}
		msg.node.IsLoaded = true
		a.addWorkspacesToConnection(msg.node, msg.workspaces)
		a.treeView.Refresh()
		// If we have a newly created item, navigate to it
		if a.newlyCreatedPath != "" {
			a.treeView.NavigateToPath(a.newlyCreatedPath)
			a.newlyCreatedPath = ""
		} else if a.savedTreeState.CursorPath != "" || len(a.savedTreeState.ExpandedPaths) > 0 {
			// Restore tree state if we have saved state (after CRUD operations or upload)
			a.treeView.RestoreState(a.savedTreeState)
			// Clear saved state after restoration
			a.savedTreeState = components.TreeState{}
		}

	case dataStoresLoadedMsg:
		msg.node.IsLoading = false
		msg.node.IsLoaded = true
		for _, store := range msg.stores {
			child := models.NewTreeNode(store.Name, models.NodeTypeDataStore)
			child.Workspace = msg.node.Workspace
			child.ConnectionID = msg.node.ConnectionID
			enabled := store.Enabled
			child.Enabled = &enabled
			msg.node.AddChild(child)
		}
		a.treeView.Refresh()

	case coverageStoresLoadedMsg:
		msg.node.IsLoading = false
		msg.node.IsLoaded = true
		for _, store := range msg.stores {
			child := models.NewTreeNode(store.Name, models.NodeTypeCoverageStore)
			child.Workspace = msg.node.Workspace
			child.ConnectionID = msg.node.ConnectionID
			enabled := store.Enabled
			child.Enabled = &enabled
			msg.node.AddChild(child)
		}
		a.treeView.Refresh()

	case stylesLoadedMsg:
		msg.node.IsLoading = false
		msg.node.IsLoaded = true
		for _, style := range msg.styles {
			child := models.NewTreeNode(style.Name, models.NodeTypeStyle)
			child.Workspace = msg.node.Workspace
			child.ConnectionID = msg.node.ConnectionID
			msg.node.AddChild(child)
		}
		a.treeView.Refresh()

	case layerGroupsLoadedMsg:
		msg.node.IsLoading = false
		msg.node.IsLoaded = true
		for _, group := range msg.groups {
			child := models.NewTreeNode(group.Name, models.NodeTypeLayerGroup)
			child.Workspace = msg.node.Workspace
			child.ConnectionID = msg.node.ConnectionID
			msg.node.AddChild(child)
		}
		a.treeView.Refresh()

	case layersLoadedMsg:
		msg.node.IsLoading = false
		msg.node.IsLoaded = true
		for _, layer := range msg.layers {
			child := models.NewTreeNode(layer.Name, models.NodeTypeLayer)
			child.Workspace = msg.node.Workspace
			child.ConnectionID = msg.node.ConnectionID
			child.Enabled = layer.Enabled
			msg.node.AddChild(child)
		}
		a.treeView.Refresh()

	case connectionTestMsg:
		a.loading = false
		if msg.success {
			a.statusMsg = fmt.Sprintf("Connected to GeoServer %s", msg.version)
			a.errorMsg = ""
			// Rebuild tree with all connections
			a.buildConnectionsTree()
			a.treeView.Refresh()
		} else {
			a.errorMsg = fmt.Sprintf("Connection failed: %v", msg.err)
		}

	case screens.ConnectionTestMsg:
		// Forward to connections screen and handle result
		var cmd tea.Cmd
		a.connectionsScreen, cmd = a.connectionsScreen.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		if msg.Success {
			// Update clients map and rebuild tree
			a.clients = make(map[string]*api.Client)
			for i := range a.config.Connections {
				conn := &a.config.Connections[i]
				a.clients[conn.ID] = api.NewClient(conn)
			}
			a.treeView.SetConnected(len(a.clients) > 0, "GeoServer Connections")
			a.buildConnectionsTree()
		}

	case uploadCompleteMsg:
		a.loading = false
		if msg.success {
			a.statusMsg = "Upload completed successfully"
			a.errorMsg = ""
			// Refresh the tree - find the connection node and reload it
			a.buildConnectionsTree()
			a.treeView.Refresh()
		} else {
			a.errorMsg = fmt.Sprintf("Upload failed: %v", msg.err)
		}

	case crudCompleteMsg:
		a.loading = false
		if msg.success {
			a.statusMsg = msg.operation + " completed successfully"
			a.errorMsg = ""
			// Refresh the tree - rebuild with all connections
			a.buildConnectionsTree()
			a.treeView.Refresh()
			// If we have a newly created item, navigate to it
			if a.newlyCreatedPath != "" {
				a.treeView.NavigateToPath(a.newlyCreatedPath)
				a.newlyCreatedPath = ""
			} else if a.savedTreeState.CursorPath != "" || len(a.savedTreeState.ExpandedPaths) > 0 {
				// Restore tree state if we have saved state
				a.treeView.RestoreState(a.savedTreeState)
				a.savedTreeState = components.TreeState{}
			}
		} else {
			a.errorMsg = fmt.Sprintf("%s failed: %v", msg.operation, msg.err)
		}

	case workspaceConfigLoadedMsg:
		a.loading = false
		if msg.err != nil {
			a.errorMsg = fmt.Sprintf("Failed to load workspace config: %v", msg.err)
			return a, nil
		}
		// Show the workspace wizard with loaded config
		a.workspaceWizard = components.NewWorkspaceWizardWithConfig(msg.config)
		a.workspaceWizard.SetSize(a.width, a.height)
		a.workspaceWizard.SetCallbacks(
			func(result components.WorkspaceWizardResult) {
				if result.Confirmed {
					a.pendingCRUDCmd = a.executeWorkspaceEdit(a.workspaceWizard.GetOriginalName(), result.Config)
				}
			},
			func() {},
		)
		return a, a.workspaceWizard.Init()

	case layerConfigLoadedMsg:
		a.loading = false
		if msg.err != nil {
			a.errorMsg = fmt.Sprintf("Failed to load layer config: %v", msg.err)
			return a, nil
		}
		// Show the resource wizard with loaded config
		a.resourceWizard = components.NewLayerWizard(msg.config)
		a.resourceWizard.SetSize(a.width, a.height)
		a.resourceWizard.SetCallbacks(
			func(result components.ResourceWizardResult) {
				if result.Confirmed && result.LayerConfig != nil {
					a.pendingCRUDCmd = a.executeLayerEdit(*result.LayerConfig)
				}
			},
			func() {},
		)
		return a, a.resourceWizard.Init()

	case dataStoreConfigLoadedMsg:
		a.loading = false
		if msg.err != nil {
			a.errorMsg = fmt.Sprintf("Failed to load data store config: %v", msg.err)
			return a, nil
		}
		// Show the resource wizard with loaded config
		a.resourceWizard = components.NewDataStoreWizardEdit(msg.config)
		a.resourceWizard.SetSize(a.width, a.height)
		a.resourceWizard.SetCallbacks(
			func(result components.ResourceWizardResult) {
				if result.Confirmed && result.DataStoreConfig != nil {
					a.pendingCRUDCmd = a.executeDataStoreEdit(*result.DataStoreConfig)
				}
			},
			func() {},
		)
		return a, a.resourceWizard.Init()

	case coverageStoreConfigLoadedMsg:
		a.loading = false
		if msg.err != nil {
			a.errorMsg = fmt.Sprintf("Failed to load coverage store config: %v", msg.err)
			return a, nil
		}
		// Show the resource wizard with loaded config
		a.resourceWizard = components.NewCoverageStoreWizardEdit(msg.config)
		a.resourceWizard.SetSize(a.width, a.height)
		a.resourceWizard.SetCallbacks(
			func(result components.ResourceWizardResult) {
				if result.Confirmed && result.CoverageStoreConfig != nil {
					a.pendingCRUDCmd = a.executeCoverageStoreEdit(*result.CoverageStoreConfig)
				}
			},
			func() {},
		)
		return a, a.resourceWizard.Init()

	case styleContentLoadedMsg:
		a.loading = false
		if msg.err != nil {
			a.errorMsg = fmt.Sprintf("Failed to load style content: %v", msg.err)
			return a, nil
		}
		// Show the style wizard with loaded content
		var format components.StyleFormat
		if msg.format == "css" {
			format = components.StyleFormatCSS
		} else {
			format = components.StyleFormatSLD
		}
		workspace := ""
		if a.crudNode != nil {
			workspace = a.crudNode.Workspace
		}
		a.styleWizard = components.NewStyleWizardForEdit(workspace, msg.name, msg.content, format)
		a.styleWizard.SetSize(a.width, a.height)
		a.styleWizard.SetCallbacks(
			func(result components.StyleWizardResult) {
				if result.Confirmed {
					a.pendingCRUDCmd = a.executeStyleEdit(workspace, msg.name, result)
				}
			},
			func() {},
		)
		return a, a.styleWizard.Init()

	case layersForLayerGroupLoadedMsg:
		// Layers loaded for layer group creation wizard
		if msg.err != nil {
			a.errorMsg = fmt.Sprintf("Failed to load layers: %v", msg.err)
			return a, nil
		}
		// Set the available layers and their styles in the wizard
		if a.layerGroupWizard != nil {
			a.layerGroupWizard.SetAvailableLayers(msg.layers)
			// Set available styles for each layer
			for layerKey, styles := range msg.layerStyles {
				a.layerGroupWizard.SetLayerStyles(layerKey, styles)
			}
			workspace := ""
			if a.crudNode != nil {
				workspace = a.crudNode.Workspace
			}
			a.layerGroupWizard.SetCallbacks(
				func(result components.LayerGroupWizardResult) {
					if result.Confirmed {
						a.pendingCRUDCmd = a.executeLayerGroupCreate(workspace, result)
					}
				},
				func() {},
			)
		}
		return a, nil

	case layerGroupDetailsLoadedMsg:
		a.loading = false
		if msg.err != nil {
			a.errorMsg = fmt.Sprintf("Failed to load layer group details: %v", msg.err)
			return a, nil
		}
		// Show the layer group wizard with loaded details
		workspace := ""
		if a.crudNode != nil {
			workspace = a.crudNode.Workspace
		}
		a.layerGroupWizard = components.NewLayerGroupWizardForEdit(workspace, msg.details)
		a.layerGroupWizard.SetAvailableLayers(msg.layers)
		// Set available styles for each layer
		for layerKey, styles := range msg.layerStyles {
			a.layerGroupWizard.SetLayerStyles(layerKey, styles)
		}
		a.layerGroupWizard.SetSize(a.width, a.height)
		a.layerGroupWizard.SetCallbacks(
			func(result components.LayerGroupWizardResult) {
				if result.Confirmed {
					a.pendingCRUDCmd = a.executeLayerGroupEdit(workspace, msg.details.Name, result)
				}
			},
			func() {},
		)
		return a, a.layerGroupWizard.Init()

	case components.TreeNewMsg:
		// Show create dialog based on node type
		return a, a.showCreateDialog(msg.Node, msg.NodeType)

	case components.TreeEditMsg:
		// Show edit dialog for the node
		return a, a.showEditDialog(msg.Node)

	case components.TreeDeleteMsg:
		// Show delete confirmation dialog
		return a, a.showDeleteDialog(msg.Node)

	case components.DialogAnimationMsg:
		// Forward to dialog if we have one
		if a.crudDialog != nil {
			wasVisible := a.crudDialog.IsVisible()
			var cmd tea.Cmd
			a.crudDialog, cmd = a.crudDialog.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if dialog was closed during animation
			if wasVisible && !a.crudDialog.IsVisible() {
				a.crudDialog = nil
				a.crudOperation = CRUDNone
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			}
		}

	case components.StoreWizardAnimationMsg:
		// Forward to wizard if we have one
		if a.storeWizard != nil {
			wasVisible := a.storeWizard.IsVisible()
			var cmd tea.Cmd
			a.storeWizard, cmd = a.storeWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed during animation
			if wasVisible && !a.storeWizard.IsVisible() {
				a.storeWizard = nil
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			}
		}

	case components.WorkspaceWizardAnimationMsg:
		// Forward to workspace wizard if we have one
		if a.workspaceWizard != nil {
			wasVisible := a.workspaceWizard.IsVisible()
			var cmd tea.Cmd
			a.workspaceWizard, cmd = a.workspaceWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed during animation
			if wasVisible && !a.workspaceWizard.IsVisible() {
				a.workspaceWizard = nil
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			}
		}

	case components.ResourceWizardAnimationMsg:
		// Forward to resource wizard if we have one
		if a.resourceWizard != nil {
			wasVisible := a.resourceWizard.IsVisible()
			var cmd tea.Cmd
			a.resourceWizard, cmd = a.resourceWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed during animation
			if wasVisible && !a.resourceWizard.IsVisible() {
				a.resourceWizard = nil
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			}
		}

	case components.InfoDialogAnimationMsg:
		// Forward to info dialog if we have one
		if a.infoDialog != nil && a.infoDialog.IsVisible() {
			var cmd tea.Cmd
			a.infoDialog, cmd = a.infoDialog.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if dialog was closed during animation
			if !a.infoDialog.IsVisible() {
				a.infoDialog = nil
			}
		}

	case components.InfoDialogMetadataMsg:
		// Forward metadata message to info dialog if we have one
		if a.infoDialog != nil && a.infoDialog.IsVisible() {
			var cmd tea.Cmd
			a.infoDialog, cmd = a.infoDialog.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		}

	case components.ProgressDialogAnimationMsg:
		// Forward to progress dialog if we have one
		if a.progressDialog != nil {
			wasVisible := a.progressDialog.IsVisible()
			var cmd tea.Cmd
			a.progressDialog, cmd = a.progressDialog.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if dialog was closed during animation
			if wasVisible && !a.progressDialog.IsVisible() {
				// Trigger tree refresh if upload completed successfully
				if a.progressDialog.IsDone() && a.progressDialog.GetError() == nil {
					a.buildConnectionsTree()
					a.treeView.Refresh()

					// Navigate to and focus on the uploaded resource
					if a.lastUploadedConnectionID != "" && a.lastUploadedWorkspace != "" && len(a.lastUploadedStoreNames) > 0 {
						// Focus on the last uploaded store
						lastStore := a.lastUploadedStoreNames[len(a.lastUploadedStoreNames)-1]
						a.focusUploadedResource(a.lastUploadedConnectionID, a.lastUploadedWorkspace, lastStore)

						// Clear last uploaded info
						a.lastUploadedConnectionID = ""
						a.lastUploadedWorkspace = ""
						a.lastUploadedStoreNames = nil
					}
				}
				a.progressDialog = nil
			}
		}

	case components.ProgressUpdateMsg:
		// Forward to progress dialog if we have one
		if a.progressDialog != nil {
			var cmd tea.Cmd
			a.progressDialog, cmd = a.progressDialog.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		}

	case UploadNextMsg:
		// Continue uploading the next file
		cmds = append(cmds,
			components.SendProgressUpdate("Uploading Files", msg.Index, len(msg.Files), msg.Files[msg.Index].Name, false, nil),
			a.uploadFile(msg.Files, msg.Workspace, msg.ConnectionID, msg.Index),
		)

	case components.FileInfoMsg:
		// Show info dialog for file
		a.infoDialog = components.NewFileInfoDialog(msg.File)
		a.infoDialog.SetSize(a.width, a.height)
		return a, a.infoDialog.Init()

	case components.TreeInfoMsg:
		// Show info dialog for tree node with connection info for extended metadata
		geoserverURL := ""
		username := ""
		password := ""
		if conn := a.getConnectionForNode(msg.Node); conn != nil {
			if client := a.getClientForNode(msg.Node); client != nil {
				geoserverURL = client.BaseURL()
			}
			username = conn.Username
			password = conn.Password
		}
		a.infoDialog = components.NewTreeNodeInfoDialogWithConnection(msg.Node, geoserverURL, username, password)
		a.infoDialog.SetSize(a.width, a.height)
		return a, a.infoDialog.Init()

	case components.TreePreviewMsg:
		// Open layer preview in browser and show status message
		a.statusMsg = fmt.Sprintf("Opening preview for %s in browser...", msg.Node.Name)
		return a, a.openLayerPreview(msg.Node)

	case components.TreePublishMsg:
		// Publish a layer from a store
		return a, a.publishLayerFromStore(msg.Node)

	case components.TreeCacheMsg:
		// Show cache management wizard
		return a, a.showCacheWizard(msg.Node)

	case components.TreeSettingsMsg:
		// Show settings wizard for the connection
		return a, a.showSettingsWizard(msg.Node)

	case components.TreeDownloadMsg:
		// Download resource configuration
		return a, a.downloadResource(msg.Node)

	case components.TreeVisualEditMsg:
		// Open WYSIWYG style editor
		return a, a.showVisualStyleEditor(msg.Node)

	case components.CacheWizardAnimationMsg:
		// Forward to cache wizard if we have one
		if a.cacheWizard != nil && a.cacheWizard.IsVisible() {
			var cmd tea.Cmd
			a.cacheWizard, cmd = a.cacheWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed during animation
			if !a.cacheWizard.IsVisible() {
				a.cacheWizard = nil
			}
		}

	case components.SettingsWizardAnimationMsg:
		// Forward to settings wizard if we have one
		if a.settingsWizard != nil && a.settingsWizard.IsVisible() {
			var cmd tea.Cmd
			a.settingsWizard, cmd = a.settingsWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed during animation
			if !a.settingsWizard.IsVisible() {
				a.settingsWizard = nil
			}
		}

	case components.StyleWizardAnimationMsg:
		// Forward to style wizard if we have one
		if a.styleWizard != nil && a.styleWizard.IsVisible() {
			var cmd tea.Cmd
			a.styleWizard, cmd = a.styleWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed during animation
			if !a.styleWizard.IsVisible() {
				a.styleWizard = nil
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			}
		}

	case components.LayerGroupWizardAnimationMsg:
		// Forward to layer group wizard if we have one
		if a.layerGroupWizard != nil && a.layerGroupWizard.IsVisible() {
			var cmd tea.Cmd
			a.layerGroupWizard, cmd = a.layerGroupWizard.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if wizard was closed during animation
			if !a.layerGroupWizard.IsVisible() {
				a.layerGroupWizard = nil
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			}
		}

	case settingsLoadedMsg:
		a.loading = false
		if msg.err != nil {
			a.errorMsg = fmt.Sprintf("Failed to load settings: %v", msg.err)
			return a, nil
		}
		// Show the settings wizard with loaded contact data
		a.settingsWizard = components.NewSettingsWizard(msg.connectionID, msg.connName, msg.contact)
		a.settingsWizard.SetSize(a.width, a.height)
		a.settingsWizard.SetCallbacks(
			func(result components.SettingsWizardResult) {
				if result.Confirmed && result.Contact != nil {
					// Save settings
					a.pendingCRUDCmd = a.saveSettings(result.ConnectionID, result.Contact)
				}
			},
			func() {},
		)
		return a, a.settingsWizard.Init()

	case settingsSavedMsg:
		a.loading = false
		if msg.success {
			a.statusMsg = "Settings saved successfully"
			a.errorMsg = ""
		} else {
			a.errorMsg = fmt.Sprintf("Failed to save settings: %v", msg.err)
		}

	case downloadResourceMsg:
		a.loading = false
		if msg.success {
			a.statusMsg = fmt.Sprintf("Downloaded to: %s", msg.filename)
			a.errorMsg = ""
			// Refresh file browser to show the new file
			a.fileBrowser.Refresh()
		} else {
			a.errorMsg = fmt.Sprintf("Download failed: %v", msg.err)
		}

	case cacheOperationCompleteMsg:
		a.loading = false
		if msg.success {
			a.statusMsg = fmt.Sprintf("%s operation started for %s", msg.operation, msg.layerName)
			a.errorMsg = ""
		} else {
			a.errorMsg = fmt.Sprintf("%s failed: %v", msg.operation, msg.err)
		}

	case screens.SyncProgressMsg:
		// Forward to sync screen
		if a.syncScreen != nil {
			var cmd tea.Cmd
			a.syncScreen, cmd = a.syncScreen.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		}

	case screens.DashboardStatusMsg, screens.DashboardRefreshMsg:
		// Forward to dashboard screen
		if a.dashboardScreen != nil {
			var cmd tea.Cmd
			a.dashboardScreen, cmd = a.dashboardScreen.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		}

	case components.MapPreviewMsg:
		// Forward to map preview if we have one
		if a.mapPreview != nil {
			var cmd tea.Cmd
			a.mapPreview, cmd = a.mapPreview.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		}

	case components.MapPreviewMetadataMsg:
		// Forward metadata to map preview - this triggers the initial map fetch
		if a.mapPreview != nil {
			var cmd tea.Cmd
			a.mapPreview, cmd = a.mapPreview.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		}

	case components.LegendMsg:
		// Forward legend response to map preview
		if a.mapPreview != nil {
			var cmd tea.Cmd
			a.mapPreview, cmd = a.mapPreview.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		}

	case components.FeatureInfoMsg:
		// Forward feature info response to map preview
		if a.mapPreview != nil {
			var cmd tea.Cmd
			a.mapPreview, cmd = a.mapPreview.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		}

	case components.StylePreviewMsg:
		// Forward style preview response to style editor
		if a.styleEditor != nil {
			var cmd tea.Cmd
			a.styleEditor, cmd = a.styleEditor.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		}

	case components.StyleEditorMsg:
		// Handle style editor save/cancel
		if a.styleEditor != nil {
			if msg.Type == "save" && msg.Style != nil {
				// Save the style to GeoServer
				a.statusMsg = "Style saved"
				a.styleEditor.Hide()
				a.styleEditor = nil
				// Execute pending CRUD command if any
				if a.pendingCRUDCmd != nil {
					cmds = append(cmds, a.pendingCRUDCmd)
					a.pendingCRUDCmd = nil
				}
			} else if msg.Type == "cancel" {
				a.styleEditor.Hide()
				a.styleEditor = nil
			}
		}

	case components.SearchAnimationMsg:
		// Forward to search modal if we have one
		if a.searchModal != nil && a.searchModal.IsVisible() {
			var cmd tea.Cmd
			a.searchModal, cmd = a.searchModal.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			// Check if modal was closed during animation
			if !a.searchModal.IsVisible() {
				a.searchModal = nil
			}
		}

	case components.SearchResultsMsg:
		// Forward search results to search modal
		if a.searchModal != nil {
			var cmd tea.Cmd
			a.searchModal, cmd = a.searchModal.Update(msg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		}

	case errMsg:
		a.loading = false
		a.errorMsg = msg.err.Error()
	}

	return a, tea.Batch(cmds...)
}

// View renders the TUI
func (a *App) View() string {
	if a.width == 0 || a.height == 0 {
		return "Loading..."
	}

	var content string

	switch a.screen {
	case ScreenDashboard:
		content = a.renderDashboardScreen()
	case ScreenMain:
		content = a.renderMainScreen()
	case ScreenConnections:
		content = a.renderConnectionsScreen()
	case ScreenSync:
		content = a.renderSyncScreen()
	case ScreenHelp:
		content = a.renderHelpScreen()
	default:
		content = a.renderDashboardScreen()
	}

	if a.showHelp {
		content = a.renderHelpOverlay(content)
	}

	// Render CRUD dialog overlay
	if a.crudDialog != nil && a.crudDialog.IsVisible() {
		a.crudDialog.SetSize(a.width, a.height)
		content = a.crudDialog.View()
	}

	// Render store wizard overlay
	if a.storeWizard != nil && a.storeWizard.IsVisible() {
		a.storeWizard.SetSize(a.width, a.height)
		content = a.storeWizard.View()
	}

	// Render workspace wizard overlay
	if a.workspaceWizard != nil && a.workspaceWizard.IsVisible() {
		a.workspaceWizard.SetSize(a.width, a.height)
		content = a.workspaceWizard.View()
	}

	// Render resource wizard overlay
	if a.resourceWizard != nil && a.resourceWizard.IsVisible() {
		a.resourceWizard.SetSize(a.width, a.height)
		content = a.resourceWizard.View()
	}

	// Render info dialog overlay
	if a.infoDialog != nil && a.infoDialog.IsVisible() {
		a.infoDialog.SetSize(a.width, a.height)
		content = a.infoDialog.View()
	}

	// Render cache wizard overlay
	if a.cacheWizard != nil && a.cacheWizard.IsVisible() {
		a.cacheWizard.SetSize(a.width, a.height)
		content = a.cacheWizard.View()
	}

	// Render settings wizard overlay
	if a.settingsWizard != nil && a.settingsWizard.IsVisible() {
		a.settingsWizard.SetSize(a.width, a.height)
		content = a.settingsWizard.View()
	}

	// Render style wizard overlay
	if a.styleWizard != nil && a.styleWizard.IsVisible() {
		a.styleWizard.SetSize(a.width, a.height)
		content = a.styleWizard.View()
	}

	// Render WYSIWYG style editor overlay
	if a.styleEditor != nil && a.styleEditor.IsVisible() {
		a.styleEditor.SetSize(a.width, a.height)
		content = a.styleEditor.View()
	}

	// Render layer group wizard overlay
	if a.layerGroupWizard != nil && a.layerGroupWizard.IsVisible() {
		a.layerGroupWizard.SetSize(a.width, a.height)
		content = a.layerGroupWizard.View()
	}

	// Render map preview overlay
	if a.mapPreview != nil && a.mapPreview.IsVisible() {
		a.mapPreview.SetSize(a.width, a.height)
		content = a.mapPreview.View()
	}

	// Render search modal overlay (high priority)
	if a.searchModal != nil && a.searchModal.IsVisible() {
		a.searchModal.SetSize(a.width, a.height)
		content = a.searchModal.View()
	}

	// Render progress dialog overlay (highest priority)
	if a.progressDialog != nil && a.progressDialog.IsVisible() {
		a.progressDialog.SetSize(a.width, a.height)
		content = a.progressDialog.View()
	}

	return content
}

// renderMainScreen renders the main dual-panel screen
func (a *App) renderMainScreen() string {
	// Calculate panel widths
	panelWidth := (a.width - 1) / 2 // -1 for the separator
	panelHeight := a.height - 4     // -4 for title bar and status bar

	// Update component sizes
	a.fileBrowser.SetSize(panelWidth, panelHeight)
	a.treeView.SetSize(panelWidth, panelHeight)

	// Render panels
	leftPanel := a.fileBrowser.View()
	rightPanel := a.treeView.View()

	// Join panels horizontally
	panels := lipgloss.JoinHorizontal(lipgloss.Top, leftPanel, rightPanel)

	// Title bar
	title := styles.TitleStyle.Render(" \uf0ac Kartoza GeoServer Client") // fa-globe
	titleBar := lipgloss.PlaceHorizontal(a.width, lipgloss.Left, title)

	// Status bar
	statusBar := a.renderStatusBar()

	// Help bar
	helpBar := a.renderHelpBar()

	// Combine everything
	return styles.JoinVertical(titleBar, panels, statusBar, helpBar)
}

// renderStatusBar renders the status bar
func (a *App) renderStatusBar() string {
	var status string

	if a.loading {
		status = a.spinner.View() + " Loading..."
	} else if a.errorMsg != "" {
		status = styles.ErrorStyle.Render("\uf00d " + a.errorMsg) // fa-times
	} else if a.statusMsg != "" {
		status = styles.SuccessStyle.Render("\uf00c " + a.statusMsg) // fa-check
	} else {
		// Show current selection info
		if a.activePanel == PanelLeft {
			if file := a.fileBrowser.SelectedFile(); file != nil {
				status = fmt.Sprintf(" %s %s", file.Type.Icon(), file.Path)
			}
		} else {
			if node := a.treeView.SelectedNode(); node != nil {
				status = fmt.Sprintf(" %s %s", node.Type.Icon(), node.Path())
			}
		}
	}

	return styles.StatusBarStyle.Width(a.width).Render(status)
}

// renderHelpBar renders the help bar at the bottom
func (a *App) renderHelpBar() string {
	var items []string

	items = append(items, styles.RenderHelpKey("Tab", "switch"))
	items = append(items, styles.RenderHelpKey("↑↓", "navigate"))
	items = append(items, styles.RenderHelpKey("Enter", "open"))
	items = append(items, styles.RenderHelpKey("i", "info"))

	// Show CRUD shortcuts when on the tree panel and connected
	if a.activePanel == PanelRight && a.treeView.IsConnected() {
		items = append(items, styles.RenderHelpKey("n", "new"))
		items = append(items, styles.RenderHelpKey("e", "edit"))
		items = append(items, styles.RenderHelpKey("d", "delete"))
		// Show context-specific options
		if node := a.treeView.SelectedNode(); node != nil {
			switch node.Type {
			case models.NodeTypeConnection:
				items = append(items, styles.RenderHelpKey("s", "settings"))
			case models.NodeTypeLayer, models.NodeTypeLayerGroup:
				items = append(items, styles.RenderHelpKey("o", "preview"))
				items = append(items, styles.RenderHelpKey("t", "cache"))
			case models.NodeTypeDataStore, models.NodeTypeCoverageStore:
				items = append(items, styles.RenderHelpKey("o", "preview"))
				items = append(items, styles.RenderHelpKey("p", "publish"))
			case models.NodeTypeStyle:
				items = append(items, styles.RenderHelpKey("v", "visual"))
			}
		}
	}

	items = append(items, styles.RenderHelpKey("^K", "search"))
	items = append(items, styles.RenderHelpKey("c", "connections"))
	items = append(items, styles.RenderHelpKey("u", "upload"))
	items = append(items, styles.RenderHelpKey("S", "sync"))
	items = append(items, styles.RenderHelpKey("r", "refresh"))
	items = append(items, styles.RenderHelpKey("?", "help"))
	items = append(items, styles.RenderHelpKey("q", "quit"))

	return styles.HelpBarStyle.Width(a.width).Render(strings.Join(items, "  "))
}

// renderConnectionsScreen renders the connections management screen
func (a *App) renderConnectionsScreen() string {
	a.connectionsScreen.SetSize(a.width, a.height)
	return a.connectionsScreen.View()
}

// renderSyncScreen renders the sync screen
func (a *App) renderSyncScreen() string {
	a.syncScreen.SetSize(a.width, a.height)
	return a.syncScreen.View()
}

// renderDashboardScreen renders the dashboard screen with proper header/footer
func (a *App) renderDashboardScreen() string {
	// Title bar (same as main screen)
	title := styles.TitleStyle.Render(" \uf0ac Kartoza GeoServer Client") // fa-globe
	titleBar := lipgloss.PlaceHorizontal(a.width, lipgloss.Left, title)

	// Help bar
	helpBar := a.renderDashboardHelpBar()

	// Calculate content height (total height - title bar - help bar)
	contentHeight := a.height - 2 // -1 for title bar, -1 for help bar

	// Get dashboard content and set its size
	a.dashboardScreen.SetSize(a.width, contentHeight)
	dashboardContent := a.dashboardScreen.View()

	// Center the dashboard content vertically
	centeredContent := lipgloss.Place(
		a.width,
		contentHeight,
		lipgloss.Center,
		lipgloss.Center,
		dashboardContent,
	)

	// Combine with proper layout
	return styles.JoinVertical(titleBar, centeredContent, helpBar)
}

// renderDashboardHelpBar renders the help bar for the dashboard screen
func (a *App) renderDashboardHelpBar() string {
	var items []string

	items = append(items, styles.RenderHelpKey("↑↓", "navigate"))
	items = append(items, styles.RenderHelpKey("Enter", "select"))
	items = append(items, styles.RenderHelpKey("Tab", "main"))
	items = append(items, styles.RenderHelpKey("^K", "search"))
	items = append(items, styles.RenderHelpKey("c", "connections"))
	items = append(items, styles.RenderHelpKey("S", "sync"))
	items = append(items, styles.RenderHelpKey("r", "refresh"))
	items = append(items, styles.RenderHelpKey("?", "help"))
	items = append(items, styles.RenderHelpKey("q", "quit"))

	return styles.HelpBarStyle.Width(a.width).Render(strings.Join(items, "  "))
}

// renderHelpScreen renders the help screen
func (a *App) renderHelpScreen() string {
	return a.renderHelpOverlay("")
}

// renderHelpOverlay renders the help overlay
func (a *App) renderHelpOverlay(background string) string {
	var b strings.Builder

	title := styles.DialogTitleStyle.Render("Help - Keyboard Shortcuts")
	b.WriteString(title)
	b.WriteString("\n\n")

	sections := []struct {
		title string
		keys  [][2]string
	}{
		{
			title: "Navigation",
			keys: [][2]string{
				{"↑/k", "Move up"},
				{"↓/j", "Move down"},
				{"Enter/l", "Open / Expand"},
				{"Backspace/h", "Back / Collapse"},
				{"Tab", "Switch panel"},
				{"PgUp/PgDn", "Page up/down"},
				{"Home/End", "Go to start/end"},
			},
		},
		{
			title: "Actions",
			keys: [][2]string{
				{"Space", "Select file"},
				{"u", "Upload selected"},
				{"r", "Refresh"},
				{"c", "Manage connections"},
			},
		},
		{
			title: "General",
			keys: [][2]string{
				{"?/F1", "Toggle help"},
				{"Esc", "Back / Close"},
				{"q/Ctrl+C", "Quit"},
			},
		},
	}

	for _, section := range sections {
		b.WriteString(styles.PanelHeaderStyle.Render(section.title))
		b.WriteString("\n")
		for _, kv := range section.keys {
			b.WriteString(fmt.Sprintf("  %s  %s\n",
				styles.HelpKeyStyle.Width(12).Render(kv[0]),
				styles.HelpTextStyle.Render(kv[1])))
		}
		b.WriteString("\n")
	}

	b.WriteString(styles.HelpTextStyle.Render("Press ? or Esc to close"))

	dialog := styles.DialogStyle.Width(50).Render(b.String())
	return styles.Center(a.width, a.height, dialog)
}

// switchPanel switches between left and right panels
func (a *App) switchPanel() {
	if a.activePanel == PanelLeft {
		a.activePanel = PanelRight
		a.fileBrowser.SetActive(false)
		a.treeView.SetActive(true)
	} else {
		a.activePanel = PanelLeft
		a.fileBrowser.SetActive(true)
		a.treeView.SetActive(false)
	}
}

// updateSizes updates component sizes based on window size
func (a *App) updateSizes() {
	panelWidth := (a.width - 1) / 2
	panelHeight := a.height - 4

	a.fileBrowser.SetSize(panelWidth, panelHeight)
	a.treeView.SetSize(panelWidth, panelHeight)
}

// openSearchModal opens the universal search modal
func (a *App) openSearchModal() tea.Cmd {
	a.searchModal = components.NewSearchModal(a.config, a.clients)
	a.searchModal.SetSize(a.width, a.height)
	a.searchModal.SetCallbacks(
		func(result components.SearchResult) {
			// Navigate to the selected result in the tree
			node := result.ToTreeNode()
			a.navigateToSearchResult(node)
		},
		func() {
			// Cancel callback - just close the modal
		},
	)
	return a.searchModal.Init()
}

// navigateToSearchResult navigates to a search result in the tree
func (a *App) navigateToSearchResult(node *models.TreeNode) {
	if node == nil {
		return
	}

	// Make sure we're on the main screen
	a.screen = ScreenMain
	a.activePanel = PanelRight
	a.fileBrowser.SetActive(false)
	a.treeView.SetActive(true)

	// Navigate to the path in the tree
	path := a.buildSearchResultPath(node)
	a.treeView.NavigateToPath(path)
	a.statusMsg = fmt.Sprintf("Navigated to %s", node.Name)
}

// buildSearchResultPath builds a tree path for a search result
func (a *App) buildSearchResultPath(node *models.TreeNode) string {
	// Build path based on node type
	var pathParts []string

	// Add connection name
	for _, conn := range a.config.Connections {
		if conn.ID == node.ConnectionID {
			pathParts = append(pathParts, conn.Name)
			break
		}
	}

	// Add workspace if present
	if node.Workspace != "" {
		pathParts = append(pathParts, node.Workspace)
	}

	// Add container folder based on type
	switch node.Type {
	case models.NodeTypeDataStore:
		pathParts = append(pathParts, "Data Stores")
	case models.NodeTypeCoverageStore:
		pathParts = append(pathParts, "Coverage Stores")
	case models.NodeTypeLayer:
		pathParts = append(pathParts, "Layers")
	case models.NodeTypeStyle:
		pathParts = append(pathParts, "Styles")
	case models.NodeTypeLayerGroup:
		pathParts = append(pathParts, "Layer Groups")
	}

	// Add the item name
	pathParts = append(pathParts, node.Name)

	return strings.Join(pathParts, "/")
}

// showSettingsWizard shows the settings wizard for a connection
func (a *App) showSettingsWizard(node *models.TreeNode) tea.Cmd {
	if node == nil || node.Type != models.NodeTypeConnection {
		return nil
	}

	// Get the client for this connection
	client := a.clients[node.ConnectionID]
	if client == nil {
		a.errorMsg = "Connection not found"
		return nil
	}

	// Get connection name
	connName := node.Name

	a.loading = true
	a.statusMsg = "Loading settings..."

	return func() tea.Msg {
		contact, err := client.GetContact()
		return settingsLoadedMsg{
			contact:      contact,
			connectionID: node.ConnectionID,
			connName:     connName,
			err:          err,
		}
	}
}

// saveSettings saves the settings for a connection
func (a *App) saveSettings(connectionID string, contact *models.GeoServerContact) tea.Cmd {
	client := a.clients[connectionID]
	if client == nil {
		return func() tea.Msg {
			return settingsSavedMsg{
				success: false,
				err:     fmt.Errorf("connection not found"),
			}
		}
	}

	a.loading = true
	a.statusMsg = "Saving settings..."

	return func() tea.Msg {
		err := client.UpdateContact(contact)
		return settingsSavedMsg{
			success: err == nil,
			err:     err,
		}
	}
}

// downloadResourceMsg is sent after a download attempt
type downloadResourceMsg struct {
	filename string
	success  bool
	err      error
}

// downloadResource downloads the resource configuration to the current file browser directory
func (a *App) downloadResource(node *models.TreeNode) tea.Cmd {
	if node == nil {
		return nil
	}

	client := a.getClientForNode(node)
	if client == nil {
		a.errorMsg = "Connection not found"
		return nil
	}

	// Get the current directory from the file browser (capture before goroutine)
	downloadDir := a.fileBrowser.CurrentPath()

	a.loading = true
	a.statusMsg = fmt.Sprintf("Downloading %s to %s...", node.Name, downloadDir)

	return func() tea.Msg {
		var data []byte
		var filename string
		var err error

		switch node.Type {
		case models.NodeTypeWorkspace:
			data, err = client.DownloadWorkspace(node.Name)
			filename = fmt.Sprintf("%s_workspace.json", node.Name)

		case models.NodeTypeDataStore:
			workspace := ""
			if node.Parent != nil && node.Parent.Parent != nil {
				workspace = node.Parent.Parent.Name
			}
			data, err = client.DownloadDataStore(workspace, node.Name)
			filename = fmt.Sprintf("%s_%s_datastore.json", workspace, node.Name)

		case models.NodeTypeCoverageStore:
			workspace := ""
			if node.Parent != nil && node.Parent.Parent != nil {
				workspace = node.Parent.Parent.Name
			}
			data, err = client.DownloadCoverageStore(workspace, node.Name)
			filename = fmt.Sprintf("%s_%s_coveragestore.json", workspace, node.Name)

		case models.NodeTypeLayer:
			workspace := ""
			if node.Parent != nil && node.Parent.Parent != nil {
				workspace = node.Parent.Parent.Name
			}
			data, err = client.DownloadLayer(workspace, node.Name)
			filename = fmt.Sprintf("%s_%s_layer.json", workspace, node.Name)

		case models.NodeTypeStyle:
			workspace := ""
			if node.Parent != nil && node.Parent.Parent != nil {
				workspace = node.Parent.Parent.Name
			}
			var ext string
			data, ext, err = client.DownloadStyle(workspace, node.Name)
			filename = fmt.Sprintf("%s_%s%s", workspace, node.Name, ext)

		case models.NodeTypeLayerGroup:
			workspace := ""
			if node.Parent != nil && node.Parent.Parent != nil {
				workspace = node.Parent.Parent.Name
			}
			data, err = client.DownloadLayerGroup(workspace, node.Name)
			filename = fmt.Sprintf("%s_%s_layergroup.json", workspace, node.Name)

		default:
			return downloadResourceMsg{
				success: false,
				err:     fmt.Errorf("download not supported for this resource type"),
			}
		}

		if err != nil {
			return downloadResourceMsg{
				success: false,
				err:     err,
			}
		}

		// Write to file
		filepath := filepath.Join(downloadDir, filename)
		err = os.WriteFile(filepath, data, 0644)
		if err != nil {
			return downloadResourceMsg{
				success: false,
				err:     fmt.Errorf("failed to write file: %w", err),
			}
		}

		return downloadResourceMsg{
			filename: filepath,
			success:  true,
		}
	}
}
