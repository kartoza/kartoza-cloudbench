package components

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/styles"
)

// ColorPickerKeyMap defines key bindings for color picker
type ColorPickerKeyMap struct {
	Close     key.Binding
	Confirm   key.Binding
	Navigate  key.Binding
	Increment key.Binding
	Decrement key.Binding
	EditHex   key.Binding
	Tab       key.Binding
}

// DefaultColorPickerKeyMap returns default key bindings
func DefaultColorPickerKeyMap() ColorPickerKeyMap {
	return ColorPickerKeyMap{
		Close: key.NewBinding(
			key.WithKeys("esc"),
			key.WithHelp("esc", "cancel"),
		),
		Confirm: key.NewBinding(
			key.WithKeys("enter"),
			key.WithHelp("enter", "confirm"),
		),
		Navigate: key.NewBinding(
			key.WithKeys("up", "down", "k", "j"),
			key.WithHelp("↑↓/kj", "navigate"),
		),
		Increment: key.NewBinding(
			key.WithKeys("right", "l"),
			key.WithHelp("→/l", "increase"),
		),
		Decrement: key.NewBinding(
			key.WithKeys("left", "h"),
			key.WithHelp("←/h", "decrease"),
		),
		EditHex: key.NewBinding(
			key.WithKeys("e"),
			key.WithHelp("e", "edit hex"),
		),
		Tab: key.NewBinding(
			key.WithKeys("tab"),
			key.WithHelp("tab", "next preset"),
		),
	}
}

// ColorPickerMode represents the picker mode
type ColorPickerMode int

const (
	ModePresets ColorPickerMode = iota
	ModeRGB
	ModeHex
)

// ColorPreset represents a preset color with name
type ColorPreset struct {
	Name  string
	Color string
}

// Default color presets - organized by category
var ColorPresets = []ColorPreset{
	// Blues
	{Name: "Blue", Color: "#3388ff"},
	{Name: "Dark Blue", Color: "#2166ac"},
	{Name: "Light Blue", Color: "#67a9cf"},
	{Name: "Navy", Color: "#084594"},
	{Name: "Cyan", Color: "#00ffff"},
	// Reds
	{Name: "Red", Color: "#ff3333"},
	{Name: "Dark Red", Color: "#b2182b"},
	{Name: "Crimson", Color: "#dc143c"},
	{Name: "Coral", Color: "#ff7f50"},
	{Name: "Pink", Color: "#ff69b4"},
	// Greens
	{Name: "Green", Color: "#33ff33"},
	{Name: "Dark Green", Color: "#1a9850"},
	{Name: "Lime", Color: "#00ff00"},
	{Name: "Forest", Color: "#228b22"},
	{Name: "Olive", Color: "#808000"},
	// Yellows/Oranges
	{Name: "Yellow", Color: "#ffff33"},
	{Name: "Gold", Color: "#ffd700"},
	{Name: "Orange", Color: "#ff6600"},
	{Name: "Amber", Color: "#ffbf00"},
	{Name: "Peach", Color: "#ffdab9"},
	// Purples
	{Name: "Purple", Color: "#9966ff"},
	{Name: "Violet", Color: "#8b00ff"},
	{Name: "Magenta", Color: "#ff00ff"},
	{Name: "Plum", Color: "#dda0dd"},
	{Name: "Indigo", Color: "#4b0082"},
	// Neutrals
	{Name: "White", Color: "#ffffff"},
	{Name: "Light Gray", Color: "#cccccc"},
	{Name: "Gray", Color: "#808080"},
	{Name: "Dark Gray", Color: "#404040"},
	{Name: "Black", Color: "#000000"},
	// Earth tones
	{Name: "Brown", Color: "#8b4513"},
	{Name: "Tan", Color: "#d2b48c"},
	{Name: "Beige", Color: "#f5f5dc"},
	{Name: "Sienna", Color: "#a0522d"},
	{Name: "Chocolate", Color: "#d2691e"},
}

// ColorPickerResult is returned when color is selected
type ColorPickerResult struct {
	Confirmed bool
	Color     string
}

