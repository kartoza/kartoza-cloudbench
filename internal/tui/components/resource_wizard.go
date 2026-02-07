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

// ResourceWizardType represents what type of resource we're editing
type ResourceWizardType int

const (
	ResourceTypeLayer ResourceWizardType = iota
	ResourceTypeDataStore
	ResourceTypeCoverageStore
)

// ResourceWizardResult represents the result of the wizard
type ResourceWizardResult struct {
	Confirmed           bool
	ResourceType        ResourceWizardType
	LayerConfig         *models.LayerConfig
	DataStoreConfig     *models.DataStoreConfig
	CoverageStoreConfig *models.CoverageStoreConfig
}

// ResourceWizardAnimationMsg is sent to update animation state
type ResourceWizardAnimationMsg struct {
	ID string
}

// ResourceWizard is a dialog for editing layers/stores with toggle options
type ResourceWizard struct {
	id           string
	resourceType ResourceWizardType
	width        int
	height       int
	visible      bool
	onConfirm    func(ResourceWizardResult)
	onCancel     func()

	// Common fields
	nameInput   textinput.Model
	workspace   string
	storeName   string // For layers - which store they belong to
	storeType   string // "datastore" or "coveragestore"

	// Layer-specific toggles
	layerEnabled    bool
	layerAdvertised bool
	layerQueryable  bool
	isVectorLayer   bool // queryable only applies to vector layers

	// Store-specific toggles
	storeEnabled bool
	descInput    textinput.Model

	// Navigation
	focusIndex   int
	editingField bool
	totalItems   int // Number of navigable items

	// Animation
	spring       harmonica.Spring
	animScale    float64
	animVelocity float64
	animOpacity  float64
	targetScale  float64
	animating    bool
	closing      bool
}

// NewLayerWizard creates a wizard for editing a layer
func NewLayerWizard(config *models.LayerConfig) *ResourceWizard {
	nameInput := textinput.New()
	nameInput.Placeholder = "layer-name"
	nameInput.CharLimit = 256
	nameInput.SetValue(config.Name)

	isVector := config.StoreType == "datastore"
	totalItems := 3 // name, enabled, advertised
	if isVector {
		totalItems = 4 // + queryable
	}

	return &ResourceWizard{
		id:              "layer-wizard",
		resourceType:    ResourceTypeLayer,
		visible:         true,
		nameInput:       nameInput,
		workspace:       config.Workspace,
		storeName:       config.Store,
		storeType:       config.StoreType,
		layerEnabled:    config.Enabled,
		layerAdvertised: config.Advertised,
		layerQueryable:  config.Queryable,
		isVectorLayer:   isVector,
		focusIndex:      0,
		totalItems:      totalItems,
		spring:          harmonica.NewSpring(harmonica.FPS(60), 6.0, 0.5),
		animScale:       0.0,
		animVelocity:    0.0,
		animOpacity:     0.0,
		targetScale:     1.0,
		animating:       true,
	}
}

// NewDataStoreWizardEdit creates a wizard for editing a data store
func NewDataStoreWizardEdit(config *models.DataStoreConfig) *ResourceWizard {
	nameInput := textinput.New()
	nameInput.Placeholder = "store-name"
	nameInput.CharLimit = 256
	nameInput.SetValue(config.Name)

	descInput := textinput.New()
	descInput.Placeholder = "Optional description"
	descInput.CharLimit = 512
	descInput.SetValue(config.Description)

	return &ResourceWizard{
		id:           "datastore-wizard-edit",
		resourceType: ResourceTypeDataStore,
		visible:      true,
		nameInput:    nameInput,
		descInput:    descInput,
		workspace:    config.Workspace,
		storeEnabled: config.Enabled,
		focusIndex:   0,
		totalItems:   3, // name, enabled, description
		spring:       harmonica.NewSpring(harmonica.FPS(60), 6.0, 0.5),
		animScale:    0.0,
		animVelocity: 0.0,
		animOpacity:  0.0,
		targetScale:  1.0,
		animating:    true,
	}
}

// NewCoverageStoreWizardEdit creates a wizard for editing a coverage store
func NewCoverageStoreWizardEdit(config *models.CoverageStoreConfig) *ResourceWizard {
	nameInput := textinput.New()
	nameInput.Placeholder = "store-name"
	nameInput.CharLimit = 256
	nameInput.SetValue(config.Name)

	descInput := textinput.New()
	descInput.Placeholder = "Optional description"
	descInput.CharLimit = 512
	descInput.SetValue(config.Description)

	return &ResourceWizard{
		id:           "coveragestore-wizard-edit",
		resourceType: ResourceTypeCoverageStore,
		visible:      true,
		nameInput:    nameInput,
		descInput:    descInput,
		workspace:    config.Workspace,
		storeEnabled: config.Enabled,
		focusIndex:   0,
		totalItems:   3, // name, enabled, description
		spring:       harmonica.NewSpring(harmonica.FPS(60), 6.0, 0.5),
		animScale:    0.0,
		animVelocity: 0.0,
		animOpacity:  0.0,
		targetScale:  1.0,
		animating:    true,
	}
}

