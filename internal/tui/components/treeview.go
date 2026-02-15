package components

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-cloudbench/internal/models"
	"github.com/kartoza/kartoza-cloudbench/internal/tui/styles"
)

// TreeViewKeyMap defines the key bindings for the tree view
type TreeViewKeyMap struct {
	Up         key.Binding
	Down       key.Binding
	Enter      key.Binding
	Back       key.Binding
	Expand     key.Binding
	Collapse   key.Binding
	Home       key.Binding
	End        key.Binding
	PageUp     key.Binding
	PageDown   key.Binding
	Refresh    key.Binding
	New        key.Binding
	Edit       key.Binding
	Delete     key.Binding
	Info       key.Binding
	Preview    key.Binding
	Publish    key.Binding
	Cache      key.Binding
	Settings   key.Binding
	Download   key.Binding
	VisualEdit key.Binding
	Terria     key.Binding
}

// DefaultTreeViewKeyMap returns the default key bindings
func DefaultTreeViewKeyMap() TreeViewKeyMap {
	return TreeViewKeyMap{
		Up: key.NewBinding(
			key.WithKeys("up", "k"),
			key.WithHelp("↑/k", "up"),
		),
		Down: key.NewBinding(
			key.WithKeys("down", "j"),
			key.WithHelp("↓/j", "down"),
		),
		Enter: key.NewBinding(
			key.WithKeys("enter", "l", "right"),
			key.WithHelp("enter/l", "expand"),
		),
		Back: key.NewBinding(
			key.WithKeys("backspace", "h", "left"),
			key.WithHelp("backspace/h", "collapse"),
		),
		Expand: key.NewBinding(
			key.WithKeys("+", "="),
			key.WithHelp("+", "expand"),
		),
		Collapse: key.NewBinding(
			key.WithKeys("-"),
			key.WithHelp("-", "collapse"),
		),
		Home: key.NewBinding(
			key.WithKeys("home", "g"),
			key.WithHelp("home/g", "first"),
		),
		End: key.NewBinding(
			key.WithKeys("end", "G"),
			key.WithHelp("end/G", "last"),
		),
		PageUp: key.NewBinding(
			key.WithKeys("pgup", "ctrl+u"),
			key.WithHelp("pgup", "page up"),
		),
		PageDown: key.NewBinding(
			key.WithKeys("pgdown", "ctrl+d"),
			key.WithHelp("pgdown", "page down"),
		),
		Refresh: key.NewBinding(
			key.WithKeys("r", "ctrl+r"),
			key.WithHelp("r", "refresh"),
		),
		New: key.NewBinding(
			key.WithKeys("n"),
			key.WithHelp("n", "new"),
		),
		Edit: key.NewBinding(
			key.WithKeys("e"),
			key.WithHelp("e", "edit"),
		),
		Delete: key.NewBinding(
			key.WithKeys("d", "delete"),
			key.WithHelp("d", "delete"),
		),
		Info: key.NewBinding(
			key.WithKeys("i"),
			key.WithHelp("i", "info"),
		),
		Preview: key.NewBinding(
			key.WithKeys("o"),
			key.WithHelp("o", "preview"),
		),
		Publish: key.NewBinding(
			key.WithKeys("p"),
			key.WithHelp("p", "publish"),
		),
		Cache: key.NewBinding(
			key.WithKeys("t"),
			key.WithHelp("t", "cache"),
		),
		Settings: key.NewBinding(
			key.WithKeys("s"),
			key.WithHelp("s", "settings"),
		),
		Download: key.NewBinding(
			key.WithKeys("w"),
			key.WithHelp("w", "download"),
		),
		VisualEdit: key.NewBinding(
			key.WithKeys("v"),
			key.WithHelp("v", "visual edit"),
		),
		Terria: key.NewBinding(
			key.WithKeys("T"),
			key.WithHelp("T", "terria 3D"),
		),
	}
}

