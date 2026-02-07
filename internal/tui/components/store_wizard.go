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

// StoreWizardStep represents the current step in the wizard
type StoreWizardStep int

const (
	StepSelectType StoreWizardStep = iota
	StepConfigureStore
)

// StoreWizardMode represents whether we're creating a data store or coverage store
type StoreWizardMode int

const (
	WizardModeDataStore StoreWizardMode = iota
	WizardModeCoverageStore
)

// StoreWizardResult represents the result of the store wizard
type StoreWizardResult struct {
	Confirmed         bool
	Mode              StoreWizardMode
	DataStoreType     models.DataStoreType
	CoverageStoreType models.CoverageStoreType
	Values            map[string]string
}

// StoreWizardAnimationMsg is sent to update animation state
type StoreWizardAnimationMsg struct {
	ID string
}

// StoreWizard is a multi-step wizard for creating stores
type StoreWizard struct {
	id           string
	mode         StoreWizardMode
	step         StoreWizardStep
	workspace    string
	width        int
	height       int
	visible      bool
	onConfirm    func(StoreWizardResult)
	onCancel     func()

	// Type selection
	dataStoreTypes     []models.DataStoreType
	coverageStoreTypes []models.CoverageStoreType
	selectedTypeIndex  int

	// Store configuration
	selectedDataStoreType     models.DataStoreType
	selectedCoverageStoreType models.CoverageStoreType
	inputs                    []textinput.Model
	fields                    []models.DataStoreField
	coverageFields            []models.CoverageStoreField
	focusIndex                int
	editingField              bool

	// Animation
	spring       harmonica.Spring
	animScale    float64
	animVelocity float64
	animOpacity  float64
	targetScale  float64
	animating    bool
	closing      bool
}

// NewDataStoreWizard creates a new wizard for creating data stores
func NewDataStoreWizard(workspace string) *StoreWizard {
	return &StoreWizard{
		id:                 "datastore-wizard",
		mode:               WizardModeDataStore,
		step:               StepSelectType,
		workspace:          workspace,
		visible:            true,
		dataStoreTypes:     models.GetAllDataStoreTypes(),
		selectedTypeIndex:  0,
		spring:             harmonica.NewSpring(harmonica.FPS(60), 6.0, 0.5),
		animScale:          0.0,
		animVelocity:       0.0,
		animOpacity:        0.0,
		targetScale:        1.0,
		animating:          true,
	}
}

// NewCoverageStoreWizard creates a new wizard for creating coverage stores
func NewCoverageStoreWizard(workspace string) *StoreWizard {
	return &StoreWizard{
		id:                 "coveragestore-wizard",
		mode:               WizardModeCoverageStore,
		step:               StepSelectType,
		workspace:          workspace,
		visible:            true,
		coverageStoreTypes: models.GetAllCoverageStoreTypes(),
		selectedTypeIndex:  0,
		spring:             harmonica.NewSpring(harmonica.FPS(60), 6.0, 0.5),
		animScale:          0.0,
		animVelocity:       0.0,
		animOpacity:        0.0,
		targetScale:        1.0,
		animating:          true,
	}
}

// SetSize sets the wizard size
func (w *StoreWizard) SetSize(width, height int) {
	w.width = width
	w.height = height

	inputWidth := width/2 - 20
	if inputWidth < 30 {
		inputWidth = 30
	}
	for i := range w.inputs {
		w.inputs[i].Width = inputWidth
	}
}

// SetCallbacks sets the confirm and cancel callbacks
func (w *StoreWizard) SetCallbacks(onConfirm func(StoreWizardResult), onCancel func()) {
	w.onConfirm = onConfirm
	w.onCancel = onCancel
}

// IsVisible returns whether the wizard is visible
func (w *StoreWizard) IsVisible() bool {
	return w.visible
}

// IsEditingField returns whether a field is being edited
func (w *StoreWizard) IsEditingField() bool {
	return w.editingField
}

// Hide hides the wizard
func (w *StoreWizard) Hide() {
	w.visible = false
	w.animating = false
}

// animateCmd returns a command to continue the animation
func (w *StoreWizard) animateCmd() tea.Cmd {
	return tea.Tick(time.Second/60, func(t time.Time) tea.Msg {
		return StoreWizardAnimationMsg{ID: w.id}
	})
}

// Init initializes the wizard and starts the opening animation
func (w *StoreWizard) Init() tea.Cmd {
	return w.animateCmd()
}

// startCloseAnimation starts the closing animation
func (w *StoreWizard) startCloseAnimation() tea.Cmd {
	w.closing = true
	w.targetScale = 0.0
	w.animating = true
	return w.animateCmd()
}