// SetSize sets the wizard size
func (w *ResourceWizard) SetSize(width, height int) {
	w.width = width
	w.height = height

	inputWidth := width/2 - 20
	if inputWidth < 30 {
		inputWidth = 30
	}
	w.nameInput.Width = inputWidth
	w.descInput.Width = inputWidth
}

// SetCallbacks sets the confirm and cancel callbacks
func (w *ResourceWizard) SetCallbacks(onConfirm func(ResourceWizardResult), onCancel func()) {
	w.onConfirm = onConfirm
	w.onCancel = onCancel
}

// IsVisible returns whether the wizard is visible
func (w *ResourceWizard) IsVisible() bool {
	return w.visible
}

// IsEditingField returns whether a field is being edited
func (w *ResourceWizard) IsEditingField() bool {
	return w.editingField
}

// GetWorkspace returns the workspace name
func (w *ResourceWizard) GetWorkspace() string {
	return w.workspace
}

// Hide hides the wizard
func (w *ResourceWizard) Hide() {
	w.visible = false
	w.animating = false
}

// animateCmd returns a command to continue the animation
func (w *ResourceWizard) animateCmd() tea.Cmd {
	return tea.Tick(time.Second/60, func(t time.Time) tea.Msg {
		return ResourceWizardAnimationMsg{ID: w.id}
	})
}

// Init initializes the wizard and starts the opening animation
func (w *ResourceWizard) Init() tea.Cmd {
	return w.animateCmd()
}

// startCloseAnimation starts the closing animation
func (w *ResourceWizard) startCloseAnimation() tea.Cmd {
	w.closing = true
	w.targetScale = 0.0
	w.animating = true
	return w.animateCmd()
}

