package tui

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
)

// buildConnectionsTree builds the initial tree with all connections as root nodes
func (a *App) buildConnectionsTree() {
	root := models.NewTreeNode("Connections", models.NodeTypeRoot)
	root.Expanded = true

	for _, conn := range a.config.Connections {
		connNode := models.NewTreeNode(conn.Name, models.NodeTypeConnection)
		connNode.ConnectionID = conn.ID
		connNode.Expanded = false // Start collapsed, expand when user clicks
		root.AddChild(connNode)
	}

	a.treeView.SetRoot(root)
}

// addWorkspacesToConnection adds workspaces to a connection node
func (a *App) addWorkspacesToConnection(connNode *models.TreeNode, workspaces []models.Workspace) {
	for _, ws := range workspaces {
		wsNode := models.NewTreeNode(ws.Name, models.NodeTypeWorkspace)
		wsNode.Workspace = ws.Name
		wsNode.ConnectionID = connNode.ConnectionID

		// Add category nodes
		dsNode := models.NewTreeNode("Data Stores", models.NodeTypeDataStores)
		dsNode.Workspace = ws.Name
		dsNode.ConnectionID = connNode.ConnectionID
		wsNode.AddChild(dsNode)

		csNode := models.NewTreeNode("Coverage Stores", models.NodeTypeCoverageStores)
		csNode.Workspace = ws.Name
		csNode.ConnectionID = connNode.ConnectionID
		wsNode.AddChild(csNode)

		stylesNode := models.NewTreeNode("Styles", models.NodeTypeStyles)
		stylesNode.Workspace = ws.Name
		stylesNode.ConnectionID = connNode.ConnectionID
		wsNode.AddChild(stylesNode)

		layersNode := models.NewTreeNode("Layers", models.NodeTypeLayers)
		layersNode.Workspace = ws.Name
		layersNode.ConnectionID = connNode.ConnectionID
		wsNode.AddChild(layersNode)

		lgNode := models.NewTreeNode("Layer Groups", models.NodeTypeLayerGroups)
		lgNode.Workspace = ws.Name
		lgNode.ConnectionID = connNode.ConnectionID
		wsNode.AddChild(lgNode)

		connNode.AddChild(wsNode)
	}
}

// getClientForNode returns the API client for a node based on its ConnectionID
func (a *App) getClientForNode(node *models.TreeNode) *api.Client {
	if node == nil {
		return nil
	}
	// Find the ConnectionID by traversing up to find a connection node
	connID := node.ConnectionID
	if connID == "" {
		// Traverse up to find connection
		current := node
		for current != nil {
			if current.Type == models.NodeTypeConnection {
				connID = current.ConnectionID
				break
			}
			current = current.Parent
		}
	}
	if connID == "" {
		return nil
	}
	return a.clients[connID]
}

// getConnectionForNode returns the connection config for a node
func (a *App) getConnectionForNode(node *models.TreeNode) *config.Connection {
	if node == nil {
		return nil
	}
	connID := node.ConnectionID
	if connID == "" {
		current := node
		for current != nil {
			if current.Type == models.NodeTypeConnection {
				connID = current.ConnectionID
				break
			}
			current = current.Parent
		}
	}
	if connID == "" {
		return nil
	}
	for i := range a.config.Connections {
		if a.config.Connections[i].ID == connID {
			return &a.config.Connections[i]
		}
	}
	return nil
}

// loadNodeChildren loads children for a tree node
func (a *App) loadNodeChildren(node *models.TreeNode) tea.Cmd {
	if node.IsLoaded || node.IsLoading {
		return nil
	}

	client := a.getClientForNode(node)
	if client == nil && node.Type != models.NodeTypeConnection {
		return nil
	}

	node.IsLoading = true

	switch node.Type {
	case models.NodeTypeConnection:
		// Load workspaces for this connection
		connClient := a.clients[node.ConnectionID]
		if connClient == nil {
			node.IsLoading = false
			node.HasError = true
			node.ErrorMsg = "No client for connection"
			return nil
		}
		return func() tea.Msg {
			workspaces, err := connClient.GetWorkspaces()
			if err != nil {
				return connectionWorkspacesLoadedMsg{node: node, workspaces: nil, err: err}
			}
			return connectionWorkspacesLoadedMsg{node: node, workspaces: workspaces, err: nil}
		}

	case models.NodeTypeDataStores:
		return func() tea.Msg {
			stores, err := client.GetDataStores(node.Workspace)
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
			stores, err := client.GetCoverageStores(node.Workspace)
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
			styles, err := client.GetStyles(node.Workspace)
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
			layers, err := client.GetLayers(node.Workspace)
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
			groups, err := client.GetLayerGroups(node.Workspace)
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