// ColorPicker is a TUI color picker component
type ColorPicker struct {
	visible      bool
	width        int
	height       int
	mode         ColorPickerMode
	selectedIdx  int  // For presets
	rgbComponent int  // 0=R, 1=G, 2=B
	r, g, b      uint8
	hexInput     textinput.Model
	editingHex   bool
	initialColor string

	keyMap    ColorPickerKeyMap
	onConfirm func(ColorPickerResult)
	onCancel  func()
}

// NewColorPicker creates a new color picker
func NewColorPicker(initialColor string) *ColorPicker {
	hexInput := textinput.New()
	hexInput.Placeholder = "#RRGGBB"
	hexInput.CharLimit = 7
	hexInput.Width = 10

	cp := &ColorPicker{
		visible:      true,
		width:        60,
		height:       20,
		mode:         ModePresets,
		selectedIdx:  0,
		rgbComponent: 0,
		initialColor: initialColor,
		hexInput:     hexInput,
		keyMap:       DefaultColorPickerKeyMap(),
	}

	// Parse initial color
	cp.setColorFromHex(initialColor)
	cp.hexInput.SetValue(initialColor)

	return cp
}

// SetCallbacks sets the confirm and cancel callbacks
func (cp *ColorPicker) SetCallbacks(onConfirm func(ColorPickerResult), onCancel func()) {
	cp.onConfirm = onConfirm
	cp.onCancel = onCancel
}

// SetSize sets the picker size
func (cp *ColorPicker) SetSize(width, height int) {
	cp.width = width
	cp.height = height
}

// IsVisible returns visibility state
func (cp *ColorPicker) IsVisible() bool {
	return cp.visible
}

// Hide hides the picker
func (cp *ColorPicker) Hide() {
	cp.visible = false
}

// GetColor returns the current color as hex
func (cp *ColorPicker) GetColor() string {
	return fmt.Sprintf("#%02x%02x%02x", cp.r, cp.g, cp.b)
}

// setColorFromHex parses a hex color string
func (cp *ColorPicker) setColorFromHex(hex string) {
	hex = strings.TrimPrefix(hex, "#")
	if len(hex) == 6 {
		if r, err := strconv.ParseUint(hex[0:2], 16, 8); err == nil {
			cp.r = uint8(r)
		}
		if g, err := strconv.ParseUint(hex[2:4], 16, 8); err == nil {
			cp.g = uint8(g)
		}
		if b, err := strconv.ParseUint(hex[4:6], 16, 8); err == nil {
			cp.b = uint8(b)
		}
	} else if len(hex) == 3 {
		// Short form #RGB
		if r, err := strconv.ParseUint(string(hex[0])+string(hex[0]), 16, 8); err == nil {
			cp.r = uint8(r)
		}
		if g, err := strconv.ParseUint(string(hex[1])+string(hex[1]), 16, 8); err == nil {
			cp.g = uint8(g)
		}
		if b, err := strconv.ParseUint(string(hex[2])+string(hex[2]), 16, 8); err == nil {
			cp.b = uint8(b)
		}
	}
}

// Init initializes the color picker
func (cp *ColorPicker) Init() tea.Cmd {
	return nil
}

// Update handles messages
func (cp *ColorPicker) Update(msg tea.Msg) (*ColorPicker, tea.Cmd) {
	if !cp.visible {
		return cp, nil
	}

	switch msg := msg.(type) {
	case tea.KeyMsg:
		if cp.editingHex {
			return cp.updateHexEditing(msg)
		}

		switch {
		case key.Matches(msg, cp.keyMap.Close):
			if cp.onCancel != nil {
				cp.onCancel()
			}
			cp.visible = false
			return cp, nil

		case key.Matches(msg, cp.keyMap.Confirm):
			if cp.onConfirm != nil {
				cp.onConfirm(ColorPickerResult{
					Confirmed: true,
					Color:     cp.GetColor(),
				})
			}
			cp.visible = false
			return cp, nil

		case key.Matches(msg, cp.keyMap.EditHex):
			cp.editingHex = true
			cp.hexInput.SetValue(cp.GetColor())
			cp.hexInput.Focus()
			return cp, nil

		case key.Matches(msg, cp.keyMap.Tab):
			// Cycle through modes
			cp.mode = (cp.mode + 1) % 3
			return cp, nil

		case msg.String() == "up" || msg.String() == "k":
			cp.navigateUp()
			return cp, nil

		case msg.String() == "down" || msg.String() == "j":
			cp.navigateDown()
			return cp, nil

		case msg.String() == "left" || msg.String() == "h":
			cp.adjustValue(-1)
			return cp, nil

		case msg.String() == "right" || msg.String() == "l":
			cp.adjustValue(1)
			return cp, nil

		case msg.String() == "shift+left" || msg.String() == "H":
			cp.adjustValue(-10)
			return cp, nil

		case msg.String() == "shift+right" || msg.String() == "L":
			cp.adjustValue(10)
			return cp, nil
		}
	}

	return cp, nil
}

