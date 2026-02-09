package components

import (
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/harmonica"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/styles"
)

// StyleFormat represents the style format
type StyleFormat int

const (
	StyleFormatSLD StyleFormat = iota
	StyleFormatCSS
)

func (f StyleFormat) String() string {
	switch f {
	case StyleFormatSLD:
		return "sld"
	case StyleFormatCSS:
		return "css"
	default:
		return "sld"
	}
}

// StyleWizardMode represents the wizard mode
type StyleWizardMode int

const (
	StyleWizardModeCreate StyleWizardMode = iota
	StyleWizardModeEdit
)

// StyleWizardStep represents the current step in the wizard
type StyleWizardStep int

const (
	StyleStepSelectFormat StyleWizardStep = iota
	StyleStepEditContent
)

// StyleWizardResult represents the result of the style wizard
type StyleWizardResult struct {
	Confirmed bool
	Name      string
	Format    StyleFormat
	Content   string
}

// StyleWizardAnimationMsg is sent to update animation state
type StyleWizardAnimationMsg struct {
	ID string
}

// Default SLD template
const defaultSLD = `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xsi:schemaLocation="http://www.opengis.net/sld StyledLayerDescriptor.xsd"
  xmlns="http://www.opengis.net/sld"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <Name>NewStyle</Name>
    <UserStyle>
      <Title>New Style</Title>
      <FeatureTypeStyle>
        <Rule>
          <Name>Default</Name>
          <PolygonSymbolizer>
            <Fill>
              <CssParameter name="fill">#3388ff</CssParameter>
              <CssParameter name="fill-opacity">0.6</CssParameter>
            </Fill>
            <Stroke>
              <CssParameter name="stroke">#2266cc</CssParameter>
              <CssParameter name="stroke-width">1</CssParameter>
            </Stroke>
          </PolygonSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>`

// Default CSS template
const defaultCSS = `/* GeoServer CSS Style */
* {
  fill: #3388ff;
  fill-opacity: 0.6;
  stroke: #2266cc;
  stroke-width: 1;
}`

