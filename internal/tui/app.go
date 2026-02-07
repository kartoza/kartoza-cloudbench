package tui

import (
	"fmt"
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
	ScreenMain Screen = iota
	ScreenConnections
	ScreenUpload
	ScreenHelp
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
		screen:            ScreenMain,
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
			if a.screen == ScreenMain {
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
			if a.screen != ScreenMain {
				a.screen = ScreenMain
				return a, nil
			}

		case key.Matches(msg, a.keyMap.Connections):
			if a.screen == ScreenMain {
				a.screen = ScreenConnections
				return a, nil
			}

		case key.Matches(msg, a.keyMap.Upload):
			if a.screen == ScreenMain {
				return a, a.handleUpload()
			}

		case key.Matches(msg, a.keyMap.Refresh):
			if a.screen == ScreenMain {
				if a.activePanel == PanelLeft {
					a.fileBrowser.Refresh()
				} else if len(a.clients) > 0 {
					// Rebuild the tree with all connections
					a.buildConnectionsTree()
					a.treeView.Refresh()
				}
				return a, nil
			}
		}

		// Handle screen-specific keys
		if a.screen == ScreenConnections && !a.showHelp {
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
	case ScreenMain:
		content = a.renderMainScreen()
	case ScreenConnections:
		content = a.renderConnectionsScreen()
	case ScreenHelp:
		content = a.renderHelpScreen()
	default:
		content = a.renderMainScreen()
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
	title := styles.TitleStyle.Render(" 🌍 Kartoza GeoServer Client")
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
		status = styles.ErrorStyle.Render("✗ " + a.errorMsg)
	} else if a.statusMsg != "" {
		status = styles.SuccessStyle.Render("✓ " + a.statusMsg)
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
		// Show preview and publish options for layers and stores
		if node := a.treeView.SelectedNode(); node != nil {
			switch node.Type {
			case models.NodeTypeLayer, models.NodeTypeLayerGroup:
				items = append(items, styles.RenderHelpKey("o", "preview"))
			case models.NodeTypeDataStore, models.NodeTypeCoverageStore:
				items = append(items, styles.RenderHelpKey("o", "preview"))
				items = append(items, styles.RenderHelpKey("p", "publish"))
			}
		}
	}

	items = append(items, styles.RenderHelpKey("c", "connections"))
	items = append(items, styles.RenderHelpKey("u", "upload"))
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