// updateHexEditing handles hex input editing
func (cp *ColorPicker) updateHexEditing(msg tea.KeyMsg) (*ColorPicker, tea.Cmd) {
	switch msg.String() {
	case "enter":
		cp.setColorFromHex(cp.hexInput.Value())
		cp.editingHex = false
		cp.hexInput.Blur()
		return cp, nil
	case "esc":
		cp.editingHex = false
		cp.hexInput.Blur()
		return cp, nil
	default:
		var cmd tea.Cmd
		cp.hexInput, cmd = cp.hexInput.Update(msg)
		return cp, cmd
	}
}

// navigateUp moves selection up
func (cp *ColorPicker) navigateUp() {
	switch cp.mode {
	case ModePresets:
		if cp.selectedIdx > 0 {
			cp.selectedIdx--
		}
		cp.setColorFromHex(ColorPresets[cp.selectedIdx].Color)
	case ModeRGB:
		if cp.rgbComponent > 0 {
			cp.rgbComponent--
		}
	}
}

// navigateDown moves selection down
func (cp *ColorPicker) navigateDown() {
	switch cp.mode {
	case ModePresets:
		if cp.selectedIdx < len(ColorPresets)-1 {
			cp.selectedIdx++
		}
		cp.setColorFromHex(ColorPresets[cp.selectedIdx].Color)
	case ModeRGB:
		if cp.rgbComponent < 2 {
			cp.rgbComponent++
		}
	}
}

// adjustValue adjusts the current value
func (cp *ColorPicker) adjustValue(delta int) {
	switch cp.mode {
	case ModePresets:
		// In presets mode, left/right also navigates
		cp.selectedIdx += delta
		if cp.selectedIdx < 0 {
			cp.selectedIdx = 0
		}
		if cp.selectedIdx >= len(ColorPresets) {
			cp.selectedIdx = len(ColorPresets) - 1
		}
		cp.setColorFromHex(ColorPresets[cp.selectedIdx].Color)
	case ModeRGB:
		// Adjust RGB component
		switch cp.rgbComponent {
		case 0:
			newR := int(cp.r) + delta
			if newR < 0 {
				newR = 0
			}
			if newR > 255 {
				newR = 255
			}
			cp.r = uint8(newR)
		case 1:
			newG := int(cp.g) + delta
			if newG < 0 {
				newG = 0
			}
			if newG > 255 {
				newG = 255
			}
			cp.g = uint8(newG)
		case 2:
			newB := int(cp.b) + delta
			if newB < 0 {
				newB = 0
			}
			if newB > 255 {
				newB = 255
			}
			cp.b = uint8(newB)
		}
	}
}

// View renders the color picker
func (cp *ColorPicker) View() string {
	if !cp.visible {
		return ""
	}

	var sb strings.Builder

	// Title
	sb.WriteString(styles.DialogTitleStyle.Render("Color Picker"))
	sb.WriteString("\n\n")

	// Current color preview
	currentColor := cp.GetColor()
	colorStyle := lipgloss.NewStyle().
		Background(lipgloss.Color(currentColor)).
		Foreground(lipgloss.Color(cp.contrastColor())).
		Padding(0, 2)
	previewBox := colorStyle.Render(fmt.Sprintf(" %s ", currentColor))
	sb.WriteString("Current: ")
	sb.WriteString(previewBox)
	sb.WriteString("\n\n")

	// Mode tabs
	modes := []string{"Presets", "RGB", "Hex"}
	for i, mode := range modes {
		style := styles.ButtonStyle
		if ColorPickerMode(i) == cp.mode {
			style = styles.FocusedButtonStyle
		}
		sb.WriteString(style.Render(mode))
		sb.WriteString(" ")
	}
	sb.WriteString("\n\n")

	// Content based on mode
	switch cp.mode {
	case ModePresets:
		sb.WriteString(cp.renderPresets())
	case ModeRGB:
		sb.WriteString(cp.renderRGB())
	case ModeHex:
		sb.WriteString(cp.renderHex())
	}

	// Help
	sb.WriteString("\n")
	helpText := "↑↓: nav  ←→: adjust  tab: mode  e: hex  enter: confirm  esc: cancel"
	sb.WriteString(styles.HelpBarStyle.Render(helpText))

	// Dialog box
	return styles.DialogBoxStyle.
		Width(cp.width).
		Render(sb.String())
}

