package tui

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
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
	workspacesLoadedMsg   struct{ workspaces []models.Workspace }
	dataStoresLoadedMsg   struct{ node *models.TreeNode; stores []models.DataStore }
	coverageStoresLoadedMsg struct{ node *models.TreeNode; stores []models.CoverageStore }
	stylesLoadedMsg       struct{ node *models.TreeNode; styles []models.Style }
	layerGroupsLoadedMsg  struct{ node *models.TreeNode; groups []models.LayerGroup }
	layersLoadedMsg       struct{ node *models.TreeNode; layers []models.Layer }
	connectionTestMsg     struct{ success bool; err error; version string }
	uploadCompleteMsg     struct{ success bool; err error }
	errMsg                struct{ err error }
)

// App is the main TUI application
type App struct {
	config            *config.Config
	version           string
	client            *api.Client
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
}

// NewApp creates a new TUI application
func NewApp(cfg *config.Config, version string) *App {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = styles.LoadingStyle

	app := &App{
		config:            cfg,
		version:           version,
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

	// Connect to active connection if available
	if conn := cfg.GetActiveConnection(); conn != nil {
		app.client = api.NewClient(conn)
		app.treeView.SetConnected(true, conn.Name)
	}

	return app
}

// Init initializes the TUI
func (a *App) Init() tea.Cmd {
	cmds := []tea.Cmd{
		a.spinner.Tick,
	}

	// Load workspaces if connected
	if a.client != nil {
		cmds = append(cmds, a.loadWorkspaces())
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
				} else if a.client != nil {
					a.treeView.Clear()
					return a, a.loadWorkspaces()
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
			// Check if we should connect after user selects a connection
			if conn := a.connectionsScreen.GetActiveConnection(); conn != nil && a.client == nil {
				a.client = api.NewClient(conn)
				a.treeView.SetConnected(true, conn.Name)
				cmds = append(cmds, a.loadWorkspaces())
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

	case workspacesLoadedMsg:
		a.loading = false
		a.buildWorkspaceTree(msg.workspaces)
		a.treeView.Refresh()

	case dataStoresLoadedMsg:
		msg.node.IsLoading = false
		msg.node.IsLoaded = true
		for _, store := range msg.stores {
			child := models.NewTreeNode(store.Name, models.NodeTypeDataStore)
			child.Workspace = msg.node.Workspace
			msg.node.AddChild(child)
		}
		a.treeView.Refresh()

	case coverageStoresLoadedMsg:
		msg.node.IsLoading = false
		msg.node.IsLoaded = true
		for _, store := range msg.stores {
			child := models.NewTreeNode(store.Name, models.NodeTypeCoverageStore)
			child.Workspace = msg.node.Workspace
			msg.node.AddChild(child)
		}
		a.treeView.Refresh()

	case stylesLoadedMsg:
		msg.node.IsLoading = false
		msg.node.IsLoaded = true
		for _, style := range msg.styles {
			child := models.NewTreeNode(style.Name, models.NodeTypeStyle)
			child.Workspace = msg.node.Workspace
			msg.node.AddChild(child)
		}
		a.treeView.Refresh()

	case layerGroupsLoadedMsg:
		msg.node.IsLoading = false
		msg.node.IsLoaded = true
		for _, group := range msg.groups {
			child := models.NewTreeNode(group.Name, models.NodeTypeLayerGroup)
			child.Workspace = msg.node.Workspace
			msg.node.AddChild(child)
		}
		a.treeView.Refresh()

	case layersLoadedMsg:
		msg.node.IsLoading = false
		msg.node.IsLoaded = true
		for _, layer := range msg.layers {
			child := models.NewTreeNode(layer.Name, models.NodeTypeLayer)
			child.Workspace = msg.node.Workspace
			msg.node.AddChild(child)
		}
		a.treeView.Refresh()

	case connectionTestMsg:
		a.loading = false
		if msg.success {
			a.statusMsg = fmt.Sprintf("Connected to GeoServer %s", msg.version)
			a.errorMsg = ""
			return a, a.loadWorkspaces()
		} else {
			a.errorMsg = fmt.Sprintf("Connection failed: %v", msg.err)
			a.treeView.SetConnected(false, "")
		}

	case screens.ConnectionTestMsg:
		// Forward to connections screen and handle result
		var cmd tea.Cmd
		a.connectionsScreen, cmd = a.connectionsScreen.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		if msg.Success {
			// Update connection status
			if conn := a.config.GetActiveConnection(); conn != nil {
				a.client = api.NewClient(conn)
				a.treeView.SetConnected(true, conn.Name)
				cmds = append(cmds, a.loadWorkspaces())
			}
		}

	case uploadCompleteMsg:
		a.loading = false
		if msg.success {
			a.statusMsg = "Upload completed successfully"
			a.errorMsg = ""
			// Refresh the tree
			a.treeView.Clear()
			return a, a.loadWorkspaces()
		} else {
			a.errorMsg = fmt.Sprintf("Upload failed: %v", msg.err)
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

// loadWorkspaces loads workspaces from the server
func (a *App) loadWorkspaces() tea.Cmd {
	a.loading = true
	return func() tea.Msg {
		if a.client == nil {
			return errMsg{fmt.Errorf("not connected")}
		}

		workspaces, err := a.client.GetWorkspaces()
		if err != nil {
			return errMsg{err}
		}

		return workspacesLoadedMsg{workspaces}
	}
}

// buildWorkspaceTree builds the tree structure from workspaces
func (a *App) buildWorkspaceTree(workspaces []models.Workspace) {
	root := models.NewTreeNode("GeoServer", models.NodeTypeRoot)
	root.Expanded = true

	for _, ws := range workspaces {
		wsNode := models.NewTreeNode(ws.Name, models.NodeTypeWorkspace)
		wsNode.Workspace = ws.Name

		// Add category nodes
		dsNode := models.NewTreeNode("Data Stores", models.NodeTypeDataStores)
		dsNode.Workspace = ws.Name
		wsNode.AddChild(dsNode)

		csNode := models.NewTreeNode("Coverage Stores", models.NodeTypeCoverageStores)
		csNode.Workspace = ws.Name
		wsNode.AddChild(csNode)

		stylesNode := models.NewTreeNode("Styles", models.NodeTypeStyles)
		stylesNode.Workspace = ws.Name
		wsNode.AddChild(stylesNode)

		layersNode := models.NewTreeNode("Layers", models.NodeTypeLayers)
		layersNode.Workspace = ws.Name
		wsNode.AddChild(layersNode)

		lgNode := models.NewTreeNode("Layer Groups", models.NodeTypeLayerGroups)
		lgNode.Workspace = ws.Name
		wsNode.AddChild(lgNode)

		root.AddChild(wsNode)
	}

	a.treeView.SetRoot(root)
}

// loadNodeChildren loads children for a tree node
func (a *App) loadNodeChildren(node *models.TreeNode) tea.Cmd {
	if a.client == nil || node.IsLoaded || node.IsLoading {
		return nil
	}

	node.IsLoading = true

	switch node.Type {
	case models.NodeTypeDataStores:
		return func() tea.Msg {
			stores, err := a.client.GetDataStores(node.Workspace)
			if err != nil {
				node.IsLoading = false
				node.HasError = true
				node.ErrorMsg = err.Error()
				return errMsg{err}
			}
			return dataStoresLoadedMsg{node: node, stores: stores}
		}

	case models.NodeTypeCoverageStores:
		return func() tea.Msg {
			stores, err := a.client.GetCoverageStores(node.Workspace)
			if err != nil {
				node.IsLoading = false
				node.HasError = true
				node.ErrorMsg = err.Error()
				return errMsg{err}
			}
			return coverageStoresLoadedMsg{node: node, stores: stores}
		}

	case models.NodeTypeStyles:
		return func() tea.Msg {
			styles, err := a.client.GetStyles(node.Workspace)
			if err != nil {
				node.IsLoading = false
				node.HasError = true
				node.ErrorMsg = err.Error()
				return errMsg{err}
			}
			return stylesLoadedMsg{node: node, styles: styles}
		}

	case models.NodeTypeLayers:
		return func() tea.Msg {
			layers, err := a.client.GetLayers(node.Workspace)
			if err != nil {
				node.IsLoading = false
				node.HasError = true
				node.ErrorMsg = err.Error()
				return errMsg{err}
			}
			return layersLoadedMsg{node: node, layers: layers}
		}

	case models.NodeTypeLayerGroups:
		return func() tea.Msg {
			groups, err := a.client.GetLayerGroups(node.Workspace)
			if err != nil {
				node.IsLoading = false
				node.HasError = true
				node.ErrorMsg = err.Error()
				return errMsg{err}
			}
			return layerGroupsLoadedMsg{node: node, groups: groups}
		}
	}

	return nil
}

// handleUpload handles file upload
func (a *App) handleUpload() tea.Cmd {
	if a.client == nil {
		a.errorMsg = "Not connected to GeoServer"
		return nil
	}

	// Get selected files
	selectedFiles := a.fileBrowser.SelectedFiles()
	if len(selectedFiles) == 0 {
		// Use current file if none selected
		if file := a.fileBrowser.SelectedFile(); file != nil && !file.IsDir {
			selectedFiles = []models.LocalFile{*file}
		}
	}

	if len(selectedFiles) == 0 {
		a.errorMsg = "No files selected for upload"
		return nil
	}

	// Get target workspace from tree selection
	targetNode := a.treeView.SelectedNode()
	var workspace string
	if targetNode != nil {
		workspace = targetNode.Workspace
	}

	if workspace == "" {
		a.errorMsg = "Select a workspace in the GeoServer tree first"
		return nil
	}

	a.loading = true
	a.statusMsg = fmt.Sprintf("Uploading %d file(s)...", len(selectedFiles))

	return func() tea.Msg {
		for _, file := range selectedFiles {
			var err error
			storeName := strings.TrimSuffix(file.Name, filepath.Ext(file.Name))

			switch file.Type {
			case models.FileTypeShapefile:
				err = a.client.UploadShapefile(workspace, storeName, file.Path)
			case models.FileTypeGeoTIFF:
				err = a.client.UploadGeoTIFF(workspace, storeName, file.Path)
			case models.FileTypeGeoPackage:
				err = a.client.UploadGeoPackage(workspace, storeName, file.Path)
			case models.FileTypeSLD, models.FileTypeCSS:
				format := "sld"
				if file.Type == models.FileTypeCSS {
					format = "css"
				}
				err = a.client.UploadStyle(workspace, storeName, file.Path, format)
			default:
				err = fmt.Errorf("unsupported file type: %s", file.Type)
			}

			if err != nil {
				return uploadCompleteMsg{success: false, err: err}
			}
		}

		return uploadCompleteMsg{success: true}
	}
}
