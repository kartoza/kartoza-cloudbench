package components

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-cloudbench/internal/api"
	"github.com/kartoza/kartoza-cloudbench/internal/integration"
)

// SQLViewWizardStep represents the current step in the wizard
type SQLViewWizardStep int

const (
	SQLViewStepGeoServer SQLViewWizardStep = iota
	SQLViewStepWorkspace
	SQLViewStepDataStore
	SQLViewStepLayerName
	SQLViewStepGeometry
	SQLViewStepConfirm
	SQLViewStepCreating
	SQLViewStepComplete
)

// SQLViewWizard is a wizard for creating SQL View layers
type SQLViewWizard struct {
	width  int
	height int

	step       SQLViewWizardStep
	focusIndex int

	// Connection selection
	connections    []connectionItem
	connectionList list.Model
	selectedConnID string

	// Workspace selection
	workspaces    []stringItem
	workspaceList list.Model
	selectedWorkspace string

	// DataStore selection
	datastores    []stringItem
	datastoreList list.Model
	selectedDatastore string

	// Layer config
	layerNameInput textinput.Model
	titleInput     textinput.Model
	abstractInput  textinput.Model

	// Geometry config
	geomColumnInput textinput.Model
	geomTypeInput   textinput.Model
	sridInput       textinput.Model
	keyColumnInput  textinput.Model

	// The SQL query to publish
	sql string

	// Result
	result    *integration.SQLViewLayerResult
	error     string
	cancelled bool

	// API client provider
	getClient func(connID string) *api.Client
}

type connectionItem struct {
	id   string
	name string
	url  string
}

func (c connectionItem) FilterValue() string { return c.name }
func (c connectionItem) Title() string       { return c.name }
func (c connectionItem) Description() string { return c.url }

// SQLViewCreatedMsg is sent when the SQL view is created
type SQLViewCreatedMsg struct {
	Result *integration.SQLViewLayerResult
	Error  error
}

// NewSQLViewWizard creates a new SQL View wizard
func NewSQLViewWizard(
	sql string,
	connections []connectionItem,
	getClient func(connID string) *api.Client,
	width, height int,
) *SQLViewWizard {
	// Connection list
	connItems := make([]list.Item, len(connections))
	for i, c := range connections {
		connItems[i] = c
	}
	connDelegate := list.NewDefaultDelegate()
	connList := list.New(connItems, connDelegate, width-10, height-15)
	connList.Title = "Select GeoServer Connection"
	connList.SetShowStatusBar(false)
	connList.SetShowHelp(false)

	// Workspace list
	wsDelegate := list.NewDefaultDelegate()
	wsList := list.New([]list.Item{}, wsDelegate, width-10, height-15)
	wsList.Title = "Select Workspace"
	wsList.SetShowStatusBar(false)
	wsList.SetShowHelp(false)

	// DataStore list
	dsDelegate := list.NewDefaultDelegate()
	dsList := list.New([]list.Item{}, dsDelegate, width-10, height-15)
	dsList.Title = "Select PostGIS DataStore"
	dsList.SetShowStatusBar(false)
	dsList.SetShowHelp(false)

	// Text inputs
	layerName := textinput.New()
	layerName.Placeholder = "layer_name"
	layerName.Focus()
	layerName.Width = 30

	title := textinput.New()
	title.Placeholder = "Layer Title"
	title.Width = 40

	abstract := textinput.New()
	abstract.Placeholder = "Layer description..."
	abstract.Width = 50

	geomCol := textinput.New()
	geomCol.Placeholder = "geom"
	geomCol.SetValue("geom")
	geomCol.Width = 20

	geomType := textinput.New()
	geomType.Placeholder = "Geometry"
	geomType.SetValue("Geometry")
	geomType.Width = 20

	srid := textinput.New()
	srid.Placeholder = "4326"
	srid.SetValue("4326")
	srid.Width = 10

	keyCol := textinput.New()
	keyCol.Placeholder = "id (optional)"
	keyCol.Width = 20

	return &SQLViewWizard{
		width:           width,
		height:          height,
		step:            SQLViewStepGeoServer,
		connections:     connections,
		connectionList:  connList,
		workspaceList:   wsList,
		datastoreList:   dsList,
		layerNameInput:  layerName,
		titleInput:      title,
		abstractInput:   abstract,
		geomColumnInput: geomCol,
		geomTypeInput:   geomType,
		sridInput:       srid,
		keyColumnInput:  keyCol,
		sql:             sql,
		getClient:       getClient,
	}
}