// CRUD action messages
type (
	// TreeNewMsg is sent when user wants to create a new item
	TreeNewMsg struct {
		Node     *models.TreeNode
		NodeType models.NodeType
	}
	// TreeEditMsg is sent when user wants to edit an item
	TreeEditMsg struct {
		Node *models.TreeNode
	}
	// TreeDeleteMsg is sent when user wants to delete an item
	TreeDeleteMsg struct {
		Node *models.TreeNode
	}
	// TreeInfoMsg is sent when user wants to view info about an item
	TreeInfoMsg struct {
		Node *models.TreeNode
	}
	// TreePreviewMsg is sent when user wants to preview a layer
	TreePreviewMsg struct {
		Node *models.TreeNode
	}
	// TreePublishMsg is sent when user wants to publish a layer from a store
	TreePublishMsg struct {
		Node *models.TreeNode
	}
	// TreeCacheMsg is sent when user wants to manage tile cache for a layer
	TreeCacheMsg struct {
		Node *models.TreeNode
	}
	// TreeSettingsMsg is sent when user wants to edit service metadata/settings
	TreeSettingsMsg struct {
		Node *models.TreeNode
	}
	// TreeDownloadMsg is sent when user wants to download/export a resource
	TreeDownloadMsg struct {
		Node *models.TreeNode
	}
	// TreeVisualEditMsg is sent when user wants to open WYSIWYG style editor
	TreeVisualEditMsg struct {
		Node *models.TreeNode
	}
	// TreeTerriaMsg is sent when user wants to open in Terria 3D viewer
	TreeTerriaMsg struct {
		Node *models.TreeNode
	}
)

// FlatNode represents a flattened tree node for display
type FlatNode struct {
	Node   *models.TreeNode
	Depth  int
	IsLast bool
}

// TreeView is a component for displaying a tree structure
type TreeView struct {
	root       *models.TreeNode
	flatNodes  []FlatNode
	cursor     int
	offset     int
	width      int
	height     int
	active     bool
	keyMap     TreeViewKeyMap
	connected  bool
	serverName string
}

// NewTreeView creates a new tree view component
func NewTreeView() *TreeView {
	return &TreeView{
		root:   models.NewTreeNode("GeoServer", models.NodeTypeRoot),
		keyMap: DefaultTreeViewKeyMap(),
	}
}

// SetRoot sets the root node and flattens the tree
func (tv *TreeView) SetRoot(root *models.TreeNode) {
	tv.root = root
	tv.flattenTree()
}

// GetRoot returns the root node
func (tv *TreeView) GetRoot() *models.TreeNode {
	return tv.root
}

// flattenTree creates a flat list of visible nodes
func (tv *TreeView) flattenTree() {
	tv.flatNodes = []FlatNode{}
	tv.flattenNode(tv.root, 0, true)
}

func (tv *TreeView) flattenNode(node *models.TreeNode, depth int, isLast bool) {
	if node == nil {
		return
	}

	// Add all nodes including the root (connection name)
	tv.flatNodes = append(tv.flatNodes, FlatNode{
		Node:   node,
		Depth:  depth,
		IsLast: isLast,
	})

	if node.Expanded && len(node.Children) > 0 {
		for i, child := range node.Children {
			isLastChild := i == len(node.Children)-1
			tv.flattenNode(child, depth+1, isLastChild)
		}
	}
}

