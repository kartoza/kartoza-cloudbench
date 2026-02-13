package tui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/components"
)

// workspaceConfigLoadedMsg is sent when workspace config is loaded for editing
type workspaceConfigLoadedMsg struct {
	config *models.WorkspaceConfig
	err    error
}

// layerConfigLoadedMsg is sent when layer config is loaded for editing
type layerConfigLoadedMsg struct {
	config *models.LayerConfig
	err    error
}

// dataStoreConfigLoadedMsg is sent when data store config is loaded for editing
type dataStoreConfigLoadedMsg struct {
	config *models.DataStoreConfig
	err    error
}

// coverageStoreConfigLoadedMsg is sent when coverage store config is loaded for editing
type coverageStoreConfigLoadedMsg struct {
	config *models.CoverageStoreConfig
	err    error
}

// showCreateDialog shows a dialog to create a new item
func (a *App) showCreateDialog(contextNode *models.TreeNode, nodeType models.NodeType) tea.Cmd {
	client := a.getClientForNode(contextNode)
	if client == nil && contextNode != nil {
		a.errorMsg = "No connection for selected node"
		return nil
	}

	// Get workspace from context
	workspace := ""
	if contextNode != nil {
		workspace = contextNode.Workspace
	}

	switch nodeType {
	case models.NodeTypeWorkspace:
		// Use workspace wizard with service toggles
		a.workspaceWizard = components.NewWorkspaceWizard()
		a.workspaceWizard.SetSize(a.width, a.height)
		a.crudOperation = CRUDCreate
		a.crudNode = contextNode
		a.crudNodeType = nodeType

		a.workspaceWizard.SetCallbacks(
			func(result components.WorkspaceWizardResult) {
				if result.Confirmed {
					a.pendingCRUDCmd = a.executeWorkspaceCreate(result.Config)
				}
			},
			func() {},
		)
		return a.workspaceWizard.Init()

	case models.NodeTypeDataStore:
		// Use wizard for data store (needs type selection + configuration)
		if workspace == "" {
			a.errorMsg = "Select a workspace first"
			return nil
		}
		a.storeWizard = components.NewDataStoreWizard(workspace)
		a.storeWizard.SetSize(a.width, a.height)
		a.crudNode = contextNode

		a.storeWizard.SetCallbacks(
			func(result components.StoreWizardResult) {
				if result.Confirmed {
					a.pendingCRUDCmd = a.executeDataStoreCreate(workspace, result)
				}
			},
			func() {},
		)
		return a.storeWizard.Init()

	case models.NodeTypeCoverageStore:
		// Use wizard for coverage store
		if workspace == "" {
			a.errorMsg = "Select a workspace first"
			return nil
		}
		a.storeWizard = components.NewCoverageStoreWizard(workspace)
		a.storeWizard.SetSize(a.width, a.height)
		a.crudNode = contextNode

		a.storeWizard.SetCallbacks(
			func(result components.StoreWizardResult) {
				if result.Confirmed {
					a.pendingCRUDCmd = a.executeCoverageStoreCreate(workspace, result)
				}
			},
			func() {},
		)
		return a.storeWizard.Init()

	case models.NodeTypeStyle:
		// Show a selection dialog to choose editor type
		if workspace == "" {
			a.errorMsg = "Select a workspace first"
			return nil
		}
		a.crudNode = contextNode
		a.crudOperation = CRUDCreate
		a.crudNodeType = nodeType

		// Create selection dialog for editor type
		options := []components.SelectOption{
			{Value: "visual", Label: "Visual Editor (WYSIWYG)"},
			{Value: "code", Label: "Code Editor (SLD/CSS)"},
		}
		a.crudDialog = components.NewSelectDialog(
			"Create Style",
			"Choose how to create the style:",
			options,
		)
		a.crudDialog.SetSize(a.width, a.height)
		a.crudDialog.SetCallbacks(
			func(result components.DialogResult) {
				if result.Confirmed {
					if result.SelectedValue == "visual" {
						// Launch visual style editor
						a.pendingCRUDCmd = a.showVisualStyleEditorForCreate(workspace, contextNode)
					} else {
						// Launch code-based style wizard
						a.pendingCRUDCmd = a.showCodeStyleWizardForCreate(workspace, contextNode)
					}
				}
			},
			func() {},
		)
		return a.crudDialog.Init()

	case models.NodeTypeLayerGroup:
		// Use layer group wizard for creating layer groups
		if workspace == "" {
			a.errorMsg = "Select a workspace first"
			return nil
		}
		a.layerGroupWizard = components.NewLayerGroupWizard(workspace)
		a.layerGroupWizard.SetSize(a.width, a.height)
		a.crudNode = contextNode
		a.crudOperation = CRUDCreate
		a.crudNodeType = nodeType

		// Load available layers for selection
		return tea.Batch(
			a.layerGroupWizard.Init(),
			a.loadLayersForLayerGroupWizard(contextNode, workspace),
		)

	default:
		a.errorMsg = "Cannot create this type of item"
		return nil
	}
}

