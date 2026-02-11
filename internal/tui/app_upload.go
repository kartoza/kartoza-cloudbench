package tui

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/components"
	"github.com/kartoza/kartoza-geoserver-client/internal/verify"
)

// UploadNextMsg signals to upload the next file
type UploadNextMsg struct {
	Files        []models.LocalFile
	Workspace    string
	ConnectionID string
	Index        int
}

// handleUpload handles file upload - shows confirmation dialog first
func (a *App) handleUpload() tea.Cmd {
	// Get target from tree selection to determine which connection to use
	targetNode := a.treeView.SelectedNode()
	if targetNode == nil {
		a.errorMsg = "Select a workspace or store in the tree first"
		return nil
	}

	client := a.getClientForNode(targetNode)
	if client == nil {
		a.errorMsg = "No connection for selected node"
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
	var workspace string
	workspace = targetNode.Workspace

	if workspace == "" {
		a.errorMsg = "Select a workspace in the GeoServer tree first"
		return nil
	}

	// Store pending upload info including connection ID
	a.pendingUploadFiles = selectedFiles
	a.pendingUploadWorkspace = workspace
	a.pendingUploadConnectionID = targetNode.ConnectionID

	// Build confirmation message
	var fileList strings.Builder
	for i, file := range selectedFiles {
		if i > 0 {
			fileList.WriteString("\n")
		}
		fileList.WriteString(fmt.Sprintf("  %s %s", file.Type.Icon(), file.Name))
		if i >= 4 && len(selectedFiles) > 5 {
			fileList.WriteString(fmt.Sprintf("\n  ... and %d more files", len(selectedFiles)-5))
			break
		}
	}

	message := fmt.Sprintf("Upload %d file(s) to workspace '%s'?\n\nSource files:\n%s\n\nDestination: %s",
		len(selectedFiles), workspace, fileList.String(), workspace)

	a.crudDialog = components.NewConfirmDialog("Confirm Upload", message)
	a.crudDialog.SetSize(a.width, a.height)

	a.crudDialog.SetCallbacks(
		func(result components.DialogResult) {
			if result.Confirmed {
				a.pendingCRUDCmd = a.executeUpload()
			}
		},
		func() {
			// Cancel - clear pending upload
			a.pendingUploadFiles = nil
			a.pendingUploadWorkspace = ""
			a.pendingUploadConnectionID = ""
		},
	)

	return a.crudDialog.Init()
}

// executeUpload performs the actual file upload with progress dialog
func (a *App) executeUpload() tea.Cmd {
	if len(a.pendingUploadFiles) == 0 || a.pendingUploadWorkspace == "" {
		a.errorMsg = "No upload pending"
		return nil
	}

	selectedFiles := a.pendingUploadFiles
	workspace := a.pendingUploadWorkspace
	connectionID := a.pendingUploadConnectionID

	// Store info about what we're uploading for focusing after refresh
	a.lastUploadedWorkspace = workspace
	a.lastUploadedConnectionID = connectionID
	a.lastUploadedStoreNames = make([]string, len(selectedFiles))
	for i, f := range selectedFiles {
		a.lastUploadedStoreNames[i] = strings.TrimSuffix(f.Name, filepath.Ext(f.Name))
	}

	// Clear pending state
	a.pendingUploadFiles = nil
	a.pendingUploadWorkspace = ""
	a.pendingUploadConnectionID = ""

	// Save tree state before upload
	a.savedTreeState = a.treeView.SaveState()

	// Build list of file names for the progress dialog
	fileNames := make([]string, len(selectedFiles))
	for i, f := range selectedFiles {
		fileNames[i] = f.Name
	}

	// Create progress dialog
	a.progressDialog = components.NewProgressDialog("Uploading Files", "📤", fileNames)
	a.progressDialog.SetSize(a.width, a.height)

	// Start the upload in a goroutine and return the init command
	return tea.Batch(
		a.progressDialog.Init(),
		a.startUpload(selectedFiles, workspace, connectionID),
	)
}

// startUpload starts the upload process by uploading the first file
func (a *App) startUpload(files []models.LocalFile, workspace string, connectionID string) tea.Cmd {
	if len(files) == 0 {
		return nil
	}
	// Send progress update for the first file and start uploading
	return tea.Batch(
		components.SendProgressUpdate("Uploading Files", 0, len(files), files[0].Name, false, nil),
		a.uploadFile(files, workspace, connectionID, 0),
	)
}

// uploadFile uploads a single file and returns a command to continue or finish
func (a *App) uploadFile(files []models.LocalFile, workspace string, connectionID string, index int) tea.Cmd {
	client := a.clients[connectionID]
	if client == nil {
		return func() tea.Msg {
			return components.ProgressUpdateMsg{
				ID:       "Uploading Files",
				Current:  index,
				Total:    len(files),
				ItemName: files[index].Name,
				Done:     true,
				Error:    fmt.Errorf("no client for connection"),
			}
		}
	}

	return func() tea.Msg {
		file := files[index]
		storeName := strings.TrimSuffix(file.Name, filepath.Ext(file.Name))

		var err error
		var isVerifiable bool
		switch file.Type {
		case models.FileTypeShapefile:
			err = client.UploadShapefile(workspace, storeName, file.Path)
			isVerifiable = true
		case models.FileTypeGeoTIFF:
			err = client.UploadGeoTIFF(workspace, storeName, file.Path)
			// GeoTIFF verification is not yet supported (uses different WCS protocol)
			isVerifiable = false
		case models.FileTypeGeoPackage:
			err = client.UploadGeoPackage(workspace, storeName, file.Path)
			isVerifiable = true
		case models.FileTypeSLD, models.FileTypeCSS:
			format := "sld"
			if file.Type == models.FileTypeCSS {
				format = "css"
			}
			err = client.UploadStyle(workspace, storeName, file.Path, format)
			isVerifiable = false
		default:
			err = fmt.Errorf("unsupported file type: %s", file.Type)
		}

		if err != nil {
			return components.ProgressUpdateMsg{
				ID:       "Uploading Files",
				Current:  index,
				Total:    len(files),
				ItemName: file.Name,
				Done:     true,
				Error:    err,
			}
		}

		// Check if there are more files
		if index+1 < len(files) {
			return UploadNextMsg{
				Files:        files,
				Workspace:    workspace,
				ConnectionID: connectionID,
				Index:        index + 1,
			}
		}

		// All files uploaded successfully - now run verification
		var verificationResult string
		var verificationOK bool

		if isVerifiable && len(files) == 1 {
			// Only verify single file uploads for now (last file uploaded)
			verificationResult, verificationOK = a.verifyUpload(files[len(files)-1], workspace, connectionID)
		} else if isVerifiable && len(files) > 1 {
			// For multiple files, verify the last one uploaded
			verificationResult, verificationOK = a.verifyUpload(file, workspace, connectionID)
		}

		return components.ProgressUpdateMsg{
			ID:                 "Uploading Files",
			Current:            len(files),
			Total:              len(files),
			ItemName:           "",
			Done:               true,
			Error:              nil,
			VerificationResult: verificationResult,
			VerificationOK:     verificationOK,
		}
	}
}

// verifyUpload verifies that the uploaded layer matches the local file
func (a *App) verifyUpload(file models.LocalFile, workspace string, connectionID string) (string, bool) {
	storeName := strings.TrimSuffix(file.Name, filepath.Ext(file.Name))

	// Wait a moment for GeoServer to fully process the upload
	time.Sleep(time.Millisecond * 500)

	// Get local layer info
	localInfo, err := verify.GetLocalLayerInfo(file.Path)
	if err != nil {
		return fmt.Sprintf("Could not read local file: %v", err), false
	}

	// Get connection credentials
	var conn *config.Connection
	for i := range a.config.Connections {
		if a.config.Connections[i].ID == connectionID {
			conn = &a.config.Connections[i]
			break
		}
	}
	if conn == nil {
		return "No connection for verification", false
	}

	client := a.clients[connectionID]
	if client == nil {
		return "No client for verification", false
	}

	// Get remote layer info via WFS
	remoteInfo, err := verify.GetRemoteLayerInfo(
		client.BaseURL(),
		workspace,
		storeName,
		conn.Username,
		conn.Password,
	)
	if err != nil {
		return fmt.Sprintf("Could not read remote layer: %v", err), false
	}

	// Compare local and remote
	result := verify.VerifyUpload(localInfo, remoteInfo)

	return result.FormatResult(), result.Success
}

// publishLayerFromStore publishes a layer from a data store or coverage store
// If the layer already exists, it will enable and advertise it instead
func (a *App) publishLayerFromStore(node *models.TreeNode) tea.Cmd {
	if node == nil {
		a.errorMsg = "No store selected"
		return nil
	}

	client := a.getClientForNode(node)
	if client == nil {
		a.errorMsg = "No connection for selected node"
		return nil
	}

	workspace := node.Workspace
	storeName := node.Name

	// Save tree state before publish
	a.savedTreeState = a.treeView.SaveState()

	a.loading = true
	return func() tea.Msg {
		var err error
		var operation string

		switch node.Type {
		case models.NodeTypeCoverageStore:
			// Check if coverage already exists
			coverages, checkErr := client.GetCoverages(workspace, storeName)
			if checkErr == nil && len(coverages) > 0 {
				// Coverage exists, just enable it
				operation = fmt.Sprintf("Enable coverage '%s'", storeName)
				err = client.EnableLayer(workspace, storeName, true)
				if err == nil {
					err = client.SetLayerAdvertised(workspace, storeName, true)
				}
			} else {
				// Try to publish new coverage
				operation = fmt.Sprintf("Publish coverage '%s'", storeName)
				err = client.PublishCoverage(workspace, storeName, storeName)
			}
		case models.NodeTypeDataStore:
			// Check if feature type already exists
			featureTypes, checkErr := client.GetFeatureTypes(workspace, storeName)
			if checkErr == nil && len(featureTypes) > 0 {
				// Feature type exists, just enable it
				operation = fmt.Sprintf("Enable layer '%s'", storeName)
				err = client.EnableLayer(workspace, storeName, true)
				if err == nil {
					err = client.SetLayerAdvertised(workspace, storeName, true)
				}
			} else {
				// Try to publish new feature type
				operation = fmt.Sprintf("Publish feature type '%s'", storeName)
				err = client.PublishFeatureType(workspace, storeName, storeName)
			}
		default:
			return errMsg{err: fmt.Errorf("can only publish from data stores or coverage stores")}
		}

		return crudCompleteMsg{success: err == nil, err: err, operation: operation}
	}
}

// openLayerPreview opens the layer preview in the TUI
func (a *App) openLayerPreview(node *models.TreeNode) tea.Cmd {
	client := a.getClientForNode(node)
	conn := a.getConnectionForNode(node)

	if client == nil {
		a.errorMsg = "No connection for selected node"
		return nil
	}

	var layerName string

	switch node.Type {
	case models.NodeTypeLayer:
		layerName = node.Name
	case models.NodeTypeLayerGroup:
		layerName = node.Name
	case models.NodeTypeDataStore:
		layerName = node.Name
	case models.NodeTypeCoverageStore:
		layerName = node.Name
	default:
		a.errorMsg = "Can only preview layers, layer groups, and stores"
		return nil
	}

	// Get connection credentials
	username := ""
	password := ""
	if conn != nil {
		username = conn.Username
		password = conn.Password
	}

	// Create inline map preview
	a.mapPreview = components.NewMapPreview(
		client.BaseURL(),
		username,
		password,
		node.Workspace,
		layerName,
	)
	a.mapPreview.SetSize(a.width, a.height)
	a.mapPreview.SetOnClose(func() {
		a.mapPreview = nil
	})

	// Try to get layer styles
	return tea.Batch(
		a.mapPreview.Init(),
		a.fetchLayerStylesForPreview(node),
	)
}

// fetchLayerStylesForPreview fetches available styles for the layer preview
func (a *App) fetchLayerStylesForPreview(node *models.TreeNode) tea.Cmd {
	client := a.getClientForNode(node)
	if client == nil {
		// Return metadata msg with default values to trigger map fetch
		return func() tea.Msg {
			return components.MapPreviewMetadataMsg{}
		}
	}

	return func() tea.Msg {
		var metadataMsg components.MapPreviewMetadataMsg

		// Check if this is a layer group
		if node.Type == models.NodeTypeLayerGroup {
			// Fetch layer group details
			groupDetails, err := client.GetLayerGroup(node.Workspace, node.Name)
			if err == nil {
				metadataMsg.IsLayerGroup = true
				metadataMsg.LayerGroupMode = groupDetails.Mode

				// Extract layer info from the group, including styles
				layerInfos := []components.LayerGroupLayerInfo{}
				for _, item := range groupDetails.Layers {
					if item.Type == "layer" {
						info := components.LayerGroupLayerInfo{
							Name:         item.Name,
							DefaultStyle: item.StyleName,
						}

						// Try to get available styles for this layer
						// Extract workspace and layer name from the full name (workspace:layername)
						layerName := item.Name
						layerWorkspace := node.Workspace
						if idx := strings.Index(item.Name, ":"); idx > 0 {
							layerWorkspace = item.Name[:idx]
							layerName = item.Name[idx+1:]
						}

						layerStyles, err := client.GetLayerStyles(layerWorkspace, layerName)
						if err == nil {
							availStyles := []string{}
							if layerStyles.DefaultStyle != "" {
								availStyles = append(availStyles, layerStyles.DefaultStyle)
							}
							availStyles = append(availStyles, layerStyles.AdditionalStyles...)
							info.AvailableStyles = availStyles

							// If no default style was set in the group, use the layer's default
							if info.DefaultStyle == "" && layerStyles.DefaultStyle != "" {
								info.DefaultStyle = layerStyles.DefaultStyle
							}
						}

						layerInfos = append(layerInfos, info)
					}
				}
				metadataMsg.GroupLayers = layerInfos

				// Get bounds from layer group
				if groupDetails.Bounds != nil {
					metadataMsg.Bounds = &[4]float64{
						groupDetails.Bounds.MinX,
						groupDetails.Bounds.MinY,
						groupDetails.Bounds.MaxX,
						groupDetails.Bounds.MaxY,
					}
				}
			}
		} else {
			// Try to get layer styles
			layerStyles, err := client.GetLayerStyles(node.Workspace, node.Name)
			if err == nil {
				styles := []string{}
				if layerStyles.DefaultStyle != "" {
					styles = append(styles, layerStyles.DefaultStyle)
				}
				styles = append(styles, layerStyles.AdditionalStyles...)
				metadataMsg.Styles = styles
			}

			// Try to get layer metadata for bounds
			metadata, err := client.GetLayerMetadata(node.Workspace, node.Name)
			if err == nil && metadata.LatLonBoundingBox != nil {
				metadataMsg.Bounds = &[4]float64{
					metadata.LatLonBoundingBox.MinX,
					metadata.LatLonBoundingBox.MinY,
					metadata.LatLonBoundingBox.MaxX,
					metadata.LatLonBoundingBox.MaxY,
				}
			}
		}

		return metadataMsg
	}
}
