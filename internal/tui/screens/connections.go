package screens

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/google/uuid"
	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/styles"
)

// ConnectionsKeyMap defines the key bindings for the connections screen
type ConnectionsKeyMap struct {
	Up       key.Binding
	Down     key.Binding
	Enter    key.Binding
	Add      key.Binding
	Delete   key.Binding
	Edit     key.Binding
	Test     key.Binding
	Escape   key.Binding
	Tab      key.Binding
	ShiftTab key.Binding
	Save     key.Binding
}

// DefaultConnectionsKeyMap returns the default key bindings
func DefaultConnectionsKeyMap() ConnectionsKeyMap {
	return ConnectionsKeyMap{
		Up: key.NewBinding(
			key.WithKeys("up"),
			key.WithHelp("↑", "up"),
		),
		Down: key.NewBinding(
			key.WithKeys("down"),
			key.WithHelp("↓", "down"),
		),
		Enter: key.NewBinding(
			key.WithKeys("enter"),
			key.WithHelp("enter", "connect"),
		),
		Add: key.NewBinding(
			key.WithKeys("a"),
			key.WithHelp("a", "add"),
		),
		Delete: key.NewBinding(
			key.WithKeys("d", "delete"),
			key.WithHelp("d", "delete"),
		),
		Edit: key.NewBinding(
			key.WithKeys("e"),
			key.WithHelp("e", "edit"),
		),
		Test: key.NewBinding(
			key.WithKeys("t"),
			key.WithHelp("t", "test"),
		),
		Escape: key.NewBinding(
			key.WithKeys("esc"),
			key.WithHelp("esc", "back"),
		),
		Tab: key.NewBinding(
			key.WithKeys("tab", "down", "j"),
			key.WithHelp("tab/↓/j", "next field"),
		),
		ShiftTab: key.NewBinding(
			key.WithKeys("shift+tab", "up", "k"),
			key.WithHelp("shift+tab/↑/k", "prev field"),
		),
		Save: key.NewBinding(
			key.WithKeys("ctrl+s"),
			key.WithHelp("ctrl+s", "save"),
		),
	}
}

// ConnectionsMode represents the current mode of the connections screen
type ConnectionsMode int

const (
	ModeList ConnectionsMode = iota
	ModeAdd
	ModeEdit
)

// ConnectionTestMsg is sent when a connection test completes
type ConnectionTestMsg struct {
	Success bool
	Version string
	Err     error
}

// ConnectionsScreen manages GeoServer connections
type ConnectionsScreen struct {
	config       *config.Config
	keyMap       ConnectionsKeyMap
	cursor       int
	mode         ConnectionsMode
	width        int
	height       int
	inputs       []textinput.Model
	focusIndex   int
	editingField bool // true when actively typing in a field
	statusMsg    string
	errorMsg     string
	editingID    string
}

// Field indices
const (
	fieldName = iota
	fieldURL
	fieldUsername
	fieldPassword
	fieldCount
)

// NewConnectionsScreen creates a new connections screen
func NewConnectionsScreen(cfg *config.Config) *ConnectionsScreen {
	cs := &ConnectionsScreen{
		config: cfg,
		keyMap: DefaultConnectionsKeyMap(),
		inputs: make([]textinput.Model, fieldCount),
	}

	// Initialize text inputs
	for i := range cs.inputs {
		t := textinput.New()
		t.CharLimit = 256

		switch i {
		case fieldName:
			t.Placeholder = "Connection name"
			t.Focus()
		case fieldURL:
			t.Placeholder = "https://geoserver.example.com/geoserver"
		case fieldUsername:
			t.Placeholder = "admin"
		case fieldPassword:
			t.Placeholder = "password"
			t.EchoMode = textinput.EchoPassword
		}

		cs.inputs[i] = t
	}

	return cs
}

// SetSize sets the screen size
func (cs *ConnectionsScreen) SetSize(width, height int) {
	cs.width = width
	cs.height = height

	// Update input widths
	inputWidth := width - 30
	if inputWidth < 30 {
		inputWidth = 30
	}
	for i := range cs.inputs {
		cs.inputs[i].Width = inputWidth
	}
}

// Update handles messages
func (cs *ConnectionsScreen) Update(msg tea.Msg) (*ConnectionsScreen, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		// Handle based on mode
		switch cs.mode {
		case ModeList:
			return cs.updateList(msg)
		case ModeAdd, ModeEdit:
			return cs.updateForm(msg)
		}

	case ConnectionTestMsg:
		if msg.Success {
			cs.statusMsg = fmt.Sprintf("Connection successful! GeoServer %s", msg.Version)
			cs.errorMsg = ""
		} else {
			cs.errorMsg = fmt.Sprintf("Connection failed: %v", msg.Err)
			cs.statusMsg = ""
		}
	}

	return cs, nil
}

