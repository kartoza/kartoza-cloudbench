package components

import (
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/harmonica"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/styles"
)

// DialogType represents the type of dialog
type DialogType int

const (
	DialogTypeNone DialogType = iota
	DialogTypeInput
	DialogTypeConfirm
)

// DialogResult represents the result of a dialog
type DialogResult struct {
	Confirmed bool
	Values    map[string]string
}

// DialogField represents a field in an input dialog
type DialogField struct {
	Name        string
	Label       string
	Placeholder string
	Value       string
	Password    bool
}

// DialogAnimationMsg is sent to update animation state
type DialogAnimationMsg struct {
	ID string
}

// Dialog is a modal dialog component with harmonica physics
type Dialog struct {
	id           string
	dialogType   DialogType
	title        string
	message      string
	fields       []DialogField
	inputs       []textinput.Model
	focusIndex   int
	editingField bool
	width        int
	height       int
	visible      bool
	onConfirm    func(DialogResult)
	onCancel     func()

	// Harmonica physics for smooth animations
	spring        harmonica.Spring
	animScale     float64
	animVelocity  float64 // velocity for spring physics
	animOpacity   float64
	targetScale   float64
	targetOpacity float64
	animating     bool
	closing       bool
}

// NewInputDialog creates a new input dialog
func NewInputDialog(title string, fields []DialogField) *Dialog {
	d := &Dialog{
		id:            title,
		dialogType:    DialogTypeInput,
		title:         title,
		fields:        fields,
		inputs:        make([]textinput.Model, len(fields)),
		visible:       true,
		spring:        harmonica.NewSpring(harmonica.FPS(60), 6.0, 0.5),
		animScale:     0.0,
		animOpacity:   0.0,
		targetScale:   1.0,
		targetOpacity: 1.0,
		animating:     true,
	}

	for i, field := range fields {
		t := textinput.New()
		t.Placeholder = field.Placeholder
		t.CharLimit = 256
		if field.Password {
			t.EchoMode = textinput.EchoPassword
		}
		if field.Value != "" {
			t.SetValue(field.Value)
		}
		d.inputs[i] = t
	}

	return d
}

// NewConfirmDialog creates a new confirmation dialog
func NewConfirmDialog(title, message string) *Dialog {
	return &Dialog{
		id:            title,
		dialogType:    DialogTypeConfirm,
		title:         title,
		message:       message,
		visible:       true,
		spring:        harmonica.NewSpring(harmonica.FPS(60), 6.0, 0.5),
		animScale:     0.0,
		animOpacity:   0.0,
		targetScale:   1.0,
		targetOpacity: 1.0,
		animating:     true,
	}
}

// SetSize sets the dialog size
func (d *Dialog) SetSize(width, height int) {
	d.width = width
	d.height = height

	// Update input widths
	inputWidth := width/2 - 20
	if inputWidth < 30 {
		inputWidth = 30
	}
	for i := range d.inputs {
		d.inputs[i].Width = inputWidth
	}
}

// SetCallbacks sets the confirm and cancel callbacks
func (d *Dialog) SetCallbacks(onConfirm func(DialogResult), onCancel func()) {
	d.onConfirm = onConfirm
	d.onCancel = onCancel
}

// IsVisible returns whether the dialog is visible
func (d *Dialog) IsVisible() bool {
	return d.visible
}

// IsEditingField returns whether a field is being edited
func (d *Dialog) IsEditingField() bool {
	return d.editingField
}

// IsAnimating returns whether the dialog is animating
func (d *Dialog) IsAnimating() bool {
	return d.animating
}

// StartCloseAnimation starts the closing animation
func (d *Dialog) StartCloseAnimation() tea.Cmd {
	d.closing = true
	d.targetScale = 0.0
	d.targetOpacity = 0.0
	d.animating = true
	return d.animateCmd()
}

// Hide hides the dialog
func (d *Dialog) Hide() {
	d.visible = false
	d.animating = false
}

// animateCmd returns a command to continue the animation
func (d *Dialog) animateCmd() tea.Cmd {
	return tea.Tick(time.Second/60, func(t time.Time) tea.Msg {
		return DialogAnimationMsg{ID: d.id}
	})
}

// Init initializes the dialog and starts the opening animation
func (d *Dialog) Init() tea.Cmd {
	return d.animateCmd()
}

// Update handles messages
func (d *Dialog) Update(msg tea.Msg) (*Dialog, tea.Cmd) {
	switch msg := msg.(type) {
	case DialogAnimationMsg:
		if msg.ID != d.id {
			return d, nil
		}
		return d.updateAnimation()

	case tea.KeyMsg:
		if !d.visible || d.animating {
			return d, nil
		}

		if d.dialogType == DialogTypeConfirm {
			return d.updateConfirm(msg)
		}
		return d.updateInput(msg)
	}

	return d, nil
}