// Update handles messages
func (w *ResourceWizard) Update(msg tea.Msg) (*ResourceWizard, tea.Cmd) {
	switch msg := msg.(type) {
	case ResourceWizardAnimationMsg:
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
func (w *ResourceWizard) updateAnimation() (*ResourceWizard, tea.Cmd) {
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

	scaleClose := absRW(w.animScale-w.targetScale) < 0.01 && absRW(w.animVelocity) < 0.01
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

func absRW(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

// handleKeyPress handles keyboard input
func (w *ResourceWizard) handleKeyPress(msg tea.KeyMsg) (*ResourceWizard, tea.Cmd) {
	// If editing a text field
	if w.editingField {
		switch msg.String() {
		case "enter", "esc":
			w.editingField = false
			w.nameInput.Blur()
			w.descInput.Blur()
			return w, nil
		default:
			var cmd tea.Cmd
			if w.focusIndex == 0 {
				w.nameInput, cmd = w.nameInput.Update(msg)
			} else if w.resourceType != ResourceTypeLayer && w.focusIndex == 2 {
				// Description field for stores
				w.descInput, cmd = w.descInput.Update(msg)
			}
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
		// Check if this is a text input field
		if w.isTextInputField(w.focusIndex) {
			w.editingField = true
			if w.focusIndex == 0 {
				w.nameInput.Focus()
			} else if w.resourceType != ResourceTypeLayer && w.focusIndex == 2 {
				w.descInput.Focus()
			}
			return w, nil
		}
		// Otherwise toggle the checkbox
		w.toggleCurrentCheckbox()

	case "space":
		// Toggle checkbox (only for checkboxes)
		if !w.isTextInputField(w.focusIndex) {
			w.toggleCurrentCheckbox()
		}

	case "tab", "down", "j":
		w.focusIndex = (w.focusIndex + 1) % w.totalItems

	case "shift+tab", "up", "k":
		w.focusIndex = (w.focusIndex - 1 + w.totalItems) % w.totalItems

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

// isTextInputField returns true if the current focus index is a text input field
func (w *ResourceWizard) isTextInputField(index int) bool {
	if index == 0 {
		return true // Name field
	}
	if w.resourceType != ResourceTypeLayer && index == 2 {
		return true // Description field for stores
	}
	return false
}

// toggleCurrentCheckbox toggles the currently focused checkbox
func (w *ResourceWizard) toggleCurrentCheckbox() {
	switch w.resourceType {
	case ResourceTypeLayer:
		switch w.focusIndex {
		case 1:
			w.layerEnabled = !w.layerEnabled
		case 2:
			w.layerAdvertised = !w.layerAdvertised
		case 3:
			if w.isVectorLayer {
				w.layerQueryable = !w.layerQueryable
			}
		}
	case ResourceTypeDataStore, ResourceTypeCoverageStore:
		if w.focusIndex == 1 {
			w.storeEnabled = !w.storeEnabled
		}
	}
}

// validateInputs checks if required fields are filled
func (w *ResourceWizard) validateInputs() bool {
	return strings.TrimSpace(w.nameInput.Value()) != ""
}

// buildResult creates the result from current state
func (w *ResourceWizard) buildResult() ResourceWizardResult {
	result := ResourceWizardResult{
		Confirmed:    true,
		ResourceType: w.resourceType,
	}

	switch w.resourceType {
	case ResourceTypeLayer:
		result.LayerConfig = &models.LayerConfig{
			Name:       strings.TrimSpace(w.nameInput.Value()),
			Workspace:  w.workspace,
			Store:      w.storeName,
			StoreType:  w.storeType,
			Enabled:    w.layerEnabled,
			Advertised: w.layerAdvertised,
			Queryable:  w.layerQueryable,
		}
	case ResourceTypeDataStore:
		result.DataStoreConfig = &models.DataStoreConfig{
			Name:        strings.TrimSpace(w.nameInput.Value()),
			Workspace:   w.workspace,
			Enabled:     w.storeEnabled,
			Description: strings.TrimSpace(w.descInput.Value()),
		}
	case ResourceTypeCoverageStore:
		result.CoverageStoreConfig = &models.CoverageStoreConfig{
			Name:        strings.TrimSpace(w.nameInput.Value()),
			Workspace:   w.workspace,
			Enabled:     w.storeEnabled,
			Description: strings.TrimSpace(w.descInput.Value()),
		}
	}

	return result
}

// View renders the wizard with animation
func (w *ResourceWizard) View() string {
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
	var title string
	switch w.resourceType {
	case ResourceTypeLayer:
		title = "Edit Layer"
	case ResourceTypeDataStore:
		title = "Edit Data Store"
	case ResourceTypeCoverageStore:
		title = "Edit Coverage Store"
	}
	b.WriteString(styles.DialogTitleStyle.Render(title))
	b.WriteString("\n\n")

	switch w.resourceType {
	case ResourceTypeLayer:
		b.WriteString(w.renderLayerForm())
	case ResourceTypeDataStore, ResourceTypeCoverageStore:
		b.WriteString(w.renderStoreForm())
	}

	// Help text
	b.WriteString("\n")
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

// renderLayerForm renders the layer edit form
func (w *ResourceWizard) renderLayerForm() string {
	var b strings.Builder

	// Info section
	b.WriteString(styles.MutedStyle.Render("Workspace: " + w.workspace))
	b.WriteString("\n\n")

	// Name field (index 0)
	b.WriteString(w.renderInputField(0, "Name", w.nameInput.View()))

	// Enabled checkbox (index 1)
	b.WriteString(w.renderCheckbox("Enabled", w.layerEnabled, 1))

	// Advertised checkbox (index 2)
	b.WriteString(w.renderCheckbox("Advertised", w.layerAdvertised, 2))

	// Queryable checkbox (index 3) - only for vector layers
	if w.isVectorLayer {
		b.WriteString(w.renderCheckbox("Queryable", w.layerQueryable, 3))
	}

	return b.String()
}

// renderStoreForm renders the store edit form
func (w *ResourceWizard) renderStoreForm() string {
	var b strings.Builder

	// Info section
	b.WriteString(styles.MutedStyle.Render("Workspace: " + w.workspace))
	b.WriteString("\n\n")

	// Name field (index 0)
	b.WriteString(w.renderInputField(0, "Name", w.nameInput.View()))

	// Enabled checkbox (index 1)
	b.WriteString(w.renderCheckbox("Enabled", w.storeEnabled, 1))

	// Description field (index 2)
	b.WriteString(w.renderInputField(2, "Description", w.descInput.View()))

	return b.String()
}

// renderInputField renders an input field
func (w *ResourceWizard) renderInputField(index int, label, inputView string) string {
	var b strings.Builder

	isFocused := w.focusIndex == index

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

	labelStr := styles.ItemStyle.Width(14).Render(label + ":")

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
func (w *ResourceWizard) renderCheckbox(label string, checked bool, index int) string {
	var b strings.Builder

	isFocused := w.focusIndex == index

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