// showEditDialog shows a dialog to edit an item
func (a *App) showEditDialog(node *models.TreeNode) tea.Cmd {
	if a.getClientForNode(node) == nil {
		a.errorMsg = "No connection for selected node"
		return nil
	}

	switch node.Type {
	case models.NodeTypeWorkspace:
		// For workspaces, fetch config and show workspace wizard
		a.crudOperation = CRUDEdit
		a.crudNode = node
		a.crudNodeType = node.Type
		a.loading = true
		return a.loadWorkspaceConfigAndShowWizard(node.Name)

	case models.NodeTypeDataStore:
		// For data stores, fetch config and show resource wizard
		a.crudOperation = CRUDEdit
		a.crudNode = node
		a.crudNodeType = node.Type
		a.loading = true
		return a.loadDataStoreConfigAndShowWizard(node.Workspace, node.Name)

	case models.NodeTypeCoverageStore:
		// For coverage stores, fetch config and show resource wizard
		a.crudOperation = CRUDEdit
		a.crudNode = node
		a.crudNodeType = node.Type
		a.loading = true
		return a.loadCoverageStoreConfigAndShowWizard(node.Workspace, node.Name)

	case models.NodeTypeLayer:
		// For layers, fetch config and show resource wizard
		a.crudOperation = CRUDEdit
		a.crudNode = node
		a.crudNodeType = node.Type
		a.loading = true
		return a.loadLayerConfigAndShowWizard(node.Workspace, node.Name)

	case models.NodeTypeStyle:
		// For styles, fetch content and show style wizard
		a.crudOperation = CRUDEdit
		a.crudNode = node
		a.crudNodeType = node.Type
		a.loading = true
		return a.loadStyleContentAndShowWizard(node.Workspace, node.Name)

	case models.NodeTypeLayerGroup:
		// For layer groups, fetch details and show layer group wizard
		if node.Workspace == "" {
			a.errorMsg = "Layer group has no workspace set"
			return nil
		}
		a.crudOperation = CRUDEdit
		a.crudNode = node
		a.crudNodeType = node.Type
		a.loading = true
		return a.loadLayerGroupDetailsAndShowWizard(node.Workspace, node.Name)

	default:
		a.errorMsg = "Cannot edit this type of item"
		return nil
	}
}

// loadWorkspaceConfigAndShowWizard loads workspace config and shows the edit wizard
func (a *App) loadWorkspaceConfigAndShowWizard(workspaceName string) tea.Cmd {
	client := a.getClientForNode(a.crudNode)
	return func() tea.Msg {
		if client == nil {
			return workspaceConfigLoadedMsg{config: nil, err: fmt.Errorf("no client for node")}
		}
		config, err := client.GetWorkspaceConfig(workspaceName)
		return workspaceConfigLoadedMsg{config: config, err: err}
	}
}

// loadLayerConfigAndShowWizard loads layer config and shows the edit wizard
func (a *App) loadLayerConfigAndShowWizard(workspace, layerName string) tea.Cmd {
	client := a.getClientForNode(a.crudNode)
	return func() tea.Msg {
		if client == nil {
			return layerConfigLoadedMsg{config: nil, err: fmt.Errorf("no client for node")}
		}
		config, err := client.GetLayerConfig(workspace, layerName)
		return layerConfigLoadedMsg{config: config, err: err}
	}
}

// loadDataStoreConfigAndShowWizard loads data store config and shows the edit wizard
func (a *App) loadDataStoreConfigAndShowWizard(workspace, storeName string) tea.Cmd {
	client := a.getClientForNode(a.crudNode)
	return func() tea.Msg {
		if client == nil {
			return dataStoreConfigLoadedMsg{config: nil, err: fmt.Errorf("no client for node")}
		}
		config, err := client.GetDataStoreConfig(workspace, storeName)
		return dataStoreConfigLoadedMsg{config: config, err: err}
	}
}

