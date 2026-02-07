package components

import (
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/harmonica"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/styles"
)

// WorkspaceWizardMode represents whether we're creating or editing
type WorkspaceWizardMode int

const (
	WorkspaceWizardModeCreate WorkspaceWizardMode = iota
	WorkspaceWizardModeEdit
)

// WorkspaceWizardFocusArea represents which section has focus
type WorkspaceWizardFocusArea int

const (
	FocusBasicInfo WorkspaceWizardFocusArea = iota
	FocusServices
	FocusSettings
)

// WorkspaceWizardResult represents the result of the wizard
type WorkspaceWizardResult struct {
	Confirmed bool
	Config    models.WorkspaceConfig
}

// WorkspaceWizardAnimationMsg is sent to update animation state
type WorkspaceWizardAnimationMsg struct {
	ID string
}

// WorkspaceWizard is a dialog for creating/editing workspaces with service toggles
type WorkspaceWizard struct {
	id           string
	mode         WorkspaceWizardMode
	originalName string // For edit mode - the original workspace name
	width        int
	height       int
	visible      bool
	onConfirm    func(WorkspaceWizardResult)
	onCancel     func()

	// Basic info
	nameInput textinput.Model

	// Checkbox states
	defaultWorkspace bool
	isolated         bool
	enabled          bool // Settings enabled

	// Service toggles
	wmtsEnabled bool
	wmsEnabled  bool
	wcsEnabled  bool
	wpsEnabled  bool
	wfsEnabled  bool

	// Navigation
	focusArea    WorkspaceWizardFocusArea
	focusIndex   int // Index within the current section
	editingField bool

	// Animation
	spring       harmonica.Spring
	animScale    float64
	animVelocity float64
	animOpacity  float64
	targetScale  float64
	animating    bool
	closing      bool
}

// NewWorkspaceWizard creates a new wizard for creating workspaces
func NewWorkspaceWizard() *WorkspaceWizard {
	nameInput := textinput.New()
	nameInput.Placeholder = "workspace-name"
	nameInput.CharLimit = 256

	return &WorkspaceWizard{
		id:           "workspace-wizard-create",
		mode:         WorkspaceWizardModeCreate,
		visible:      true,
		nameInput:    nameInput,
		focusArea:    FocusBasicInfo,
		focusIndex:   0,
		spring:       harmonica.NewSpring(harmonica.FPS(60), 6.0, 0.5),
		animScale:    0.0,
		animVelocity: 0.0,
		animOpacity:  0.0,
		targetScale:  1.0,
		animating:    true,
	}
}

// NewWorkspaceWizardWithConfig creates a wizard pre-populated with config (for editing)
func NewWorkspaceWizardWithConfig(config *models.WorkspaceConfig) *WorkspaceWizard {
	nameInput := textinput.New()
	nameInput.Placeholder = "workspace-name"
	nameInput.CharLimit = 256
	nameInput.SetValue(config.Name)

	return &WorkspaceWizard{
		id:               "workspace-wizard-edit",
		mode:             WorkspaceWizardModeEdit,
		originalName:     config.Name,
		visible:          true,
		nameInput:        nameInput,
		defaultWorkspace: config.Default,
		isolated:         config.Isolated,
		enabled:          config.Enabled,
		wmtsEnabled:      config.WMTSEnabled,
		wmsEnabled:       config.WMSEnabled,
		wcsEnabled:       config.WCSEnabled,
		wpsEnabled:       config.WPSEnabled,
		wfsEnabled:       config.WFSEnabled,
		focusArea:        FocusBasicInfo,
		focusIndex:       0,
		spring:           harmonica.NewSpring(harmonica.FPS(60), 6.0, 0.5),
		animScale:        0.0,
		animVelocity:     0.0,
		animOpacity:      0.0,
		targetScale:      1.0,
		animating:        true,
	}
}

// SetSize sets the wizard size
func (w *WorkspaceWizard) SetSize(width, height int) {
	w.width = width
	w.height = height

	inputWidth := width/2 - 20
	if inputWidth < 30 {
		inputWidth = 30
	}
	w.nameInput.Width = inputWidth
}