// renderPresets renders the presets mode
func (cp *ColorPicker) renderPresets() string {
	var sb strings.Builder

	// Show presets in a grid
	cols := 5
	for i, preset := range ColorPresets {
		colorStyle := lipgloss.NewStyle().
			Background(lipgloss.Color(preset.Color)).
			Foreground(lipgloss.Color(cp.contrastColorFor(preset.Color))).
			Padding(0, 1)

		label := preset.Name
		if len(label) > 8 {
			label = label[:8]
		}

		if i == cp.selectedIdx {
			sb.WriteString("> ")
			sb.WriteString(colorStyle.Bold(true).Render(label))
		} else {
			sb.WriteString("  ")
			sb.WriteString(colorStyle.Render(label))
		}

		if (i+1)%cols == 0 {
			sb.WriteString("\n")
		} else {
			sb.WriteString(" ")
		}
	}

	return sb.String()
}

// renderRGB renders the RGB sliders mode
func (cp *ColorPicker) renderRGB() string {
	var sb strings.Builder

	components := []struct {
		name  string
		value uint8
		color lipgloss.Color
	}{
		{"Red", cp.r, lipgloss.Color("#ff0000")},
		{"Green", cp.g, lipgloss.Color("#00ff00")},
		{"Blue", cp.b, lipgloss.Color("#0000ff")},
	}

	barWidth := 30
	for i, comp := range components {
		cursor := "  "
		if i == cp.rgbComponent {
			cursor = "> "
		}

		// Calculate bar fill
		filled := int(float64(comp.value) / 255.0 * float64(barWidth))
		if filled > barWidth {
			filled = barWidth
		}

		barStyle := lipgloss.NewStyle().Foreground(comp.color)
		filledBar := barStyle.Render(strings.Repeat("█", filled))
		emptyBar := strings.Repeat("░", barWidth-filled)

		sb.WriteString(fmt.Sprintf("%s%-6s: %s%s %3d\n", cursor, comp.name, filledBar, emptyBar, comp.value))
	}

	sb.WriteString("\nUse ←→ to adjust (Shift for ±10)")

	return sb.String()
}

// renderHex renders the hex input mode
func (cp *ColorPicker) renderHex() string {
	var sb strings.Builder

	sb.WriteString("Hex Color: ")
	if cp.editingHex {
		sb.WriteString(cp.hexInput.View())
	} else {
		sb.WriteString(styles.InputStyle.Render(cp.GetColor()))
		sb.WriteString("\n\nPress 'e' to edit")
	}

	return sb.String()
}

// contrastColor returns a contrasting color for readability
func (cp *ColorPicker) contrastColor() string {
	// Simple luminance calculation
	luminance := (0.299*float64(cp.r) + 0.587*float64(cp.g) + 0.114*float64(cp.b)) / 255.0
	if luminance > 0.5 {
		return "#000000"
	}
	return "#ffffff"
}

// contrastColorFor returns a contrasting color for a given hex color
func (cp *ColorPicker) contrastColorFor(hex string) string {
	hex = strings.TrimPrefix(hex, "#")
	if len(hex) != 6 {
		return "#ffffff"
	}

	r, _ := strconv.ParseUint(hex[0:2], 16, 8)
	g, _ := strconv.ParseUint(hex[2:4], 16, 8)
	b, _ := strconv.ParseUint(hex[4:6], 16, 8)

	luminance := (0.299*float64(r) + 0.587*float64(g) + 0.114*float64(b)) / 255.0
	if luminance > 0.5 {
		return "#000000"
	}
	return "#ffffff"
}