// Update handles messages
func (w *StoreWizard) Update(msg tea.Msg) (*StoreWizard, tea.Cmd) {
	switch msg := msg.(type) {
	case StoreWizardAnimationMsg:
		if msg.ID != w.id {
			return w, nil
		}
		return w.updateAnimation()

	case tea.KeyMsg:
		if !w.visible || w.animating {
			return w, nil
		}

		switch w.step {
		case StepSelectType:
			return w.updateTypeSelection(msg)
		case StepConfigureStore:
			return w.updateConfiguration(msg)
		}
	}

	return w, nil
}

// updateAnimation updates the harmonica physics animation
func (w *StoreWizard) updateAnimation() (*StoreWizard, tea.Cmd) {
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

func absFloat(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

// updateTypeSelection handles key presses in type selection step
func (w *StoreWizard) updateTypeSelection(msg tea.KeyMsg) (*StoreWizard, tea.Cmd) {
	maxIndex := 0
	if w.mode == WizardModeDataStore {
		maxIndex = len(w.dataStoreTypes) - 1
	} else {
		maxIndex = len(w.coverageStoreTypes) - 1
	}

	switch msg.String() {
	case "up", "k":
		if w.selectedTypeIndex > 0 {
			w.selectedTypeIndex--
		}
	case "down", "j":
		if w.selectedTypeIndex < maxIndex {
			w.selectedTypeIndex++
		}
	case "enter":
		// Move to configuration step
		w.step = StepConfigureStore
		w.initializeInputs()
	case "esc":
		if w.onCancel != nil {
			w.onCancel()
		}
		return w, w.startCloseAnimation()
	}

	return w, nil
}

// initializeInputs creates the input fields based on selected store type
func (w *StoreWizard) initializeInputs() {
	if w.mode == WizardModeDataStore {
		w.selectedDataStoreType = w.dataStoreTypes[w.selectedTypeIndex]
		w.fields = models.GetDataStoreFields(w.selectedDataStoreType)
		w.inputs = make([]textinput.Model, len(w.fields))

		for i, field := range w.fields {
			t := textinput.New()
			t.Placeholder = field.Placeholder
			t.CharLimit = 256
			if field.Password {
				t.EchoMode = textinput.EchoPassword
			}
			if field.Default != "" {
				t.SetValue(field.Default)
			}
			w.inputs[i] = t
		}
	} else {
		w.selectedCoverageStoreType = w.coverageStoreTypes[w.selectedTypeIndex]
		w.coverageFields = models.GetCoverageStoreFields(w.selectedCoverageStoreType)
		w.inputs = make([]textinput.Model, len(w.coverageFields))

		for i, field := range w.coverageFields {
			t := textinput.New()
			t.Placeholder = field.Placeholder
			t.CharLimit = 256
			w.inputs[i] = t
		}
	}

	w.focusIndex = 0
	w.editingField = false
}

// updateConfiguration handles key presses in configuration step
func (w *StoreWizard) updateConfiguration(msg tea.KeyMsg) (*StoreWizard, tea.Cmd) {
	if w.editingField {
		switch msg.String() {
		case "enter":
			w.editingField = false
			w.inputs[w.focusIndex].Blur()
			return w, nil
		case "esc":
			w.editingField = false
			w.inputs[w.focusIndex].Blur()
			return w, nil
		default:
			var cmd tea.Cmd
			w.inputs[w.focusIndex], cmd = w.inputs[w.focusIndex].Update(msg)
			return w, cmd
		}
	}

	switch msg.String() {
	case "esc":
		// Go back to type selection
		w.step = StepSelectType
		w.inputs = nil
		w.focusIndex = 0
	case "enter":
		w.editingField = true
		w.inputs[w.focusIndex].Focus()
	case "tab", "down", "j":
		w.focusIndex = (w.focusIndex + 1) % len(w.inputs)
	case "shift+tab", "up", "k":
		w.focusIndex = (w.focusIndex - 1 + len(w.inputs)) % len(w.inputs)
	case "ctrl+s":
		// Validate and save
		if w.validateInputs() {
			if w.onConfirm != nil {
				w.onConfirm(w.buildResult())
			}
			return w, w.startCloseAnimation()
		}
	}

	return w, nil
}

// validateInputs checks if all required fields have values
func (w *StoreWizard) validateInputs() bool {
	if w.mode == WizardModeDataStore {
		for i, field := range w.fields {
			if field.Required && strings.TrimSpace(w.inputs[i].Value()) == "" {
				return false
			}
		}
	} else {
		for i, field := range w.coverageFields {
			if field.Required && strings.TrimSpace(w.inputs[i].Value()) == "" {
				return false
			}
		}
	}
	return true
}

// buildResult creates the result from current inputs
func (w *StoreWizard) buildResult() StoreWizardResult {
	values := make(map[string]string)

	if w.mode == WizardModeDataStore {
		for i, field := range w.fields {
			values[field.Name] = w.inputs[i].Value()
		}
		return StoreWizardResult{
			Confirmed:     true,
			Mode:          w.mode,
			DataStoreType: w.selectedDataStoreType,
			Values:        values,
		}
	}

	for i, field := range w.coverageFields {
		values[field.Name] = w.inputs[i].Value()
	}
	return StoreWizardResult{
		Confirmed:         true,
		Mode:              w.mode,
		CoverageStoreType: w.selectedCoverageStoreType,
		Values:            values,
	}
}

// View renders the wizard with animation
func (w *StoreWizard) View() string {
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
	if w.mode == WizardModeDataStore {
		title = "Create Data Store"
	} else {
		title = "Create Coverage Store"
	}
	b.WriteString(styles.DialogTitleStyle.Render(title))
	b.WriteString("\n\n")

	switch w.step {
	case StepSelectType:
		b.WriteString(w.renderTypeSelection())
	case StepConfigureStore:
		b.WriteString(w.renderConfiguration())
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

// renderTypeSelection renders the type selection step
func (w *StoreWizard) renderTypeSelection() string {
	var b strings.Builder

	b.WriteString(styles.ItemStyle.Render("Select store type:"))
	b.WriteString("\n\n")

	if w.mode == WizardModeDataStore {
		for i, storeType := range w.dataStoreTypes {
			var indicator string
			if i == w.selectedTypeIndex {
				indicator = styles.ConnectedStyle.Render("● ")
			} else {
				indicator = styles.MutedStyle.Render("○ ")
			}

			var lineStyle lipgloss.Style
			if i == w.selectedTypeIndex {
				lineStyle = styles.ActiveItemStyle
			} else {
				lineStyle = styles.ItemStyle
			}

			b.WriteString(indicator)
			b.WriteString(lineStyle.Render(storeType.String()))
			b.WriteString("\n")
		}
	} else {
		for i, storeType := range w.coverageStoreTypes {
			var indicator string
			if i == w.selectedTypeIndex {
				indicator = styles.ConnectedStyle.Render("● ")
			} else {
				indicator = styles.MutedStyle.Render("○ ")
			}

			var lineStyle lipgloss.Style
			if i == w.selectedTypeIndex {
				lineStyle = styles.ActiveItemStyle
			} else {
				lineStyle = styles.ItemStyle
			}

			b.WriteString(indicator)
			b.WriteString(lineStyle.Render(storeType.String()))
			b.WriteString("\n")
		}
	}

	b.WriteString("\n")
	b.WriteString(styles.HelpTextStyle.Render("j/k:navigate  Enter:select  Esc:cancel"))

	return b.String()
}

// renderConfiguration renders the configuration step
func (w *StoreWizard) renderConfiguration() string {
	var b strings.Builder

	// Show selected type
	var typeName string
	if w.mode == WizardModeDataStore {
		typeName = w.selectedDataStoreType.String()
	} else {
		typeName = w.selectedCoverageStoreType.String()
	}
	b.WriteString(styles.MutedStyle.Render("Type: " + typeName))
	b.WriteString("\n\n")

	// Render input fields
	if w.mode == WizardModeDataStore {
		for i, field := range w.fields {
			b.WriteString(w.renderField(i, field.Label, field.Required))
		}
	} else {
		for i, field := range w.coverageFields {
			b.WriteString(w.renderCoverageField(i, field.Label, field.Required))
		}
	}

	// Help text
	if w.editingField {
		b.WriteString(styles.HelpTextStyle.Render("Enter:accept  Esc:cancel edit"))
	} else {
		b.WriteString(styles.HelpTextStyle.Render("j/k:navigate  Enter:edit  Ctrl+S:save  Esc:back"))
	}

	return b.String()
}

// renderField renders a single input field
func (w *StoreWizard) renderField(index int, label string, required bool) string {
	var b strings.Builder

	var indicator string
	if index == w.focusIndex {
		if w.editingField {
			indicator = styles.ConnectedStyle.Render("▶ ")
		} else {
			indicator = styles.SelectedItemStyle.Render("● ")
		}
	} else {
		indicator = "  "
	}

	labelText := label
	if required {
		labelText += " *"
	}
	labelStr := styles.ItemStyle.Width(16).Render(labelText + ":")

	var inputStyle lipgloss.Style
	if index == w.focusIndex && w.editingField {
		inputStyle = styles.FocusedInputStyle
	} else if index == w.focusIndex {
		inputStyle = styles.ActiveItemStyle
	} else {
		inputStyle = styles.InputStyle
	}

	b.WriteString(indicator)
	b.WriteString(labelStr)
	b.WriteString(inputStyle.Render(w.inputs[index].View()))
	b.WriteString("\n\n")

	return b.String()
}

// renderCoverageField renders a single coverage store field
func (w *StoreWizard) renderCoverageField(index int, label string, required bool) string {
	return w.renderField(index, label, required)
}