// Update handles messages for the tree view
func (tv *TreeView) Update(msg tea.Msg) (*TreeView, tea.Cmd) {
	if !tv.active {
		return tv, nil
	}

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, tv.keyMap.Up):
			if tv.cursor > 0 {
				tv.cursor--
				tv.ensureVisible()
			}

		case key.Matches(msg, tv.keyMap.Down):
			if tv.cursor < len(tv.flatNodes)-1 {
				tv.cursor++
				tv.ensureVisible()
			}

		case key.Matches(msg, tv.keyMap.Enter), key.Matches(msg, tv.keyMap.Expand):
			if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
				node := tv.flatNodes[tv.cursor].Node
				if len(node.Children) > 0 || tv.canLoadChildren(node) {
					node.Expanded = true
					tv.flattenTree()
				}
			}

		case key.Matches(msg, tv.keyMap.Back), key.Matches(msg, tv.keyMap.Collapse):
			if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
				node := tv.flatNodes[tv.cursor].Node
				if node.Expanded {
					node.Expanded = false
					tv.flattenTree()
				} else if node.Parent != nil && node.Parent.Type != models.NodeTypeRoot {
					// Move to parent
					for i, fn := range tv.flatNodes {
						if fn.Node == node.Parent {
							tv.cursor = i
							tv.ensureVisible()
							break
						}
					}
				}
			}

		case key.Matches(msg, tv.keyMap.Home):
			tv.cursor = 0
			tv.offset = 0

		case key.Matches(msg, tv.keyMap.End):
			tv.cursor = len(tv.flatNodes) - 1
			tv.ensureVisible()

		case key.Matches(msg, tv.keyMap.PageUp):
			tv.cursor -= tv.visibleHeight()
			if tv.cursor < 0 {
				tv.cursor = 0
			}
			tv.ensureVisible()

		case key.Matches(msg, tv.keyMap.PageDown):
			tv.cursor += tv.visibleHeight()
			if tv.cursor >= len(tv.flatNodes) {
				tv.cursor = len(tv.flatNodes) - 1
			}
			if tv.cursor < 0 {
				tv.cursor = 0
			}
			tv.ensureVisible()

		case key.Matches(msg, tv.keyMap.New):
			// Determine what type of item to create based on selection
			if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
				node := tv.flatNodes[tv.cursor].Node
				newType := tv.getNewItemType(node)
				if newType != models.NodeTypeRoot {
					return tv, func() tea.Msg {
						return TreeNewMsg{Node: node, NodeType: newType}
					}
				}
			} else if tv.connected {
				// No selection but connected - create workspace
				return tv, func() tea.Msg {
					return TreeNewMsg{Node: nil, NodeType: models.NodeTypeWorkspace}
				}
			}

		case key.Matches(msg, tv.keyMap.Edit):
			if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
				node := tv.flatNodes[tv.cursor].Node
				if tv.canEdit(node) {
					return tv, func() tea.Msg {
						return TreeEditMsg{Node: node}
					}
				}
			}

		case key.Matches(msg, tv.keyMap.Delete):
			if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
				node := tv.flatNodes[tv.cursor].Node
				if tv.canDelete(node) {
					return tv, func() tea.Msg {
						return TreeDeleteMsg{Node: node}
					}
				}
			}

		case key.Matches(msg, tv.keyMap.Info):
			if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
				node := tv.flatNodes[tv.cursor].Node
				return tv, func() tea.Msg {
					return TreeInfoMsg{Node: node}
				}
			}

		case key.Matches(msg, tv.keyMap.Preview):
			if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
				node := tv.flatNodes[tv.cursor].Node
				// Allow preview for layers, layer groups, data stores, and coverage stores
				switch node.Type {
				case models.NodeTypeLayer, models.NodeTypeLayerGroup,
					models.NodeTypeDataStore, models.NodeTypeCoverageStore:
					return tv, func() tea.Msg {
						return TreePreviewMsg{Node: node}
					}
				}
			}

		case key.Matches(msg, tv.keyMap.Publish):
			if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
				node := tv.flatNodes[tv.cursor].Node
				// Allow publish for data stores and coverage stores (publishes a layer from the store)
				switch node.Type {
				case models.NodeTypeDataStore, models.NodeTypeCoverageStore:
					return tv, func() tea.Msg {
						return TreePublishMsg{Node: node}
					}
				}
			}

		case key.Matches(msg, tv.keyMap.Cache):
			if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
				node := tv.flatNodes[tv.cursor].Node
				// Allow cache management for layers and layer groups
				switch node.Type {
				case models.NodeTypeLayer, models.NodeTypeLayerGroup:
					return tv, func() tea.Msg {
						return TreeCacheMsg{Node: node}
					}
				}
			}

		case key.Matches(msg, tv.keyMap.Settings):
			if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
				node := tv.flatNodes[tv.cursor].Node
				// Allow settings editing for connection nodes
				if node.Type == models.NodeTypeConnection {
					return tv, func() tea.Msg {
						return TreeSettingsMsg{Node: node}
					}
				}
			}

		case key.Matches(msg, tv.keyMap.Download):
			if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
				node := tv.flatNodes[tv.cursor].Node
				// Allow download for workspaces, stores, layers, styles, and layer groups
				switch node.Type {
				case models.NodeTypeWorkspace, models.NodeTypeDataStore, models.NodeTypeCoverageStore,
					models.NodeTypeLayer, models.NodeTypeStyle, models.NodeTypeLayerGroup:
					return tv, func() tea.Msg {
						return TreeDownloadMsg{Node: node}
					}
				}
			}

		case key.Matches(msg, tv.keyMap.VisualEdit):
			if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
				node := tv.flatNodes[tv.cursor].Node
				// Allow visual edit only for styles
				if node.Type == models.NodeTypeStyle {
					return tv, func() tea.Msg {
						return TreeVisualEditMsg{Node: node}
					}
				}
			}

		case key.Matches(msg, tv.keyMap.Terria):
			if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
				node := tv.flatNodes[tv.cursor].Node
				// Allow Terria export for workspaces, layers, and layer groups
				switch node.Type {
				case models.NodeTypeWorkspace, models.NodeTypeLayer, models.NodeTypeLayerGroup, models.NodeTypeConnection:
					return tv, func() tea.Msg {
						return TreeTerriaMsg{Node: node}
					}
				}
			}
		}
	}

	return tv, nil
}