// updateList handles key presses in list mode
func (cs *ConnectionsScreen) updateList(msg tea.KeyMsg) (*ConnectionsScreen, tea.Cmd) {
	switch {
	case key.Matches(msg, cs.keyMap.Up):
		if cs.cursor > 0 {
			cs.cursor--
		}

	case key.Matches(msg, cs.keyMap.Down):
		if cs.cursor < len(cs.config.Connections)-1 {
			cs.cursor++
		}

	case key.Matches(msg, cs.keyMap.Add):
		cs.mode = ModeAdd
		cs.clearInputs()
		cs.focusIndex = 0
		cs.inputs[0].Focus()

	case key.Matches(msg, cs.keyMap.Edit):
		if len(cs.config.Connections) > 0 {
			cs.mode = ModeEdit
			conn := cs.config.Connections[cs.cursor]
			cs.editingID = conn.ID
			cs.inputs[fieldName].SetValue(conn.Name)
			cs.inputs[fieldURL].SetValue(conn.URL)
			cs.inputs[fieldUsername].SetValue(conn.Username)
			cs.inputs[fieldPassword].SetValue(conn.Password)
			cs.focusIndex = 0
			cs.inputs[0].Focus()
		}

	case key.Matches(msg, cs.keyMap.Delete):
		if len(cs.config.Connections) > 0 {
			conn := cs.config.Connections[cs.cursor]
			cs.config.RemoveConnection(conn.ID)
			if err := cs.config.Save(); err != nil {
				cs.errorMsg = fmt.Sprintf("Failed to save: %v", err)
			} else {
				cs.statusMsg = "Connection deleted"
			}
			if cs.cursor >= len(cs.config.Connections) && cs.cursor > 0 {
				cs.cursor--
			}
		}

	case key.Matches(msg, cs.keyMap.Enter):
		if len(cs.config.Connections) > 0 {
			conn := cs.config.Connections[cs.cursor]
			cs.config.SetActiveConnection(conn.ID)
			if err := cs.config.Save(); err != nil {
				cs.errorMsg = fmt.Sprintf("Failed to save: %v", err)
			} else {
				cs.statusMsg = fmt.Sprintf("Connected to %s", conn.Name)
			}
		}

	case key.Matches(msg, cs.keyMap.Test):
		if len(cs.config.Connections) > 0 {
			conn := cs.config.Connections[cs.cursor]
			return cs, cs.testConnection(&conn)
		}
	}

	return cs, nil
}

// updateForm handles key presses in form mode
func (cs *ConnectionsScreen) updateForm(msg tea.KeyMsg) (*ConnectionsScreen, tea.Cmd) {
	// If we're actively editing a field, forward most keys to the input
	if cs.editingField {
		switch msg.String() {
		case "enter":
			// Exit edit mode, accept the value
			cs.editingField = false
			cs.inputs[cs.focusIndex].Blur()
			return cs, nil

		case "esc":
			// Exit edit mode, discard changes (could restore original value)
			cs.editingField = false
			cs.inputs[cs.focusIndex].Blur()
			return cs, nil

		default:
			// Forward all other keys to the input for text editing
			var cmd tea.Cmd
			cs.inputs[cs.focusIndex], cmd = cs.inputs[cs.focusIndex].Update(msg)
			return cs, cmd
		}
	}

	// Navigation mode - vim keys and arrows work here
	switch {
	case key.Matches(msg, cs.keyMap.Escape):
		cs.mode = ModeList
		cs.clearInputs()
		return cs, nil

	case key.Matches(msg, cs.keyMap.Save):
		return cs, cs.saveConnection()

	case msg.String() == "enter":
		// Enter edit mode for current field
		cs.editingField = true
		cs.inputs[cs.focusIndex].Focus()
		return cs, nil

	case msg.String() == "tab" || msg.String() == "down" || msg.String() == "j":
		// Move to next field
		cs.focusIndex = (cs.focusIndex + 1) % fieldCount
		return cs, nil

	case msg.String() == "shift+tab" || msg.String() == "up" || msg.String() == "k":
		// Move to previous field
		cs.focusIndex = (cs.focusIndex - 1 + fieldCount) % fieldCount
		return cs, nil
	}

	return cs, nil
}

// clearInputs clears all input fields
func (cs *ConnectionsScreen) clearInputs() {
	for i := range cs.inputs {
		cs.inputs[i].SetValue("")
		cs.inputs[i].Blur()
	}
	cs.focusIndex = 0
	cs.editingField = false
	cs.editingID = ""
}

// saveConnection saves the current form data
func (cs *ConnectionsScreen) saveConnection() tea.Cmd {
	name := strings.TrimSpace(cs.inputs[fieldName].Value())
	url := strings.TrimSpace(cs.inputs[fieldURL].Value())
	username := strings.TrimSpace(cs.inputs[fieldUsername].Value())
	password := cs.inputs[fieldPassword].Value()

	if name == "" || url == "" {
		cs.errorMsg = "Name and URL are required"
		return nil
	}

	if cs.mode == ModeEdit {
		// Update existing connection
		for i := range cs.config.Connections {
			if cs.config.Connections[i].ID == cs.editingID {
				cs.config.Connections[i].Name = name
				cs.config.Connections[i].URL = url
				cs.config.Connections[i].Username = username
				cs.config.Connections[i].Password = password
				break
			}
		}
	} else {
		// Add new connection
		conn := config.Connection{
			ID:       uuid.New().String(),
			Name:     name,
			URL:      url,
			Username: username,
			Password: password,
		}
		cs.config.AddConnection(conn)
	}

	if err := cs.config.Save(); err != nil {
		cs.errorMsg = fmt.Sprintf("Failed to save: %v", err)
		return nil
	}

	cs.statusMsg = "Connection saved"
	cs.mode = ModeList
	cs.clearInputs()
	return nil
}