// Init initializes the wizard
func (w *SQLViewWizard) Init() tea.Cmd {
	return nil
}

// Update handles messages
func (w *SQLViewWizard) Update(msg tea.Msg) (*SQLViewWizard, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "esc":
			w.cancelled = true
			return w, nil

		case "enter":
			return w.handleEnter()

		case "tab", "down":
			if w.step == SQLViewStepLayerName || w.step == SQLViewStepGeometry {
				w.focusIndex++
				w.updateFocus()
			}

		case "shift+tab", "up":
			if w.step == SQLViewStepLayerName || w.step == SQLViewStepGeometry {
				w.focusIndex--
				if w.focusIndex < 0 {
					w.focusIndex = 0
				}
				w.updateFocus()
			}
		}

	case SQLViewCreatedMsg:
		if msg.Error != nil {
			w.error = msg.Error.Error()
			w.step = SQLViewStepConfirm
		} else {
			w.result = msg.Result
			w.step = SQLViewStepComplete
		}
		return w, nil
	}

	// Update sub-components
	switch w.step {
	case SQLViewStepGeoServer:
		var cmd tea.Cmd
		w.connectionList, cmd = w.connectionList.Update(msg)
		cmds = append(cmds, cmd)

	case SQLViewStepWorkspace:
		var cmd tea.Cmd
		w.workspaceList, cmd = w.workspaceList.Update(msg)
		cmds = append(cmds, cmd)

	case SQLViewStepDataStore:
		var cmd tea.Cmd
		w.datastoreList, cmd = w.datastoreList.Update(msg)
		cmds = append(cmds, cmd)

	case SQLViewStepLayerName:
		var cmd tea.Cmd
		switch w.focusIndex {
		case 0:
			w.layerNameInput, cmd = w.layerNameInput.Update(msg)
		case 1:
			w.titleInput, cmd = w.titleInput.Update(msg)
		case 2:
			w.abstractInput, cmd = w.abstractInput.Update(msg)
		}
		cmds = append(cmds, cmd)

	case SQLViewStepGeometry:
		var cmd tea.Cmd
		switch w.focusIndex {
		case 0:
			w.geomColumnInput, cmd = w.geomColumnInput.Update(msg)
		case 1:
			w.geomTypeInput, cmd = w.geomTypeInput.Update(msg)
		case 2:
			w.sridInput, cmd = w.sridInput.Update(msg)
		case 3:
			w.keyColumnInput, cmd = w.keyColumnInput.Update(msg)
		}
		cmds = append(cmds, cmd)
	}

	return w, tea.Batch(cmds...)
}

func (w *SQLViewWizard) handleEnter() (*SQLViewWizard, tea.Cmd) {
	switch w.step {
	case SQLViewStepGeoServer:
		if item := w.connectionList.SelectedItem(); item != nil {
			conn := item.(connectionItem)
			w.selectedConnID = conn.id
			w.step = SQLViewStepWorkspace
			return w, w.loadWorkspaces()
		}

	case SQLViewStepWorkspace:
		if item := w.workspaceList.SelectedItem(); item != nil {
			w.selectedWorkspace = string(item.(stringItem))
			w.step = SQLViewStepDataStore
			return w, w.loadDataStores()
		}

	case SQLViewStepDataStore:
		if item := w.datastoreList.SelectedItem(); item != nil {
			w.selectedDatastore = string(item.(stringItem))
			w.step = SQLViewStepLayerName
			w.focusIndex = 0
			w.layerNameInput.Focus()
		}

	case SQLViewStepLayerName:
		if w.layerNameInput.Value() != "" {
			w.step = SQLViewStepGeometry
			w.focusIndex = 0
			w.geomColumnInput.Focus()
		}

	case SQLViewStepGeometry:
		w.step = SQLViewStepConfirm

	case SQLViewStepConfirm:
		w.step = SQLViewStepCreating
		return w, w.createSQLView()

	case SQLViewStepComplete:
		w.cancelled = true
	}

	return w, nil
}