// getNewItemType determines what type of item to create based on the selected node
func (tv *TreeView) getNewItemType(node *models.TreeNode) models.NodeType {
	if node == nil {
		return models.NodeTypeWorkspace
	}

	switch node.Type {
	case models.NodeTypeRoot, models.NodeTypeCloudBenchRoot:
		return models.NodeTypeRoot // Not a valid new target at root level
	case models.NodeTypeGeoServerRoot:
		return models.NodeTypeConnection // Create new GeoServer connection
	case models.NodeTypePostgreSQLRoot:
		return models.NodeTypePGService // Create new PostgreSQL service
	case models.NodeTypeConnection:
		return models.NodeTypeWorkspace // Create workspace under connection
	case models.NodeTypePGService:
		return models.NodeTypePGService // Create sibling PG service
	case models.NodeTypeWorkspace:
		return models.NodeTypeWorkspace // Create sibling workspace
	case models.NodeTypeDataStores:
		return models.NodeTypeDataStore
	case models.NodeTypeCoverageStores:
		return models.NodeTypeCoverageStore
	case models.NodeTypeStyles:
		return models.NodeTypeStyle
	case models.NodeTypeLayers:
		return models.NodeTypeLayer
	case models.NodeTypeLayerGroups:
		return models.NodeTypeLayerGroup
	case models.NodeTypeDataStore:
		return models.NodeTypeDataStore // Create sibling
	case models.NodeTypeCoverageStore:
		return models.NodeTypeCoverageStore // Create sibling
	case models.NodeTypeStyle:
		return models.NodeTypeStyle // Create sibling
	case models.NodeTypeLayerGroup:
		return models.NodeTypeLayerGroup // Create sibling
	default:
		return models.NodeTypeRoot // Not a valid new target
	}
}

// canEdit returns true if the node can be edited
func (tv *TreeView) canEdit(node *models.TreeNode) bool {
	switch node.Type {
	case models.NodeTypeWorkspace, models.NodeTypeDataStore, models.NodeTypeCoverageStore,
		models.NodeTypeLayer, models.NodeTypeStyle, models.NodeTypeLayerGroup:
		return true
	default:
		return false
	}
}

// canDelete returns true if the node can be deleted
func (tv *TreeView) canDelete(node *models.TreeNode) bool {
	switch node.Type {
	case models.NodeTypeWorkspace, models.NodeTypeDataStore, models.NodeTypeCoverageStore,
		models.NodeTypeLayer, models.NodeTypeStyle, models.NodeTypeLayerGroup:
		return true
	default:
		return false
	}
}

// canLoadChildren returns true if the node type can have children loaded dynamically
func (tv *TreeView) canLoadChildren(node *models.TreeNode) bool {
	switch node.Type {
	case models.NodeTypeCloudBenchRoot, models.NodeTypeGeoServerRoot, models.NodeTypePostgreSQLRoot,
		models.NodeTypeConnection, models.NodeTypeWorkspace, models.NodeTypeDataStores, models.NodeTypeCoverageStores,
		models.NodeTypeDataStore, models.NodeTypeCoverageStore, models.NodeTypeLayers,
		models.NodeTypeStyles, models.NodeTypeLayerGroups,
		models.NodeTypePGService, models.NodeTypePGSchema:
		return true
	default:
		return false
	}
}

// visibleHeight returns the number of visible items
func (tv *TreeView) visibleHeight() int {
	return tv.height - 4 // Account for borders and header
}