// SetCallbacks sets the confirm and cancel callbacks
func (w *WorkspaceWizard) SetCallbacks(onConfirm func(WorkspaceWizardResult), onCancel func()) {
	w.onConfirm = onConfirm
	w.onCancel = onCancel
}

// IsVisible returns whether the wizard is visible
func (w *WorkspaceWizard) IsVisible() bool {
	return w.visible
}

// IsEditingField returns whether a field is being edited
func (w *WorkspaceWizard) IsEditingField() bool {
	return w.editingField
}

// GetOriginalName returns the original workspace name (for edit mode)
func (w *WorkspaceWizard) GetOriginalName() string {
	return w.originalName
}

// Hide hides the wizard
func (w *WorkspaceWizard) Hide() {
	w.visible = false
	w.animating = false
}

// animateCmd returns a command to continue the animation
func (w *WorkspaceWizard) animateCmd() tea.Cmd {
	return tea.Tick(time.Second/60, func(t time.Time) tea.Msg {
		return WorkspaceWizardAnimationMsg{ID: w.id}
	})
}

// Init initializes the wizard and starts the opening animation
func (w *WorkspaceWizard) Init() tea.Cmd {
	return w.animateCmd()
}

// startCloseAnimation starts the closing animation
func (w *WorkspaceWizard) startCloseAnimation() tea.Cmd {
	w.closing = true
	w.targetScale = 0.0
	w.animating = true
	return w.animateCmd()
}

// Update handles messages
func (w *WorkspaceWizard) Update(msg tea.Msg) (*WorkspaceWizard, tea.Cmd) {
	switch msg := msg.(type) {
	case WorkspaceWizardAnimationMsg:
		if msg.ID != w.id {
			return w, nil
		}
		return w.updateAnimation()

	case tea.KeyMsg:
		if !w.visible || w.animating {
			return w, nil
		}
		return w.handleKeyPress(msg)
	}

	return w, nil
}

// updateAnimation updates the harmonica physics animation
func (w *WorkspaceWizard) updateAnimation() (*WorkspaceWizard, tea.Cmd) {
	if !w.animating {
		return w, nil
	}

	w.animScale, w.animVelocity = w.spring.Update(w.animScale, w.animVelocity, w.targetScale)

	opacityStep := 0.1
	if w.closing {
		w.animOpacity -= opacityStep
		if w.animOpacity < 0 {
			w.animOpacity = 0
		}
	} else {
		w.animOpacity += opacityStep
		if w.animOpacity > 1 {
			w.animOpacity = 1
		}
	}

	scaleClose := absWS(w.animScale-w.targetScale) < 0.01 && absWS(w.animVelocity) < 0.01
	opacityClose := w.closing && w.animOpacity <= 0.01 || !w.closing && w.animOpacity >= 0.99

	if scaleClose && opacityClose {
		w.animating = false
		w.animScale = w.targetScale
		if w.closing {
			w.visible = false
			return w, nil
		}
	}

	return w, w.animateCmd()
}