// testConnection tests a connection
func (cs *ConnectionsScreen) testConnection(conn *config.Connection) tea.Cmd {
	return func() tea.Msg {
		client := api.NewClient(conn)
		err := client.TestConnection()
		if err != nil {
			return ConnectionTestMsg{Success: false, Err: err}
		}

		version, _ := client.GetServerVersion()
		return ConnectionTestMsg{Success: true, Version: version}
	}
}

// View renders the connections screen
func (cs *ConnectionsScreen) View() string {
	var b strings.Builder

	// Title
	title := styles.DialogTitleStyle.Render("Connection Manager")
	b.WriteString(title)
	b.WriteString("\n\n")

	switch cs.mode {
	case ModeList:
		b.WriteString(cs.renderList())
	case ModeAdd:
		b.WriteString(cs.renderForm("Add Connection"))
	case ModeEdit:
		b.WriteString(cs.renderForm("Edit Connection"))
	}

	// Status messages
	if cs.errorMsg != "" {
		b.WriteString("\n")
		b.WriteString(styles.ErrorMsgStyle.Render(cs.errorMsg))
	}
	if cs.statusMsg != "" {
		b.WriteString("\n")
		b.WriteString(styles.SuccessStyle.Render("✓ " + cs.statusMsg))
	}

	// Help
	b.WriteString("\n\n")
	if cs.mode == ModeList {
		b.WriteString(styles.HelpTextStyle.Render("a:add  e:edit  d:delete  t:test  Enter:connect  Esc:back"))
	} else if cs.editingField {
		b.WriteString(styles.HelpTextStyle.Render("Enter:accept  Esc:cancel edit"))
	} else {
		b.WriteString(styles.HelpTextStyle.Render("j/k:navigate  Enter:edit field  Ctrl+S:save  Esc:cancel"))
	}

	dialog := styles.DialogStyle.Width(cs.width - 10).Render(b.String())
	return styles.Center(cs.width, cs.height, dialog)
}

// renderList renders the connection list
func (cs *ConnectionsScreen) renderList() string {
	var b strings.Builder

	if len(cs.config.Connections) == 0 {
		b.WriteString(styles.MutedStyle.Render("No connections configured."))
		b.WriteString("\n\n")
		b.WriteString("Press 'a' to add a new connection.")
		return b.String()
	}

	for i, conn := range cs.config.Connections {
		var line string
		isActive := conn.ID == cs.config.ActiveConnection
		isSelected := i == cs.cursor

		// Build connection info
		info := fmt.Sprintf("%s\n  %s", conn.Name, styles.MutedStyle.Render(conn.URL))

		// Apply styling
		var style lipgloss.Style
		if isSelected {
			style = styles.ActiveItemStyle
		} else {
			style = styles.ItemStyle
		}

		// Status indicator
		if isActive {
			line = styles.ConnectedStyle.Render("● ") + info
		} else {
			line = styles.MutedStyle.Render("○ ") + info
		}

		b.WriteString(style.Render(line))
		b.WriteString("\n")
	}

	return b.String()
}

// renderForm renders the add/edit form
func (cs *ConnectionsScreen) renderForm(title string) string {
	var b strings.Builder

	labels := []string{"Name:", "URL:", "Username:", "Password:"}

	for i, input := range cs.inputs {
		// Show selection indicator
		var indicator string
		if i == cs.focusIndex {
			if cs.editingField {
				indicator = styles.ConnectedStyle.Render("▶ ") // Editing
			} else {
				indicator = styles.SelectedItemStyle.Render("● ") // Selected but not editing
			}
		} else {
			indicator = "  "
		}

		label := styles.ItemStyle.Width(10).Render(labels[i])

		var inputStyle lipgloss.Style
		if i == cs.focusIndex && cs.editingField {
			inputStyle = styles.FocusedInputStyle
		} else if i == cs.focusIndex {
			inputStyle = styles.ActiveItemStyle
		} else {
			inputStyle = styles.InputStyle
		}

		b.WriteString(indicator)
		b.WriteString(label)
		b.WriteString(inputStyle.Render(input.View()))
		b.WriteString("\n\n")
	}

	return b.String()
}

// Mode returns the current mode
func (cs *ConnectionsScreen) Mode() ConnectionsMode {
	return cs.mode
}

// IsEditingField returns true if currently editing a text field
func (cs *ConnectionsScreen) IsEditingField() bool {
	return (cs.mode == ModeAdd || cs.mode == ModeEdit) && cs.editingField
}

// GetActiveConnection returns the active connection
func (cs *ConnectionsScreen) GetActiveConnection() *config.Connection {
	return cs.config.GetActiveConnection()
}