// loadCoverageStoreConfigAndShowWizard loads coverage store config and shows the edit wizard
func (a *App) loadCoverageStoreConfigAndShowWizard(workspace, storeName string) tea.Cmd {
	client := a.getClientForNode(a.crudNode)
	return func() tea.Msg {
		if client == nil {
			return coverageStoreConfigLoadedMsg{config: nil, err: fmt.Errorf("no client for node")}
		}
		config, err := client.GetCoverageStoreConfig(workspace, storeName)
		return coverageStoreConfigLoadedMsg{config: config, err: err}
	}
}

// showDeleteDialog shows a confirmation dialog to delete an item
func (a *App) showDeleteDialog(node *models.TreeNode) tea.Cmd {
	if a.getClientForNode(node) == nil {
		a.errorMsg = "No connection for selected node"
		return nil
	}

	message := fmt.Sprintf("Are you sure you want to delete %s '%s'?\nThis action cannot be undone.",
		node.Type.String(), node.Name)

	a.crudDialog = components.NewConfirmDialog("Delete "+node.Type.String(), message)
	a.crudDialog.SetSize(a.width, a.height)
	a.crudOperation = CRUDDelete
	a.crudNode = node
	a.crudNodeType = node.Type

	// Set callbacks
	a.crudDialog.SetCallbacks(
		func(result components.DialogResult) {
			if result.Confirmed {
				a.pendingCRUDCmd = a.executeCRUDDelete()
			}
		},
		func() {
			// Cancel - dialog will close automatically
		},
	)

	return a.crudDialog.Init()
}

