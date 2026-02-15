package tui

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/kartoza/kartoza-cloudbench/internal/api"
	"github.com/kartoza/kartoza-cloudbench/internal/config"
	"github.com/kartoza/kartoza-cloudbench/internal/models"
	"github.com/kartoza/kartoza-cloudbench/internal/postgres"
)

// buildConnectionsTree builds the unified tree with CloudBench root, GeoServer and PostgreSQL sections
func (a *App) buildConnectionsTree() {
	// Create the CloudBench root node
	root := models.NewTreeNode("Kartoza CloudBench", models.NodeTypeCloudBenchRoot)
	root.Expanded = true

	// Create GeoServer section
	geoserverNode := models.NewTreeNode("GeoServer", models.NodeTypeGeoServerRoot)
	geoserverNode.Expanded = true
	for _, conn := range a.config.Connections {
		connNode := models.NewTreeNode(conn.Name, models.NodeTypeConnection)
		connNode.ConnectionID = conn.ID
		connNode.Expanded = false // Start collapsed, expand when user clicks
		geoserverNode.AddChild(connNode)
	}
	root.AddChild(geoserverNode)

	// Create PostgreSQL section
	postgresNode := models.NewTreeNode("PostgreSQL", models.NodeTypePostgreSQLRoot)
	postgresNode.Expanded = true
	// Load PostgreSQL services from pg_service.conf
	a.loadPGServicesToTree(postgresNode)
	root.AddChild(postgresNode)

	a.treeView.SetRoot(root)
}

// loadPGServicesToTree loads PostgreSQL services from pg_service.conf into the tree
func (a *App) loadPGServicesToTree(postgresNode *models.TreeNode) {
	if !postgres.PGServiceFileExists() {
		return
	}

	services, err := postgres.ParsePGServiceFile()
	if err != nil {
		return
	}

	for _, svc := range services {
		svcNode := models.NewTreeNode(svc.Name, models.NodeTypePGService)
		svcNode.PGServiceName = svc.Name

		// Check if this service has been parsed (schema harvested)
		state := a.config.GetPGServiceState(svc.Name)
		if state != nil {
			svcNode.IsParsed = state.IsParsed
		}

		postgresNode.AddChild(svcNode)
	}
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

// focusUploadedResource navigates to and focuses on an uploaded store in the tree
func (a *App) focusUploadedResource(connectionID, workspace, storeName string) {
	root := a.treeView.GetRoot()
	if root == nil {
		return
	}

	// Find the connection node
	var connNode *models.TreeNode
	for _, child := range root.Children {
		if child.ConnectionID == connectionID {
			connNode = child
			break
		}
	}
	if connNode == nil {
		return
	}

	// Expand connection node
	connNode.Expanded = true

	// Find the workspace node
	var wsNode *models.TreeNode
	for _, child := range connNode.Children {
		if child.Type == models.NodeTypeWorkspace && child.Name == workspace {
			wsNode = child
			break
		}
	}
	if wsNode == nil {
		return
	}

	// Expand workspace node
	wsNode.Expanded = true

	// Find either Data Stores or Coverage Stores category
	var categoryNode *models.TreeNode
	var storeNode *models.TreeNode

	// Check Data Stores first
	for _, child := range wsNode.Children {
		if child.Type == models.NodeTypeDataStores {
			child.Expanded = true
			for _, store := range child.Children {
				if store.Name == storeName {
					categoryNode = child
					storeNode = store
					break
				}
			}
		}
		if storeNode != nil {
			break
		}
	}

	// If not found in Data Stores, check Coverage Stores
	if storeNode == nil {
		for _, child := range wsNode.Children {
			if child.Type == models.NodeTypeCoverageStores {
				child.Expanded = true
				for _, store := range child.Children {
					if store.Name == storeName {
						categoryNode = child
						storeNode = store
						break
					}
				}
			}
			if storeNode != nil {
				break
			}
		}
	}

	// If we found the store, expand it and select it
	if storeNode != nil {
		if categoryNode != nil {
			categoryNode.Expanded = true
		}
		storeNode.Expanded = true
		a.treeView.SelectNode(storeNode)
		a.statusMsg = "Uploaded: " + storeName
	}
}