func (w *SQLViewWizard) updateFocus() {
	w.layerNameInput.Blur()
	w.titleInput.Blur()
	w.abstractInput.Blur()
	w.geomColumnInput.Blur()
	w.geomTypeInput.Blur()
	w.sridInput.Blur()
	w.keyColumnInput.Blur()

	if w.step == SQLViewStepLayerName {
		switch w.focusIndex % 3 {
		case 0:
			w.layerNameInput.Focus()
		case 1:
			w.titleInput.Focus()
		case 2:
			w.abstractInput.Focus()
		}
	} else if w.step == SQLViewStepGeometry {
		switch w.focusIndex % 4 {
		case 0:
			w.geomColumnInput.Focus()
		case 1:
			w.geomTypeInput.Focus()
		case 2:
			w.sridInput.Focus()
		case 3:
			w.keyColumnInput.Focus()
		}
	}
}

func (w *SQLViewWizard) loadWorkspaces() tea.Cmd {
	return func() tea.Msg {
		client := w.getClient(w.selectedConnID)
		if client == nil {
			return SQLViewCreatedMsg{Error: fmt.Errorf("client not found")}
		}

		workspaces, err := client.GetWorkspaces()
		if err != nil {
			return SQLViewCreatedMsg{Error: err}
		}

		items := make([]list.Item, len(workspaces))
		for i, ws := range workspaces {
			items[i] = stringItem(ws.Name)
		}
		w.workspaceList.SetItems(items)
		return nil
	}
}

func (w *SQLViewWizard) loadDataStores() tea.Cmd {
	return func() tea.Msg {
		client := w.getClient(w.selectedConnID)
		if client == nil {
			return SQLViewCreatedMsg{Error: fmt.Errorf("client not found")}
		}

		stores, err := integration.ListPostGISDataStores(client, w.selectedWorkspace)
		if err != nil {
			return SQLViewCreatedMsg{Error: err}
		}

		items := make([]list.Item, len(stores))
		for i, store := range stores {
			items[i] = stringItem(store)
		}
		w.datastoreList.SetItems(items)
		return nil
	}
}

func (w *SQLViewWizard) createSQLView() tea.Cmd {
	return func() tea.Msg {
		client := w.getClient(w.selectedConnID)
		if client == nil {
			return SQLViewCreatedMsg{Error: fmt.Errorf("client not found")}
		}

		// Parse SRID
		srid := 4326
		fmt.Sscanf(w.sridInput.Value(), "%d", &srid)

		config := integration.SQLViewLayerConfig{
			GeoServerConnectionID: w.selectedConnID,
			Workspace:             w.selectedWorkspace,
			DataStore:             w.selectedDatastore,
			LayerName:             w.layerNameInput.Value(),
			Title:                 w.titleInput.Value(),
			Abstract:              w.abstractInput.Value(),
			SQL:                   w.sql,
			GeometryColumn:        w.geomColumnInput.Value(),
			GeometryType:          w.geomTypeInput.Value(),
			SRID:                  srid,
			KeyColumn:             w.keyColumnInput.Value(),
		}

		result, err := integration.CreateSQLViewLayer(client, config)
		return SQLViewCreatedMsg{Result: result, Error: err}
	}
}