// ensureVisible ensures the cursor is visible
func (tv *TreeView) ensureVisible() {
	visible := tv.visibleHeight()
	if visible <= 0 {
		return
	}

	if tv.cursor < tv.offset {
		tv.offset = tv.cursor
	} else if tv.cursor >= tv.offset+visible {
		tv.offset = tv.cursor - visible + 1
	}
}

// View renders the tree view
func (tv *TreeView) View() string {
	var b strings.Builder

	// Header
	headerStyle := styles.PanelHeaderStyle
	if !tv.active {
		headerStyle = headerStyle.Foreground(styles.Muted)
	}

	var header string
	if tv.connected {
		header = styles.ConnectedStyle.Render("\uf111") + " " + tv.serverName // fa-circle (filled)
	} else {
		header = styles.DisconnectedStyle.Render("\uf10c") + " Not connected" // fa-circle-o (empty)
	}
	b.WriteString(headerStyle.Render(header))
	b.WriteString("\n")

	// Divider
	divider := styles.TreeBranchStyle.Render(strings.Repeat("─", tv.width-4))
	b.WriteString(divider)
	b.WriteString("\n")

	// Tree items
	visible := tv.visibleHeight()
	if visible <= 0 {
		visible = 10
	}

	if len(tv.flatNodes) == 0 {
		if tv.connected {
			b.WriteString(styles.LoadingStyle.Render("  Loading..."))
		} else {
			b.WriteString(styles.MutedStyle.Render("  Press 'c' to connect"))
		}
	} else {
		for i := tv.offset; i < tv.offset+visible && i < len(tv.flatNodes); i++ {
			fn := tv.flatNodes[i]
			line := tv.renderNode(fn, i == tv.cursor)
			b.WriteString(line)
			if i < tv.offset+visible-1 && i < len(tv.flatNodes)-1 {
				b.WriteString("\n")
			}
		}
	}

	// Fill remaining space
	rendered := strings.Count(b.String(), "\n") + 1
	for i := rendered; i < tv.height-2; i++ {
		b.WriteString("\n")
	}

	// Status line
	var status string
	if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
		node := tv.flatNodes[tv.cursor].Node
		status = fmt.Sprintf(" %s: %s", node.Type.String(), node.Name)
	} else {
		status = " "
	}
	b.WriteString("\n")
	b.WriteString(styles.StatusBarStyle.Width(tv.width-4).Render(status))

	// Build panel
	panelStyle := styles.PanelStyle
	if tv.active {
		panelStyle = styles.ActivePanelStyle
	}

	return panelStyle.Width(tv.width).Height(tv.height).Render(b.String())
}

// renderNode renders a single tree node
func (tv *TreeView) renderNode(fn FlatNode, selected bool) string {
	node := fn.Node

	// Build indent with tree lines
	var indent strings.Builder
	for i := 0; i < fn.Depth; i++ {
		indent.WriteString("  ")
	}

	// Expand/collapse indicator
	var indicator string
	if len(node.Children) > 0 || tv.canLoadChildren(node) {
		if node.Expanded {
			indicator = styles.ExpandedNodeStyle.Render("\uf078") // fa-chevron-down
		} else {
			indicator = styles.CollapsedNodeStyle.Render("\uf054") // fa-chevron-right
		}
	} else {
		indicator = " "
	}

	// Loading indicator
	if node.IsLoading {
		indicator = styles.LoadingStyle.Render("\uf110") // fa-spinner
	}

	// Error indicator
	if node.HasError {
		indicator = styles.ErrorStyle.Render("\uf00d") // fa-times
	}

	// Icon and name
	icon := node.Type.Icon()
	name := tv.truncateName(node.Name, tv.width-fn.Depth*2-20) // Reduced to make room for count

	// Count badge for nodes with children
	var countBadge string
	if len(node.Children) > 0 {
		// Show count for category nodes and containers
		switch node.Type {
		case models.NodeTypeConnection, models.NodeTypeWorkspace,
			models.NodeTypeDataStores, models.NodeTypeCoverageStores,
			models.NodeTypeLayers, models.NodeTypeStyles, models.NodeTypeLayerGroups:
			countBadge = styles.CountBadgeStyle.Render(fmt.Sprintf(" (%d)", len(node.Children)))
		}
	}

	// Enabled status indicator (only for layers and stores)
	var enabledIndicator string
	if node.Enabled != nil {
		if *node.Enabled {
			enabledIndicator = styles.SuccessStyle.Render(" \uf00c") // fa-check
		} else {
			enabledIndicator = styles.ErrorStyle.Render(" \uf00d") // fa-times
		}
	}

	line := fmt.Sprintf("%s%s %s %s%s%s", indent.String(), indicator, icon, name, countBadge, enabledIndicator)

	// Apply style
	var style lipgloss.Style
	if selected && tv.active {
		style = styles.ActiveItemStyle
	} else if selected {
		style = styles.SelectedItemStyle
	} else if node.HasError {
		style = styles.ErrorStyle
	} else {
		style = styles.ItemStyle
	}

	return style.Width(tv.width - 4).Render(line)
}