func absWS(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

// handleKeyPress handles keyboard input
func (w *WorkspaceWizard) handleKeyPress(msg tea.KeyMsg) (*WorkspaceWizard, tea.Cmd) {
	// If editing the name field
	if w.editingField {
		switch msg.String() {
		case "enter", "esc":
			w.editingField = false
			w.nameInput.Blur()
			return w, nil
		default:
			var cmd tea.Cmd
			w.nameInput, cmd = w.nameInput.Update(msg)
			return w, cmd
		}
	}

	switch msg.String() {
	case "esc":
		if w.onCancel != nil {
			w.onCancel()
		}
		return w, w.startCloseAnimation()

	case "enter":
		// If on name field, start editing
		if w.focusArea == FocusBasicInfo && w.focusIndex == 0 {
			w.editingField = true
			w.nameInput.Focus()
			return w, nil
		}
		// Otherwise toggle the checkbox
		w.toggleCurrentCheckbox()

	case "space":
		// Toggle checkbox
		w.toggleCurrentCheckbox()

	case "tab", "down", "j":
		w.moveNext()

	case "shift+tab", "up", "k":
		w.movePrev()

	case "ctrl+s":
		// Save
		if w.validateInputs() {
			if w.onConfirm != nil {
				w.onConfirm(w.buildResult())
			}
			return w, w.startCloseAnimation()
		}
	}

	return w, nil
}

// toggleCurrentCheckbox toggles the currently focused checkbox
func (w *WorkspaceWizard) toggleCurrentCheckbox() {
	switch w.focusArea {
	case FocusBasicInfo:
		switch w.focusIndex {
		case 1:
			w.defaultWorkspace = !w.defaultWorkspace
		case 2:
			w.isolated = !w.isolated
		}
	case FocusServices:
		switch w.focusIndex {
		case 0:
			w.wmtsEnabled = !w.wmtsEnabled
		case 1:
			w.wmsEnabled = !w.wmsEnabled
		case 2:
			w.wcsEnabled = !w.wcsEnabled
		case 3:
			w.wpsEnabled = !w.wpsEnabled
		case 4:
			w.wfsEnabled = !w.wfsEnabled
		}
	case FocusSettings:
		if w.focusIndex == 0 {
			w.enabled = !w.enabled
		}
	}
}

// moveNext moves focus to the next item
func (w *WorkspaceWizard) moveNext() {
	switch w.focusArea {
	case FocusBasicInfo:
		if w.focusIndex < 2 { // name, default, isolated
			w.focusIndex++
		} else {
			w.focusArea = FocusServices
			w.focusIndex = 0
		}
	case FocusServices:
		if w.focusIndex < 4 { // wmts, wms, wcs, wps, wfs
			w.focusIndex++
		} else {
			w.focusArea = FocusSettings
			w.focusIndex = 0
		}
	case FocusSettings:
		// Stay at settings enabled, wrap to top
		w.focusArea = FocusBasicInfo
		w.focusIndex = 0
	}
}

// movePrev moves focus to the previous item
func (w *WorkspaceWizard) movePrev() {
	switch w.focusArea {
	case FocusBasicInfo:
		if w.focusIndex > 0 {
			w.focusIndex--
		} else {
			w.focusArea = FocusSettings
			w.focusIndex = 0
		}
	case FocusServices:
		if w.focusIndex > 0 {
			w.focusIndex--
		} else {
			w.focusArea = FocusBasicInfo
			w.focusIndex = 2
		}
	case FocusSettings:
		w.focusArea = FocusServices
		w.focusIndex = 4
	}
}

// validateInputs checks if required fields are filled
func (w *WorkspaceWizard) validateInputs() bool {
	return strings.TrimSpace(w.nameInput.Value()) != ""
}

// buildResult creates the result from current state
func (w *WorkspaceWizard) buildResult() WorkspaceWizardResult {
	return WorkspaceWizardResult{
		Confirmed: true,
		Config: models.WorkspaceConfig{
			Name:        strings.TrimSpace(w.nameInput.Value()),
			Isolated:    w.isolated,
			Default:     w.defaultWorkspace,
			Enabled:     w.enabled,
			WMTSEnabled: w.wmtsEnabled,
			WMSEnabled:  w.wmsEnabled,
			WCSEnabled:  w.wcsEnabled,
			WPSEnabled:  w.wpsEnabled,
			WFSEnabled:  w.wfsEnabled,
		},
	}
}

// View renders the wizard with animation
func (w *WorkspaceWizard) View() string {
	if !w.visible {
		return ""
	}

	dialogWidth := w.width/2 + 10
	if dialogWidth < 60 {
		dialogWidth = 60
	}

	scaledWidth := int(float64(dialogWidth) * w.animScale)
	if scaledWidth < 10 {
		scaledWidth = 10
	}

	dialogStyle := styles.DialogStyle.Width(scaledWidth)
	marginOffset := int((1.0 - w.animScale) * 5)
	dialogStyle = dialogStyle.MarginTop(marginOffset).MarginBottom(marginOffset)

	// When closing, render empty frame only
	if w.closing {
		dialog := dialogStyle.Render("")
		return styles.Center(w.width, w.height, dialog)
	}

	var b strings.Builder

	// Title
	title := "Create Workspace"
	if w.mode == WorkspaceWizardModeEdit {
		title = "Edit Workspace"
	}
	b.WriteString(styles.DialogTitleStyle.Render(title))
	b.WriteString("\n\n")

	// Basic Info section
	b.WriteString(styles.PanelHeaderStyle.Render("Basic Info"))
	b.WriteString("\n\n")

	// Name field
	b.WriteString(w.renderInputField(0, "Name", w.nameInput.View(), FocusBasicInfo, 0))
	// Default Workspace checkbox
	b.WriteString(w.renderCheckbox("Default Workspace", w.defaultWorkspace, FocusBasicInfo, 1))
	// Isolated Workspace checkbox
	b.WriteString(w.renderCheckbox("Isolated Workspace", w.isolated, FocusBasicInfo, 2))

	b.WriteString("\n")

	// Services section
	b.WriteString(styles.PanelHeaderStyle.Render("Services"))
	b.WriteString("\n\n")

	b.WriteString(w.renderCheckbox("WMTS", w.wmtsEnabled, FocusServices, 0))
	b.WriteString(w.renderCheckbox("WMS", w.wmsEnabled, FocusServices, 1))
	b.WriteString(w.renderCheckbox("WCS", w.wcsEnabled, FocusServices, 2))
	b.WriteString(w.renderCheckbox("WPS", w.wpsEnabled, FocusServices, 3))
	b.WriteString(w.renderCheckbox("WFS", w.wfsEnabled, FocusServices, 4))

	b.WriteString("\n")

	// Settings section
	b.WriteString(styles.PanelHeaderStyle.Render("Settings"))
	b.WriteString("\n\n")

	b.WriteString(w.renderCheckbox("Enabled", w.enabled, FocusSettings, 0))

	b.WriteString("\n")

	// Help text
	if w.editingField {
		b.WriteString(styles.HelpTextStyle.Render("Enter:accept  Esc:cancel edit"))
	} else {
		b.WriteString(styles.HelpTextStyle.Render("j/k:navigate  Enter/Space:toggle  Ctrl+S:save  Esc:cancel"))
	}

	dialog := dialogStyle.Render(b.String())

	if w.animOpacity < 1.0 {
		fadedStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#666666"))
		if w.animOpacity > 0.5 {
			dialog = lipgloss.NewStyle().Render(dialog)
		} else {
			dialog = fadedStyle.Render(dialog)
		}
	}

	return styles.Center(w.width, w.height, dialog)
}

// renderInputField renders an input field
func (w *WorkspaceWizard) renderInputField(index int, label, inputView string, area WorkspaceWizardFocusArea, itemIndex int) string {
	var b strings.Builder

	isFocused := w.focusArea == area && w.focusIndex == itemIndex

	var indicator string
	if isFocused {
		if w.editingField {
			indicator = styles.ConnectedStyle.Render("▶ ")
		} else {
			indicator = styles.SelectedItemStyle.Render("● ")
		}
	} else {
		indicator = "  "
	}

	labelStr := styles.ItemStyle.Width(18).Render(label + ":")

	var inputStyle lipgloss.Style
	if isFocused && w.editingField {
		inputStyle = styles.FocusedInputStyle
	} else if isFocused {
		inputStyle = styles.ActiveItemStyle
	} else {
		inputStyle = styles.InputStyle
	}

	b.WriteString(indicator)
	b.WriteString(labelStr)
	b.WriteString(inputStyle.Render(inputView))
	b.WriteString("\n\n")

	return b.String()
}

// renderCheckbox renders a checkbox item
func (w *WorkspaceWizard) renderCheckbox(label string, checked bool, area WorkspaceWizardFocusArea, itemIndex int) string {
	var b strings.Builder

	isFocused := w.focusArea == area && w.focusIndex == itemIndex

	var indicator string
	if isFocused {
		indicator = styles.SelectedItemStyle.Render("● ")
	} else {
		indicator = "  "
	}

	var checkbox string
	if checked {
		checkbox = styles.ConnectedStyle.Render("[x] ")
	} else {
		checkbox = styles.MutedStyle.Render("[ ] ")
	}

	var labelStyle lipgloss.Style
	if isFocused {
		labelStyle = styles.ActiveItemStyle
	} else {
		labelStyle = styles.ItemStyle
	}

	b.WriteString(indicator)
	b.WriteString(checkbox)
	b.WriteString(labelStyle.Render(label))
	b.WriteString("\n")

	return b.String()
}