// StyleWizard is a wizard for creating and editing styles
type StyleWizard struct {
	id           string
	mode         StyleWizardMode
	step         StyleWizardStep
	workspace    string
	width        int
	height       int
	visible      bool
	onConfirm    func(StyleWizardResult)
	onCancel     func()

	// Style properties
	styleName       string
	originalName    string // For edit mode
	format          StyleFormat
	content         string
	formatOptions   []StyleFormat
	selectedFormat  int

	// Input fields
	nameInput    textinput.Model
	contentArea  textarea.Model
	focusIndex   int
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

// NewStyleWizard creates a new wizard for creating styles
func NewStyleWizard(workspace string) *StyleWizard {
	nameInput := textinput.New()
	nameInput.Placeholder = "Enter style name"
	nameInput.CharLimit = 100
	nameInput.Width = 40

	contentArea := textarea.New()
	contentArea.SetWidth(80)
	contentArea.SetHeight(20)
	contentArea.Placeholder = "Style content will appear here..."

	return &StyleWizard{
		id:            "style-wizard",
		mode:          StyleWizardModeCreate,
		step:          StyleStepSelectFormat,
		workspace:     workspace,
		visible:       true,
		formatOptions: []StyleFormat{StyleFormatSLD, StyleFormatCSS},
		selectedFormat: 0,
		format:        StyleFormatSLD,
		content:       defaultSLD,
		nameInput:     nameInput,
		contentArea:   contentArea,
		spring:        harmonica.NewSpring(harmonica.FPS(60), 6.0, 0.5),
		animScale:     0.0,
		animVelocity:  0.0,
		animOpacity:   0.0,
		targetScale:   1.0,
		animating:     true,
	}
}

// NewStyleWizardForEdit creates a wizard for editing an existing style
func NewStyleWizardForEdit(workspace, name, content string, format StyleFormat) *StyleWizard {
	w := NewStyleWizard(workspace)
	w.mode = StyleWizardModeEdit
	w.step = StyleStepEditContent // Skip format selection for edit
	w.styleName = name
	w.originalName = name
	w.format = format
	w.content = content
	w.nameInput.SetValue(name)
	w.contentArea.SetValue(content)

	// Set selected format index
	for i, f := range w.formatOptions {
		if f == format {
			w.selectedFormat = i
			break
		}
	}

	return w
}

// SetSize sets the wizard size
func (w *StyleWizard) SetSize(width, height int) {
	w.width = width
	w.height = height

	// Adjust content area size
	contentWidth := width/2 - 10
	if contentWidth < 60 {
		contentWidth = 60
	}
	contentHeight := height - 20
	if contentHeight < 15 {
		contentHeight = 15
	}
	w.contentArea.SetWidth(contentWidth)
	w.contentArea.SetHeight(contentHeight)
	w.nameInput.Width = contentWidth - 10
}

// SetCallbacks sets the confirm and cancel callbacks
func (w *StyleWizard) SetCallbacks(onConfirm func(StyleWizardResult), onCancel func()) {
	w.onConfirm = onConfirm
	w.onCancel = onCancel
}

// IsVisible returns whether the wizard is visible
func (w *StyleWizard) IsVisible() bool {
	return w.visible
}

// IsEditingField returns whether a field is being edited
func (w *StyleWizard) IsEditingField() bool {
	return w.editingField
}

// Hide hides the wizard
func (w *StyleWizard) Hide() {
	w.visible = false
	w.animating = false
}

// animateCmd returns a command to continue the animation
func (w *StyleWizard) animateCmd() tea.Cmd {
	return tea.Tick(time.Second/60, func(t time.Time) tea.Msg {
		return StyleWizardAnimationMsg{ID: w.id}
	})
}

// Init initializes the wizard and starts the opening animation
func (w *StyleWizard) Init() tea.Cmd {
	return w.animateCmd()
}

// startCloseAnimation starts the closing animation
func (w *StyleWizard) startCloseAnimation() tea.Cmd {
	w.closing = true
	w.targetScale = 0.0
	w.animating = true
	return w.animateCmd()
}

// Update handles messages
func (w *StyleWizard) Update(msg tea.Msg) (*StyleWizard, tea.Cmd) {
	switch msg := msg.(type) {
	case StyleWizardAnimationMsg:
		if msg.ID != w.id {
			return w, nil
		}
		return w.updateAnimation()

	case tea.KeyMsg:
		if !w.visible || w.animating {
			return w, nil
		}

		switch w.step {
		case StyleStepSelectFormat:
			return w.updateFormatSelection(msg)
		case StyleStepEditContent:
			return w.updateContentEditing(msg)
		}
	}

	return w, nil
}

// updateAnimation updates the harmonica physics animation
func (w *StyleWizard) updateAnimation() (*StyleWizard, tea.Cmd) {
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

// updateFormatSelection handles key presses in format selection step
func (w *StyleWizard) updateFormatSelection(msg tea.KeyMsg) (*StyleWizard, tea.Cmd) {
	switch msg.String() {
	case "up", "k":
		if w.selectedFormat > 0 {
			w.selectedFormat--
		}
	case "down", "j":
		if w.selectedFormat < len(w.formatOptions)-1 {
			w.selectedFormat++
		}
	case "enter":
		w.format = w.formatOptions[w.selectedFormat]
		// Set default content based on format
		if w.format == StyleFormatSLD {
			w.content = defaultSLD
		} else {
			w.content = defaultCSS
		}
		w.contentArea.SetValue(w.content)
		w.step = StyleStepEditContent
	case "esc":
		if w.onCancel != nil {
			w.onCancel()
		}
		return w, w.startCloseAnimation()
	}

	return w, nil
}

// updateContentEditing handles key presses in content editing step
func (w *StyleWizard) updateContentEditing(msg tea.KeyMsg) (*StyleWizard, tea.Cmd) {
	if w.editingField {
		switch msg.String() {
		case "ctrl+s":
			// Save and exit editing mode
			w.editingField = false
			if w.focusIndex == 0 {
				w.styleName = w.nameInput.Value()
				w.nameInput.Blur()
			} else {
				w.content = w.contentArea.Value()
				w.contentArea.Blur()
			}
			return w, nil
		case "esc":
			// Exit editing mode without saving this field
			w.editingField = false
			if w.focusIndex == 0 {
				w.nameInput.Blur()
			} else {
				w.contentArea.Blur()
			}
			return w, nil
		default:
			// Pass keystrokes to the active input
			var cmd tea.Cmd
			if w.focusIndex == 0 {
				w.nameInput, cmd = w.nameInput.Update(msg)
				w.styleName = w.nameInput.Value()
			} else {
				w.contentArea, cmd = w.contentArea.Update(msg)
				w.content = w.contentArea.Value()
			}
			return w, cmd
		}
	}

	switch msg.String() {
	case "esc":
		// Go back to format selection (only in create mode)
		if w.mode == StyleWizardModeCreate {
			w.step = StyleStepSelectFormat
		} else {
			// In edit mode, cancel
			if w.onCancel != nil {
				w.onCancel()
			}
			return w, w.startCloseAnimation()
		}
	case "enter":
		// Enter editing mode for current field
		w.editingField = true
		if w.focusIndex == 0 {
			w.nameInput.Focus()
		} else {
			w.contentArea.Focus()
		}
	case "tab", "down":
		if w.focusIndex == 0 {
			w.focusIndex = 1
		}
	case "shift+tab", "up":
		if w.focusIndex == 1 {
			w.focusIndex = 0
		}
	case "ctrl+s":
		// Validate and save
		if w.validate() {
			if w.onConfirm != nil {
				w.onConfirm(w.buildResult())
			}
			return w, w.startCloseAnimation()
		}
	}

	return w, nil
}

// validate checks if the inputs are valid
func (w *StyleWizard) validate() bool {
	w.styleName = strings.TrimSpace(w.nameInput.Value())
	w.content = w.contentArea.Value()

	if w.styleName == "" {
		return false
	}
	if strings.TrimSpace(w.content) == "" {
		return false
	}
	return true
}

// buildResult creates the result from the current state
func (w *StyleWizard) buildResult() StyleWizardResult {
	return StyleWizardResult{
		Confirmed: true,
		Name:      strings.TrimSpace(w.nameInput.Value()),
		Format:    w.format,
		Content:   w.contentArea.Value(),
	}
}

// View renders the wizard
func (w *StyleWizard) View() string {
	if !w.visible {
		return ""
	}

	// Calculate dimensions with animation
	dialogWidth := int(float64(w.width/2+20) * w.animScale)
	dialogHeight := int(float64(w.height-10) * w.animScale)

	if dialogWidth < 60 {
		dialogWidth = 60
	}
	if dialogHeight < 20 {
		dialogHeight = 20
	}

	// Title
	var title string
	if w.mode == StyleWizardModeCreate {
		title = "Create Style"
	} else {
		title = "Edit Style: " + w.originalName
	}

	titleStyle := styles.DialogTitleStyle.
		Width(dialogWidth - 4).
		Align(lipgloss.Center)

	// Content based on step
	var content string
	switch w.step {
	case StyleStepSelectFormat:
		content = w.renderFormatSelection(dialogWidth - 6)
	case StyleStepEditContent:
		content = w.renderContentEditor(dialogWidth - 6)
	}

	// Footer with help text
	var footer string
	switch w.step {
	case StyleStepSelectFormat:
		footer = styles.DialogHelpStyle.Render("↑/↓: select  enter: confirm  esc: cancel")
	case StyleStepEditContent:
		if w.editingField {
			footer = styles.DialogHelpStyle.Render("ctrl+s: save field  esc: cancel edit")
		} else {
			footer = styles.DialogHelpStyle.Render("enter: edit field  tab: next  ctrl+s: save  esc: back")
		}
	}

	// Combine all parts
	dialogContent := lipgloss.JoinVertical(
		lipgloss.Left,
		titleStyle.Render(title),
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

// renderFormatSelection renders the format selection step
func (w *StyleWizard) renderFormatSelection(width int) string {
	var sb strings.Builder

	sb.WriteString(styles.DialogLabelStyle.Render("Select Style Format:"))
	sb.WriteString("\n\n")

	formats := []struct {
		format StyleFormat
		name   string
		desc   string
	}{
		{StyleFormatSLD, "SLD (Styled Layer Descriptor)", "Standard OGC format, XML-based, full feature support"},
		{StyleFormatCSS, "CSS (GeoServer CSS)", "Simpler syntax, easier to read/write, GeoServer-specific"},
	}

	for i, f := range formats {
		cursor := "  "
		style := styles.DialogOptionStyle
		if i == w.selectedFormat {
			cursor = "> "
			style = styles.DialogSelectedOptionStyle
		}

		option := lipgloss.JoinVertical(
			lipgloss.Left,
			style.Render(cursor+f.name),
			styles.DialogDescStyle.Render("   "+f.desc),
		)
		sb.WriteString(option)
		sb.WriteString("\n")
	}

	return sb.String()
}

// renderContentEditor renders the content editor step
func (w *StyleWizard) renderContentEditor(width int) string {
	var sb strings.Builder

	// Format indicator
	formatBadge := styles.AccentStyle.Render("[" + w.format.String() + "]")
	sb.WriteString("Format: " + formatBadge)
	sb.WriteString("\n\n")

	// Name field
	nameLabel := styles.DialogLabelStyle.Render("Style Name:")
	if w.focusIndex == 0 && !w.editingField {
		nameLabel = styles.DialogSelectedLabelStyle.Render("> Style Name:")
	}
	sb.WriteString(nameLabel)
	sb.WriteString("\n")

	nameStyle := styles.InputStyle
	if w.focusIndex == 0 {
		if w.editingField {
			nameStyle = styles.InputFocusedStyle
		} else {
			nameStyle = styles.InputSelectedStyle
		}
	}
	sb.WriteString(nameStyle.Render(w.nameInput.View()))
	sb.WriteString("\n\n")

	// Content field
	contentLabel := styles.DialogLabelStyle.Render("Style Content:")
	if w.focusIndex == 1 && !w.editingField {
		contentLabel = styles.DialogSelectedLabelStyle.Render("> Style Content:")
	}
	sb.WriteString(contentLabel)
	sb.WriteString("\n")

	contentStyle := styles.TextAreaStyle
	if w.focusIndex == 1 {
		if w.editingField {
			contentStyle = styles.TextAreaFocusedStyle
		} else {
			contentStyle = styles.TextAreaSelectedStyle
		}
	}
	sb.WriteString(contentStyle.Render(w.contentArea.View()))

	return sb.String()
}