// truncateName truncates a name to fit the width
func (tv *TreeView) truncateName(name string, maxWidth int) string {
	if len(name) <= maxWidth {
		return name
	}
	if maxWidth <= 3 {
		return "..."
	}
	return name[:maxWidth-3] + "..."
}

// SetSize sets the size of the tree view
func (tv *TreeView) SetSize(width, height int) {
	tv.width = width
	tv.height = height
}

// SetActive sets whether the tree view is active
func (tv *TreeView) SetActive(active bool) {
	tv.active = active
}

// IsActive returns whether the tree view is active
func (tv *TreeView) IsActive() bool {
	return tv.active
}

// SetConnected sets the connection status
func (tv *TreeView) SetConnected(connected bool, serverName string) {
	tv.connected = connected
	tv.serverName = serverName
}

// IsConnected returns the connection status
func (tv *TreeView) IsConnected() bool {
	return tv.connected
}

// ServerName returns the connected server name
func (tv *TreeView) ServerName() string {
	return tv.serverName
}

// SelectedNode returns the currently selected node
func (tv *TreeView) SelectedNode() *models.TreeNode {
	if len(tv.flatNodes) == 0 || tv.cursor >= len(tv.flatNodes) {
		return nil
	}
	return tv.flatNodes[tv.cursor].Node
}

// Refresh rebuilds the flat node list
func (tv *TreeView) Refresh() {
	tv.flattenTree()
	// Ensure cursor is within bounds after refresh
	if tv.cursor >= len(tv.flatNodes) {
		if len(tv.flatNodes) > 0 {
			tv.cursor = len(tv.flatNodes) - 1
		} else {
			tv.cursor = 0
		}
	}
	tv.ensureVisible()
}

// ExpandSelected expands the selected node
func (tv *TreeView) ExpandSelected() {
	if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
		tv.flatNodes[tv.cursor].Node.Expanded = true
		tv.flattenTree()
	}
}

// CollapseSelected collapses the selected node
func (tv *TreeView) CollapseSelected() {
	if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
		tv.flatNodes[tv.cursor].Node.Expanded = false
		tv.flattenTree()
	}
}

// Clear clears the tree
func (tv *TreeView) Clear() {
	tv.root = models.NewTreeNode("GeoServer", models.NodeTypeRoot)
	tv.flatNodes = []FlatNode{}
	tv.cursor = 0
	tv.offset = 0
}

// TreeState holds the state of the tree for restoration
type TreeState struct {
	CursorPath     string   // Path of the currently selected node
	ExpandedPaths  []string // Paths of all expanded nodes
}

// SaveState saves the current tree state (cursor position and expanded nodes)
func (tv *TreeView) SaveState() TreeState {
	state := TreeState{
		ExpandedPaths: make([]string, 0),
	}

	// Save cursor position
	if len(tv.flatNodes) > 0 && tv.cursor < len(tv.flatNodes) {
		state.CursorPath = tv.flatNodes[tv.cursor].Node.Path()
	}

	// Save expanded nodes
	tv.collectExpandedPaths(tv.root, &state.ExpandedPaths)

	return state
}

// collectExpandedPaths recursively collects paths of expanded nodes
func (tv *TreeView) collectExpandedPaths(node *models.TreeNode, paths *[]string) {
	if node == nil {
		return
	}

	if node.Expanded && node.Type != models.NodeTypeRoot {
		*paths = append(*paths, node.Path())
	}

	for _, child := range node.Children {
		tv.collectExpandedPaths(child, paths)
	}
}