// executeCRUDCreate executes the create operation for workspaces (legacy - kept for compatibility)
func (a *App) executeCRUDCreate(values map[string]string) tea.Cmd {
	name := strings.TrimSpace(values["name"])
	if name == "" {
		a.errorMsg = "Name is required"
		return nil
	}

	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	// Set path to navigate to after creation (workspace name is the path)
	a.newlyCreatedPath = name

	a.loading = true
	return func() tea.Msg {
		operation := "Create workspace"
		err := client.CreateWorkspace(name)
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// executeWorkspaceCreate executes workspace creation with full config
func (a *App) executeWorkspaceCreate(config models.WorkspaceConfig) tea.Cmd {
	if config.Name == "" {
		a.errorMsg = "Name is required"
		return nil
	}

	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	// Set path to navigate to after creation (workspace name is the path)
	a.newlyCreatedPath = config.Name

	a.loading = true
	return func() tea.Msg {
		operation := "Create workspace"
		err := client.CreateWorkspaceWithConfig(config)
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// executeWorkspaceEdit executes workspace update with full config
func (a *App) executeWorkspaceEdit(oldName string, config models.WorkspaceConfig) tea.Cmd {
	if config.Name == "" {
		a.errorMsg = "Name is required"
		return nil
	}

	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	// Set path to navigate to after update
	a.newlyCreatedPath = config.Name

	a.loading = true
	return func() tea.Msg {
		operation := "Update workspace"
		err := client.UpdateWorkspaceWithConfig(oldName, config)
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// executeLayerEdit executes layer update with full config
func (a *App) executeLayerEdit(config models.LayerConfig) tea.Cmd {
	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	a.loading = true
	return func() tea.Msg {
		operation := "Update layer"
		err := client.UpdateLayerConfig(config.Workspace, config)
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// executeDataStoreEdit executes data store update with full config
func (a *App) executeDataStoreEdit(config models.DataStoreConfig) tea.Cmd {
	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	a.loading = true
	return func() tea.Msg {
		operation := "Update data store"
		err := client.UpdateDataStoreConfig(config.Workspace, config)
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// executeCoverageStoreEdit executes coverage store update with full config
func (a *App) executeCoverageStoreEdit(config models.CoverageStoreConfig) tea.Cmd {
	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	a.loading = true
	return func() tea.Msg {
		operation := "Update coverage store"
		err := client.UpdateCoverageStoreConfig(config.Workspace, config)
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// executeDataStoreCreate executes the data store creation
func (a *App) executeDataStoreCreate(workspace string, result components.StoreWizardResult) tea.Cmd {
	name := strings.TrimSpace(result.Values["name"])
	if name == "" {
		a.errorMsg = "Store name is required"
		return nil
	}

	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	// Set path to navigate to after creation (workspace/Data Stores/storename)
	a.newlyCreatedPath = workspace + "/Data Stores/" + name

	a.loading = true
	return func() tea.Msg {
		operation := fmt.Sprintf("Create data store '%s'", name)
		err := client.CreateDataStore(workspace, name, result.DataStoreType, result.Values)
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// executeCoverageStoreCreate executes the coverage store creation
func (a *App) executeCoverageStoreCreate(workspace string, result components.StoreWizardResult) tea.Cmd {
	name := strings.TrimSpace(result.Values["name"])
	if name == "" {
		a.errorMsg = "Store name is required"
		return nil
	}

	url := result.Values["url"]
	if url == "" {
		a.errorMsg = "File path is required"
		return nil
	}

	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	// Set path to navigate to after creation (workspace/Coverage Stores/storename)
	a.newlyCreatedPath = workspace + "/Coverage Stores/" + name

	a.loading = true
	return func() tea.Msg {
		operation := fmt.Sprintf("Create coverage store '%s'", name)
		err := client.CreateCoverageStore(workspace, name, result.CoverageStoreType, url)
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// executeCRUDEdit executes the edit operation
func (a *App) executeCRUDEdit(values map[string]string) tea.Cmd {
	newName := strings.TrimSpace(values["name"])
	if newName == "" {
		a.errorMsg = "Name is required"
		return nil
	}

	if a.crudNode == nil {
		a.errorMsg = "No item selected"
		return nil
	}

	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	oldName := a.crudNode.Name
	if newName == oldName {
		return nil // No change
	}

	workspace := a.crudNode.Workspace
	nodeType := a.crudNodeType

	// Set path to navigate to after rename (the renamed item)
	switch nodeType {
	case models.NodeTypeWorkspace:
		a.newlyCreatedPath = newName
	case models.NodeTypeDataStore:
		a.newlyCreatedPath = workspace + "/Data Stores/" + newName
	case models.NodeTypeCoverageStore:
		a.newlyCreatedPath = workspace + "/Coverage Stores/" + newName
	}

	a.loading = true
	return func() tea.Msg {
		var err error
		var operation string

		switch nodeType {
		case models.NodeTypeWorkspace:
			operation = "Rename workspace"
			err = client.UpdateWorkspace(oldName, newName)

		case models.NodeTypeDataStore:
			operation = "Rename data store"
			err = client.UpdateDataStore(workspace, oldName, newName)

		case models.NodeTypeCoverageStore:
			operation = "Rename coverage store"
			err = client.UpdateCoverageStore(workspace, oldName, newName)
		}

		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// executeCRUDDelete executes the delete operation
func (a *App) executeCRUDDelete() tea.Cmd {
	if a.crudNode == nil {
		a.errorMsg = "No item selected"
		return nil
	}

	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	// Navigate to parent after deletion
	if a.crudNode.Parent != nil && a.crudNode.Parent.Type != models.NodeTypeRoot {
		a.newlyCreatedPath = a.crudNode.Parent.Path()
	} else {
		// If deleting a workspace, just save current state
		a.savedTreeState = a.treeView.SaveState()
	}

	nodeName := a.crudNode.Name
	workspace := a.crudNode.Workspace
	nodeType := a.crudNodeType

	a.loading = true
	return func() tea.Msg {
		var err error
		var operation string

		switch nodeType {
		case models.NodeTypeWorkspace:
			operation = "Delete workspace"
			err = client.DeleteWorkspace(nodeName, true)

		case models.NodeTypeDataStore:
			operation = "Delete data store"
			// Use cleanup method to also remove GWC caches
			err = client.DeleteDataStoreWithCleanup(workspace, nodeName, true)

		case models.NodeTypeCoverageStore:
			operation = "Delete coverage store"
			// Use cleanup method to also remove GWC caches
			err = client.DeleteCoverageStoreWithCleanup(workspace, nodeName, true)

		case models.NodeTypeLayer:
			operation = "Delete layer"
			// Use cleanup method to also remove GWC cache
			err = client.DeleteLayerWithCleanup(workspace, nodeName)

		case models.NodeTypeStyle:
			operation = "Delete style"
			err = client.DeleteStyle(workspace, nodeName, true)

		case models.NodeTypeLayerGroup:
			operation = "Delete layer group"
			err = client.DeleteLayerGroup(workspace, nodeName)
		}

		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// styleContentLoadedMsg is sent when style content is loaded for editing
type styleContentLoadedMsg struct {
	name    string
	content string
	format  string
	err     error
}

// loadStyleContentAndShowWizard loads style content and shows the edit wizard
func (a *App) loadStyleContentAndShowWizard(workspace, styleName string) tea.Cmd {
	client := a.getClientForNode(a.crudNode)
	return func() tea.Msg {
		if client == nil {
			return styleContentLoadedMsg{err: fmt.Errorf("no client for node")}
		}

		// First get style info to determine format
		styles, err := client.GetStyles(workspace)
		if err != nil {
			return styleContentLoadedMsg{err: err}
		}

		format := "sld" // Default
		for _, style := range styles {
			if style.Name == styleName {
				if style.Format != "" {
					format = style.Format
				}
				break
			}
		}

		// Get the content
		content, err := client.GetStyleContent(workspace, styleName, format)
		if err != nil {
			return styleContentLoadedMsg{err: err}
		}

		return styleContentLoadedMsg{
			name:    styleName,
			content: content,
			format:  format,
			err:     nil,
		}
	}
}

// executeStyleCreate executes the style creation
func (a *App) executeStyleCreate(workspace string, result components.StyleWizardResult) tea.Cmd {
	name := strings.TrimSpace(result.Name)
	if name == "" {
		a.errorMsg = "Style name is required"
		return nil
	}

	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	// Set path to navigate to after creation
	a.newlyCreatedPath = workspace + "/Styles/" + name

	a.loading = true
	return func() tea.Msg {
		operation := fmt.Sprintf("Create style '%s'", name)
		err := client.CreateStyle(workspace, name, result.Content, result.Format.String())
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// executeStyleEdit executes the style update
func (a *App) executeStyleEdit(workspace, styleName string, result components.StyleWizardResult) tea.Cmd {
	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	a.loading = true
	return func() tea.Msg {
		operation := fmt.Sprintf("Update style '%s'", styleName)
		err := client.UpdateStyleContent(workspace, styleName, result.Content, result.Format.String())
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// layerGroupDetailsLoadedMsg is sent when layer group details are loaded for editing
type layerGroupDetailsLoadedMsg struct {
	details     *models.LayerGroupDetails
	layers      []models.Layer          // Available layers in workspace
	layerStyles map[string][]string     // layer name -> available styles
	err         error
}

// layersForLayerGroupLoadedMsg is sent when layers are loaded for the layer group wizard
type layersForLayerGroupLoadedMsg struct {
	layers      []models.Layer
	layerStyles map[string][]string // layer name -> available styles
	err         error
}

// loadLayersForLayerGroupWizard loads available layers for the layer group wizard
func (a *App) loadLayersForLayerGroupWizard(contextNode *models.TreeNode, workspace string) tea.Cmd {
	client := a.getClientForNode(contextNode)
	return func() tea.Msg {
		if client == nil {
			return layersForLayerGroupLoadedMsg{err: fmt.Errorf("no client for node")}
		}
		layers, err := client.GetLayers(workspace)
		if err != nil {
			return layersForLayerGroupLoadedMsg{err: err}
		}

		// Fetch styles for each layer
		layerStyles := make(map[string][]string)
		for _, layer := range layers {
			layerKey := workspace + ":" + layer.Name
			styles, err := client.GetLayerStyles(workspace, layer.Name)
			if err == nil {
				allStyles := []string{}
				if styles.DefaultStyle != "" {
					allStyles = append(allStyles, styles.DefaultStyle)
				}
				allStyles = append(allStyles, styles.AdditionalStyles...)
				layerStyles[layerKey] = allStyles
			}
		}

		return layersForLayerGroupLoadedMsg{layers: layers, layerStyles: layerStyles, err: nil}
	}
}

// loadLayerGroupDetailsAndShowWizard loads layer group details and shows the edit wizard
func (a *App) loadLayerGroupDetailsAndShowWizard(workspace, groupName string) tea.Cmd {
	client := a.getClientForNode(a.crudNode)
	return func() tea.Msg {
		if client == nil {
			return layerGroupDetailsLoadedMsg{err: fmt.Errorf("no client for node")}
		}

		// Get layer group details
		details, err := client.GetLayerGroup(workspace, groupName)
		if err != nil {
			return layerGroupDetailsLoadedMsg{err: err}
		}

		// Also get available layers
		layers, err := client.GetLayers(workspace)
		if err != nil {
			return layerGroupDetailsLoadedMsg{details: details, err: err}
		}

		// Fetch styles for each layer
		layerStyles := make(map[string][]string)
		for _, layer := range layers {
			layerKey := workspace + ":" + layer.Name
			styles, err := client.GetLayerStyles(workspace, layer.Name)
			if err == nil {
				allStyles := []string{}
				if styles.DefaultStyle != "" {
					allStyles = append(allStyles, styles.DefaultStyle)
				}
				allStyles = append(allStyles, styles.AdditionalStyles...)
				layerStyles[layerKey] = allStyles
			}
		}

		return layerGroupDetailsLoadedMsg{
			details:     details,
			layers:      layers,
			layerStyles: layerStyles,
			err:         nil,
		}
	}
}

// executeLayerGroupCreate executes the layer group creation
func (a *App) executeLayerGroupCreate(workspace string, result components.LayerGroupWizardResult) tea.Cmd {
	name := strings.TrimSpace(result.Name)
	if name == "" {
		a.errorMsg = "Layer group name is required"
		return nil
	}

	if len(result.Layers) == 0 {
		a.errorMsg = "At least one layer must be selected"
		return nil
	}

	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	// Set path to navigate to after creation
	a.newlyCreatedPath = workspace + "/Layer Groups/" + name

	// Convert layer style assignments to models format
	layerStyles := make([]models.LayerStyleAssignment, len(result.LayerStyles))
	for i, ls := range result.LayerStyles {
		layerStyles[i] = models.LayerStyleAssignment{
			LayerName: ls.LayerName,
			StyleName: ls.StyleName,
		}
	}

	config := models.LayerGroupCreate{
		Name:        name,
		Title:       result.Title,
		Mode:        result.Mode,
		Layers:      result.Layers,
		LayerStyles: layerStyles,
	}

	a.loading = true
	return func() tea.Msg {
		operation := fmt.Sprintf("Create layer group '%s'", name)
		err := client.CreateLayerGroup(workspace, config)
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// executeLayerGroupEdit executes the layer group update
func (a *App) executeLayerGroupEdit(workspace, groupName string, result components.LayerGroupWizardResult) tea.Cmd {
	if len(result.Layers) == 0 {
		a.errorMsg = "At least one layer must be selected"
		return nil
	}

	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	// Convert layer style assignments to models format
	layerStyles := make([]models.LayerStyleAssignment, len(result.LayerStyles))
	for i, ls := range result.LayerStyles {
		layerStyles[i] = models.LayerStyleAssignment{
			LayerName: ls.LayerName,
			StyleName: ls.StyleName,
		}
	}

	update := models.LayerGroupUpdate{
		Title:       result.Title,
		Mode:        result.Mode,
		Layers:      result.Layers,
		LayerStyles: layerStyles,
		Enabled:     true,
	}

	a.loading = true
	return func() tea.Msg {
		operation := fmt.Sprintf("Update layer group '%s'", groupName)
		err := client.UpdateLayerGroup(workspace, groupName, update)
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// showVisualStyleEditor opens the WYSIWYG style editor for a style
func (a *App) showVisualStyleEditor(node *models.TreeNode) tea.Cmd {
	if node == nil || node.Type != models.NodeTypeStyle {
		a.errorMsg = "Please select a style to edit visually"
		return nil
	}

	// Find the connection for this node
	var conn *config.Connection
	for i := range a.config.Connections {
		if a.config.Connections[i].ID == node.ConnectionID {
			conn = &a.config.Connections[i]
			break
		}
	}

	if conn == nil {
		a.errorMsg = "No connection found for this style"
		return nil
	}

	workspace := node.Workspace

	// For the style editor to work, we need a layer to preview.
	// Try to find the first available layer in the same workspace
	client := a.clients[conn.ID]
	if client == nil {
		a.errorMsg = "No client for this connection"
		return nil
	}

	// Get layers in the workspace to use for preview
	layers, err := client.GetLayers(workspace)
	if err != nil || len(layers) == 0 {
		a.errorMsg = "No layers found in workspace for preview. Please add a layer first."
		return nil
	}

	// Use the first layer for preview
	previewLayer := layers[0].Name

	// Create the style editor
	a.styleEditor = components.NewStyleEditor(
		conn.URL,
		conn.Username,
		conn.Password,
		workspace,
		previewLayer,
	)
	a.styleEditor.SetSize(a.width, a.height)

	// Set the style name to the existing style name
	a.styleEditor.SetStyleName(node.Name)

	// Store the style info for saving later
	a.crudNode = node
	a.crudOperation = CRUDEdit
	a.crudNodeType = models.NodeTypeStyle

	// Set callbacks to handle save/cancel
	styleName := node.Name
	a.styleEditor.SetCallbacks(
		func(sld string) {
			// Update the style content on GeoServer
			a.pendingCRUDCmd = a.executeVisualStyleEdit(workspace, styleName, sld)
		},
		func() {
			// Cancel - editor will be hidden
		},
	)

	return a.styleEditor.Init()
}

// executeVisualStyleEdit updates an existing style from the WYSIWYG editor's SLD output
func (a *App) executeVisualStyleEdit(workspace, styleName, sld string) tea.Cmd {
	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	a.loading = true
	return func() tea.Msg {
		operation := fmt.Sprintf("Update style '%s'", styleName)
		err := client.UpdateStyleContent(workspace, styleName, sld, "sld")
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// showVisualStyleEditorForCreate opens the WYSIWYG style editor for creating a new style
func (a *App) showVisualStyleEditorForCreate(workspace string, contextNode *models.TreeNode) tea.Cmd {
	// Find the connection for this node
	var conn *config.Connection
	connectionID := ""
	if contextNode != nil {
		connectionID = contextNode.ConnectionID
	}
	for i := range a.config.Connections {
		if a.config.Connections[i].ID == connectionID {
			conn = &a.config.Connections[i]
			break
		}
	}

	if conn == nil {
		a.errorMsg = "No connection found"
		return nil
	}

	client := a.clients[conn.ID]
	if client == nil {
		a.errorMsg = "No client for this connection"
		return nil
	}

	// Get layers in the workspace to use for preview
	layers, err := client.GetLayers(workspace)
	if err != nil || len(layers) == 0 {
		a.errorMsg = "No layers found in workspace for preview. Please add a layer first."
		return nil
	}

	// Use the first layer for preview
	previewLayer := layers[0].Name

	// Create the style editor for a new style
	a.styleEditor = components.NewStyleEditor(
		conn.URL,
		conn.Username,
		conn.Password,
		workspace,
		previewLayer,
	)
	a.styleEditor.SetSize(a.width, a.height)

	// Store context for saving later
	a.crudNode = contextNode
	a.crudOperation = CRUDCreate
	a.crudNodeType = models.NodeTypeStyle

	// Set callbacks to handle save/cancel
	a.styleEditor.SetCallbacks(
		func(sld string) {
			// Get the style name from the editor
			styleName := a.styleEditor.GetStyleName()
			ws := a.styleEditor.GetWorkspace()
			a.pendingCRUDCmd = a.executeVisualStyleCreate(ws, styleName, sld)
		},
		func() {
			// Cancel - editor will be hidden
		},
	)

	return a.styleEditor.Init()
}

// executeVisualStyleCreate creates a new style from the WYSIWYG editor's SLD output
func (a *App) executeVisualStyleCreate(workspace, styleName, sld string) tea.Cmd {
	name := strings.TrimSpace(styleName)
	if name == "" {
		a.errorMsg = "Style name is required"
		return nil
	}

	client := a.getClientForNode(a.crudNode)
	if client == nil {
		a.errorMsg = "No connection for node"
		return nil
	}

	// Set path to navigate to after creation
	a.newlyCreatedPath = workspace + "/Styles/" + name

	a.loading = true
	return func() tea.Msg {
		operation := fmt.Sprintf("Create style '%s'", name)
		err := client.CreateStyle(workspace, name, sld, "sld")
		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// showCodeStyleWizardForCreate opens the code-based style wizard for creating a new style
func (a *App) showCodeStyleWizardForCreate(workspace string, contextNode *models.TreeNode) tea.Cmd {
	a.styleWizard = components.NewStyleWizard(workspace)
	a.styleWizard.SetSize(a.width, a.height)
	a.crudNode = contextNode
	a.crudOperation = CRUDCreate
	a.crudNodeType = models.NodeTypeStyle

	a.styleWizard.SetCallbacks(
		func(result components.StyleWizardResult) {
			if result.Confirmed {
				a.pendingCRUDCmd = a.executeStyleCreate(workspace, result)
			}
		},
		func() {},
	)
	return a.styleWizard.Init()
}
