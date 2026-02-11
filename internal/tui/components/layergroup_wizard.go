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

// LayerGroupMode represents the layer group mode
type LayerGroupMode int

const (
	LayerGroupModeSingle LayerGroupMode = iota
	LayerGroupModeNamed
	LayerGroupModeContainer
	LayerGroupModeEO
)

func (m LayerGroupMode) String() string {
	switch m {
	case LayerGroupModeSingle:
		return "SINGLE"
	case LayerGroupModeNamed:
		return "NAMED"
	case LayerGroupModeContainer:
		return "CONTAINER"
	case LayerGroupModeEO:
		return "EO"
	default:
		return "SINGLE"
	}
}

func (m LayerGroupMode) Description() string {
	switch m {
	case LayerGroupModeSingle:
		return "Layers merged into single WMS layer"
	case LayerGroupModeNamed:
		return "Each layer visible separately"
	case LayerGroupModeContainer:
		return "Organizational container only"
	case LayerGroupModeEO:
		return "Earth Observation specific"
	default:
		return ""
	}
}

// LayerGroupWizardMode represents whether we're creating or editing
type LayerGroupWizardMode int

const (
	LayerGroupWizardModeCreate LayerGroupWizardMode = iota
	LayerGroupWizardModeEdit
)

// LayerGroupWizardStep represents the current step
type LayerGroupWizardStep int

const (
	LayerGroupStepBasicInfo LayerGroupWizardStep = iota
	LayerGroupStepSelectMode
	LayerGroupStepSelectLayers
	LayerGroupStepReview
)

// LayerStyleAssignment represents a layer with its assigned style
type LayerStyleAssignment struct {
	LayerName       string   // Layer name (workspace:layer format)
	StyleName       string   // Selected style name (empty for default)
	AvailableStyles []string // Available styles for this layer
}

// LayerGroupWizardResult represents the wizard result
type LayerGroupWizardResult struct {
	Confirmed    bool
	Name         string
	Title        string
	Mode         string
	Layers       []string                // Selected layer names in workspace:layer format
	LayerStyles  []LayerStyleAssignment  // Layer style assignments
}

// LayerGroupWizardAnimationMsg is sent to update animation state
type LayerGroupWizardAnimationMsg struct {
	ID string
}