// updateAnimation updates the harmonica physics animation
func (d *Dialog) updateAnimation() (*Dialog, tea.Cmd) {
	if !d.animating {
		return d, nil
	}

	// Update scale using spring physics (pos, velocity, target)
	d.animScale, d.animVelocity = d.spring.Update(d.animScale, d.animVelocity, d.targetScale)

	// Update opacity (simpler linear interpolation for opacity)
	opacityStep := 0.1
	if d.closing {
		d.animOpacity -= opacityStep
		if d.animOpacity < 0 {
			d.animOpacity = 0
		}
	} else {
		d.animOpacity += opacityStep
		if d.animOpacity > 1 {
			d.animOpacity = 1
		}
	}

	// Check if animation is complete
	scaleClose := abs(d.animScale-d.targetScale) < 0.01 && abs(d.animVelocity) < 0.01
	opacityClose := d.closing && d.animOpacity <= 0.01 || !d.closing && d.animOpacity >= 0.99

	if scaleClose && opacityClose {
		d.animating = false
		d.animScale = d.targetScale
		d.animOpacity = d.targetOpacity

		if d.closing {
			d.visible = false
			return d, nil
		}
	}

	return d, d.animateCmd()
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

// updateConfirm handles key presses for confirm dialog
func (d *Dialog) updateConfirm(msg tea.KeyMsg) (*Dialog, tea.Cmd) {
	switch msg.String() {
	case "y", "Y", "enter":
		if d.onConfirm != nil {
			d.onConfirm(DialogResult{Confirmed: true})
		}
		return d, d.StartCloseAnimation()
	case "n", "N", "esc":
		if d.onCancel != nil {
			d.onCancel()
		}
		return d, d.StartCloseAnimation()
	}
	return d, nil
}

// updateInput handles key presses for input dialog
func (d *Dialog) updateInput(msg tea.KeyMsg) (*Dialog, tea.Cmd) {
	// If editing a field, forward keys to input
	if d.editingField {
		switch msg.String() {
		case "enter":
			d.editingField = false
			d.inputs[d.focusIndex].Blur()
			return d, nil
		case "esc":
			d.editingField = false
			d.inputs[d.focusIndex].Blur()
			return d, nil
		default:
			var cmd tea.Cmd
			d.inputs[d.focusIndex], cmd = d.inputs[d.focusIndex].Update(msg)
			return d, cmd
		}
	}

	// Navigation mode
	switch msg.String() {
	case "esc":
		if d.onCancel != nil {
			d.onCancel()
		}
		return d, d.StartCloseAnimation()

	case "enter":
		// Start editing current field
		d.editingField = true
		d.inputs[d.focusIndex].Focus()

	case "tab", "down", "j":
		d.focusIndex = (d.focusIndex + 1) % len(d.inputs)

	case "shift+tab", "up", "k":
		d.focusIndex = (d.focusIndex - 1 + len(d.inputs)) % len(d.inputs)

	case "ctrl+s":
		// Save
		if d.onConfirm != nil {
			values := make(map[string]string)
			for i, field := range d.fields {
				values[field.Name] = d.inputs[i].Value()
			}
			d.onConfirm(DialogResult{Confirmed: true, Values: values})
		}
		return d, d.StartCloseAnimation()
	}

	return d, nil
}

// View renders the dialog with animation
func (d *Dialog) View() string {
	if !d.visible {
		return ""
	}

	dialogWidth := d.width/2 + 10
	if dialogWidth < 50 {
		dialogWidth = 50
	}

	scaledWidth := int(float64(dialogWidth) * d.animScale)
	if scaledWidth < 10 {
		scaledWidth = 10
	}

	dialogStyle := styles.DialogStyle.Width(scaledWidth)
	marginOffset := int((1.0 - d.animScale) * 5)
	dialogStyle = dialogStyle.MarginTop(marginOffset).MarginBottom(marginOffset)

	// When closing, render empty frame only
	if d.closing {
		dialog := dialogStyle.Render("")
		return styles.Center(d.width, d.height, dialog)
	}

	var b strings.Builder

	// Title
	title := styles.DialogTitleStyle.Render(d.title)
	b.WriteString(title)
	b.WriteString("\n\n")

	if d.dialogType == DialogTypeConfirm {
		b.WriteString(d.message)
		b.WriteString("\n\n")
		b.WriteString(styles.HelpTextStyle.Render("y:yes  n:no  Esc:cancel"))
	} else {
		// Render input fields
		for i, field := range d.fields {
			var indicator string
			if i == d.focusIndex {
				if d.editingField {
					indicator = styles.ConnectedStyle.Render("▶ ")
				} else {
					indicator = styles.SelectedItemStyle.Render("● ")
				}
			} else {
				indicator = "  "
			}

			label := styles.ItemStyle.Width(12).Render(field.Label + ":")

			var inputStyle lipgloss.Style
			if i == d.focusIndex && d.editingField {
				inputStyle = styles.FocusedInputStyle
			} else if i == d.focusIndex {
				inputStyle = styles.ActiveItemStyle
			} else {
				inputStyle = styles.InputStyle
			}

			b.WriteString(indicator)
			b.WriteString(label)
			b.WriteString(inputStyle.Render(d.inputs[i].View()))
			b.WriteString("\n\n")
		}

		// Help text
		if d.editingField {
			b.WriteString(styles.HelpTextStyle.Render("Enter:accept  Esc:cancel edit"))
		} else {
			b.WriteString(styles.HelpTextStyle.Render("j/k:navigate  Enter:edit  Ctrl+S:save  Esc:cancel"))
		}
	}

	dialog := dialogStyle.Render(b.String())

	// Dim the entire dialog if animating with low opacity
	if d.animOpacity < 1.0 {
		// Apply a faded style
		fadedStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("#666666"))
		if d.animOpacity > 0.5 {
			dialog = lipgloss.NewStyle().Render(dialog)
		} else {
			dialog = fadedStyle.Render(dialog)
		}
	}

	return styles.Center(d.width, d.height, dialog)
}

// GetValues returns the current values from all inputs
func (d *Dialog) GetValues() map[string]string {
	values := make(map[string]string)
	for i, field := range d.fields {
		values[field.Name] = d.inputs[i].Value()
	}
	return values
}