// RestoreState restores the tree state (expands nodes and sets cursor)
func (tv *TreeView) RestoreState(state TreeState) {
	// First expand all previously expanded nodes
	for _, path := range state.ExpandedPaths {
		tv.expandByPath(tv.root, path)
	}

	// Rebuild flat list after expanding
	tv.flattenTree()

	// Restore cursor position
	if state.CursorPath != "" {
		for i, fn := range tv.flatNodes {
			if fn.Node.Path() == state.CursorPath {
				tv.cursor = i
				tv.ensureVisible()
				return
			}
		}
	}

	// If exact path not found, try to find closest match (parent)
	if state.CursorPath != "" {
		bestMatch := -1
		bestMatchLen := 0
		for i, fn := range tv.flatNodes {
			nodePath := fn.Node.Path()
			if len(nodePath) <= len(state.CursorPath) &&
			   state.CursorPath[:len(nodePath)] == nodePath &&
			   len(nodePath) > bestMatchLen {
				bestMatch = i
				bestMatchLen = len(nodePath)
			}
		}
		if bestMatch >= 0 {
			tv.cursor = bestMatch
			tv.ensureVisible()
		}
	}
}

// expandByPath expands a node matching the given path
func (tv *TreeView) expandByPath(node *models.TreeNode, path string) bool {
	if node == nil {
		return false
	}

	nodePath := node.Path()
	if nodePath == path {
		node.Expanded = true
		return true
	}

	// Check if path starts with this node's path (it's a parent)
	if node.Type != models.NodeTypeRoot {
		if len(path) > len(nodePath) && path[:len(nodePath)] == nodePath {
			node.Expanded = true
		}
	}

	for _, child := range node.Children {
		if tv.expandByPath(child, path) {
			return true
		}
	}

	return false
}

// NavigateToPath expands the tree to show the given path and sets cursor on it
func (tv *TreeView) NavigateToPath(path string) {
	// First, expand all parent nodes to make the path visible
	tv.expandParentsForPath(tv.root, path)

	// Rebuild flat list after expanding
	tv.flattenTree()

	// Find and select the node with the matching path
	for i, fn := range tv.flatNodes {
		if fn.Node.Path() == path {
			tv.cursor = i
			tv.ensureVisible()
			return
		}
	}

	// If exact path not found, try to find the closest parent
	bestMatch := -1
	bestMatchLen := 0
	for i, fn := range tv.flatNodes {
		nodePath := fn.Node.Path()
		if len(nodePath) <= len(path) && strings.HasPrefix(path, nodePath) && len(nodePath) > bestMatchLen {
			bestMatch = i
			bestMatchLen = len(nodePath)
		}
	}
	if bestMatch >= 0 {
		tv.cursor = bestMatch
		tv.ensureVisible()
	}
}

// expandParentsForPath expands all parent nodes needed to show a path
func (tv *TreeView) expandParentsForPath(node *models.TreeNode, targetPath string) bool {
	if node == nil {
		return false
	}

	nodePath := node.Path()

	// If this is the target node, we're done
	if nodePath == targetPath {
		return true
	}

	// If target path starts with this node's path, expand this node and recurse
	if node.Type == models.NodeTypeRoot || strings.HasPrefix(targetPath, nodePath+"/") {
		for _, child := range node.Children {
			if tv.expandParentsForPath(child, targetPath) {
				node.Expanded = true
				return true
			}
		}
	}

	return false
}

// SelectNode selects the given node in the tree, expanding parents as needed
func (tv *TreeView) SelectNode(node *models.TreeNode) {
	if node == nil {
		return
	}

	// Expand all parent nodes first
	tv.expandParentsToNode(node)

	// Rebuild flat list after expanding
	tv.flattenTree()

	// Find and select the node
	for i, fn := range tv.flatNodes {
		if fn.Node == node {
			tv.cursor = i
			tv.ensureVisible()
			return
		}
	}
}

// expandParentsToNode expands all parents of the given node
func (tv *TreeView) expandParentsToNode(node *models.TreeNode) {
	if node == nil || node.Parent == nil {
		return
	}

	// Build list of parents from root to node
	var parents []*models.TreeNode
	current := node.Parent
	for current != nil {
		parents = append([]*models.TreeNode{current}, parents...)
		current = current.Parent
	}

	// Expand each parent
	for _, parent := range parents {
		parent.Expanded = true
	}
}