// LayerGroupWizard is a wizard for creating and editing layer groups
type LayerGroupWizard struct {
	id           string
	mode         LayerGroupWizardMode
	step         LayerGroupWizardStep
	workspace    string
	width        int
	height       int
	visible      bool
	onConfirm    func(LayerGroupWizardResult)
	onCancel     func()

	// Layer group properties
	groupName       string
	originalName    string
	title           string
	groupMode       LayerGroupMode
	modeOptions     []LayerGroupMode
	selectedModeIdx int

	// Available layers
	availableLayers []models.Layer
	selectedLayers  map[string]bool              // layer name -> selected
	layerStyles     map[string]*LayerStyleAssignment // layer name -> style assignment
	layerListOffset int
	layerCursor     int
	editingStyle    bool  // Whether we're in style selection mode for current layer

	// Input fields
	nameInput   textinput.Model
	titleInput  textinput.Model
	focusIndex  int
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

// NewLayerGroupWizard creates a new wizard for creating layer groups
func NewLayerGroupWizard(workspace string) *LayerGroupWizard {
	nameInput := textinput.New()
	nameInput.Placeholder = "Enter layer group name"
	nameInput.CharLimit = 100
	nameInput.Width = 40

	titleInput := textinput.New()
	titleInput.Placeholder = "Enter display title (optional)"
	titleInput.CharLimit = 200
	titleInput.Width = 40

	return &LayerGroupWizard{
		id:             "layergroup-wizard",
		mode:           LayerGroupWizardModeCreate,
		step:           LayerGroupStepBasicInfo,
		workspace:      workspace,
		visible:        true,
		modeOptions:    []LayerGroupMode{LayerGroupModeSingle, LayerGroupModeNamed, LayerGroupModeContainer, LayerGroupModeEO},
		selectedModeIdx: 0,
		groupMode:      LayerGroupModeSingle,
		selectedLayers: make(map[string]bool),
		layerStyles:    make(map[string]*LayerStyleAssignment),
		nameInput:      nameInput,
		titleInput:     titleInput,
		spring:         harmonica.NewSpring(harmonica.FPS(60), 6.0, 0.5),
		animScale:      0.0,
		animVelocity:   0.0,
		animOpacity:    0.0,
		targetScale:    1.0,
		animating:      true,
	}
}

// NewLayerGroupWizardForEdit creates a wizard for editing an existing layer group
func NewLayerGroupWizardForEdit(workspace string, details *models.LayerGroupDetails) *LayerGroupWizard {
	w := NewLayerGroupWizard(workspace)
	w.mode = LayerGroupWizardModeEdit
	w.step = LayerGroupStepBasicInfo
	w.groupName = details.Name
	w.originalName = details.Name
	w.title = details.Title
	w.nameInput.SetValue(details.Name)
	w.titleInput.SetValue(details.Title)

	// Set mode
	switch details.Mode {
	case "SINGLE":
		w.groupMode = LayerGroupModeSingle
		w.selectedModeIdx = 0
	case "NAMED":
		w.groupMode = LayerGroupModeNamed
		w.selectedModeIdx = 1
	case "CONTAINER":
		w.groupMode = LayerGroupModeContainer
		w.selectedModeIdx = 2
	case "EO":
		w.groupMode = LayerGroupModeEO
		w.selectedModeIdx = 3
	}

	// Mark existing layers as selected and store their styles
	for _, item := range details.Layers {
		w.selectedLayers[item.Name] = true
		w.layerStyles[item.Name] = &LayerStyleAssignment{
			LayerName: item.Name,
			StyleName: item.StyleName,
		}
	}

	return w
}

// SetAvailableLayers sets the layers available for selection
func (w *LayerGroupWizard) SetAvailableLayers(layers []models.Layer) {
	w.availableLayers = layers
}

// SetLayerStyles sets the available styles for a specific layer
func (w *LayerGroupWizard) SetLayerStyles(layerName string, styles []string) {
	if assignment, ok := w.layerStyles[layerName]; ok {
		assignment.AvailableStyles = styles
	} else {
		w.layerStyles[layerName] = &LayerStyleAssignment{
			LayerName:       layerName,
			AvailableStyles: styles,
		}
	}
}

// SetSize sets the wizard size
func (w *LayerGroupWizard) SetSize(width, height int) {
	w.width = width
	w.height = height
	w.nameInput.Width = width/2 - 20
	w.titleInput.Width = width/2 - 20
}

// SetCallbacks sets the confirm and cancel callbacks
func (w *LayerGroupWizard) SetCallbacks(onConfirm func(LayerGroupWizardResult), onCancel func()) {
	w.onConfirm = onConfirm
	w.onCancel = onCancel
}

// IsVisible returns whether the wizard is visible
func (w *LayerGroupWizard) IsVisible() bool {
	return w.visible
}

// IsActive returns whether the wizard is visible and not in closing animation
func (w *LayerGroupWizard) IsActive() bool {
	return w.visible && !w.closing
}

// IsEditingField returns whether a field is being edited
func (w *LayerGroupWizard) IsEditingField() bool {
	return w.editingField
}

// Hide hides the wizard
func (w *LayerGroupWizard) Hide() {
	w.visible = false
	w.animating = false
}

// animateCmd returns a command to continue the animation
func (w *LayerGroupWizard) animateCmd() tea.Cmd {
	return tea.Tick(time.Second/60, func(t time.Time) tea.Msg {
		return LayerGroupWizardAnimationMsg{ID: w.id}
	})
}

// Init initializes the wizard
func (w *LayerGroupWizard) Init() tea.Cmd {
	return w.animateCmd()
}

// startCloseAnimation starts the closing animation
func (w *LayerGroupWizard) startCloseAnimation() tea.Cmd {
	w.closing = true
	w.targetScale = 0.0
	w.animating = true
	return w.animateCmd()
}

// Update handles messages
func (w *LayerGroupWizard) Update(msg tea.Msg) (*LayerGroupWizard, tea.Cmd) {
	switch msg := msg.(type) {
	case LayerGroupWizardAnimationMsg:
		if msg.ID != w.id {
			return w, nil
		}
		return w.updateAnimation()

	case tea.KeyMsg:
		if !w.visible || w.animating {
			return w, nil
		}

		switch w.step {
		case LayerGroupStepBasicInfo:
			return w.updateBasicInfo(msg)
		case LayerGroupStepSelectMode:
			return w.updateModeSelection(msg)
		case LayerGroupStepSelectLayers:
			return w.updateLayerSelection(msg)
		case LayerGroupStepReview:
			return w.updateReview(msg)
		}
	}

	return w, nil
}

// updateAnimation updates the harmonica physics animation
func (w *LayerGroupWizard) updateAnimation() (*LayerGroupWizard, tea.Cmd) {
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

	scaleClose := absFloat(w.animScale-w.targetScale) < 0.01 && absFloat(w.animVelocity) < 0.01
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

// updateBasicInfo handles key presses in basic info step
func (w *LayerGroupWizard) updateBasicInfo(msg tea.KeyMsg) (*LayerGroupWizard, tea.Cmd) {
	if w.editingField {
		switch msg.String() {
		case "enter", "tab":
			w.editingField = false
			if w.focusIndex == 0 {
				w.groupName = w.nameInput.Value()
				w.nameInput.Blur()
			} else {
				w.title = w.titleInput.Value()
				w.titleInput.Blur()
			}
			return w, nil
		case "esc":
			w.editingField = false
			if w.focusIndex == 0 {
				w.nameInput.Blur()
			} else {
				w.titleInput.Blur()
			}
			return w, nil
		default:
			var cmd tea.Cmd
			if w.focusIndex == 0 {
				w.nameInput, cmd = w.nameInput.Update(msg)
				w.groupName = w.nameInput.Value()
			} else {
				w.titleInput, cmd = w.titleInput.Update(msg)
				w.title = w.titleInput.Value()
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
		if w.focusIndex == 0 || w.focusIndex == 1 {
			w.editingField = true
			if w.focusIndex == 0 {
				w.nameInput.Focus()
			} else {
				w.titleInput.Focus()
			}
		} else {
			// Continue to next step
			w.step = LayerGroupStepSelectMode
		}
	case "tab", "down", "j":
		w.focusIndex++
		if w.focusIndex > 2 {
			w.focusIndex = 0
		}
	case "shift+tab", "up", "k":
		w.focusIndex--
		if w.focusIndex < 0 {
			w.focusIndex = 2
		}
	}

	return w, nil
}

// updateModeSelection handles key presses in mode selection step
func (w *LayerGroupWizard) updateModeSelection(msg tea.KeyMsg) (*LayerGroupWizard, tea.Cmd) {
	switch msg.String() {
	case "up", "k":
		if w.selectedModeIdx > 0 {
			w.selectedModeIdx--
		}
	case "down", "j":
		if w.selectedModeIdx < len(w.modeOptions)-1 {
			w.selectedModeIdx++
		}
	case "enter":
		w.groupMode = w.modeOptions[w.selectedModeIdx]
		w.step = LayerGroupStepSelectLayers
	case "esc":
		w.step = LayerGroupStepBasicInfo
	}

	return w, nil
}

// updateLayerSelection handles key presses in layer selection step
func (w *LayerGroupWizard) updateLayerSelection(msg tea.KeyMsg) (*LayerGroupWizard, tea.Cmd) {
	maxVisible := w.height - 20
	if maxVisible < 5 {
		maxVisible = 5
	}

	switch msg.String() {
	case "up", "k":
		if w.layerCursor > 0 {
			w.layerCursor--
			if w.layerCursor < w.layerListOffset {
				w.layerListOffset = w.layerCursor
			}
		}
	case "down", "j":
		if w.layerCursor < len(w.availableLayers)-1 {
			w.layerCursor++
			if w.layerCursor >= w.layerListOffset+maxVisible {
				w.layerListOffset = w.layerCursor - maxVisible + 1
			}
		}
	case "left", "h":
		// Cycle style backwards for currently selected layer
		w.cycleLayerStyle(-1)
	case "right", "l":
		// Cycle style forwards for currently selected layer
		w.cycleLayerStyle(1)
	case " ", "space":
		// Toggle selection
		if w.layerCursor < len(w.availableLayers) {
			layer := w.availableLayers[w.layerCursor]
			layerKey := w.workspace + ":" + layer.Name
			if w.selectedLayers[layerKey] {
				delete(w.selectedLayers, layerKey)
			} else {
				w.selectedLayers[layerKey] = true
				// Initialize style assignment if not exists
				if _, ok := w.layerStyles[layerKey]; !ok {
					w.layerStyles[layerKey] = &LayerStyleAssignment{
						LayerName: layerKey,
						StyleName: "", // Use default
					}
				}
			}
		}
	case "a":
		// Select all
		for _, layer := range w.availableLayers {
			layerKey := w.workspace + ":" + layer.Name
			w.selectedLayers[layerKey] = true
			// Initialize style assignment if not exists
			if _, ok := w.layerStyles[layerKey]; !ok {
				w.layerStyles[layerKey] = &LayerStyleAssignment{
					LayerName: layerKey,
					StyleName: "", // Use default
				}
			}
		}
	case "n":
		// Select none
		w.selectedLayers = make(map[string]bool)
	case "enter":
		if len(w.selectedLayers) > 0 {
			w.step = LayerGroupStepReview
		}
	case "esc":
		w.step = LayerGroupStepSelectMode
	}

	return w, nil
}

// cycleLayerStyle cycles through available styles for the current layer
func (w *LayerGroupWizard) cycleLayerStyle(direction int) {
	if w.layerCursor >= len(w.availableLayers) {
		return
	}

	layer := w.availableLayers[w.layerCursor]
	layerKey := w.workspace + ":" + layer.Name

	// Only allow style cycling for selected layers
	if !w.selectedLayers[layerKey] {
		return
	}

	assignment, ok := w.layerStyles[layerKey]
	if !ok || len(assignment.AvailableStyles) == 0 {
		return
	}

	styles := assignment.AvailableStyles
	currentIdx := -1 // -1 means "default" (empty string)

	// Find current style index
	if assignment.StyleName != "" {
		for i, s := range styles {
			if s == assignment.StyleName {
				currentIdx = i
				break
			}
		}
	}

	// Cycle to next/prev style
	newIdx := currentIdx + direction
	if newIdx < -1 {
		newIdx = len(styles) - 1 // Wrap to last
	} else if newIdx >= len(styles) {
		newIdx = -1 // Wrap to default
	}

	if newIdx == -1 {
		assignment.StyleName = "" // Default
	} else {
		assignment.StyleName = styles[newIdx]
	}
}

// updateReview handles key presses in review step
func (w *LayerGroupWizard) updateReview(msg tea.KeyMsg) (*LayerGroupWizard, tea.Cmd) {
	switch msg.String() {
	case "enter", "ctrl+s":
		if w.validate() {
			if w.onConfirm != nil {
				w.onConfirm(w.buildResult())
			}
			return w, w.startCloseAnimation()
		}
	case "esc":
		w.step = LayerGroupStepSelectLayers
	}

	return w, nil
}

// validate checks if the inputs are valid
func (w *LayerGroupWizard) validate() bool {
	w.groupName = strings.TrimSpace(w.nameInput.Value())
	if w.groupName == "" {
		return false
	}
	if len(w.selectedLayers) == 0 {
		return false
	}
	return true
}

// buildResult creates the result from the current state
func (w *LayerGroupWizard) buildResult() LayerGroupWizardResult {
	layers := make([]string, 0, len(w.selectedLayers))
	layerStyles := make([]LayerStyleAssignment, 0, len(w.selectedLayers))

	for layerName := range w.selectedLayers {
		layers = append(layers, layerName)
		// Include style assignment if available
		if assignment, ok := w.layerStyles[layerName]; ok {
			layerStyles = append(layerStyles, *assignment)
		} else {
			layerStyles = append(layerStyles, LayerStyleAssignment{
				LayerName: layerName,
				StyleName: "", // Use default
			})
		}
	}

	return LayerGroupWizardResult{
		Confirmed:   true,
		Name:        strings.TrimSpace(w.nameInput.Value()),
		Title:       strings.TrimSpace(w.titleInput.Value()),
		Mode:        w.groupMode.String(),
		Layers:      layers,
		LayerStyles: layerStyles,
	}
}

// View renders the wizard
func (w *LayerGroupWizard) View() string {
	if !w.visible {
		return ""
	}

	// Calculate dimensions with animation
	dialogWidth := int(float64(w.width*2/3) * w.animScale)
	dialogHeight := int(float64(w.height-6) * w.animScale)

	if dialogWidth < 60 {
		dialogWidth = 60
	}
	if dialogHeight < 20 {
		dialogHeight = 20
	}

	// Title
	var title string
	if w.mode == LayerGroupWizardModeCreate {
		title = " Create Layer Group "
	} else {
		title = " Edit Layer Group: " + w.originalName + " "
	}

	titleStyle := styles.DialogTitleStyle.
		Width(dialogWidth - 4).
		Align(lipgloss.Center)

	// Step indicator
	stepIndicator := w.renderStepIndicator(dialogWidth - 6)

	// Content based on step
	var content string
	switch w.step {
	case LayerGroupStepBasicInfo:
		content = w.renderBasicInfo(dialogWidth - 6)
	case LayerGroupStepSelectMode:
		content = w.renderModeSelection(dialogWidth - 6)
	case LayerGroupStepSelectLayers:
		content = w.renderLayerSelection(dialogWidth - 6, dialogHeight - 12)
	case LayerGroupStepReview:
		content = w.renderReview(dialogWidth - 6)
	}

	// Footer with help text
	footer := w.renderFooter()

	// Combine all parts
	dialogContent := lipgloss.JoinVertical(
		lipgloss.Left,
		titleStyle.Render(title),
		"",
		stepIndicator,
		"",
		content,
		"",
		footer,
	)

	// Dialog box style
	dialogStyle := styles.DialogBoxStyle.
		Width(dialogWidth).
		Height(dialogHeight)

	dialog := dialogStyle.Render(dialogContent)

	// Center the dialog
	return lipgloss.Place(
		w.width, w.height,
		lipgloss.Center, lipgloss.Center,
		dialog,
	)
}

// renderStepIndicator renders the step progress indicator
func (w *LayerGroupWizard) renderStepIndicator(width int) string {
	steps := []string{"Info", "Mode", "Layers", "Review"}
	var parts []string

	for i, step := range steps {
		style := styles.MutedStyle
		prefix := "  "
		if i == int(w.step) {
			style = styles.AccentStyle.Bold(true)
			prefix = "> "
		} else if i < int(w.step) {
			style = styles.SuccessStyle
			prefix = styles.SuccessStyle.Render("\u2713 ")
		}
		parts = append(parts, style.Render(prefix+step))
	}

	return lipgloss.JoinHorizontal(lipgloss.Top, parts...)
}

// renderBasicInfo renders the basic info step
func (w *LayerGroupWizard) renderBasicInfo(width int) string {
	var sb strings.Builder

	sb.WriteString(styles.DialogLabelStyle.Render("Layer Group Name:"))
	sb.WriteString("\n")

	nameStyle := styles.InputStyle
	if w.focusIndex == 0 {
		if w.editingField {
			nameStyle = styles.InputFocusedStyle
		} else {
			nameStyle = styles.InputSelectedStyle
		}
	}
	// In edit mode, show the name but indicate it can't be changed
	if w.mode == LayerGroupWizardModeEdit {
		sb.WriteString(styles.MutedStyle.Render("(name cannot be changed)"))
		sb.WriteString("\n")
		sb.WriteString(nameStyle.Render(w.groupName))
	} else {
		sb.WriteString(nameStyle.Render(w.nameInput.View()))
	}
	sb.WriteString("\n\n")

	sb.WriteString(styles.DialogLabelStyle.Render("Display Title (optional):"))
	sb.WriteString("\n")

	titleStyle := styles.InputStyle
	if w.focusIndex == 1 {
		if w.editingField {
			titleStyle = styles.InputFocusedStyle
		} else {
			titleStyle = styles.InputSelectedStyle
		}
	}
	sb.WriteString(titleStyle.Render(w.titleInput.View()))
	sb.WriteString("\n\n")

	// Continue button
	continueStyle := styles.DialogOptionStyle
	if w.focusIndex == 2 {
		continueStyle = styles.DialogSelectedOptionStyle
	}
	sb.WriteString(continueStyle.Render("[ Continue to Mode Selection ]"))

	return sb.String()
}

// renderModeSelection renders the mode selection step
func (w *LayerGroupWizard) renderModeSelection(width int) string {
	var sb strings.Builder

	sb.WriteString(styles.DialogLabelStyle.Render("Select Layer Group Mode:"))
	sb.WriteString("\n\n")

	for i, mode := range w.modeOptions {
		cursor := "  "
		style := styles.DialogOptionStyle
		if i == w.selectedModeIdx {
			cursor = "> "
			style = styles.DialogSelectedOptionStyle
		}

		option := lipgloss.JoinVertical(
			lipgloss.Left,
			style.Render(cursor+mode.String()),
			styles.DialogDescStyle.Render("   "+mode.Description()),
		)
		sb.WriteString(option)
		sb.WriteString("\n")
	}

	return sb.String()
}

// renderLayerSelection renders the layer selection step
func (w *LayerGroupWizard) renderLayerSelection(width, height int) string {
	var sb strings.Builder

	selectedCount := len(w.selectedLayers)
	totalCount := len(w.availableLayers)

	sb.WriteString(styles.DialogLabelStyle.Render("Select Layers to Include:"))
	sb.WriteString("  ")
	sb.WriteString(styles.AccentStyle.Render(strings.Repeat("\u2588", selectedCount)))
	sb.WriteString(styles.MutedStyle.Render(strings.Repeat("\u2591", totalCount-selectedCount)))
	sb.WriteString(styles.MutedStyle.Render(" " + string(rune('0'+selectedCount)) + "/" + string(rune('0'+totalCount))))
	sb.WriteString("\n\n")

	if len(w.availableLayers) == 0 {
		sb.WriteString(styles.MutedStyle.Render("  No layers available in this workspace"))
		return sb.String()
	}

	maxVisible := height - 4
	if maxVisible < 5 {
		maxVisible = 5
	}

	// Calculate visible range
	start := w.layerListOffset
	end := start + maxVisible
	if end > len(w.availableLayers) {
		end = len(w.availableLayers)
	}

	// Show scroll indicator if needed
	if start > 0 {
		sb.WriteString(styles.MutedStyle.Render("  \u2191 more above"))
		sb.WriteString("\n")
	}

	for i := start; i < end; i++ {
		layer := w.availableLayers[i]
		layerKey := w.workspace + ":" + layer.Name

		cursor := "  "
		checkbox := "[ ]"
		style := styles.DialogOptionStyle

		if i == w.layerCursor {
			cursor = "> "
			style = styles.DialogSelectedOptionStyle
		}
		if w.selectedLayers[layerKey] {
			checkbox = "[" + styles.SuccessStyle.Render("\u2713") + "]"
		}

		// Build layer line with style info
		layerLine := cursor + checkbox + " " + layer.Name

		// Show style selection if layer is selected and has styles
		if w.selectedLayers[layerKey] {
			if assignment, ok := w.layerStyles[layerKey]; ok && len(assignment.AvailableStyles) > 0 {
				styleName := assignment.StyleName
				if styleName == "" {
					styleName = "(default)"
				}
				// Show style with arrows indicating cycling is available
				styleNameStyle := lipgloss.NewStyle().Foreground(styles.KartozaBlueLight)
				styleIndicator := styles.AccentStyle.Render(" \u25c0 ") +
					styleNameStyle.Render(styleName) +
					styles.AccentStyle.Render(" \u25b6")
				layerLine += styleIndicator
			}
		}

		sb.WriteString(style.Render(layerLine))
		sb.WriteString("\n")
	}

	// Show scroll indicator if needed
	if end < len(w.availableLayers) {
		sb.WriteString(styles.MutedStyle.Render("  \u2193 more below"))
	}

	return sb.String()
}

// renderReview renders the review step
func (w *LayerGroupWizard) renderReview(width int) string {
	var sb strings.Builder

	sb.WriteString(styles.DialogLabelStyle.Render("Review Layer Group Configuration:"))
	sb.WriteString("\n\n")

	// Name
	sb.WriteString(styles.MutedStyle.Render("Name: "))
	sb.WriteString(lipgloss.NewStyle().Foreground(styles.TextBright).Render(w.groupName))
	sb.WriteString("\n")

	// Title
	title := w.title
	if title == "" {
		title = "(none)"
	}
	sb.WriteString(styles.MutedStyle.Render("Title: "))
	sb.WriteString(lipgloss.NewStyle().Foreground(styles.TextBright).Render(title))
	sb.WriteString("\n")

	// Mode
	sb.WriteString(styles.MutedStyle.Render("Mode: "))
	sb.WriteString(styles.AccentStyle.Render(w.groupMode.String()))
	sb.WriteString("\n\n")

	// Layers with styles
	sb.WriteString(styles.MutedStyle.Render("Layers (" + string(rune('0'+len(w.selectedLayers))) + "):"))
	sb.WriteString("\n")

	for layerName := range w.selectedLayers {
		sb.WriteString("  " + styles.SuccessStyle.Render("\u2713") + " " + layerName)
		// Show assigned style if not default
		if assignment, ok := w.layerStyles[layerName]; ok && assignment.StyleName != "" {
			sb.WriteString(styles.MutedStyle.Render(" \u2192 "))
			sb.WriteString(styles.AccentStyle.Render(assignment.StyleName))
		}
		sb.WriteString("\n")
	}

	sb.WriteString("\n")
	actionText := "Create"
	if w.mode == LayerGroupWizardModeEdit {
		actionText = "Update"
	}
	sb.WriteString(styles.DialogSelectedOptionStyle.Render("[ Press Enter to " + actionText + " Layer Group ]"))

	return sb.String()
}

// renderFooter renders the help footer
func (w *LayerGroupWizard) renderFooter() string {
	var help string
	switch w.step {
	case LayerGroupStepBasicInfo:
		if w.editingField {
			help = "enter/tab: confirm  esc: cancel"
		} else {
			help = "enter: edit/continue  tab: next field  esc: cancel"
		}
	case LayerGroupStepSelectMode:
		help = "\u2191/\u2193: select  enter: confirm  esc: back"
	case LayerGroupStepSelectLayers:
		help = "\u2191/\u2193: navigate  space: toggle  \u25c0/\u25b6: style  a: all  n: none  enter: continue  esc: back"
	case LayerGroupStepReview:
		help = "enter: create  esc: back"
	}

	return styles.DialogHelpStyle.Render(help)
}