// View renders the wizard
func (w *SQLViewWizard) View() string {
	if w.cancelled {
		return ""
	}

	titleStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		MarginBottom(1)

	stepStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("240"))

	errorStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("196"))

	successStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("82"))

	var sb strings.Builder

	sb.WriteString(titleStyle.Render("Publish SQL View Layer"))
	sb.WriteString("\n")
	sb.WriteString(stepStyle.Render(fmt.Sprintf("Step %d/7", w.step+1)))
	sb.WriteString("\n\n")

	if w.error != "" {
		sb.WriteString(errorStyle.Render("Error: " + w.error))
		sb.WriteString("\n\n")
	}

	switch w.step {
	case SQLViewStepGeoServer:
		sb.WriteString("Select the GeoServer connection:\n\n")
		sb.WriteString(w.connectionList.View())

	case SQLViewStepWorkspace:
		sb.WriteString(fmt.Sprintf("Connection: %s\n", w.selectedConnID))
		sb.WriteString("Select the workspace:\n\n")
		sb.WriteString(w.workspaceList.View())

	case SQLViewStepDataStore:
		sb.WriteString(fmt.Sprintf("Connection: %s | Workspace: %s\n", w.selectedConnID, w.selectedWorkspace))
		sb.WriteString("Select the PostGIS data store:\n\n")
		sb.WriteString(w.datastoreList.View())

	case SQLViewStepLayerName:
		sb.WriteString("Layer Information:\n\n")
		sb.WriteString("Layer Name: ")
		sb.WriteString(w.layerNameInput.View())
		sb.WriteString("\n\nTitle: ")
		sb.WriteString(w.titleInput.View())
		sb.WriteString("\n\nAbstract: ")
		sb.WriteString(w.abstractInput.View())
		sb.WriteString("\n\nPress TAB to navigate, ENTER to continue")

	case SQLViewStepGeometry:
		sb.WriteString("Geometry Configuration:\n\n")
		sb.WriteString("Geometry Column: ")
		sb.WriteString(w.geomColumnInput.View())
		sb.WriteString("\n\nGeometry Type: ")
		sb.WriteString(w.geomTypeInput.View())
		sb.WriteString("\n\nSRID: ")
		sb.WriteString(w.sridInput.View())
		sb.WriteString("\n\nKey Column (optional): ")
		sb.WriteString(w.keyColumnInput.View())
		sb.WriteString("\n\nPress TAB to navigate, ENTER to continue")

	case SQLViewStepConfirm:
		sb.WriteString("Review Configuration:\n\n")
		sb.WriteString(fmt.Sprintf("Connection: %s\n", w.selectedConnID))
		sb.WriteString(fmt.Sprintf("Workspace:  %s\n", w.selectedWorkspace))
		sb.WriteString(fmt.Sprintf("DataStore:  %s\n", w.selectedDatastore))
		sb.WriteString(fmt.Sprintf("Layer Name: %s\n", w.layerNameInput.Value()))
		sb.WriteString(fmt.Sprintf("Title:      %s\n", w.titleInput.Value()))
		sb.WriteString(fmt.Sprintf("Geometry:   %s (%s, SRID %s)\n",
			w.geomColumnInput.Value(),
			w.geomTypeInput.Value(),
			w.sridInput.Value()))
		sb.WriteString("\nSQL:\n")
		sql := w.sql
		if len(sql) > 200 {
			sql = sql[:200] + "..."
		}
		sb.WriteString(sql)
		sb.WriteString("\n\nPress ENTER to create, ESC to cancel")

	case SQLViewStepCreating:
		sb.WriteString("Creating SQL View layer...")

	case SQLViewStepComplete:
		sb.WriteString(successStyle.Render("SQL View Layer Created Successfully!"))
		sb.WriteString("\n\n")
		if w.result != nil {
			sb.WriteString(fmt.Sprintf("Layer: %s:%s\n", w.result.Workspace, w.result.LayerName))
			sb.WriteString(fmt.Sprintf("Store: %s\n", w.result.DataStore))
			sb.WriteString("\nThe layer is now available via WMS/WFS")
		}
		sb.WriteString("\n\nPress ENTER to close")
	}

	sb.WriteString("\n\n")
	sb.WriteString("ESC to cancel")

	return sb.String()
}

// IsCancelled returns true if the wizard was cancelled
func (w *SQLViewWizard) IsCancelled() bool {
	return w.cancelled
}

// GetResult returns the creation result
func (w *SQLViewWizard) GetResult() *integration.SQLViewLayerResult {
	return w.result
}
